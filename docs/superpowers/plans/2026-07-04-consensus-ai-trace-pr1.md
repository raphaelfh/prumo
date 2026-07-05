---
status: approved
last_reviewed: 2026-07-04
owner: '@raphaelfh'
---

# Consensus AI Trace + Compare-Toggle Cleanup — PR 1 (D0–D6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record the AI-suggestion linkage on extraction autosave decisions (validated server-side) and surface a per-reviewer-cell AI trace (popover reuse, read-only) in the consensus compare table, while removing the dead consensus header affordances and the dead accept/reject-suggestion write chains.

**Architecture:** `useAISuggestions` gains a session-local adoption map (written only by real accept/select/reject events — never rehydrated from the server, whose `status` field marks ANY non-reject decision "accepted"); a pure lib merges it with the caller's own persisted decision links into `linkByKey`, which autosave stamps onto `edit` decisions. The backend gains a small guard: a caller-supplied `proposal_record_id` on any decision must reference an existing non-human proposal on the same (instance, field) — closing the forged-provenance hole (run equality intentionally NOT required: select-version legitimately pins older runs' proposals). A new service-free leaf `ReviewerAITrace` renders a sparkles icon (linked, non-reject) or a "Manual" chip (unlinked + AI-existence signal loaded + no AI suggestion) in resolve-mode reviewer cells, mounting `AISuggestionReviewPopover` read-only with attribution props. Peer-identity display (`showPeerIdentity`) rides the existing `RunEditabilityContext` (no 9-file prop drill) and gates both the popover run headers and the GenerationDetailsDialog "Ran by" surfaces — display consistency only; the server-side history scrub is PR 2 scope.

**Tech Stack:** React 19 + TS strict, shadcn/Radix, vitest + testing-library; FastAPI + SQLAlchemy async (one service guard + endpoint deps — **no schema change, no migration, no API-shape change**), pytest integration on real PG.

**Spec:** `docs/superpowers/specs/2026-07-04-consensus-ai-trace-design.md` (PR 1 = D0–D6).
**Panel review:** 2026-07-04, five lenses (constitution/layering, security/RLS/blinding, migration-safety/contracts, YAGNI/no-legacy, test-coverage/CI); 13 blocking findings folded in — the largest reshaped D0's link derivation (session events + own-decision links, never hydrated `status`), extended the Task-4 prune to the reject-arm chain, moved a `proposal_record_id` validation guard into this PR (spec's "zero backend" amended), demoted the blinding claim to display-consistency (backend scrub → PR 2), replaced the prop drill with the existing run context, and rewrote the born-green/unmockable test snippets.

## Global Constraints

- English-only copy, single-sourced in `frontend/lib/copy/` — never hardcode UI strings in components.
- React Compiler `panicThreshold: 'all_errors'`: no `try/finally` or `throw` inside `try` in component/hook bodies; promise chains only.
- Every icon-only button: shadcn `Tooltip` (`TooltipTrigger asChild`) + `aria-label`. Radix Tooltip REQUIRES `TooltipProvider` — every new test render wraps in it (pattern: `frontend/components/extraction/FieldInput.review.test.tsx:15-17`). Tooltip goes OUTSIDE the popover trigger (`FieldInput.tsx:299-318` pattern) — nesting `Tooltip` inside `PopoverTrigger asChild` drops the trigger props.
- `ReviewerAITrace` must stay service-free (verified safe: the popover's static imports are engine-free; `GenerationDetailsDialog` is lazy — the apiClient/supabase chain stays out of the static graph).
- Frontend tooling from the **repo root**; backend pytest from `backend/` with local Supabase up (worktree: copy `backend/.env` from the main checkout if absent).
- File-size ratchet: regenerate `scripts/fitness/check_file_size.baseline` in the same commit that grows a frozen file; the baseline diff must only grow files this feature genuinely grows.
- Forward-only: pre-D0 decisions carry no link; no backfill. Session-only linkage loss after reload is accepted and honest (D4 renders nothing on ambiguity) — **never** derive links from the server-rehydrated `status`.
- Conventional commits; each task commits green.

---

### Task 1: Shared value-equality lib (verbatim `stableStringify` move + `decisionMatchesVersion`)

**Files:**
- Create: `frontend/lib/runs/valueEquality.ts`
- Create: `frontend/lib/runs/valueEquality.test.ts`
- Modify: `frontend/hooks/runs/useReviewerSummary.ts` (delete the private copy, import from the lib)

**Interfaces:**
- Produces: `stableStringify(value: unknown): string` — **moved verbatim** from `useReviewerSummary.ts:71-88` including the `?? "null"` undefined guard AND the backend-lockstep docstring (`json.dumps(sort_keys=True)` + int/float caveat). `decisionMatchesVersion(decisionEnvelope: unknown, versionValue: unknown): boolean`.
- Consumed by: Task 6 (popover adoption chip), `useReviewerSummary` (agreement math — **zero behavior change**, the move is literal).

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/lib/runs/valueEquality.test.ts
import {describe, expect, it} from 'vitest';
import {decisionMatchesVersion, stableStringify} from '@/lib/runs/valueEquality';

describe('stableStringify', () => {
  it('is key-order independent', () => {
    expect(stableStringify({a: 1, b: 2})).toBe(stableStringify({b: 2, a: 1}));
  });
  it('keeps the undefined-leaf guard: undefined stringifies like null', () => {
    expect(stableStringify({a: undefined})).toBe(stableStringify({a: null}));
  });
});

describe('decisionMatchesVersion', () => {
  it('matches a plain decision envelope against the raw version value', () => {
    expect(decisionMatchesVersion({value: 'Retrospective cohort'}, 'Retrospective cohort')).toBe(true);
    expect(decisionMatchesVersion({value: 'edited text'}, 'Retrospective cohort')).toBe(false);
  });
  it('matches a unit envelope against the raw unit object', () => {
    expect(decisionMatchesVersion({value: {value: 5, unit: 'mg'}}, {value: 5, unit: 'mg'})).toBe(true);
  });
  it('matches an absent_reason marker on both sides', () => {
    const marker = {value: null, absent_reason: 'no_information'};
    expect(decisionMatchesVersion(marker, marker)).toBe(true);
    expect(decisionMatchesVersion({value: 'x'}, marker)).toBe(false);
  });
  it('never matches a null decision envelope', () => {
    expect(decisionMatchesVersion(null, 'x')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails** — `npx vitest run frontend/lib/runs/valueEquality.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement the lib.** Copy `stableStringify` **verbatim** from `useReviewerSummary.ts:71-88` — keep `JSON.stringify(value) ?? "null"` and move the full doc comment. Then add:

```typescript
/**
 * A decision's `value` is an envelope (`{value: X}` or
 * `{value: null, absent_reason}` — see writeRunFieldValue), while a history
 * version's `value` is the raw proposal value (which for an abstention is
 * itself marker-shaped). Wrap the version to envelope shape, then compare.
 */
export function decisionMatchesVersion(decisionEnvelope: unknown, versionValue: unknown): boolean {
  if (decisionEnvelope === null || decisionEnvelope === undefined) return false;
  const wrapped =
    versionValue !== null &&
    typeof versionValue === 'object' &&
    !Array.isArray(versionValue) &&
    'absent_reason' in (versionValue as Record<string, unknown>)
      ? versionValue
      : {value: versionValue};
  return stableStringify(decisionEnvelope) === stableStringify(wrapped);
}
```

- [ ] **Step 4: Dedupe `useReviewerSummary`** — delete the private copy, `import {stableStringify} from '@/lib/runs/valueEquality';`.

- [ ] **Step 5: Verify** — `npx vitest run frontend/lib/runs/valueEquality.test.ts frontend/test/useReviewerSummary.test.ts` → PASS (note: the summary test lives at `frontend/test/useReviewerSummary.test.ts`, not under `test/hooks/`).

- [ ] **Step 6: Commit** — `git commit -m "refactor(runs): extract stableStringify to lib + decisionMatchesVersion helper"`

---

### Task 2: Backend guard — validate caller-supplied `proposal_record_id` + role-gate the write endpoints

Panel blocker: `record_decision` validates proposal coordinates **only** in the `accept_proposal` branch (`extraction_review_service.py:71-86`); an `edit` decision persists any FK-existing proposal id verbatim — a project member could stamp a foreign article's (or a human) proposal into the append-only audit trail the trace renders. Also: `create_decision`/`create_proposal` are member-gated only (a viewer can write decisions — contradicts the spec's "same ensure_project_reviewer role gate" verified-fact; `mark_ready` at `extraction_runs.py:328` shows the intended pattern).

**Files:**
- Modify: `backend/app/services/extraction_review_service.py` (link guard for non-accept kinds)
- Modify: `backend/app/api/v1/endpoints/extraction_runs.py` (`ensure_project_reviewer` on `create_decision` + `create_proposal`)
- Modify: `backend/app/api/v1/endpoints/articles.py` (add the file's standard `@limiter.limit("30/minute")` to `suggestions/history`, mirroring content-markdown — hygiene while touching the area)
- Modify: `docs/superpowers/specs/2026-07-04-consensus-ai-trace-design.md` (correct the wrong verified-fact bullet; note the PR-1 backend guard amending "zero backend"; one sentence documenting the intentional cross-run-link asymmetry vs `accept_proposal`)
- Test: `backend/tests/` — extend the module that already tests `record_decision` (locate via `grep -rl "record_decision\|/decisions" backend/tests | head`)

**Interfaces:**
- Produces: `record_decision` raises the service's existing invalid-decision error when `proposal_record_id` is supplied (any kind) and the proposal does not exist, does not match the decision's `instance_id` + `field_id`, or has `source == 'human'`. **Run equality is NOT required** (select-version pins older runs' proposals of the same article — the accept_proposal branch's run check stays as-is, stricter by design). Viewer callers get 403 from both write endpoints.

- [ ] **Step 1: Write the failing integration tests** (real PG; follow the existing fixtures in the decisions test module — project + run + reviewer + an AI proposal on (inst, field)):

```python
async def test_edit_decision_link_must_match_coord(...):
    # AI proposal exists on (inst_a, field_a); posting an edit decision on
    # (inst_a, field_B) linking that proposal must 4xx, not persist.
    resp = await client.post(f"/api/v1/runs/{run.id}/decisions", json={
        "instance_id": str(inst_a), "field_id": str(field_b),
        "decision": "edit", "value": {"value": "x"},
        "proposal_record_id": str(ai_proposal.id),
    }, headers=reviewer_headers)
    assert resp.status_code == 400

async def test_edit_decision_link_rejects_human_proposal(...):
    # A human-source proposal id is not an AI basis.
    assert resp.status_code == 400

async def test_edit_decision_link_same_coord_older_run_ok(...):
    # Proposal from an OLDER run, same (instance, field) → accepted (select-version flow).
    assert resp.status_code == 200

async def test_viewer_cannot_write_decisions_or_proposals(...):
    # viewer role member → 403 on POST /decisions and POST /proposals.
    assert resp.status_code == 403
```

- [ ] **Step 2: Run to verify failure** — from `backend/`: `uv run pytest tests/<module> -k "link or viewer" -x` → the coord/human cases FAIL (currently 200), viewer cases FAIL (currently 2xx).

- [ ] **Step 3: Implement.** In `record_decision`, after the existing accept_proposal validation block, add the generic guard (skip when the accept branch already validated):

```python
        elif proposal_record_id is not None:
            proposal = await self._session.get(ExtractionProposalRecord, proposal_record_id)
            if (
                proposal is None
                or proposal.instance_id != instance_id
                or proposal.field_id != field_id
                or proposal.source == "human"
            ):
                raise InvalidDecisionError(
                    "proposal_record_id must reference an AI proposal on the same field"
                )
            # NOTE: run equality is intentionally NOT required — select-version
            # legitimately links proposals from older runs of the same article
            # (instance/field equality transitively pins the article).
```

(match the module's actual model/exception names and the `source` enum values — verify `system`-source proposals, if any, remain linkable; only `human` is excluded). Endpoints: add the `ensure_project_reviewer` dependency to `create_decision` and `create_proposal` exactly as `mark_ready` does. Articles: add the limiter decorator.

- [ ] **Step 4: Run the backend suite** — `uv run pytest tests/<module> -x` then the full `make test-backend` if local Supabase is up → PASS. If diff-cover later flags the endpoint dep lines (ASGI blind spot), add a direct endpoint-coroutine unit test.

- [ ] **Step 5: Spec corrections** (same commit): fix the verified-facts bullet ("same ensure_project_reviewer role gate" → "member-gated only until PR 1 added the reviewer gate"), amend PR-slicing ("PR 1 carries a small backend guard"), add the cross-run-asymmetry sentence.

- [ ] **Step 6: Commit** — `git commit -m "fix(runs): validate decision proposal links + reviewer role gate on write endpoints"`

---

### Task 3: D0 — honest link derivation + autosave stamping

Panel blocker: the server rehydrates `suggestions[key].status = 'accepted'` for **any** non-reject caller decision (`extraction_suggestion_read_service.py:76-82`) with `id` = the **latest** AI proposal (`:353-357`) — deriving links from that fabricates provenance after reload. Derive instead from (layer 1) the caller's **own persisted decision links** and (layer 2) **session-local adoption events**.

**Files:**
- Modify: `frontend/hooks/extraction/ai/useAISuggestions.ts` (session adoption map + `suggestionsReady` bit)
- Create: `frontend/lib/runs/aiLink.ts` + `frontend/lib/runs/aiLink.test.ts` (pure derivation)
- Modify: `frontend/services/extractionRunService.ts` (`proposalRecordId` param)
- Modify: `frontend/hooks/runs/useAutoSaveProposals.ts` (`linkByKey` prop, ref-mirrored)
- Modify: `frontend/pages/ExtractionFullScreen.tsx` (wiring + **explicit hook reorder** + the two lying comment blocks)
- Test: `frontend/test/hooks/useAutoSaveProposals.test.tsx`, `frontend/test/hooks/useAISuggestions.test.tsx`

**Interfaces:**
- Produces:
  - `useAISuggestions` returns two new fields: `sessionAdoption: Record<string, string | null>` (coord key → proposal id set by accept/select; `null` tombstone set by reject; **starts empty every mount, never hydrated from the read endpoint**) and `suggestionsReady: boolean` (true only after a successful load; false while loading and after a load error — Task 8's Manual chip depends on it).
  - `deriveAiLinkByKey(p: {decisions: ReviewerDecisionResponse[]; currentUserId: string | null; sessionAdoption: Record<string, string | null>}): Record<string, string>` — layer 1: caller's own newest decision per coord contributes its `proposal_record_id` when non-null; layer 2: sessionAdoption overrides (id sets, `null` deletes). Key = `${instanceId}_${fieldId}`.
  - `WriteProposalParams.proposalRecordId?: string | null`; decision body gains `proposal_record_id` only on `/decisions` and only when set. `UseAutoSaveProposalsProps.linkByKey?: Record<string, string>`.

- [ ] **Step 1: Failing tests.**

`aiLink.test.ts` (pure — this is the fabrication regression suite):

```typescript
import {describe, expect, it} from 'vitest';
import {deriveAiLinkByKey} from '@/lib/runs/aiLink';
import type {ReviewerDecisionResponse} from '@/hooks/runs/types';

const dec = (over: Partial<ReviewerDecisionResponse>): ReviewerDecisionResponse => ({
  id: 'd1', run_id: 'r', instance_id: 'i1', field_id: 'f1', reviewer_id: 'me',
  decision: 'edit', proposal_record_id: null, value: {value: 'x'},
  rationale: null, created_at: '2026-07-04T00:00:00Z', ...over,
});

describe('deriveAiLinkByKey', () => {
  it('layer 1: my own newest linked decision contributes the link', () => {
    const out = deriveAiLinkByKey({
      decisions: [dec({id: 'old', proposal_record_id: 'p1', created_at: '2026-07-01T00:00:00Z'}),
                  dec({id: 'new', proposal_record_id: 'p2', created_at: '2026-07-02T00:00:00Z'})],
      currentUserId: 'me', sessionAdoption: {},
    });
    expect(out).toEqual({i1_f1: 'p2'});
  });
  it('a newer UNLINKED own decision clears the coord (no resurrection)', () => {
    const out = deriveAiLinkByKey({
      decisions: [dec({id: 'old', proposal_record_id: 'p1', created_at: '2026-07-01T00:00:00Z'}),
                  dec({id: 'new', proposal_record_id: null, created_at: '2026-07-02T00:00:00Z'})],
      currentUserId: 'me', sessionAdoption: {},
    });
    expect(out).toEqual({});
  });
  it('ignores peers’ decisions and null user', () => {
    expect(deriveAiLinkByKey({
      decisions: [dec({reviewer_id: 'peer', proposal_record_id: 'p1'})],
      currentUserId: 'me', sessionAdoption: {},
    })).toEqual({});
    expect(deriveAiLinkByKey({
      decisions: [dec({proposal_record_id: 'p1'})],
      currentUserId: null, sessionAdoption: {},
    })).toEqual({});
  });
  it('layer 2: session adopt sets, session reject tombstones layer 1', () => {
    const decisions = [dec({proposal_record_id: 'p1'})];
    expect(deriveAiLinkByKey({decisions, currentUserId: 'me', sessionAdoption: {i1_f1: 'p9'}}))
      .toEqual({i1_f1: 'p9'});
    expect(deriveAiLinkByKey({decisions, currentUserId: 'me', sessionAdoption: {i1_f1: null}}))
      .toEqual({});
  });
});
```

`useAISuggestions.test.tsx` — new cases: (a) `sessionAdoption` is `{}` after a load that returns a server-marked `status: 'accepted'` suggestion (**the fabrication regression**: rehydrated status alone must produce no adoption entry); (b) accept/select set the coord's entry to the chosen id; (c) reject sets `null`; (d) `suggestionsReady` true after load, false after a rejected load promise.

`useAutoSaveProposals.test.tsx` — the three cases from the original plan (linked coord body carries `proposal_record_id: 'prop-9'`; unlinked coord omits the key; `/proposals` branch never carries it even when `linkByKey` matches).

- [ ] **Step 2: Run to verify failure** — all new cases FAIL.

- [ ] **Step 3: Implement.**
  - `aiLink.ts`: sort own decisions per coord by `created_at` (tie-break by array order), take newest, contribute non-null links; apply sessionAdoption overrides (`null` deletes).
  - `useAISuggestions.ts`: `const [sessionAdoption, setSessionAdoption] = useState<Record<string, string | null>>({});` — set `{...prev, [key]: proposalRecordId}` inside the accept/select success path (same place the optimistic `status: 'accepted'` state update happens today, lines ~178-188), `{...prev, [key]: null}` in the reject success path. `suggestionsReady`: `useState(false)`; set `true` on successful `loadSuggestions`, `false` on catch (the existing catch that empties the map) and while a load is in flight. Return both.
  - Service + autosave hook: as in the original plan (param threaded via `linkByKeyRef`, spread-omit falsy).
  - `ExtractionFullScreen.tsx` — **ordering is load-bearing** (panel: TS2448 as originally written — the autosave call sits at line ~371, the `useAISuggestions` destructure at ~484): move the `useAISuggestions` call **plus** `handleAISuggestionAccepted`/`handleAISuggestionRejected` (they depend only on `updateValue`/form state declared near the top) to just **above** the `useAutoSaveProposals` call; between them insert:

```typescript
  // D0: coords whose value has a traceable AI basis. Layer 1 = my own
  // persisted decision links (runDetail); layer 2 = this session's
  // accept/select/reject events. NEVER derived from suggestions[].status —
  // the server marks any non-reject decision 'accepted' (see
  // extraction_suggestion_read_service._resolve_status), which would
  // fabricate links for manually-typed values.
  const aiLinkByKey = useMemo(
    () =>
      deriveAiLinkByKey({
        decisions: runDetail?.decisions ?? [],
        currentUserId,
        sessionAdoption,
      }),
    [runDetail?.decisions, currentUserId, sessionAdoption],
  );
```

  pass `linkByKey: aiLinkByKey` to `useAutoSaveProposals`. Rewrite BOTH lying comment blocks with the true model: lines ~359-365 (claims human proposals in extract + decisions in consensus — wrong on both: extract writes `/decisions`, autosave never writes in consensus) and ~466-471 (claims "records it as a fresh human proposal" and "status resets on reload" — status rehydrates server-side from the caller's decisions).

- [ ] **Step 4: Verify** — `npx vitest run frontend/lib/runs/aiLink.test.ts frontend/test/hooks/useAutoSaveProposals.test.tsx frontend/test/hooks/useAISuggestions.test.tsx && npx tsc -p tsconfig.app.json --noEmit` → PASS/clean (tsc in-task catches any ordering mistake).

- [ ] **Step 5: Commit** — `git commit -m "feat(extraction): stamp autosaved edit decisions with a verified AI link (D0)"`

---

### Task 4: Verify-then-prune the dead suggestion write chains (no-legacy, full symmetric scope)

Panel blocker: the original scope missed the **reject-arm** twin (`useAISuggestions.ts:260-281`) and its exclusive chain, plus test/typecheck fallout. Both production call-sites pass `'human-proposal'`; nothing omits the prop; **both** `'reviewer-decision'` arms are unreachable.

**Files:**
- Delete: `frontend/hooks/runs/useCreateDecision.ts`
- Modify: `frontend/hooks/runs/index.ts`; `frontend/test/hooks-runs.test.tsx` (drop its describes; **port the runs-key invalidation pin** — lines ~410-439 — onto a surviving mutation hook, e.g. `useAdvanceStage`, same commit)
- Modify: `frontend/hooks/extraction/ai/useAISuggestions.ts` — remove `acceptStrategy` prop and **both** strategy branches (accept ~143-168 AND reject ~260-281 incl. its `wasAccepted` bookkeeping); drop `getRequiredUserId` import if orphaned; comments rewritten (Task 3 already covers the accept-path comment)
- Modify: `frontend/types/ai-extraction.ts` (`AISuggestionAcceptStrategy` type + prop)
- Modify: `frontend/services/aiSuggestionService.ts` — delete `acceptSuggestion`, `rejectSuggestion`, `resolveActiveRunId` (its only callers are the two deleted methods)
- Modify: `frontend/services/extractionValueService.ts` — delete `acceptProposal`, `rejectValue`, `findActiveRun` (orphaned once `resolveActiveRunId` goes); **also sweep the pre-existing dead** `saveValue` (:132-149) and `findLatestFinalizedRun` (:72-87) if the Step-1 greps confirm zero production consumers
- Modify: `frontend/pages/ExtractionFullScreen.tsx:504` and `:473-477` (drop prop; fix the reject-handler comment naming the strategy), `frontend/pages/QualityAssessmentFullScreen.tsx:292` and `:273` (drop prop; fix comment)
- Modify: `frontend/test/spinner-fix.e2e.test.tsx:248,282` (drop `acceptStrategy` literals — tsconfig.app.json typechecks tests too)
- Test: `frontend/test/hooks/useAISuggestions.test.tsx` (the reviewer-decision describes span ~163-425 incl. batchAccept service assertions — rewrite to always-bubbles), `frontend/test/services/aiSuggestionService.test.ts` (accept ~50-88 AND reject ~97-132), `frontend/test/services/extractionValueService.test.ts` (~216-274; note one test calls BOTH acceptProposal and rejectValue — delete it whole)

**Interfaces:**
- Produces: accept/select/reject in `useAISuggestions` are bubble-only (callback + session-adoption bookkeeping from Task 3). `extractionValueService` shrinks to `findFormRunsByArticle` + `unwrapValue` (+ anything the greps prove alive).

- [ ] **Step 1: Capture the evidence** (paste into the commit body; any unexpected consumer ⇒ STOP and re-scope):

```bash
grep -rn "useCreateDecision" frontend/ --include="*.ts*" | grep -v test
grep -rn "acceptStrategy" frontend/ --include="*.ts*" | grep -v test
grep -rn "acceptSuggestion\b\|rejectSuggestion\b" frontend/ --include="*.ts*" | grep -v test | grep -v useAISuggestions.ts
grep -rn "acceptProposal\b\|rejectValue\b\|findActiveRun\b\|resolveActiveRunId\b" frontend/ --include="*.ts*" | grep -v test | grep -v aiSuggestionService | grep -v extractionValueService
grep -rn "saveValue\b\|findLatestFinalizedRun\b" frontend/ --include="*.ts*" | grep -v test | grep -v extractionValueService
```

- [ ] **Step 2: Update tests first** (files above) — the rewritten suite asserts: accept → `onSuggestionAccepted` fires, **no** service write; reject → `onSuggestionRejected` fires, session tombstone set, **no** service write.

- [ ] **Step 3: Prune** per Files. **Step 4: Full gate** — `npm run test:run && npx tsc -p tsconfig.app.json --noEmit` → PASS, zero references to deleted symbols. **Step 5: Commit** — `git commit -m "refactor(extraction): remove dead accept/reject decision chains + useCreateDecision (verify-then-prune)"` with evidence.

---

### Task 5: D5 — history fetch depth + honest degradation when the pin is missing

Unchanged from the original plan except the copy-mock note (see Task 6's mock).

**Files:** `useAISuggestions.ts` (limit param), `AISuggestionReviewPopover.tsx` (notice), `frontend/lib/copy/extraction.ts` (`reviewPinNotInHistory: 'The adopted version is older than the loaded history.'`), tests in both files' suites.

- [ ] **Step 1: Failing tests** — popover: `getHistory` returns one newer item, `selectedProposalId="p-ancient"` → notice text rendered (query the key under the file's copy mock). Hook: `getSuggestionsHistory('i1','f1',50)` forwards 50; default forwards 10.
- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Implement** — hook signature `(instanceId, fieldId, limit = 10)`; popover `pinMissing` derivation + notice `<p>` above the run groups (exact snippets in the original plan body remain valid).
- [ ] **Step 4: Verify** — both suites PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(extraction): history fetch limit + explicit unloaded-pin notice (D5)"`

---

### Task 6: D2/D3 — popover consensus-reuse props + context-driven ran-by

**Files:**
- Modify: `frontend/components/extraction/ai/AISuggestionReviewPopover.tsx`
- Modify: `frontend/components/extraction/ai/shared/GenerationDetailsDialog.tsx` (gate the two "Ran by" surfaces on the same context flag)
- Modify: `frontend/components/runs/RunEditabilityContext.tsx` (context value gains `showPeerIdentity`)
- Modify: `frontend/lib/copy/extraction.ts` (`reviewAdoptedBy: 'Adopted by {{name}}'`, `reviewEditedBy: 'Edited by {{name}}'`, `reviewRunBy: 'Run by {{name}}'`)
- Test: `frontend/components/extraction/ai/AISuggestionReviewPopover.test.tsx`

**Interfaces:**
- `RunEditabilityContext` value becomes `{readOnly: boolean; showPeerIdentity: boolean}`; provider props gain `showPeerIdentity?: boolean` (**default false — fail-closed**; the default context value for provider-less renders is also `showPeerIdentity: false`). Doc comment updated: run-scoped view flags (editability + peer-identity display). This is **display consistency**, not an identity scrub — the backend history payload still carries `ranByName` to any member; the server-side scrub is PR 2 scope. **Do not cite #474 as if this were a scrub.**
- Popover props (all optional, additive): `onSelect?` (absent → no "Use this version" anywhere), `title?: string`, `adoption?: {reviewerLabel: string; decisionValue: unknown; decisionKind: string}`, `adoptionByProposalId?: Record<string, string>`. Ran-by headers render iff `showPeerIdentity` (from context) AND the group's first item has `provenance.ranByName`; timestamp-only otherwise. `GenerationDetailsDialog` hides its "Ran by" scalar row + context-pill name unless `showPeerIdentity` (read via the same hook — the dialog renders inside the provider's React tree; portals keep context).
- Adoption chip: pinned row's chip label becomes "Adopted by {name}" when `decisionKind === 'accept_proposal'` OR `decisionMatchesVersion(decisionValue, pinnedVersion.value)`; else "Edited by {name}". Cross-marks: rows whose id is in `adoptionByProposalId` get an outline tag with `reviewAdoptedBy` + that label.

- [ ] **Step 1: Failing tests.** **First fix the mock** (panel: key-echo makes name substitution untestable): replace the file's `vi.mock('@/lib/copy', ...)` with a template-preserving echo:

```typescript
vi.mock('@/lib/copy', () => ({
  t: (_ns: string, key: string) =>
    ({
      reviewAdoptedBy: 'Adopted by {{name}}',
      reviewEditedBy: 'Edited by {{name}}',
      reviewRunBy: 'Run by {{name}}',
    })[key] ?? key,
}));
```

Then the four cases (assert literal `'Adopted by Ana'` / `'Edited by Ana'` / `'Adopted by Bruno'` (cross-tag; use `getAllByText` when the pinned chip shares the string) / `/Run by Carla/`), plus: `onSelect` absent → no Use-this-version; ran-by absent when the provider lacks `showPeerIdentity` and for groups without `provenance.ranByName`. Wrap identity cases in `<RunEditabilityProvider stage="consensus" showPeerIdentity>`; keep one provider-less render asserting timestamp-only (fail-closed default).

- [ ] **Step 2: Verify failure.** — new cases FAIL.
- [ ] **Step 3: Implement** (snippets from the original plan body remain valid with two changes: `showRanBy` prop is REPLACED by the context read `const {readOnly, showPeerIdentity} = useRunEditability();`, and `readOnlyEffective = readOnly || !onSelect`). GenerationDetailsDialog: read the same hook; drop the `ranByName` context-pill part and the "Ran by" scalar row when `!showPeerIdentity`.
- [ ] **Step 4: Verify** — popover suite + `npx vitest run frontend/test/ExtractionFullScreen.readonly.test.tsx` (provider signature change compiles everywhere) + `npx tsc -p tsconfig.app.json --noEmit` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(extraction): popover attribution props + context-gated ran-by display (D2/D3)"`

---

### Task 7: Wire `showPeerIdentity` at every `RunEditabilityProvider` mount

**Files:**
- Modify: `frontend/pages/ExtractionFullScreen.tsx`, `frontend/pages/QualityAssessmentFullScreen.tsx` — `grep -n "RunEditabilityProvider" frontend/pages/*.tsx` and pass at **every** mount:

```tsx
  showPeerIdentity={!!runDetail?.peers_revealed || permissions.canSeeOthers}
```

(covers consensus auto-reveal AND unblinded/manager extract; blind extract reviewers stay timestamp-only). Verify the extract-stage form popovers actually sit inside a provider on both screens — if any popover mount is provider-less, wrap it at the same altitude as the existing consensus wrap rather than adding a prop path.

**Interfaces:** none new — provider prop from Task 6.

- [ ] **Step 1: Failing test** — extend `frontend/test/QualityAssessmentFullScreen.test.tsx` (or the extraction readonly harness — whichever renders a popover surface more cheaply): with a `peers_revealed: true` run fixture, the popover run-group header shows the ran-by text; with `peers_revealed: false` + `canSeeOthers: false`, it does not. If neither harness opens the popover cheaply, assert via the provider: render the screen and check a probe component/data attribute — otherwise cover with a targeted `RunEditabilityProvider` unit render and keep the screen change compile-verified.
- [ ] **Step 2 — 4: red → implement → green** + `npx tsc -p tsconfig.app.json --noEmit`.
- [ ] **Step 5: Commit** — `git commit -m "feat(runs): pass peer-identity display flag at run providers (D3)"`

---

### Task 8: D1/D4 — `ReviewerAITrace` leaf component

As the original plan, with three panel corrections: **Tooltip-outside pattern is the primary implementation** (`FieldInput.tsx:299-318` — Tooltip inside `PopoverTrigger asChild` drops trigger props), **tests wrap in `TooltipProvider`**, and `hasAISuggestion` becomes tri-state so a failed suggestions load can't mislabel.

**Files:**
- Create: `frontend/components/runs/ReviewerAITrace.tsx`, `frontend/components/runs/ReviewerAITrace.test.tsx`
- Modify: `frontend/lib/copy/consensus.ts` (`traceTitle: 'AI used by {{name}}'`, `traceManualChip: 'Manual'`, `traceManualChipTooltip: 'Entered manually — no AI suggestion exists for this field.'`)

**Interfaces:**

```typescript
export interface ReviewerAITraceProps {
  decision: ReviewerDecisionResponse;
  field: ComparisonField;
  articleId: string;
  getHistory: (instanceId: string, fieldId: string) => Promise<AISuggestionHistoryItem[]>;
  reviewerLabel: string;
  adoptionByProposalId: Record<string, string>;
  /** null = AI-existence unknown (suggestions not loaded / load failed) —
   *  render NOTHING for unlinked decisions rather than a false "Manual". */
  hasAISuggestion: boolean | null;
}
```

Render matrix: reject → null. Linked → tooltip-wrapped sparkles icon-button (aria-label = substituted `traceTitle`) opening the popover with `selectedProposalId`, `title`, `adoption` (`decisionValue: decision.value`, `decisionKind: decision.decision`), `adoptionByProposalId`, no `onSelect`. Unlinked → Manual chip **only when `hasAISuggestion === false`**; null/true → nothing. (No `showRanBy` prop — context from Task 6 covers it.)

- [ ] **Step 1: Failing tests** — the four cases from the original plan **plus** `hasAISuggestion={null}` → empty render; all renders wrapped:

```tsx
const renderTrace = (ui: React.ReactElement) =>
  render(
    <TooltipProvider>
      <RunEditabilityProvider stage="consensus" showPeerIdentity>{ui}</RunEditabilityProvider>
    </TooltipProvider>,
  );
```

and the icon query uses the template-mock substituted name (mock `@/lib/copy` as in Task 6 with `traceTitle: 'AI used by {{name}}'`): `screen.getByRole('button', {name: 'AI used by Ana'})`.

- [ ] **Step 2 — 4: red → implement → green.**
- [ ] **Step 5: Commit** — `git commit -m "feat(consensus): ReviewerAITrace leaf — trace icon + honest Manual chip (D1/D4)"`

---

### Task 9: Thread the trace through the resolve table + both screens (+ baseline bump)

As the original plan with the panel corrections:

- `ConsensusTraceContext` gains the readiness bit and drops nothing else:

```typescript
export interface ConsensusTraceContext {
  articleId: string;
  getHistory: (instanceId: string, fieldId: string) => Promise<AISuggestionHistoryItem[]>;
  /** null while suggestions are loading/failed — Manual chips suppress. */
  aiSuggestions: Record<string, AISuggestion> | null;
}
```

- `ResolveRow` cell pass: `hasAISuggestion={trace.aiSuggestions ? !!trace.aiSuggestions[getSuggestionKey(row.instanceId, row.field.id)] : null}` (no `showRanBy` — context). Screens pass `aiSuggestions: suggestionsReady ? aiSuggestions : null` (Task 3's bit) and `getHistory: (i, f) => getSuggestionsHistory(i, f, 50)`.
- Tests: wrap the `renderTable`/panel render helpers in `TooltipProvider` (+ `RunEditabilityProvider stage="consensus"`); the **agreed-row case must actually be agreed** — `divergentCoords: new Set()`, two equal-valued linked decisions, click the "All" filter (`consensus-filter-all` or its accessible name) before asserting **two** trace buttons; add a `aiSuggestions: null` case asserting no Manual chip for an unlinked decision; keep the Consensus-column negative assertion.
- Baseline bump (`--update-baseline`) in this commit; diff-check the baseline as before.

- [ ] **Steps: red → implement → green → commit** — `git commit -m "feat(consensus): per-reviewer AI trace in the resolve table on both screens (D1-D4)"`

---

### Task 10: D6 — remove dead consensus affordances + viewer resolve-chrome gate

As the original plan with the panel's test rewrite (the harnesses render **real copy** — key-name queries are born-green):

- Queries use real accessible names: CompareToggle → `{name: /^compare$/i}`; adopt → `{name: /Publish this reviewer/}`; override → `{name: /^Override$/}`.
- Every negative gets a positive control that flips red→green: extract-stage + `peers_revealed: true` fixture asserts the toggle IS present (extraction), and the QA consensus fixture gains **two divergent reviewer decisions** so resolve chrome renders for a non-viewer (positive) and is absent for the `role: 'viewer'` variant.
- The three guards are unchanged from the original plan (`hasComparison={canCompare && !inConsensusStage}`; QA jump + toggle `!inConsensusStage`; `canResolve={permissions.userRole !== 'viewer'}`).

- [ ] **Steps: red (the consensus-stage negatives + viewer case genuinely fail) → implement → green → commit** — `git commit -m "fix(consensus): drop dead compare affordances in consensus + gate viewer resolve chrome (D6)"`

---

### Task 11: Full gate + plan-doc hygiene

- [ ] **Step 1:** Add this plan to `.markdownlintignore` ("Active in-flight plans" block, date order).
- [ ] **Step 2:** `npm run test:run && npm run lint && npx tsc -p tsconfig.app.json --noEmit` → read the output.
- [ ] **Step 3:** `bash scripts/fitness/run_all.sh`; backend: `make test-backend` (local Supabase) — Task 2 changed backend code, the full suite must run green before the PR.
- [ ] **Step 4:** Commit plan + lint entry — `git commit -m "docs(plan): consensus AI trace PR1 implementation plan"`.

---

## Self-review notes

- **Spec coverage:** D0→Tasks 2+3 (write path now server-validated; derivation honest); D1→8+9; D2→6+8; D3→6+7+8; D4→8+9 (tri-state); D5→5; D6→10; no-legacy→4 (full symmetric prune), 3 (both lying comment blocks), 9 (baseline discipline). D7/D8 = PR 3/PR 2.
- **Deviations from the locked spec, with cause:** (1) PR 1 is no longer zero-backend — the panel's forged-link finding makes the guard belong to the PR that creates the write path (append-only rows can't be cleaned later); the spec file gets the correction in Task 2. (2) `showRanBy` is context-derived, not prop-threaded — same D3 gate (`peers_revealed || canSeeOthers`), computed once per screen; the spec prescribes the gate, not the mechanism. (3) The blinding language is display-consistency only; the genuine history scrub (with its run-scoped-reveal semantics on an article-scoped endpoint) is designed in PR 2 alongside D8's backend work. (4) `ReviewerAITrace` drops `decisionValue`/`showRanBy` props, adds tri-state `hasAISuggestion`.
- **Known accepted limitation:** linkage is layer-1(persisted)+layer-2(session); a reviewer who adopts, reloads, and re-edits keeps the link via layer 1 — but one who adopts and reloads *before autosave flushed* loses it (honest absence, D4 renders nothing). RunEditabilityContext keeps its name while gaining a display flag — recorded as a naming compromise; rename to RunViewContext only if per-task review objects.
