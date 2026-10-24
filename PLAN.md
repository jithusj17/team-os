# Team OS — Build Plan

One phase per session. At the end of each phase: tests pass → review diff → commit → `/clear`.
Rough budget for 1–2 weeks: ~1 day per phase, phases 7–9 may take longer.

---

## Phase 0 — Foundation

- npm workspaces monorepo: `apps/api`, `apps/web`, `apps/worker`, `packages/shared`.
- TypeScript, ESLint, Prettier, Vitest configured.
- `docker-compose.yml`: Postgres 16 + pgvector, Redis.
- Fastify server with `/health`, structured logging (pino) with request IDs, env config validated with Zod.
- Drizzle set up with a first migration.

**Done when:** `docker compose up -d`, `npm run dev`, `GET /health` returns OK and checks DB + Redis; `npm test` passes.

## Phase 1 — Auth & workspaces

- OAuth with Google + GitHub, Redis-backed sessions, logout.
- Users, workspaces, memberships, invites.
- Permission module: one central `can(user, action, resource)` function, used everywhere.
- Rate limiting and CSRF protection.

**Done when:** a user can sign in, create a workspace, invite another user; tests cover each role's access.

## Phase 2 — Projects & tasks

- Projects (with keys), configurable statuses, project roles.
- Task CRUD, subtasks, labels, assignees, comments with @mentions, activity log.
- Filtering, sorting, cursor pagination.
- Optimistic concurrency with `version` → `409` on conflict.

**Done when:** full task API works with permissions enforced; integration tests pass.

## Phase 3 — Task dependencies

- `task_dependencies` table; cycle detection on insert (reject with clear error).
- Block "done" transition while blockers are open (per-project setting).
- Dependency graph + critical path endpoint.

**Done when:** tests cover cycles, cross-project links, blocked transitions, critical path.

## Phase 4 — Real-time

- Socket.IO + Redis adapter; auth from session cookie.
- Rooms per workspace / project / task, joined only after permission check.
- Broadcast task/comment events after DB commit; presence.
- Reconnect resync via "changes since version/timestamp" endpoint.

**Done when:** two browser tabs (and two API instances) see each other's changes live.

## Phase 5 — Queues & notifications

- BullMQ worker app; retries with backoff; dead-letter handling.
- Notification events → fan-out job → inbox rows + real-time push.
- User preferences; daily email digest job.

**Done when:** assign/mention/blocker-resolved notifications arrive in real time; failing jobs retry.

## Phase 6 — Frontend core

- Design foundation first: design tokens (light + dark mode), Inter font, icon set, shared components (button, input, select, dialog, dropdown, avatar, badge, toast), real router.
- App shell in the style of Linear/Lark: sidebar with workspace switcher and navigation, user menu.
- Replace the Phase 1 placeholder screens: branded sign-in page; members page with avatars, role changes and removal (permission-aware), pending invites with copy link and revoke; invite dialog; workspace settings (rename, delete).
- React app: project list, board, list view, task detail drawer, comments, notifications inbox.
- TanStack Query cache updated from socket events.

**Done when:** the core workflow can be done entirely in the UI, and it looks like a polished product, not a prototype.

## Phase 7 — Docs & calendar/meetings

- Docs with markdown, version snapshots, links to tasks.
- Calendar events with attendees; meeting notes as docs.
- UI for both.

**Done when:** create a meeting, write notes, link tasks — all permission-checked.

## Phase 8 — AI: indexing & search

- Indexing job: chunk content → embeddings → pgvector; re-index on change (debounced).
- Semantic + keyword hybrid search, filtered by the user's permissions _inside the query_.
- Search UI (command palette).

**Done when:** search finds relevant content and never returns content the user can't access (tested).

## Phase 9 — AI: summaries, Q&A, actions

- Summaries (task, project status, meeting, doc), streamed, cached by content hash.
- "Ask the workspace" with retrieval + citations.
- AI actions: model returns structured actions (tool use) → user confirms → server validates & executes with normal permission checks; idempotency keys; audit log.
- Meeting notes → action items → tasks.

**Done when:** each AI feature works end-to-end; tests cover action validation and permission denial.

## Phase 10 — Hardening & deploy

- Load test key endpoints against the latency targets; add caching/indexes where needed.
- Security pass (`/security-review`), error handling, metrics.
- Dockerfiles, CI (lint + test), deploy.

**Done when:** targets in SPEC.md §3 are met and the app is deployed.
