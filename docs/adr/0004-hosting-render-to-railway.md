---
status: accepted
last_reviewed: 2026-05-24
owner: '@raphaelfh'
adr_number: '0004'
---

# Host backend (web + worker + Redis) on Railway instead of Render

> **Status:** Accepted · Date: 2026-05-24 · Deciders: @raphaelfh

## Context and Problem Statement

Until 2026-05-24, the backend ran on Render's free tier. The free tier
does not provide managed Redis, which blocked the async endpoints
(`articles_export`, `zotero_import`, `extraction_export`) from working in
production — they all need a Celery broker.

## Decision

Migrate to Railway Hobby plan, US East region, with three services in one
project: `web` (FastAPI + gunicorn), `worker` (Celery), and a managed
Redis plugin.

- Both `web` and `worker` build from `backend/Dockerfile`.
- IaC committed as `railway.toml`.
- Deploys are GitHub-App driven from `main`, gated by **Wait for CI**.
- Fallback when CI is red: `railway up backend --path-as-root --service <name>`.

## Consequences

- Good — Async endpoints work in production for the first time.
- Good — Hobby plan still affordable at this scale.
- Good — Three services share the same private network for Redis access
  (no public traffic to broker).
- Neutral — Manual env-var management (no `.env.railway.example` is tracked).
- Bad — Currently the CI coverage gate (62%) sometimes SKIPs the Railway
  deploy when the threshold drops; documented workaround in
  `docs/reference/deployment.md`.

## Validation

- Production URL: <https://web-production-48b398.up.railway.app>
- `/health` returns 200.
- Celery worker registers all task names (drift guard at
  `backend/tests/unit/test_celery_app_task_registry.py`).

## More Information

- [Deployment reference](../reference/deployment.md)
- [Archived plan](../superpowers/plans/archive/2026-05-24-render-to-railway/plan.md)
- [`railway.toml`](../../railway.toml)
