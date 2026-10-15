import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { MailObjectStore } from './process';

// Raw inbound mail and extracted attachments in the mail bucket (brief §3 item 6). The app's
// IAM policy allows reading inbound/ and reading/writing attachments/ only.
export function s3MailStore(options: {
  region: string;
  bucket: string;
  client?: S3Client;
}): MailObjectStore {
  const client = options.client ?? new S3Client({ region: options.region });
  return {
    async getRaw(bucket, key) {
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!response.Body) throw new Error(`empty S3 object ${key}`);
      return Buffer.from(await response.Body.transformToByteArray());
    },
    async putAttachment(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: options.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ServerSideEncryption: 'AES256',
        }),
      );
    },
  };
}
