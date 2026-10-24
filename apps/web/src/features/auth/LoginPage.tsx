import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, GitBranch, Sparkles, Zap } from 'lucide-react';
import { useState } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { providersResponse, user } from '@team-os/shared';
import { Logo } from '../../components/icons';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { PageSpinner } from '../../components/ui/spinner';
import { api, errorMessage } from '../../lib/api';
import { keys } from '../../lib/keys';
import { useMe } from './hooks';

const errorMessages: Record<string, string> = {
  oauth_denied: 'Sign-in was cancelled.',
  invalid_state: 'Your sign-in link expired. Please try again.',
  oauth_failed: 'The sign-in provider returned an error. Please try again.',
  email_unverified: 'Your email address is not verified with that provider.',
};

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z"
      />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8z" />
      <path
        fill="#EA4335"
        d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z"
      />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
      <path d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.1c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.7 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.7-2.8 5.7-5.5 6 .4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5z" />
    </svg>
  );
}

const highlights = [
  {
    icon: Zap,
    title: 'Real-time by default',
    text: 'Every change appears instantly for your whole team.',
  },
  {
    icon: GitBranch,
    title: 'Dependencies that matter',
    text: 'See what blocks what, and the critical path to ship.',
  },
  {
    icon: Sparkles,
    title: 'AI that helps you act',
    text: 'Summaries, search and actions across your workspace.',
  },
];

export function LoginPage() {
  const me = useMe();
  const [params] = useSearchParams();
  const returnTo = params.get('returnTo') ?? '/';
  const error = params.get('error');
  const providers = useQuery({
    queryKey: keys.providers,
    queryFn: () => api('/auth/providers', providersResponse),
  });
  const [email, setEmail] = useState('');
  const [devError, setDevError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (me.data) return <Navigate to={returnTo} replace />;
  if (me.isPending || providers.isPending) return <PageSpinner />;

  async function devLogin(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setDevError(null);
    try {
      await api('/auth/dev-login', user, { method: 'POST', body: { email } });
      window.location.assign(returnTo);
    } catch (err) {
      setDevError(errorMessage(err));
      setSubmitting(false);
    }
  }

  const labels = { google: 'Continue with Google', github: 'Continue with GitHub' } as const;
  const icons = { google: <GoogleIcon />, github: <GitHubIcon /> } as const;

  return (
    <div className="grid min-h-full lg:grid-cols-[1fr_1.1fr]">
      <main className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[360px]">
          <Logo className="size-9" />
          <h1 className="mt-6 text-2xl font-semibold tracking-tight">Welcome to Team OS</h1>
          <p className="mt-1.5 text-[14px] text-fg-muted">
            Sign in to plan, track and ship together.
          </p>

          {error && (
            <div className="mt-6 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-[13px] text-danger">
              {errorMessages[error] ?? 'Sign-in failed.'}
            </div>
          )}

          <div className="mt-8 space-y-2.5">
            {providers.data?.providers.map((p) => (
              <a
                key={p}
                href={`/api/auth/${p}/start?returnTo=${encodeURIComponent(returnTo)}`}
                className="flex h-10 w-full items-center justify-center gap-2.5 rounded-lg border border-border bg-surface text-[14px] font-medium shadow-sm transition-colors hover:bg-hover"
              >
                {icons[p]}
                {labels[p]}
              </a>
            ))}
          </div>

          {providers.data?.devLogin && (
            <form onSubmit={devLogin} className="mt-6">
              {providers.data.providers.length > 0 && (
                <div className="mb-6 flex items-center gap-3 text-xs text-fg-subtle">
                  <span className="h-px flex-1 bg-border" />
                  or
                  <span className="h-px flex-1 bg-border" />
                </div>
              )}
              <label className="text-[13px] font-medium" htmlFor="email">
                Email
              </label>
              <Input
                id="email"
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="mt-1.5 h-10 text-[14px]"
              />
              <Button
                type="submit"
                variant="primary"
                size="lg"
                loading={submitting}
                className="mt-3 w-full justify-center"
              >
                Continue with email
              </Button>
              <p className="mt-3 text-xs text-fg-subtle">
                Development sign-in. Disabled in production.
              </p>
              {devError && <p className="mt-2 text-[13px] text-danger">{devError}</p>}
            </form>
          )}

          {providers.data?.providers.length === 0 && !providers.data.devLogin && (
            <p className="mt-8 text-[13px] text-fg-muted">No sign-in methods are configured yet.</p>
          )}
        </div>
      </main>

      <aside className="relative hidden overflow-hidden border-l border-border bg-sidebar lg:flex lg:items-center lg:justify-center">
        <div
          className="absolute inset-0 opacity-60"
          style={{
            background:
              'radial-gradient(60% 50% at 70% 20%, color-mix(in srgb, var(--accent) 22%, transparent), transparent), radial-gradient(50% 40% at 20% 90%, color-mix(in srgb, var(--accent) 14%, transparent), transparent)',
          }}
        />
        <div className="relative max-w-md px-12">
          <div className="rounded-2xl border border-border bg-surface/80 p-5 shadow-pop backdrop-blur">
            <div className="flex items-center gap-2 text-xs text-fg-subtle">
              <span className="font-mono">ENG-42</span> · In Progress
            </div>
            <div className="mt-2 text-[15px] font-medium">Ship real-time collaboration</div>
            <div className="mt-4 space-y-2">
              {[
                'Outbox relay with leader election',
                'Presence across instances',
                'Catch-up after reconnect',
              ].map((t) => (
                <div key={t} className="flex items-center gap-2 text-[13px] text-fg-muted">
                  <CheckCircle2 className="size-4 text-success" />
                  {t}
                </div>
              ))}
            </div>
          </div>
          <ul className="mt-10 space-y-6">
            {highlights.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-accent">
                  <Icon className="size-4" />
                </span>
                <div>
                  <div className="text-[14px] font-medium">{title}</div>
                  <div className="text-[13px] text-fg-muted">{text}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
