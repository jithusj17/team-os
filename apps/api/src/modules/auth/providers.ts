import { decodeIdToken, GitHub, Google } from 'arctic';
import { z } from 'zod';
import type { OAuthProviderName } from '@team-os/shared';
import type { Config } from '../../config.js';

export interface OAuthProfile {
  providerUserId: string;
  email: string;
  /** Only verified emails may be used to link to an existing account. */
  emailVerified: boolean;
  name: string;
  avatarUrl: string | null;
}

export interface OAuthProvider {
  name: OAuthProviderName;
  authorizationUrl(state: string, codeVerifier: string): URL;
  exchange(code: string, codeVerifier: string): Promise<OAuthProfile>;
}

const googleClaims = z.object({
  sub: z.string(),
  email: z.email(),
  email_verified: z.boolean().default(false),
  name: z.string().optional(),
  picture: z.string().optional(),
});

class GoogleProvider implements OAuthProvider {
  readonly name = 'google' as const;
  private readonly client: Google;

  constructor(clientId: string, clientSecret: string, redirectUri: string) {
    this.client = new Google(clientId, clientSecret, redirectUri);
  }

  authorizationUrl(state: string, codeVerifier: string) {
    return this.client.createAuthorizationURL(state, codeVerifier, ['openid', 'email', 'profile']);
  }

  async exchange(code: string, codeVerifier: string): Promise<OAuthProfile> {
    const tokens = await this.client.validateAuthorizationCode(code, codeVerifier);
    // The ID token comes straight from Google's token endpoint over TLS, so per OIDC
    // its signature does not need to be re-verified here.
    const claims = googleClaims.parse(decodeIdToken(tokens.idToken()));
    return {
      providerUserId: claims.sub,
      email: claims.email,
      emailVerified: claims.email_verified,
      name: claims.name ?? claims.email.split('@')[0]!,
      avatarUrl: claims.picture ?? null,
    };
  }
}

const githubUser = z.object({
  id: z.number(),
  login: z.string(),
  name: z.string().nullable(),
  avatar_url: z.string().nullable(),
});
const githubEmails = z.array(
  z.object({ email: z.string(), primary: z.boolean(), verified: z.boolean() }),
);

class GitHubProvider implements OAuthProvider {
  readonly name = 'github' as const;
  private readonly client: GitHub;

  constructor(clientId: string, clientSecret: string, redirectUri: string) {
    this.client = new GitHub(clientId, clientSecret, redirectUri);
  }

  // GitHub OAuth apps do not support PKCE; the state parameter protects the flow.
  authorizationUrl(state: string) {
    return this.client.createAuthorizationURL(state, ['read:user', 'user:email']);
  }

  async exchange(code: string): Promise<OAuthProfile> {
    const tokens = await this.client.validateAuthorizationCode(code);
    const headers = {
      Authorization: `Bearer ${tokens.accessToken()}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'team-os',
    };
    const [userRes, emailsRes] = await Promise.all([
      fetch('https://api.github.com/user', { headers }),
      fetch('https://api.github.com/user/emails', { headers }),
    ]);
    if (!userRes.ok || !emailsRes.ok) {
      throw new Error(`GitHub API error: user ${userRes.status}, emails ${emailsRes.status}`);
    }
    const profile = githubUser.parse(await userRes.json());
    const emails = githubEmails.parse(await emailsRes.json());
    const primary = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
    if (!primary) throw new Error('GitHub account has no verified email');
    return {
      providerUserId: String(profile.id),
      email: primary.email,
      emailVerified: true,
      name: profile.name ?? profile.login,
      avatarUrl: profile.avatar_url,
    };
  }
}

/** Providers configured through env vars. Unconfigured providers are simply not offered. */
export function providersFromConfig(config: Config): OAuthProvider[] {
  const callback = (name: OAuthProviderName) => `${config.API_PUBLIC_URL}/auth/${name}/callback`;
  const providers: OAuthProvider[] = [];
  if (config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET) {
    providers.push(
      new GoogleProvider(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET, callback('google')),
    );
  }
  if (config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET) {
    providers.push(
      new GitHubProvider(config.GITHUB_CLIENT_ID, config.GITHUB_CLIENT_SECRET, callback('github')),
    );
  }
  return providers;
}
