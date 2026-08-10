---
status: draft
last_reviewed: 2026-08-09
owner: '@raphaelfh'
---

# Template config B-9c2 — Discard UI + structured refusals

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development task-by-task. Built from a
> structural map (Explore) + a 3-lens adversarial panel (**17 findings,
> 4 blocking**, all folded) against dev @ `4feee638` (B-9c1 merged).
> Spec: §1 of
> `docs/superpowers/specs/2026-08-05-template-config-ux-redesign-design.md`.

## Why this slice opens with a backend addendum

B-9c1 shipped the Discard backend. The UI cannot render it truthfully:

- **The orphan list exists only as prose** — `OrphanAcknowledgementRequiredError`
  interpolates `label [uuid]` pairs and the literal `acknowledge_orphans=true`
  (`template_discard_service.py:600-606`); the endpoint re-raises
  `HTTPException(409, detail=str(e))` (`project_templates.py:314-322`) and
  `http_exception_handler` (`core/error_handler.py:221-243`) **never writes a
  `details` key**.
- **All five 409s share `code: "HTTP_ERROR"`**, so "re-ask with the ack" and
  "hard refusal" are indistinguishable without sniffing English.

The client pipe is fine (`ApiError` carries `.status/.code/.details`,
`integrations/api/client.ts:31-36`, `:58-69`; `normalizeError` passes
subclasses through, `lib/error-utils.ts:52-62`) — the backend just never
fills it.

## Load-bearing facts (map + panel, verified 2026-08-09)

- **`app_error_handler` does NOT `jsonable_encoder` its details**
  (`core/error_handler.py:207-218` hands `exc.details` to a bare
  `JSONResponse`, whose render is plain `json.dumps`). A `UUID` in
  `details` raises **inside the handler** → 500, and a service-level
  `pytest.raises` cannot see it: the exception object is well formed, only
  the wire breaks.
- **No endpoint in the repo declares `responses=`** — the committed
  `openapi.json` response keys are exactly `200/201/202/422`. And
  `ErrorDetail.details` is `dict[str, Any] | None`
  (`schemas/common.py:70-74`) → generates as `unknown`. So regenerating
  types buys **nothing** for a refusal payload unless the model is
  declared and attached.
- **Every refusal test calls the service directly** (`_discard` helper,
  `test_template_discard_draft.py:320-333`); the only ASGI tests are the
  200 (`:1158`) and the 403 (`:1180`).
- `AppError.__init__` calls `super().__init__(message)`
  (`error_handler.py:39`), so `str(exc)` stays the message and existing
  `pytest.raises(...)` assertions survive the conversion.
- **Orphans can duplicate per field**: `allowed_values` is diffed per
  option code (`template_diff.py:92`, `:137-138`), and the orphan set is a
  flat list of destructive changes.
- `_pending_change_count` returns `None` when
  `snapshot_is_narrow(entity_types)` — which is **true for an empty
  baseline by design** — while `discard_available` uses
  `baseline_is_restorable`. The two gates disagree exactly on the empty
  baseline (`template_version_read_service.py:68` vs the count helper).
- `useTemplateEntityTypes` returns `entityTypes: query.data ?? []` and
  `isLoading` (`:75-83`) — **a failed fetch is indistinguishable from zero
  rows**, and the editor gates its empty state on `entityTypes.length`.
  The imperative loader it replaces toasts on failure
  (`TemplateConfigEditor.tsx:110-115`).
- Widening `useTemplateConfigCaches`'s return breaks **five** test files
  that pass a strictly-typed `mockReturnValue` (tsconfig.app.json includes
  the whole `frontend` tree).
- `t()` returns `''` for a missing key (`lib/copy/index.ts:74`).
- `TemplateConfigEditor.tsx:312-323` already uses the **mount-per-open**
  pattern for `DeleteFieldConfirm`.
- Service-boundary discipline: every 409 in `templateService.ts` is
  re-wrapped (`PgError`) so the transport type never escapes (`:60-70`,
  `:199-205`, `:296-302`); `instanceof ApiError` appears only inside
  `frontend/services/`. `PgError` carries `code` only — **no `details`**.
- `DiscardKeptNode` carries a **`label`** (`hitl_session.py:78`), so no
  UUID needs to reach the screen; `kept` non-empty ⇒ the marker survives
  (`:106-107`).
- Dialog precedent `DeleteFieldConfirm.tsx:189-195` (`preventDefault` on
  the action keeps the dialog mounted through a refusal).
- Copy goes in `templateConfig.ts`; `extraction.ts` is pinned at 958.

## Decisions (panel-ratified)

- **D1 — Structured refusals, on the wire.**
  - A slice-local `TemplateDiscardRefusalCode(StrEnum)` in
    `schemas/hitl_session.py` (following the `ExtractionErrorCode`
    precedent, **not** added to the global `ApiErrorCode`).
  - The five refusals become `AppError` subclasses whose `__init__`
    forwards to `AppError` **by keyword**, preserving `str(e) == message`
    so existing assertions keep passing.
  - **The `except (NarrowBaselineError, …)` block at
    `project_templates.py:314-322` is DELETED** so they propagate to
    `app_error_handler` (precedent: `ExportColumnLimitError`). The 404
    block stays. Without this deletion the addendum ships nothing.
  - `details` is built from a Pydantic model's `model_dump(mode="json")`
    — **JSON primitives only**, never a raw `UUID`.
  - **Orphans are deduped by `node_id`** (insertion-ordered), because a
    field losing two options yields two destructive changes; the ack pane
    counts fields, not changes.
  - The orphan message drops the `acknowledge_orphans=true` leak and the
    UUIDs (they now ride in `details`).
  - `TemplateDiscardRefusalDetails` is declared as a real model and
    attached via `responses={409: {"model": ApiResponse[...]}}` on the
    route, so the payload reaches `schema.d.ts` as a typed union instead
    of `unknown`.
- **D2 — Fold the count-gate fix.** `_pending_change_count` gates on
  `not baseline_is_restorable(...)` instead of `snapshot_is_narrow(...)`,
  so an empty baseline yields a real count. Consequence:
  **`discard_available ⇒ pending_change_count is an int`**, and the UI
  drops the "unknown count" copy variant entirely.
- **D3 — Client error type, not the transport type.** T2 defines a
  slice-local `TemplateDiscardRefusal extends Error` exported from
  `templateService.ts` (mirroring `PgError`'s discipline — a plain `Error`
  subclass passes through `toResult` untouched) carrying `code` and a
  **runtime-validated** `orphans: {nodeId, label}[]`. `ApiError` stays
  inside the service. Malformed entries are dropped, never rendered.
- **D4 — Four-state dialog, mounted per open.** The host keeps only
  `discardOpen` and renders `{discardOpen && <TemplateDiscardDialog … />}`
  (the pattern already used at `TemplateConfigEditor.tsx:312-323`), so the
  phase and every server payload are local and cannot survive a close —
  otherwise the next open reopens on the stale result pane. Inside:
  `phase: 'confirm' | 'ack' | 'refused' | 'result'`, one shared
  `submitting` flag, `preventDefault` on the action so a refusal switches
  pane without a remount. `kept` empty ⇒ close + toast; `kept` non-empty ⇒
  the result pane, which must say the template is **still in draft**.
- **D5 — Branch on code, with a fifth outcome.** Each known refusal maps
  to a **local copy key**; an unknown code, a non-409 status, or a
  transport failure renders a generic `discardFailedGeneric` and stays on
  the confirm pane, with the server message only in `console.error`.
  Server prose is a last-resort fallback, never the contract — a 500 or an
  offline fetch must not be framed as a deliberate policy refusal.
- **D6 — Four-way tooltip, resolved in order**: (1) status still loading →
  the neutral action description, never a reason; (2) `!has_pending_changes`
  → "nothing to discard"; (3) `!discard_available && active_version == null`
  → "nothing has been published yet"; (4) `!discard_available` → "the
  published version is too old to restore from". Enabled predicate stays
  `discard_available && has_pending_changes`.
- **D7 — `invalidateAfterDiscard`** = `invalidateStructure()` +
  `templateInstructionKeys.byTemplate`. **Not** `runsKeys.all` or
  `templateActiveStructureKeys` — a discard leaves the active version
  untouched, so those stay correct and refetching the runs tree would be
  waste. Added as a fourth member of `useTemplateConfigCaches`, and T2
  **updates the five test files** that mock its return.
- **D8 — The editor migration keeps three branches.** `useTemplateEntityTypes`
  gains `isPending` (matching `useActiveTemplateStructure`); the editor
  renders spinner / **explicit error surface** / grid, and **never** the
  "no sections configured" empty state unless the query actually succeeded
  with zero rows. The imperative loader's `toast.error` behaviour must not
  be silently dropped.
- **D9 — Kept reasons are exhaustive at compile time and defensive at
  runtime**: `const KEPT_REASON = {…} satisfies Record<DiscardKeptNode['reason'], string>`
  (so regenerating types breaks the build on a new reason) plus a
  `?? discardKeptReasonOther` fallback. Each row also renders `node_kind`
  as a section/field marker.
- **D10 — The instruction warning is conditional**, gated on the cached
  `useTemplateInstruction` value being non-empty (`TemplateInstructionRow`
  already mounts that query on the same screen with the same key — a free
  cache read). Warning of a loss that will not happen is exactly what the
  confirm pane exists to avoid.
- **D11 — Honest copy.** A documented backend gap
  (`project_templates.py:299-303`) means a wide-but-older baseline can
  rewrite columns the diff does not count, so the confirm says "N
  unpublished changes" and never promises a precise inventory; the result
  pane reports what happened.

## Tasks (subagent-driven, TDD per task)

**T1 — Structured refusals + the count gate (backend)**
D1 + D2. Delete the 409 `except` block; convert the five refusals to
`AppError` subclasses with the new enum; declare
`TemplateDiscardRefusalDetails` + attach `responses={409: …}`; dedupe
orphans by `node_id`; drop the parameter leak from the message (update the
one assertion that reads `str(field)` to read the label);
`_pending_change_count` gates on `baseline_is_restorable`.
Tests — **at the ASGI level, not just the service**: one orphan case
asserting `status == 409`, `error.code == "ORPHAN_ACK_REQUIRED"` and
`error.details.orphans` non-empty with **string** `node_id` + `label`; one
hard refusal asserting its distinct code and `details is None`; one case
proving a field with two removed recorded options yields **one** orphan
entry; one proving an empty baseline now returns an integer count.
Regenerate `frontend/types/api/{openapi.json,schema.d.ts}`.

**T2 — Service + cache contract (frontend)**
D3 + D7. `discardTemplateDraft(projectId, templateId, {acknowledgeOrphans})`
returning `ErrorResult<DiscardDraftResponse>`, mapping a 409 to
`TemplateDiscardRefusal` with runtime-validated orphans;
`invalidateAfterDiscard` **plus the five `useTemplateConfigCaches` mock
sites**; a focused hook test for the invalidation pair (no such test file
exists — mirror `frontend/test/hooks/useTemplateInstruction.test.tsx:72`).

**T3 — Editor state migration (frontend)**
D8. Replace the imperative `entityTypes` with `useTemplateEntityTypes`
(+ `isPending`), delete the loader, the five hand-refreshes and the dead
`loadTemplateEntityTypes`/`EntityTypeWithCount`. RED tests: a failed
entity-types query must **not** render "No sections configured"; and one
case with a real `QueryClient` asserting the header badge recomputes after
`templateEntityTypesKeys.byTemplate` is invalidated (the claim D8 rests
on, currently unasserted anywhere).

**T4 — Button + dialog (frontend)**
D4, D5, D6, D9, D10, D11; all copy in `templateConfig.ts`. Extend
`TemplateConfigPublish.test.tsx` (its `status()` fixture at `:46-56` must
gain `discard_available`): the **four** tooltip/disabled states, the happy
path, the two-POST ack round trip (second body `{acknowledge_orphans: true}`),
each hard refusal keeping the dialog open with its **local** copy, the
generic fifth outcome on a 500, `kept` non-empty rendering the result pane
with the chip still reading Draft, and reopening after a result pane
landing on `confirm`.

**T5 — Slice close**
Adversarial review (pinned to commits) → fixer → `make quality-scan` +
`make test-backend` (serial) → browser pass (draft → Discard → chip back
to "Published · vN") → PR + auto-merge + watcher + memory.

## Verification gates

RED before GREEN; ruff/eslint/tsc clean; no new fitness offenders; backend
suites never concurrent. **Frontend suite with the worktree `.env` moved
aside** (CI parity). **Backend tests must not assume `python -m app.seed`
ran** — the autouse SEED fixture skips
`backfill_llm_template_instructions` (cost a CI cycle in B-9c1).

## Non-goals

The Publish sheet (B-9b); History/Restore (B-9e); the editor lock (B-9f);
§6 reopen (B-9g); narrow-snapshot backfill (B-9x); a preview endpoint for
the discard inventory; localising server messages; **a Discard E2E** —
there is no existing safety net for the command bar and the fixture would
need an instance-owning kept node; recorded as a gap.
