---
status: approved
last_reviewed: 2026-09-14
owner: '@raphaelfh'
---

# Extraction Review Table Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The user has already selected `/ship-spec --to prod`; do not ask for an execution method.

**Goal:** Deliver the approved H extraction workspace with compact editable rows, inline per-generation review, and reliable section-only extraction history through production.

**Architecture:** Extend production extraction primitives and preserve the existing full-screen shell, section registry, field editors, HITL decisions, and reader. A durable extraction attempt owns request replay and engine selection; each proposal owns its immutable call snapshot and evidence. The editable extraction view receives a table presentation; QA and consensus retain their existing presentation and policies.

**Tech Stack:** React 19, strict TypeScript, TanStack Query, Zustand, Radix/shadcn, FastAPI, Pydantic v2, SQLAlchemy async, Alembic, Celery, PostgreSQL, Vitest and Playwright.

**Spec:** `docs/superpowers/specs/2026-09-14-extraction-review-table-workspace-design.md` (approved and reconciled).

## Global Constraints

- Work exclusively in `/private/tmp/prumo-extraction-review-20260914`, branch `codex/extraction-review-workspace`; verify the actual branch before editing. Other agents may edit this worktree; preserve their changes.
- All code, comments, commits, documentation and copy keys are English. Use existing copy dictionaries and design tokens.
- Build from current dev; never merge the prototype branch. Prototype H is visual evidence only; do not copy its fixtures, simulated jobs or standalone application into production.
- All writes use backend API/services/repositories; frontend uses `apiClient` and query-key factories. Repositories flush and never commit.
- Retain `POST /api/v1/extraction/sections` and existing status response envelopes. No question-level extraction action or endpoint.
- Every deliberate extraction owns a new attempt. Technical transport/worker replay reuses the original attempt. Same-value fresh attempts append; replay does not append evidence.
- Every call owns immutable generation facts. Store no credentials, `ran_by_user_id` or `ran_by_name` in proposal JSON. Runner identity is resolved from the attempt owner only after `run_reveals_peers` authorization.
- Preserve one-live-run lifecycle, coordinate ownership, schema exclusions, assessor-owned field exclusions, and append-only reviewer decisions. Recheck authority after external work and before result writes.
- No shared run-row lock spans an LLM call. Independent section attempts must interleave while duplicate delivery of one attempt is serialized.
- QA, consensus and exports retain their existing behavior and presentation; all consumers use safe provenance serialization. New table presentation is enabled only for editable data extraction.
- Every model change includes its additive Alembic migration, RLS/client-write restrictions, real database tests and migration roundtrip head-pin update in the same task.
- Question and value columns resize only when the **review pane** is at least 900 px wide. Fixed column order; no reordering. Preserve Articles' default growing-table behavior.
- Backend tests run from `backend/`; frontend commands run from repository root. Use real Postgres for persistence/ownership, MSW for frontend transport, and `loginViaUi` for authenticated browser checks. No test suites pointed at production.
- Each implementer writes its report first, appends evidence while working, and reads this section plus its task and the spec. No task brief needs more than 300 lines. Every task ends with its focused tests and a conventional commit.

## Boundaries and execution order

This is one end-to-end delivery, with eleven independently reviewable tasks. Execute in order; Tasks 5–6 have no backend code dependency but still consume the contracts below. Do not ship an intermediate table with fabricated provenance or ephemeral accepted state.

| Task | Owned boundary | Dependency |
| --- | --- | --- |
| 1 | Attempt schema and repository | None |
| 2 | Durable kickoff and worker execution ownership | 1 |
| 3 | Attempt propagation and atomic per-call proposals/evidence | 1–2 |
| 4 | Safe immutable history/read contracts | 3 |
| 5 | Independent section job state | 2 |
| 6 | Shared bounded column resize and compact editors | None |
| 7 | Persistent reversible acceptance and autosave serialization | 4 |
| 8 | Inline cards and complete previews | 4, 7 |
| 9 | Table, sections, focus and keyboard integration | 5–8 |
| 10 | Production browser coverage and visual review | 9 |
| 11 | Cross-layer audit, documentation and final regression | 10 |

## Task 1: Durable attempt schema and repository

**Seat:** backend. **Files:** Create `backend/app/models/extraction_attempt.py`, `backend/app/repositories/extraction_attempt_repository.py`, `backend/app/schemas/extraction_attempt.py`, `backend/alembic/versions/0075_extraction_attempts.py`, `backend/tests/integration/test_extraction_attempt_repository.py`; modify `backend/app/models/__init__.py`, `backend/app/models/extraction_workflow.py`, `backend/tests/integration/test_migration_roundtrip.py`.

**Interfaces:** `ExtractionAttempt` stores UUID `id`, unique UUID `request_id`, UUID `owner_id`, `project_id`, `article_id`, `template_id`, bound `run_id`, JSONB `request_payload`, nullable string `job_id`, nullable JSONB `engine`, string `status` (`pending/running/completed/failed/cancelled`), nullable JSONB `result`, nullable string `error` and `error_code`, and timestamps. `request_payload` is a canonical typed request without its request id, not arbitrary caller metadata. `ExtractionAttemptRepository.get_or_create(*, request_id, owner_id, scope, request_payload, job_id)` returns `(attempt, inserted: bool)`; `get_owned(request_id, owner_id)` and `lock(attempt_id)` are read/lock primitives. `scope` is a Pydantic `AttemptScope` containing the four coordinate UUIDs. Service code, not the repository, compares payloads and applies authorization.

- [ ] Write real-Postgres tests using the existing `TemplateFactory`, `SEED` and run lifecycle setup pattern. Create a coherent run/instance/field, insert two requests, and exercise the database constraints directly. Assert:

```python
assert first.id == replay.id
assert inserted is True and replay_inserted is False
assert different.request_id != first.request_id
assert first.engine is None
assert legacy_proposal.extraction_attempt_id is None
assert legacy_proposal.generation_snapshot is None
```

  Include concurrent same-request insertion with two sessions; conflicting proposal coordinate/run relationships; unique proposal coordinates within an attempt; anon/authenticated client writes denied; nullable legacy rows readable.
- [ ] Run `cd backend && uv run pytest tests/integration/test_extraction_attempt_repository.py -q`; expect failures because the model/repository does not exist.
- [ ] Implement models and repository. Add nullable `extraction_attempt_id` FK and nullable JSONB `generation_snapshot` on `ExtractionProposalRecord`. Add partial unique `(extraction_attempt_id, instance_id, field_id, source)` where attempt is not null. Enforce attempt/proposal run consistency in database coherence checks, and attempt scope against run coordinates; restrict deletion as existing workflow history requires. Use insert conflict handling/savepoints so a duplicate request does not abort the caller transaction.

```python
class AttemptScope(BaseModel):
    project_id: UUID
    article_id: UUID
    template_id: UUID
    run_id: UUID

# Repository primitives must leave transaction ownership to their caller.
# ON CONFLICT(request_id) DO NOTHING, then SELECT, returns the stored row.
```

- [ ] Add migration from the actual current head (`0074_ollama_provider` at plan creation; reconcile if another migration has landed). Enable RLS and revoke direct application-client writes consistent with workflow tables. Add the new table to metadata imports. Downgrade removes only this additive schema, in FK-safe order; do not seed data. Update `expected_head` and add roundtrip assertions in the existing scratch-database test.
- [ ] Run `cd backend && uv run pytest tests/integration/test_extraction_attempt_repository.py tests/integration/test_migration_roundtrip.py -q`. Review generated DDL and commit `feat(extraction): persist durable extraction attempts`.

## Task 2: Durable kickoff, replay and worker execution ownership

**Seat:** backend. **Files:** Create `backend/app/services/extraction_attempt_service.py`, `backend/tests/integration/test_extraction_attempt_kickoff.py`; modify `backend/app/schemas/extraction.py`, `backend/app/api/v1/endpoints/section_extraction.py`, `backend/app/worker/tasks/extraction_tasks.py`, `backend/tests/unit/test_section_extraction_endpoint.py`, `backend/tests/unit/test_run_section_extraction_task.py`. Repository extensions remain in Task 1's file.

**Interfaces:** `SectionExtractionRequest.request_id: UUID | None` has alias `requestId`. `ExtractionAttemptService.prepare_request(payload, owner_id, *, job_id)` returns the durable attempt; identical authenticated replay returns its existing job. `execute_attempt(attempt_id, operation)` serializes duplicate deliveries on the attempt row, returns a recorded terminal result, and invokes `operation(attempt)` only for nonterminal work. The worker continues to return the existing result/error shape and owner information. The Celery payload carries server-assigned `attempt_id`; do not accept it as caller authority.

- [ ] Add tests for same UUID/same payload returning the same job id; changed entity/parent/engine-affecting request data returning typed 409; foreign owner rejected without leaking job id; unauthorized membership rejected even for a known request; response lost after enqueue replay; enqueue failure and re-enqueue with identical task id; omitted request id allocating a new request. Drive the real service/database and patch only queue transport.

```python
# Two HTTP requests using the same authenticated requestId:
assert response1.status_code == response2.status_code == 202
assert response1.json()["data"]["job_id"] == response2.json()["data"]["job_id"]
# A deliberately changed requestId owns a different job even for equal inputs.
assert response3.json()["data"]["job_id"] != response1.json()["data"]["job_id"]
```

- [ ] Run `cd backend && uv run pytest tests/integration/test_extraction_attempt_kickoff.py tests/unit/test_section_extraction_endpoint.py tests/unit/test_run_section_extraction_task.py -q`; capture red evidence.
- [ ] Keep existing scope helper checks **before** replay. Move new persistence into the service/repository. Bind an absent run once through existing lifecycle services, and normalize the stored payload to that bound run without making a replay's omitted run conflict. Compare original request semantics as well as bound coordinates. Preallocate a Celery task UUID, durably commit the attempt before `apply_async(task_id=stored_job_id)`, and retain existing Redis owner/status behavior. Replayed jobs refresh authorized owner bookkeeping; status still denies nonowners. Queue unavailability retains the existing typed 503 envelope.
- [ ] Serialize worker execution with an attempt-row lock held by a dedicated execution-ownership session, separate from the session doing short lifecycle/proposal transactions. Duplicate delivery waits and then returns the saved terminal result. If a worker crashes, the DB connection releases its lock; retry resumes the same attempt. Never persist an irreversible running-only claim that can strand an attempt. Terminal result writing uses the ownership transaction; partial proposal commits are safe only through Task 3's idempotency.

```python
# Worker ownership, deliberately distinct from domain write transactions:
async with ownership_db.begin():
    attempt = await attempts.lock(attempt_id)
    if attempt.status in {"completed", "failed", "cancelled"}:
        return attempt.result
    result = await operation(attempt)
    attempt.status, attempt.result = "completed", result
```

  Preserve Celery retry semantics: retryable exceptions do not record terminal failure; exhausted/confirmed failures do. Handle cancellation consistently. The snippet defines ownership, not exception swallowing: errors retain classified codes and propagate to Celery. Do not hold or acquire a shared run lock on the ownership session.
- [ ] Re-run the focused command. Add a two-worker barrier test showing one logical execution for one attempt and independent execution for different attempts. Commit `feat(extraction): make section kickoff replay-safe`.

## Task 3: Attempt engine pin and atomic per-call proposal persistence

**Seat:** backend. **Files:** Modify `backend/app/services/section_extraction_service.py`, `backend/app/services/entry_group_extraction.py`, `backend/app/services/run_engine_freeze.py`, `backend/app/services/extraction_proposal_service.py`, `backend/app/repositories/extraction_proposal_repository.py`, `backend/app/worker/tasks/extraction_tasks.py`; create `backend/app/services/extraction_generation.py`, `backend/tests/integration/test_extraction_generation_attempts.py`; extend `backend/tests/integration/test_section_extraction_evidence.py`, `backend/tests/integration/test_run_engine_freeze.py`, `backend/tests/integration/test_extraction_proposal_service.py`.

**Interfaces:** `SectionExtractionService` receives optional server-owned `attempt_id`. `GenerationCallResult` holds that call's extracted data, verification verdicts and identity-free `generation_snapshot`. `_create_suggestions(..., generation_snapshot, attempt_id)` receives snapshots explicitly; it never reads the last mutable service snapshot for another entry. `record_proposal_result(..., extraction_attempt_id, generation_snapshot)` returns `ProposalWriteResult(record: ExtractionProposalRecord, inserted: bool)`. Existing `record_proposal` keeps its return type for compatibility and delegates to the result primitive. AI kickoff paths always supply an attempt; legacy/system/internal callers retain documented legacy semantics.

- [ ] Extend actual evidence tests so two fresh attempts with equal values and different reasoning/citations create distinct proposals; a replay preserves the original proposal, snapshot and evidence unchanged. Add two repeating entries with different prompts/token counts. Assert lifecycle closure after the model call prevents writes and schema/assessor exclusions remain enforced.

```python
assert first.record.id == replay.record.id
assert replay.inserted is False
assert second.record.id != first.record.id
assert first.record.generation_snapshot["tokens"] != second.record.generation_snapshot["tokens"]
assert len(first_evidence) == len(replayed_evidence)
assert {e.proposal_record_id for e in second_evidence} == {second.record.id}
```

- [ ] Run `cd backend && uv run pytest tests/integration/test_extraction_generation_attempts.py tests/integration/test_section_extraction_evidence.py tests/integration/test_run_engine_freeze.py tests/integration/test_extraction_proposal_service.py -q`; expect same-value/card tests to fail.
- [ ] Freeze the resolved `LlmTarget` exactly once in a short transaction on the attempt **before acquiring the long execution-ownership lock**; use first-writer-wins under a short row lock. Resolve credentials for that frozen target, honoring current retirement/access checks. Retry reads this pin, not mutable `run.engine`. Keep run summaries for compatibility. Refactor worker-owned generation boundaries to finish run-binding/freeze transactions before LLM calls and reopen short result transactions afterward. The domain session must never update the attempt row while the ownership session holds it; that would self-deadlock. Synchronous internal services must not unexpectedly commit a caller-owned transaction. Move result lifecycle guards into each result transaction, after external work.
- [ ] Propagate attempt identity from existing section/batch/QA kickoff boundaries through retries and entry loops. Existing APIs, result counts and `failedSections` remain. The attempt remains one operation while snapshots remain one call. Explicit section extraction covers every eligible field even with prior proposals/decisions; it never writes reviewer values. Preserve existing non-section caller exclusion behavior unless explicitly required by the shared schema rules.
- [ ] Build `GenerationCallResult` immediately after each call's verification using `build_run_provenance`; sanitize through an allowlist, deep-copy JSON and pass it explicitly into persistence. The attempt-aware branch performs coordinate lookup by attempt, not normalized value. Only the inserted branch inserts evidence, with proposal and evidence in one transaction/savepoint. A retry never replaces committed token usage, rationale, engine facts or evidence. Existing permitted verification annotation handling cannot overwrite immutable snapshot facts.

```python
written = await proposals.record_proposal_result(
    extraction_attempt_id=attempt_id,
    generation_snapshot=generation_snapshot,
    **proposal_fields,
)
if written.inserted:
    await evidence_repository.add_for_proposal(written.record.id, citations)
# Both operations share the caller-owned transaction; count only inserted rows.
```

  `proposal_fields` is the existing typed proposal argument set; `add_for_proposal` is a new repository helper if the current evidence repository lacks it, implemented in `backend/app/repositories/extraction_repository.py` rather than adding SQL in endpoints. Keep the existing evidence cap/rank/anchor pipeline.
- [ ] Test two sections with barriers around LLM calls, changing the project engine between starts: both calls enter concurrently; retry A retains A's target/credential choice even after B re-pins the run summary. Test crash after proposal commit before terminal bookkeeping, duplicate delivery and synchronous transaction rollback. Re-run focused tests and commit `feat(extraction): isolate generation facts by attempt and call`.

## Task 4: Immutable, privacy-safe proposal read contracts

**Seat:** backend. **Files:** Create `backend/app/services/proposal_generation_read.py`, `backend/tests/integration/test_proposal_generation_read.py`; modify `backend/app/schemas/extraction_suggestion.py`, `backend/app/schemas/extraction_run.py`, `backend/app/services/extraction_suggestion_read_service.py`, `backend/app/services/extraction_run_read_service.py`, `backend/app/services/exports/extraction_snapshot_reader.py`, `backend/tests/integration/test_suggestion_read.py`; regenerate `frontend/types/api/openapi.json` and `frontend/types/api/schema.d.ts`; modify `frontend/services/aiSuggestionService.ts`, `frontend/types/ai-extraction.ts` and existing service tests.

**Interfaces:** Latest/history DTOs add nullable `extraction_attempt_id` and `generation_snapshot` (map to `AISuggestion.extractionAttemptId?: string`, `generationSnapshot?: RunProvenance`). A shared safe serializer receives a proposal and an already-authorized reveal context; it allowlists snapshot data and may add runner identity from attempt ownership only after per-run reveal authorization. `provenance` retains the truthful per-row engine projection for existing consumers. Never merge current run/section facts into a historical proposal. All readers exposing proposal JSON use this boundary.

- [ ] Test distinct per-call model/prompt/usage remains stable after a later extraction; blind reviewer cannot see runner identity even with nested malicious identity keys in stored JSON; authorized reveal resolves the correct owner; foreign run snapshots remain hidden; legacy rows return no generation snapshot. Cover history, hot suggestions, run detail (including QA/consensus) and export projections.

```python
assert historical[0].generation_snapshot == original_public_snapshot
assert historical[1].generation_snapshot is None  # legacy
assert "ran_by_user_id" not in json.dumps(blind_response)
assert "ran_by_name" not in json.dumps(blind_response)
```

- [ ] Run `cd backend && uv run pytest tests/integration/test_proposal_generation_read.py tests/integration/test_suggestion_read.py -q`; capture red.
- [ ] Implement one allowlisted serialization module used by all named readers. Name lookup happens only after `run_reveals_peers` succeeds for that proposal's run. Review nested prompt fields and unknown JSON keys; do not rely only on stripping two top-level names. Exact historical source links require retained revision proof; current-file references are explicitly current, never labeled original. No document-versioning feature is added.
- [ ] Extend DTO mapping without `any` casts. Map nullable generation snapshot to `undefined`; preserve complete typed proposed values/absence markers. Add mapper tests proving the history still yields one item per proposal, equal values remain distinct, and missing generation details stay unavailable.
- [ ] Run `npm run generate:api-types`, then `npm run typecheck` and the existing AI suggestion service test file discovered with `rg --files frontend | rg 'aiSuggestionService.*test'`. Run the backend command above plus affected QA/export provenance tests. Commit `feat(extraction): expose immutable proposal generation details`.

## Task 5: Coordinate-scoped independent section jobs

**Seat:** frontend. **Files:** Create `frontend/stores/sectionExtractionJobs.ts`, `frontend/test/hooks/sectionExtractionJobs.test.tsx`; modify `frontend/hooks/extraction/useSectionExtraction.ts`, `frontend/services/sectionExtractionService.ts`, `frontend/hooks/extraction/useExtractionFormAIActions.ts`, `frontend/components/extraction/ai/shared/SectionAIExtractButton.tsx`, `frontend/lib/query-keys/extraction.ts`, `frontend/test/hooks/useSectionExtraction.test.tsx`, `frontend/lib/copy/extraction.ts`.

**Interfaces:** Export `sectionJobKey(params)` for the full project/article/template/run/entity/parent coordinate; `SectionJobState` contains request UUID, job id, status, classified error and uncertain-transport marker. `useSectionExtraction` retains existing consumers' methods and adds coordinate lookup through `getSectionState(params)`; `extractSection(params)` creates a UUID for deliberate attempts and reuses one only for uncertain transport retry. Use the existing generated section request type.

- [ ] Write MSW tests for A and B running independently, switching article/template/run, remount resuming a job, unmount stopping polling but not cancelling the server job, confirmed failure retry generating a fresh UUID, uncertain POST retry retaining UUID, and completion invalidating only owning keys. Include zero suggestions and cancelled jobs.

```ts
expect(sectionJobKey({...params, runId: 'run-b'})).not.toBe(sectionJobKey(params));
expect(firstRequest.requestId).toBe(uncertainRetry.requestId);
expect(firstRequest.requestId).not.toBe(terminalFailureRetry.requestId);
expect(getSectionState(sectionB).status).toBe('idle');
```

- [ ] Run `npm run test:run -- frontend/test/hooks/useSectionExtraction.test.tsx frontend/test/hooks/sectionExtractionJobs.test.tsx`; expect independence/remount tests to fail.
- [ ] Store operation records for the session in Zustand, scoped to authenticated user as well as the spec coordinate, clearing on sign-out. Keep polling in mounted subscribers using existing `useExtractionJob`; records survive subscription teardown. Deduplicate completion handling so remount does not repeat toasts or invalidation. Do not put callbacks or query clients in persisted state. Bound completed records to the active session and clear sensitive stale state on access denial.
- [ ] Give each section-header action its own busy/error state. Use in-place spinner, classified retry tooltip and neutral empty-result copy. No global loading flag disables sibling sections, and completion does not move focus/open cards. Preserve batch caller APIs and typed failure counts.
- [ ] Re-run focused tests, `npm run typecheck`, and `npm run test:run -- frontend/test/hooks/useExtractionFormAIActions.test.tsx frontend/components/extraction/ai/shared/SectionAIExtractButton.test.tsx`; commit `feat(extraction): track section jobs independently`.

## Task 6: Bounded resize primitive and compact typed editors

**Seat:** frontend. **Files:** Modify `frontend/components/shared/list/useResizableTableColumns.ts`, `frontend/components/shared/list/ColumnResizeHandle.tsx`, `frontend/components/shared/list/useResizableTableColumns.test.ts`, `frontend/components/extraction/FieldValueEditor.tsx`, `frontend/components/extraction/FieldValueEditor.test.tsx`; create `frontend/components/shared/list/ColumnResizeHandle.test.tsx`, `frontend/lib/extraction/reviewColumnWidths.ts`, `frontend/lib/extraction/reviewColumnWidths.test.ts`.

**Interfaces:** Add opt-in `bounds?: Record<string,{min:number;max:number}>` to shared resize hook and reset methods; existing callers retain old defaults. Handle gains optional `onReset`, pointer start/move/end support with capture, and optional coarse-target styling. `fitReviewColumns(paneWidth, preferred)` returns `{question:number,value:number,proposal:number}`; `preferred` stores only question/value. `FieldValueEditor` gains optional `density?: 'default'|'compact'`, preserving all existing value interfaces.

- [ ] Test pointer capture/cancel, keyboard arrows/Home/End, double-click reset, storage errors, and stale/out-of-range persisted widths. Test Articles' unbounded defaults continue growing without shrinking neighbors. Use fixed readable minima of question 160, value 200, proposal 220 for the >=900 px mode; proportionally clamp adjustable preferences to leave proposal minimum.

```ts
const widths = fitReviewColumns(900, {question: 700, value: 700});
expect(widths.question + widths.value + widths.proposal).toBe(900);
expect(widths.proposal).toBeGreaterThanOrEqual(220);
expect(widths.question).toBeGreaterThanOrEqual(160);
```

- [ ] Run `npm run test:run -- frontend/components/shared/list/useResizableTableColumns.test.ts frontend/components/shared/list/ColumnResizeHandle.test.tsx frontend/lib/extraction/reviewColumnWidths.test.ts`; expect new behavior to fail.
- [ ] Implement pointer events without duplicate mouse dispatch. Capture on the handle; lost capture/unmount restores document selection/cursor. Route pointer and keyboard width requests through one clamp/persistence path. Reset clears the relevant preference; toolbar resets both. Pane resizing uses `ResizeObserver` in the eventual owner and the pure fit function, without overwriting a user's preferred width solely because the pane temporarily narrowed.
- [ ] In compact editors retain current code/label, units, date/boolean and disposition semantics. Long text uses a textarea with content growth, `resize-y`, minimum comfortable height and maximum 320 px before internal scrolling; manual resize is not immediately undone by autosizing. Add value/save tests for multi-select codes, zero, false, date, unit and long text. Do not change default QA/consensus editor density.
- [ ] Run the resize suite and `npm run test:run -- frontend/components/extraction/FieldValueEditor.test.tsx frontend/components/extraction/FieldValueEditor.falsyValues.test.tsx frontend/components/extraction/DispositionRow.test.tsx`; commit `feat(extraction): support compact editors and bounded column sizing`.

## Task 7: Reversible persistent proposal acceptance

**Seat:** frontend. **Files:** Create `frontend/lib/extraction/proposalDecisionState.ts`, `frontend/lib/extraction/proposalDecisionState.test.ts`, `frontend/hooks/extraction/useProposalDecision.ts`, `frontend/test/hooks/useProposalDecision.test.tsx`; modify `frontend/hooks/runs/useAutoSaveProposals.ts`, `frontend/hooks/extraction/ai/useAISuggestions.ts`, `frontend/services/extractionRunService.ts`, corresponding autosave tests, `frontend/pages/ExtractionFullScreen.tsx`.

**Interfaces:** `reviewerCoordinateHistory(decisions, reviewerId, runId, instanceId, fieldId)` sorts `(created_at,id)` ascending; `reversalPayload(history)` returns the predecessor's full typed value or existing unresolved empty payload. `useProposalDecision` exposes `toggle(proposal)`, `acceptedProposalId`, `saving`, `error`, consuming current decisions, draft value and existing run writer. `useAutoSaveProposals.saveNow` retains its no-argument API and gains optional coordinate scope; it awaits any in-flight save for that coordinate. One mutation queue per run/instance/field serializes autosave and explicit acceptance.

- [ ] Unit-test history filtering and deterministic ties; A→B→reverse restores A's typed value with no proposal link; first acceptance reversed restores unresolved; absence/unit/multi-select payloads survive. MSW integration tests defer autosave, click accept twice and assert only the valid ordered writes occur. Failed flush must produce no acceptance POST.

```ts
expect(reviewerCoordinateHistory(mixed, me, runId, instanceId, fieldId).map(d => d.id))
  .toEqual(['a', 'b']);
expect(reversalPayload(history)).toEqual(previous.value);
expect(reverseRequest.proposal_record_id).toBeNull();
expect(reverseRequest.decision).toBe('edit');
```

- [ ] Run `npm run test:run -- frontend/lib/extraction/proposalDecisionState.test.ts frontend/test/hooks/useProposalDecision.test.tsx`; capture red.
- [ ] Derive green state from the latest current-reviewer decision's proposal link **and** typed value equality, not `AISuggestion.status` or transient session adoption. Use current value semantics helpers. Manual edits clear the link only on this new editable extraction surface; retain QA/consensus behavior. Before toggling, flush/await draft writes, refresh authoritative decision history if needed, calculate predecessor, then persist via existing typed decision API and reconcile baseline/draft together so autosave cannot duplicate the explicit write.
- [ ] Keep the last confirmed visual state until persistence succeeds; disable repeated checks while saving. On failure retain draft/error with retry; on conflict/stale run refresh current authority/history before enabling another mutation. Coordinate switch prevents late responses painting a different question. Existing article-change/unmount autosave still flushes the old coordinate correctly.
- [ ] Test reload hydration, old accepted proposal with newer pending proposal, no-information schema restrictions, foreign reviewer exclusion, stale coordinate and race cases. Run `npm run typecheck`, the new focused tests and existing autosave tests discovered with `rg --files frontend | rg 'useAutoSaveProposals.*test'`; commit `feat(extraction): make proposal acceptance reversible and durable`.

## Task 8: Inline extraction cards and complete previews

**Seat:** frontend. **Files:** Create `frontend/components/extraction/review/ProposalDisclosure.tsx`, `frontend/components/extraction/review/ProposalCard.tsx`, `frontend/components/extraction/review/ProposalPreview.tsx`, `frontend/test/components/ProposalDisclosure.test.tsx`; modify `frontend/components/extraction/ai/shared/GenerationDetailsDialog.tsx` to extract reusable content into `GenerationDetailsContent.tsx`, `frontend/components/extraction/ai/AISuggestionEvidence.tsx`, `frontend/lib/copy/extraction.ts`.

**Interfaces:** `ProposalDisclosure` receives coordinate, existing history loader, `acceptedProposalId`, `saving`, `onToggle(proposal)`, and read-only status. One history item is one card; no grouping/deduplication by run/value. `ProposalPreview` receives latest proposal and count, `expanded`, `onExpand`, and uses complete-value formatting in a bounded tooltip. `GenerationDetailsContent` receives only the card's immutable snapshot and historical-input availability; legacy fallback is explicit.

- [ ] Write RTL/MSW tests for two equal-valued proposals with different models/reasoning/source lists, carousel selection and comparison toggling, each source invoking its own location, initial loading/error versus refresh error, legacy unavailable details and read-only cards. Assert full preview reachable by hover and keyboard, as well as disclosure.

```ts
await user.click(screen.getByRole('button', {name: /compare extractions/i}));
expect(screen.getAllByRole('article')).toHaveLength(2);
expect(screen.getByText('First call reasoning')).toBeVisible();
expect(screen.getByText('Second call reasoning')).toBeVisible();
```

- [ ] Run `npm run test:run -- frontend/test/components/ProposalDisclosure.test.tsx`; expect missing components.
- [ ] Implement newest-first cards, compact extraction ordinal/latest, source count then model/date on the title line, full value, own reasoning, all stored ranked citations and collapsible inline generation details. Reuse existing reader locate/highlight/live-region path and value formatting. Give each source one icon-only Locate action with accessible label/tooltip; failed location keeps the disclosure open. Generation details must not silently open current document content as original input.
- [ ] Default to one card, with previous/next and position. Compare uses CSS grid `repeat(auto-fit,minmax(min(100%,320px),1fr))` and wraps; restore carousel index when returning. Respect reduced motion. Each card's check uses Task 7; no Dismiss button. Collapse card content without unmounting or losing an editor's active focus.
- [ ] Keep the existing popover for QA/consensus consumers. Extract shared generation detail body without changing their dialog presentation. Test those existing popover/evidence/dialog consumers alongside new tests; commit `feat(extraction): review each generation inline`.

## Task 9: Integrate the compact table, guide, focus and shortcuts

**Seat:** frontend. **Files:** Create `frontend/components/extraction/review/ExtractionReviewTable.tsx`, `frontend/components/extraction/review/ExtractionReviewRow.tsx`, `frontend/components/extraction/review/ReviewQuickActions.tsx`, `frontend/hooks/extraction/useReviewNavigation.ts`, `frontend/test/components/ExtractionReviewTable.test.tsx`, `frontend/test/hooks/useReviewNavigation.test.tsx`; modify `frontend/components/extraction/ExtractionFormView.tsx`, `frontend/components/extraction/entries/EntryFormContext.tsx`, `frontend/components/extraction/entries/EntrySection.tsx`, `frontend/components/extraction/SectionAccordion.tsx`, `frontend/components/extraction/InstanceCard.tsx`, `frontend/components/runs/SectionNavLayout.tsx`, `frontend/components/extraction/SectionNavRail.tsx`, `frontend/pages/ExtractionFullScreen.tsx`, `frontend/lib/copy/extraction.ts`.

**Interfaces:** Pass opt-in `presentation: 'review-table'|'default'` through the existing form/entry/section tree, enabled by run kind/editability at the production shell. Preserve registry/entry identity. Table uses `{instanceId,fieldId}` coordinates; navigation holds current coordinate, open disclosure coordinate and focus mode. Add optional controlled guide visibility/toolbar slot to `SectionNavLayout`; existing default behavior is unchanged.

- [ ] Test default left guide/right viewer, no duplicate subheader, nested/repeating entry fields, one open disclosure, wrapped question labels/descriptions, and correct latest collapsed-check versus active-card toolbar target. Test section action remains when collapsed, counts use color without dots, and guide hiding reclaims pane width.

```ts
expect(screen.getAllByRole('columnheader').map(el => el.textContent))
  .toEqual(['Question', 'Extracted value', 'AI proposal']);
await user.click(screen.getByRole('button', {name: /focus question/i}));
expect(screen.getByText(question.description)).toBeVisible();
expect(screen.getAllByRole('button', {name: /leave focus/i})).toHaveLength(1);
```

- [ ] Run `npm run test:run -- frontend/test/components/ExtractionReviewTable.test.tsx frontend/test/hooks/useReviewNavigation.test.tsx`; capture red.
- [ ] Render semantic table rows with expanded disclosure in a full-span associated row; at compact pane widths use accessible stacked rows in Question/value/proposal order. Keep editor labels accessible. Column widths persist under user/template key, use Task 6 fit allocation, hide handles below 900 px and stack below 600 px. Observe **pane** width, including guide/document resize. No page overflow or clipped actions. Continuous background across focused row, cards and empty remainder.
- [ ] Put section toggle first at far left of sticky quick bar, followed by current question/count, accept/reverse, focus/unfocus, previous, next pending and reset widths. Reuse header undo if present; do not duplicate progress/undo. Use icon hover tooltips, quiet circular borderless active fills/shadows; green only on confirmed acceptance. Focus exists only in quick bar. Reduced-height sticky/collapsible section headers retain extraction action and optional tooltip description.
- [ ] Implement `A`, `F`, `Shift+ArrowLeft`, `Shift+ArrowRight` through existing keyboard shortcut infrastructure. Guard input/textarea/select/contenteditable, composed-path editable children, open dialogs and menus. Previous walks the previous question; next skips completed questions using existing pending semantics. No wrap beyond boundaries; disabled buttons explain no previous/pending question. Section jumps/explicit navigation focus the destination; opening disclosure and job completion do not steal focus.
- [ ] Keep article navigation, entry switches, template switches and lifecycle changes clearing invalid current coordinates. Empty template, missing history, refresh errors, forbidden/not-found and finalized/stale runs use the spec states. Read-only extraction uses existing presentation while keeping history/citations readable. Run `npm run typecheck`, new tests and `npm run test:run -- frontend/test/ExtractionFormView.test.tsx frontend/test/ExtractionFullScreen.readonly.test.tsx frontend/test/ExtractionFullScreen.articleSwitch.test.tsx frontend/components/extraction/entries/EntrySection.test.tsx`; commit `feat(extraction): integrate compact review table workspace`.

## Task 10: Browser behavior and visual review

**Seat:** frontend. **Files:** Create `frontend/e2e/flows/extraction-review-workspace.ui.e2e.ts`; modify `playwright.config.ts` to register the new stateful flow in `local-hitl` and exclude it from `local-ui`; modify only affected production files from Tasks 5–9 when browser evidence demonstrates a defect.

**Interfaces:** Use existing `_fixtures/auth.ts:loginViaUi`, HITL/API fixtures and resource cleanup. Production components and real local persisted decisions are under test. LLM transport can be deterministic at its test seam, but never substitute the prototype page for the application.

- [ ] Add browser tests for real reload acceptance/reversal, two proposals/two sources, responsive pane widths, pointer/keyboard reset/persistence, long editor resize, focus/shortcuts, section job independence and QA/consensus unchanged. Use local-hitl single-worker fixture discipline.

```ts
await expect(page.getByRole('button', {name: /unaccept/i}).first()).toBeVisible();
await page.reload();
await expect(page.getByRole('button', {name: /unaccept/i}).first()).toBeVisible();
expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
```

- [ ] Run `npx playwright test frontend/e2e/flows/extraction-review-workspace.ui.e2e.ts --project=local-hitl --workers=1 --reporter=list`; capture red evidence before fixes. Do not increase retries to hide failures.
- [ ] Drive `/design-review` using production UI authenticated by the fixture. Inspect screenshots at viewport 1920×1080 and 1440×900 with reader open, compress the review pane across 900 and 600 px, and test viewport 768×1024 using current narrow reader behavior. Inspect long question/value, two side-by-side cards, three citations, empty/no-information, focused mode and active actions. Record screenshot/report locations and concrete findings; correct demonstrated layout defects.
- [ ] Add axe checks for the new table/disclosure/actions and reduced-motion behavior. Confirm focus order, resize separator accessible values, touch target, typing guards and unavailable anchors. Run existing extraction navigation/read-only/QA flows selected by their actual registered Playwright project.
- [ ] Re-run the exact new browser command and focused affected Vitest files; commit `test(extraction): verify review workspace interactions`.

## Task 11: Cross-layer regression and documentation

**Seat:** backend or frontend reviewer/implementer as appropriate. **Files:** Modify `docs/reference/extraction-hitl-architecture.md` and feature documentation only; fix production defects in the responsible task's files after a failing regression test. Do not broaden feature scope.

**Interfaces:** Document new attempt/proposal columns, request UUID semantics, per-call snapshots, privacy boundary and section-only UI. Migration revision and actual code symbols must agree with the tree.

- [ ] Review the spec requirement matrix against Tasks 1–10 and add any missing **behavioral** regression before modifying code. In particular verify nullable legacy rows, append-only decisions, identity allowlists on every reader, fresh same-value attempt, transport replay, duplicate worker delivery, entry-call snapshots, concurrent sections and terminal lifecycle races.
- [ ] Run backend focused regression:

```bash
cd backend && uv run pytest tests/integration/test_extraction_attempt_repository.py tests/integration/test_extraction_attempt_kickoff.py tests/integration/test_extraction_generation_attempts.py tests/integration/test_proposal_generation_read.py tests/integration/test_section_extraction_gate.py tests/integration/test_section_extraction_evidence.py tests/integration/test_extraction_proposal_service.py tests/integration/test_suggestion_read.py tests/integration/test_run_engine_freeze.py tests/integration/test_migration_roundtrip.py tests/unit/test_section_extraction_endpoint.py tests/unit/test_run_section_extraction_task.py -q
```

- [ ] Run frontend focused regression and static checks:

```bash
npm run typecheck
npm run test:run -- frontend/test/components/ExtractionReviewTable.test.tsx frontend/test/components/ProposalDisclosure.test.tsx frontend/test/hooks/useProposalDecision.test.tsx frontend/test/hooks/sectionExtractionJobs.test.tsx frontend/test/hooks/useReviewNavigation.test.tsx frontend/components/shared/list/useResizableTableColumns.test.ts frontend/components/shared/list/ColumnResizeHandle.test.tsx frontend/lib/extraction/reviewColumnWidths.test.ts frontend/lib/extraction/proposalDecisionState.test.ts frontend/test/ExtractionFormView.test.tsx frontend/test/ExtractionFullScreen.readonly.test.tsx
npx knip
npx knip --production
git diff --check
```

- [ ] Update canonical architecture with actual implemented schema and boundaries. Run `bash scripts/docs/check-frontmatter.sh` with the changed documentation paths. Confirm no unused new copy keys/exports and no prototype artifacts; production imports must consume the new modules.
- [ ] Run the Task 10 browser command after any relevant fixes, then commit `docs(extraction): document attempt and review workspace contracts`. Report exact commands, exit codes and remaining limitations to the orchestrator. The orchestrator owns whole-branch review, `ship.sh gate`, CI, promotion and production smoke; this seat must not edit ship state or claim deployment.

## Acceptance coverage and handoff

| Spec requirement | Owning task(s) |
| --- | --- |
| §§6–7 compact shell/guide/table/editors | 6, 9, 10 |
| §§7.4/9 complete previews, cards, compare, sources | 4, 8, 10 |
| §§7.5/10 persistent reversible acceptance/save races | 7, 9, 10 |
| §§8/13 focus, keyboard, responsive accessibility | 6, 9, 10 |
| §§11/14 independent section state and failures | 2, 5, 9 |
| §12 attempt ownership/idempotency/engine pin | 1–3, 11 |
| §12 immutable per-call facts, historical source truth, privacy | 3–4, 8, 11 |
| §§14–16 legacy/read-only/QA/consensus/lifecycle | 3–4, 7–11 |
| §12 migration/RLS/roundtrip | 1, 11 |

No production ceiling is satisfied by these local commands alone. The ship orchestrator must capture same-SHA CI/preflight, merge dev→main through the governed PR, verify both Railway services and frontend content, and require a fresh production smoke run according to `/ship-spec` and `/deploy-release`.
