# Team OS

Read `SPEC.md` for what we're building and `PLAN.md` for the phase plan. Work on one phase at a time; don't start the next phase unless asked.

## Stack

npm workspaces monorepo: `apps/api` (Fastify), `apps/worker` (BullMQ), `apps/web` (React + Vite), `packages/shared` (types, Zod schemas).
PostgreSQL 16 + pgvector via Drizzle, Redis, Socket.IO, Claude API.

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
- New repositories: add the interface in `domain/ports.ts`, the Drizzle class in `infrastructure/`, register it in `infrastructure/db/drizzle-unit-of-work.ts`, and add an in-memory version in `test/fakes/in-memory.ts`.
- Errors: throw `DomainError` helpers (`notFound`, `forbidden`, `conflict`, ...) from `shared/domain/errors.ts`; never HTTP status codes outside `http/`.
- Tests: use-case logic is unit tested with in-memory repositories (`test/unit/`); HTTP + database behaviour is integration tested (`test/*.test.ts`).

## Commands

- `docker compose up -d` — start Postgres + Redis
- `npm run dev` — run all apps
- `npm test` — run all tests
- `npm run lint` / `npm run typecheck`
- `npm run db:migrate` / `npm run db:generate`

## Rules

- TypeScript strict; no `any` without a comment explaining why.
- Validate every request body/query with Zod schemas from `packages/shared`.
- Every data access is scoped by `workspaceId`. Every endpoint, socket room join, search, and AI retrieval goes through the central permission check.
- Side effects (notifications, indexing, emails, AI jobs) go to a queue, not the request path.
- Emit real-time events only after the DB transaction commits.
- Schema changes go through Drizzle migrations; never edit an applied migration.
- Secrets come from env vars (`.env`, never committed); update `.env.example` when adding one.
- Before saying a phase is done: run lint, typecheck, and tests, and report the results.
- Write integration tests for permissions and business rules, not just happy paths.
