/**
 * PostgreSQL integration tests for the import pipeline. They run only when TEST_DATABASE_URL
 * points at a disposable database (e.g. `bun run test:db`); every table is truncated first.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { and, eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb, eventLegs, events, sourceFiles, statements, transactions, user, workspaces, type Database } from '@finance/db';
import type { ParsedStatement } from '@finance/domain';
import { recordDecisions } from '@finance/ledger/store';
import { commitParsedStatement, setStatementDeleted } from '../src';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('statement import pipeline (PostgreSQL)', () => {
  let db: Database;
  let close: () => Promise<void>;
  let workspaceId: string;
  const userId = 'test-user';

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

  const parsed = (descriptions: string[]): ParsedStatement => ({
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
        rows: descriptions.map((d, rowIndex) => ({ rowIndex, postedOn: '2026-01-05', description: d, amount: '-10.00', raw: {} })),
      },
    ],
  });

  async function importParsed(name: string, statement: ParsedStatement) {
    const [file] = await db
      .insert(sourceFiles)
      .values({
        workspaceId,
        kind: 'statement',
        originalName: name,
        contentType: 'application/pdf',
        sizeBytes: 1,
        checksumSha256: name,
        objectKey: name,
      })
      .returning();
    const [row] = await db.insert(statements).values({ workspaceId, sourceFileId: file!.id }).returning();
    const summary = await db.transaction((tx) => commitParsedStatement(tx, workspaceId, file!.id, row!.id, statement));
    return { statementId: row!.id, summary };
  }

  async function importStatement(name: string, descriptions: string[]) {
    const [file] = await db
      .insert(sourceFiles)
      .values({
        workspaceId,
        kind: 'statement',
        originalName: name,
        contentType: 'application/pdf',
        sizeBytes: 1,
        checksumSha256: name,
        objectKey: name,
      })
      .returning();
    const [statement] = await db.insert(statements).values({ workspaceId, sourceFileId: file!.id }).returning();
    const summary = await db.transaction((tx) => commitParsedStatement(tx, workspaceId, file!.id, statement!.id, parsed(descriptions)));
    return { statementId: statement!.id, summary };
  }

  const activeDescriptions = async () =>
    (
      await db
        .select({ d: transactions.description })
        .from(transactions)
        .where(
          and(eq(transactions.workspaceId, workspaceId), eq(transactions.isSourceSupported, true), eq(transactions.isSuppressed, false)),
        )
    )
      .map((r) => r.d)
      .sort();

  const idOf = async (description: string) =>
    (await db.select({ id: transactions.id }).from(transactions).where(eq(transactions.description, description)))[0]!.id;

  test('A/B overlap, soft delete and reimport restore original IDs without duplicate events', async () => {
    const a = await importStatement('A', ['T1', 'T2', 'T3']);
    const b = await importStatement('B', ['T2', 'T3', 'T4']);
    expect(await activeDescriptions()).toEqual(['T1', 'T2', 'T3', 'T4']);
    expect((await db.select().from(eventLegs)).length).toBe(4);
    const originalT1 = await idOf('T1');

    await setStatementDeleted(db, workspaceId, a.statementId, true, userId);
    expect(await activeDescriptions()).toEqual(['T2', 'T3', 'T4']);

    await setStatementDeleted(db, workspaceId, b.statementId, true, userId);
    expect(await activeDescriptions()).toEqual([]);
    expect((await db.select().from(eventLegs)).length).toBe(0);

    const c = await importStatement('C', ['T1', 'T2', 'T5']);
    expect(c.summary).toMatchObject({ created: 1, linked: 2, restored: 2 });
    expect(await idOf('T1')).toBe(originalT1);
    expect(await activeDescriptions()).toEqual(['T1', 'T2', 'T5']);
    expect((await db.select().from(eventLegs)).length).toBe(3);
  });

  test('manual suppression survives a reimport until restored', async () => {
    await importStatement('A', ['T1', 'T2']);
    const t1 = await idOf('T1');
    await db.transaction((tx) =>
      recordDecisions(tx, workspaceId, [{ workspaceId, transactionId: t1, kind: 'suppression', payload: { suppressed: true }, userId }]),
    );
    await importStatement('B', ['T1', 'T2']);
    expect(await activeDescriptions()).toEqual(['T2']);

    await db.transaction((tx) =>
      recordDecisions(tx, workspaceId, [{ workspaceId, transactionId: t1, kind: 'suppression', payload: { suppressed: false }, userId }]),
    );
    expect(await activeDescriptions()).toEqual(['T1', 'T2']);
  });

  test('a category decision survives soft deletion and reimport', async () => {
    const a = await importStatement('A', ['Groceries']);
    const txId = await idOf('Groceries');
    const categoryId = crypto.randomUUID();
    await db.execute(
      sql`insert into categories (id, workspace_id, name, kind) values (${categoryId}, ${workspaceId}, 'Essentials', 'expense')`,
    );
    await db.transaction((tx) =>
      recordDecisions(tx, workspaceId, [
        { workspaceId, transactionId: txId, kind: 'category', legKey: 'principal', payload: { categoryId }, userId },
      ]),
    );

    await setStatementDeleted(db, workspaceId, a.statementId, true, userId);
    await importStatement('B', ['Groceries']);
    const [leg] = await db.select().from(eventLegs).where(eq(eventLegs.transactionId, txId));
    expect(leg!.categoryId).toBe(categoryId);
  });

  test('provider IDs dedupe across files, and one statement can cover several accounts', async () => {
    let nextRow = 0; // Row indexes are positions within the whole file, across accounts.
    const section = (identifier: string, commodity: string, rows: Array<[string, string, string]>) => ({
      identifier,
      maskedIdentifier: identifier,
      name: commodity,
      accountType: 'bank' as const,
      classification: 'asset' as const,
      commodity,
      rows: rows.map(([providerId, description, amount]) => ({
        rowIndex: nextRow++,
        postedOn: '2026-01-05',
        description,
        amount,
        providerId,
        groupRef: `wise:${providerId.replace(/^FEE-/, '')}`,
        role: providerId.startsWith('FEE-') ? ('fee' as const) : ('principal' as const),
        raw: {},
      })),
    });
    const wise = (accounts: ReturnType<typeof section>[]): ParsedStatement => ({
      ...parsed([]),
      provider: 'wise',
      institutionName: 'Wise',
      accounts,
    });

    const a = await importParsed(
      'A',
      wise([
        section('AUD', 'AUD', [
          ['CARD-1', 'Card transaction', '-1.20'],
          ['FEE-CARD-1', 'Wise Charges for: CARD-1', '-0.01'],
        ]),
        section('NZD', 'NZD', [['CARD-1', 'Card transaction', '-18.40']]),
      ]),
    );
    expect(a.summary.accounts).toHaveLength(2);
    nextRow = 0;
    const b = await importParsed('B', wise([section('AUD', 'AUD', [['CARD-1', 'Card transaction (reworded)', '-1.20']])]));
    expect(b.summary).toMatchObject({ created: 0, linked: 1 });

    const rows = await db.select().from(transactions).where(eq(transactions.workspaceId, workspaceId));
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.role === 'fee')!.providerGroupRef).toBe('wise:CARD-1');

    await setStatementDeleted(db, workspaceId, a.statementId, true, userId);
    expect(await activeDescriptions()).toEqual(['Card transaction']);
  });

  test('a bank transfer out and a Wise top-up are linked automatically into one internal transfer', async () => {
    const one = (
      provider: string,
      identifier: string,
      row: { description: string; amount: string; transferHint?: boolean; providerId?: string },
    ) => ({
      ...parsed([]),
      provider,
      institutionName: provider,
      accounts: [
        {
          ...parsed([]).accounts[0]!,
          identifier,
          rows: [{ rowIndex: 0, postedOn: '2026-01-05', raw: {}, ...row }],
        },
      ],
    });
    await importParsed('cba', one('commbank', '123', { description: 'Transfer To Wise', amount: '-250.00' }));
    const wise = await importParsed(
      'wise',
      one('wise', 'AUD', { description: 'Topped up account', amount: '250.00', transferHint: true, providerId: 'TRANSFER-1' }),
    );
    expect(wise.summary.transfersMatched).toBe(1);

    const all = await db.select().from(events).where(eq(events.workspaceId, workspaceId));
    expect(all.filter((e) => e.type !== 'opening_balance').map((e) => [e.type, e.status, e.isInternal])).toEqual([
      ['internal_transfer', 'ok', true],
    ]);

    // Unlinking is a user decision; the matcher never re-links those transactions.
    const ids = (await db.select({ id: transactions.id }).from(transactions)).map((r) => r.id);
    await db.transaction((tx) =>
      recordDecisions(
        tx,
        workspaceId,
        ids.map((transactionId) => ({ workspaceId, transactionId, kind: 'link' as const, payload: { groupId: null }, userId })),
      ),
    );
    const after = await db.select().from(events).where(eq(events.workspaceId, workspaceId));
    expect(
      after
        .filter((e) => e.type !== 'opening_balance')
        .map((e) => [e.type, e.status])
        .sort(),
    ).toEqual([
      ['expense', 'ok'],
      ['internal_transfer', 'unmatched_transfer'],
    ]);
  });

  test('reimporting with a newer parser updates source hints on existing transactions', async () => {
    await importStatement('old', ['Repayment/Payment']);
    const hinted = parsed(['Repayment/Payment']);
    hinted.accounts[0]!.rows[0]!.transferHint = true;
    const again = await importParsed('new', hinted);
    expect(again.summary).toMatchObject({ created: 0, linked: 1 });
    const [row] = await db.select().from(transactions).where(eq(transactions.workspaceId, workspaceId));
    expect(row!.isTransferHint).toBe(true);
  });
});
