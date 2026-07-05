---
status: approved
last_reviewed: 2026-07-05
owner: '@raphaelfh'
---

# Consensus AI Trace — PR 2 (D8 QA parity + ran-by scrub + E2E) & PR 3 (D7 docs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give QA runs real per-reviewer decisions (one shared write path, `current_values` hydration + baseline, consensus-entry materialization), scrub ran-by identity server-side with per-run reveal, land the consensus-trace E2E, and archive the superseded consensus docs.

**Architecture:** Frontend: `isWritableStage` narrows to `stage === 'extract'`; the `/proposals` write branch, `useDecisionEndpoint`, the `kind` prop, and `CreateProposalRequest` are deleted; the QA screen adopts the extraction screen's link wiring and derives BOTH hydration and `baselineValues` from ONE `current_values` map via a new shared `currentValuesToValuesMap` helper; the dead `usesProposalsPath` read chain is pruned whole. Backend: `resolve_caller_current_values` Layer-1 also admits `source='system'` proposals (reopen seeding); `RunLifecycleService.advance_stage` materializes `edit` decisions (value copied, rationale marker, no `proposal_record_id`) for QA runs at extract→consensus via `record_decision`; `create_proposal` rejects forged human `source_user_id`; `advance_run` gains the reviewer role gate; the suggestion read service scrubs `ran_by_user_id`/`ran_by_name` per item using that item's run stage (mirroring `/view`: finalized → everyone, consensus → arbitrator, else `caller_can_see_peers`). No schema change, no migration.

**Tech Stack:** React 19 + TS strict, vitest; FastAPI + SQLAlchemy async, pytest on real PG (local Supabase); Playwright (local-hitl serial project).

**Spec:** `docs/superpowers/specs/2026-07-04-consensus-ai-trace-design.md` (D7 + D8 + the 2026-07-05 correction/amendment notes).
**Panel:** 2026-07-05, five lenses, findings code-verified; 29 confirmed findings folded in — the largest: the autosave VALUE baseline also read proposals (mount re-post bug), Layer-1 missed system-seeded proposals (reopen blank-out), per-run (not article-level) reveal for the scrub, a forgeable `source_user_id` feeding materialized attribution, and the E2E filename matching no Playwright project.

## Global Constraints

- English-only copy, single-sourced in `frontend/lib/copy/`.
- React Compiler `panicThreshold: 'all_errors'`: no `try/finally` or `throw` inside `try` in component/hook bodies.
- NEVER derive AI links from `suggestions[].status`; links come only from `deriveAiLinkByKey`.
- Autosave dirtiness is the `[value, link]` fingerprint; QA passes `baselineLinkByKey` or same-value adoptions re-post on mount.
- The backend link guard intentionally does NOT require run equality for `edit` links — do not "fix".
- Frontend tooling from the repo root; backend pytest from `backend/`, never concurrently.
- No Pydantic shape change planned; if any endpoint schema changes anyway: `npm run generate:api-types` + commit.
- File-size ratchet: `--update-baseline` in the same commit that grows a frozen file; diff-check the baseline.
- Conventional commits; each task commits green (run the test files the task touches).
- QA finalize/publish never reads decisions; D8 must not disturb it.

---

### Task 1: One shared write path + QA autosave wiring (single commit — QA autosave must not go dark between commits)

**Files:**
- Modify: `frontend/hooks/runs/useAutoSaveProposals.ts` — `isWritableStage` → `stage === 'extract'` (drop the null carve-out and the `WRITABLE_STAGES` set; one predicate shared by badge, debounce, and write — do NOT add a second in-`performSave` guard); delete the `kind` prop + `kindRef` + `useDecisionEndpoint`; rewrite the module docstring and the stage/kind prop docs (they describe kind-aware /proposals writes — now lies)
- Modify: `frontend/services/extractionRunService.ts:135-206` — delete the endpoint ternary + `/proposals` body branch; `WriteProposalParams` loses `useDecisionEndpoint`; drop the `CreateProposalRequest` import
- Modify: `frontend/hooks/runs/types.ts:14-22` (delete `CreateProposalRequest`), `frontend/hooks/runs/index.ts:37` (drop re-export)
- Modify: `frontend/pages/ExtractionFullScreen.tsx` (drop `kind: 'extraction'` autosave arg)
- Modify: `frontend/pages/QualityAssessmentFullScreen.tsx:260-303` — autosave call gains `stage: runDetail?.run.stage ?? null`, `linkByKey`, `baselineLinkByKey`; destructure `sessionAdoption` from `useAISuggestions`
- Modify: `frontend/lib/runs/aiLink.ts` (export `EMPTY_SESSION_ADOPTION`; dedupe with ExtractionFullScreen's local constant if one exists)
- Test: `frontend/test/hooks/useAutoSaveProposals.test.tsx` (FULL-FILE sweep), `frontend/test/services/extractionRunService.test.ts`, `frontend/test/QualityAssessmentFullScreen.test.tsx`

**Interfaces:**
- Produces: `writeRunFieldValue(params)` always POSTs `/api/v1/runs/{runId}/decisions` with `{instance_id, field_id, decision: 'edit', value, ...(proposalRecordId ? {proposal_record_id} : {})}`. `useAutoSaveProposals` props lose `kind`; `isWritableStage(stage) === (stage === 'extract')`. QA autosave carries the two link maps exactly like ExtractionFullScreen (:422-483 pattern).

- [ ] **Step 1: Capture prune evidence** (paste into commit body):

```bash
grep -rn "useDecisionEndpoint" frontend/ --include="*.ts*"
grep -rn "CreateProposalRequest" frontend/ --include="*.ts*" | grep -v schema.d.ts
grep -n "kind" frontend/hooks/runs/useAutoSaveProposals.ts
```

- [ ] **Step 2: Flip the tests first — FULL-FILE sweep.** In `useAutoSaveProposals.test.tsx` (~13 hook invocations omit `stage` and assert `/proposals` bodies): add `stage: 'extract'` to every invocation that must keep writing; flip every URL/body assertion from `/proposals` + `{source: 'human', proposed_value}` to `/decisions` + `{decision: 'edit', value}`; DELETE `"falls back to /proposals when stage is undefined (QA backwards compat)"` and the `:767` "never adds proposal_record_id on the proposals endpoint" test (branch no longer exists). The red guard test uses `stage: undefined` (red today — it writes `/proposals`; green after — no call):

```typescript
it('does not write when stage is undefined (stage-based guard, D8)', async () => {
  const {result} = renderHook(() =>
    useAutoSaveProposals({runId: 'run-1', values: {'inst-1_field-1': 'hello'}}),
  );
  await act(async () => { await result.current.saveNow(); });
  expect(apiClientMock).not.toHaveBeenCalled();
});
```

Rewrite the QA case:

```typescript
it("writes an 'edit' decision for a QA run in 'extract' (D8: one shared write path)", async () => {
  apiClientMock.mockResolvedValue(DECISION_RESPONSE);
  const {result} = renderHook(() =>
    useAutoSaveProposals({runId: 'run-1', stage: 'extract', values: {'inst-1_field-1': 'hello'}}),
  );
  await act(async () => { await result.current.saveNow(); });
  expect(apiClientMock).toHaveBeenCalledWith(
    '/api/v1/runs/run-1/decisions',
    expect.objectContaining({method: 'POST'}),
  );
});
```

In `extractionRunService.test.ts` (:196-313): `writeRunFieldValue` always hits `/decisions`; keep body-shape assertions; drop `useDecisionEndpoint: false` cases. In `QualityAssessmentFullScreen.test.tsx`: the autosave-enabled case asserts the POST goes to `/decisions`.

- [ ] **Step 3: Run to verify failure** — `npx vitest run frontend/test/hooks/useAutoSaveProposals.test.tsx frontend/test/services/extractionRunService.test.ts frontend/test/QualityAssessmentFullScreen.test.tsx` → flipped cases FAIL.

- [ ] **Step 4: Implement** (per Files above). QA screen link memos (mirroring ExtractionFullScreen :422-442):

```typescript
  const aiLinkByKey = useMemo(
    () =>
      deriveAiLinkByKey({
        decisions: runDetail?.decisions ?? [],
        currentUserId: userId ?? null,
        sessionAdoption,
      }),
    [runDetail?.decisions, userId, sessionAdoption],
  );
  const persistedAiLinkByKey = useMemo(
    () =>
      deriveAiLinkByKey({
        decisions: runDetail?.decisions ?? [],
        currentUserId: userId ?? null,
        sessionAdoption: EMPTY_SESSION_ADOPTION,
      }),
    [runDetail?.decisions, userId],
  );
```

- [ ] **Step 5: Verify** — same three test files + `npx tsc -p tsconfig.app.json --noEmit` → PASS/clean.

- [ ] **Step 6: Commit** — `git commit -m "feat(runs): one shared write path — decisions for both kinds; QA link wiring (D8-a)"` with Step-1 evidence.

---

### Task 2: Backend — Layer-1 admits system-seeded proposals (reopen support before the hydration switch)

**Files:**
- Modify: `backend/app/services/extraction_run_read_service.py:264-290` (`resolve_caller_current_values` Layer-1 filter)
- Test: the module housing `resolve_caller_current_values` tests (locate: `grep -rl "resolve_caller_current_values\|current_values" backend/tests | head`)

**Interfaces:**
- Produces: Layer-1 includes proposals where `(source == 'human' AND source_user_id == caller) OR source == 'system'`, newest-first per coord unchanged; Layer-2 (own decisions) still overrides. System proposals are not reviewer-attributable — no blind concern.

- [ ] **Step 1: Failing integration test** — a QA run with only `source='system'` proposals (the reopen-seeding shape): `resolve_caller_current_values` returns those coords for any reviewer caller; a caller's own newer human proposal on the same coord wins; another reviewer's human proposal still never leaks.
- [ ] **Step 2: Verify failure** — system-only fixture returns `[]` today.
- [ ] **Step 3: Implement** — extend the Layer-1 `where` to `or_(and_(source == HUMAN, source_user_id == caller_id), source == SYSTEM)`; update the docstring (Layer-1 = own human proposals + system seeds).
- [ ] **Step 4: Verify** — module suite green; also run the blind-isolation suite (`uv run pytest tests -k "blind" -x`) to prove no peer leak.
- [ ] **Step 5: Commit** — `git commit -m "fix(runs): current_values Layer-1 covers system-seeded proposals (reopen)"`

---

### Task 3: QA hydration + autosave baseline from ONE `current_values` map; prune the dead proposals read chain

**Files:**
- Create: `currentValuesToValuesMap` in the module housing `publishedStatesToValuesMap` (locate: `grep -rn "publishedStatesToValuesMap" frontend/lib frontend/pages --include="*.ts*"`) + its test file
- Modify: `frontend/pages/QualityAssessmentFullScreen.tsx` — the hydration block (:210-231) AND the `loadedValuesMap` block (:247-258) both replaced by the ONE map; `grep -n "runDetail.proposals\|runDetail?.proposals" frontend/pages/QualityAssessmentFullScreen.tsx` must return zero hits after
- Modify: `frontend/hooks/extraction/useExtractedValues.ts` — delete `usesProposalsPath` + the proposals branch + the `proposals` and `kind` props; fix the header comment
- Modify: `frontend/pages/ExtractionFullScreen.tsx` — drop the deleted useExtractedValues args
- Delete (verify-then-prune): `frontend/lib/extraction/proposalValues.ts` + its test IF the deleted branch was its last consumer (`grep -rn "proposalValues\|pickLatestProposalPerCoord\|unwrapValue" frontend/ --include="*.ts*" | grep -v test` — any unexpected consumer ⇒ keep and note)
- Modify: `frontend/test/hooks/useExtractedValues.test.tsx` — delete the QA-proposals-path describes; record in the commit body that the blinding pin now lives in the backend resolver tests (Task 2)
- Test: `frontend/test/QualityAssessmentFullScreen.test.tsx`

**Interfaces:**
- Produces: `currentValuesToValuesMap(rows: RunViewCurrentValue[]): Map<string, unknown>` — skips `decision === 'reject'`; preserves the envelope verbatim when it is an absent-reason marker (same contract as `publishedStatesToValuesMap`); otherwise unwraps via the SAME helper the extraction path uses (find it next to `publishedStatesToValuesMap` — do not hand-roll a fourth unwrap variant). Keyed `${instance_id}_${field_id}`.
- QA screen: hydration `setValues` merge AND `baselineValues` both feed from this one map.

- [ ] **Step 1: Failing tests.**
  - Helper unit: plain value `{value: 'Probably yes'}` → `'Probably yes'`; unit envelope `{value: {value: 5, unit: 'mg'}}` → the shape the extraction screen hydrates (pin whatever the shared helper returns — this is the Phase-B double-wrap regression pin); marker `{value: null, absent_reason: 'no_information'}` → preserved object; `decision: 'reject'` row → absent.
  - Screen: mock `/view` with `current_values` populated and `proposals: []` → form renders the values AND **zero `/decisions` POSTs on mount** (the baseline now covers hydrated coords — this re-fixtures Task 1's mount-silence expectation onto the shipped read path).
- [ ] **Step 2: Verify failure** — screen hydrates nothing from a `current_values`-only fixture today.
- [ ] **Step 3: Implement** per Files. QA screen: build `const loadedValuesMap = useMemo(() => currentValuesToValuesMap(runDetail?.current_values ?? []), [runDetail?.current_values]);` (keep the finalized `publishedStatesToValuesMap` branch), hydrate `setValues` from it (existing merge semantics unchanged), and pass the same object to `baselineValues`.
- [ ] **Step 4: Verify** — `npx vitest run frontend/test/QualityAssessmentFullScreen.test.tsx frontend/test/hooks/useExtractedValues.test.tsx <helper test> && npx tsc -p tsconfig.app.json --noEmit` → PASS; run the zero-hits grep from Files.
- [ ] **Step 5: Commit** — `git commit -m "feat(qa): hydrate + baseline from current_values; prune dead proposals read chain (D8-b)"` with prune evidence.

---

### Task 4: Backend — QA decision materialization at extract→consensus

**Files:**
- Modify: `backend/app/services/run_lifecycle_service.py:199-242`
- Test: the module housing advance tests (locate: `grep -rl "advance_stage" backend/tests`)

**Interfaces:**
- Consumes: `ExtractionReviewService.record_decision(...)` (stage still `'extract'` at call time — its stage gate passes; its replay dedup + `ExtractionReviewerState` upsert are the idempotency machinery).
- Produces: `_materialize_qa_decisions(run: ExtractionRun) -> int` on `RunLifecycleService`; each materialized decision carries `rationale=f"Materialized from human proposal {p.id} at consensus entry"` (constitution §IX: the mechanism is recorded; the FK cannot carry a human-proposal link — `proposal_record_id` stays None because a human proposal is not an AI basis).

- [ ] **Step 1: Failing integration tests** (real PG; QA run = quality_assessment-kind template):

```python
async def test_qa_advance_materializes_edit_decisions(...):
    # reviewer posts two human proposals on one coord (newest wins) + one on another coord
    # advance extract -> consensus
    # assert per (reviewer, coord): decision == 'edit', value == newest proposed_value verbatim,
    #   proposal_record_id IS NULL, rationale startswith 'Materialized from human proposal',
    #   ExtractionReviewerState.current_decision_id set

async def test_qa_materialization_skips_coords_with_existing_decision(...):
    # coord A: proposal + a real 'edit' decision with a DIFFERENT value -> untouched
    # coord B: proposal only -> materialized

async def test_qa_materialization_replay_is_noop(...):
    # svc._materialize_qa_decisions(run) twice before the stage flip -> second returns 0

async def test_extraction_advance_does_not_materialize(...):
    # extraction-kind run with a stray human proposal, no decision -> no rows created

async def test_qa_select_existing_succeeds_against_materialized_row(...):
    # record_consensus(mode='select_existing', selected_decision_id=materialized.id) -> ok,
    # published value == proposal value

async def test_qa_single_user_export_not_blank_after_advance(...):
    # export value map for the reviewer covers the answered coords with non-empty values
```

- [ ] **Step 2: Verify failure** — from `backend/`: `uv run pytest <module> -k "materiali or qa_" -x` → FAIL.
- [ ] **Step 3: Implement.** In `advance_stage`, after the transition-allowed check, before `run.stage = target`:

```python
        if (
            target == ExtractionRunStage.CONSENSUS.value
            and run.kind == TemplateKind.QUALITY_ASSESSMENT.value
        ):
            # D8-b: QA extract wrote human proposals until this cycle; the
            # compare table, select_existing, and single-user exports read
            # decisions. Materialize each reviewer's newest human proposal as
            # an 'edit' decision (value copied — accept_proposal carries
            # value=None by contract and would collapse agreement math), no
            # proposal_record_id (a human proposal is not an AI basis).
            # Idempotent: coords that already have any decision are skipped.
            await self._materialize_qa_decisions(run)
```

```python
    async def _materialize_qa_decisions(self, run: ExtractionRun) -> int:
        proposals = (
            (
                await self.db.execute(
                    select(ExtractionProposalRecord)
                    .where(
                        ExtractionProposalRecord.run_id == run.id,
                        ExtractionProposalRecord.source
                        == ExtractionProposalSource.HUMAN.value,
                    )
                    .order_by(ExtractionProposalRecord.created_at.desc())
                )
            )
            .scalars()
            .all()
        )
        newest_by_key: dict[tuple[UUID, UUID, UUID], ExtractionProposalRecord] = {}
        for p in proposals:
            newest_by_key.setdefault((p.source_user_id, p.instance_id, p.field_id), p)
        decided = {
            (d.reviewer_id, d.instance_id, d.field_id)
            for d in (
                await self.db.execute(
                    select(ExtractionReviewerDecision).where(
                        ExtractionReviewerDecision.run_id == run.id
                    )
                )
            ).scalars()
        }
        review = ExtractionReviewService(self.db)
        inserted = 0
        for key, p in newest_by_key.items():
            if key in decided:
                continue  # a real decision (even a differing one) wins — never overwrite
            reviewer_id, instance_id, field_id = key
            await review.record_decision(
                run_id=run.id,
                instance_id=instance_id,
                field_id=field_id,
                reviewer_id=reviewer_id,
                decision=ExtractionReviewerDecisionType.EDIT,
                value=p.proposed_value,
                proposal_record_id=None,
                rationale=f"Materialized from human proposal {p.id} at consensus entry",
            )
            inserted += 1
        return inserted
```

(match actual enum/import names; `human_has_user` CHECK guarantees `source_user_id` is non-null for human proposals.)

- [ ] **Step 4: Run** — the module suite + the consensus/export modules the tests touch. Integration tests exercising the service count for diff-cover (service lines, no new handler lines).
- [ ] **Step 5: Commit** — `git commit -m "feat(qa): materialize reviewer decisions at extract->consensus (D8-c)"`

---

### Task 5: Backend guards the materialization now depends on — human `source_user_id` forgery + viewer advance

**Files:**
- Modify: `backend/app/api/v1/endpoints/extraction_runs.py` — `create_proposal`: for `source == 'human'`, a body `source_user_id` differing from `current_user_sub` → the endpoint's standard 400 (a `None` defaults to the caller); `advance_run`: add `ensure_project_reviewer` (mirrors `mark_ready`; keeps reviewer-advances-own-QA-run and manager Start-consensus working, blocks viewers)
- Test: integration in the runs test module + `backend/tests/unit/test_run_write_endpoints_unit.py` (endpoint-coroutine pattern — these ARE handler lines, the ASGI blind spot applies)

**Interfaces:**
- Produces: forged-attribution path closed before materialization converts `source_user_id` into decision attribution; viewers 403 on `POST /runs/{id}/advance`.

- [ ] **Step 1: Failing tests** — integration: human proposal with `source_user_id != caller` → 400 and nothing persisted; human proposal with `source_user_id` omitted → persisted attributed to caller; `source='ai'` with arbitrary `source_user_id` → unchanged behavior (AI seeding keeps working). Viewer `POST /advance` → 403, and a QA run with proposals stays in extract with zero decisions. Unit: endpoint coroutines await the new guard (pattern: `test_run_write_endpoints_unit.py:28-64`).
- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Implement** (endpoint-level; the service layer stays transport-free).
- [ ] **Step 4: Verify** — module + unit suites green.
- [ ] **Step 5: Commit** — `git commit -m "fix(runs): reject forged human source_user_id + reviewer gate on advance (D8-c guards)"`

---

### Task 6: Ran-by identity scrub — per-run reveal on both suggestion read paths

**Files:**
- Modify: `backend/app/services/extraction_suggestion_read_service.py` — `get_suggestion_history` AND `load_suggestions` gain a required keyword-only `caller_id: UUID`; per-run reveal + `_scrub_ranby`
- Modify: `backend/app/api/v1/endpoints/articles.py` — pass `caller_id=current_user_sub` at both call sites
- Test: `backend/tests/**/test_suggestion_read.py` (~10-12 direct callers get a caller arg; the existing `test_get_suggestion_history_resolves_ran_by_name` becomes the revealed-path pin with a peers-visible caller) + new scrub cases

**Interfaces:**
- Consumes: `caller_can_see_peers(db, project_id=..., user_id=..., kind=...)`, `is_run_arbitrator(db, project_id, user_id)` (the `/view` helpers).
- Produces: reveal is PER ITEM by the item's run: reveal iff `caller_can_see_peers` OR `item_run.stage == FINALIZED` OR (`item_run.stage == CONSENSUS` AND `is_run_arbitrator`) — genuinely mirrors `/view` instead of broadening it (a blind reviewer in an extract-stage child run stays scrubbed even when a finalized parent exists on the same article... for the CHILD run's items; the finalized run's own items reveal). `caller_can_see_peers`/`is_run_arbitrator` computed once per request; run stages loaded alongside `results` in `_load_run_provenance` (or one extra query over the proposals' run ids). `_scrub_ranby(provenance)` = shallow-copy the RESOLVED snapshot and `pop` `ran_by_user_id` + `ran_by_name` (the resolved output is a single leaf; add the sections traversal ONLY if `_resolve_section_provenance` can return a dict still carrying `sections` — check, don't assume). Skip `_inject_ran_by_names` for runs that will be scrubbed (don't fetch names to delete them). `load_suggestions` (which never resolves names but ships raw `ran_by_user_id`) gets the same per-run scrub.

- [ ] **Step 1: Failing integration tests:**

```python
async def test_history_scrubs_ranby_for_blind_reviewer_in_extract(...):
    # blind project, extract run; caller = the OTHER reviewer
    # -> no item.provenance carries ran_by_user_id or ran_by_name

async def test_history_reveals_ranby_for_arbitrator_in_consensus(...):
    # run in consensus; caller = manager-arbitrator with managers_see_reviewers OFF
    # -> that run's items carry ran_by_name  # the consensus trace run-group headers

async def test_history_mixed_stages_scrub_is_per_run(...):
    # finalized parent run + extract-stage child run on one article, blind reviewer:
    # parent-run items revealed, child-run items scrubbed

async def test_history_reveals_for_unblinded_manager(...):
    # managers_see_reviewers[kind]=True, extract stage -> revealed via caller_can_see_peers

async def test_load_suggestions_scrubs_ran_by_user_id(...):
    # blind reviewer, extract run -> GET /articles/{id}/suggestions provenance
    # carries no ran_by_user_id
```

- [ ] **Step 2: Verify failure** (names/ids ship to any member today) — plus the ~10 direct-caller updates make the module compile/run.
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Verify + coverage** — module suite green; if `articles.py` gained handler lines, extend the endpoint-coroutine unit tests (`test_run_write_endpoints_unit.py` pattern) to pin the `caller_id` forwarding.
- [ ] **Step 5: Commit** — `git commit -m "fix(extraction): scrub ran-by identity on suggestion reads unless the item's run reveals it (D8-d)"`

---

### Task 7: Tests stop masking reality — fixture realism sweep

**Files:**
- Modify: backend QA test modules that hand-insert `ExtractionReviewerDecision` rows for QA runs (locate: `grep -rln "ExtractionReviewerDecision(" backend/tests | xargs grep -l -i "quality\|qa\|probast"`) — rewrite via `record_decision`/advance-materialization
- Modify: remaining frontend/e2e QA extract-stage `/proposals` POST assertions (locate: `grep -rn "runs/.*proposals" frontend/test frontend/e2e --include="*.ts*"`)

- [ ] **Step 1: Capture the inventory** (both greps; paste into commit body). Classify: hand-fed QA decision fixture → real flow; extraction-kind fixture → leave; QA `/proposals` POST assertion → flip to `/decisions`; AI-seeding `source='ai'` POST → keep (endpoint remains for AI/system writers).
- [ ] **Step 2: Rewrite each.**
- [ ] **Step 3: Suites green** — from `backend/`: `uv run pytest tests -k "qa or quality" -x`; from root: the touched vitest files.
- [ ] **Step 4: Commit** — `git commit -m "test(qa): create decisions the real way — autosave/materialization, not hand-fed rows (D8-e/f)"`

---

### Task 8: E2E — consensus AI trace round trip + QA parity

**Files:**
- Create: `frontend/e2e/flows/qa-consensus-ai-trace.e2e.ts` — the `qa-` prefix rides local-hitl's existing `**/flows/qa-*.e2e.ts` glob (serial worker), is ignored by local-api, and doesn't match local-ui; NO playwright.config.ts change needed. (The requested `consensus-ai-trace.spec.ts` name matches no project glob — this rename is the deviation that makes it actually run under `npm run test:e2e:local`; note in the PR body.)
- Modify: `frontend/e2e/_fixtures/fixture-ids.ts` + `ensure-fixtures.ts` — dedicated `TRACE_ARTICLE_ID` article (QA_* pattern) AND deterministic `full_name`s for owner + reviewer B/C (admin-update `user_metadata.full_name` / profiles row via the existing admin helpers) — without names, `Run by {name}` never renders and reviewer cells fall back to dynamic `Reviewer <hex>` labels no locator can target
- Modify: `frontend/e2e/_fixtures/auth.ts` (or wherever `loginViaUi` lives) — add `loginViaUiAs(page, email, password)` (parameterize the existing form-fill; `loginViaUi` is hardcoded to E2E_USER_EMAIL)

**Interfaces:**
- Consumes: `ensureFixtures()`, `loginViaUiAs`, `authHeaders(token, traceId)`, POST `/api/v1/runs/{id}/proposals` `source: "ai"` (hitl-ai-proposal.api.e2e.ts:146-160 pattern), `expect.poll` on GET `/api/v1/runs/{id}/view`.
- Copy locators (verify each against the component before first use): trace `getByRole('button', {name: 'AI used by <full_name>'})`; adopt `{name: /publish this reviewer/i}`; `'Manual'`; `'Use this value'`; `/from /` resolved summary; `/Run by /`; `'Start consensus'`; `'Approve & finalize'`; `'Saved'`; Compare-toggle absence via BOTH known names (`'Toggle comparison mode'`, `/compare/i`) after an extract-stage positive control confirms which renders.

- [ ] **Step 1: Scenario A** (contexts: reviewer A = REVIEWER_B fixture, reviewer B = REVIEWER_C fixture, manager/arbitrator = owner):
  1. Provision extraction run in `extract` on `TRACE_ARTICLE_ID` (CHARMS), 2 reviewers, via API; seed AI proposals: coord1 `{value: 'Retrospective cohort'}`, coord2 `{value: <exact string A will type>}`.
  2. A (UI): type coord2 first → `'Saved'`; accept AI on coord2 (same value — the [value,link] fingerprint regression); accept AI on coord1; type coord3 manually.
  3. `expect.poll` `/view` as A: newest decisions on coord1+coord2 carry `proposal_record_id != null`; coord3's is null.
  4. B: divergent `edit` on coord1 via POST `/decisions`.
  5. Manager (UI): Start consensus → assert (i) coord1 renders both reviewer cells, A's cell has the `AI used by <A>` button; (ii) its popover is read-only (no `/use this version/i`), pinned chip `Adopted by <A>` — coord2's popover too; (iii) run-group header `/Run by /` (the scrub's auto-reveal carve-out end-to-end); (iv) coord3 shows `'Manual'`; (v) NO Compare toggle, no status-popover divergence jump.
  6. Adopt A's coord1 → `/from /` + A's name; resolve the rest; `'Approve & finalize'`.
- [ ] **Step 2: Scenario B** (QA parity): PROBAST run via `prepareCleanQaRun`; answer two signaling questions with `page.on('request')` capture → ≥1 POST `/runs/{id}/decisions`, ZERO POSTs `/runs/{id}/proposals` from the form; reload → both rehydrate; advance to consensus → table shows the decisions; `'Use this value'` succeeds (no error toast, resolved summary); export via POST `/api/v1/projects/{id}/extraction-export` `{template_id, mode: 'single_user', reviewer_id, article_ids: [<QA article>]}` → **job flow**: poll the job to `completed` with a `download_url` (reuse `pollUntilTerminal`); value non-blankness itself is pinned by Task 4's backend export test, not re-parsed from xlsx here.
- [ ] **Step 3: Run** — `npx playwright test --list --project=local-hitl | grep consensus-ai-trace` (non-zero), `--project=local-api` does NOT list it; then `make start` + `npx playwright test --project=local-hitl qa-consensus-ai-trace` → PASS. Fix locator drift by reading the component, never by loosening to CSS.
- [ ] **Step 4: Commit** — `git commit -m "test(e2e): consensus AI trace round trip + QA decisions parity (D0-D8)"`

---

### Task 9: PR-2 gates + plan-doc hygiene

- [ ] **Step 1:** Add this plan to `.markdownlintignore` ("Active in-flight plans" block, date order).
- [ ] **Step 2:** Frontend: `npm run test:run && npm run lint && npx tsc -p tsconfig.app.json --noEmit`. Backend (from `backend/`): full `uv run pytest tests` (local Supabase up; never concurrent). Read the output.
- [ ] **Step 3:** `bash scripts/fitness/run_all.sh`; if frozen files grew: `--update-baseline` same commit + diff-check.
- [ ] **Step 4:** Diff-cover: `uv run pytest tests --cov=app --cov-report=xml` → `uv run diff-cover coverage.xml --compare-branch origin/dev --fail-under 80`; uncovered handler lines → endpoint-coroutine unit tests.
- [ ] **Step 5:** `bash scripts/docs/check-frontmatter.sh` → PASS. Commit — `git commit -m "docs(plan): consensus AI trace PR2 plan + gates"`.

---

### Task 10 (PR 3, separate branch off origin/dev): D7 docs hygiene

**Files:**
- Move: `docs/superpowers/specs/2026-06-23-consensus-view-fixes-design.md` → `docs/superpowers/specs/archive/`; `docs/superpowers/plans/2026-06-23-consensus-view-fixes-phase-a.md` → `docs/superpowers/plans/archive/`
- Modify: `.markdownlintignore` (remove by-name entries for the moved files — archive/** globs cover the destinations)
- Modify: `docs/adr/0015-finalize-via-approve-publish.md` (one-line note after the "Header primary action" block, ~line 74)
- Modify: `docs/reference/extraction-hitl-architecture.md` (glossary §6 "HITL lifecycle" — ADD a consensus-surface entry, alphabetical)

- [ ] **Step 1:** `git mv` both; set frontmatter `status: superseded`; prepend below frontmatter: `> **SUPERSEDED** by the 2026-07-03 compare-table spec (docs/superpowers/specs/2026-07-03-consensus-compare-view-design.md): the consensus surface is the resolve-mode compare table; ConsensusPanel was deleted in #483.`
- [ ] **Step 2:** ADR-0015 note: `> Update (2026-07-05): the consensus surface is now the resolve-mode compare table (ConsensusPanel deleted, #483); the finalize/ready/auto-reveal decisions here are unchanged.`
- [ ] **Step 3:** Glossary entry: `- **Consensus surface** — The resolve-mode compare table (RunReviewerComparison inside ConsensusResolutionPanel) rendered by both run screens during the consensus stage; adopt-or-override per coordinate. The earlier ConsensusPanel card list was deleted in #483.`
- [ ] **Step 4:** Remove stale `.markdownlintignore` by-name entries; `bash scripts/docs/check-frontmatter.sh` + the docs markdownlint → PASS.
- [ ] **Step 5:** Commit — `git commit -m "docs(consensus): archive superseded 2026-06-23 spec/plan; ADR-0015 + glossary notes (D7)"`.

---

## Self-review notes

- **Spec coverage:** D8-a → Task 1; D8-b hydration → Tasks 2+3; D8-b materialization → Task 4 (+5 guards); PR-2 scrub commitment → Task 6 (extended to `load_suggestions` — same leak, same helper); no-legacy → Tasks 1/3/7 with grep evidence; E2E → Task 8; D7 → Task 10.
- **Panel-driven deviations from the original draft:** ONE `current_values` map feeds hydration AND baseline; Layer-1 system-proposal extension precedes the hydration switch; per-run (not article-level) reveal; forged `source_user_id` + viewer-advance guards pulled in (materialization turns those inputs into audit rows — the guard belongs to the PR that creates the risk, same rationale as PR-1's link guard); materialized decisions carry a rationale marker (§IX); E2E renamed `qa-consensus-ai-trace.e2e.ts`; export asserted as async job.
- **Known accepted limitations:** materialized decisions carry no AI link (D4 renders nothing — per spec); a deleted author profile would fail materialization's FK (profiles are not hard-deleted in practice); `load_suggestions` scrub strips ids the frontend never displayed (defense-in-depth, zero UI change).
