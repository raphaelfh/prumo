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
- **A label that folds on a narrow bar folds to `sr-only`, never to
  `hidden`.** The idiom is `sr-only @[<w>]/<container>:not-sr-only` (see
  `TemplateConfigEditor`, `TemplateConfigPublishControls`,
  `runs/header/SaveSlot`). `hidden` removes the element from the
  accessibility tree, so the control's accessible name silently loses the
  word it was collapsing — and an `aria-label` "fix" for that is worse: it
  REPLACES the composed name and erases any sibling chip or badge inside
  the button. Verified live: the QA surface's AI-instruction trigger must read
  "General AI instruction1 to customize", and the extraction config bar's AI
  chip (`LlmEngineChip` — the bar's ONE trigger into `AiConfigDialog`) must
  read "AI configuration<model>…1 to customize", warning included.
- Visual language is authoritative in `frontend-ux` (it outranks the
  `frontend-design` plugin on core product UI — that plugin is for
  greenfield only). After a non-trivial UI change, verify with your
  eyes, not the diff: run the `design-review` loop
  (`/design-review <route>`) — render, screenshot, compare to the
  Plane/Linear target, fix, re-screenshot.
- **Space belongs to content — keep to the edge budget** (`frontend-ux` §6).
  Page gutter `px-4 py-3 lg:px-6` (never wider); one hairline per boundary,
  drawn by the region that owns it; no card nested inside an already-bordered
  pane; no doubled padding. Compact rows (rail, menu, list) sit at `px-2 py-1`
  with `space-y-0.5` — tighter and they read as one glued block. Space
  reclaimed from the outside gets spent on the inside, not banked. A
  **resizable** pane clamps three things — its own min, its own max, and a
  live floor under the pane it steals from (`template-config/PaneResizer.tsx`).
- **Selection and focus never share a vocabulary** (`frontend-ux` §4.6). Focus
  owns `outline-2 outline-ring`; selection owns a tint plus a weight/colour
  shift. An element painting both draws two concentric rules whenever it is
  selected *and* focused.

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
- **UI copy has its own gate**, because knip cannot see it: a copy key is a
  *member* of an exported object literal, not an export, so an orphaned one is
  invisible to both knip modes. `scripts/fitness/check_copy_keys.py` fails on
  any `frontend/lib/copy/*.ts` key with no reference in
  `frontend/**/*.{ts,tsx}` (shrink-only baseline). Clearing a baseline entry
  DELETES user-facing copy — `t()` returns `''` for a missing key, so a wrong
  deletion ships as a blank string, not an error. Run `npm run typecheck` AND
  `npm run test:run`: typecheck catches the three reference forms, but only the
  suite catches the tests that assert a key's *presence* at runtime.
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
