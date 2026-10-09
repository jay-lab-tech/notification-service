import { createHash, randomBytes } from 'node:crypto';

const API_KEY_PREFIX = 'nsk_live_';

export function createApiKey(): { raw: string; hash: string } {
  const raw = `${API_KEY_PREFIX}${randomBytes(32).toString('hex')}`;
  return { raw, hash: hashApiKey(raw) };
}

export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
