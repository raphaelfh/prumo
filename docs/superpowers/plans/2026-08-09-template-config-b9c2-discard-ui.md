---
status: draft
last_reviewed: 2026-08-09
owner: '@raphaelfh'
---

# Template config B-9c2 — Discard UI + structured refusals

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development task-by-task. Built from a
> structural map (Explore, 2026-08-09) against dev @ `4feee638`
> (B-9c1 merged — the Discard backend exists). Spec: §1 of
> `docs/superpowers/specs/2026-08-05-template-config-ux-redesign-design.md`.

## Why this slice needs a backend addendum

B-9c1 shipped `POST .../discard-draft` with a partial-discard policy, a
refusal taxonomy and an orphan-acknowledgement gate. The UI cannot render
any of it truthfully today:

- **The orphan list exists only as prose.** `OrphanAcknowledgementRequiredError`
  interpolates `label [uuid]` pairs and the literal string
  `acknowledge_orphans=true` into a message
  (`template_discard_service.py:600-606`); the endpoint raises
  `HTTPException(409, detail=str(e))` (`project_templates.py:322`), and
  `http_exception_handler` (`core/error_handler.py:221-243`) **never writes
  a `details` key**. The client pipe is fine — `ApiError` carries
  `.status/.code/.details` (`integrations/api/client.ts:31-36`, `:58-69`)
  and `normalizeError` passes subclasses through untouched
  (`lib/error-utils.ts:52-62`) — the backend simply never fills it.
- **All five 409s share `code: "HTTP_ERROR"`**, so "re-ask with the ack"
  and "hard refusal" are indistinguishable without sniffing backend prose.

Shipping the dialog on top of that means either leaking an API parameter
name and raw UUIDs to a manager, or branching control flow on English
strings. So this slice includes a tightly-scoped backend addendum first.

## Load-bearing facts (verified 2026-08-09)

- `TemplateConfigPublishControls.tsx` (117 lines) takes only
  `{projectId, templateId}` (`:24-27`), returns a **bare fragment**
  (`:94-116`) inside the command bar's `gap-2` right cluster
  (`TemplateConfigEditor.tsx:178-201`) — a Discard button slots in as a
  sibling before the Publish tooltip with no wrapper. It already holds
  `useTemplateConfigStatus` (`:33`) and `useTemplateRepublish` (`:34`).
- `DiscardDraftResponse` (`backend/app/schemas/hitl_session.py:89-107`)
  carries six counts, `draft_was_open`, `instruction_reset`, and `kept[]`
  — and each kept node **has a `label`** (`:78`), so no UUID ever needs to
  reach the screen. **`kept` non-empty ⇒ the marker survives and the
  template is still in draft** (`:106-107`).
- **There is no preview endpoint.** Before the click the client knows only
  `has_pending_changes`, `pending_change_count`, `active_version`,
  `discard_available`. `pending_change_count` can legitimately be `null`
  (`hitl_session.py:148-152`).
- `discard_available` (`template_version_read_service.py:68`) is the same
  gate the endpoint refuses on, and **carries no draft-marker term** — it
  is `true` on a clean published template.
- `useTemplateRepublish`'s helpers import three key factories
  (`:20-24`); **`templateInstructionKeys` is in none of them**. The single
  stale consumer after `instruction_reset` is
  `TemplateInstructionRow.tsx` (`:37`, `:47-50`, `:80`) via
  `useTemplateInstruction.ts:15-21`. Publish has no functional equivalent
  of this gap (republish never writes the instruction).
- `templateInstructionKeys` (`lib/query-keys/extraction.ts:56-59`) is the
  only factory in the file with **no `.all` member**.
- `TemplateConfigEditor`'s imperative `entityTypes` (`:39`, loader
  `:104-120`) is read in exactly three trivial places (`:159`, `:179-186`,
  `:206`/`:241`) and refreshed at five (`:125`, `:141`, `:147`, `:155`,
  `:334`) — **every refresh already sits next to an invalidation of
  `templateEntityTypesKeys.byTemplate`**. `TemplateConfigGridPanel.tsx:116`
  already runs `useTemplateEntityTypes(templateId)` for the same id, so
  the tab performs two overlapping reads. `TemplateConfigEditor.test.tsx`
  already mocks **both**.
- Dialog precedents: `DeleteFieldConfirm.tsx` (AlertDialog, impact block,
  **`event.preventDefault()` on the action so a refusal keeps the dialog
  mounted** `:189-195`) and `ReopenExtractionDialog.tsx:32-69` (body and
  action label switch on a count).
- Copy goes in `frontend/lib/copy/templateConfig.ts`; `extraction.ts` is
  pinned at 958 in the file-size baseline and may not grow. Plural
  precedent `draftChangeCountOne/Other` (`templateConfig.ts:29-30`).
- `frontend/test/TemplateConfigPublish.test.tsx` (12 cases) is the suite;
  its `status()` fixture (`:46-56`) omits `discard_available`, so existing
  cases will render Discard disabled (a safe default).
- **No E2E touches the Publish button at all**; the only config-tab spec
  is `template-import.ui.e2e.ts`.

## Decisions (proposed; panel to ratify)

- **D1 — Backend addendum: structured refusals.** Convert the discard
  409s to typed `AppError` subclasses with **stable codes**
  (`app_error_handler` already serializes `details`,
  `core/error_handler.py:186-218`): `ORPHAN_ACK_REQUIRED` carrying
  `details={"orphans": [{"node_id", "label"}]}`, plus distinct codes for
  cardinality, container-swap, narrow-baseline and raced. Server messages
  stay user-grade and are still rendered verbatim for hard refusals; the
  client branches on **code**, never on prose. Regenerate the API types.
  The orphan message stops interpolating `acknowledge_orphans=true`.
- **D2 — A four-state dialog** (mirroring `DeleteFieldConfirm`, using its
  `preventDefault` mechanism so the pane switches without a remount):
  1. **Confirm** — "Undo N unpublished changes and go back to vX", plus a
     third copy variant for `pending_change_count === null`, and the
     instruction warning. No promise of a precise inventory (see D7).
  2. **Orphan ack** — reached on `ORPHAN_ACK_REQUIRED`; lists the orphaned
     fields **by label** from `details`; destructive action re-posts with
     `acknowledge_orphans: true`.
  3. **Hard refusal** — server message verbatim, dismiss only
     (reuse `extraction.understood`).
  4. **Result** — rendered only when `kept.length > 0`: lists each kept
     node by label with its reason as a human sentence, and states that
     the template is **still in draft**. A bland "discarded" toast next to
     a still-lit Draft chip reads as a bug.
  When `kept` is empty: close and toast.
- **D3 — Enabled predicate is `discard_available && has_pending_changes`**,
  with three tooltips: available; "nothing to discard"; "the published
  version is too old to restore from" (the B-9x case). Never enable on
  `discard_available` alone.
- **D4 — A new `invalidateAfterDiscard`**, not an extension of
  `invalidateAll`: `invalidateStructure()` + `templateInstructionKeys.byTemplate`.
  Discard must **not** touch `runsKeys.all` or `templateActiveStructureKeys`
  — the active version is untouched by a discard, so those caches stay
  correct and invalidating them would refetch the whole runs tree for
  nothing.
- **D5 — Migrate the editor's imperative `entityTypes` to
  `useTemplateEntityTypes` (the map's option b), not a callback prop.**
  Net ~35 lines deleted, one duplicate network read removed, no new props,
  and the publish-controls child then needs nothing threaded into it.
  `loadTemplateEntityTypes` and `EntityTypeWithCount` become dead and are
  deleted. Without one of the two fixes the header's section count is
  stale after a Discard that deleted a section — a visible lie.
- **D6 — `kept` reasons render as sentences, never codes**
  (`has_recorded_data`, `related_to_kept_node`,
  `name_taken_by_kept_node`), including the "not restored, rename it and
  discard again" wording for the last one.
- **D7 — Honest copy.** A known backend gap (documented in
  `project_templates.py:299-303`) means a wide-but-older baseline can
  rewrite columns the diff does not count, so the confirm must not promise
  "exactly these N things and nothing else". Say "N unpublished changes"
  and let the result pane report what happened.
- **D8 — No new E2E.** There is no existing safety net for the command
  bar, and a Discard E2E needs a fixture with an instance-owning kept
  node. Vitest plus B-9c1's integration suite carry it; recorded as a gap.

## Tasks (subagent-driven, TDD per task)

**T1 — Structured refusals (backend, D1)**
Typed `AppError` subclasses + stable codes + `details.orphans`; endpoint
maps them; the orphan message drops the API-parameter leak. Extend
`backend/tests/integration/test_template_discard_draft.py`: every refusal
asserts its `code`, and the orphan case asserts `details.orphans` carries
`{node_id, label}` for each. Regenerate
`frontend/types/api/{openapi.json,schema.d.ts}`.

**T2 — Service, hook, cache contract (frontend, D4)**
`discardTemplateDraft(projectId, templateId, {acknowledge_orphans})` in
`templateService.ts` returning `ErrorResult<DiscardDraftResponse>` and
preserving the typed `ApiError` (code + details) across the boundary;
`invalidateAfterDiscard` in `useTemplateRepublish.ts`; a focused hook test
for the invalidation pair (no such test file exists today — mirror
`frontend/test/hooks/useTemplateInstruction.test.tsx:72`).

**T3 — Editor state migration (frontend, D5)**
Replace the imperative `entityTypes` with `useTemplateEntityTypes`; delete
the loader, the five hand-refreshes and the now-dead service fn; drop the
`loadTemplateEntityTypes` mock from `TemplateConfigEditor.test.tsx`.

**T4 — Button + dialog (frontend, D2/D3/D6/D7)**
The Discard button in the chip cluster and the four-state dialog, all copy
in `templateConfig.ts`. Extend `TemplateConfigPublish.test.tsx`: the three
tooltip/disabled states, the happy path, **the two-POST ack round trip**
(second body `{acknowledge_orphans: true}`), each hard refusal keeping the
dialog open with the verbatim message, and `kept` non-empty rendering the
result pane with the chip still reading Draft.

**T5 — Slice close**
Adversarial review (pinned to commits) → fixer → `make quality-scan` +
`make test-backend` (serial) → browser pass (create a draft, Discard,
watch the chip return to "Published · vN"; then a kept-node case if one
can be staged cheaply) → PR + auto-merge + watcher + memory.

## Verification gates

RED before GREEN; ruff/eslint/tsc clean; no new fitness offenders; backend
suites never concurrent. **Run the frontend suite with the worktree `.env`
moved aside** (CI parity). **Backend tests must not assume
`python -m app.seed` ran** — the autouse SEED fixture does not run
`backfill_llm_template_instructions` (this cost a CI cycle in B-9c1).

## Non-goals

The Publish sheet (B-9b); History/Restore (B-9e); the editor lock (B-9f);
§6 reopen (B-9g); backfilling narrow snapshots (B-9x); a preview endpoint
for the discard inventory (the result pane reports after the fact);
localising server messages.
