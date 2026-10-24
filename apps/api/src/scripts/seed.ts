import { pino } from 'pino';
import type { TaskPriority } from '@team-os/shared';
import { loadConfig } from '../config.js';
import { createContainer } from '../container.js';
import { createDb } from '../infrastructure/db/client.js';
import { createRedis } from '../infrastructure/redis.js';

// Creates a demo workspace ("Acme") with people, projects, labels, tasks, dependencies and
// comments, all through the normal use cases (so permissions, events and activity apply).
// Sign in with dev login as any of the emails below. Re-running does nothing if it exists.

const config = loadConfig();
if (config.NODE_ENV === 'production') throw new Error('Refusing to seed a production database');

const { db, sql } = createDb(config.DATABASE_URL);
const redis = createRedis(config.REDIS_URL);
await redis.connect();
const c = createContainer({ config, db, redis, log: pino({ level: 'warn' }) });

const existing = await sql`select id from workspaces where slug = 'acme-demo'`;
if (existing.length) {
  console.log('Demo workspace already exists. Sign in as alice@acme.test');
  process.exit(0);
}

const person = async (email: string, name: string) =>
  (await c.identity.devSignIn.execute({ email, name })).user;
const alice = await person('alice@acme.test', 'Alice Chen');
const bob = await person('bob@acme.test', 'Bob Martinez');
const carol = await person('carol@acme.test', 'Carol Singh');
const dan = await person('dan@acme.test', 'Dan Okafor');

const ws = await c.workspaces.create.execute(alice.id, { name: 'Acme', slug: 'acme-demo' });
await c.uow.repos.members.add(ws.id, bob.id, 'member');
await c.uow.repos.members.add(ws.id, carol.id, 'admin');
await c.uow.repos.members.add(ws.id, dan.id, 'member');

const label = (name: string, color: string) =>
  c.labels.create.execute(alice.id, ws.id, { name, color });
const bug = await label('Bug', '#ef4444');
const feature = await label('Feature', '#6366f1');
const design = await label('Design', '#ec4899');
const infra = await label('Infra', '#0ea5e9');

const web = await c.projects.create.execute(alice.id, ws.id, {
  name: 'Web App',
  key: 'WEB',
  description: 'The customer-facing web application.',
  visibility: 'workspace',
});
await c.projects.create.execute(carol.id, ws.id, {
  name: 'Platform',
  key: 'PLAT',
  description: 'APIs, infrastructure and reliability.',
  visibility: 'workspace',
});
const status = (name: string) => web.statuses.find((s) => s.name === name)!.id;

type Seed = {
  title: string;
  status: string;
  priority?: TaskPriority;
  assignee?: { id: string };
  labels?: { id: string }[];
  due?: number; // days from today
  estimate?: number;
  description?: string;
};

const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const tasks: Record<string, string> = {};
const seed = async (key: string, s: Seed, parentId: string | null = null) => {
  const t = await c.tasks.create.execute(alice.id, web.id, {
    title: s.title,
    description: s.description ?? '',
    statusId: status(s.status),
    priority: s.priority ?? 'none',
    assigneeId: s.assignee?.id ?? null,
    labelIds: (s.labels ?? []).map((l) => l.id),
    dueDate: s.due === undefined ? null : day(s.due),
    estimate: s.estimate ?? null,
    parentId,
  });
  tasks[key] = t.id;
  return t;
};

await seed('auth', {
  title: 'Redesign sign-in page',
  status: 'Done',
  priority: 'high',
  assignee: carol,
  labels: [design],
  estimate: 3,
});
await seed('api', {
  title: 'Design the billing API',
  status: 'Done',
  priority: 'high',
  assignee: bob,
  labels: [feature],
  estimate: 5,
});
await seed('billing', {
  title: 'Build billing settings page',
  status: 'In Progress',
  priority: 'urgent',
  assignee: alice,
  labels: [feature],
  due: 2,
  estimate: 8,
  description:
    'Customers can update their plan, payment method and invoices from Settings → Billing.',
});
await seed(
  'invoices',
  {
    title: 'Invoice history table',
    status: 'Todo',
    priority: 'medium',
    assignee: dan,
    labels: [feature],
    estimate: 3,
  },
  tasks.billing,
);
await seed(
  'card',
  {
    title: 'Update card with Stripe Elements',
    status: 'In Progress',
    priority: 'high',
    assignee: alice,
    estimate: 3,
  },
  tasks.billing,
);
await seed('safari', {
  title: 'Dropdowns clip on Safari 18',
  status: 'In Review',
  priority: 'high',
  assignee: dan,
  labels: [bug],
  estimate: 1,
});
await seed('perf', {
  title: 'Board takes 3s to load with 500 tasks',
  status: 'Todo',
  priority: 'urgent',
  assignee: bob,
  labels: [bug],
  due: -1,
  estimate: 5,
});
await seed('dark', {
  title: 'Dark mode polish pass',
  status: 'Todo',
  priority: 'low',
  assignee: carol,
  labels: [design],
  estimate: 2,
});
await seed('onboarding', {
  title: 'New workspace onboarding checklist',
  status: 'Backlog',
  priority: 'medium',
  labels: [feature, design],
  estimate: 5,
});
await seed('export', {
  title: 'Export tasks to CSV',
  status: 'Backlog',
  priority: 'low',
  labels: [feature],
});
await seed('cdn', {
  title: 'Move static assets to the CDN',
  status: 'In Review',
  priority: 'medium',
  assignee: bob,
  labels: [infra],
  due: 5,
  estimate: 2,
});
await seed('a11y', {
  title: 'Keyboard navigation on the board',
  status: 'Todo',
  priority: 'medium',
  assignee: dan,
  estimate: 3,
});
await seed('launch', {
  title: 'Launch billing to all customers',
  status: 'Backlog',
  priority: 'high',
  assignee: alice,
  due: 10,
  estimate: 1,
});

await c.tasks.addDependency.execute(alice.id, tasks.billing!, tasks.api!);
await c.tasks.addDependency.execute(alice.id, tasks.launch!, tasks.billing!);
await c.tasks.addDependency.execute(alice.id, tasks.launch!, tasks.perf!);

await c.tasks.addComment.execute(
  bob.id,
  tasks.billing!,
  `<@${alice.id}> the billing API is live on staging, endpoints are in the docs.`,
);
await c.tasks.addComment.execute(
  alice.id,
  tasks.billing!,
  'Great, wiring up the plan picker today.',
);
await c.tasks.addComment.execute(
  carol.id,
  tasks.safari!,
  `Repro'd on 18.1 too. <@${dan.id}> can you check overflow on the popover root?`,
);

console.log(
  'Seeded the "Acme" workspace. Sign in with dev login as alice@acme.test (or bob/carol/dan@acme.test).',
);
await c.close();
await redis.quit();
await sql.end();
