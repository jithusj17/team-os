# Team OS

Read `SPEC.md` for what we're building and `PLAN.md` for the phase plan. Work on one phase at a time, in order.

## Stack

npm workspaces monorepo: `apps/api` (backend), `apps/web` (React + Vite), `packages/shared` (types, Zod schemas, permission rules).
PostgreSQL 16 + pgvector via Drizzle, Redis, BullMQ, Socket.IO, Claude API.

`apps/api` has two entry points sharing one codebase: `src/server.ts` (HTTP + WebSocket) and `src/worker.ts` (BullMQ jobs + outbox relay).

## Backend architecture: clean architecture + repository pattern

Each API module lives in `apps/api/src/modules/<name>/` with four layers. Dependencies point inward only (ESLint enforces this):

| Layer             | Contains                                                                                          | May import                         |
| ----------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `domain/`         | Entities, business rules (pure functions), repository and port **interfaces**                     | `@team-os/shared`, `shared/domain` |
| `application/`    | Use cases: one class per use case with an `execute()` method; authorization via `WorkspaceAccess` | domain, `shared/application`       |
| `infrastructure/` | Drizzle repositories, Redis stores, OAuth, external APIs: implement domain interfaces             | anything                           |
| `http/`           | Fastify routes: validate with Zod, call a use case, return its result                             | application (via `app.container`)  |

- `src/container.ts` is the composition root: the only place that chooses implementations.
- Transactions: use cases take `UnitOfWork<{ ...repos they need }>` and call `uow.transaction(repos => ...)`. Plain reads use `uow.repos`.
- New repositories: add the interface in `domain/ports.ts`, the Drizzle class in `infrastructure/`, and register it in `infrastructure/db/drizzle-unit-of-work.ts`. Add an in-memory version in `test/fakes/in-memory.ts` when a use-case unit test needs it.
- Authorization: workspace-scoped use cases call `WorkspaceAccess.authorize`; project- and task-scoped ones call `ProjectAccess.authorize` / `TaskAccess.authorize`. Rules live in `packages/shared/src/permissions.ts`.
- Errors: throw `DomainError` helpers (`notFound`, `forbidden`, `conflict`, ...) from `shared/domain/errors.ts`; never HTTP status codes outside `http/`.
- Tests: use-case logic is unit tested with in-memory repositories (`test/unit/`); HTTP + database behaviour is integration tested (`test/*.test.ts`).

## Events and real-time

- Every state change appends an event with `repos.events.append(...)` **inside the same transaction** (transactional outbox). Never publish directly from a use case.
- Events get a gap-free per-workspace `seq`. Payload = the changed entity as clients see it, or `{ id }` for deletions. Set `projectId` for project-scoped events so they only reach that project's room.
- If a change can reduce someone's access, put `{ userId, accessChanged: true }` in the payload; the publisher disconnects them so they re-authorize.
- The worker's `OutboxRelay` (single elected leader) publishes events via Redis to every API instance. Clients catch up with `GET /workspaces/:id/events?after=<seq>`.
- Socket room joins are authorized with `RealtimeAccess`, using the same rules as HTTP.

## Background jobs

- Job handlers live in `src/jobs/` (an interface layer like `http/`): parse the payload, call a use case.
- The relay also enqueues every event on the `domain-events` queue (job id `workspaceId_seq`); background reactions such as notifications subscribe there instead of being called from use cases.
- Handlers must be idempotent (jobs retry). Notifications use a `dedupeKey` per user for this.
- Jobs that fail every retry go to the `dead-letter` queue with their error (`attachDeadLetter`).
- Recurring jobs are declared in `SCHEDULES` and registered with `upsertJobScheduler` on worker start.

## Commands

- `docker compose up -d` — start Postgres + Redis
- `npm run dev` — run API server, worker and web app
- `npm test` — run all tests
- `npm run lint` / `npm run typecheck`
- `npm run db:migrate` / `npm run db:generate`

## Rules

- TypeScript strict; no `any` without a comment explaining why.
- Validate every request body/query with Zod schemas from `packages/shared`.
- Every data access is scoped by `workspaceId`. Every endpoint, socket room join, search, and AI retrieval goes through the central permission check.
- Side effects (notifications, indexing, emails, AI jobs) go to a queue, not the request path.
- Schema changes go through Drizzle migrations; never edit an applied migration.
- Secrets come from env vars (`.env`, never committed); update `.env.example` when adding one.
- Before saying a phase is done: run lint, typecheck, and tests, and report the results.
- Write integration tests for permissions and business rules, not just happy paths.
