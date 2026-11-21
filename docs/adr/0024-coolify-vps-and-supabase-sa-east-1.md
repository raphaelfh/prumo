---
status: accepted
last_reviewed: 2026-11-21
owner: '@raphaelfh'
adr_number: '0024'
---

# Host the backend on a Coolify VPS and Supabase in sa-east-1

> **Status:** Accepted · Date: 2026-11-21 · Deciders: @raphaelfh
> **Supersedes:** [0004](0004-hosting-render-to-railway.md) · **Superseded by:** N/A

## Context and Problem Statement

Since ADR 0004 the backend (`web`, `worker`, Redis) ran on Railway in
US East, beside the Supabase project in `us-east-1`. Nearly every user is in
Brazil, so each API call crossed to Virginia and back. A Hostinger VPS in
Campinas (4 vCPU, 16 GB) was already paid for and running Coolify, with room
for the backend's whole footprint (about 0.7 GB idle, 1.5 GB at peak).
Railway cost about US$7 a month on Hobby, US$20 on Pro.

Nothing stateful lives on the backend hosts: Postgres, Auth and Storage are in
Supabase, and Redis holds only the transient Celery queue. Moving the backend
is a host swap. Moving Supabase is a data migration.

## Decision Drivers

- Latency for users in Brazil, measured, not estimated.
- No recurring cost beyond the VPS already paid.
- Operational burden stays where a managed service carries it.

## Considered Options

- **A.** Move only the backend to the VPS; keep Supabase in `us-east-1`.
- **B1.** Move the backend to the VPS and Supabase to a managed project in
  `sa-east-1` (São Paulo).
- **B2.** Move the backend to the VPS and self-host Supabase on it.
- **D.** Stay on Railway.

## Decision Outcome

Chosen option: **B1**. It is the only option that made a database-backed
request faster than Railway, and it adds no service to operate.

Evidence (2026-11-20/21, TTFB p50 measured from São Paulo):

| Request | Railway (us-east4) | VPS → Supabase `us-east-1` | VPS → Supabase `sa-east-1` |
| --- | --- | --- | --- |
| `/health` (no database) | 162 ms | 59 ms | — |
| One database lookup (`POST /mcp` with an invalid token → 401) | 248 ms | 867 ms | ~150 ms |

With the database in Virginia, each session checkout from Campinas paid
several ~125 ms round trips (pre-ping, `BEGIN`, prepare + execute,
`ROLLBACK`), so a single lookup went from 248 ms to 867 ms and a real endpoint
would have taken 1.5–3 s. That ruled out A.

Production now runs:

- Coolify project `prumo`, environment `production`: `prumo-web` (Dockerfile
  `CMD`: Alembic, seed, gunicorn) at `https://prumo-api.healthnumbers.com.br`,
  `prumo-worker` (same image, Celery started through a custom `--entrypoint`
  option) and `prumo-redis` (`redis:8.2`, no persistence, internal network
  only). Traefik terminates TLS with Let's Encrypt. Coolify builds
  `backend/Dockerfile` from `main` on every push.
- Supabase project `prumo-sa` (`pwtaciozopymgcwimxxh`, `sa-east-1`, free
  plan), restored from the old project with identical row counts and all
  Storage objects.
- The frontend stays on Vercel at `https://prumoai.vercel.app`; a custom
  domain is future work.

### Consequences

- Good — From Brazil, a request with one database lookup is about 100 ms
  faster than on Railway (248 → ~150 ms), and one without is about 100 ms
  faster too (162 → 59 ms).
- Good — The Railway bill (about US$7–20 a month) goes away; the VPS was
  already paid.
- Bad — The VPS is a single point of failure, shared with other projects. A
  weekly VPS snapshot covers the host; the backend itself holds no state.
- Bad — Coolify does not wait for CI. The required checks on the
  `dev → main` promotion PR are the only gate before a deploy.
- Bad — The image has no `curl` or `wget`, so Coolify's HTTP healthcheck is
  off for `prumo-web` and does not gate a deploy. The post-deploy smoke and
  `/health.commit` are how a bad deploy shows up.
- Bad — The image builds on the VPS, sharing CPU with its other tenants.
  Building in CI and pushing to a registry is the follow-up if that contention
  bites.
- Neutral — The worker's start command lives in Coolify's configuration,
  mirrored in `docs/reference/deployment.md`, where the queue drift test reads
  it.
- Neutral — Moving Supabase issued new JWT keys, so every user signed in again
  (password hashes moved with `auth.users`). The new `PUBLIC_API_URL` changed
  the OAuth issuer, so MCP OAuth clients authorize again (ADR 0022).
- Neutral — The Supabase free plan has no backups, as before the move.

## Validation

- `/health` on `https://prumo-api.healthnumbers.com.br` returns 200 with
  `jwks_ready`, `db_ready` and `storage_ready` true, and `commit` equal to
  `main`'s head (the scheduled post-deploy smoke checks this every 6 hours).
- Sign-in, opening a PDF, and an AI extraction end to end were checked after
  the cutover.

## Pros and Cons of the Options

### A. Backend on the VPS, Supabase in us-east-1

- Good — Lowest effort: no data migration.
- Bad — Measured 3.5x slower than Railway on one database lookup (867 ms vs
  248 ms); worse on every multi-query endpoint.

### B1. Backend on the VPS, managed Supabase in sa-east-1

- Good — Fastest managed setup measured (~150 ms for one lookup).
- Good — Supabase keeps upgrades, the dashboard, logs, the MCP connector and
  the GitHub migration integration.
- Bad — A one-time migration of the database, Auth users and Storage, with a
  maintenance window and a forced re-login.

### B2. Backend on the VPS, Supabase self-hosted on it

- Good — Sub-millisecond database round trips, perhaps 30–60 ms per request
  faster than B1.
- Bad — About ten more containers (Kong, GoTrue, PostgREST, Storage, Studio,
  Supavisor…) to patch and upgrade, 2–4 GB of the VPS's RAM, and an own SMTP
  setup for Auth.
- Bad — No backups unless built by hand, and the only copy of the data on a
  VPS that already hosts other projects: a single point of failure for data,
  not just compute.

### D. Stay on Railway

- Good — No migration effort or risk.
- Bad — Keeps paying for a host slower than B1 for users in Brazil.

## More Information

- [Deployment reference](../reference/deployment.md)
- [ADR 0004](0004-hosting-render-to-railway.md) (superseded)
