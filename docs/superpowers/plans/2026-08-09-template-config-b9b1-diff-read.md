---
status: draft
last_reviewed: 2026-08-09
owner: '@raphaelfh'
---

# Template config B-9b1 — the diff read surface + typed publish refusals

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development task-by-task. Built from a
> structural map (Explore, 2026-08-09) against dev @ `a5a0dcfb`
> (B-9a, B-9c1, B-9c2 merged). Spec: §1 of
> `docs/superpowers/specs/2026-08-05-template-config-ux-redesign-design.md`.

## Why B-9b is two slices

The Publish sheet's whole risk is two decisions — **what identifies a
change** (a checkbox needs a key) and **what detects that the tree moved
under the acked diff** (a fingerprint). Neither can be TDD'd honestly
from inside a UI task, and both are reviewable on their own. So:

- **B-9b1 (this plan)** — the read surface: stable per-change ids, a
  shared value-presence resolver, `GET config-diff`, and typing the
  publish refusal. No UI; the Draft chip already proves the engine.
- **B-9b2** — migration 0052 (`note`), the `republish` signature change
  with ack re-validation and the fingerprint, and the sheet itself.

## Load-bearing facts (verified 2026-08-09)

- **There is no stable per-change id.** `TemplateChange`
  (`template_diff.py:180-206`) carries `kind/node_kind/tier/label_path/
  node_id/attribute/before/after`. One field can emit N changes — one per
  attribute (`_diff_field_attributes:433-447`), one per added/removed
  option (`_diff_options:483-513`), plus a MOVED row (`:404-418`) — and
  the two option changes share `(node_id, attribute)`, differing **only**
  in `before`/`after`. `node_id` is `UUID | None`: null for the
  template-instruction change.
- **`before`/`after` are overloaded three ways** (documented `:182-190`):
  raw values for MODIFIED; the single option code for `allowed_values`;
  **parent labels** for MOVED; and for REORDERED `after` is a sibling
  **count**. A generic "before → after" renderer prints `after: 7` for a
  reorder.
- **`label_path` is `()` for the instruction change**
  (`_diff_instruction:302-317`) ⇒ `change.label == ''`.
- **`config_draft_since` does NOT advance** — both stamp paths use
  `COALESCE(config_draft_since, now())` (`0048:92-93`, `:98-99`). It
  records when the draft opened, never when it last changed, so it is
  useless as a change detector (this matters for B-9b2's fingerprint;
  recorded here so nobody re-derives it).
- **`_fields_referenced_by_the_workflow`** (`template_discard_service.py:471-489`,
  one `union()` over the five RESTRICT tables at `:143-149`) is
  module-private and takes explicit ids. `template_discard_service.py:108`
  imports from `template_version_read_service`, so a diff read living in
  the read service that imports back would be an **import cycle** — the
  helper must move to a neutral module.
- **Only ONE publish refusal can reach the Publish button.**
  `PublishBlockedByMultiEntryError` (`template_version_service.py:51-63`,
  raised `:281-285`) is caught at `project_templates.py:246-250` →
  `HTTPException(409, str(e))` ⇒ `code: "HTTP_ERROR"`, no `details`.
  `PendingConfigDraftError` fires only under `fail_if_pending_draft=True`,
  which the republish endpoint does **not** pass (`:239-243`) — it belongs
  to the clone self-heal path. Its message **names the section label**
  (`:282-284`), so a purely static copy key cannot replace it.
- Endpoint home `project_templates.py` (383 lines, not in the file-size
  baseline); `discard-draft` at `:268` is the repo's **only** declared
  `responses=` (B-9c2) — without it a payload types as `unknown`.
- Removed fields/sections **provably hold no recorded data** — the five
  `field_id` RESTRICT FKs and `extraction_instances_entity_type_id_fkey`
  refuse the delete otherwise (`template_field_service.py:250-260`).
- **The wide-but-older baseline gap** (`project_templates.py:302-306`):
  a baseline predating a column normalizes the absent key to the column
  default, so `diff_snapshots` reports **no change** while a publish
  rewrites it. `snapshot_is_narrow` catches only whole-era pre-0026
  shapes.
- The chip's count passes `fields_with_values=frozenset()`
  (`template_version_read_service.py:99`); the sheet will pass the real
  set. The **total is identical** either way — the value set shifts tiers,
  never adds or removes changes.
- The "~1.8 ms" figure quoted in B-9a's PR was measured by its T2 agent
  but never recorded in a plan; treat it as unverified and re-measure.

## Decisions (proposed; panel to ratify)

- **D1 — Deterministic change ids, minted server-side.** `TemplateChange`
  gains an `id` derived as a stable hash (sha256, truncated) over
  `(kind, node_kind, node_id, attribute, before, after)` — the tuple that
  is provably unique per change. Derived, not persisted, so it survives
  B-9b2's re-validation round trip without storage. Unit tests pin: the
  same tree twice ⇒ identical ids; two option removals on one field ⇒ two
  distinct ids; the instruction change (null `node_id`) ⇒ a stable id.
- **D2 — A discriminated wire model, not raw `before`/`after`.**
  `TemplateDiffRead` renders each change with its kind explicit, so the
  client never has to know that `after` means "sibling count" for a
  reorder or "parent label" for a move. Reorder carries `sibling_count`;
  move carries `from_label`/`to_label`; options carry the option code.
  The instruction change carries an explicit node kind so the client can
  label a row whose `label_path` is empty.
- **D3 — Promote the value-presence resolver.** Move
  `_fields_referenced_by_the_workflow` to a neutral module (its own
  `template_value_presence.py`), re-point the discard service, and let
  the diff read use it. This breaks the import cycle rather than
  duplicating the union.
- **D4 — `GET .../config-diff`** in `project_templates.py`, manager-gated,
  `ApiResponse[TemplateDiffRead]`, **with `responses=`** so the payload is
  typed rather than `unknown`. It resolves the **real** `fields_with_values`
  (unlike the chip's count), so tiers are accurate. Idempotent and
  side-effect free.
- **D5 — Type the publish refusal.** Mirror B-9c2 D1: a slice-local
  `TemplatePublishRefusalCode` StrEnum next to
  `TemplateDiscardRefusalCode` (**not** added to the global
  `ApiErrorCode`), `PublishBlockedByMultiEntryError` becomes an
  `AppError` subclass, the `except` at `project_templates.py:246-250` is
  **deleted** so it reaches `app_error_handler`, and `responses={409: …}`
  is declared. Because the message names a section, the details payload
  carries `section_label` so the client can compose its own sentence
  instead of echoing prose. `details` must be JSON primitives only —
  `app_error_handler` does **not** `jsonable_encoder` (B-9c2's blocking
  finding).
- **D6 — Honesty flags on the read, decided here so B-9b2 cannot dodge
  them.** `TemplateDiffRead` carries:
  - `inventory_complete: bool` — false when the active baseline predates
    a snapshot column (the wide-but-older gap), so the sheet must show a
    scope disclaimer instead of claiming a complete per-row inventory.
    **This is the biggest structural lie available in B-9b**, and the
    read surface is where it gets named.
  - per-change `affects_recorded_data: bool` — the tier already encodes
    it, but the sheet cannot say "this touches answers reviewers gave"
    without it, and a removed node provably has **none** (RESTRICT), so
    the two must be distinguishable.
- **D7 — Do not re-tier anything here.** `MOVED_WITHOUT_VALUES_TIER`
  (`template_diff.py:170-178`) is a knowingly-flagged coin flip between
  B-9a's D2 (semantic) and its own T1 checklist (cosmetic). B-9b2 decides
  it against the rendered sheet; this slice only surfaces it. Same for
  the option-rename problem (remove+add in two buckets) — a wording
  problem the sheet owns.

## Tasks (subagent-driven, TDD per task)

**T1 — Change identity + the discriminated read model (backend, pure)**
D1 + D2 in `template_diff.py` and `schemas/`. Unit tests only (no DB):
identity stability and collision cases; a renderer-facing assertion per
change kind proving the wire model needs no knowledge of the
`before`/`after` overloading; the empty-`label_path` instruction case.

**T2 — Value-presence promotion + `GET config-diff` (backend)**
D3, D4, D6. Move the resolver, re-point the discard service (its tests
must stay green), add the endpoint with `responses=`, fill
`inventory_complete` and `affects_recorded_data`. Integration tests: a
draft with all four tiers; a field with recorded values flipping a tier
versus the chip's count (and the **total** matching the chip either way);
an older-era baseline ⇒ `inventory_complete: false`; BOLA; a
coroutine-level test for the ASGI shape. **Re-measure the cost** and put
the number in the PR rather than repeating an unverified one.

**T3 — Typed publish refusal (backend)**
D5. Delete the `except`, convert the error, declare `responses=`, carry
`section_label`. **ASGI-level** tests asserting the envelope
(`error.code`, `error.details.section_label`) — a service-level
`pytest.raises` proves an attribute, not the wire (B-9c2's blocking
finding). Update the client wrapper and `useTemplateRepublish`'s toast to
branch on code with a local copy key, keeping a generic fallback.
Regenerate `frontend/types/api/{openapi.json,schema.d.ts}`.

**T4 — Slice close**
Adversarial review (pinned to commits) → fixer → `make quality-scan` +
`make test-backend` (serial) → a scripted call showing the diff payload
for a real multi-tier draft (no UI in this slice) → PR + auto-merge +
watcher + memory.

## Verification gates

RED before GREEN; ruff/eslint/tsc clean; no new fitness offenders;
backend suites never concurrent. Frontend suite with the worktree `.env`
moved aside if any frontend file changes. **Backend tests must not assume
`python -m app.seed` ran** — the autouse SEED fixture skips
`backfill_llm_template_instructions`.

## Non-goals

The sheet, the per-item ack round trip, the fingerprint, migration 0052
and the version `note` (**all B-9b2**); the runs/reopen section (§6 /
B-9g); History (B-9e); the editor lock (B-9f); narrow-baseline backfill
(B-9x); re-tiering moves or solving the option-rename wording (B-9b2).
