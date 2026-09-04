---
status: approved
last_reviewed: 2026-09-03
owner: '@raphaelfh'
---

# Entry-group identity follow-up train — design

> Brainstormed and approved 2026-09-03, after #802 landed on `dev`. Eight
> follow-ups were left open by the identity train (#798 to #802). Each
> carried a decision; this document records the decisions and the shape
> of the work for the six that ship as small PRs. The seventh (item 2,
> parent scope for nested singletons) grew into a feature of its own and
> lives in [`2026-09-03-entry-group-trees-design.md`](2026-09-03-entry-group-trees-design.md).
>
> Execution runs through `/ship-spec <this file> --to dev`, one PR per
> section below, in order. Every PR passes the cleanup gate in §9 on top
> of the ship-spec hardening.

## 1. Starting position

The entry-group train made identity uniform: every `cardinality='many'`
section that declares an `is_entity_key` field is an entry group, at any
depth, and the pipeline identifies, resolves and extracts once per entry
(`backend/app/services/entry_group_extraction.py`). Identity is
materialized on `extraction_instances.metadata.entity_key`; re-keys are
appended to `metadata.entity_key_history`. A section's `description` is
its AI instruction and is editable. `dev` sits five squash commits ahead
of `main` (#798 to #802), CI green on each, one idempotent data
migration (0067) among them.

What the follow-ups found in the code, verified 2026-09-03:

- A keyless repeating group raises `MissingEntityKeyError`, a plain
  `Exception`. The async section path classifies it into the generic
  `EXTRACTION_FAILED`; the sync `POST /api/v1/extraction/models` path
  turns it into a 500 through the endpoint's broad `except Exception`.
  The repo already has the pattern for both surfaces: `EngineRetiredError`
  is an `AppError` (typed 409 envelope on the sync route) and is
  classified by type into `ExtractionErrorCode.ENGINE_RETIRED` for jobs.
- The seeded catalogue holds exactly four repeating groups across every
  seed module. The two containers ship the noun `model`; `final_predictors`
  (CHARMS) and `numeric_performance` (Multimodal) ship no noun and fall
  back to `entry`. `seed_charms` and `seed_charms_mm` early-return on an
  existing template row, so a seed-only change never reaches an existing
  database, prod's global catalogue included.
- `entry_label` is versioned config since #798 (it is in the snapshot,
  the diff and the restore). Backfilling it on a published project clone
  without patching the snapshot would surface a phantom unpublished
  change, and Discard would write null back (the 0067 lesson). Global
  catalogue rows carry `template_id`; clones carry `project_template_id`.
- When a noun is blank, the container's surfaces fall back to `model`
  (the create schema plus nine frontend sites) while every other surface
  falls back to `entry`.
- The manual add-model dialog composes the generic entry dialog and adds
  a free-text "Modelling method" input. The backend records it only when
  the container has a field literally named `modelling_method`. CHARMS
  has one, as a `select` with a fixed list, so a typed value can land
  off-list; the Multimodal container has none, so the value is silently
  dropped. The AI model path's `modellingMethod` on its result payload is
  a separate contract.
- `entity_key_history` is on the wire (the run view serializes the whole
  metadata object) and has no reader on either side.
- The E2E suite is stateful. A description edit on the shared fixture
  project's clone stamps `config_draft_since` on a template other specs
  assume clean. The teardown registry deletes instances, entity types and
  fields a spec records.
- The add-section dialog has two hardcoded strings (the internal-name
  hint and "Creating..."); the model selector carries five `title`
  attributes where the frontend rule asks for a shadcn `Tooltip`, and its
  remove button has no `aria-label`.

## 2. Decisions

| Item | Decision |
| --- | --- |
| 1 Typed refusal | Code `MISSING_ENTITY_KEY` on both surfaces (async job code and sync 409 envelope). Toast title "Entry key missing". The description names the section and the fix ("Ask a project manager to mark one of its fields as the entry key in the Configuration tab") with no link: the Config tab is manager-only and on the project route. |
| 2 Parent scope | Generalized into its own spec (entry-group trees). Not in this train. |
| 3 Nouns | The noun is required at creation on every repeating section; `entry` is the one fallback for legacy rows; the container's `model` default is deleted. Seeds ship `predictor` and `validation`. Migration 0068 stamps those two on global catalogue rows only. |
| 4 Modelling method | Dropped. The container's dialog becomes the generic entry dialog. |
| 5 Re-key history | Stays audit data. No reader yet. |
| 6 Playwright | New spec on a dedicated fixture project. |
| 7 Mechanical | Folded: the dialog strings ride PR 2; the selector tooltips and `aria-label` land in the entry-group trees spec, which rewrites the selector. |
| 8 Promotion | Promote `dev` to `main` first, before PR 1. Items 1, 3, 4 promote next; the trees spec promotes on its own. |

## 3. PR 0 — promote dev to main

Merge-commit PR `dev` → `main` carrying #798 to #802, `gh pr merge
--auto --merge` (never squash, never fast-forward). Verify: the promotion
PR merges, the Railway web and worker deploys report SUCCESS on the merge
SHA, `/health` returns 200, and `post-deploy-smoke` is re-run after the
deploy and is green (its first run races the deploy and certifies the
old build). No code in this PR.

## 4. PR 1 — typed refusal for a keyless repeating group (item 1)

Goal: a keyless repeating group refuses with one machine-readable code on
every kickoff path, and the reviewer reads a specific title and an
actionable description.

Backend:

- `MissingEntityKeyError` (`backend/app/services/entity_key.py`) becomes
  an `AppError` with `code="MISSING_ENTITY_KEY"`, `status_code=409`, the
  `EngineRetiredError` shape. It keeps `entity_type_id` and
  `entity_type_label`. Its message becomes: `The repeating section
  '{label}' declares no entry key, so AI extraction cannot tell a new
  entry from one it already extracted. Ask a project manager to mark one
  of its fields as the entry key in the Configuration tab.`
- `ExtractionErrorCode.MISSING_ENTITY_KEY` is added, with a docstring
  bullet naming its emitter, and `classify_extraction_error` gains a
  type-based arm that returns the code and the message verbatim.
- `POST /api/v1/extraction/models` re-raises `AppError` before its
  generic `except Exception` arm, so the registered handler serves the
  typed 409 envelope. The section-extraction endpoint needs no change:
  `_failure_error_code` already coerces any known string.
- `frontend/types/api/schema.d.ts` regenerated
  (`bash scripts/generate_api_types.sh`) so the enum union carries the
  new value.

Frontend:

- `jobErrorToast` gains a `MISSING_ENTITY_KEY` case: title from a new
  copy key `sectionExtractionErrorNoEntryKey` ("Entry key missing"),
  description = the backend message, the shared 8 s duration.
- The sync model-extraction hook reads the envelope's `error.code` on
  failure and shows the same toast for `MISSING_ENTITY_KEY`, instead of
  its generic message.

Tests, written first:

- Unit: `classify_extraction_error(MissingEntityKeyError(...))` returns
  the code and the message; the enum value round-trips through
  `ExtractionTaskError`.
- Integration: a keyless repeating group on the section path leaves the
  job with `error_code == "MISSING_ENTITY_KEY"`; on the models path the
  response is 409 with `error.code == "MISSING_ENTITY_KEY"`. A direct
  endpoint-coroutine test covers the re-raise arm (ASGI blind spot).
- Vitest: `jobErrorToast('MISSING_ENTITY_KEY', msg)` returns the title
  and the message; the sync hook shows that title on a 409 envelope.

Docs: `docs/reference/extraction-hitl-architecture.md` error-code rows
and `last_reviewed`.

## 5. PR 2 — the entry noun on every repeating section (items 3 and 7a)

Goal: no surface assumes `model`; every repeating section is created with
a noun; the seeded groups carry theirs on fresh and existing databases.

Rule: a section with `cardinality='many'` is created with a non-blank
`entry_label`. A section that does not repeat carries none. Legacy rows
with a null noun read as `entry` everywhere.

Backend:

- `SectionCreateRequest`: the noun validator applies to every repeating
  section, container included, and refuses a blank; the container's
  `"model"` default is deleted. The container still always repeats.
  `SectionUpdateRequest` already refuses a blank noun.
- Portable import: a repeating section without a noun defaults to
  `entry`, never `model`. Export is unchanged.
- Seeds: `final_predictors` gets `entry_label="predictor"`,
  `numeric_performance` gets `entry_label="validation"`; the
  `_EntitySpec` comment stops calling the noun container-only. A
  `SEEDED_ENTRY_NOUNS` constant lists the four `(section name, noun)`
  pairs.
- Migration `0068_seeded_entry_nouns`: one UPDATE on
  `extraction_entity_types` setting `entry_label` from a VALUES list of
  the two new pairs, restricted to `template_id IS NOT NULL`,
  `cardinality = 'many'` and `entry_label IS NULL`. Idempotent. Global
  rows only, so no snapshot is touched and no clone shows a phantom
  diff. Existing clones keep `entry` until a manager names the noun in
  the inspector, which #800 unlocked. Downgrade is a no-op: a noun set
  here is indistinguishable from one a manager typed.
- `app.models.extraction.DEFAULT_ENTRY_LABEL` (the fallback the exports
  and the snapshot reader use) reads `entry`. `template_diff._DEFAULT_ENTRY_LABEL`
  stays `model`: it reproduces the B-8 default that pre-B-8 snapshots
  omit, so the baseline keeps matching live containers. The trees spec
  deletes it together with those snapshots.
- The `entry` fallback in `entry_group_extraction.DEFAULT_ENTRY_NOUN`
  stays as the single backend fallback.

Frontend:

- `AddSectionDialog`: the entry-label field renders whenever the form's
  cardinality is `many`, in every mode (group mode is always `many`;
  root and per-model modes when the cardinality select says `many`), and
  the zod schema requires it non-blank in that case. The two hardcoded
  strings move to copy keys: `sectionNameHint` ("Unique internal name
  (snake_case).") and `sectionNameAutoGenerated` ("Auto-generated."); the
  submit spinner reuses the existing `extraction.creating` key.
- Every `?? 'model'` fallback becomes `?? 'entry'`: `ModelSection`,
  `ModelSelector`, `AddModelDialog`, `RemoveModelDialog`,
  `templateTree.ts` (two sites), `ExtractionFullScreen.tsx` (three
  sites).

Tests, written first:

- Unit (backend): a blank noun on a repeating section is a 422 in every
  role; the container no longer defaults; a non-repeating section with a
  noun is still refused. `test_seed_entry_nouns` pins
  `SEEDED_ENTRY_NOUNS` against the migration's VALUES list, the way
  `test_seed_entity_keys` pins the key list. Migration roundtrip
  head-pin bumped.
- Integration: after seeding a fresh database, the two groups carry their
  nouns; the identification prompt for `final_predictors` says "identify
  every predictor".
- Vitest: group mode refuses a blank noun; root mode shows and requires
  the noun once cardinality is `many`; the two strings resolve through
  copy.
- `python3 scripts/fitness/check_copy_keys.py` green (three new keys,
  all referenced).

Docs: none beyond the migration docstring.

### 5.1 Amendments recorded at execution (2026-09-04)

The five-lens plan review and the red runs changed six details above;
the intent of every bullet holds.

- No `SEEDED_ENTRY_NOUNS` constant: read only by tests, it would be a new
  vulture finding (§9). `test_seed_entry_nouns` derives the seeded set
  from a recording-session run of both seeds and pins it against the
  migration's VALUES list. The two containers share one
  `(prediction_models, model)` pair, so there are three distinct pairs.
- The portable importer keeps the bundle's noun verbatim, NULL included:
  materializing `entry` broke `test_round_trip_is_lossless`. A NULL reads
  as `entry` everywhere; the container's `model` default is gone.
- `entry_group_extraction.DEFAULT_ENTRY_NOUN` is deleted; every backend
  reader imports `app.models.extraction.DEFAULT_ENTRY_LABEL` — one
  fallback, one name.
- The dialog had five hardcoded strings, not two (`sectionLabelHint`,
  `sectionNameLabel`, `sectionNameHint`, `sectionNameAutoGenerated`,
  `sectionRequiredHint`), plus `entryLabelRequired`; the two placeholder
  keys are deleted — the noun input's placeholder is the frontend fallback
  constant `DEFAULT_ENTRY_NOUN` (`frontend/lib/extraction/entryKey.ts`),
  which also replaces every literal fallback (the nine `'model'` sites and
  the four `'entry'` literals that already existed).
- The Undo-after-delete replay posts the fallback noun for a legacy
  repeating section whose row carried NULL; otherwise the new create rule
  would 422 and strand the deleted subtree (B-9d deletes without confirm).
- Docs: the architecture reference's migration-head line and its
  `extraction_entity_types` row (the `.claude/rules/backend.md` rule).

## 6. PR 3 — drop the modelling-method input (item 4)

Goal: the container's manual add dialog asks for the key only, like every
other group.

- Remove `modelling_method` from `CreateModelHierarchyRequest`, the
  `modelling_method` parameter and the `method_field` branch from
  `ModelHierarchyService`, and the endpoint's pass-through. The name
  still lands on the container's entry key.
- `AddModelDialog` loses its input and its local state; if nothing
  model-specific remains, the page uses `AddEntryDialog` directly and
  the file is deleted. `useModelManagement.createModel` takes the name
  only. Copy keys `modellingMethodLabel`, `modellingMethodOptional`,
  `modellingMethodHint` are deleted; `modelDescriptionPlaceholder` is
  deleted if it has no other reference.
- `frontend/types/api/schema.d.ts` regenerated. The AI path's
  `modellingMethod` on `ModelExtractionResult` is untouched.

Tests, written first: the request schema rejects `modellingMethod`
(`extra` handling as the schema's config dictates, or simply no longer
carries it); the service records only the key decision; the dialog test
asserts a single input; `useModelManagement.test.tsx` updated.

Docs: the `/api/v1/extraction/models/manual` row in the architecture
reference and `last_reviewed`. Report the `model_container` occurrence
count under `backend/app/services` in the PR body (26 before this PR).

### 6.1 Amendments recorded at execution (2026-09-04)

- The schema takes `extra="forbid"`, as `ModelExtractionRequest` and
  `InstanceIdentityUpdateRequest` do in the same module (validated once,
  in the request cycle): a stale tab that still sends `modellingMethod`
  gets a loud 422 until it reloads, instead of silently losing a value it
  typed. The new frontend against the old backend is unaffected (the old
  field was optional).
- `AddEntryDialog` loses the `children` slot the model dialog composed
  through; the hierarchy barrel goes with its last composed export. The
  page now mounts two `AddEntryDialog`s (the container's and the generic
  `useAddEntry` one) that share literal input ids; a closed Radix dialog
  renders no DOM and the UI never opens both, so the ids never coexist —
  noted in the PR body, resolved for good when the trees spec unifies
  creation.
- `modelNameLabel` was the fifth key only the model dialog read; deleted
  with the four the spec names. The keyless container's input now reads
  "Label", as on every other keyless group.
- The architecture reference carries no row for
  `/api/v1/extraction/models/manual` (the endpoint is described in the
  `extraction_entity_types` prose, which stays true); nothing to change
  there.
- `model_container` under `backend/app/services`: 23 before and after
  (the spec's 26 predates #806).

## 7. PR 4 — Playwright coverage on a dedicated fixture project (item 6)

Goal: the rename/re-key dialog and the group description field are
exercised end to end, on state no other spec shares.

- `frontend/e2e/_fixtures/fixture-ids.ts` gains `IDENTITY_PROJECT_ID`;
  `ensure-fixtures.ts` provisions it (owner as manager, CHARMS imported
  through `ensureCharmsImported`, one article with text); `env.ts`
  exposes `identityProjectId` like `importProjectId`.
- New spec `frontend/e2e/flows/extraction-entry-identity.ui.e2e.ts`,
  serial, two tests:
  1. Open the extraction run, add a model through the entry dialog with a
     unique name (timestamp suffix), rename it and change its key, then
     assert through `adminSelect` on `extraction_instances` that
     `label` and `metadata->>'entity_key'` changed and
     `metadata->'entity_key_history'` holds one item with `from`/`to`.
     The instance is registered with `recordResource` for teardown.
  2. Open the Configuration tab, select the `Final Predictors` section,
     edit its description in the inspector, save, assert the new text
     through `adminSelect` on `extraction_entity_types`, then restore the
     original text through the same PATCH so the fixture converges.
- Skips, not failures, when the required env keys are missing, as the
  sibling specs do.

### 7.1 Amendments recorded at execution (2026-09-04)

- The spec found a product bug on its first run: after a manual add, the
  model selector stayed on its loading skeleton until an unrelated prop
  changed. `ExtractionFormView`'s memo comparator watched `models.length`
  and never `modelsLoading`, so the commit that ends the post-create load
  (same length, loading true → false, models rebuilt with progress) was
  skipped. Fixed in the same PR: the comparator compares `models` by
  reference and includes `modelsLoading`; two unit tests pin it. The bug
  predates the train (comparator from PR #5) and is in prod.
- Test 1 registers only the created parent for teardown: every FK onto
  `extraction_instances` is `ON DELETE CASCADE`, so the singleton children
  and the decision rows follow it.
- Test 2 runs the description restore in a `finally`, so an assertion
  failure cannot leave the fixture's section text mutated (nothing re-syncs
  an existing project's sections; a mutated description would compound on
  every run).
- The dedicated project is provisioned with one article carrying text; the
  teardown's draft-marker reset covers it alongside the shared and import
  projects.

## 8. Item 5 — re-key history

Recorded decision: no reader in this train. The record satisfies
traceability (who, when, from, to, append-only) and already reaches the
browser inside `metadata`. Revisit when a reviewer asks who re-keyed an
entry; the shape is stable.

## 9. Cleanup gate (every PR)

On top of the ship-spec hardening (`/simplify`, the architectural quality
loop, `code-review`, `make quality-scan`):

- `npx knip --no-tag-hints` and `npx knip --production --no-tag-hints`
  at zero findings. No new `knip.jsonc` exception.
- The vulture baseline (`backend/.vulture_baseline`) is strictly smaller
  whenever the PR deletes backend code, and never grows. No new ignore.
- `python3 scripts/fitness/check_copy_keys.py` green; deleted copy keys
  are removed from the file, never left unreferenced.
- `bash scripts/generate_api_types.sh` on any schema change, committed.
- The mypy ratchet and `make lint-backend` green.
- PR 3 reports the `model_container` count under
  `backend/app/services`.

## 10. Verification per PR

`make test-backend`, `npm run test:run`, `npm run typecheck`,
`npm run lint`, both knip modes, the copy-key check, the vulture and
mypy ratchets, and `npm run test:e2e:local` for PR 4 against a fresh
`make db-fresh` (the local suite is stateful; reruns lie). Every claim of
green quotes the command's output.

## 11. Out of scope

- Parent scope for nested singletons, ancestry on prompts, nesting under
  any repeating group, several root groups, the recursive run form, the
  tree-derived exports, the retirement of the model pipeline and of the
  model-only manual endpoint: all in the entry-group trees spec.
- Backfilling nouns on project clones (the trees spec makes the noun
  NOT NULL and recreates the prod projects).
- A reader for `entity_key_history`.

## 12. Risks

- A prompt VERSION bump is not part of this train; the seeded nouns do
  change the identification prompt's text for the two groups, which is
  by design.
- The E2E fixture project adds one more CHARMS import to global setup;
  `ensureCharmsImported` is idempotent, so reruns cost one read.
- PR 1's 409 on the models path changes a status code the frontend
  previously saw as 500; the hook's generic catch still handles unknown
  codes.
