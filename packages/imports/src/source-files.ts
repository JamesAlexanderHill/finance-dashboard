import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { sourceFiles, statements, type Executor } from '@finance/db';

export class DuplicateUploadError extends Error {}

/**
 * A live file in the workspace with these bytes, other than `exceptId`. A failed statement's file
 * doesn't count: its import committed nothing, so the same bytes can be uploaded again.
 */
export async function findLiveDuplicate(db: Executor, workspaceId: string, checksum: string, exceptId?: string) {
  const [duplicate] = await db
    .select({ id: sourceFiles.id, name: sourceFiles.originalName })
    .from(sourceFiles)
    .leftJoin(statements, eq(statements.sourceFileId, sourceFiles.id))
    .where(
      and(
        eq(sourceFiles.workspaceId, workspaceId),
        eq(sourceFiles.checksumSha256, checksum),
        isNull(sourceFiles.deletedAt),
        or(isNull(statements.id), ne(statements.status, 'failed')),
        exceptId ? ne(sourceFiles.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  return duplicate;
}

/** Throws when `findLiveDuplicate` finds a file; `verb` reads "already <verb> as …". */
export async function assertNoLiveDuplicate(db: Executor, workspaceId: string, checksum: string, verb = 'uploaded', exceptId?: string) {
  const duplicate = await findLiveDuplicate(db, workspaceId, checksum, exceptId);
  if (duplicate) throw new DuplicateUploadError(`This file is already ${verb} as "${duplicate.name}"`);
}

/**
 * Soft-deletes live failed statements' files with these bytes, which a new upload of the same
 * bytes replaces. They hold no rows, so nothing else needs refreshing.
 */
export async function retireFailedStatements(db: Executor, workspaceId: string, checksum: string, userId: string) {
  const failed = db
    .select({ id: statements.sourceFileId })
    .from(statements)
    .where(and(eq(statements.workspaceId, workspaceId), eq(statements.status, 'failed')));
  await db
    .update(sourceFiles)
    .set({ deletedAt: sql`now()`, deletedBy: userId })
    .where(
      and(
        eq(sourceFiles.workspaceId, workspaceId),
        eq(sourceFiles.checksumSha256, checksum),
        isNull(sourceFiles.deletedAt),
        inArray(sourceFiles.id, failed),
      ),
    );
}
