# Phase 2: Quality Assessment — PROBAST + QUADAS-2 seed + QA page

> Subagent-driven. Final plan in the unification effort.

**Goal:** Seed PROBAST and QUADAS-2 as `kind='quality_assessment'` global templates so projects can clone them. Add a minimal QA page (`QualityAssessmentFullScreen`) that mounts the existing extraction stack with `kind=quality_assessment` to prove end-to-end. Add seed/page tests.

## Spec
`docs/superpowers/specs/2026-04-27-extraction-hitl-and-qa-design.md` §9 (PROBAST/QUADAS-2 specifics).

---

## Task 1: Seed PROBAST + QUADAS-2 templates

**Modify:** `backend/app/seed.py`

Add two new `seed_probast` and `seed_quadas2` functions following the `seed_charms` pattern. Each function:
1. Creates a global template via `ExtractionTemplateGlobal(kind="quality_assessment")` with framework=`CUSTOM`.
2. Creates entity types (domains).
3. Creates fields (signaling questions + risk_of_bias + applicability_concerns per domain + overall ROB/applicability).

Domain structure (matches spec):

### PROBAST (4 domains + Overall)
- **Participants** (PROBAST 1)
- **Predictors** (PROBAST 2)
- **Outcome** (PROBAST 3)
- **Analysis** (PROBAST 4)
- **Overall** (single entity, ROB + Applicability)

Per domain: 4-9 signaling questions (`select`, allowed_values=["Y", "PY", "PN", "N", "NI", "NA"]), plus `risk_of_bias` (`select`, ["Low", "High", "Unclear"]) and `applicability_concerns` (`select`, ["Low", "High", "Unclear"]).

### QUADAS-2 (4 domains + Overall)
- **Patient Selection**
- **Index Test**
- **Reference Standard**
- **Flow and Timing**
- **Overall** (single entity, ROB + Applicability where applicable)

Per domain: 2-4 signaling questions (`select`, allowed_values=["Y", "N", "Unclear"]), plus `risk_of_bias` (`select`, ["Low", "High", "Unclear"]) and `applicability_concerns` (`select`, ["Low", "High", "Unclear"]) — except Flow & Timing which has no applicability.

Use realistic question wording (paraphrased from canonical PROBAST 2019 / QUADAS-2 2011 papers). Keep question keys snake_case identifiers.

Update `main()` in seed.py to call both new functions after `seed_charms`.

Use deterministic UUIDs prefixed with `0000` for PROBAST and `0001` for QUADAS-2 (e.g., `0000c001-...` for PROBAST template, `0001c001-...` for QUADAS-2 template).

### Tests

`backend/tests/integration/test_qa_seed.py`:
- After running seed (call `seed_probast(session)` + `seed_quadas2(session)` directly), assert:
  - PROBAST template exists with kind='quality_assessment', has 5 entity_types (4 domains + Overall).
  - QUADAS-2 template exists with kind='quality_assessment', has 5 entity_types.
  - Each domain has at least 1 signaling question + 1 ROB field.
  - Idempotency: running seed twice produces no new rows.

Commit: `feat(qa): seed PROBAST and QUADAS-2 quality-assessment templates with full domain structure`

---

## Task 2: QualityAssessmentFullScreen page (minimal)

**Create:** `frontend/pages/QualityAssessmentFullScreen.tsx`

Minimal scaffold:
- Receives `projectId`, `articleId`, `templateId` from URL params.
- Uses `AssessmentShell` (from Plan 1E) with PDF panel left + form panel right.
- The form panel uses the existing extraction form rendering — since PROBAST/QUADAS templates use the same `ExtractionEntityType`/`ExtractionField` schema as CHARMS, the existing form components work.
- Header shows the template name + kind badge ("Quality Assessment").

**Route:** Register in the React router config under `/projects/:pid/articles/:aid/quality-assessment/:tid`.

### Tests

`frontend/test/QualityAssessmentFullScreen.test.tsx` — RTL test that:
- Renders the page with mocked router params.
- Asserts the AssessmentShell mounts with PDF collapsed.
- Asserts the QA template name appears in the header.

Commit: `feat(qa): minimal QualityAssessmentFullScreen page using shared AssessmentShell`

---

## Task 3: Full backend + frontend suites green

```bash
cd backend && set -a && . /Users/raphael/PycharmProjects/prumo/backend/.env && set +a && uv run pytest -q
cd /Users/raphael/PycharmProjects/prumo/.claude/worktrees/strange-wiles-a189ef && npm run test
```

Apply formatting if needed.

Commit: `chore: apply ruff/lint format to Plan 2 files`

---

## Out of scope (true follow-ups)

- Domain ROB roll-up auto-suggestion (manual entry only in MVP).
- Refactor `model_extraction_service`/`section_extraction_service` (deferred from 1C-2).
- E2E playwright tests for the QA flow (env-gated; can be added when integration testing in dev/staging).
- QA-specific frontend UI flair (signaling-question chips, domain accordions). The minimal page works using existing extraction components.
