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

## Structure

- Data flows `component → hook (TanStack Query) → service (apiClient) →
  backend`. Components never call `fetch()` or `supabase.from(...)` directly
  (`fetch()` is a convention enforced at review; `supabase.from(` and
  `import.meta.env.VITE_API_URL` are CI-enforced by
  `scripts/fitness/check_frontend_data_path.py`).
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
- **Every icon-only or short-label button exposes its description on
  hover** via the shadcn `Tooltip` (`TooltipTrigger asChild`), with the
  description text routed through `lib/copy/`. Icon-only buttons also
  carry an `aria-label`. A bare icon or terse label ("No information",
  a history glyph) must never leave the user guessing what it does.
- Visual language is authoritative in `frontend-ux` (it outranks the
  `frontend-design` plugin on core product UI — that plugin is for
  greenfield only). After a non-trivial UI change, verify with your
  eyes, not the diff: run the `design-review` loop
  (`/design-review <route>`) — render, screenshot, compare to the
  Plane/Linear target, fix, re-screenshot.

## Dead code

- CI gates the frontend at **zero knip findings in two modes**, both run
  from the repo root and both also `verify_all.sh` gates:
  `npx knip --no-tag-hints` (tests count as consumers) and
  `npx knip --production --no-tag-hints` (only production code does).
  Unused files, exports, types and dependencies fail the build — delete
  them, don't export "just in case". Legitimate exceptions (generated
  files, shell-invoked scripts, browser-runtime imports) live in
  `knip.jsonc`, each with a comment explaining why; extend that file only
  with a reason a reviewer can check. Generated files
  (`frontend/types/api/schema.d.ts`,
  `frontend/integrations/supabase/types.ts`) are knip-ignored — never
  hand-edit them to silence a finding.
- **A production-mode finding is not automatically "delete it."** It means
  no production file imports the export; the code behind it may still be
  live. Check, in order: (1) is the symbol called inside its own module?
  then it is live and only the `export` faces the test — `knip.jsonc` sets
  `ignoreExportsUsedInFile` so this should not reach you; (2) is it a
  *duplicate* of a type/function that lives closer to its real caller?
  delete this copy and point the tests at the canonical one (that is how
  the stale `FieldValidationResult` and `ArticleListItem` copies were
  found); (3) is it genuinely orphaned — no caller anywhere but its own
  test? delete the code *and* the test; (4) is it a seam a test must reach
  and production deliberately cannot? mark it `@internal` at the
  declaration with a reason. Never silence one by widening `ignore`.

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
- **The silent hazard: subscriptions registered on a parent.** The rules
  above cover the *loud* failure (build stops). The quiet one has no build
  error, no type error and no lint: the compiler memoizes a parent's JSX, so
  a child that depends on the parent re-rendering never updates. Read a
  subscription **where you consume it**, not off a value handed down from the
  component that opened it. Concretely: `useFormState({name})`, never
  `useFormContext().formState`. This class shipped once already — every
  inline form validation message in the app rendered nothing while blocking
  submits correctly. Worked example and mutation-checked guard:
  `frontend/components/ui/form.validation.test.tsx`.
