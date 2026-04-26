# Frontend E2E Suite

This directory contains robust end-to-end coverage for the app's active flows.

## Projects

- `local-api`: API-driven Playwright specs under `frontend/e2e/flows`.
- `local-ui`: UI-driven Playwright specs for authentication/navigation.
- `remote-smoke`: smoke validation against remote Supabase/backend.

## File Structure

- `_fixtures/`: reusable helpers (`auth`, `api`, `seed`, `storage`, `rls-users`, env/loading).
- `flows/`: local deterministic scenarios.
- `remote/`: remote smoke scenarios.

## Environment Variables

Core:

- `E2E_FRONTEND_URL` (default: `http://127.0.0.1:8080`)
- `E2E_API_URL` (default: `http://127.0.0.1:8000`)
- `E2E_AUTH_TOKEN` (optional if UI login is used)
- `E2E_USER_EMAIL`, `E2E_USER_PASSWORD` (required for UI login fallback)

Dataset identifiers:

- `E2E_PROJECT_ID`
- `E2E_ARTICLE_ID`
- `E2E_TEMPLATE_ID`
- `E2E_ENTITY_TYPE_ID`
- `E2E_SCHEMA_ID` or `E2E_SCHEMA_VERSION_ID`
- `E2E_TARGET_ID`
- `E2E_ITEM_ID`

Service-role utilities:

- `E2E_SUPABASE_URL`
- `E2E_SUPABASE_SERVICE_ROLE_KEY`

Optional Zotero:

- `E2E_ZOTERO_USER_ID`
- `E2E_ZOTERO_API_KEY`
- `E2E_ZOTERO_LIBRARY_TYPE`

## Commands

- Local full suite: `npm run test:e2e:local`
- Remote smoke only: `npm run test:e2e:remote`
- All: `npm run test:e2e:all`

## Coverage Matrix

- `auth.e2e.ts`: login happy path + invalid credential guard.
- `projects.e2e.ts`: authenticated navigation and project route checks.
- `articles.e2e.ts`: export validation (input guards + sync/async paths).
- `articles-export.e2e.ts`: async export lifecycle and cancel/delete endpoints.
- `zotero.e2e.ts`: invalid payload handling + optional credentials/connection flow.
- `extraction.e2e.ts`: extraction fullscreen route + model/section API runs.
- `unified-evaluation.e2e.ts`: schema/run/review/consensus/evidence plus edge cases.
- `settings-api-keys.e2e.ts`: providers + API key CRUD.
- `cross-cutting.e2e.ts`: envelope, auth, status code semantics, and rate-limit.
- `remote/smoke-remote.e2e.ts`: remote auth + extraction + review queue smoke.

## Troubleshooting

- If local tests fail at startup, ensure backend/front are healthy and migrations are applied.
- If async export tests fail with `503`, Redis/Celery queue is unavailable; start worker stack.
- If unified-evaluation happy path fails at review queue, ensure service-role seed variables are set.
- For remote smoke instability, rerun with `--project=remote-smoke` and inspect Playwright traces.
