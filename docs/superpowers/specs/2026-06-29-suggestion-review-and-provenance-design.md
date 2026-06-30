---
status: draft
last_reviewed: 2026-06-29
owner: '@raphaelfh'
---

# AI-suggestion review: selection model, run provenance, and no-information handling — design

> **Status:** Draft · Date: 2026-06-29 · Deciders: @raphaelfh
> **Scope:** Frontend (the review surface + selection) + a light backend change
> (run-level provenance capture, the no-information proposal fix, API exposure).
> No app-schema migration (uses the existing `extraction_runs.results` JSONB and
> the existing proposal/decision tables).
> **Pillar:** Establishes **transparency + traceability of AI-assisted decisions**
> as a named project principle.

## 1. Problem

Three defects + one transparency gap in the AI-suggestion review flow.

1. **The History popover's Accept/Reject are dead.** `FieldInput` mounts
   `AISuggestionHistoryPopover` with **no** `onAccept`/`onReject`
   (`FieldInput.tsx` ~L423-431), so the buttons hit a guarded no-op
   (`AISuggestionHistoryPopover.tsx`: `onClick={() => { if (onAccept) onAccept(suggestion); }}`).
   Deeper: the accept pipeline is keyed only by `(instanceId, fieldId)`
   (`useAISuggestions.acceptSuggestion`), so there is **no way to accept a
   *specific* historical suggestion** — the very thing "switch selection" needs.

2. **"No information in the text" is silently dropped.** In
   `section_extraction_service._create_suggestions` (~L1215) the per-field loop
   does `if value is None: continue` and skips abstentions
   (`status in ("not_found","ambiguous")`). When the model finds nothing, **no
   proposal is created** — so there's no record the extraction ran for that
   field, no provenance, and nothing renders. The field just looks untouched.

3. **No provenance is surfaced.** Model, provider, extraction strategy / prompt,
   pydantic-ai params (temperature `0.1`, output retries `2`, timeout) are
   hardcoded and persisted nowhere per-run; run-level token usage is stored
   (`extraction_runs.results`) but not exposed. The reviewer can't see *how* a
   suggestion was generated — undermining traceability.

## 2. Goals / non-goals

**Goals**

- A reviewer can **select** any past AI version to set the field, and **switch**
  between versions; the active one is clearly "Selected". (Fixes defect 1.)
- A "no information" outcome is **recorded as a first-class version** tied to the
  run, and renders as a clean "No information found" card. (Fixes defect 2.)
- Each version shows **how it was generated** (ran-by user, model/provider,
  strategy + prompt, params, tokens, reasoning-when-present) in an **extensible**
  disclosure that accepts new fields without layout changes. (Fixes gap 3.)
- One unified, viewport-bounded review surface replaces the two popovers.
- Transparency + traceability added as a project pillar.

**Non-goals**

- No per-proposal metadata columns / migration (run-level capture in
  `results` JSONB is sufficient — one run = one model/params today).
- No change to the LLM extraction itself (model choice, prompting) beyond
  recording what it used and not dropping abstentions.
- No change to the consensus/finalize lifecycle.

## 3. Decisions (locked with the user)

| # | Decision |
|---|----------|
| D1 | **Pure selection** model: one version Selected; others show "Use this version"; a single "Clear" drops to manual. No per-item accept/reject. |
| D2 | **Unify** `AISuggestionHistoryPopover` + `AISuggestionDetailsPopover` into one `AISuggestionReviewPopover`. |
| D3 | Provenance is an **extensible, data-driven `RunProvenanceDisclosure`** (collapsed by default; known-field registry + generic fallback; long text → bounded code block). |
| D4 | Provenance captured **per-run** in `extraction_runs.results` (no migration), exposed via the suggestions/history API. Fields: ran-by user, provider, model, strategy (prompt name+version), prompt text, params {temperature, output_retries, timeout}, tokens {prompt, completion, total}, reasoning settings (when present). |
| D5 | "No information" / abstention → **create a proposal** (`proposed_value={"value": null}` + rationale + confidence), not `continue`. |
| D6 | Popover is **capped + scrollable**: pinned header → scrollable body (`max-h-[min(70vh,32rem)]`) → pinned footer. |

## 4. Architecture overview

```
AISuggestionReviewPopover (replaces history + details popovers)
 ├─ AIPopoverShell  (+ new pinned `footer` slot)            ← Part 2 / Part 6-shell
 │    pinned header → scrollable body (≤70vh) → pinned footer
 ├─ per run group (newest first):
 │    ├─ version row: value · confidence · Selected | "Use this version"
 │    ├─ RunProvenanceDisclosure  (extensible)              ← Part 3
 │    └─ AISuggestionEvidence (reasoning + cited evidence, locate)  [reused]
 └─ footer: traceability note · Clear

useAISuggestions.selectSuggestion(instanceId, fieldId, proposalRecordId)  ← Part 1
   → extractionValueService.acceptProposal(runId, …, proposalRecordId)   [existing endpoint]

backend: _create_suggestions emits no-info proposals  + run provenance snapshot  ← Parts 4 & 5
   → /articles/{id}/suggestions(+/history) responses carry `provenance`
```

## 5. Part 1 — Selection model + the Accept bug fix (frontend)

- **New hook path** `useAISuggestions.selectSuggestion(instanceId, fieldId, proposalRecordId)`:
  calls `extractionValueService.acceptProposal({ runId, instanceId, fieldId, proposalRecordId })`
  — the endpoint **already accepts any `proposal_record_id`** (append-only
  `ExtractionReviewerDecision`, so the audit trail is automatic). On success it
  bubbles the chosen version's value into form state (`onSuggestionAccepted →
  updateValue`) exactly like the current accept, and marks that proposal id as
  the selected one. Keep the existing `acceptSuggestion(instanceId, fieldId)` as
  a thin wrapper (= select the latest pending) for the inline quick-accept.
- **Selected version** = the proposal id referenced by the field's active
  `accept_proposal` decision (from `runDetail`/current values); fall back to the
  latest version when none. The review popover derives this and shows the
  "Selected" pill on the matching version; all others show **"Use this version"**.
- **Clear** = the existing reject/clear path (`rejectSuggestion`) — drops the AI
  value so the field is manually editable.
- `FieldInput` no longer renders a handler-less popover; it renders the unified
  review popover wired to `selectSuggestion`/clear (Part 2).

## 6. Part 2 — Unified `AISuggestionReviewPopover` (frontend)

- New `components/extraction/ai/AISuggestionReviewPopover.tsx` **replaces**
  `AISuggestionHistoryPopover` and `AISuggestionDetailsPopover`. Built on
  `AIPopoverShell`. Loads history via the existing `getHistory(instanceId, fieldId)`;
  groups by run (newest first). Per version: value, confidence (or "N% · low" for
  low confidence, or "No information found" for null), Selected pill **or** "Use
  this version", and — for the selected/expanded version — the
  `RunProvenanceDisclosure` + `AISuggestionEvidence` (reasoning + citations with
  the existing `useReaderLocate` locate/highlight). Non-selected versions stay
  compact behind a "Details · N citations" expander (progressive disclosure).
- **`AIPopoverShell` gains an optional pinned `footer` slot**, rendered *after*
  the existing scrollable body (`max-h-[min(70vh,32rem)] overflow-y-auto`), so
  header + footer are pinned and only the versions list scrolls — the popover is
  always viewport-bounded and "Clear" stays reachable. The shell already caps
  width (`w-[min(380px,calc(100vw-1.5rem))]`).
- **Inline strip** (`AISuggestionInline`/`AISuggestionDisplay`): keep the quick
  "accept latest / clear" + a single trigger that opens the unified review
  popover. The old Sparkles "details" trigger and Clock "history" trigger
  collapse into this one trigger.
- Remove `AISuggestionHistoryPopover.tsx` and `AISuggestionDetailsPopover.tsx`
  after migrating their behavior (evidence/locate logic moves into the review
  popover or a small shared `AISuggestionEvidenceSection`).

## 7. Part 3 — `RunProvenanceDisclosure` (extensible, data-driven)

New `components/extraction/ai/shared/RunProvenanceDisclosure.tsx`.

- **Contract:** `{ provenance: RunProvenance }` where `RunProvenance` is an open
  object of scalar/text fields. The component renders an **ordered list of
  entries** resolved through a small **known-field registry**:

  ```ts
  type ProvenanceKind = 'scalar' | 'code' | 'boolean';
  interface ProvenanceFieldDef { key: string; label: string; section: string; kind: ProvenanceKind; format?: (v: unknown) => string; }
  const PROVENANCE_REGISTRY: ProvenanceFieldDef[] = [
    { key: 'ranByName',   label: 'Ran by',        section: 'model',      kind: 'scalar' },
    { key: 'provider',    label: 'Provider',      section: 'model',      kind: 'scalar' },
    { key: 'model',       label: 'Model',         section: 'model',      kind: 'scalar' },
    { key: 'reasoning',   label: 'Reasoning',     section: 'model',      kind: 'scalar' },
    { key: 'temperature', label: 'Temperature',   section: 'parameters', kind: 'scalar' },
    { key: 'outputRetries', label: 'Output retries', section: 'parameters', kind: 'scalar' },
    { key: 'timeoutSeconds', label: 'Timeout',    section: 'parameters', kind: 'scalar', format: s => `${s}s` },
    { key: 'tokensTotal', label: 'Tokens',        section: 'parameters', kind: 'scalar', format: formatTokens },
    { key: 'strategy',    label: 'Strategy',      section: 'strategy',   kind: 'scalar' },
    { key: 'promptText',  label: 'Prompt sent',   section: 'strategy',   kind: 'code' },
  ];
  ```

- Render rules: `scalar` → key/value row (truncate + `title` for long values);
  `code` → bounded (`max-h`) scrollable `<pre>` + copy; `boolean` → yes/no.
  **Known keys** get labels/sections/formatters; **unknown keys present in
  `provenance`** render as generic scalar rows (graceful future-proofing);
  **absent keys are omitted** (no empty gaps). Collapsed by default with a
  one-line summary (`model · tokens`); expandable.
- This is the single extension point: a future field (tool calls, schema mode,
  seed, multi-step reasoning trace) is added to the backend `provenance` payload
  and — optionally — one registry row; nothing else changes.

## 8. Part 4 — Backend: run provenance capture + API exposure

- **Capture (no migration).** At extraction time in `section_extraction_service`
  (where the run + tokens are finalized into `extraction_runs.results`), write a
  `provenance` sub-object into `results`:
  ```python
  results["provenance"] = {
    "ran_by_user_id": self.user_id,
    "provider": settings.LLM_PROVIDER,
    "model": model,                       # the resolved model id used
    "strategy": prompt.name,              # e.g. "section_extraction" / PROBAST signaling
    "prompt_version": prompt.version,
    "prompt_text": system_prompt,         # the system prompt actually sent
    "params": {"temperature": 0.1, "output_retries": output_retries, "timeout_seconds": settings.LLM_TIMEOUT_SECONDS},
    "reasoning": reasoning_setting_or_None,
  }
  ```
  (Tokens already live in `results`; reuse them.) All values are available at
  extraction time — no schema change.
- **Expose.** Add a `provenance` object to the suggestions + history response
  schemas (`schemas/extraction_suggestion.py`) and populate it in
  `extraction_suggestion_read_service` by joining `extraction_runs.results` on
  `run_id` (the read service already has `run_id` per item; group the run join to
  avoid N+1). `ran_by_user_id` is returned as an id; the frontend resolves the
  display name via the existing reviewer-profile mechanism (or the read service
  resolves it — implementer's choice, prefer FE resolution to avoid a join).
- **Frontend mapping.** Add `provenance?: RunProvenance` to `AISuggestion` /
  history item (`types/ai-extraction.ts`) and map it in `aiSuggestionService`.

## 9. Part 5 — No-information proposals (backend + frontend)

- **Backend (`_create_suggestions`):** replace the silent `continue` for
  `value is None` and abstention (`status in ("not_found","ambiguous")`) with a
  **first-class proposal**: `proposed_value = {"value": None}`,
  `confidence_score = value.get("confidence")` if present, `rationale =
  value.get("reasoning")` (the model's "why not found"). This records that the
  run ran for the field (provenance attaches via the run) and makes "no
  information" a selectable version. Evidence may be empty.
- **Frontend:** a null-valued version renders as **"No information found"**
  (clean card, no crash) with its reasoning + empty-evidence note. `formatValue`
  already maps null → a label; ensure the value cell, the inline strip, and
  `selectSuggestion` all handle a null value without errors.
- **Selecting a no-info version** records the decision (audit) and leaves the
  field value null (an explicit "no information" acknowledgement). Null does not
  satisfy a required-field completion gate — correct for data extraction; this is
  called out for the adversarial review (Part 11).

## 10. Part 6 — Transparency + traceability pillar (docs)

- Add a principle to `docs/reference/constitution.md`: **Transparency &
  traceability of AI-assisted decisions** — every AI suggestion records how it
  was generated (run provenance) and every human selection is recorded
  append-only (who selected which version, when). Reference it from CLAUDE.md
  "Working principles" (one line).

## 11. Risks (flag for adversarial review)

- **No-info behavior change (highest):** every unfound field now creates a
  proposal. Verify: (a) no proposal-volume / dedup regressions on re-run
  (`skip_fields_with_human_proposals` path), (b) the completion gate treats a
  null no-info selection as incomplete (not falsely complete), (c) the inline
  strip + form render null suggestions without errors, (d) no-info proposals
  don't break the consensus/finalize read paths.
- **Selection vs. current-values:** deriving "Selected" from the active decision
  must match what the form shows; a mismatch would show the wrong version
  highlighted. Covered by a unit test against a `runDetail` fixture.
- **Provenance read N+1:** join the run once per response, not per suggestion.
- **Popover height:** confirm pinned footer + body scroll keep the whole popover
  within the viewport on a short screen (design-review).
- **Extraction stack is the structural heart** (CLAUDE.md "Read before
  touching"): the `_create_suggestions` change is in that core path — backend
  tests must cover the no-info proposal + provenance capture.

## 12. File-by-file (indicative)

**Backend**
- `services/section_extraction_service.py` — emit no-info proposals; snapshot `results["provenance"]`.
- `services/extraction_suggestion_read_service.py` — join run, attach `provenance` to items.
- `schemas/extraction_suggestion.py` — `provenance` on `AISuggestionItem` + history item.
- (No migration.) Tests: `backend/tests/.../test_section_extraction_*`, suggestion-read tests.

**Frontend**
- New: `components/extraction/ai/AISuggestionReviewPopover.tsx` (+ test),
  `components/extraction/ai/shared/RunProvenanceDisclosure.tsx` (+ test).
- Modify: `components/extraction/ai/shared/AIPopoverShell.tsx` (pinned `footer` slot),
  `hooks/extraction/ai/useAISuggestions.ts` (`selectSuggestion`),
  `services/aiSuggestionService.ts` + `types/ai-extraction.ts` (`provenance`),
  `components/extraction/FieldInput.tsx` + `ai/AISuggestionInline.tsx` +
  `ai/AISuggestionDisplay.tsx` (single review trigger, wired to select/clear).
- Remove: `ai/AISuggestionHistoryPopover.tsx`, `ai/shared/AISuggestionDetailsPopover.tsx`
  (behavior folded into the review popover / a small shared evidence section).

**Docs**
- `docs/reference/constitution.md` (+ CLAUDE.md one-liner).

## 13. Testing

- **Vitest:** review popover (renders versions, Selected derivation, "Use this
  version" → `selectSuggestion(proposalId)`, no-info "No information found" card,
  capped/scrollable with pinned footer); `RunProvenanceDisclosure` (known fields,
  generic fallback for an unknown key, absent-key omission, code block + collapse);
  `useAISuggestions.selectSuggestion`; `AIPopoverShell` footer slot; `FieldInput`
  opens the review popover and select works.
- **pytest:** `_create_suggestions` creates a no-info proposal for None/abstention
  (with rationale/confidence) instead of skipping; `results["provenance"]` is
  written with the model/params/tokens/ran-by; the suggestions + history
  endpoints return `provenance`.
- **design-review:** the review popover on the extraction + QA screens — selection
  state, provenance disclosure expand, multiple citations + locate, "No
  information found", and the capped/scrollable height with pinned footer.

## 14. Out of scope

- Per-proposal provenance columns / migration (run-level suffices today).
- Per-suggestion model selection (mixing models within one run) — revisit if/when
  reasoning models are adopted per-field; the registry + payload already extend.
- Changing the completion-gate semantics of a "no information" answer.
