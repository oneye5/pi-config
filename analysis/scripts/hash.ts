import * as crypto from 'node:crypto';

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function hashToPrefix(value: string, length = 12): string {
  return sha256Hex(value).slice(0, length);
}

export function existingHashPrefix(value: string | null | undefined, length = 12): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, Math.min(length, trimmed.length)) : null;
}
