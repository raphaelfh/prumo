---
paths:
  - "frontend/**"
  - "vite.config.ts"
  - "vitest.config.ts"
---

# Frontend conventions (prumo)

For any non-trivial frontend change, load the `frontend-development` skill
(structure/data/state) before writing code. Visual language → `frontend-ux`;
Tailwind/shadcn mechanics → `ui-styling`. This file is the always-true core.

## Data path

- `component → hook (TanStack Query) → service → apiClient`
  (`frontend/integrations/api/client.ts`). Components, hooks and services
  never call `fetch()` (enforced at review). No `supabase.from(...)` read
  or `import.meta.env.VITE_API_URL` outside the integration layer (CI:
  `scripts/fitness/check_frontend_data_path.py`). The dual read path is the
  root cause of the slow-load / status-drift / blind-leak incident class.
- `frontend/services/*Service.ts` functions return `ErrorResult<T>`
  (`frontend/lib/error-utils.ts:toResult`); they never throw across the
  boundary and never toast.
- TanStack Query keys come from the key factories (CI:
  `scripts/fitness/check_react_query_keys.py`). Mutations invalidate the
  owning key family — no gate checks this, and stale-cache bugs are a
  recurring incident class.

## UI & copy

- All user-facing text goes through `frontend/lib/copy/` (in-house
  i18n) — never hardcode strings in components.
- shadcn/Radix primitives; `cn()` merge order matters; every
  interactive element keeps a visible focus state.
- **Every icon-only control is `IconButton`** (`components/patterns/IconButton.tsx`):
  its required `label`, routed through `lib/copy/`, is the accessible name
  and the tooltip. Text buttons get a tooltip only when it adds information.
  `scripts/fitness/check_ui_primitives.py` catches only a `<Button>` with
  `size="icon"` or `size="icon-xs"`.
- **A label that folds on a narrow bar folds to `sr-only`, never to
  `hidden`.** The idiom is `sr-only @[<w>]/<container>:not-sr-only` (see
  `TemplateConfigEditor`, `TemplateConfigPublishControls`,
  `runs/header/SaveSlot`). `hidden` removes the element from the
  accessibility tree, so the control's accessible name silently loses the
  word it was collapsing — and an `aria-label` "fix" for that is worse: it
  REPLACES the composed name and erases any sibling chip or badge inside
  the button.
- Visual language is authoritative in `frontend-ux` (it outranks the
  `frontend-design` plugin on core product UI — that plugin is for
  greenfield only). After a non-trivial UI change, verify with your
  eyes, not the diff: `/design-review <route>`.
- Space belongs to content — keep to the edge budget, and selection and
  focus never share a vocabulary
  (`.claude/skills/frontend-ux/SKILL.md` §6 and §4.6).

## Dead code

- CI gates the frontend at **zero knip findings in two modes**, both run
  from the repo root and both also `verify_all.sh` gates:
  `npx knip --no-tag-hints` (tests count as consumers) and
  `npx knip --production --no-tag-hints` (only production code does).
  Delete what they flag. A legitimate exception goes in `knip.jsonc` with a
  reason a reviewer can check; never hand-edit a generated file
  (`frontend/types/api/schema.d.ts`, `frontend/integrations/supabase/types.ts`)
  to silence one. A production-mode finding is not automatically "delete
  it": triage it with `.claude/skills/frontend-development/references/dead-code.md`.
- **UI copy has its own gate**, because knip cannot see an object-literal
  member: `scripts/fitness/check_copy_keys.py` (shrink-only baseline).
  Clearing a baseline entry DELETES user-facing copy — `t()` returns `''`
  for a missing key, so a wrong deletion ships as a blank string, not an
  error. Run `npm run typecheck` AND `npm run test:run`.

## Tests

- Run from the repo root: `npm run test:run` (`vitest run`; plain
  `npm test` starts watch mode in an interactive terminal). E2E: `npm run test:e2e:local`
  — fixtures self-provision via `frontend/e2e/_fixtures/ensure-fixtures.ts`,
  but the global CHARMS template must exist (`make db-seed` after a
  bare `reset-db`).

## API contract types (generated — never hand-edit)

- `frontend/types/api/{openapi.json,schema.d.ts}` are generated from
  the FastAPI app: `npm run generate:api-types`. CI (`api-contract`
  job) fails any PR where the committed output doesn't match the
  backend — so after changing an endpoint or Pydantic schema, rerun
  the generator and commit the diff.
- Import response/request shapes from `schema.d.ts` instead of
  hand-mirroring backend enums/models (hand-mirrored types are the
  documented root cause of the envelope-drift incident class).

## React Compiler

- The build runs `babel-plugin-react-compiler` with `panicThreshold:
  'all_errors'` (`vite.shared-plugins.ts`): a component or hook the
  compiler cannot compile fails the build and vitest. Don't write
  `try/finally` (or `throw` inside `try`) in component/hook bodies —
  move IO into a `frontend/services/` function returning `ErrorResult<T>`.
- Last-resort opt-out for a file the compiler genuinely cannot handle:
  `'use no memo'` directive plus a `// kept:` comment with the reason.
  `scripts/enumerate_compiler_bailouts.mjs` lists every non-compiling file.
- **The silent hazard: subscriptions registered on a parent.** No build,
  type or lint error: the compiler memoizes a parent's JSX, so a child
  that depends on the parent re-rendering never updates. Read a
  subscription **where you consume it**: `useFormState({name})`, never
  `useFormContext().formState`. Worked example and mutation-checked guard:
  `frontend/components/ui/form.validation.test.tsx`.
