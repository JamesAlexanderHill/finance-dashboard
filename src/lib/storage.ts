/**
 * Object storage for raw import uploads (e.g. PDF statements).
 *
 * S3-compatible and configured entirely from the environment, so it works with
 * AWS S3, Cloudflare R2, MinIO, etc.:
 *   S3_BUCKET             bucket name (required)
 *   S3_REGION             region (defaults to "auto", which R2 expects)
 *   S3_ACCESS_KEY_ID      access key (required)
 *   S3_SECRET_ACCESS_KEY  secret key (required)
 *   S3_ENDPOINT           custom endpoint for non-AWS providers (optional)
 *   S3_FORCE_PATH_STYLE   "true" for MinIO and similar (optional)
 *
 * The client is created lazily so importing this module never throws when
 * storage is unconfigured — only the storage calls themselves do.
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

let client: S3Client | null = null

/** True when the required env vars are present, so callers can skip storage gracefully. */
export function isStorageConfigured(): boolean {
  return Boolean(
    process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY,
  )
}

function bucket(): string {
  const b = process.env.S3_BUCKET
  if (!b) throw new Error('Object storage is not configured (S3_BUCKET is unset).')
  return b
}

function getClient(): S3Client {
  if (client) return client
  if (!isStorageConfigured()) {
    throw new Error(
      'Object storage is not configured. Set S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.',
    )
  }
  client = new S3Client({
    region: process.env.S3_REGION ?? 'auto',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  })
  return client
}

/** Uploads bytes under `key`. */
export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  await getClient().send(
    new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType }),
  )
}

/** Returns a short-lived presigned GET URL that downloads the object as `downloadName`. */
export async function getSignedDownloadUrl(
  key: string,
  downloadName: string,
  expiresSec = 300,
): Promise<string> {
  // Quotes/newlines would break the Content-Disposition header.
  const safeName = downloadName.replace(/["\\\r\n]/g, '_')
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({
      Bucket: bucket(),
      Key: key,
      ResponseContentDisposition: `attachment; filename="${safeName}"`,
    }),
    { expiresIn: expiresSec },
  )
}

/** Deletes the object at `key`. */
export async function deleteObject(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }))
}
