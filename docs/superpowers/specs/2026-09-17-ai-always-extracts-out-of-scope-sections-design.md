---
status: approved
last_reviewed: 2026-09-17
owner: '@raphaelfh'
---

# AI always extracts out-of-scope sections — design

> PROBAST+AI's study-type `scope_rules` are evaluated by five layers. Four
> of them decide what a value **means**; one decides whether the model is
> **asked**. This removes the fifth and only the fifth. Nothing about what
> "out of scope" means changes: the form still badges those domains, the
> derivation still ignores them, the export still marks them.
>
> Reached through an adversarial pass that killed three earlier proposals
> (a per-trigger request flag, a per-run switch column, a per-proposal
> provenance key). Section 3 records what the code actually does, because
> two of those proposals died on facts rather than on taste.

## 1. Problem

A PROBAST+AI assessment classifies the study at Step 2 (`assessment_scope`
→ `study_type`). `development_only` takes the seven evaluation domains out
of play; `evaluation_only` takes the four development domains. The rule is
declared data on the template's `schema` JSONB
(`backend/app/seed_probast_ai_data.py`, `_PAI_SCOPE_RULES`).

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

## 3. What the code does today

### 3.1 The five layers

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

Layers 1–4 answer "what does this value mean". Layer 5 answers "do we spend
a token on it". Only layer 5 is removed.

### 3.2 The read/write asymmetry (the cost argument)

**This is a code-reading conclusion and is pinned by a characterization
test before any deletion (§6). If it fails, the design is unchanged and the
cost claim in §7 is retracted.**

The read side memoises the filter once per pass —
`SectionExtractionService._field_filter` caches by `run.id`, resolved from
the single call at `entry_group_extraction.py:292`. The write side
re-resolves per section, inside the savepoint, via `locked_result_filter`
(`section_extraction_service.py:1727`, `entry_group_extraction.py:171`).

`assessment_scope` is section #1 in `_SECTIONS`. So on a run where nobody
has answered `study_type` yet:

1. The filter is built before section 1 → no classifier proposal →
   `out_of_scope` is empty, and stays empty for the whole sweep.
2. Section 1 runs; the AI proposes `development_only`; it is written.
3. Sections 2–13: the read side still holds the empty filter, so the LLM
   **is called** for all four development and all seven evaluation domains.
4. Each write re-resolves, now finds the classification, and discards the
   seven evaluation domains' candidates.

The tokens are already spent and the results thrown away, ordering-dependently
and silently. The extra cost of always-on is therefore confined to two cases:
a human who classified before triggering the AI, and any repeat pass once a
classification exists.

## 4. The change

### Backend

- `app/services/llm_field_filter.py` — drop `LlmFieldFilter.out_of_scope_sections`,
  `_out_of_scope_for_run`, `_newest_proposal_value`, and the imports only they
  use: `ExtractionInstance`, `ExtractionProposalRecord`, `entity_types_for_version`,
  `out_of_scope_sections`, `scope_classifier_coordinate`, `UUID`. Rewrite the
  module docstring: the "**THIS** is the enforcement" claim for scope is retired,
  because enforcement of what a value *counts for* lives in layers 1–4.
  `_warn_orphaned_exclusions` and the `excluded_coordinates` half are untouched.
- `app/services/section_extraction_service.py:1396` — delete the read-side
  `if entity_name in field_filter.out_of_scope_sections` branch.
- `app/services/section_extraction_service.py:1728` — delete the write-side
  `if entity_type.name in field_filter.out_of_scope_sections: return 0`.
- `app/services/entry_group_extraction.py:179` — reduce to `if not entry_fields: continue`.

### Frontend

- `components/assessment/QASectionAccordion.tsx:368` —
  `!allFieldsExcluded && !outOfScope` becomes `!allFieldsExcluded`. The
  `outOfScope` prop keeps its two remaining uses (muted label, badge), so it
  is not orphaned.

### Untouched by design

`studyTypeScope.ts`, `scopedProgress.ts`, `derived_judgment_payload.py`,
`extraction_scope_marking.py`, `extraction_export_service.py`,
`qa_divergence_gate.py`. Their existing tests are the regression proof that
"out of scope" still means what it meant.

## 5. Dead code

Verified, not assumed: after the cut, both helpers in
`derived_judgment_service.py` keep live callers —
`scope_classifier_coordinate` at `exports/extraction_scope_marking.py:114`,
and `out_of_scope_sections` at `derived_judgment_payload.py:171`,
`extraction_export_service.py:738` and `exports/extraction_scope_marking.py:127`.
No public function is orphaned, so the "rerouting a caller orphans a public
fn" vulture trap does not fire here.

No UI copy key dies: `qa.outOfScopeBadge` and `qa.outOfScopeValue` are still
rendered.

In the same PR, not a follow-up:

- `npx knip` and `npx knip --production` at zero findings.
- `vulture` baseline tightened (`scripts/vulture_baseline.py`), never widened.
- `scripts/fitness/check_copy_keys.py` shrink-only ratchet still green.

## 6. Tests

**Task 1 — characterization, before any deletion.** Assert §3.2: on an
unclassified run the evaluation domains *are* sent to the model, and the
write side *does* discard them. This is the evidence for the cost claim and
the RED for the write-side change.

Then:

- **Delete** `test_out_of_scope_section_skips_the_llm_call`
  (`tests/unit/test_section_extraction_service.py:2822`) and
  `test_an_in_scope_section_is_untouched_by_the_scope_set` (`:2846`) — both
  assert behaviour that no longer exists.
- **Invert** `test_a_development_only_run_never_asks_about_the_evaluation_part`
  (`:3146`): a development-only run now *does* ask, asserting `["risk_of_bias"]`.
- **Collapse** the now-vacuous trio. After that inversion,
  `test_an_unclassified_run_still_asks_about_everything` (`:3152`) and
  `test_a_run_classified_as_both_asks_about_everything` assert the same thing
  for the same reason. Replace all three with one parametrized test over the
  classification values, so the test states what it actually proves.
- **New, write side:** a development-only run's evaluation-domain proposals
  are persisted. The `:1728` branch has no test today; deleting untested code
  requires a test asserting the replacement behaviour.
- **Frontend:** invert `hides the AI extract button on an out-of-scope section`
  (`QASectionAccordion.test.tsx:277`). Keep `:306`
  (`allFieldsExcluded`) — a different rule, unchanged.
- **Must stay green, untouched:** `outOfScope.rendering.test.tsx`,
  `test/lib/studyTypeScope.test.ts`, `tests/unit/test_extraction_export_scope_marking.py`,
  `tests/unit/test_qa_divergence_gate.py`, `tests/unit/test_derived_judgment_service.py`,
  `tests/unit/test_run_view_derived_judgments.py`,
  `tests/unit/test_derived_overall_screen_workbook_parity.py`,
  `tests/integration/test_llm_field_filter_orphans.py`.

## 7. Risks accepted

- **Cost.** Seven extra section calls on a development-only study, four on an
  evaluation-only one — only when a human classified before triggering, or on
  a repeat pass (§3.2). There is no opt-out; a per-run switch is the designed
  escape hatch if the bill bites, and re-adding it is strictly additive to
  this change.
- **Reviewer perception.** Out-of-scope domains now arrive pre-filled with AI
  values while badged "Not applicable". No code mitigation — the badge already
  says it. Worth watching; copy can follow if it reads badly.
- **§3.2 could be wrong.** Task 1 settles it before anything is deleted.

## 8. Verification

- `make lint-backend`
- backend pytest over `test_section_extraction_service.py`,
  `test_llm_field_filter_orphans.py`, and the scope / derivation / export suites
- `npm run test:run`
- `npx knip` and `npx knip --production`
- `make quality-scan`

## 9. Non-goals

- Assessor-owned coordinates (`excluded_coordinates`) stay excluded. The AI
  still never pre-fills a judgment the reviewer owns.
- No change to what `scope_rules` means, to the classifier, or to any
  downstream layer.
- No per-run, per-project or per-template switch. See §2.
- The `is_required` flag is not involved: it never gated extraction. It adds a
  prompt hint (`app/llm/schema.py`) and drives the ADR-0009 finalize
  completeness gate, and both are out of scope here.
