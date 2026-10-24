import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Clock, TokenService } from '../application/ports.js';

export class CryptoTokenService implements TokenService {
  /** A URL-safe random token with 256 bits of entropy. */
  generate() {
    return randomBytes(32).toString('base64url');
  }

  shortId() {
    return randomBytes(3).toString('hex');
  }

  /** Tokens are stored hashed so a database or Redis dump does not expose usable credentials. */
  hash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  equals(a: string, b: string) {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    return ab.length === bb.length && timingSafeEqual(ab, bb);
  }
}

export const systemClock: Clock = { now: () => new Date() };
