/**
 * PostgreSQL integration tests for statement uploads and duplicate checks. They run only when
 * TEST_DATABASE_URL points at a disposable database; every table is truncated first.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb, sourceFiles, statements, user, workspaces, type Database } from '@finance/db';
import { createPriceImportUpload, createStatementUpload, DuplicateUploadError, type ObjectStorage } from '../src';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('statement uploads (PostgreSQL)', () => {
  let db: Database;
  let close: () => Promise<void>;
  let workspaceId: string;
  const userId = 'test-user';
  const storage = { put: async () => {} } as unknown as ObjectStorage;
  const bytes = (text: string) => new TextEncoder().encode(text);

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
  });

  const upload = (fileName: string, text: string) =>
    createStatementUpload(db, storage, { workspaceId, userId, fileName, contentType: 'application/pdf', bytes: bytes(text) });
  const finish = (statementId: string, status: 'completed' | 'failed') =>
    db.update(statements).set({ status }).where(eq(statements.id, statementId));

  test("a failed statement's bytes don't count as a duplicate; a completed statement's do", async () => {
    const failed = await upload('a.pdf', 'statement a');
    await finish(failed.statement.id, 'failed');
    await upload('a-again.pdf', 'statement a');

    const done = await upload('b.pdf', 'statement b');
    await finish(done.statement.id, 'completed');
    await expect(upload('b-again.pdf', 'statement b')).rejects.toThrow(DuplicateUploadError);
    // The check spans file kinds: a price CSV with the same bytes is refused too.
    await expect(
      createPriceImportUpload(db, storage, { workspaceId, userId, fileName: 'b.csv', bytes: bytes('statement b') }),
    ).rejects.toThrow(DuplicateUploadError);
  });

  test('a queued statement still blocks its bytes', async () => {
    await upload('a.pdf', 'statement a');
    await expect(upload('a-again.pdf', 'statement a')).rejects.toThrow('already imported as "a.pdf"');
    expect(await db.select().from(sourceFiles)).toHaveLength(1);
  });
});
