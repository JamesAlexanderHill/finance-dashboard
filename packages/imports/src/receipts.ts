import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import { sourceFiles, transactionReceipts, transactions, type Database } from '@finance/db';
import { sha256Hex } from '@finance/shared/node';
import { DuplicateUploadError } from './statements';
import { sourceFileKey, type ObjectStorage } from './storage';

export class ReceiptError extends Error {}

const startsWith = (bytes: Uint8Array, at: number, magic: number[]) => magic.every((b, i) => bytes[at + i] === b);
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

/**
 * The receipt's type, read from its leading bytes rather than the browser's claim, since files are
 * served back inline. Only formats a browser can show are accepted.
 */
export function receiptContentType(bytes: Uint8Array): string | null {
  if (startsWith(bytes, 0, ascii('%PDF-'))) return 'application/pdf';
  if (startsWith(bytes, 0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, 0, ascii('RIFF')) && startsWith(bytes, 8, ascii('WEBP'))) return 'image/webp';
  return null;
}

async function liveDuplicate(db: Database, workspaceId: string, checksum: string, exceptId?: string) {
  const [duplicate] = await db
    .select({ name: sourceFiles.originalName })
    .from(sourceFiles)
    .where(
      and(
        eq(sourceFiles.workspaceId, workspaceId),
        eq(sourceFiles.checksumSha256, checksum),
        isNull(sourceFiles.deletedAt),
        exceptId ? ne(sourceFiles.id, exceptId) : undefined,
      ),
    );
  return duplicate;
}

/**
 * Stores a receipt (feature 03) and attaches it to a canonical transaction. Receipts are evidence,
 * not parsed. Like any source file, bytes already live in the workspace are rejected.
 */
export async function attachReceipt(
  db: Database,
  storage: ObjectStorage,
  input: { workspaceId: string; userId: string; transactionId: string; fileName: string; bytes: Uint8Array },
) {
  const [owned] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.id, input.transactionId), eq(transactions.workspaceId, input.workspaceId)));
  if (!owned) throw new ReceiptError('Transaction not found');
  const contentType = receiptContentType(input.bytes);
  if (!contentType) throw new ReceiptError('Receipts must be PDF, JPEG, PNG or WebP files');
  const checksum = sha256Hex(input.bytes);
  const duplicate = await liveDuplicate(db, input.workspaceId, checksum);
  if (duplicate) throw new DuplicateUploadError(`This file is already uploaded as "${duplicate.name}"`);

  const sourceFileId = crypto.randomUUID();
  const objectKey = sourceFileKey(input.workspaceId, sourceFileId);
  await storage.put(objectKey, input.bytes, contentType, checksum);
  await db.transaction(async (tx) => {
    await tx.insert(sourceFiles).values({
      id: sourceFileId,
      workspaceId: input.workspaceId,
      kind: 'receipt',
      originalName: input.fileName,
      contentType,
      sizeBytes: input.bytes.byteLength,
      checksumSha256: checksum,
      objectKey,
      uploadedBy: input.userId,
    });
    await tx.insert(transactionReceipts).values({ sourceFileId, workspaceId: input.workspaceId, transactionId: input.transactionId });
  });
  return { sourceFileId };
}

/** A transaction's receipts, oldest first, including removed ones (their files are retained). */
export async function listReceipts(db: Database, workspaceId: string, transactionId: string) {
  const rows = await db
    .select({
      sourceFileId: sourceFiles.id,
      fileName: sourceFiles.originalName,
      contentType: sourceFiles.contentType,
      sizeBytes: sourceFiles.sizeBytes,
      uploadedAt: sourceFiles.uploadedAt,
      removedAt: sourceFiles.deletedAt,
    })
    .from(transactionReceipts)
    .innerJoin(sourceFiles, eq(sourceFiles.id, transactionReceipts.sourceFileId))
    .where(and(eq(transactionReceipts.workspaceId, workspaceId), eq(transactionReceipts.transactionId, transactionId)))
    .orderBy(asc(sourceFiles.uploadedAt));
  return rows.map((r) => ({ ...r, uploadedAt: r.uploadedAt.toISOString(), removedAt: r.removedAt?.toISOString() ?? null }));
}

/** Removes (soft-deletes) or restores a receipt. Restoring is refused while an identical file is live. */
export async function setReceiptRemoved(db: Database, workspaceId: string, sourceFileId: string, removed: boolean, userId: string) {
  const [file] = await db
    .select({ id: sourceFiles.id, checksum: sourceFiles.checksumSha256 })
    .from(transactionReceipts)
    .innerJoin(sourceFiles, eq(sourceFiles.id, transactionReceipts.sourceFileId))
    .where(and(eq(transactionReceipts.workspaceId, workspaceId), eq(transactionReceipts.sourceFileId, sourceFileId)));
  if (!file) throw new ReceiptError('Receipt not found');
  if (!removed) {
    const duplicate = await liveDuplicate(db, workspaceId, file.checksum, file.id);
    if (duplicate) throw new DuplicateUploadError(`This file is already uploaded as "${duplicate.name}"`);
  }
  await db
    .update(sourceFiles)
    .set(removed ? { deletedAt: sql`now()`, deletedBy: userId } : { deletedAt: null, deletedBy: null })
    .where(eq(sourceFiles.id, file.id));
}
