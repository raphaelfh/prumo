---
paths:
  - "frontend/**"
  - "vite.config.ts"
  - "vitest.config.ts"
  - "tailwind.config.ts"
---

# Frontend conventions (prumo)

For any non-trivial frontend change, load the `frontend-development` skill
(structure/data/state) before writing code. Visual language → `frontend-ux`;
Tailwind/shadcn mechanics → `ui-styling`. This file is the always-true core.

## Structure (CI-enforced by `scripts/fitness/check_frontend_data_path.py`)

- Data flows `component → hook (TanStack Query) → service (apiClient) →
  backend`. Components never call `fetch()` or `supabase.from(...)` directly.
- `frontend/services/*Service.ts` functions return `ErrorResult<T>`
  (`frontend/lib/error-utils.ts:toResult`); they never throw across the
  boundary and never toast.

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
- Visual language is authoritative in `frontend-ux` (it outranks the
  `frontend-design` plugin on core product UI — that plugin is for
  greenfield only). After a non-trivial UI change, verify with your
  eyes, not the diff: run the `design-review` loop
  (`/design-review <route>`) — render, screenshot, compare to the
  Plane/Linear target, fix, re-screenshot.

## Tests

- Run from the repo root: `npm run test:run` (vitest; plain `npm test`
  is watch mode and hangs agent sessions). E2E: `npm run test:e2e:local`
  — fixtures self-provision via `frontend/e2e/_fixtures/ensure-fixtures.ts`,
  but the global CHARMS template must exist (`make db-seed` after a
  bare `reset-db`).

## API contract types (generated — never hand-edit)

- `frontend/types/api/{openapi.json,schema.d.ts}` are generated from
  the FastAPI app: `npm run generate:api-types`. CI (`api-contract`
  job) fails any PR where the committed output doesn't match the
  backend — so after changing an endpoint or Pydantic schema, rerun
  the generator and commit the diff.
- New frontend code should import response/request shapes from
  `frontend/types/api/schema.d.ts` instead of hand-mirroring backend
  enums/models (hand-mirrored types are the documented root cause of
  the envelope-drift incident class).

## React Compiler

- The build runs `babel-plugin-react-compiler` with `panicThreshold:
  'all_errors'` (`vite.shared-plugins.ts`): a component or hook the
  compiler cannot compile fails the build and vitest. Don't write
  `try/finally` (or `throw` inside `try`) in component/hook bodies —
  move IO into a `frontend/services/` function returning
  `ErrorResult<T>` (`frontend/lib/error-utils.ts:toResult`); exported
  service functions never throw across the boundary and never toast.
- Last-resort opt-out for a file the compiler genuinely cannot handle:
  `'use no memo'` directive plus a `// kept:` comment with the reason.
- `scripts/enumerate_compiler_bailouts.mjs` lists every non-compiling
  file in one pass (useful before compiler upgrades).
