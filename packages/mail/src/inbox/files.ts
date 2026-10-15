import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Attachment delivery for the inbox (brief Phase 3): downloads get a 5-minute presigned S3 URL
// after a staff check; inline images are streamed through the admin host so the message frame's
// CSP only ever allows one image origin.

export const DOWNLOAD_URL_TTL_S = 300;

export interface AttachmentFiles {
  downloadUrl(key: string, filename: string): Promise<string>;
  read(key: string): Promise<Buffer>;
}

export function s3AttachmentFiles(options: {
  region: string;
  bucket: string;
  client?: S3Client;
}): AttachmentFiles {
  const client = options.client ?? new S3Client({ region: options.region });
  return {
    async downloadUrl(key, filename) {
      const safe = filename.replace(/["\\\r\n]/g, '_');
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: options.bucket,
          Key: key,
          ResponseContentDisposition: `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        }),
        { expiresIn: DOWNLOAD_URL_TTL_S },
      );
    },
    async read(key) {
      const response = await client.send(
        new GetObjectCommand({ Bucket: options.bucket, Key: key }),
      );
      if (!response.Body) throw new Error(`empty S3 object ${key}`);
      return Buffer.from(await response.Body.transformToByteArray());
    },
  };
}

/** Raster images safe to show inline. SVG is excluded: it can carry script. */
export const INLINE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
