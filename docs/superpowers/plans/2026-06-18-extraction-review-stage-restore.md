---
status: implemented
last_reviewed: 2026-06-18
owner: '@raphaelfh'
---

# Restore extraction REVIEW-stage flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make multi-user data extraction work by moving runs into `REVIEW`
once values exist, so each reviewer's input is captured as their own
`ReviewerDecision`, the reviewer counter advances, accepted AI suggestions
stick, and a reviewer who has accepted nothing sees 0% (not a phantom %).

**Architecture:** The run lifecycle is sound; the bug is that extraction runs
get stuck in `PROPOSAL` while the reviewer/accept/progress UI assumes `REVIEW`.
We restore the auto-advance to `REVIEW` (after AI extraction, and on the first
manual edit), block "Run AI" outside `PROPOSAL`, set `reviewer_count = 2` so
both reviewers must decide before consensus, and stage-gate the reviewer badge.
`PROPOSAL → REVIEW` is ungated and already converts each user's typed `human`
proposals into their own `accept_proposal` decisions
(`RunLifecycleService._materialize_human_decisions`), so no new write path is
needed — only the trigger to cross the stage boundary.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 async (backend), React 19 + TanStack
Query + Zustand (frontend), pytest (backend integration against local
Supabase), vitest (frontend).

**Root-cause evidence (prod, project `7a142f03…`):** all 4 runs stuck at
`stage=proposal, status=pending`, 0 reviewer_decisions ever; reviewer_count=1;
example run has 13 AI + 48 human proposals (one user). See conversation
investigation for the full trace.

---

## Implementation note (what actually shipped)

The advance was implemented **frontend-only**, not in the backend (the
original Task 1 below). Reason: AI section extraction runs once per section on
the same run and hard-requires `PROPOSAL`, so a backend per-call advance would
break the second section of a batch. Instead a small
`frontend/hooks/extraction/useAutoAdvanceToReview.ts` hook advances
`PROPOSAL → REVIEW` once the run has proposals or the reviewer first edits;
`ExtractionFullScreen` wires it, gates the reviewer badge to non-`PROPOSAL`,
and threads `canRunAI` to disable "Run AI" in `REVIEW`. The backend already
rejects AI outside `PROPOSAL` (defense in depth). Stuck runs self-heal on next
open. Rationale recorded in ADR 0010. The backend Task 1 below is kept as the
original design record.

## Decisions locked (from brainstorming)

1. **Stage model:** auto-advance to `REVIEW` (restore the documented behavior).
2. **Multi-reviewer:** independent extraction + reconcile → `reviewer_count = 2`.
3. **No-AI path:** advance `PROPOSAL → REVIEW` automatically on the first edit.
4. **Re-run AI:** blocked once the run is in `REVIEW` (AI is a one-time seeding
   step; `record_proposal` already rejects `ai` outside `PROPOSAL`).

## File map

| File | Responsibility | Change |
| --- | --- | --- |
| `backend/app/services/section_extraction_service.py` | AI section extraction | Auto-advance the session run `PROPOSAL → REVIEW` after suggestions are created (extraction-surface path) |
| `backend/tests/integration/test_section_extraction_advance.py` | test | New: AI extraction leaves run in REVIEW; second AI call on REVIEW run rejected |
| `frontend/pages/ExtractionFullScreen.tsx` | page orchestration | Advance-on-first-edit; pass `stage` to header to disable Run AI; gate reviewer badge |
| `frontend/components/extraction/ExtractionHeader.tsx` | header / AI triggers | Accept `canRunAI` (or `stage`) and disable AI actions when not `proposal` |
| `frontend/hooks/extraction/useExtractionProgress.ts` (+ `ExtractionFullScreen`) | progress | No code change — progress auto-corrects because REVIEW reads reviewer-scoped `current_values`; covered by a regression test |
| `frontend/test/pages/extraction-review-advance.test.tsx` | test | New: first edit advances to REVIEW; badge hidden in proposal; AI disabled in review |
| `docs/reference/extraction-hitl-architecture.md` | docs | Re-affirm auto-advance; bump `last_reviewed` |
| `docs/adr/ADR-00XX-extraction-review-stage.md` | docs | New ADR recording the PROPOSAL-vs-REVIEW decision |

**Out of band (live project — requires explicit user OK, NOT auto-run):**
set `reviewer_count = 2` via the Consensus settings UI; advance the 4 stuck
runs to `REVIEW`. Captured as Task 6, gated.

---

### Task 1: Backend — auto-advance to REVIEW after AI section extraction

**Files:**
- Modify: `backend/app/services/section_extraction_service.py:238-245` (the
  "Run stays in PROPOSAL" block in the `manage_lifecycle is False` path)
- Test: `backend/tests/integration/test_section_extraction_advance.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/integration/test_section_extraction_advance.py
import pytest
from uuid import UUID

from app.models.extraction import ExtractionRunStage
from app.services.hitl_session_service import HITLSessionService
from app.services.section_extraction_service import SectionExtractionService
from app.models.extraction import TemplateKind


@pytest.mark.asyncio
async def test_ai_section_extraction_advances_run_to_review(
    db_session_real, seed_extraction_project, monkeypatch
):
    """After AI records proposals on a session run, the run is in REVIEW so the
    reviewer flow (decisions, badge, per-user progress) is reachable."""
    fx = seed_extraction_project  # project, article, project_template, user, entity_type
    session = await HITLSessionService(db_session_real).open_or_resume(
        kind=TemplateKind.EXTRACTION,
        project_id=fx.project_id,
        article_id=fx.article_id,
        user_id=fx.user_id,
        project_template_id=fx.project_template_id,
    )
    # Stub the LLM + PDF so the test exercises lifecycle, not the model.
    svc = SectionExtractionService(db=db_session_real, user_id=str(fx.user_id), trace_id="t")
    monkeypatch.setattr(svc, "_get_pdf", _fake_pdf)
    monkeypatch.setattr(svc, "_extract_with_llm", _fake_llm_one_field(fx.field_id))

    await svc.extract_section(
        project_id=fx.project_id,
        article_id=fx.article_id,
        template_id=fx.project_template_id,
        entity_type_id=fx.entity_type_id,
        run_id=UUID(session.run_id),
    )

    run = await _reload_run(db_session_real, session.run_id)
    assert run.stage == ExtractionRunStage.REVIEW.value


@pytest.mark.asyncio
async def test_second_ai_extraction_on_review_run_is_rejected(
    db_session_real, seed_extraction_project, monkeypatch
):
    """AI requires PROPOSAL; once advanced to REVIEW a re-run must error
    (defense-in-depth behind the disabled frontend button)."""
    fx = seed_extraction_project
    session = await HITLSessionService(db_session_real).open_or_resume(
        kind=TemplateKind.EXTRACTION, project_id=fx.project_id,
        article_id=fx.article_id, user_id=fx.user_id,
        project_template_id=fx.project_template_id,
    )
    svc = SectionExtractionService(db=db_session_real, user_id=str(fx.user_id), trace_id="t")
    monkeypatch.setattr(svc, "_get_pdf", _fake_pdf)
    monkeypatch.setattr(svc, "_extract_with_llm", _fake_llm_one_field(fx.field_id))
    await svc.extract_section(
        project_id=fx.project_id, article_id=fx.article_id,
        template_id=fx.project_template_id, entity_type_id=fx.entity_type_id,
        run_id=UUID(session.run_id),
    )
    with pytest.raises(ValueError, match="requires PROPOSAL"):
        await svc.extract_section(
            project_id=fx.project_id, article_id=fx.article_id,
            template_id=fx.project_template_id, entity_type_id=fx.entity_type_id,
            run_id=UUID(session.run_id),
        )
```

> Note: reuse the existing section-extraction test fixtures/stubs in
> `backend/tests/integration/` (search for an existing
> `test_section_extraction*.py` to copy `_fake_pdf`, `_fake_llm_*`,
> `_reload_run`, and the `seed_extraction_project` fixture shape). If none
> exists, add the helpers next to this test. Scope all queries by `project_id`
> (project rule).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/integration/test_section_extraction_advance.py -v`
Expected: `test_ai_section_extraction_advances_run_to_review` FAILS (run stage
is `proposal`, not `review`).

- [ ] **Step 3: Implement the auto-advance**

Replace the "Run stays in PROPOSAL" comment block (after `_create_suggestions`,
in the `manage_lifecycle is False` branch) with an advance to REVIEW:

```python
            # Restore the documented behavior: once AI has seeded its
            # proposals, advance the session run PROPOSAL -> REVIEW so each
            # reviewer's accept/edit lands as their own ReviewerDecision and
            # the reviewer counter / per-user progress become correct. AI
            # proposals are NOT materialized into decisions — reviewers
            # accept them explicitly. Idempotent: a run already in REVIEW
            # (e.g. a retried request) is left as-is.
            if not manage_lifecycle and run.stage == ExtractionRunStage.PROPOSAL.value:
                run = await self._lifecycle.advance_stage(
                    run_id=run.id,
                    target_stage=ExtractionRunStage.REVIEW,
                    user_id=UUID(self.user_id),
                )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/integration/test_section_extraction_advance.py -v`
Expected: both PASS.

- [ ] **Step 5: Run the surrounding suite for regressions**

Run: `cd backend && uv run pytest tests/integration -k "section_extraction or hitl_session or run_lifecycle" -v`
Expected: PASS (watch for tests that asserted the run stays in PROPOSAL — update
them to expect REVIEW, since that assertion encoded the bug).

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/section_extraction_service.py backend/tests/integration/test_section_extraction_advance.py
git commit -m "fix(extraction): auto-advance session run to REVIEW after AI extraction"
```

---

### Task 2: Frontend — advance to REVIEW on first manual edit

**Files:**
- Modify: `frontend/pages/ExtractionFullScreen.tsx` (add an `ensureReviewStage`
  helper + a first-edit effect; reuse the existing `advanceMutation`,
  `saveNow`, `refetchRun`, `refreshValues`)
- Test: `frontend/test/pages/extraction-review-advance.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/test/pages/extraction-review-advance.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
// Use the project's existing render harness + MSW handlers for
// /api/v1/hitl/sessions, /api/v1/runs/:id/view, /api/v1/runs/:id/advance,
// /api/v1/runs/:id/proposals. Mirror an existing ExtractionFullScreen test.

it('advances PROPOSAL -> REVIEW on the first field edit', async () => {
  const advanceSpy = vi.fn();
  // ... set up MSW so the run view returns stage="proposal" first, and
  // POST /runs/:id/advance records the target_stage via advanceSpy then
  // flips the view to stage="review".
  renderExtractionScreen();
  const input = await screen.findByLabelText(/Source of Data/i);
  await userEvent.type(input, 'Retrospective cohort');
  await waitFor(() => expect(advanceSpy).toHaveBeenCalledWith(
    expect.objectContaining({ target_stage: 'review' }),
  ));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- frontend/test/pages/extraction-review-advance.test.tsx`
Expected: FAIL (advance never called on edit).

- [ ] **Step 3: Implement `ensureReviewStage` + first-edit effect**

In `ExtractionFullScreen.tsx`, after the `useAutoSaveProposals` block and the
existing `handleSubmitForReview` (which already does flush → advance → refetch),
add:

```tsx
  // Advance PROPOSAL -> REVIEW exactly once, the moment the reviewer first
  // engages (typing or accepting an AI suggestion). After this the run is in
  // REVIEW so autosave writes per-user ReviewerDecisions, accepted AI
  // suggestions become durable, and progress reflects only this reviewer's
  // own values. Guarded by a ref so it fires once per proposal->review
  // transition (not on every keystroke).
  const advancingToReviewRef = useRef(false);
  const ensureReviewStage = async () => {
    if (stage !== 'proposal' || !activeRunId || advancingToReviewRef.current) return;
    advancingToReviewRef.current = true;
    await saveNow();
    await advanceMutation
      .mutateAsync({ target_stage: 'review' })
      .then(() => Promise.all([refetchRun(), refreshValues()]))
      .catch(() => {
        // Allow a retry on the next edit if the advance failed.
        advancingToReviewRef.current = false;
      });
  };

  // First-edit detector: when the user has typed/accepted at least one value
  // while the run is still in PROPOSAL, cross into REVIEW.
  const hasOwnInput = Object.values(values).some(
    (v) => v !== null && v !== undefined && v !== '',
  );
  useEffect(() => {
    if (stage === 'proposal' && hasOwnInput && !loading && valuesInitialized) {
      void ensureReviewStage();
    }
  }, [stage, hasOwnInput, loading, valuesInitialized, ensureReviewStage]);
```

> The advance uses the existing `advanceMutation = useAdvanceRun(activeRunId)`.
> `_materialize_human_decisions` on the backend converts the just-saved `human`
> proposal into this reviewer's `accept_proposal` decision, so the typed value
> survives the transition and the AI-suggestion status derives as accepted.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- frontend/test/pages/extraction-review-advance.test.tsx`
Expected: PASS.

- [ ] **Step 5: React Compiler / lint gate**

Run: `npm run lint`
Expected: PASS (no `try/finally`/`throw` in component body — the code above uses
`.then/.catch`, per the frontend rule).

- [ ] **Step 6: Commit**

```bash
git add frontend/pages/ExtractionFullScreen.tsx frontend/test/pages/extraction-review-advance.test.tsx
git commit -m "fix(extraction): advance run to REVIEW on first manual edit"
```

---

### Task 3: Frontend — block "Run AI" once the run is in REVIEW

**Files:**
- Modify: `frontend/components/extraction/ExtractionHeader.tsx` (accept a
  `canRunAI: boolean` prop; disable the AI trigger(s) + show a tooltip when
  false)
- Modify: `frontend/pages/ExtractionFullScreen.tsx` (pass `canRunAI={stage === 'proposal' || stage == null}`)
- Test: extend `frontend/test/pages/extraction-review-advance.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it('disables Run AI once the run is in REVIEW', async () => {
  renderExtractionScreen({ runStage: 'review' });
  const runAi = await screen.findByRole('button', { name: /run ai|extract with ai/i });
  expect(runAi).toBeDisabled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- frontend/test/pages/extraction-review-advance.test.tsx`
Expected: FAIL (button enabled).

- [ ] **Step 3: Implement the guard**

In `ExtractionHeader.tsx`, add `canRunAI?: boolean` to the props, default
`true`, and apply `disabled={!canRunAI}` to the AI extraction trigger(s) with a
copy-keyed tooltip (add the key to `frontend/lib/copy/extraction.ts`, e.g.
`aiDisabledInReview: 'AI extraction is only available before review starts.'`).
In `ExtractionFullScreen.tsx`, pass `canRunAI={stage === 'proposal' || stage == null}`
to `<ExtractionHeader … />`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- frontend/test/pages/extraction-review-advance.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/extraction/ExtractionHeader.tsx frontend/pages/ExtractionFullScreen.tsx frontend/lib/copy/extraction.ts
git commit -m "feat(extraction): disable Run AI outside PROPOSAL stage"
```

---

### Task 4: Frontend — gate the reviewer badge + verify progress/accept correctness

**Files:**
- Modify: `frontend/pages/ExtractionFullScreen.tsx:1061-1067` (render
  `ReviewerProgressBadge` only for review/consensus/finalized)
- Test: extend `frontend/test/pages/extraction-review-advance.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it('hides the reviewer badge during PROPOSAL and shows it in REVIEW', async () => {
  const { rerender } = renderExtractionScreen({ runStage: 'proposal' });
  expect(screen.queryByTestId('reviewer-progress-badge')).toBeNull();
  rerender(renderExtractionScreen({ runStage: 'review' }).ui);
  expect(await screen.findByTestId('reviewer-progress-badge')).toBeInTheDocument();
});

it('shows 0% for a reviewer with no decisions in REVIEW (no AI prefill counted)', async () => {
  // run view in review with empty current_values for the caller
  renderExtractionScreen({ runStage: 'review', currentValues: [] });
  expect(await screen.findByText('0%')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- frontend/test/pages/extraction-review-advance.test.tsx`
Expected: badge-gating test FAILS (badge currently renders whenever `runDetail`
exists).

- [ ] **Step 3: Implement the gate**

In `ExtractionFullScreen.tsx`, change the badge render condition from
`runDetail ? (<ReviewerProgressBadge … />) : null` to:

```tsx
            {runDetail && stage !== 'proposal' ? (
              <ReviewerProgressBadge
                reviewerCount={reviewerSummary.reviewers.length}
                requiredReviewerCount={reviewerSummary.requiredReviewerCount}
                divergentCount={reviewerSummary.divergentCoords.size}
              />
            ) : null}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- frontend/test/pages/extraction-review-advance.test.tsx`
Expected: PASS. (The 0% test passes without code change — REVIEW hydrates from
reviewer-scoped `current_values`; it's a regression guard against the bug
reappearing.)

- [ ] **Step 5: Commit**

```bash
git add frontend/pages/ExtractionFullScreen.tsx frontend/test/pages/extraction-review-advance.test.tsx
git commit -m "fix(extraction): only show reviewer badge once review has started"
```

---

### Task 5: Verify the full local flow end-to-end

**Files:** none (verification)

- [ ] **Step 1: Backend suite**

Run: `make test-backend`
Expected: PASS (in particular section-extraction, run-lifecycle, run-read).

- [ ] **Step 2: Frontend suite + lint + types**

Run: `npm run test:run && npm run lint`
Expected: PASS.

- [ ] **Step 3: Manual E2E on local stack (two browser profiles)**

Run `make start`, log in as two project members on the same article:
1. User A runs AI → run advances to REVIEW (verify in DB: `stage=review`).
2. User A accepts a suggestion → it stays accepted (no perpetual spinner);
   `extraction_reviewer_decisions` has A's `accept_proposal` row.
3. User B opens the article → form shows **0%** + AI suggestions to accept (no
   phantom percentage), reviewer badge shows **1/2** (after `reviewer_count=2`,
   Task 6).
4. User B accepts/edits → badge shows **2/2**; "Reconcile" becomes available.
5. "Run AI" is disabled for both once in REVIEW.

- [ ] **Step 4: Commit (if any verification fixups)**

```bash
git add -A && git commit -m "test(extraction): verify REVIEW-stage multi-user flow"
```

---

### Task 6 (GATED — live project, requires explicit user confirmation): config + data remediation

> Do NOT run without the user's explicit go-ahead. These touch the live
> Supabase project `7a142f03-ff84-4b40-aa74-73d8d17aab99`.

- [ ] **Step 1: Set `reviewer_count = 2`** via the in-app Consensus settings UI
  for the project (preferred — writes `extraction_hitl_configs` through the API
  with correct RLS). Verify a *new* run snapshots `reviewer_count: 2` in
  `hitl_config_snapshot`.

- [ ] **Step 2: Advance the 4 stuck runs to REVIEW** so existing typed values
  materialize into their authors' decisions. Preferred path is per-run via the
  app ("Submit for review" on each), which runs the same
  `advance_stage(... review)` + `_materialize_human_decisions`. Only if a bulk
  fix is required, do it through the API/service layer (NOT raw DDL, NOT the
  Supabase MCP `apply_migration`). After advancing, confirm
  `extraction_reviewer_states` is populated for each run's author.

- [ ] **Step 3: Verify** the example article
  (`ad3edd74-590b-41af-a6b1-413dfbbfcd0c`) now shows the badge correctly and the
  author's values appear as their decisions.

---

### Task 7: Docs

**Files:**
- Modify: `docs/reference/extraction-hitl-architecture.md` (the §6 note already
  says AI extraction auto-advances PROPOSAL→REVIEW — re-affirm it is true again;
  bump `last_reviewed: 2026-06-18`)
- Create: `docs/adr/ADR-00XX-extraction-review-stage.md` (record: extraction
  runs live in REVIEW for collaborative work; PROPOSAL is a transient seeding
  stage; AI is one-time; reviewer_count drives consensus)

- [ ] **Step 1: Update the architecture doc + ADR**
- [ ] **Step 2: docs-ci compliance** — add this plan + the ADR to
  `.github/.markdownlintignore` (one entry each) and ensure frontmatter
  (`status` / `last_reviewed` / `owner`) is present.
- [ ] **Step 3: Commit**

```bash
git add docs/
git commit -m "docs(extraction): re-affirm REVIEW-stage flow + ADR for stage model"
```

---

## Self-review notes

- **Spec coverage:** symptom #1 (0/1 reviewer) → Task 4 + REVIEW decisions
  (Tasks 1/2); #2/#3 (phantom %, mixing) → Tasks 1/2 move reads to
  reviewer-scoped `current_values`, Task 4 guards 0%; #4 (accept spinner) →
  Tasks 1/2 give durable decisions so status derives correctly.
- **Risk:** existing tests may assert "run stays in PROPOSAL after AI" — those
  encoded the bug; update them to expect REVIEW (called out in Task 1 Step 5).
- **acceptStrategy:** intentionally left as `'human-proposal'` — once the run is
  in REVIEW the stage-aware autosave persists accepts as `edit`/decision rows
  and the AI-suggestion status derives from `reviewer_states`. Flipping to
  `'reviewer-decision'` is a possible follow-up for cleaner `accept_proposal`
  provenance but is not required to fix the reported symptoms.
- **Type consistency:** `target_stage: 'review'` matches `AdvanceStageRequest`;
  `canRunAI` is the single new prop threaded header→page.
