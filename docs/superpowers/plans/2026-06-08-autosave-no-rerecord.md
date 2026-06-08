---
status: shipped
last_reviewed: 2026-06-08
owner: '@raphaelfh'
---

# Autosave: no re-record on mount + backend idempotency — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the extraction/QA form from re-POSTing server-loaded values as brand-new proposals/decisions on every mount, and make the backend skip an identical-to-latest re-record (defense-in-depth), so the append-only tables stop accumulating duplicate rows.

**Architecture:** Root cause (verified) — `useAutoSaveProposals.computeDirtyEntries` (frontend/hooks/runs/useAutoSaveProposals.ts:135-148) only treats a coord as "already saved" when present in `lastSavedByKeyRef`, which is seeded **only** by the hook's own successful POSTs (line 233), never from hydrated values. So on mount every server-loaded value looks dirty and the debounce effect (275-299) POSTs it again. Fix: feed the hook the server-persisted map (`baselineValues`) and treat a coord whose current value equals its baseline as not-dirty. Belt-and-suspenders: `ExtractionProposalService.record_proposal` / `ExtractionReviewService.record_decision` skip an insert when the latest row for the same coord (+source/+reviewer) is byte-identical.

**Tech Stack:** Frontend — React 18, TS strict, vitest. Backend — FastAPI, SQLAlchemy 2.0 async, pytest. Established patterns: pure-function extraction for testability (mirrors `frontend/lib/extraction/proposalValues.ts`), atomic commits on branch `fix/extraction-stale-blind-progress`.

---

## File Structure

- Create: `frontend/lib/extraction/autosaveDirty.ts` — pure `selectDirtyEntries(values, lastSaved, baseline)` (the dirty diff, testable in isolation).
- Create: `frontend/lib/extraction/autosaveDirty.test.ts` — unit tests for the diff.
- Modify: `frontend/hooks/runs/useAutoSaveProposals.ts` — add `baselineValues` prop + `baselineRef`; delegate dirty computation to the pure helper.
- Modify: `frontend/hooks/extraction/useExtractedValues.ts` — expose `loadedValues` (the raw server map it hydrated).
- Modify: `frontend/pages/ExtractionFullScreen.tsx` — pass `baselineValues={loadedValues}`.
- Modify: `frontend/pages/QualityAssessmentFullScreen.tsx` — pass `baselineValues={<memo from runDetail.proposals>}`.
- Modify: `backend/app/services/extraction_proposal_service.py` — idempotent skip of identical-to-latest proposal.
- Modify: `backend/app/services/extraction_review_service.py` — idempotent skip of identical-to-latest decision.
- Test: `backend/tests/integration/test_proposal_decision_idempotency.py` — re-record identical value ⇒ no new row.
- Modify: `docs/reference/extraction-hitl-architecture.md` — note the append-only refinement (identical consecutive re-records are no-ops).

---

### Task 1: Pure dirty-diff helper (frontend)

**Files:**
- Create: `frontend/lib/extraction/autosaveDirty.ts`
- Test: `frontend/lib/extraction/autosaveDirty.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/lib/extraction/autosaveDirty.test.ts
import { describe, expect, it } from 'vitest';
import { selectDirtyEntries } from './autosaveDirty';

const s = (v: unknown) => JSON.stringify(v ?? null);

describe('selectDirtyEntries', () => {
  it('skips a value equal to its server baseline (no re-record on mount)', () => {
    const values = { 'i1_f1': 'hello' };
    const baseline = { 'i1_f1': 'hello' };
    expect(selectDirtyEntries(values, {}, baseline)).toEqual([]);
  });

  it('marks a value dirty once it differs from the baseline (a real edit)', () => {
    const values = { 'i1_f1': 'edited' };
    const baseline = { 'i1_f1': 'hello' };
    expect(selectDirtyEntries(values, {}, baseline)).toEqual([['i1_f1', 'edited']]);
  });

  it('skips a value already acknowledged by a prior save', () => {
    const values = { 'i1_f1': 'x' };
    const lastSaved = { 'i1_f1': s('x') };
    expect(selectDirtyEntries(values, lastSaved, {})).toEqual([]);
  });

  it('ignores undefined (never-touched) but keeps null/empty as deliberate clears', () => {
    const values = { a_b: undefined, c_d: null, e_f: '' };
    const dirty = selectDirtyEntries(values, {}, {});
    expect(dirty.map(([k]) => k).sort()).toEqual(['c_d', 'e_f']);
  });

  it('baseline match wins even when lastSaved is empty (the bug case)', () => {
    const values = { 'i1_f1': { value: 'v' } };
    const baseline = { 'i1_f1': { value: 'v' } };
    expect(selectDirtyEntries(values, {}, baseline)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/lib/extraction/autosaveDirty.test.ts`
Expected: FAIL — `selectDirtyEntries` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/lib/extraction/autosaveDirty.ts
/**
 * The autosave dirty diff, extracted as a pure function so it can be unit
 * tested. A coord is dirty when its current value differs from BOTH the last
 * value this client successfully wrote (`lastSaved`, stringified) AND the
 * server-loaded baseline (`baseline`, raw). The baseline check is what stops
 * the form from re-POSTing hydrated values on mount (the `lastSaved` map is
 * empty until this client writes something).
 */
export function selectDirtyEntries(
  values: Record<string, unknown>,
  lastSaved: Record<string, string>,
  baseline: Record<string, unknown>,
): Array<[string, unknown]> {
  const dirty: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(values)) {
    // Skip never-touched fields; null/'' are deliberate clears and persist.
    if (value === undefined) continue;
    const stringified = JSON.stringify(value ?? null);
    if (lastSaved[key] === stringified) continue;
    if (key in baseline && JSON.stringify(baseline[key] ?? null) === stringified) {
      continue;
    }
    dirty.push([key, value]);
  }
  return dirty;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/lib/extraction/autosaveDirty.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/extraction/autosaveDirty.ts frontend/lib/extraction/autosaveDirty.test.ts
git commit -m "feat(extraction): pure autosave dirty-diff with server baseline"
```

---

### Task 2: Wire baseline into the autosave hook

**Files:**
- Modify: `frontend/hooks/runs/useAutoSaveProposals.ts`

- [ ] **Step 1: Add the prop + ref + delegate to the helper**

In `UseAutoSaveProposalsProps` add:

```ts
  /**
   * Server-persisted values per `${instanceId}_${fieldId}` (the hydrated
   * map). A coord whose current value still equals its baseline is treated
   * as already saved, so opening a run never re-POSTs loaded values.
   */
  baselineValues?: Record<string, unknown>;
```

Destructure it (`const { runId, values, enabled = true, debounceMs = 600, stage, baselineValues } = props;`), mirror it in a ref next to the others:

```ts
  const baselineRef = useRef(baselineValues ?? {});
  baselineRef.current = baselineValues ?? {};
```

Replace the body of `computeDirtyEntries` to delegate:

```ts
  const computeDirtyEntries = useCallback(
    (): Array<[string, unknown]> =>
      selectDirtyEntries(valuesRef.current, lastSavedByKeyRef.current, baselineRef.current),
    [],
  );
```

Add the import: `import { selectDirtyEntries } from '@/lib/extraction/autosaveDirty';`

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npx eslint frontend/hooks/runs/useAutoSaveProposals.ts`
Expected: clean (exit 0).

- [ ] **Step 3: Commit**

```bash
git add frontend/hooks/runs/useAutoSaveProposals.ts
git commit -m "feat(extraction): autosave skips values matching the server baseline"
```

---

### Task 3: Expose `loadedValues` from useExtractedValues

**Files:**
- Modify: `frontend/hooks/extraction/useExtractedValues.ts`

- [ ] **Step 1: Track + expose the raw hydrated map**

Add state `const [loadedValues, setLoadedValues] = useState<Record<string, any>>({});`. In `applyLoadedValues(valuesMap)` (and the reviewer-state branch), call `setLoadedValues(valuesMap)` with the SAME map passed to `applyLoadedValues`. For the empty/reset branches set `setLoadedValues({})`. Add `loadedValues` to the returned object and to `UseExtractedValuesReturn`.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/hooks/extraction/useExtractedValues.ts
git commit -m "feat(extraction): expose hydrated loadedValues for the autosave baseline"
```

---

### Task 4: Pass baseline from both full-screen pages

**Files:**
- Modify: `frontend/pages/ExtractionFullScreen.tsx`
- Modify: `frontend/pages/QualityAssessmentFullScreen.tsx`

- [ ] **Step 1: Extraction page**

Destructure `loadedValues` from `useExtractedValues({...})` and pass it: in the `useAutoSaveProposals({ runId, values, ... })` call add `baselineValues: loadedValues,`.

- [ ] **Step 2: QA page**

Add a memo of the server map next to the existing hydration effect (reuse its `latestByCoord` logic):

```ts
  const loadedValues = useMemo(() => {
    const map: Record<string, unknown> = {};
    for (const p of runDetail?.proposals ?? []) {
      const k = keyOf({ instanceId: p.instance_id, fieldId: p.field_id });
      const value =
        p.proposed_value && typeof p.proposed_value === 'object' && 'value' in p.proposed_value
          ? (p.proposed_value.value as unknown)
          : (p.proposed_value as unknown);
      map[k] = value;
    }
    return map;
  }, [runDetail]);
```

Pass `baselineValues: loadedValues,` into the QA `useAutoSaveProposals({...})` call.

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npx eslint frontend/pages/ExtractionFullScreen.tsx frontend/pages/QualityAssessmentFullScreen.tsx`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/pages/ExtractionFullScreen.tsx frontend/pages/QualityAssessmentFullScreen.tsx
git commit -m "feat(extraction): feed the server baseline to autosave on both forms"
```

---

### Task 5: Backend — idempotent proposal + decision re-record

**Files:**
- Modify: `backend/app/services/extraction_proposal_service.py`
- Modify: `backend/app/services/extraction_review_service.py`
- Modify: `backend/app/repositories/extraction_proposal_repository.py` (add `get_latest_for_coord`)
- Test: `backend/tests/integration/test_proposal_decision_idempotency.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/integration/test_proposal_decision_idempotency.py
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRunStage
from app.models.extraction_workflow import ExtractionProposalSource
from app.services.extraction_proposal_service import ExtractionProposalService
from app.services.run_lifecycle_service import RunLifecycleService


async def _proposal_coord(db):
    project_id = (await db.execute(text("SELECT id FROM public.projects LIMIT 1"))).scalar()
    article_id = (await db.execute(text("SELECT id FROM public.articles WHERE project_id=:p LIMIT 1"), {"p": project_id})).scalar()
    template_id = (await db.execute(text("SELECT id FROM public.project_extraction_templates WHERE project_id=:p AND kind='extraction' LIMIT 1"), {"p": project_id})).scalar()
    user_id = (await db.execute(text("SELECT id FROM public.profiles LIMIT 1"))).scalar()
    row = (await db.execute(text(
        "SELECT i.id, f.id FROM public.extraction_instances i "
        "JOIN public.extraction_entity_types et ON et.id=i.entity_type_id "
        "JOIN public.extraction_fields f ON f.entity_type_id=et.id "
        "WHERE i.template_id=:t AND i.article_id=:a LIMIT 1"),
        {"t": template_id, "a": article_id})).first()
    if not (article_id and template_id and user_id and row):
        return None
    lc = RunLifecycleService(db)
    run = await lc.create_run(project_id=project_id, article_id=article_id, project_template_id=template_id, user_id=user_id)
    await lc.advance_stage(run_id=run.id, target_stage=ExtractionRunStage.PROPOSAL, user_id=user_id)
    return run.id, row[0], row[1], user_id


@pytest.mark.asyncio
async def test_identical_proposal_rerecord_is_a_noop(db_session: AsyncSession) -> None:
    fx = await _proposal_coord(db_session)
    if fx is None:
        pytest.skip("Seed graph incomplete")
    run_id, instance_id, field_id, user_id = fx
    svc = ExtractionProposalService(db_session)
    args = dict(run_id=run_id, instance_id=instance_id, field_id=field_id,
               source=ExtractionProposalSource.HUMAN, proposed_value={"value": "v"}, source_user_id=user_id)
    first = await svc.record_proposal(**args)
    second = await svc.record_proposal(**args)  # identical re-record (mount replay)
    await db_session.flush()
    count = (await db_session.execute(text(
        "SELECT count(*) FROM public.extraction_proposal_records "
        "WHERE run_id=:r AND instance_id=:i AND field_id=:f"),
        {"r": str(run_id), "i": str(instance_id), "f": str(field_id)})).scalar()
    assert count == 1, "identical re-record must not append a duplicate row"
    assert second.id == first.id

    changed = await svc.record_proposal(**{**args, "proposed_value": {"value": "v2"}})
    assert changed.id != first.id, "a changed value must still append"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/integration/test_proposal_decision_idempotency.py -k proposal`
Expected: FAIL — `count == 2` (append-only today).

- [ ] **Step 3: Add the repository lookup**

In `backend/app/repositories/extraction_proposal_repository.py` add:

```python
    async def get_latest_for_coord(
        self, run_id, instance_id, field_id, source, source_user_id,
    ):
        from app.models.extraction_workflow import ExtractionProposalRecord as _P
        stmt = (
            select(_P)
            .where(
                _P.run_id == run_id,
                _P.instance_id == instance_id,
                _P.field_id == field_id,
                _P.source == (source.value if hasattr(source, "value") else source),
                _P.source_user_id == source_user_id,
            )
            .order_by(_P.created_at.desc(), _P.id.desc())
            .limit(1)
        )
        return (await self.db.execute(stmt)).scalar_one_or_none()
```

- [ ] **Step 4: Idempotent skip in the service**

In `ExtractionProposalService.record_proposal`, after stage/coord validation and before constructing the new record, look up the latest for the coord and short-circuit on byte-identical value:

```python
        latest = await self._repo.get_latest_for_coord(
            run_id, instance_id, field_id, source, source_user_id,
        )
        if latest is not None and latest.proposed_value == proposed_value:
            return latest  # identical re-record (e.g. form remount) — no-op
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/integration/test_proposal_decision_idempotency.py -k proposal`
Expected: PASS.

- [ ] **Step 6: Mirror for decisions**

Add `ExtractionReviewerDecisionRepository.get_latest_for_coord(run_id, reviewer_id, instance_id, field_id)` (order by created_at desc, id desc). In `ExtractionReviewService.record_decision`, before constructing the record, short-circuit when the latest decision for the coord has the same `decision` AND `value`:

```python
        latest = await self._decisions.get_latest_for_coord(run_id, reviewer_id, instance_id, field_id)
        if latest is not None and latest.decision == decision_value and latest.value == value:
            return latest
```

Add a `test_identical_decision_rerecord_is_a_noop` mirroring the proposal test but driving the run to REVIEW and calling `ExtractionReviewService.record_decision` with `decision='edit'` twice.

- [ ] **Step 7: Run both idempotency tests**

Run: `cd backend && uv run pytest tests/integration/test_proposal_decision_idempotency.py`
Expected: PASS (2 tests).

- [ ] **Step 8: Regression — existing proposal/review/consensus suites still green**

Run: `cd backend && uv run pytest tests/integration/test_extraction_proposal_service.py tests/integration/test_extraction_review_service.py tests/integration/test_extraction_consensus_service.py tests/integration/test_run_proposals_latest_wins.py`
Expected: PASS.

- [ ] **Step 9: Doc note + commit**

Update `docs/reference/extraction-hitl-architecture.md` where `extraction_proposal_records` is described as Append-only: add "(identical-to-latest re-records for the same coord+source are no-ops — audit captures value *changes*, not redundant replays)."

```bash
cd backend && uv run ruff check --fix app/services/extraction_proposal_service.py app/services/extraction_review_service.py app/repositories/extraction_proposal_repository.py app/repositories/extraction_reviewer_decision_repository.py tests/integration/test_proposal_decision_idempotency.py && uv run ruff format $!
git add -A backend/app backend/tests/integration/test_proposal_decision_idempotency.py docs/reference/extraction-hitl-architecture.md
git commit -m "feat(hitl): idempotent re-record of identical proposals/decisions"
```

---

### Task 6: End-to-end verification (browser, prod test project)

- [ ] **Step 1:** With the branch running against the prod test project (`teste@prumo.local`, run `5f0e16b0`), open the saved extraction run, note `proposal_count` for a filled coord via Supabase, reload the page twice WITHOUT editing, re-query: the count must NOT increase (was +1 per reload before).
- [ ] **Step 2:** Edit a field to a new value, confirm exactly one new proposal appears; reload, confirm no further growth and the new value persists.
- [ ] **Step 3:** Confirm the network tab shows zero `POST /proposals` on a no-edit reload (was 1 per reload before).

---

## Self-Review

- **Spec coverage:** frontend re-record (Tasks 1–4) + backend idempotency (Task 5) + E2E proof (Task 6). ✓
- **Type consistency:** `selectDirtyEntries(values, lastSaved, baseline)` used identically in helper, test, and hook; `baselineValues` prop name consistent across hook + both pages; `loadedValues` consistent across useExtractedValues + ExtractionFullScreen. ✓
- **Placeholders:** none — every code step shows real code.
- **Risk:** QA owns `values` via setState (1-render lag); the baseline is computed inline from `runDetail` (available before `values` updates), so the baseline is present when the hydrated `values` arrive — no POST window. Documented in Task 4.
