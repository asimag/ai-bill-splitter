# Bill Splitter

Self-hosted, mobile-first web app for weighted restaurant bill splitting and
multi-expense trips. Capture or enter expenses, track who paid, and settle up.

## Stack

- `apps/web` — React + TypeScript + Vite (mobile-first; PWA in Stage 4)
- `apps/server` — Node.js + Express + TypeScript API, PostgreSQL via `pg`
- `packages/core` — shared money/allocation engine (exact integer minor units; used by both API and browser)
- `docker-compose.yml` — Postgres + API + nginx-served web (verify on a machine with Docker)

## Development setup (macOS/Linux, Node ≥ 22)

```bash
npm install
cp .env.example .env          # then set SESSION_SECRET: openssl rand -hex 32
# PostgreSQL: any reachable server; default dev URL is postgres://asim@localhost:5433/billsplit_dev
npm run migrate
npm run dev                   # API on :8787, web on :5173 (proxies /api)
```

Open http://localhost:5173 — create an account, then a trip.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | API (`tsx watch`) + web (`vite`) together |
| `npm run migrate` | Apply pending SQL migrations from `apps/server/migrations` |
| `npm test` | All workspace tests (allocation engine examples from AGENTS.md) |
| `npm run typecheck` | TypeScript check across workspaces |
| `npm run build` | Production web bundle (`apps/web/dist`) |

## Deploy (self-hosted)

1. Copy the repo to the server; create `.env` with `POSTGRES_PASSWORD` and `SESSION_SECRET`.
2. `docker compose up -d --build`
3. Put HTTPS in front of `127.0.0.1:8090` (Caddy/nginx/Traefik).
4. Back up the `pgdata` and `receipts` volumes.

Migrations run automatically when the API container starts.

## Status

Stage 1 (auth, trips, participants, allocation engine, quick split, manual
expenses, running balances) — see [TASKS.md](TASKS.md). Receipts/AI, offline
drafts, exports, and PWA packaging come in Stages 2–5.
