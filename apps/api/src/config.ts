import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    API_PORT: z.coerce.number().int().positive().default(4000),
    /** Origin of the web app. OAuth callbacks and invite links point here. */
    WEB_ORIGIN: z.url().default('http://localhost:5173'),
    /** Public base URL of the API as seen by browsers (the dev proxy serves it under /api). */
    API_PUBLIC_URL: z.url().optional(),
    DATABASE_URL: z.url(),
    REDIS_URL: z.url(),

    SESSION_TTL_DAYS: z.coerce.number().positive().default(14),
    SESSION_MAX_AGE_DAYS: z.coerce.number().positive().default(30),

    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    GITHUB_CLIENT_ID: z.string().min(1).optional(),
    GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
    /** Email-only sign-in for local development before OAuth apps are set up. */
    DEV_LOGIN_ENABLED: booleanString,

    /** Embeddings for semantic search. 'none' keeps search keyword-only. */
    EMBEDDINGS_PROVIDER: z.enum(['none', 'voyage']).default('none'),
    VOYAGE_API_KEY: z.string().min(1).optional(),
    EMBEDDINGS_MODEL: z.string().min(1).default('voyage-3.5'),

    /** Claude API key. Without it, AI features report that they're not configured. */
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    AI_MODEL: z.string().min(1).default('claude-opus-5-5'),
    /** Per-user requests per minute for AI endpoints (they're slow and cost money). */
    AI_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),

    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  })
  .refine((c) => !(c.NODE_ENV === 'production' && c.DEV_LOGIN_ENABLED), {
    message: 'DEV_LOGIN_ENABLED must not be set in production',
    path: ['DEV_LOGIN_ENABLED'],
  })
  .refine((c) => Boolean(c.GOOGLE_CLIENT_ID) === Boolean(c.GOOGLE_CLIENT_SECRET), {
    message: 'Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither',
    path: ['GOOGLE_CLIENT_SECRET'],
  })
  .refine((c) => Boolean(c.GITHUB_CLIENT_ID) === Boolean(c.GITHUB_CLIENT_SECRET), {
    message: 'Set both GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET, or neither',
    path: ['GITHUB_CLIENT_SECRET'],
  })
  .refine((c) => c.EMBEDDINGS_PROVIDER !== 'voyage' || Boolean(c.VOYAGE_API_KEY), {
    message: 'Set VOYAGE_API_KEY to use EMBEDDINGS_PROVIDER=voyage',
    path: ['VOYAGE_API_KEY'],
  })
  .transform((c) => ({ ...c, API_PUBLIC_URL: c.API_PUBLIC_URL ?? `${c.WEB_ORIGIN}/api` }));

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Treat empty strings (e.g. `GOOGLE_CLIENT_ID=` in .env) as unset.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    // Fail fast at startup with a readable list of what's missing or invalid.
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
