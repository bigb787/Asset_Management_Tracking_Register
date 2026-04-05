import { randomUUID } from 'crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const BUCKET = process.env.S3_EXPORTS_BUCKET!;
const REGION = process.env.AWS_REGION ?? 'ap-south-1';

const s3 = new S3Client({ region: REGION });

export const LEAVER_EVIDENCE_PREFIX = 'leavers-evidence/';

const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

export function sanitizeFileName(name: string): string {
  const base = name.replace(/[/\\]/g, '').replace(/^\.+/, '') || 'file';
  return base.slice(0, 180);
}

export function isAllowedEvidenceContentType(ct: string): boolean {
  const c = (ct || '').split(';')[0].trim().toLowerCase();
  return ALLOWED_TYPES.has(c);
}

export async function createLeaverEvidencePresignedPut(
  fileName: string,
  contentType: string,
): Promise<{ key: string; uploadUrl: string }> {
  const safe = sanitizeFileName(fileName);
  const key = `${LEAVER_EVIDENCE_PREFIX}${randomUUID()}/${safe}`;
  const ct = (contentType || 'application/octet-stream').split(';')[0].trim();
  const cmd = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: ct,
  });
  const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 3600 });
  return { key, uploadUrl };
}

/** Stable HTTPS URL (bucket policy: public read for leavers-evidence/* only). */
export function publicLeaverEvidenceUrl(key: string): string {
  assertLeaverEvidenceKey(key);
  const path = key.split('/').map((seg) => encodeURIComponent(seg)).join('/');
  return `https://${BUCKET}.s3.${REGION}.amazonaws.com/${path}`;
}

export function assertLeaverEvidenceKey(key: string): void {
  if (
    !key ||
    !key.startsWith(LEAVER_EVIDENCE_PREFIX) ||
    key.includes('..') ||
    key.includes('\0')
  ) {
    throw new Error('Invalid key');
  }
}
