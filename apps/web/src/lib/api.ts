import type { z } from 'zod';
import { errorResponse } from '@team-os/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// Set from /auth/me and sent on every state-changing request.
let csrfToken: string | null = null;
export const setCsrfToken = (token: string | null) => {
  csrfToken = token;
};

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Calls the API (proxied at /api) and validates the response with `schema`. */
export async function api<S extends z.ZodType>(
  path: string,
  schema: S | null,
  init: { method?: Method; body?: unknown } = {},
): Promise<z.infer<S>> {
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['x-csrf-token'] = csrfToken;

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError(0, 'network_error', 'Could not reach the server. Check your connection.');
  }

  if (!res.ok) {
    const parsed = errorResponse.safeParse(await res.json().catch(() => null));
    throw parsed.success
      ? new ApiError(res.status, parsed.data.error.code, parsed.data.error.message)
      : new ApiError(res.status, 'unknown', `Request failed (${res.status})`);
  }
  if (res.status === 204 || !schema) return undefined as z.infer<S>;
  return schema.parse(await res.json());
}

export const errorMessage = (err: unknown) =>
  err instanceof ApiError ? err.message : 'Something went wrong';

/**
 * POSTs to a Server-Sent Events endpoint and yields each `data:` event, validated with
 * `schema`. Errors before the stream starts throw ApiError, like `api`.
 */
export async function* apiStream<S extends z.ZodType>(
  path: string,
  schema: S,
  body: unknown,
  signal?: AbortSignal,
): AsyncGenerator<z.infer<S>> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrfToken) headers['x-csrf-token'] = csrfToken;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: 'POST',
      headers,
      credentials: 'same-origin',
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new ApiError(0, 'network_error', 'Could not reach the server. Check your connection.');
  }
  if (!res.ok || !res.body) {
    const parsed = errorResponse.safeParse(await res.json().catch(() => null));
    throw parsed.success
      ? new ApiError(res.status, parsed.data.error.code, parsed.data.error.message)
      : new ApiError(res.status, 'unknown', `Request failed (${res.status})`);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    let end: number;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (chunk.startsWith('data: ')) yield schema.parse(JSON.parse(chunk.slice(6)));
    }
  }
}
