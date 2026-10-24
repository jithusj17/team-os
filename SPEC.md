# Team OS — Specification

An all-in-one team workspace (in the spirit of Jira / Lark): projects, tasks, meetings, docs, calendar, and an AI assistant over the whole workspace.

**Goal:** a real, production-grade backend. A smaller feature set built properly beats a wide feature set built shallowly.
**Timeline:** 1–2 weeks for v1. Anything marked _Later_ is out of scope for v1.

---

## 1. Users and roles

- **Workspace**: the top-level tenant. Every row of data belongs to exactly one workspace.
- **Workspace roles**: `owner`, `admin`, `member`, `guest`.
- **Project roles** (override within a project): `admin`, `editor`, `viewer`.
- A guest sees only the projects they are explicitly added to.

## 2. v1 features

### Auth

- OAuth sign-in with Google and GitHub.
- Server-side sessions (HTTP-only secure cookie, session stored in Redis).
- Workspace invites by email link (token, expires in 7 days).

### Projects & tasks (core)

- Projects with a key (e.g. `ENG`) → tasks numbered `ENG-42`.
- Task fields: title, description (markdown), status (configurable per project), priority, assignee, labels, due date, estimate, parent task (subtasks).
- **Dependencies**: `blocks / blocked-by` between tasks, including across projects in the same workspace.
  - Reject cycles at write time.
  - A task cannot move to a "done" status while a blocker is still open (configurable per project).
  - Endpoint to get the dependency graph and critical path for a project.
- Comments with @mentions.
- Activity log (who changed what, when) on every task.
- Views: board (kanban), list with filters/sort, and a dependency view.

### Real-time collaboration

- Live updates over WebSockets: task create/update/move, comments, presence (who is viewing a project/task).
- Works across multiple API instances (Redis pub/sub adapter).
- Clients reconnect and resync without losing events (fetch changes since last seen version).
- Optimistic concurrency: every task has a `version`; stale updates return `409`.

### Docs

- Workspace / project docs with markdown body, linked to tasks.
- Version history (save snapshots).
- _Later:_ simultaneous co-editing (CRDT with Yjs).

### Calendar & meetings

- Events with attendees, linked to a project and optionally tasks.
- Meeting notes as a doc attached to the event.
- AI meeting summary + extracted action items → one-click create tasks.
- _Later:_ Google Calendar sync.

### Notifications

- Triggers: assigned, mentioned, comment on watched task, status change, due soon, blocker resolved.
- Delivered in-app (real-time) and stored in an inbox (read/unread).
- Per-user preferences; email digest delivered by a background job.
- Fan-out happens in a queue worker, never in the request path.

### AI assistant

- **Summaries**: task thread, project status (what's done/blocked/at risk), meeting notes, doc.
- **Semantic search** over tasks, comments, docs, meetings (pgvector), respecting permissions.
- **Ask the workspace**: question → retrieve permitted content → answer with citations.
- **AI actions**: "create tasks from these notes", "assign X to Y", etc.
  - The model proposes structured actions; the user confirms; the server validates and executes them through the same permission checks as normal API calls.
  - Every AI action is logged and idempotent (safe to retry).
- Indexing runs in a background queue whenever content changes (debounced), not inline.

### Later (not v1)

Email integration, Google Calendar sync, CRDT co-editing, mobile apps, billing, SSO/SAML.

## 3. Non-functional requirements

| Area          | Target                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------- |
| API latency   | p95 < 150 ms for normal reads, < 300 ms for writes (excluding AI)                         |
| AI            | stream responses; first token < 2 s; summaries cached until source content changes        |
| Real-time     | event delivered to other clients < 500 ms                                                 |
| Permissions   | enforced server-side on every endpoint, socket room join, search result, and AI retrieval |
| Reliability   | queue jobs retried with backoff; dead-letter queue; idempotency keys on AI actions        |
| Security      | input validation on every endpoint, rate limiting, CSRF protection, no secrets in code    |
| Observability | structured logs with request IDs, health checks, basic metrics                            |
| Tests         | unit + integration tests for permissions, dependencies, and AI action validation          |

## 4. Tech stack

- **Monorepo:** npm workspaces — `apps/api`, `apps/web`, `apps/worker`, `packages/shared`.
- **Backend:** Node.js + TypeScript, Fastify, Zod validation.
- **Database:** PostgreSQL 16 + pgvector, Drizzle ORM + migrations.
- **Cache / sessions / pub-sub:** Redis.
- **Queues:** BullMQ (notifications, indexing, AI jobs, email digests).
- **Real-time:** Socket.IO with the Redis adapter.
- **Auth:** OAuth 2.0 (Google, GitHub) via `arctic`.
- **LLM:** Claude API (model set by env var). Embeddings provider configurable (e.g. Voyage AI).
- **Frontend:** React + Vite + TypeScript, TanStack Query, Tailwind.
- **Tests:** Vitest; integration tests against a real Postgres/Redis in Docker.
- **Local dev:** Docker Compose for Postgres + Redis.

## 5. Open questions

- Email provider for invites and digests (Resend / SES / SMTP)?
- Deployment target (Render, Fly.io, AWS, VPS)?
