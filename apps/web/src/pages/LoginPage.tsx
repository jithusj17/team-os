import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { providersResponse, user } from '@team-os/shared';
import { api, ApiError } from '../api';

const errorMessages: Record<string, string> = {
  oauth_denied: 'Sign-in was cancelled.',
  invalid_state: 'Your sign-in link expired. Please try again.',
  oauth_failed: 'The sign-in provider returned an error. Please try again.',
  email_unverified: 'Your email address is not verified with that provider.',
};

const providerLabels = { google: 'Google', github: 'GitHub' } as const;

export function LoginPage() {
  const params = new URLSearchParams(window.location.search);
  const returnTo = params.get('returnTo') ?? '/';
  const error = params.get('error');
  const providers = useQuery({
    queryKey: ['providers'],
    queryFn: () => api('/auth/providers', providersResponse),
  });
  const [email, setEmail] = useState('');
  const [devError, setDevError] = useState<string | null>(null);

  async function devLogin(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api('/auth/dev-login', user, { method: 'POST', body: { email } });
      window.location.assign(returnTo);
    } catch (err) {
      setDevError(err instanceof ApiError ? err.message : 'Sign-in failed');
    }
  }

  return (
    <main className="mx-auto mt-24 max-w-sm space-y-6 p-8">
      <h1 className="text-2xl font-semibold">Sign in to Team OS</h1>
      {error && (
        <p className="rounded bg-red-50 p-3 text-sm text-red-700">
          {errorMessages[error] ?? 'Sign-in failed.'}
        </p>
      )}

      <div className="space-y-2">
        {providers.data?.providers.map((p) => (
          <a
            key={p}
            href={`/api/auth/${p}/start?returnTo=${encodeURIComponent(returnTo)}`}
            className="block rounded border border-gray-300 px-4 py-2 text-center hover:bg-gray-50"
          >
            Continue with {providerLabels[p]}
          </a>
        ))}
        {providers.data && providers.data.providers.length === 0 && !providers.data.devLogin && (
          <p className="text-sm text-gray-500">No sign-in methods are configured.</p>
        )}
      </div>

      {providers.data?.devLogin && (
        <form onSubmit={devLogin} className="space-y-2 border-t pt-6">
          <p className="text-xs font-medium tracking-wide text-amber-700 uppercase">
            Development sign-in
          </p>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded border border-gray-300 px-3 py-2"
          />
          <button className="w-full rounded bg-gray-900 px-4 py-2 text-white">Sign in</button>
          {devError && <p className="text-sm text-red-600">{devError}</p>}
        </form>
      )}
    </main>
  );
}
