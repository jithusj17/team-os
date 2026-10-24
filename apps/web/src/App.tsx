import { useQuery } from '@tanstack/react-query';
import { healthResponse } from '@team-os/shared';

async function fetchHealth() {
  const res = await fetch('/api/health');
  // /health returns 503 with a valid body when degraded, so parse either way.
  return healthResponse.parse(await res.json());
}

export function App() {
  const health = useQuery({ queryKey: ['health'], queryFn: fetchHealth, refetchInterval: 10_000 });

  return (
    <main className="mx-auto max-w-xl p-8 font-sans">
      <h1 className="text-2xl font-semibold">Team OS</h1>
      <section className="mt-6 rounded-lg border border-gray-200 p-4">
        <h2 className="text-sm font-medium text-gray-500">System status</h2>
        {health.isPending && <p className="mt-2">Checking…</p>}
        {health.isError && <p className="mt-2 text-red-600">API unreachable</p>}
        {health.data && (
          <ul className="mt-2 space-y-1">
            <li>Overall: {health.data.status}</li>
            <li>Database: {health.data.checks.database}</li>
            <li>Redis: {health.data.checks.redis}</li>
          </ul>
        )}
      </section>
    </main>
  );
}
