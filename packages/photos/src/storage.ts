import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

// Where photos are kept (docs/plans/M9.md D-M9-1): the mail platform's private S3 bucket under
// photos/ once AWS is configured, otherwise a local folder (development and CI). Never public:
// readers see approved photos only through the town site's /photos route.

export interface PhotoStorage {
  readonly kind: 's3' | 'local';
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
}

/** Without S3 or PHOTO_STORAGE_DIR: `.data/photos` under the running app (bundlers move this file). */
export const DEFAULT_PHOTO_DIR = join(process.cwd(), '.data', 'photos');

export function localPhotoStorage(dir: string = DEFAULT_PHOTO_DIR): PhotoStorage {
  const path = (key: string) => {
    if (key.includes('..')) throw new Error(`Bad photo key ${key}`);
    return join(dir, key);
  };
  return {
    kind: 'local',
    async put(key, bytes) {
      mkdirSync(dirname(path(key)), { recursive: true });
      writeFileSync(path(key), bytes);
    },
    async get(key) {
      return existsSync(path(key)) ? new Uint8Array(readFileSync(path(key))) : null;
    },
  };
}

export function s3PhotoStorage(opts: {
  bucket: string;
  region: string;
  client?: S3Client;
}): PhotoStorage {
  const client = opts.client ?? new S3Client({ region: opts.region });
  return {
    kind: 's3',
    async put(key, bytes) {
      await client.send(
        new PutObjectCommand({
          Bucket: opts.bucket,
          Key: key,
          Body: bytes,
          ContentType: 'image/jpeg',
        }),
      );
    },
    async get(key) {
      try {
        const response = await client.send(new GetObjectCommand({ Bucket: opts.bucket, Key: key }));
        return response.Body ? new Uint8Array(await response.Body.transformToByteArray()) : null;
      } catch (error) {
        if ((error as { name?: string }).name === 'NoSuchKey') return null;
        throw error;
      }
    },
  };
}

/** S3 when the mail bucket and AWS credentials are set; the local folder otherwise. */
export function photoStorageFromEnv(env: {
  MAIL_S3_BUCKET?: string | undefined;
  AWS_REGION?: string | undefined;
  AWS_ACCESS_KEY_ID?: string | undefined;
  PHOTO_STORAGE_DIR?: string | undefined;
}): PhotoStorage {
  if (env.MAIL_S3_BUCKET && env.AWS_REGION && env.AWS_ACCESS_KEY_ID)
    return s3PhotoStorage({ bucket: env.MAIL_S3_BUCKET, region: env.AWS_REGION });
  return localPhotoStorage(env.PHOTO_STORAGE_DIR || DEFAULT_PHOTO_DIR);
}
