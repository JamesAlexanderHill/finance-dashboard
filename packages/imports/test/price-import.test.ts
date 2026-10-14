/** PostgreSQL integration tests for price CSV imports (run with `bun run test:db`). */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { and, eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { priceImportPayload } from '@finance/contracts';
import { createDb, instruments, jobs, priceObservations, user, workspaces, type Database } from '@finance/db';
import {
  createPriceImportUpload,
  livePriceCondition,
  resolvePriceConflict,
  setPriceOverride,
  activePriceOverrides,
  runPriceImport,
  setPriceFileDeleted,
  startPriceImport,
  type ObjectStorage,
} from '../src';

const url = process.env.TEST_DATABASE_URL;

/** In-memory stand-in for RustFS. */
function memoryStorage(): ObjectStorage {
  const objects = new Map<string, Uint8Array>();
  return {
    put: async (key: string, body: Uint8Array) => void objects.set(key, body),
    getBytes: async (key: string) => objects.get(key)!,
  } as unknown as ObjectStorage;
}

describe.skipIf(!url)('price CSV import (PostgreSQL)', () => {
  let db: Database;
  let close: () => Promise<void>;
  let workspaceId: string;
  let vasId: string;
  const userId = 'test-user';
  const storage = memoryStorage();

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
    const [vas] = await db
      .insert(instruments)
      .values({ workspaceId, symbol: 'VAS', exchange: 'XASX', name: 'Vanguard Australian Shares', currency: 'AUD' })
      .returning();
    vasId = vas!.id;
  });

  async function importCsv(name: string, csv: string) {
    const { sourceFileId } = await createPriceImportUpload(db, storage, {
      workspaceId,
      userId,
      fileName: name,
      bytes: new TextEncoder().encode(csv),
    });
    const job = await startPriceImport(db, workspaceId, sourceFileId, {
      dateColumn: 'Date',
      dateFormat: 'YYYY-MM-DD',
      priceColumn: 'Close',
      instrumentColumn: 'Symbol',
    });
    const [row] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    await runPriceImport(db, storage, row!, priceImportPayload.parse(row!.payload));
    return sourceFileId;
  }

  const live = () =>
    db
      .select({ observedOn: priceObservations.observedOn, price: priceObservations.price })
      .from(priceObservations)
      .where(and(eq(priceObservations.instrumentId, vasId), livePriceCondition));

  test('overlapping files de-duplicate, conflicts are flagged, and soft-deleting a file keeps prices other files report', async () => {
    const a = await importCsv('a.csv', 'Symbol,Date,Close\nVAS.AX,2025-01-02,100.00\nVAS,2025-01-03,101.00\nNOPE,2025-01-03,1\n');
    expect(await live()).toHaveLength(2);

    await importCsv('b.csv', 'Symbol,Date,Close\nVAS,2025-01-03,101.00\nVAS,2025-01-06,102.00\nVAS,2025-01-02,99.00\n');
    const all = await db.select().from(priceObservations).where(eq(priceObservations.instrumentId, vasId));
    expect(
      all
        .filter((o) => o.status === 'conflict')
        .map((o) => o.price)
        .sort(),
    ).toEqual(['100.00000000', '99.00000000']);
    // 2 Jan is in conflict, so only 3 and 6 Jan are live (3 Jan reported twice).
    expect((await live()).map((o) => o.observedOn).sort()).toEqual(['2025-01-03', '2025-01-03', '2025-01-06']);

    await setPriceFileDeleted(db, workspaceId, a, true, userId);
    expect((await live()).map((o) => o.observedOn).sort()).toEqual(['2025-01-03', '2025-01-06']);
  });

  test('choosing one conflicting price activates it and rejects the others', async () => {
    await importCsv('a.csv', 'Symbol,Date,Close\nVAS,2025-01-02,100.00\n');
    await importCsv('b.csv', 'Symbol,Date,Close\nVAS,2025-01-02,99.00\n');
    const [chosen] = await db.select().from(priceObservations).where(eq(priceObservations.price, '99.00000000'));
    await db.transaction((tx) => resolvePriceConflict(tx, workspaceId, chosen!.id));
    const all = await db.select().from(priceObservations).where(eq(priceObservations.instrumentId, vasId));
    expect(all.map((o) => [o.price, o.status]).sort()).toEqual([
      ['100.00000000', 'rejected'],
      ['99.00000000', 'active'],
    ]);
  });

  test('an override stays until a real observation on or after its date arrives', async () => {
    await db.transaction((tx) =>
      setPriceOverride(tx, workspaceId, { instrumentId: vasId, price: '120', currency: 'AUD', setOn: '2025-02-10', userId }),
    );
    await importCsv('older.csv', 'Symbol,Date,Close\nVAS,2025-02-07,110.00\n');
    expect(await activePriceOverrides(db, workspaceId)).toHaveLength(1);
    await importCsv('newer.csv', 'Symbol,Date,Close\nVAS,2025-02-10,111.00\n');
    expect(await activePriceOverrides(db, workspaceId)).toHaveLength(0);
  });
});
