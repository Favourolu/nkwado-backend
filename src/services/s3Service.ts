import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

const BUCKET = process.env.AWS_S3_BUCKET as string;
const REGION = process.env.AWS_REGION || 'eu-west-1';
const ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;

// Explicit switch (rather than guessing from credential contents, which is unreliable
// in sandboxed/proxied environments) between real S3 and a local-disk fallback for
// environments without real AWS access. Defaults to "s3".
const useLocalFallback = process.env.FILE_STORAGE_DRIVER === 'local';

const s3 = useLocalFallback
  ? null
  : new S3Client({
      region: REGION,
      credentials: {
        accessKeyId: ACCESS_KEY_ID as string,
        secretAccessKey: SECRET_ACCESS_KEY as string,
      },
    });

const LOCAL_UPLOAD_DIR = path.join(process.cwd(), 'uploads');

export interface UploadableFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

export async function uploadToS3(file: UploadableFile, folder: string): Promise<string> {
  const key = `${folder}/${randomUUID()}-${file.originalname.replace(/\s+/g, '_')}`;

  if (useLocalFallback) {
    const destDir = path.join(LOCAL_UPLOAD_DIR, folder);
    fs.mkdirSync(destDir, { recursive: true });
    const destPath = path.join(LOCAL_UPLOAD_DIR, key);
    fs.writeFileSync(destPath, file.buffer);
    return `local://uploads/${key}`;
  }

  await s3!.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    })
  );

  return `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;
}

export async function uploadManyToS3(files: UploadableFile[], folder: string): Promise<string[]> {
  return Promise.all(files.map((file) => uploadToS3(file, folder)));
}
