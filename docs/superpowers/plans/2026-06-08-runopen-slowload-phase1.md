# Run-open slow-load — Phase 1 (dedup the fan-out) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the redundant requests fired when ExtractionFullScreen opens a saved run — chiefly the `supabase.auth.getUser()` calls that re-fire on every proposals/stage change (the ×3-6 multiplier) plus a few duplicate Supabase reads — without touching the blinding/stage/progress behaviour or adding any new mutation.

**Architecture:** Replace network `auth.getUser()` with the existing zero-network `useCurrentUser()` (reads AuthContext) and thread the id down as a prop; feed already-fetched data into hooks that re-fetch it; tighten an over-eager gate. The RunView server-side collapse is **Phase 2 (deferred to its own branch)** — net-new endpoint + a lossy version-snapshot widening migration, too large to interleave with the 16 unmerged commits.

**Tech Stack:** React 18, TS strict, TanStack Query, vitest. Branch `fix/extraction-stale-blind-progress`. Established patterns: thread ids as props (no per-hook auth fetch), atomic commits, verify with `npm run typecheck` + `npx eslint` + vitest.

---

## File Structure

- Modify: `frontend/pages/ExtractionFullScreen.tsx` — use `useCurrentUser()`; thread `currentUserId` into `useExtractedValues`, `useModelManagement`, `useOtherExtractions`.
- Modify: `frontend/hooks/extraction/useExtractedValues.ts` — accept `currentUserId` prop; delete its two `auth.getUser()` calls.
- Modify: `frontend/hooks/extraction/useModelManagement.ts` — accept model instances; drop its `extraction_instances` select.
- Modify: `frontend/hooks/extraction/colaboracao/useOtherExtractions.ts` — accept `activeRunId`; drop `findActiveRun`.
- Modify: `frontend/hooks/extraction/useFinalizedExtractionRun.ts` — gate `enabled: isFinalized`.
- Test: `frontend/hooks/extraction/useExtractedValues.auth.test.ts` (new, the regression guard for the auth dedup).

---

### Task 1: useExtractedValues stops calling auth.getUser (the ×3-6 win)

**Files:**
- Modify: `frontend/hooks/extraction/useExtractedValues.ts`
- Modify: `frontend/pages/ExtractionFullScreen.tsx`

- [ ] **Step 1:** In `UseExtractedValuesProps` add `currentUserId: string | null;`. Destructure it in the hook.
- [ ] **Step 2:** Proposal-stage branch — delete the `const userRes = await supabase.auth.getUser(); ... const currentUserId = ...` block; use the prop directly when calling `pickLatestProposalPerCoord(proposals, { currentUserId })` (already fail-closed on null).
- [ ] **Step 3:** Reviewer-state branch — delete its `supabase.auth.getUser()`; replace the `if (!user)` short-circuit with `if (!currentUserId) { hydratedRunIdRef.current = runId; resetValuesIfNeeded(setValues); return; }` and call `ExtractionValueService.loadValuesForUser(runId, currentUserId)`.
- [ ] **Step 4:** ExtractionFullScreen — pass `currentUserId` (from Task 3's `useCurrentUser`) into the `useExtractedValues({ ... })` call.
- [ ] **Step 5:** `npm run typecheck && npx eslint frontend/hooks/extraction/useExtractedValues.ts frontend/pages/ExtractionFullScreen.tsx` — clean.

- [ ] **Step 6: Write the regression test** `frontend/hooks/extraction/useExtractedValues.auth.test.ts` (renderHook + mock `@/integrations/supabase/client`): assert `supabase.auth.getUser` is NOT called for the proposal stage; assert the blind filter still hides another reviewer's human proposal; assert `currentUserId=null` yields an empty map without throwing.

- [ ] **Step 7:** `npx vitest run frontend/hooks/extraction/useExtractedValues.auth.test.ts` — PASS.

- [ ] **Step 8: Commit** `feat(extraction): useExtractedValues takes currentUserId, drops auth.getUser`

---

### Task 2: ExtractionFullScreen uses useCurrentUser (no auth round-trip)

**Files:**
- Modify: `frontend/pages/ExtractionFullScreen.tsx`

- [ ] **Step 1:** Verify `frontend/hooks/useCurrentUser.ts` exposes a zero-network user id (reads AuthContext). Import it.
- [ ] **Step 2:** Replace the `loadUser()` effect + `const [currentUserId, setCurrentUserId] = useState('')` with `const { userId: currentUserId } = useCurrentUser();` (adapt the destructure to its real shape).
- [ ] **Step 3:** `npm run typecheck && npx eslint frontend/pages/ExtractionFullScreen.tsx` — clean. (currentUserId is now threaded into useExtractedValues from Task 1.)
- [ ] **Step 4: Commit** `feat(extraction): ExtractionFullScreen reads current user from context`

---

### Task 3: useModelManagement reuses the page's instances

**Files:**
- Modify: `frontend/hooks/extraction/useModelManagement.ts`
- Modify: `frontend/pages/ExtractionFullScreen.tsx`

- [ ] **Step 1:** Add a `modelInstances` input (the page's `instances` filtered by `modelParentEntityTypeId`); in `loadModels` build models from it instead of the `supabase.from('extraction_instances').select(...)` read (keep the `calculate_model_progress` RPC loop). Wire from the page.
- [ ] **Step 2:** `npm run typecheck && npx eslint frontend/hooks/extraction/useModelManagement.ts frontend/pages/ExtractionFullScreen.tsx` — clean.
- [ ] **Step 3: Commit** `refactor(extraction): useModelManagement reuses page instances`

---

### Task 4: useOtherExtractions + useFinalizedExtractionRun gates

**Files:**
- Modify: `frontend/hooks/extraction/colaboracao/useOtherExtractions.ts`
- Modify: `frontend/hooks/extraction/useFinalizedExtractionRun.ts`
- Modify: `frontend/pages/ExtractionFullScreen.tsx`

- [ ] **Step 1:** `useOtherExtractions` — add `activeRunId` input; use it instead of `ExtractionValueService.findActiveRun`; if null, set empty and return. Wire from the page.
- [ ] **Step 2:** `useFinalizedExtractionRun` — tighten the enabled gate to `isFinalized` (was `!activeRunId || isFinalized`) so the finalized-run read only fires for an actually-finalized run. Verify the reopen button still renders (it already gates on `runDetail.run.stage`).
- [ ] **Step 3:** `npm run typecheck && npx eslint <the three files>` — clean.
- [ ] **Step 4: Commit** `perf(extraction): scope other-extractions + finalized-run reads to when needed`

---

### Task 5: Verify the fan-out shrank (prod re-measure, optional)

- [ ] **Step 1:** `npm run typecheck` clean; `npx vitest run frontend/` for the touched areas green; `npx eslint frontend/pages frontend/hooks/extraction` clean.
- [ ] **Step 2 (optional, on the PR preview):** open the saved run, capture the Resource-Timing API count of `/auth/v1/user` (was 3-6 → expect 0-1) and `extraction_instances` reads; confirm progress, blinding, and the form still render correctly.

---

## Phase 2 (deferred — separate branch)

Per the design review: a `build_run_view(db, run_id, *, caller_id, is_arbitrator)` that COMPOSES `get_run_with_workflow_history` (keeping the item-3 blind filter as the single source) + entity_types tree + seeded instances + caller current_values; embed it in the session-open response and add a read-only `GET /runs/{id}/view`. Requires widening the lossy `_snapshot_initial_version` (omits role/unit/validation_schema/…) + a backfill migration. POST /hitl/sessions stays the only mutating entry point (no GET ever seeds). Large, multi-commit; do NOT interleave with the unmerged branch.

## Self-Review

- **Spec coverage:** auth dedup (Tasks 1-2, the ×3-6 win), instances dedup (Task 3), gate scoping (Task 4), verification (Task 5). ✓
- **Type consistency:** `currentUserId: string | null` flows page → useExtractedValues identically; `activeRunId`/`modelInstances` props named consistently with the page's existing vars.
- **Risk:** Phase 1 adds NO new mutation (the double-mutation-on-open hazard is Phase-2-only). The auth change preserves the signed-out short-circuit + the #49 throw-on-real-error intent (context only ever holds a validated session). Blinding is preserved (currentUserId still feeds `pickLatestProposalPerCoord` + `loadValuesForUser`).
