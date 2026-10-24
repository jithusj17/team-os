# Team OS

Read `SPEC.md` for what we're building and `PLAN.md` for the phase plan. Work on one phase at a time; don't start the next phase unless asked.

## Stack
npm workspaces monorepo: `apps/api` (Fastify), `apps/worker` (BullMQ), `apps/web` (React + Vite), `packages/shared` (types, Zod schemas).
PostgreSQL 16 + pgvector via Drizzle, Redis, Socket.IO, Claude API.

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
