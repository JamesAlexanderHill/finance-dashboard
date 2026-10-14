import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb, sourceFiles, statements, transactions, user, workspaces, type Database } from '@finance/db';
import type { ParsedStatement } from '@finance/domain';
import {
  attachReceipt,
  commitParsedStatement,
  DuplicateUploadError,
  listReceipts,
  ReceiptError,
  receiptContentType,
  setReceiptRemoved,
  type ObjectStorage,
} from '../src';

const bytes = (...parts: Array<string | number[]>) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));
const pdf = (body: string) => bytes('%PDF-1.7\n', body);

describe('receipt file types', () => {
  test('are read from the leading bytes', () => {
    expect(receiptContentType(pdf('x'))).toBe('application/pdf');
    expect(receiptContentType(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(receiptContentType(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(receiptContentType(bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 '))).toBe('image/webp');
  });

  test('anything else is refused, whatever its name claims', () => {
    expect(receiptContentType(bytes('<html><script>'))).toBeNull();
    expect(receiptContentType(bytes('RIFF', [0, 0, 0, 0], 'WAVE'))).toBeNull();
    expect(receiptContentType(new Uint8Array())).toBeNull();
  });
});

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('receipts (PostgreSQL)', () => {
  let db: Database;
  let close: () => Promise<void>;
  let workspaceId: string;
  let transactionId: string;
  const userId = 'test-user';
  const objects = new Map<string, Uint8Array>();
  const storage = { put: async (key: string, body: Uint8Array) => void objects.set(key, body) } as unknown as ObjectStorage;

  beforeAll(async () => {
    const conn = createDb(url);
    db = conn.db;
    close = () => conn.client.end();
    await migrate(db, { migrationsFolder: new URL('../../db/migrations', import.meta.url).pathname });
  });
  afterAll(() => close());

  beforeEach(async () => {
    await db.execute(sql`
      do $$ declare r record; begin
        for r in select tablename from pg_tables where schemaname = 'public' loop
          execute 'truncate table ' || quote_ident(r.tablename) || ' cascade';
        end loop;
      end $$;
    `);
    await db.insert(user).values({ id: userId, name: 'Test', email: 'test@example.com' });
    const [ws] = await db.insert(workspaces).values({ name: 'Test' }).returning();
    workspaceId = ws!.id;

    const parsed: ParsedStatement = {
      parserId: 'test',
      parserVersion: '1',
      provider: 'commbank',
      institutionName: 'Commbank',
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      warnings: [],
      accounts: [
        {
          identifier: '123',
          maskedIdentifier: '•••• 0123',
          name: 'Everyday',
          accountType: 'bank',
          classification: 'asset',
          commodity: 'AUD',
          rows: [{ rowIndex: 0, postedOn: '2026-01-05', description: 'Hardware Store', amount: '-42.00', raw: {} }],
        },
      ],
    };
    const [file] = await db
      .insert(sourceFiles)
      .values({
        workspaceId,
        kind: 'statement',
        originalName: 's.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1,
        checksumSha256: 's',
        objectKey: 's',
      })
      .returning();
    const [statement] = await db.insert(statements).values({ workspaceId, sourceFileId: file!.id }).returning();
    await db.transaction((tx) => commitParsedStatement(tx, workspaceId, file!.id, statement!.id, parsed));
    const [t] = await db.select({ id: transactions.id }).from(transactions);
    transactionId = t!.id;
  });

  const attach = (fileName: string, body: Uint8Array, onto = transactionId, ws = workspaceId) =>
    attachReceipt(db, storage, { workspaceId: ws, userId, transactionId: onto, fileName, bytes: body });

  test('a receipt is stored with its sniffed type and listed on its transaction', async () => {
    const { sourceFileId } = await attach('till.pdf', pdf('a'));
    const [receipt] = await listReceipts(db, workspaceId, transactionId);
    expect(receipt).toMatchObject({ sourceFileId, fileName: 'till.pdf', contentType: 'application/pdf', removedAt: null });
    const [file] = await db
      .select()
      .from(sourceFiles)
      .where(sql`${sourceFiles.id} = ${sourceFileId}`);
    expect(file!.kind).toBe('receipt');
    expect(objects.get(file!.objectKey)).toEqual(pdf('a'));
  });

  test('unsupported files, unknown transactions and live duplicates are refused', async () => {
    await expect(attach('page.html', bytes('<html>'))).rejects.toThrow(ReceiptError);
    await expect(attach('till.pdf', pdf('a'), crypto.randomUUID())).rejects.toThrow('Transaction not found');
    const [other] = await db.insert(workspaces).values({ name: 'Other' }).returning();
    await expect(attach('till.pdf', pdf('a'), transactionId, other!.id)).rejects.toThrow('Transaction not found');

    await attach('till.pdf', pdf('a'));
    await expect(attach('copy.pdf', pdf('a'))).rejects.toThrow(DuplicateUploadError);
  });

  test('removing keeps the file, and restoring waits until no identical file is live', async () => {
    const { sourceFileId } = await attach('till.pdf', pdf('a'));
    await setReceiptRemoved(db, workspaceId, sourceFileId, true, userId);
    expect((await listReceipts(db, workspaceId, transactionId))[0]!.removedAt).not.toBeNull();

    // A removed receipt's bytes may be uploaded again, but then the old copy cannot come back alongside it.
    const again = await attach('again.pdf', pdf('a'));
    await expect(setReceiptRemoved(db, workspaceId, sourceFileId, false, userId)).rejects.toThrow(DuplicateUploadError);
    await setReceiptRemoved(db, workspaceId, again.sourceFileId, true, userId);
    await setReceiptRemoved(db, workspaceId, sourceFileId, false, userId);
    expect((await listReceipts(db, workspaceId, transactionId)).map((r) => r.removedAt === null)).toEqual([true, false]);
  });

  test("another workspace's receipt cannot be removed", async () => {
    const { sourceFileId } = await attach('till.pdf', pdf('a'));
    const [other] = await db.insert(workspaces).values({ name: 'Other' }).returning();
    await expect(setReceiptRemoved(db, other!.id, sourceFileId, true, userId)).rejects.toThrow(ReceiptError);
    expect(await listReceipts(db, other!.id, transactionId)).toEqual([]);
  });
});
