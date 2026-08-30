---
status: draft
last_reviewed: 2026-08-30
owner: '@raphaelfh'
---

# PICOT in the AI context — one project-scoped review question, pinned per run

## Problem

`projects.picots_config_ai_review` is a JSONB column whose name promises it
feeds the AI. It feeds nothing. `grep` finds it once in the backend — the model
declaration at `backend/app/models/project.py:88`. The sibling review fields
(`condition_studied`, `review_rationale`, `eligibility_criteria`,
`review_context`, `search_strategy`) also have zero backend reads.

What reaches the model is one text: `render_general_instructions_section`
(`backend/app/llm/prompts/__init__.py:17`) prepends
`General instructions for this review:` plus the version-pinned
`llm_template_instruction` to all three prompts (section extraction, quality
assessment, model identification).

So PICOT reaches the AI only as hand-typed prose. Five seeded templates carry a
`[customize: ...]` slot asking the manager to retype it, most pointedly
PROBAST+AI's `[customize: state the review's Step-1 PICOTS — Population, Index
model(s), Comparator model(s), Outcome(s), Timing, Setting/intended use — which
every applicability judgment is made against]`.

Four consequences:

1. **Two stores, one dead.** Filling the structured PICOTS editor changes
   nothing about what any AI sees. Filling the ✨ instruction puts PICOT
   somewhere the structured editor cannot read.
2. **The QA slot is unfillable.** The ✨ control mounts only inside
   `TemplateConfigEditor`, whose template list filters `kind: 'extraction'`
   (`frontend/components/extraction/dialogs/ProjectTemplatesList.tsx:47`).
   Quality-assessment templates have no instruction editor anywhere — on the
   surface where PICOTS matters most, because `_applicability` tells the model
   to judge "as stated in the review's general instructions (the Step-1
   PICOTS)" (`backend/app/seed_probast_ai.py:238`). Every applicability
   judgment is anchored to a bracketed note addressed to a human.
3. **The T has no editor.** `PICOTS_FIELDS` lists P, I, C, O and S
   (`frontend/components/project/settings/ReviewDetailsSection.tsx:56`).
   `timing` is stored nested (`{prediction_moment, prediction_horizon}`), never
   written by any UI, and the model default (strings) already disagrees with
   the frontend type (items).
4. **Nothing is visible before a run.** A manager cannot see what the AI will
   be told until after spending one.

## Goals

- One project-scoped review question that reaches every AI call, extraction and
  quality assessment alike.
- One editing surface for it, plus a working instruction editor for QA.
- Visible before a run, traceable after one.
- Per-run pinning, so an open run's context cannot change under it.

## Non-goals

- Rewriting the seeded `[customize: ... PICOTS ...]` tails.
  `backfill_llm_template_instructions` is fill-if-null (`backend/app/seed.py:3250`),
  so editing seed text is a no-op on existing databases and would need a
  version-gated convergence step. Worst case the model reads the review
  question twice; the new surface makes that redundancy visible.
- Making section-to-section memory optional (§9).
- Per-section selection from the article markdown (§9).
- Migrating the remaining project-settings columns off PostgREST.
- Per-run overrides of the context blocks.
- Building the scope-coherence spec's QA run-form disclosure — that stays PR3
  of its own train (§8).

## 1. Storage

No new tables, no new columns.

**`projects.picots_config_ai_review`** — `timing` flattens from
`{prediction_moment, prediction_horizon}` to a plain
`{description, inclusion[], exclusion[]}` slot like its five siblings. One
Alembic data migration, provably lossless: `PICOTS_FIELDS` has never listed
`timing`, so no UI has ever written it and it can only hold the column default.
The model default changes to match, and `updatePICOTSField`'s dotted-path
branch — dead code that existed only to reach the nested shape — goes with it.

The six storage keys are otherwise unchanged: `population`, `index_models`,
`comparator_models`, `outcomes`, `timing`, `setting_and_intended_use`.

**`projects.settings.ai_context`** — a new key on the existing JSONB:
`{"picots": true, "review_context": false, "eligibility": false}`. No
migration; read with per-key defaults, so an absent key is the default state.

`picots: true` is not a silent behaviour change: an empty PICOT renders nothing
(§2), so every existing project's prompt stays byte-identical until a manager
fills it in. §7 asserts this.

## 2. Rendering — `backend/app/services/project_ai_context.py`

```python
async def build_review_context(db, project_id) -> str | None
```

Reads the project, applies the three toggles, renders labelled blocks, returns
`None` when every enabled block is empty.

**Empty slots are omitted, not padded.** A slot with no description contributes
no line — the prompt never carries `- Comparator model(s): (not specified)`,
which the model would read as a fact about the review rather than an unfilled
form.

**One label map, in the backend.** Slot labels vary by `review_type` and use
the instrument's own wording for `predictive_model`:

| review_type      | I                 | C                   |
| ---------------- | ----------------- | ------------------- |
| interventional   | Intervention      | Comparator          |
| predictive_model | Index model(s)    | Comparator model(s) |
| diagnostic       | Index test        | Reference standard  |
| prognostic       | Prognostic factor | Comparator          |
| qualitative      | Phenomenon        | Comparator          |
| other            | Intervention      | Comparator          |

These are the exact strings the prompt emits, so the editor reads them from the
`GET` payload (§4) rather than keeping a second copy. Only UI-only text — the
section title, the help line explaining that Timing covers both the prediction
moment (T0) and the prediction horizon — lives in `lib/copy/`.

What the model receives:

```text
Review question and scope:
- Population: Adults hospitalised with acute heart failure, EF <= 40%
  Include: NYHA II-IV
  Exclude: paediatric cohorts
- Index model(s): Multimodal ML models combining imaging and EHR
- Comparator model(s): EHR-only models; established clinical risk scores
- Outcome(s): 30-day all-cause readmission
- Timing: Predicted at discharge (T0); 30-day prediction horizon
- Setting and intended use: Tertiary hospital discharge planning

General instructions for this review:
This appraisal judges the risk of bias of AI and machine-learning ...
```

## 3. Pinning and prompt injection

**Pin** — mirrors the engine. `run.results["provenance"]["review_context"]`,
first-writer-wins, re-pinned on a human kickoff, at the same call site as
`freeze_run_engine`. A Celery retry keeps attempt 1's text; editing PICOT
mid-run cannot change what an open run sees. An off or empty block pins `null`
with its reason — `"disabled"` versus `"empty"`, which are different facts a
run's reader must be able to tell apart (constitution §IX).

**Prompt** — one renderer beside the existing one, in
`backend/app/llm/prompts/__init__.py`:

```python
def render_review_context_section(body: str | None) -> str:
    if not body:
        return ""
    return f"Review question and scope:\n{body}\n\n"
```

Added to all three `_USER_TEMPLATE`s **before** `{general_instructions_section}`
— the review question frames the task, the template instruction is the more
specific guidance and stays closest to it. It goes in the user template, not
the system prompt, matching where the existing instruction lives and landing in
`PromptComposition.section_instruction`, which the review UI already renders.
Each module's `content_version(...)` canary gains
`render_review_context_section("x")` so `VERSION` bumps — intended, not
collateral: the prompts changed, so §IX requires new runs to record a new
version. Historical runs keep their own.

**Tracking is free.** `PromptComposition.section_instruction` already stores the
rendered user template, so the block appears in `GenerationDetailsDialog` with
no new provenance field and no new UI.

**One resolver, not two fetches.** `general_instructions_for_version` is
already hoisted out of the batch loop as run-constant but is fetched at four
prompt sites (`section_extraction_service.py:372`, `:548`, `:1000`,
`model_extraction_service.py:406`) plus `extraction_run_read_service.py:450`.
Rather than adding a parallel fetch beside each:

```python
resolve_run_prompt_context(db, run) -> RunPromptContext(review_context, general_instructions)
```

Four sites keep one call instead of growing to two, and the run-read service
uses the same resolver, so the run view cannot show a context different from
the one the prompts got.

### 3a. How context reaches each section

Batch extraction is one LLM call per section, sequential:

```text
run start
 |- assemble article ONCE                 -> pdf_text (budget 96,000 tokens)
 |- resolve run-constant context ONCE     -> review context + instruction
 \- for each section k = 1..N             (one LLM call each)
      prompt =
        review context           <- same every call   (NEW)
      + general instruction      <- same every call
      + section name/description <- varies
      + memory: summaries of k-1 <- grows, <=200 chars each
      + article text             <- same every call, <=96,000 tokens
```

The review context is injected fresh into every call, not carried by the memory
summaries, so section 14 sees the same PICOT as section 1 — it cannot decay or
be truncated away by the 200-character summary budget. The token cost is noise:
~150 tokens against a 96,000-token article budget re-sent every call anyway,
under 0.2%.

Article assembly is unchanged. `build_prompt_input` already prefers the stored
`content_markdown` when it fits the budget and falls back to the block
assembler (IMRaD whole-section dropping) only when it does not.

## 4. API

`GET` / `PUT /api/v1/projects/{project_id}/ai-context`, `PUT` behind the
existing `require_project_manager` (`backend/app/api/deps/security.py:139`),
matching the manager-only `project_update` RLS policy.

`GET` returns the structured PICOT, its slot labels for the project's review
type, the three block states, and a server-rendered `preview` — the exact text
a run started now would pin. The popover never re-renders that text
client-side, so the screen cannot show something the AI did not get.

`npm run generate:api-types` output is committed, or the `api-contract` CI job
fails.

## 5. UI

### 5a. Two new components, nothing refactored

`TemplateInstructionControl` (219 lines, not baselined, ~581 lines of headroom)
is **not touched**. It is already kind-agnostic — props are `{projectId,
templateId}` and `template_instruction_service` has no kind filter — so it
mounts unchanged on both screens.

Two components are new, both used by every screen that needs them:

- `AiContextProjectBlocks` — the three project blocks plus the preview
  disclosure, presentation-neutral so each screen wraps it in whatever
  container fits (a popover on the bar, a card on a settings page).
- `PicotsEditDialog` (§5d) — the single PICOT editor, opened from three
  triggers.

Nothing else is created, moved, or refactored.

Copy goes in a new `frontend/lib/copy/aiContext.ts`. It cannot go in
`lib/copy/extraction.ts`, which is 862 lines against a baseline cap of 864.

### 5b. Extraction — the bar's own divider does the teaching

The config bar already separates the project regime from the versioned-template
regime with `BarDivider`. The new **Project context** chip goes on the project
side, next to the engine; the ✨ instruction chip stays on the template side,
unchanged and unrenamed.

```text
14 sections  |  (engine) GPT-5.6 Luna · Fast   (o) Project context  |  * General AI instruction   import  |  Published v1  undo  Publish
             |<------------ project regime ------------>|<----------- versioned-template regime ----------->|
```

That is one more chip than today, and it buys back a merged popover with two
hand-written regime captions explaining a distinction the bar already draws.
The structural fact — PICOT applies to the next run, the instruction ships on
Publish — is carried by the divider that already means exactly that.

Popover contents:

```text
+- Project context ----------------------------+
|  [x] Review question (PICOTS)     6 of 6   e |
|  [ ] Review context                    -   > |
|  [ ] Eligibility criteria        12 items  > |
|  > Preview what is sent                      |
+----------------------------------------------+
```

`6 of 6` is a filled-slot count, the same idiom as the bar's existing
`1 to customize`, making an empty letter visible before it becomes invisible to
the AI. The `e` affordance opens the shared PICOT dialog; the `>` on the other
two deep-links to where they already live (Review tab and Advanced tab), which
requires `ProjectSettings` to accept its initial tab from the URL — local state
today.

### 5c. Quality assessment — the same two parts, composed for a page

The QA Configuration tab gets both regimes, laid out vertically: the project
context once, the instruction per template.

```text
QA Configuration
+- Project context ----------------------------+   project regime, once
|  [x] Review question (PICOTS)     6 of 6   e |
|  [ ] Review context                    -   > |
|  [ ] Eligibility criteria        12 items  > |
|  > Preview what is sent                      |
+----------------------------------------------+
+- Assessment tools ---------------------------+   template regime, per tool
|  PROBAST+AI  2.1.0                      [x]  |
|    * AI instruction (!)1   Draft 1  undo  ^  |
|  QUADAS-2  1.0.0                        [x]  |
|    * AI instruction         Published v3     |
|  PROBAST (classic)                      [ ]  |
+----------------------------------------------+
```

Per enabled tool row, `TemplateInstructionControl` and
`TemplateConfigPublishControls` mount verbatim. **No new components and no
backend work**: every endpoint behind them resolves ownership by
`(id, project_id)` with no kind predicate, and QA templates already carry a
full version lineage because `TemplateCloneService.clone` calls the same
`TemplateVersionService.republish` for every QA clone.

Publish stays behind the diff sheet, as B-9b2b made it — a QA publish that
skipped the diff would reopen the hole that change closed.

Wiring notes:

- The active clone id is already computed inline inside `toggle`
  (`templates.find(tpl => tpl.global_template_id === global.id && tpl.is_active)`).
  Hoist it to one helper consumed by both render and toggle.
- Diff-sheet open state is hoisted to `QualityAssessmentConfiguration`, keyed by
  template id — the same reason extraction hoists it: two modal sheets must
  never stack, and here N rows could each open one.
- **Export and Import are not mounted.** They are the only two publish-family
  endpoints hard-gated to extraction: `to_portable` 404s on a QA id and
  `parse_portable_document` 422s.
- Publishing does not freeze `schema_`, which carries QA's `derived_judgments`
  and `scope_rules`. Only `entity_types` and `llm_template_instruction` are
  versioned, and `schema_` is overwritten from the global on every session open.
  Not a regression, but "Published · v3" must not be read as pinning the scope
  rules.
- `TemplateConfigDiffSheet` copy assumes structural changes; for a QA template
  the only diff is the instruction. Its wording is checked at implementation.

### 5d. One editor for PICOT, three triggers

`PicotsEditDialog` owns its own query, mutation and Save, and mounts six
untouched `PICOTSItemEditor` instances (103 lines, controlled, unchanged) with
labels from the `GET` payload. It opens from the extraction bar's Project
context popover, the QA Configuration card, and Project Settings → Review tab,
which becomes a read-only summary plus the same Edit button.

That pulls `picots_config_ai_review` out of `useProjectSettings`' batched draft
— one write path — and `ReviewDetailsSection` sheds roughly a hundred lines of
array and dotted-path helpers. Project Settings keeps writing its other columns
over PostgREST: two writers on one row, disjoint column sets, neither clobbers
the other.

### 5e. Manager gating

`project_update` RLS is manager-only, and both new surfaces are reachable by
non-managers: Project Settings' Review tab lets a reviewer type into PICOTS and
discover it on save failure, and the QA Configuration tab is hidden only by a
navigation filter (`SectionViewSwitcher.tsx:25`) — `?qaTab=configuration`
renders it for any project member. Every toggle and Edit trigger on both
surfaces is disabled-with-tooltip for non-managers via the existing
`useProjectMemberRole`.

## 6. Data flow

```text
projects.picots_config_ai_review + projects.settings.ai_context
        |  (manager edits via PicotsEditDialog / toggles)
        v
PUT /api/v1/projects/:id/ai-context      [require_project_manager]
        |
        v
build_review_context(db, project_id) -> str | None
        |  (at run start, first-writer-wins)
        v
run.results.provenance.review_context = {text, enabled, reason}
        |
        v
resolve_run_prompt_context(db, run)
        |
        +--> render_review_context_section  --> every LLM call
        +--> PromptComposition.section_instruction --> GenerationDetailsDialog
```

## 7. Tests

**First, the one that converts inference into evidence.** No backend test
anywhere exercises `POST .../republish-version` or `PUT .../llm-instruction`
against a `quality_assessment` template id; that they accept one is read from
the absence of a kind predicate. Since §5c rests entirely on it, an integration
test asserting both against a QA template is written before anything else.

**Backend unit.** `build_review_context` renders six slots with
instrument-exact labels, omits empty slots, returns `None` when every enabled
block is empty, and switches labels by `review_type`. Prompt: `VERSION` changes
(the canary works), the block precedes the general instruction, and **an empty
context produces a byte-identical prompt to today's** — the no-regression proof
for the `picots: true` default. Pin: first-writer-wins, a Celery retry keeps
attempt 1's text, a human kickoff re-pins, a disabled block pins `null` with
its reason. Migration: flattened `timing` through the existing
`test_migration_roundtrip`.

**Backend integration.** `PUT /ai-context` returns 200 as manager, 403 as
reviewer, **404 on a foreign project id** (BOLA is a named recurring class
here). End-to-end: set PICOT, start a run, assert
`provenance.review_context` matches and `prompt_composition.section_instruction`
contains the block.

**Frontend.** QA Configuration renders the instruction control and publish
cluster only for enabled tools, and only one diff sheet can open at a time;
both surfaces disable their controls for non-managers; toggles invalidate their
key family; the preview renders the server string verbatim; the PICOT dialog is
the same component from all three triggers.

**E2E.** One flow: QA Configuration → ✨ → edit the instruction → publish →
extract a domain → the generation details dialog shows both blocks.

**Gates.** `make quality-scan`, knip at zero in both modes, committed
`generate:api-types` output.

## 8. Amendment to the scope-coherence spec

`docs/superpowers/specs/2026-08-26-probast-ai-scope-coherence-design.md` §3
specifies the Step-1 PICOTS disclosure's null state as "one muted 'not
configured' line naming where to set it (the template's ✨ instruction)" — a
screen QA cannot reach. That copy is amended to name the QA Configuration tab,
which §5c makes real.

Two notes are added there for PR3, which still owns the disclosure: it must
first split `frontend/pages/QualityAssessmentFullScreen.tsx` (1012 lines,
exactly at its baseline cap) and `frontend/test/QualityAssessmentFullScreen.test.tsx`
(1594, likewise), because the disclosure mounts in the first and its test in the
second. PR2 already put `general_instructions` on the wire
(`schema.d.ts:5060`, `hooks/runs/types.ts:243`); no frontend component reads it
yet.

## 9. Follow-ups

- **The zero-state heal publishes an unpublished draft.**
  `TemplateCloneService.clone`'s zero-state branch calls `republish` without
  `fail_if_pending_draft` (`template_clone_service.py:154`) while its sibling
  drift branch passes the flag (`:161`). Because `HITLSessionService` clones on
  every QA session open and that endpoint is member-gated, any project member
  can promote a manager's pending draft and clear the draft marker. Tracked
  separately.
- **Section-to-section memory as a toggle.** Memory exists only on the
  model-children batch path; QA's `extract_all_for_run` never passes
  `memory_context`, so PROBAST domain judgments are already independent and
  there is no bias vector to close. Turning it off is a behaviour change to
  existing extraction that deserves its own evidence.
- **Per-section selection from the article markdown.** `assemble()` already
  implements a `focus` hint (`backend/app/llm/assembler.py:30`) that no caller
  has ever passed. It only changes which sections drop when over budget, so
  real selection means a smaller per-call budget — trading tokens against
  recall. Must not share a PR with this change: this alters what the AI is
  *told*, that alters what it is *shown*, and combined any quality shift is
  unattributable.
- **Retiring the seeded PICOTS `[customize:]` tails** once a version-gated seed
  convergence step exists.

## 10. Documentation

`docs/reference/templates/probast-ai-instrument.md:36` documents the workaround
this replaces — "The project template's ✨ instruction. Fill it with the
review's PICOTS" — and is updated in the same change.

## Implementation status

Shipped in three slices. Slice 1 (backend spine) is complete; 2 and 3 are queued.

| Slice | Scope | Status |
| --- | --- | --- |
| 1 | §2 rendering, §3 pin + prompt, §7 backend tests, §10 docs | shipped |
| 2 | §1 storage flatten, §4 API, §5a/5d/5e (PICOT dialog, Project Settings, gating) | shipped |
| 3 | §5b extraction-bar chip, §5c QA Configuration tab | shipped |

§8's amendment is no longer part of slice 3: its text was applied to
`2026-08-26-probast-ai-scope-coherence-design.md` in `cc7aa3bc`, ahead of the
§5c screen it points at.

Five claims above did not survive contact with the code; slice 1 deviates from
the spec accordingly for the first four, and the fifth is a stale ownership
assignment:

1. **§Problem(3) and §1 are wrong: `timing` IS written by the UI.**
   `ReviewDetailsSection.tsx` renders a hardcoded accordion writing
   `timing.prediction_moment` / `timing.prediction_horizon` through
   `updatePICOTSField`'s dotted-path branch. The flatten is therefore NOT
   "provably lossless" — and its realistic input is a dict beside a string
   (editing one half spreads the parent), which a naive merge destroys. §1
   moves to slice 2, where §5d rewrites the editor: the migration and its only
   writer must land together, and the reader must accept BOTH shapes
   permanently, because Railway and Vercel deploy independently and a cached
   SPA keeps the old writer.
2. **The ORM's string-shaped default has never fired.** No backend code
   constructs `Project(...)` and the column has no server default. The renderer
   tolerates the shape; nothing is designed around it.
3. **§7's "404 on a foreign project id" is unreachable.** `require_project_manager`
   returns 403 for a non-manager AND for a foreign project — oracle-free either
   way. Slice 2's tests assert 403/403.
4. **§3's "re-pinned on a human kickoff" is dropped.** `freeze_engine` may
   overwrite only because per-proposal provenance (0056) records the engine on
   every row; nothing records the review context per proposal, so a re-pin would
   make the run-level field misdescribe sections extracted under the previous
   text. First-writer-wins is permanent for the run.
5. **§8's "PR3, which still owns the disclosure" was written before #751
   merged.** PR3 shipped (`3e9370ce`) without the Step-1 PICOTS disclosure, and
   the scope-coherence plan defers it to its own design pass. No slice here
   claims it either — §5c mounts the instruction control and its publish
   cluster, not the disclosure — so the disclosure is currently unassigned, and
   the §5c screen it depends on is the queued slice 3 above. The preconditions
   §8 lists are also stale: `QualityAssessmentFullScreen.tsx` has since shrunk
   below its 1012-line baseline (`check_file_size.py` only fails on growth), so
   only the test file at 1594 is still exactly at cap.

Two further changes to §3: the pin payload is `{"text": ...}` alone — `enabled`
and `reason` had no reader in any of the three slices and are derived — and
`RunViewResponse` gains a `review_context` field, without which the run view
would show the template instruction the model got while hiding the review
question it also got.

Slice 3 is BLOCKED on §9's first follow-up: `TemplateCloneService.clone`'s
zero-state branch republishes without `fail_if_pending_draft`, and the QA
session-open path that reaches it is member-gated. Do not ship §5c's publish
controls before that is closed.

### Slice 2 notes

`AiContextProjectBlocks` (§5a) was NOT built. Slice 1 dropped the
`review_context` and `eligibility` toggles — their shapes are contradicted three
ways in-tree and neither had a reachable writer — so only `picots` remains. A
dedicated three-block component for one switch is speculation; the switch lives
in `PicotsEditDialog`.

Three defects found while building it, all pre-existing and none cosmetic:

1. `saveProjectSettings` issues `.update()` with no `.select()`, so an
   RLS-filtered write matches zero rows and returns NO error. §5e's premise —
   that a reviewer "discovers it on save failure" — was wrong; the reviewer saw
   a SUCCESS toast and lost the edit. Gating is a correctness fix.
2. `addArrayItem`/`removeArrayItem` looked up `picots['timing.prediction_moment']`,
   a key that never existed, so a Timing slot's criteria list could only ever
   hold 0 or 1 entry.
3. A row can carry the flat AND nested `timing` shapes at once — reachable in
   the window between migration 0063 and the frontend deploy. Both the migration
   and the renderer merge them rather than branching either/or.
