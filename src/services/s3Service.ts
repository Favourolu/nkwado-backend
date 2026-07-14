import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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

// Server-trusted content type, resolved from the file's extension rather than the
// client-supplied multer mimetype header — the upload middleware's fileFilter already
// restricts extensions to this same allowlist, so this is a closed mapping, not a guess.
const SAFE_CONTENT_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

function safeContentType(originalname: string): string {
  const ext = path.extname(originalname).toLowerCase();
  return SAFE_CONTENT_TYPES[ext] || 'application/octet-stream';
}

/**
 * Uploads a file and returns its storage key (not a public URL). Objects are no longer
 * written with public-read semantics or a browser-renderable Content-Type taken from the
 * client — see getSignedDownloadUrl for how a caller turns this key into a short-lived,
 * download-forcing link when the file actually needs to be viewed.
 */
export async function uploadToS3(file: UploadableFile, folder: string): Promise<string> {
  const key = `${folder}/${randomUUID()}-${file.originalname.replace(/\s+/g, '_')}`;

  if (useLocalFallback) {
    const destDir = path.join(LOCAL_UPLOAD_DIR, folder);
    fs.mkdirSync(destDir, { recursive: true });
    const destPath = path.join(LOCAL_UPLOAD_DIR, key);
    fs.writeFileSync(destPath, file.buffer);
    return key;
  }

  await s3!.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: safeContentType(file.originalname),
      ContentDisposition: 'attachment',
    })
  );

  return key;
}

export async function uploadManyToS3(files: UploadableFile[], folder: string): Promise<string[]> {
  return Promise.all(files.map((file) => uploadToS3(file, folder)));
}

const DEFAULT_SIGNED_URL_TTL_SECONDS = 15 * 60;

/**
 * Resolves a stored object key to a short-lived, authenticated download link. Replaces the
 * old permanent public `https://bucket.s3.region.amazonaws.com/key` scheme — nothing served
 * through this is publicly reachable without a fresh call here, and it's still forced to
 * download (ContentDisposition set at upload time) rather than render in a browser tab.
 */
export async function getSignedDownloadUrl(
  key: string | null | undefined,
  expiresInSeconds: number = DEFAULT_SIGNED_URL_TTL_SECONDS
): Promise<string | null> {
  if (!key) return null;

  if (useLocalFallback) {
    return `local://uploads/${key}`;
  }

  return getSignedUrl(s3!, new GetObjectCommand({ Bucket: BUCKET, Key: key }), {
    expiresIn: expiresInSeconds,
  });
}

export async function getSignedDownloadUrls(keys: string[]): Promise<string[]> {
  const urls = await Promise.all(keys.map((key) => getSignedDownloadUrl(key)));
  return urls.filter((url): url is string => url !== null);
}
