---
status: draft
last_reviewed: 2026-06-29
owner: '@raphaelfh'
---

# AI-suggestion review + run provenance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken AI-suggestion history popover with a unified
selection-based review surface that shows extensible run provenance, fix the
silently-dropped "no information" extraction outcome, and establish
transparency/traceability as a project pillar.

**Architecture:** Backend snapshots run provenance into `extraction_runs.results`
(JSONB, no migration) and emits a first-class proposal for "no information"
outcomes; the suggestions/history endpoints expose `provenance`. Frontend
replaces the two AI-suggestion popovers with one `AISuggestionReviewPopover`
(capped/scrollable, pinned footer) that selects-by-`proposal_record_id` and
renders an extensible `RunProvenanceDisclosure`.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 async + pydantic-ai (backend); React 19 +
TS strict + Vite + TanStack + vitest (frontend); pytest.

## Global Constraints

- **English only**; all user-facing text via `frontend/lib/copy/`.
- React Compiler `panicThreshold: all_errors` — no `try/finally`/`throw` in
  component/hook bodies; IO in services returning `ErrorResult`; `.then().catch()`.
- Frontend tooling from repo root; vitest via `npm run test:run` (not `npm test`).
- `@prumo/pdf-viewer` barrel pulls pdfjs/DOMMatrix → import engine-free pieces
  from `@/pdf-viewer/core` in unit-tested components.
- **No app-schema migration** — provenance lives in `extraction_runs.results`
  (JSONB); no-info proposals use the existing proposal/decision tables.
- Backend data flows component→hook→service→apiClient; no direct supabase reads.
- Extraction stack is the structural heart — `_create_suggestions` changes need
  pytest coverage (CI "Backend Tests" is the authoritative gate).

---

## File structure

**Backend**
- `services/section_extraction_service.py` — no-info proposal emission (~L1334);
  `_extract_with_llm` returns provenance; `complete_run(results=…)` stores it (~L284, ~L461).
- `services/extraction_suggestion_read_service.py` — attach `provenance` (run join) to suggestion + history items.
- `schemas/extraction_suggestion.py` — `provenance` on `AISuggestionItem` + history item.

**Frontend**
- New: `components/extraction/ai/shared/RunProvenanceDisclosure.tsx` (+ test),
  `components/extraction/ai/AISuggestionReviewPopover.tsx` (+ test).
- Modify: `components/extraction/ai/shared/AIPopoverShell.tsx` (footer slot),
  `hooks/extraction/ai/useAISuggestions.ts` (`selectSuggestion`),
  `services/aiSuggestionService.ts` + `types/ai-extraction.ts` (`provenance`, `RunProvenance`),
  `components/extraction/FieldInput.tsx`, `ai/AISuggestionInline.tsx`, `ai/AISuggestionDisplay.tsx`.
- Remove: `ai/AISuggestionHistoryPopover.tsx`, `ai/shared/AISuggestionDetailsPopover.tsx`.

**Docs**: `docs/reference/constitution.md` (+ CLAUDE.md one-liner).

---

## Task 1: `AIPopoverShell` — pinned footer slot

**Files:** Modify `frontend/components/extraction/ai/shared/AIPopoverShell.tsx`;
Test `frontend/components/extraction/ai/shared/AIPopoverShell.test.tsx` (create).

**Produces:** `AIPopoverShellProps` gains `footer?: React.ReactNode` rendered
*outside* the scroll region (pinned), after the existing `max-h-[min(70vh,32rem)]
overflow-y-auto` body.

- [ ] **Step 1: Failing test**
```tsx
import { render, screen } from "@testing-library/react";
import { Popover } from "@/components/ui/popover";
import { describe, expect, it } from "vitest";
import { AIPopoverShell } from "@/components/extraction/ai/shared/AIPopoverShell";
import { Clock } from "lucide-react";

it("renders a pinned footer outside the scroll body", () => {
  render(
    <Popover open>
      <AIPopoverShell icon={<Clock />} title="Review" footer={<div data-testid="ftr">Clear</div>}>
        <div data-testid="body">body</div>
      </AIPopoverShell>
    </Popover>,
  );
  const ftr = screen.getByTestId("ftr");
  const scroll = screen.getByTestId("body").closest(".overflow-y-auto");
  expect(ftr).toBeInTheDocument();
  expect(scroll?.contains(ftr)).toBe(false); // footer is NOT inside the scroll region
});
```
- [ ] **Step 2: Run → FAIL** (`npm run test:run -- frontend/components/extraction/ai/shared/AIPopoverShell.test.tsx`; footer prop unknown).
- [ ] **Step 3: Implement** — add `footer?: React.ReactNode` to the interface; render `{footer != null && (<div className="border-t">{footer}</div>)}` AFTER the `<div className="max-h-[min(70vh,32rem)] overflow-y-auto">{children}</div>`. Header + footer pinned; body scrolls.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(extraction): AIPopoverShell pinned footer slot`.

---

## Task 2: `RunProvenanceDisclosure` (extensible, data-driven)

**Files:** Create `frontend/components/extraction/ai/shared/RunProvenanceDisclosure.tsx` + `.test.tsx`.

**Interfaces:**
- Consumes: `RunProvenance` type (Task 3). Until Task 3 lands, define a local
  `RunProvenance = Record<string, unknown>` import from `@/types/ai-extraction`.
- Produces: `RunProvenanceDisclosure({ provenance, defaultOpen? })`. Renders a
  collapsible. Known keys via a registry (label/section/kind/format); unknown
  keys present in `provenance` → generic scalar rows; absent keys omitted;
  `code` kind → bounded scrollable `<pre>` + copy; collapsed summary = `model · tokens`.

- [ ] **Step 1: Failing test**
```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RunProvenanceDisclosure } from "@/components/extraction/ai/shared/RunProvenanceDisclosure";

const prov = {
  ranByName: "Raphael F.", provider: "anthropic", model: "claude-sonnet-4-6",
  temperature: 0.1, outputRetries: 2, timeoutSeconds: 120,
  tokensTotal: 3910, strategy: "PROBAST signaling", promptVersion: "v4",
  promptText: "You are appraising risk of bias…", futureKnob: "xyz",
};

describe("RunProvenanceDisclosure", () => {
  it("shows known fields, a generic row for unknown keys, omits absent, expands code", () => {
    render(<RunProvenanceDisclosure provenance={prov} defaultOpen />);
    expect(screen.getByText("Model")).toBeInTheDocument();
    expect(screen.getByText("claude-sonnet-4-6")).toBeInTheDocument();
    expect(screen.getByText("120s")).toBeInTheDocument();           // formatter
    expect(screen.getByText(/futureKnob/i)).toBeInTheDocument();    // generic fallback for unknown key
    expect(screen.queryByText("Reasoning")).not.toBeInTheDocument(); // absent key omitted
    expect(screen.getByText(/You are appraising/)).toBeInTheDocument(); // code block
  });

  it("collapses by default and toggles", () => {
    render(<RunProvenanceDisclosure provenance={prov} />);
    expect(screen.queryByText("Temperature")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /how this was generated/i }));
    expect(screen.getByText("Temperature")).toBeInTheDocument();
  });
});
```
- [ ] **Step 2: Run → FAIL** (module missing).
- [ ] **Step 3: Implement** — registry of known fields (`ranByName`,`provider`,`model`,`reasoning`,`temperature`,`outputRetries`,`timeoutSeconds`(format `${v}s`),`tokensTotal`(format `toLocaleString`),`strategy`,`promptVersion`,`promptText`(kind `code`)). Iterate registry → render rows for present keys; then iterate any provenance keys NOT in the registry → generic `key: value` rows. `code` kind → `<pre className="max-h-28 overflow-auto …">` + a copy button. Collapsed by default (`useState(defaultOpen ?? false)`); trigger button labelled "How this was generated" + summary `model · N tokens`. All copy via `t('extraction', …)` keys (add them). No try/finally.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(extraction): extensible RunProvenanceDisclosure`.

---

## Task 3: Frontend `RunProvenance` type + service mapping

**Files:** Modify `frontend/types/ai-extraction.ts`, `frontend/services/aiSuggestionService.ts`; Test extends `aiSuggestionService` test (or a focused mapping test).

**Produces:** `RunProvenance` interface (optional fields mirroring D4 of the spec, camelCase) and `AISuggestion.provenance?: RunProvenance`. `mapItemToSuggestion` maps the server `provenance` (snake_case) → camelCase, including resolving `ran_by_user_id` is left to the consumer (carry the id as `ranByUserId`; the popover resolves the name from reviewer profiles, falling back to the id).

- [ ] **Step 1: Failing test** — a mapping unit test asserting `mapItemToSuggestion({…, provenance: {model:"x", params:{temperature:0.1}, tokens:{total:10}}})` yields `{ provenance: { model:"x", temperature:0.1, tokensTotal:10 } }` (flattened camelCase).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — add `RunProvenance` (keys: `ranByUserId?`,`ranByName?`,`provider?`,`model?`,`strategy?`,`promptVersion?`,`promptText?`,`temperature?`,`outputRetries?`,`timeoutSeconds?`,`tokensPrompt?`,`tokensCompletion?`,`tokensTotal?`,`reasoning?` plus `[k:string]:unknown` for forward-compat). Add `provenance?: RunProvenance` to `AISuggestion`/`AISuggestionHistoryItem`. In `mapItemToSuggestion`/`getHistory`, flatten the server `provenance` object to camelCase.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(extraction): RunProvenance type + service mapping`.

---

## Task 4: `selectSuggestion` (accept-by-proposal-id)

**Files:** Modify `frontend/hooks/extraction/ai/useAISuggestions.ts`; Test `frontend/hooks/extraction/ai/useAISuggestions.selectSuggestion.test.tsx` (create) — mock `AISuggestionService`/`extractionValueService`.

**Interfaces:**
- Consumes: `extractionValueService.acceptProposal({ runId, instanceId, fieldId, proposalRecordId })` (existing).
- Produces: `selectSuggestion(instanceId, fieldId, proposalRecordId, value)` on the hook return; on success bubbles `value` via `onSuggestionAccepted(instanceId, fieldId, value)` (same as accept) so the form updates; records the selected proposal id.

- [ ] **Step 1: Failing test** — render the hook (or call its core) and assert `selectSuggestion('i','f','p2', 5)` calls `acceptProposal` with `proposalRecordId:'p2'` and fires `onSuggestionAccepted('i','f',5)`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — factor the accept body to accept an explicit `proposalRecordId` + `value`; `acceptSuggestion(instanceId, fieldId)` keeps current behavior (latest pending); `selectSuggestion(instanceId, fieldId, proposalRecordId, value)` targets the chosen id. Promise-chain (no try/finally). Return `selectSuggestion` from the hook.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(extraction): selectSuggestion accept-by-proposal-id`.

---

## Task 5: `AISuggestionReviewPopover` (unified surface)

**Files:** Create `frontend/components/extraction/ai/AISuggestionReviewPopover.tsx` + `.test.tsx`.

**Interfaces:**
- Consumes: `AIPopoverShell` (footer, Task 1), `RunProvenanceDisclosure` (Task 2),
  `AISuggestionEvidence` (existing, for citations+locate), `getHistory`,
  `selectSuggestion`, `onClear`, `selectedProposalId`.
- Produces: `AISuggestionReviewPopover({ instanceId, fieldId, getHistory, selectedProposalId, onSelect(proposalId, value), onClear, trigger })`.
  Groups history by run; selected version expanded (provenance + evidence);
  others compact with "Use this version" → `onSelect`. Null value → "No
  information found" card. Footer (pinned) = traceability note + Clear.

- [ ] **Step 1: Failing test**
```tsx
// renders versions; clicking "Use this version" on a non-selected item calls onSelect(id, value);
// a null-value item shows "No information found"; selected item shows "Selected".
```
(Mock `getHistory` to return 2 versions, one with `value:null`; assert the
testids/labels; assert `onSelect` called with the right id.)
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — load history on open (mirror the old popover's
  open/queueMicrotask pattern), group by `runId`, derive selected via
  `selectedProposalId`. Use `AIPopoverShell` with `footer`. Per version: value
  (or "No information found" for null), confidence/low badge, Selected pill or
  "Use this version" button, and for selected/expanded: `RunProvenanceDisclosure`
  + `AISuggestionEvidence`. Copy via `t('extraction', …)`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(extraction): unified AISuggestionReviewPopover`.

---

## Task 6: Rewire `FieldInput`/`AISuggestionInline`/`AISuggestionDisplay`; remove old popovers

**Files:** Modify `FieldInput.tsx`, `ai/AISuggestionInline.tsx`, `ai/AISuggestionDisplay.tsx`; Remove `ai/AISuggestionHistoryPopover.tsx`, `ai/shared/AISuggestionDetailsPopover.tsx` (+ its test). Update any importers/tests.

- [ ] **Step 1: Failing test** — extend `FieldInput` (or inline) test: the review trigger opens `AISuggestionReviewPopover`; selecting a version calls the field's select handler (passing the proposal id). (Mock the review popover or assert the trigger + wiring.)
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — replace both popover triggers with a single review trigger wired to `selectSuggestion`/clear; pass `selectedProposalId` (derive from current suggestion's accepted decision id). Delete the two old popover files; fold their evidence/locate into the review popover (or a tiny shared `AISuggestionEvidenceSection`). Update imports (grep for the removed components).
- [ ] **Step 4: Run → PASS** (the full extraction + assessment suites stay green); `npm run typecheck` clean.
- [ ] **Step 5: Commit** `refactor(extraction): single review trigger; remove legacy AI popovers`.

---

## Task 7: Backend — no-information proposals

**Files:** Modify `backend/app/services/section_extraction_service.py` (~L1333-1339); Test `backend/tests/.../test_section_extraction_no_info.py` (create, mocked-repo unit test to avoid full-DB dependency where possible; else an integration test).

**Behavior:** in `_create_suggestions`, replace the `continue` for `value is None`
and abstention with a no-info proposal: `proposed_value={"value": None}`,
`confidence_score = value.get("confidence")` (when dict), `rationale =
value.get("reasoning")` (when dict). Still skip only when the field id is unknown.

- [ ] **Step 1: Failing test** — feed `extracted_data = {"q1": None, "q2": {"status":"not_found","reasoning":"not stated"}}` and assert TWO proposals are created with `proposed_value == {"value": None}` (q2 carries rationale "not stated"), instead of zero.
- [ ] **Step 2: Run → FAIL** (currently `continue` → 0 proposals).
  Run: `cd backend && uv run pytest tests/.../test_section_extraction_no_info.py -v` (needs local Supabase for integration; if the local stack is down, write the test + rely on CI "Backend Tests" — note this explicitly in the commit).
- [ ] **Step 3: Implement** — at L1334/1338 replace `continue` with constructing the no-info proposal (reuse the same ProposalRecord creation path below, value `{"value": None}`, evidence empty). Keep the unknown-field `continue` (L~127). Guard: only emit no-info for fields in `field_map`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `fix(extraction): record no-information outcomes as proposals (was silently dropped)`.

---

## Task 8: Backend — run provenance snapshot

**Files:** Modify `backend/app/services/section_extraction_service.py` (`_extract_with_llm` return + both `complete_run(results=…)` sites ~L284, ~L461); Test extends a section-extraction test.

**Behavior:** `_extract_with_llm` returns `(extracted_data, llm_usage, provenance)`
where `provenance = {provider: settings.LLM_PROVIDER, model, strategy: prompt_module.NAME,
prompt_version: prompt_module.VERSION, prompt_text: system_prompt, params:
{temperature: <the model_settings temperature>, output_retries, timeout_seconds:
settings.LLM_TIMEOUT_SECONDS}, reasoning: <None for now>}`. The caller stores
`results["provenance"] = provenance | {"ran_by_user_id": self.user_id, "tokens":
{prompt:…, completion:…, total:…}}`.

- [ ] **Step 1: Failing test** — assert the completed run's `results["provenance"]`
  contains `model`, `strategy`, `params.temperature`, `ran_by_user_id`, `tokens.total`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — thread provenance out of `_extract_with_llm`; merge into both `complete_run(results=…)` blocks (single + batch). Source temperature from the extractor's known setting (avoid a second hardcode — export a constant or read from `model_settings`).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(extraction): snapshot run provenance into results`.

---

## Task 9: Backend API exposure + schema

**Files:** Modify `backend/app/schemas/extraction_suggestion.py` (add `provenance: dict | None` to `AISuggestionItem` + history item), `backend/app/services/extraction_suggestion_read_service.py` (attach provenance from a single per-run `results["provenance"]` lookup — one query for the run ids in the response, no N+1). Test extends the read-service test + an endpoint test asserting `provenance` is present.

- [ ] **Step 1: Failing test** — endpoint/read-service test: a suggestion whose run has `results["provenance"]` returns that provenance on the item; one without returns `null`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — schema field + read-service join (gather distinct run_ids → fetch their `results` once → map provenance onto items). Regenerate API types: `npm run generate:api-types` and commit the `schema.d.ts` diff. Frontend `mapItemToSuggestion` already consumes it (Task 3).
- [ ] **Step 4: Run → PASS** (pytest + `api-contract` types regenerated).
- [ ] **Step 5: Commit** `feat(extraction): expose run provenance on suggestions/history endpoints`.

---

## Task 10: Docs — transparency + traceability pillar

**Files:** Modify `docs/reference/constitution.md` (add a principle), `CLAUDE.md` ("Working principles" one-liner).

- [ ] **Step 1:** Add a "Transparency & traceability of AI-assisted decisions" principle to the constitution (every AI suggestion records its run provenance; every human selection is append-only with who/when). Add one CLAUDE.md line referencing it.
- [ ] **Step 2: Verify** docs-ci locally: `bash scripts/docs/check-frontmatter.sh` + markdownlint on changed files pass; add the plan + (if needed) any new doc to `.markdownlintignore` (the spec/plan are covered by the `2026-*` globs — verify).
- [ ] **Step 3: Commit** `docs(constitution): transparency + traceability pillar`.

---

## Final verification (whole diff)
- [ ] `npm run lint && npm run typecheck && npm run test:run` green; `npm run build` (React-Compiler gate) green.
- [ ] `cd backend && make lint-backend`; backend pytest for the touched services (locally if the stack is up, else CI "Backend Tests" is the gate — state which).
- [ ] `npm run generate:api-types` committed (api-contract).
- [ ] `make quality-scan` (or the frontend gate + fitness checks if the backend stack is unavailable locally — state which).
- [ ] `/design-review` on the extraction + QA screens: review popover selection state, provenance expand, multiple citations + locate, "No information found", capped/scrollable + pinned footer.

## Self-review notes
- **Spec coverage:** D1→T4/T5/T6; D2→T5/T6; D3→T2; D4→T8/T9/T3; D5→T7; D6→T1/T5; pillar→T10. All covered.
- **Type consistency:** `RunProvenance` (camelCase) defined T3, consumed T2/T5; backend `provenance` (snake_case) T8/T9 flattened by T3.

## Panel reconciliation (5-lens adversarial review — APPLIED)

Security = clean; migration = none (verified `proposed_value={"value":None}` satisfies `nullable=False` JSONB, only CHECK is `human_has_user`, irrelevant for AI). The following overrides/additions are now binding on execution:

- **R1 (security — do NOT regress):** `selectSuggestion`/`acceptProposal` must keep the existing server controls — the proposal-triplet check (`extraction_review_service.py:74-84`), `assert_coords_coherent` (`:59`), and the `load_run_for_update` + EXTRACT-stage gate (`:51-57`). They already make accept-by-id BOLA/TOCTOU-safe. Don't add a reviewer-role gate to `create_decision` (pre-existing membership-only gate; out of scope — note, don't change). `ran_by_user_id` = the manager who triggered the run (not a blind reviewer) → no reveal-logic change.
- **R2 (T8 — provenance params source):** temperature/output_retries/timeout are hardcoded in `backend/app/llm/extractor.py:75,83` (not reachable from `_extract_with_llm`). Expose them as **module constants in `extractor.py`** (`LLM_TEMPERATURE = 0.1`, `OUTPUT_RETRIES_DEFAULT = 2`) used by BOTH the Agent config and the provenance capture, so the recorded params are truthful (single source). `_extract_with_llm` returns provenance; merge it at the run-completion site(s).
- **R3 (T8 — capture sites):** there are multiple `complete_run(results=…)` sites (single `:282`, batch `:459`, per-section `~:984`). Provenance must land on **the run a suggestion's `run_id` references** — i.e. the run completed alongside the `_extract_with_llm` call that produced the proposals (single + per-section). Verify in code which run owns the proposals; cover that site. Test the single path AND the per-section/batch path.
- **R4 (T9 — run-keyed payload, KEEP prompt_text):** the user explicitly wants the prompt sent + auto-rendering future fields. Keep `promptText` (bounded `code` block) and the `RunProvenanceDisclosure` generic-unknown-key fallback. Resolve the simplicity lens's bloat concern by returning provenance **keyed by run once** in the response (`provenanceByRun: {run_id: RunProvenance}`), not duplicated per suggestion item; the FE service resolves `suggestion.provenance = provenanceByRun[suggestion.runId]`. Verify the system prompt carries no secrets before snapshotting (R1).
- **R5 (T6 — full removal scope):** deleting `AISuggestionDetailsPopover` also touches `components/extraction/ai/shared/AISuggestionConfidence.tsx` (renders it on the %-click), `components/extraction/ai/shared/index.ts` (barrel re-export), and `FieldInput.memo.test.tsx` (mocks the history popover). Route the %-confidence click into the new `AISuggestionReviewPopover`. Grep both removed component names under `frontend/` before deleting.
- **R6 (T7 — correct value shape + dedup):** the live abstention branch is the `status in ("not_found","ambiguous")` dict at `:1338` (the bare-`None` `:1334` is largely dead since `dump_extraction` always emits a per-field dict). Store `proposed_value={"value": None}` (the inner value), **not** the status dict. Do NOT show a confidence % on a no-info card (a `not_found` confidence is often `0.0` and reads as misleading). `record_proposal` is run-scoped idempotent — add a pytest asserting a repeated no-info value within a run does NOT append a duplicate, and that the read service returns exactly one latest-per-coord. Accept (and document) that the standalone fresh-run path records one no-info proposal per run as intended provenance; the session screens reuse the run so they don't accumulate.
- **R7 (NEW Task 7b — QA-prefill guard, BLOCKING from the no-info lens):** the QA form hydrates from proposals (`useExtractedValues.usesProposalsPath`, `proposalValues.pickLatestProposalPerCoord`), so a no-info proposal maps to `null` → an unfilled cell. Add a focused task: (a) vitest that `{"value":None}` → `null` → unfilled (does not satisfy required completion — confirmed safe by `progress.ts:126-135`); (b) **verify the autosave does NOT echo a hydrated no-info `null` back as a `human` proposal on mount** (baseline=loadedValues carries the null; null==null ⇒ not dirty ⇒ no POST) — assert this, since a spurious human null would pollute the audit trail and falsely mark the field human-handled; (c) document the intended semantics: a newer abstention blanks a previously-found QA cell.
- **R8 (T5/T6 — de-emphasized no-info rendering):** every unfound field now yields a proposal, so the inline strip would otherwise show a loud "(empty)" accept/reject prompt per field. The new render must show a **quiet, de-emphasized "No information found"** indicator inline (not a loud suggestion strip); confirm via `/design-review` it isn't overwhelming on a CHARMS-sized template.
- **Test-coverage:** Task 7/8 are unit-testable with **no DB and no LLM** (invert `test_section_extraction_service.py:1071 test_skips_none_values`). Assert provenance at the **read-service** level (`load_suggestions(db,…)` direct call) not only via the ASGI route (diff-cover ASGI blind spot).

- **Highest risk (T7 + T7b):** the no-info change touches the QA prefill + autosave paths — the R6/R7 guards + pytest + a QA-path vitest + `/design-review` are mandatory before shipping.
