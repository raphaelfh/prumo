---
status: approved
last_reviewed: 2026-09-17
owner: '@raphaelfh'
---

# AI always extracts out-of-scope sections — design

> PROBAST+AI's study-type `scope_rules` are evaluated in six places. Four
> decide what a value **means**. Two decide whether the model is **asked**:
> the backend's AI-path filter, and the frontend's per-section AI button,
> which reaches the same rule through the form's own scope read. This removes
> both asking-gates and none of the meaning ones. Nothing about what "out of
> scope" means changes: the form still badges those domains, the derivation
> still ignores them, the export still marks them.
>
> Reached through an adversarial pass that killed three earlier proposals
> (a per-trigger request flag, a per-run switch column, a per-proposal
> provenance key), then through eight spec-gate passes. Those confirmed the
> design every time and corrected the spec's account of the code; the last
> ones found only fixture-construction detail, which §6.7 hands to the plan by
> ruling. Section 3 records what the code actually does, because most of the
> rejected proposals died on facts rather than on taste.

## 1. Problem

A PROBAST+AI assessment classifies the study at Step 2 (`assessment_scope`
→ `study_type`). `development_only` takes the seven evaluation domains out
of play; `evaluation_only` takes the four development domains. The rule is
declared data on the template's `schema` JSONB — `_PAI_SCOPE_RULES` in
`backend/app/seed_probast_ai_data.py`, attached at
`backend/app/seed_probast_ai.py:726`.

The reviewer wants the AI to fill the whole instrument regardless of that
classification — a safety net when the classification is wrong, contested,
or changed mid-assessment — **without** those values counting toward any
verdict.

## 2. Decisions (locked)

| Question | Decision | Why |
|---|---|---|
| What happens to values on an out-of-scope section? | Stored, but still out of scope everywhere downstream | The reviewer wants coverage, not a different verdict. Keeps the four downstream layers untouched. |
| Who decides, at what granularity? | Nobody — always on | The switch was costed and rejected as premature: see §3.2, half the cost is already being paid today. |
| Per-proposal provenance key? | No | Redundant, and the per-section snapshot is last-write-wins, so a key there would be relabelled by the next re-extraction and lie. |
| Does this also open assessor-owned fields to the model? | No | `excluded_coordinates` is a different rule and stays exactly as is. |
| Does `LlmFieldFilter` survive as a dataclass with one field? | Yes | It names "what the model may see" and both consumers already read `.excluded_coordinates`. Collapsing it is more churn than it removes. |
| `TestScopeGuardWiring` — collapse or delete? | Delete the class | Its stated claim ("the section is skipped") ceases to exist, and its fixture patches a symbol §4 deletes. See §6. |
| Pin §3.2 with a characterization test? | No — dropped by ruling | It backs only §7's cost estimate, six independent code traces already establish it, and it carried most of the test's fixture complexity. See §6.2. |
| Where do test-fixture details live? | In the plan (§6.7 hands them over) | They are exact-code content; `writing-plans` writes it and the ship-panel reviews it. A spec gate applied to them does not converge. |

## 3. What the code does today

### 3.1 The six evaluation sites

`scope_rules` is evaluated independently, where it acts, by:

1. `frontend/lib/qa/studyTypeScope.ts` — the form's muted label and
   "Out of scope for this study type" badge, plus section nav.
2. `frontend/lib/qa/scopedProgress.ts` — worklist progress.
3. `backend/app/services/derived_judgment_payload.py` — drops out-of-scope
   values before deriving a domain or overall judgment.
4. `backend/app/services/exports/extraction_scope_marking.py` — marks those
   cells in the workbook.
5. `backend/app/services/llm_field_filter.py` — decides whether the model is
   asked at all.
6. `frontend/components/assessment/QASectionAccordion.tsx:368` — the per-section
   AI button, gated through layer 1's `outOfScopeSectionsOnForm`. Also decides
   whether the model is asked.

Layers 1–4 answer "what does this value mean". Layer 5 answers "do we spend a
token on it" — **and so does one consumer of layer 1**: the per-section AI
button at `frontend/components/assessment/QASectionAccordion.tsx:368`, gated by
`outOfScopeSectionsOnForm` (`frontend/pages/QualityAssessmentFullScreen.tsx:514`,
`:948`). Those two asking-gates are exactly what §4 removes. Layer 1 keeps its
other uses — badge, muted title, section nav — and layers 2–4 are untouched, so
no value changes meaning.

### 3.2 The read/write asymmetry (the cost argument)

**Established by code tracing, not by a test.** Six independent spec-gate
passes traced this mechanism against the tree and each confirmed it (run
ledger). It backs one thing only — the cost estimate in §7. If it were wrong,
always-on would cost more than §7 states and nothing else would change: the
decision was made with the cost stated. A characterization test was designed
for it and **dropped by ruling** — see §6.

The read side memoises the filter once per pass —
`SectionExtractionService._field_filter` caches by `run.id`, resolved from
the single call at `entry_group_extraction.py:292`. The write side
re-resolves per section, inside the savepoint, via `locked_result_filter`
(`section_extraction_service.py:1727`, `entry_group_extraction.py:171`).

`assessment_scope` is entry 1 of `_SECTIONS` in
`backend/app/seed_probast_ai.py:424`. So on a run where nobody has answered
`study_type` yet:

1. Section 1 (`assessment_scope`) starts. The read filter is resolved **inside
   that section's own extraction** — `_extract_singleton` calls
   `service._field_filter(run)` at `entry_group_extraction.py:292`, immediately
   before the LLM call and before anything has been written. No classifier
   proposal exists yet, so `out_of_scope` is empty, and `_field_filter`
   memoises it on the service for the rest of the sweep.
2. Section 1's own write re-resolves the filter, but the classifier proposal is
   the thing it is about to write, so that resolution is empty too. The AI's
   `development_only` answer lands.
3. Sections 2–13: the read side still holds the memoised empty filter, so the
   LLM **is called** for all four development and all seven evaluation domains.
4. Each of those writes re-resolves, now finds the classification, and discards
   the seven evaluation domains' candidates.

The tokens are already spent and the results thrown away, ordering-dependently
and silently. The extra cost of always-on is therefore confined to two cases:
a human who classified before triggering the AI, and any repeat pass once a
classification exists.

### 3.3 The entry-group branch is unreachable on seeded data

`entry_group_extraction.py:179` applies the same scope check on the repeating
-section path. That path cannot be reached by any template that declares scope
rules: `scope_rules` is declared only by PROBAST+AI
(`backend/app/seed_probast_ai.py:726`), and no section in
`seed_probast_ai.py` / `seed_probast_ai_data.py` sets `cardinality` or
`entry_label`, so every one of them is the model default `'one'` and takes the
singleton path.

Consequence for §6: the branch is deleted with the rest and needs **no
dedicated acceptance test** — there is no seeded configuration that exercises
it. A clone whose manager made an excluded section repeating would simply get
the same new behaviour as every other section. This is recorded rather than
tested because writing a fixture for an unreachable configuration buys nothing.

## 4. The change

### Backend — behaviour

- `app/services/llm_field_filter.py` — drop `LlmFieldFilter.out_of_scope_sections`,
  `_out_of_scope_for_run`, `_newest_proposal_value`, and the imports only they
  use: `ExtractionInstance`, `ExtractionProposalRecord`, `entity_types_for_version`,
  `out_of_scope_sections`, `scope_classifier_coordinate`, `UUID`.
  `_warn_orphaned_exclusions`'s LOGIC and the `excluded_coordinates` half are
  untouched; its docstring is corrected with the rest of the file, below.
- `app/services/section_extraction_service.py:1396-1400` — delete the read-side
  `if entity_name in field_filter.out_of_scope_sections` branch.
- `app/services/section_extraction_service.py:1728-1729` — delete the write-side
  `if entity_type.name in field_filter.out_of_scope_sections: return 0`.
- `app/services/entry_group_extraction.py:179` — reduce to `if not entry_fields: continue`.

### Backend — prose that becomes false

Each of these states the deleted behaviour as fact and is corrected in the same
change. Leaving any of them is how a reader learns a rule the code no longer has.

- `app/services/llm_field_filter.py` — **every docstring and comment in the
  file is rewritten to describe one exclusion set**, not patched sentence by
  sentence: three gate passes each found another sentence the change would
  falsify. That covers at least the module docstring (`:3-4`, "Two exclusions
  … every LLM call needs both"; `:9-13`, the out-of-scope bullet and its
  "THIS is the enforcement" claim), `LlmFieldFilter` (`:54`, "The two
  exclusion sets"), `build_llm_field_filter` (`:61`, "Resolve both exclusion
  sets") and `_warn_orphaned_exclusions` (`:85-86`, "already narrowed by
  scope"). After the change the file has nothing to do with scope, so the
  rewritten file does not mention it. **Acceptance:**
  `grep -niE "scope|two exclusion|both exclusion|enforcement|both are declared" backend/app/services/llm_field_filter.py`
  returns nothing. Case-insensitive on purpose: a case-sensitive pattern misses
  "Two exclusions" at `:3`. Checked against today's file, every line it matches
  belongs to the scope half or its prose, so it cannot false-positive on
  anything that legitimately survives.
- `app/services/section_extraction_service.py:1358-1363` — `_extract_with_llm`'s
  docstring still describes "the template's two exclusion sets … subtracted HERE".
  One set remains.
- `app/services/section_extraction_service.py:730-733` — `_field_filter`'s
  docstring justifies the memo by "the scope half costs a pinned-tree read plus a
  proposal lookup". That half is gone; either restate the rationale for the
  surviving half or drop the memo's justification to match.
- `app/seed_probast_ai.py:47` — "read by progress, derivation, the AI calls and
  the export".
- `app/seed_probast_ai_data.py:396-398` — "every layer (progress, derivation, AI
  calls, export) evaluates the SAME rule".

### Docs and historical records

**Corrected**

- `docs/reference/extraction-hitl-architecture.md:717-719` names
  `app/services/llm_field_filter.py` as a live `scope_rules` consumer — "the
  AI-path guard". This is a canonical reference doc on the maintained Diátaxis
  surface; it must stop saying so.

**Annotated, not rewritten**

- `docs/superpowers/specs/2026-08-26-probast-ai-scope-coherence-design.md`
  (`:211`, `:222-223`, `:310-311`) calls the AI-path guard "authoritative"
  and the client's button-hiding "a courtesy, not the enforcement" — the exact
  claim this change retires. It is a dated snapshot and its body is not
  rewritten; it gets **one dated note at the top** pointing here and naming the
  claim that died. Its `status: draft` is left alone: the doc also covers
  instrument-exact scale, seed convergence and the finalize backstop, none of
  which this change touches, so marking the whole thing superseded would
  over-claim.

**Left untouched, deliberately**

- `docs/superpowers/plans/2026-08-29-probast-ai-scope-coherence.md`
  (`:50`, `:144-146`, `:156`) records the AI-path guard and the hidden button as
  shipped. A plan is a dated record of what was executed, not a reference; it is
  not on the maintained doc surface: `docs/superpowers` is excluded from the link
  gate (`.github/workflows/docs-ci.yml:54`, `.github/lychee.toml:19`), and
  `docs/superpowers/plans/**` is itself a markdownlint ignore glob
  (`.markdownlintignore:8`) — the tree is not wholly ignored, but this file
  is. Rewriting it would falsify
  history. Its `status: in_progress` while describing shipped work is
  pre-existing drift unrelated to this change — **flagged here, not fixed**.

### Frontend

- `components/assessment/QASectionAccordion.tsx:368` —
  `!allFieldsExcluded && !outOfScope` becomes `!allFieldsExcluded`. The
  `outOfScope` prop keeps its two remaining uses (muted label, badge), so it
  is not orphaned.
- `components/assessment/QASectionAccordion.tsx:362-367` — the comment directly
  above that condition states the old behaviour as fact ("`llm_field_filter`
  drops those fields server-side, so the button would spin and return nothing").
  Rewritten with the condition.
- `frontend/test/qaTemplateScopeRead.test.ts:2-4` — the file docstring
  enumerates "the hidden AI button" among the out-of-scope affordances that
  resolve from `scope_rules`. That enumeration is corrected. The test's
  assertions are untouched and stay green: they pin that the PostgREST select
  names `schema` and **not** the ORM alias `schema_` (`:55`, `:60`), which has
  nothing to do with which affordances consume the rules.

**User-visible states of the newly-exposed button.** None are new: the states
belong to `frontend/components/extraction/ai/shared/SectionAIExtractButton.tsx`
and are unchanged by this edit. Line references below are into that file. They are
enumerated here because the change is what makes them reachable on an
out-of-scope section.

| State | Owner | Behaviour |
|---|---|---|
| read-only run | `:60` | `if (readOnly) return null` — a **second, surviving gate**; §4's condition is not the only one |
| failure | `:71` | `const failure = state.error` — retry label, toast already raised by the hook |
| in flight | `:87-91` | `disabled={disabled \|\| loading}` and the `Loader2` spinner icon |
| empty result | shared hook | no proposals written; the section stays blank and badged |
| unauthorized / not-found | unchanged | the run endpoint's existing behaviour |

### Untouched by design

`studyTypeScope.ts`, `scopedProgress.ts`, `derived_judgment_payload.py`,
`extraction_scope_marking.py`, `extraction_export_service.py`,
`qa_divergence_gate.py`. Their existing tests are the regression proof that
"out of scope" still means what it meant.

## 5. Dead code

Verified, not assumed: after the cut, both helpers in
`derived_judgment_service.py` keep live callers.

- `scope_classifier_coordinate` — `exports/extraction_scope_marking.py:114`,
  **and `derived_judgment_service.py:516`**, inside `out_of_scope_sections`
  itself.
- `out_of_scope_sections` — `derived_judgment_payload.py:171`,
  `extraction_export_service.py:738`, `exports/extraction_scope_marking.py:127`.

No public function is orphaned, so the "rerouting a caller orphans a public fn"
vulture trap does not fire here.

No UI copy key dies: `qa.outOfScopeBadge` and `qa.outOfScopeValue` are still
rendered.

Ratchets, in the same PR and not as a follow-up:

- `npm run deadcode` and `npm run deadcode:production` at zero findings.
  **Not** raw `npx knip`: both repo gates go through the npm scripts, which
  add `--no-tag-hints`, and `scripts/verify_all.sh:208-212` says so explicitly
  — "so this file and CI cannot drift apart on flags".
- `vulture` gate green. **No baseline change is expected:** no entry in
  `backend/.vulture_baseline` relates to a symbol this change touches, so there
  is nothing to tighten. `scripts/vulture_baseline.py` is only the runner
  (`scripts/verify_all.sh:222`).
- `scripts/fitness/check_copy_keys.py` shrink-only ratchet still green.
- **Retired-symbols gate — no entry, ruled.**
  `scripts/fitness/check_retired_symbols.py` is absolute, not a ratchet, and
  its contract says "a spec change edits RETIRED below with the reason in the
  diff" (`:14-15`). This change retires the dataclass FIELD
  `LlmFieldFilter.out_of_scope_sections` — but the gate matches a bare WORD,
  and `out_of_scope_sections` remains a live, correct public helper in
  `derived_judgment_service.py` with three callers (§5 above). Adding it to
  RETIRED would fail the gate instantly on the surviving helper. **No RETIRED
  entry is added**, deliberately: the retired thing is a field on one
  dataclass, which a word-match cannot distinguish from the function that
  keeps its job.
- **File-size ratchet — optional hygiene, not a gate failure.**
  `scripts/fitness/check_file_size.baseline:5` pins
  `backend/app/services/section_extraction_service.py:1900`. The gate flags
  only growth past the cap or a new over-ceiling file
  (`scripts/fitness/check_file_size.py:109-114`); "Shrinking is always
  allowed" (`check_file_size.py:5`). So it stays green after the deletions and **nothing is
  blocked**. Tightening the line to the new count keeps the ratchet
  meaningful and is worth doing. If you do, edit **that one line by hand** —
  `--update-baseline` rewrites every entry and would silently re-pin
  unrelated files to whatever they happen to measure today.

## 6. Tests

### 6.1 Where the new tests live, and why

**Integration tier, not unit.** The behaviour under test is "a stored
classification no longer suppresses extraction". That classification is a real
`extraction_proposal_records` row, read back by the real filter — either before
the pass, or after section 1 writes it mid-sweep.
`backend/tests/unit/test_section_extraction_service.py` fakes the session
(`AsyncMock(spec=AsyncSession)`), which never reads back a prior write. The
mechanism cannot be exercised there without rigging the mock — which produces
exactly the hand-stubbed test that proves nothing.

**File.** `backend/tests/integration/test_entry_group_extraction.py`, in its
`extract_for_run — the full-run sweep` section (`:738`), reusing its
`_run_in_extract` and `_pin_run_to_snapshot` helpers.

**Seam.** Stub the model-call leaf —
`monkeypatch.setattr(ses, "extract_structured", …)` and `ses.build_model` —
exactly as `test_the_chain_reaches_the_prompt_the_model_receives` already does
(`:619-620`). Follow that precedent's **whole** setup (`:592-624`), not just its
two stubs: it also stubs `service._assemble_prompt_text` (`:611`), without which
`extract_for_run` (`section_extraction_service.py:540`) needs a real PDF, and it
builds the service directly rather than through the file's `_service()` helper,
which replaces `_extract_with_llm`. **Not** `_extract_with_llm`, which the file's `_FakeExtractor`
replaces elsewhere: that would skip the real read-side filter and
`build_output_models`, which is half of what is under test. The stub records
which fields it was asked for, per section, and answers `found` for each.

**Fixture.** A pinned snapshot with two top-level sections — `assessment_scope`
(field `study_type`, sort order 1) and one evaluation section — plus
`scope_rules` on the template's live `schema_`, excluding that evaluation
section for `development_only`.

### 6.2 One test

`pre_classified`: before the pass, a `development_only` proposal is already
stored on the classifier coordinate. After the change, the stub is asked for the
evaluation section's field **and** a proposal row is persisted for it.

A second case, `classified_mid_sweep`, was designed to characterize §3.2 and was
**dropped by ruling**: it existed only to back §7's cost estimate, which six
code traces already establish, and it carried most of this test's fixture
complexity — including a `created_at` tie inside the test transaction that makes
"newest proposal" unreliable mid-sweep.

### 6.3 The TDD sequence

1. **RED.** Write `pre_classified`. It fails today on *both* assertions: the
   read filter, memoised when section 1 is extracted, already sees the stored
   classification, so the model is never asked for the evaluation section.
2. **GREEN, in one commit.** Delete `section_extraction_service.py:1396-1400`
   and `:1728-1729`, the scope clause at `entry_group_extraction.py:179`, the
   scope half of `llm_field_filter.py` (§4), **and** the unit tests §6.4
   removes. They must land together: deleting the read branch alone turns
   `test_section_extraction_service.py:2822` and `:3146` red, and deleting the
   filter's field alone makes `:2822` and `:2846` fail to construct. The two
   assertions of `pre_classified` together require **both** branch deletions —
   drop only the read branch and the model is asked while the write still
   discards; drop only the write branch and the model is never asked.

The suite is green at every commit boundary.

### 6.4 Unit-tier deletions

- `test_out_of_scope_section_skips_the_llm_call`
  (`backend/tests/unit/test_section_extraction_service.py:2822`) and
  `test_an_in_scope_section_is_untouched_by_the_scope_set` (`:2846`). Both
  construct `LlmFieldFilter(out_of_scope_sections=…)`, a field §4 removes, so
  they would not even construct.
- **The whole `TestScopeGuardWiring` class** (`:3055-3160`, to end of file).
  Its docstring states the removed claim ("the section is skipped"). Its
  `_sent_fields` fixture patches
  `app.services.llm_field_filter.entity_types_for_version` (`:3126-3129`), a
  symbol §4 deletes, so `patch` raises `AttributeError`; and its
  classifier-proposal `db.execute` mock (`:3115-3117`) becomes dead
  scaffolding. **Coverage is not lost:** the surviving wiring claim is proved
  by `test_run_path_threads_the_template_spec_into_the_filter` (`:2967`), which
  exercises the derived-spec half only. The behaviour this class guarded in
  reverse is now §6.2, at the tier that can actually observe it.
- **No unit-tier read-side test is added.** §6.2's `pre_classified` test is
  the read-side RED, at the right tier.
- **No test for `entry_group_extraction.py:179`** — unreachable on seeded data,
  see §3.3. A ruling, not an omission.

### 6.5 Frontend

In `frontend/components/assessment/QASectionAccordion.test.tsx`, `:272`
("offers the AI extract button while the section is in scope") and `:277`
("hides the AI extract button on an out-of-scope section") assert the same
thing for the same reason once the condition goes. **Replace both with one
case** proving the button renders regardless of `outOfScope`; the dead
rationale in `:277`'s own inline comment goes with it. Keep `:306`
(`allFieldsExcluded`) and the `readOnly` case (`:91`) — different rules, both
unchanged.

### 6.6 Must stay green, untouched

`frontend/components/assessment/outOfScope.rendering.test.tsx`,
`frontend/test/lib/studyTypeScope.test.ts`,
`frontend/test/qaTemplateScopeRead.test.ts` (assertions; its docstring changes
per §4), `backend/tests/unit/test_extraction_export_scope_marking.py`,
`backend/tests/unit/test_qa_divergence_gate.py`,
`backend/tests/unit/test_derived_judgment_service.py`,
`backend/tests/unit/test_run_view_derived_judgments.py`,
`backend/tests/unit/test_derived_overall_screen_workbook_parity.py`,
`backend/tests/integration/test_llm_field_filter_orphans.py`.

### 6.7 Handed to the plan — fixture construction

These are HOW-level facts about building `pre_classified`'s fixture. They were
found by spec-gate pass 8, confirmed against the tree, and handed to the plan
by ruling rather than absorbed here: they are exact-code content, which
`writing-plans` produces and the ship-panel's test-coverage lens reviews. The
plan's task for §6.2 must satisfy every one.

- **Live rows match the pin.** Both sections must also exist as live
  `extraction_entity_types` / `extraction_fields` rows with the **same ids** as
  the pinned snapshot. `_live_field_intersection`
  (`section_extraction_service.py:701-728`) skips a pinned section with no live
  row, and `_create_suggestions` maps fields by LIVE name.
- **`cardinality: "one"` for both sections.** The file's `_pinned_group` helper
  hard-codes `"many"`, which would route through unstubbed identification.
  Build the pinned dicts directly, or add a parameter.
- **`assessment_scope` is FIRST in the pinned `entity_types` list.** The sweep
  follows snapshot list order (`extraction_snapshot.py:231`, `:547`), not
  `sort_order` — "sort order 1" on its own controls nothing.
- **`scope_rules` is set before `_run_in_extract`**, or on the ORM instance
  followed by a flush. The read side does a bare `db.get`
  (`llm_field_filter.py:65`) while only the write side refreshes
  (`extraction_generation.py:114-116`), and `create_run` has already loaded the
  template — so a raw-SQL `UPDATE` afterwards can leave the read filter without
  the rules, and `pre_classified` would not be RED on "asked".
- **Pin the stored classifier row's `source` and the skip flag.** Either store
  it as `human` and run with `skip_fields_with_human_proposals=True` (so
  `study_type` is not re-asked), or have the stub answer `development_only` for
  `study_type`. Leaving both open makes the write-side re-check's answer depend
  on a `created_at` tie inside the test transaction (the file's own note at
  `test_entry_group_extraction.py:390-394`).
- **Other LLM calls are not reached** — confirmed, so no further stubs are
  needed: identification only runs for `cardinality='many'`
  (`entity_key.py:187`); the verify pass is skipped because `mode_requested`
  defaults to `"fast"` (`llm_target.py:50`, `verified_mode.py:154`); and the
  entailment gate needs anchor blocks, which a stubbed article text never
  produces (`section_extraction_service.py:186`).

## 7. Risks accepted

- **Cost.** Seven extra section calls on a development-only study, four on an
  evaluation-only one — only when a human classified before triggering, or on
  a repeat pass (§3.2). There is no opt-out; a per-run switch is the designed
  escape hatch if the bill bites, and re-adding it is strictly additive to
  this change.
- **Reviewer perception.** Out-of-scope domains now arrive pre-filled with AI
  values while badged "Not applicable". No code mitigation — the badge already
  says it. Worth watching; copy can follow if it reads badly.
- **§3.2 is established by code tracing, not by a test** (ruling, §6.2). If
  it is wrong, only the cost estimate above is off; nothing else changes.

## 8. Verification

- `make lint-backend`
- `cd backend && uv run pytest tests/integration/test_entry_group_extraction.py tests/unit/test_section_extraction_service.py tests/integration/test_llm_field_filter_orphans.py -q`
  — then the §6.6 suites. Detail:
  backend pytest over `backend/tests/integration/test_entry_group_extraction.py`
  (where the new tests live — needs the local Supabase stack),
  `backend/tests/unit/test_section_extraction_service.py`,
  `backend/tests/integration/test_llm_field_filter_orphans.py`, and the scope /
  derivation / export suites listed in §6.6
- `grep -niE "scope|two exclusion|both exclusion|enforcement|both are declared" backend/app/services/llm_field_filter.py`
  returns nothing (§4's file-level acceptance)
- `npm run test:run`
- `npm run deadcode` and `npm run deadcode:production`
- `make quality-scan`
- `npx -y markdownlint-cli@0.45.0 --config .github/markdownlint.json --ignore-path .markdownlintignore "**/*.md"` — `quality-scan` does not cover it and CI does

## 9. Non-goals

- Assessor-owned coordinates (`excluded_coordinates`) stay excluded. The AI
  still never pre-fills a judgment the reviewer owns.
- No change to what `scope_rules` means, to the classifier, or to any
  downstream layer.
- No per-run, per-project or per-template switch. See §2.
- The `is_required` flag is not involved: it never gated extraction. It adds a
  prompt hint (`app/llm/schema.py`) and drives the finalize completeness gate —
  **ADR-0015** (`docs/adr/0015-finalize-via-approve-publish.md`); ADR-0009 is
  `superseded` by it. For quality assessment — and PROBAST+AI is QA — ADR-0015's
  QA carve-outs are in turn superseded by **ADR-0018**
  (`docs/adr/0015-finalize-via-approve-publish.md:11-13`). All of it is out of
  scope here.
