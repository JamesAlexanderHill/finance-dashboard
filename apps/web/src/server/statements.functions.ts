import { createServerFn } from '@tanstack/react-start';
import { desc, eq, sql } from 'drizzle-orm';
import { idInput, type ImportSummary } from '@finance/contracts';
import { getDb, sourceFiles, statements } from '@finance/db';
import { setStatementDeleted } from '@finance/imports';
import { workspaceMiddleware } from './session';

export const listStatements = createServerFn({ method: 'GET' })
  .middleware([workspaceMiddleware])
  .handler(async ({ context }) => {
    const rows = await getDb()
      .select({
        id: statements.id,
        status: statements.status,
        error: statements.error,
        periodStart: statements.periodStart,
        periodEnd: statements.periodEnd,
        parserId: statements.parserId,
        parserVersion: statements.parserVersion,
        sourceFileId: sourceFiles.id,
        fileName: sourceFiles.originalName,
        sizeBytes: sourceFiles.sizeBytes,
        uploadedAt: sourceFiles.uploadedAt,
        deletedAt: sourceFiles.deletedAt,
        jobId: sql<string | null>`(select j.id from jobs j where j.workspace_id = ${statements.workspaceId}
          and j.payload->>'statementId' = ${statements.id}::text order by j.created_at desc limit 1)`,
        summary: sql<ImportSummary | null>`(select r.summary from import_results r where r.statement_id = ${statements.id}
          order by r.created_at desc limit 1)`,
        accounts: sql<string[]>`coalesce((select array_agg(distinct fa.name order by fa.name) from source_records sr
          join financial_accounts fa on fa.id = sr.account_id where sr.source_file_id = ${sourceFiles.id}), '{}')`,
      })
      .from(statements)
      .innerJoin(sourceFiles, eq(sourceFiles.id, statements.sourceFileId))
      .where(eq(statements.workspaceId, context.workspaceId))
      .orderBy(desc(statements.periodEnd), desc(sourceFiles.uploadedAt));
    return rows.map((r) => ({ ...r, uploadedAt: r.uploadedAt.toISOString(), deletedAt: r.deletedAt?.toISOString() ?? null }));
  });

export const deleteStatement = createServerFn({ method: 'POST' })
  .middleware([workspaceMiddleware])
  .validator(idInput)
  .handler(async ({ context, data }) => {
    await setStatementDeleted(getDb(), context.workspaceId, data.id, true, context.userId);
  });

export const restoreStatement = createServerFn({ method: 'POST' })
  .middleware([workspaceMiddleware])
  .validator(idInput)
  .handler(async ({ context, data }) => {
    await setStatementDeleted(getDb(), context.workspaceId, data.id, false, context.userId);
  });
