import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** A URL-safe random token with 256 bits of entropy. */
export const randomToken = () => randomBytes(32).toString('base64url');

/** Tokens are stored hashed so a database or Redis dump does not expose usable credentials. */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
