# Team OS

An all-in-one team workspace: projects, tasks, docs, meetings, calendar, real-time collaboration, and an AI assistant over the whole workspace.

See [SPEC.md](SPEC.md) for what it does and [PLAN.md](PLAN.md) for the build plan.

## Run locally

```sh
cp .env.example .env
docker compose up -d   # Postgres + Redis
npm install
npm run db:migrate
npm run dev            # API, worker and web app
```

`npm test`, `npm run lint` and `npm run typecheck` check everything.
