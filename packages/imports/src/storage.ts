import { CreateBucketCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

/** Private S3-compatible object store (RustFS, ADR 0005). Never exposed to browsers directly. */
export class ObjectStorage {
  private client: S3Client;
  private bucketReady?: Promise<void>;

  constructor(
    readonly bucket = process.env.S3_BUCKET ?? 'finance-source-files',
    client?: S3Client,
  ) {
    this.client =
      client ??
      new S3Client({
        endpoint: process.env.S3_ENDPOINT,
        region: process.env.S3_REGION ?? 'us-east-1',
        forcePathStyle: true,
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
        },
      });
  }

  private ensureBucket() {
    this.bucketReady ??= (async () => {
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      } catch {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      }
    })().catch((err) => {
      this.bucketReady = undefined;
      throw err;
    });
    return this.bucketReady;
  }

  async put(key: string, body: Uint8Array, contentType: string, checksumSha256: string) {
    await this.ensureBucket();
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, Metadata: { sha256: checksumSha256 } }),
    );
  }

  async getBytes(key: string): Promise<Uint8Array> {
    await this.ensureBucket();
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return res.Body!.transformToByteArray();
  }

  async getStream(key: string): Promise<ReadableStream> {
    await this.ensureBucket();
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return res.Body!.transformToWebStream();
  }
}

let shared: ObjectStorage | undefined;
export const getStorage = () => (shared ??= new ObjectStorage());

export const sourceFileKey = (workspaceId: string, sourceFileId: string) => `workspaces/${workspaceId}/source-files/${sourceFileId}`;
