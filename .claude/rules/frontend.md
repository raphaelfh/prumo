---
paths:
  - "frontend/**"
  - "vite.config.ts"
  - "vitest.config.ts"
  - "tailwind.config.ts"
---

# Frontend conventions (prumo)

Visual language lives in the `frontend-ux` skill; Tailwind/shadcn
mechanics in `ui-styling`. This file is the always-true core.

## Data access

- Backend calls go through the typed client at
  `frontend/integrations/api/client.ts`. Do not read
  `import.meta.env.VITE_API_URL` or call `fetch()` directly in
  services; do not add new `supabase.from(...)` reads outside the
  integration layer (the dual read path is the root cause of the
  slow-load / status-drift / blind-leak incident class — full
  consolidation is in progress).
- TanStack Query keys come from the key factories (CI-enforced by
  `scripts/fitness/check_react_query_keys.py`). Mutations invalidate
  the owning key family — stale-cache bugs are a recurring incident
  class.

## UI & copy

- All user-facing text goes through `frontend/lib/copy/` (in-house
  i18n) — never hardcode strings in components.
- shadcn/Radix primitives; `cn()` merge order matters; every
  interactive element keeps a visible focus state.

## Tests

- Run from the repo root: `npm run test:run` (vitest; plain `npm test`
  is watch mode and hangs agent sessions). E2E: `npm run test:e2e:local`
  — fixtures self-provision via `frontend/e2e/_fixtures/ensure-fixtures.ts`,
  but the global CHARMS template must exist (`make db-seed` after a
  bare `reset-db`).
