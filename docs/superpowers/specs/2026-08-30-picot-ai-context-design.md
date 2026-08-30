---
status: draft
last_reviewed: 2026-08-30
owner: '@raphaelfh'
---

# PICOT in the AI context — one project-scoped review question, pinned per run

## Problem

`projects.picots_config_ai_review` is a JSONB column whose name promises it
feeds the AI. It feeds nothing.

`grep` finds it exactly once in the backend — the model declaration at
`backend/app/models/project.py:88`. No service reads it, no prompt renders
it, no run pins it. The same holds for every sibling review field:
`condition_studied`, `review_rationale`, `eligibility_criteria`,
`review_context`, `search_strategy` all have zero backend reads.

What actually reaches the model is one text. `render_general_instructions_section`
(`backend/app/llm/prompts/__init__.py:17`) prepends
`General instructions for this review:\n{text}` to all three prompts
(section extraction, quality assessment, model identification), and that text
is `general_instructions_for_version(run.version_id)` — the version-pinned
`llm_template_instruction` from the template snapshot.

So PICOT reaches the AI only as **hand-typed prose**. Five seeded templates
carry a `[customize: ...]` slot asking the manager to retype it, most
pointedly PROBAST+AI:

> `[customize: state the review's Step-1 PICOTS — Population, Index model(s),
> Comparator model(s), Outcome(s), Timing, Setting/intended use — which every
> applicability judgment is made against]`

Four consequences compound:

1. **Two stores, one of them dead.** A manager who fills the structured
   PICOTS editor in project settings changes nothing about what any AI sees.
   A manager who fills the ✨ instruction has PICOT in a place the structured
   editor cannot read. Neither knows about the other.
2. **The QA slot is unfillable.** The ✨ control mounts only inside
   `TemplateConfigEditor`, and its template list filters `kind: 'extraction'`
   (`frontend/components/extraction/dialogs/ProjectTemplatesList.tsx:47`).
   Quality-assessment templates have no instruction editor anywhere in the
   product, so PROBAST+AI's PICOTS slot cannot be resolved through the UI at
   all — on the surface where PICOTS matters most, because applicability is
   judged directly against it.
3. **The T has no editor.** `PICOTS_FIELDS` lists P, I, C, O and S
   (`frontend/components/project/settings/ReviewDetailsSection.tsx:56`).
   `timing` is stored under a different, nested shape
   (`{prediction_moment, prediction_horizon}`) that no UI has ever written,
   and the model default (strings) already disagrees with the frontend type
   (items).
4. **Nothing is visible before a run.** A manager cannot see what the AI will
   be told until after spending a run and opening the generation details.

## Goals

- One project-scoped review question that actually reaches every AI call,
  extraction and quality assessment alike.
- One editing surface for it, reachable from where the manager already is.
- Visible before a run, and traceable after one.
- Per-run pinning, so an open run's context cannot change under it.

## Non-goals

- Rewriting the seeded `[customize: ... PICOTS ...]` tails.
  `backfill_llm_template_instructions` is fill-if-null
  (`backend/app/seed.py:3250`), so editing the seed text is a no-op on every
  existing database and would need a version-gated convergence step to land.
  Worst case the model reads the review question twice; the new popover makes
  that redundancy visible so a manager can clear it.
- A quality-assessment ✨ instruction editor (see §6 — it would be a trap
  without a QA publish path).
- Making section-to-section memory optional (see §9).
- Per-section selection from the article markdown (see §9).
- Migrating the remaining project-settings columns off PostgREST.
- Per-run overrides of the context blocks.
- The QA run-screen pinned disclosure, already specified in
  `2026-08-26-probast-ai-scope-coherence-design.md` §2d/§3.

## 1. Storage

No new tables and no new columns.

**`projects.picots_config_ai_review`** — `timing` flattens from
`{prediction_moment, prediction_horizon}` into a plain
`{description, inclusion[], exclusion[]}` slot like its five siblings. One
Alembic data migration, provably lossless: `PICOTS_FIELDS` has never listed
`timing`, so no UI has ever written it and it can only hold the column
default. The model default changes to match, and `updatePICOTSField`'s
dotted-path branch — dead code that existed only to reach the nested shape —
goes with it.

The six storage keys are otherwise unchanged: `population`, `index_models`,
`comparator_models`, `outcomes`, `timing`, `setting_and_intended_use`.

**`projects.settings.ai_context`** — a new key on the existing JSONB:

```json
{"picots": true, "review_context": false, "eligibility": false}
```

No migration. Read with per-key defaults `true / false / false`, so the
absence of the key is the default state.

The `picots: true` default is **not** a silent behaviour change: an empty
PICOT renders nothing (§2), so every existing project's prompt stays
byte-identical until a manager fills it in. §8 asserts this.

## 2. Rendering — `backend/app/services/project_ai_context.py`

```python
async def build_review_context(db, project_id) -> str | None
```

Reads the project row, applies the three toggles, renders labelled blocks,
and returns `None` when every enabled block is empty.

**Empty slots are omitted, not padded.** A slot with no description
contributes no line. The prompt never carries
`- Comparator model(s): (not specified)`, which the model would read as a
fact about the review rather than an unfilled form.

Prompt labels vary by `review_type` from a backend-owned map, using the
instrument's own wording for `predictive_model`:

| review_type      | I                  | C                        |
| ---------------- | ------------------ | ------------------------ |
| interventional   | Intervention       | Comparator               |
| predictive_model | Index model(s)     | Comparator model(s)      |
| diagnostic       | Index test         | Reference standard       |
| prognostic       | Prognostic factor  | Comparator               |
| qualitative      | Phenomenon         | Comparator               |
| other            | Intervention       | Comparator               |

`Timing`'s help text carries both senses the instrument defines — the
moment/T0 at which the prediction is made, and the prediction horizon — so
flattening the storage does not lose the second one.

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

### 2a. One deliberate duplication

The backend's prompt labels and the frontend's editor labels are two maps.
They are not the same concern: one is prompt content the model reads, the
other is UI chrome under `lib/copy/`. The shared contract is the six keys,
asserted by a test against the endpoint payload.

The popover never re-renders the prompt text client-side. It displays the
server's `preview` string, so the screen physically cannot show a text the AI
did not get.

## 3. Pinning — mirrors the engine

`run.results["provenance"]["review_context"]`, first-writer-wins, re-pinned on
a human kickoff, at the same call site as `freeze_run_engine`
(`backend/app/services/run_engine_freeze.py`). A Celery retry keeps attempt
1's text; editing PICOT mid-run cannot change what an open run sees.

An off or empty block pins `null` **with its reason** — `"disabled"` when the
toggle is off, `"empty"` when it is on but has no content — so provenance
records the choice rather than dropping it silently (constitution §IX: a "no
information" outcome is a recorded proposal). The two are not the same fact
and a reader of the run must be able to tell them apart.

## 4. Prompt injection

One new shared renderer beside the existing one, in
`backend/app/llm/prompts/__init__.py`:

```python
def render_review_context_section(body: str | None) -> str:
    if not body:
        return ""
    return f"Review question and scope:\n{body}\n\n"
```

Added to all three `_USER_TEMPLATE`s **before** `{general_instructions_section}`
— the review question frames the task, the template instruction is the more
specific guidance and stays closest to it. It goes in the **user** template,
not the system prompt, matching where the existing instruction lives and
landing in the `PromptComposition.section_instruction` field the review UI
already renders.

Each module's `content_version(...)` canary gains
`render_review_context_section("x")`, so `VERSION` bumps. That is intended,
not collateral: the prompts changed, so §IX requires new runs to record a new
prompt version. Historical runs keep their own.

**Tracking is free.** `PromptComposition.section_instruction` already stores
the rendered user template, so the block appears in `GenerationDetailsDialog`
with no new provenance field and no new UI.

### 4a. One resolver, not two parallel fetches

`general_instructions_for_version` is already hoisted out of the batch loop as
run-constant, but it is fetched at four prompt sites
(`section_extraction_service.py:372`, `:548`, `:1000`,
`model_extraction_service.py:406`) plus once in
`extraction_run_read_service.py:450`. Rather than adding a second parallel
fetch beside each:

```python
resolve_run_prompt_context(db, run) -> RunPromptContext(review_context, general_instructions)
```

Four sites keep one call instead of growing to two, and the run-read service
uses the same resolver — so the run view cannot show a context different from
the one the prompts got.

### 4b. How context reaches each section

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

The review context is injected fresh into every call, **not** carried by the
memory summaries, so section 14 sees exactly the same PICOT as section 1 — it
cannot decay or be truncated away by the 200-character summary budget. That
is why per-call repetition is correct rather than stating it once per batch.

The token cost is noise: a six-slot PICOT block is roughly 150 tokens against
a `LLM_ASSEMBLY_BUDGET_TOKENS` of 96,000 that is re-sent on every call
anyway — under 0.2%. Even section 14's accumulated memory (13 × 200 chars)
is larger.

Article assembly itself is unchanged. `build_prompt_input` already prefers the
stored `content_markdown` whenever it fits the budget and only falls back to
the block assembler (IMRaD whole-section dropping) when it does not.

## 5. API

`GET` / `PUT /api/v1/projects/{project_id}/ai-context`, `PUT` behind the
existing `require_project_manager` (`backend/app/api/deps/security.py:139`),
matching the `project_update` RLS policy which is manager-only.

`GET` returns the structured PICOT (for the editor), the three block states,
and a server-rendered `preview` — the exact text a run started right now would
pin. That preview is what answers "is my context reaching the AI?" before
spending a run.

`npm run generate:api-types` output is committed, or the `api-contract` CI job
fails.

## 6. UI

### 6a. The config bar does not grow

The ✨ slot keeps its position and width; only what it opens changes. Its
label becomes "AI context". Its accessible name still composes from visible
content — title, slot chip, unsaved dot — via `sr-only` /
`not-sr-only`, never an `aria-label`, which would replace the composed name
and erase the warning for exactly the users who cannot see the amber chip
(`.claude/rules/frontend.md`).

### 6b. The popover stays short

The engine popover reached 544px and had to be split in #726. This one must
not repeat that, so the project blocks are rows and the editing is a dialog:

```text
+- AI context ---------------------------------+
| PROJECT - applies to the next run            |
|  [x] Review question (PICOTS)     6 of 6   e |
|  [ ] Review context                    -   > |
|  [ ] Eligibility criteria        12 items  > |
|----------------------------------------------|
| TEMPLATE - ships on Publish                  |
|  General instruction                   (!) 1 |
|  [textarea..................................] |
|                         Cancel      Save     |
|----------------------------------------------|
|  > Preview what is sent                      |
+----------------------------------------------+
```

The two regime captions are the point of merging: a manager reads *live*
versus *ships on Publish* in one glance instead of inferring it from a
divider.

`6 of 6` is a filled-slot count, the same idiom as the bar's existing
`1 to customize`, making an empty letter visible before it becomes invisible
to the AI. **Preview what is sent** expands to the server's `preview` string
verbatim.

The `e` (edit) affordance on PICOT opens the shared dialog. The `>` on the
other two deep-links to where they already live — Review tab and Advanced tab
— which requires `ProjectSettings` to accept its initial tab from the URL (it
is local state today).

### 6c. One editor, three mounts

`PicotsEditDialog` owns its own query, mutation and Save, and mounts six
untouched `PICOTSItemEditor` instances (103 lines, controlled, unchanged) with
labels from the per-type map. It is opened from three places:

1. the ✨ AI context popover on the extraction Configuration tab;
2. the ✨ AI context popover on the QA Configuration tab (§6d);
3. Project Settings → Review tab, which becomes a read-only summary plus the
   same Edit button.

That pulls `picots_config_ai_review` out of `useProjectSettings`' batched
draft entirely — one write path — and `ReviewDetailsSection` sheds roughly a
hundred lines of array and dotted-path helpers.

Project Settings keeps writing its other columns over PostgREST. Two writers
on one row, but disjoint column sets, so neither clobbers the other.

### 6d. Quality assessment

The same `AiContextControl` mounts on the QA Configuration tab, once per
enabled tool row (`QualityAssessmentConfiguration` already resolves the active
project-template clone per global). The project blocks are shared state on one
query key, so toggling in the QA popover updates the extraction bar and every
other QA row at once — one truth, however many mounts.

**The ✨ instruction section stays extraction-only**, and not for lack of DRY.
`set_template_instruction` only *stages* a draft
(`backend/app/services/template_instruction_service.py`); the text reaches
prompts solely through `republish`, and QA has no Publish control anywhere.
Mounting the editor there would let a manager type, see "Saved", and have it
never reach a single prompt — worse than no editor. A QA publish path is a
follow-up (§9).

The headline still lands: PICOT reaches QA runs structurally and is editable
from the QA tab, which is what PROBAST+AI's unfillable `[customize: ...]` slot
was asking for.

### 6e. Files — nothing grows

`TemplateInstructionControl` is 215 lines of subtle draft-ownership
behaviour. It is split rather than extended, with the instruction editor
**moved verbatim** so its tested behaviour survives intact.

| File                          | Role                                    |
| ----------------------------- | --------------------------------------- |
| `AiContextControl.tsx`        | trigger + popover shell, owns drafts    |
| `AiContextProjectBlocks.tsx`  | the three rows + preview disclosure     |
| `TemplateInstructionSection.tsx` | textarea + buttons, moved as-is      |
| `PicotsEditDialog.tsx`        | the shared editor dialog                |
| `PICOTSItemEditor.tsx`        | unchanged                               |

The draft stays owned by the parent, outside Radix's popover content — the
existing invariant that stops a stray Escape from destroying 4000 characters
of prose.

### 6f. Manager gating, fixed while we are here

`project_update` RLS is manager-only, but today's Review tab lets a reviewer
type into PICOTS and discover it on save failure. The toggles and both Edit
triggers become disabled-with-tooltip for non-managers via the existing
`useProjectMemberRole`.

## 7. Data flow

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
        |
        +--> PromptComposition.section_instruction --> GenerationDetailsDialog
```

## 8. Tests

**Backend unit.** `build_review_context` renders six slots with
instrument-exact labels, omits empty slots, returns `None` when every enabled
block is empty, and switches labels by `review_type`. Prompt: `VERSION`
changes (the canary works), the block precedes the general instruction, and
**an empty context produces a byte-identical prompt to today's** — the
no-regression proof for the `picots: true` default. Pin: first-writer-wins, a
Celery retry keeps attempt 1's text, a human kickoff re-pins, a disabled block
pins `null` with its reason. Migration: flattened `timing` through the
existing `test_migration_roundtrip`.

**Backend integration.** `PUT /ai-context` returns 200 as manager, 403 as
reviewer, **404 on a foreign project id** (BOLA is a named recurring class
here). End-to-end: set PICOT, start a run, assert
`provenance.review_context` matches and `prompt_composition.section_instruction`
contains the block.

**Frontend.** The trigger's accessible name composes title + chip + unsaved
dot (the exact regression `.claude/rules/frontend.md` pins); toggles
invalidate their key family; non-managers get disabled controls; the preview
renders the server string verbatim rather than re-rendering client-side; the
dialog is the same component from all three mounts.

**E2E.** One flow: Configuration → ✨ → edit PICOT → save → preview shows it →
extract a section → the generation details dialog shows the block.

**Gates.** `make quality-scan`, knip at zero in both modes, committed
`generate:api-types` output.

## 9. Follow-ups

- **Section-to-section memory as a toggle.** Memory exists only on the
  model-children batch path (`_extract_section_with_memory`); QA's
  `extract_all_for_run` never passes `memory_context`, so PROBAST domain
  judgments are already independent and there is no bias vector to close.
  Turning memory off is a behaviour change to existing extraction that
  deserves its own evidence.
- **Per-section selection from the article markdown.** `assemble()` already
  implements a `focus` hint that promotes a named IMRaD section to top rank
  (`backend/app/llm/assembler.py:30`), `assemble_for_model` forwards it, and
  no caller has ever passed it. It only changes which sections get *dropped
  when over budget*, so real per-section selection means a much smaller
  per-call budget — trading tokens against recall, since the dropped section
  may hold the answer. Needs a measured recall check, and must not share a PR
  with this change: this alters what the AI is *told*, that alters what it is
  *shown*, and combined any quality shift is unattributable.
- **A QA publish path**, which would unblock §6d's instruction editor.
- **Retiring the seeded PICOTS `[customize:]` tails** once a version-gated
  seed convergence step exists.

## 10. Documentation

`docs/reference/templates/probast-ai-instrument.md:36` currently documents the
workaround this replaces — *"The project template's ✨ instruction. Fill it
with the review's PICOTS"* — and is updated in the same change.
