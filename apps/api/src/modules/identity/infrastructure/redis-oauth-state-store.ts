import { z } from 'zod';
import { oauthProviderName } from '@team-os/shared';
import type { RedisClient } from '../../../infrastructure/redis.js';
import {
  OAUTH_STATE_TTL_SECONDS,
  type OAuthStateStore,
  type PendingOAuthLogin,
} from '../domain/ports.js';

const pendingLogin = z.object({
  provider: oauthProviderName,
  codeVerifier: z.string(),
  returnTo: z.string(),
});

export class RedisOAuthStateStore implements OAuthStateStore {
  constructor(private readonly redis: RedisClient) {}

  async save(state: string, pending: PendingOAuthLogin) {
    await this.redis.set(
      `oauth:state:${state}`,
      JSON.stringify(pending),
      'EX',
      OAUTH_STATE_TTL_SECONDS,
    );
  }

  async consume(state: string) {
    // GETDEL is atomic, so two requests can't both consume the same state.
    const raw = await this.redis.getdel(`oauth:state:${state}`);
    if (!raw) return null;
    const parsed = pendingLogin.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  }
}
