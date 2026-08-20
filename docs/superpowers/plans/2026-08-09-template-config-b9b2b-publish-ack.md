---
status: draft
last_reviewed: 2026-08-09
owner: '@raphaelfh'
---

# Template config B-9b2b — the publish contract

> **For agentic workers:** REQUIRED SUB-SKILL: use
> `superpowers:subagent-driven-development` task by task. Built from a
> structural map (Explore, 2026-08-09) against dev @ `7f620495`, and from
> the "Non-goals" block of
> `docs/superpowers/plans/2026-08-09-template-config-b9b2a-diff-read.md`,
> which enumerates what was deferred here.

B-9b2a shipped a **read-only** diff sheet. This slice makes Publish honour
it: what the manager saw is what gets published, or the publish refuses.

## The threat model (why this is not just a checkbox)

The sheet is computed **lock-free** — `get_template_config_diff` documents
this deliberately (`project_templates.py:402`: *"Read-only, and takes no
locks: a row that moves under it is a re-fetch, not a corruption"*).
Between render and click, three things can move, and they fail differently:

1. **The tree changes.** Another manager edits the draft. Different rows.
2. **A row moves with no tree change.** Two of the tier escalations
   (`field_type` with values `template_diff.py:535-536`, `MOVED` with
   values `:484`) key off `fields_with_values`, resolved lock-free at
   `template_version_read_service.py:132-138`. The third (`allow_other`
   turned off, `:533-534`) does **not** — but its row is still
   value-dependent, through `affects_recorded_data`
   (`template_diff_read.py:99-124`). Either way, a reviewer recording one
   answer mid-sheet can change what the manager is looking at **without
   touching the template at all**.
3. **The baseline moves.** A concurrent publish creates a new active
   version. The live tree is byte-identical, so a hash *of the tree* still
   matches — while every row in the diff is now wrong.

(3) is why the fingerprint covers the **projection**, not the snapshot.
(2) is why acks are `(id, tier)` pairs and not bare ids: tier is
deliberately **not** part of the composite id (`_row_id`,
`template_diff_read.py:192-201`), so an escalated tier reads as a *missing*
ack on the service path that carries no fingerprint.

### What this slice does NOT close, stated precisely

Recomputing under the publish locks closes the **render→click** window —
minutes of human deliberation. It does **not** close the window *inside*
the publish transaction, and it cannot: `take_advisory_xact_lock` has
exactly three call sites (`template_version_service.py:274`,
`hitl_session_service.py:217`, `run_lifecycle_service.py:256`), and
**none of them is the value-write path**. `extraction_proposal_service`
writes `ExtractionProposalRecord` / `ExtractionReviewerDecision` — two of
the five tables `fields_with_recorded_work` unions — while taking no
advisory lock and never touching the template row. Under READ COMMITTED a
reviewer's answer can therefore commit after our recompute reads and
before we commit, so the published version can carry a tier assessment
that was true microseconds earlier.

Do not paper over this. Serialising it would mean making every reviewer
write take the per-`(article, template)` advisory lock, which is a
throughput decision for a different slice. The honest claim is: *the
contract is evaluated as of the moment the publish transaction reads,
under locks that freeze the template tree and the run set.* Note the
narrowest destructive case is closed anyway by the database — a field
holding recorded work cannot be deleted at all (all five `field_id` FKs
are `ON DELETE RESTRICT`, pinned by
`test_template_config_diff.py:338`).

## Ratified rulings

**D1 — Acks are required for DESTRUCTIVE rows only.** Spec §1: *"additive/
cosmetic pre-approved · semantic rows expand-to-view · destructive rows
require per-item ☑ ack"*. Not a judgement call; do not widen it.

**D2 — The ack check lives in `republish`, immediately after
`acquire_publish_locks` returns — NOT inside that helper.** The brief said
"inside"; the map refutes it. `acquire_publish_locks` has four callers
(`template_version_service.py:139`, `template_discard_service.py:238`,
`template_restore_service.py:294`, `template_clone_service.py:141`) and the
last three have no acks and must never acquire ack semantics. Putting the
check in `republish` at the existing `fail_if_pending_draft` slot
(`:141-156`) holds **exactly the same locks** — that block already
re-reads under the row `FOR UPDATE` with the comment *"callers' unlocked
pre-checks are TOCTOU-racy"*. Identical guarantee, zero blast radius.

**D3 — Every new service parameter is keyword-only with a default.** There
are 4 production call sites (3 of them inside `template_clone_service`),
1 shared test helper, and **27 direct test call sites**. A required
parameter breaks all of them for no benefit. The endpoint is the untrusted
surface and enforces the protocol; the service enforces the invariant only
when asked, exactly like `fail_if_pending_draft`.

**D4 — Enforcement is server-side and unbypassable from the endpoint.**
The client's acks are checked against the diff the server **recomputes
under the lock**, never against the client's own view. Sending
`acknowledged: []` therefore refuses; it does not skip the check.

**D4a — Enforcement is driven by an explicit flag, never inferred from
"did the client send something" (panel, 2026-08-09).** The first draft of
this plan armed the check "when any of those is supplied", which — with
D3's defaults — meant a bodyless `POST` published destructive changes with
no check at all. That is not a hypothetical: the endpoint takes no body
today (`project_templates.py:234-240`), `templateService.ts:126-128`
posts `{method: 'POST'}`, and `TemplateConfigPublishControls.tsx:92-108`
fires Publish from the command bar while the sheet is mounted only on
open — so **the shipped product path never fetches a diff**. Therefore:

- the endpoint declares a **required** body model,
  `RepublishTemplateVersionRequest`, matching the house pattern of the
  sibling `discard_template_draft` (`project_templates.py:297`, a required
  body whose fields are all defaulted, so a bodyless POST 422s);
- `expected_fingerprint` is `str | None` *inside* that required body —
  it cannot be non-optional, because `INITIAL_VERSION` and
  `BASELINE_TOO_OLD` carry no fingerprint (T2) and `republish` explicitly
  supports the first-ever publish (`template_version_service.py:186-206`);
- the service gains `enforce_publish_contract: bool = False`
  (keyword-only, the `fail_if_pending_draft` precedent). The endpoint
  always passes `True`; the four internal callers keep the default. With
  the flag on and the under-lock recompute `AVAILABLE`, a `None`
  fingerprint is itself a refusal.

**D4b — `BASELINE_TOO_OLD` cannot be ack-gated, by construction.** No
diff is computable against a narrow pre-0026 baseline, so there are no
rows and no acks; the publish proceeds unguarded. This is not a hole worth
plugging: `republish` builds the new version from **live rows**
(`template_version_service.py:177`), so the very next publish heals the
baseline and every publish after it is fully gated. Say so in the code.

**D5 — The fingerprint canonicalises its own input; the wire order is left
alone (revised after the panel).** `SNAPSHOT_SQL` orders by `sort_order`
with no tiebreak (`extraction_snapshot.py:82`, `:88`) and `sort_order` is
not unique, so row order is unstable — harmless for a read-only view,
fatal for a fingerprint. The first draft fixed this by sorting the rows in
`with_recorded_data`, i.e. on the wire. That was wrong twice: it changes
the display order of a **shipped** B-9b2a endpoint (turning its
phase-ordered destructive bucket into raw-UUID order, and turning an
existing green test red for no behavioural reason), and it is redundant —
T2's own requirement that "reordering the input rows does not change the
hash" is only satisfiable if `fingerprint()` canonicalises internally
anyway. So: canonicalise **inside** `fingerprint()`, sorting by the
composite id, which is provably unique (`test_template_diff_read.py:153`).
Do **not** sort by `(label_path, attribute, option_code)`: nothing
enforces unique section labels, so it ties. Nothing on the wire changes,
and no client re-derives the hash (D4).

**D6 — `fields_with_values` is covered transitively; do not hash the raw
set.** The brief asks for it explicitly, and the reason it gives is threat
(2) — but tier and `affects_recorded_data` are *already* in the projection,
so an escalation that matters already changes the fingerprint. Hashing the
raw set instead refuses on any reviewer answer anywhere in the template,
including ones that move no row the manager saw. In a multi-reviewer HITL
system that is a publish that can rarely land. **Open for the panel to
overturn**; if overturned, hash the sorted set and accept the refusal rate.

## Tasks

Each task states its failing test first. Interleave tests — never batch.

### T1 — The fingerprint (absorbs the old T1; the wire is untouched)

`template_diff_read.fingerprint(active_version_id, rows) -> str`: sha256
over canonical JSON of `[str(active_version_id), sorted_rows…]`, sorting
by composite id **inside the function** (D5).

- **Failing tests** (`test_template_diff_read.py`): (a) changing **only**
  a tier changes the hash; (b) changing **only** `active_version_id`
  changes the hash; (c) shuffling the input row order does **not** change
  it — build the fixture so two rows share a `sort_order` *and* a
  duplicate section label, which is the case a `(label_path, …)` sort
  would tie on; (d) the hash is stable **across processes** — assert by
  spawning a subprocess with a different `PYTHONHASHSEED` and comparing,
  which is what catches an accidental `hash()`/set-iteration dependency.
- Prove (c) by **mutation**: remove the internal sort, require N/N
  failures across shuffles.
- The existing B-9b2a wire-order test must stay green — it is the guard
  that this task did not leak onto the endpoint.
- Surface it on `TemplateConfigDiffRead` (`hitl_session.py:345`) as
  `fingerprint: str | None` — `None` for the non-`AVAILABLE` statuses,
  which carry no rows to ack.
- ⇒ regenerate `frontend/types/api/` **in the same commit** (api-contract).

### T2 — Migration 0052: the version note

Add `note: Mapped[str | None]` to `ExtractionTemplateVersion`
(`models/extraction_versioning.py`) **first** — the project rule is model
change ⇒ `alembic revision --autogenerate`, not a hand-written DDL.

- Revision id `0052_template_version_note` (26 chars ≤ 32).
- Bump the head pin at `test_migration_roundtrip.py:1095-1097` **and** the
  `Migration head:` line + `last_reviewed` in
  `docs/reference/extraction-hitl-architecture.md:137-140` — same commit.
- The note is version **metadata**, not part of the snapshot payload: do
  **not** add it to `SNAPSHOT_SQL`'s key set, and mind the warning at
  `extraction_snapshot.py:36-44` that migration 0026 embeds a copy of that
  set. `run_lifecycle_service.py:834-865`'s `on_conflict_do_update` sets
  only `is_active` and needs no change.
- **Failing test**: roundtrip head assertion, plus `downgrade -1`.

### T3 — The publish contract, server side

`republish(..., *, enforce_publish_contract: bool = False,
expected_fingerprint: str | None = None,
acknowledged: Sequence[TemplateChangeAck] = (),
note: str | None = None)` (D3, D4a).

Placement: after `acquire_publish_locks` (D2) and after the existing
`fail_if_pending_draft` block, but **before** the
`config_draft_since = NULL` UPDATE at `:172-176` — a refusal must not
leave the draft marker cleared for a publish that never happened.

When `enforce_publish_contract` is on: recompute the diff under the lock
and refuse on the first violation, in this order:

1. status is `AVAILABLE` and (`expected_fingerprint is None` or it differs
   from the recomputed one) ⇒ `PUBLISH_DIFF_DRIFTED` (spec §8's *"publish
   diff drift (sheet recompute prompt)"*), details carrying the fresh
   fingerprint so the client re-renders without a second round trip.
2. any DESTRUCTIVE row lacking a matching `(id, tier)` ack ⇒
   `PUBLISH_MISSING_ACKNOWLEDGEMENT`, details naming every offending row
   id, sorted by composite id (mirror
   `_refuse_if_one_section_has_multi_entries`, which already names every
   offender in a stable order).

Note the consequence of that order, and do not fight it: a tier that
escalates mid-flight changes the fingerprint too (tier is part of the
projection), so the **fingerprint** refusal is what a real client sees.
That is the better outcome — it drives exactly what T5 mandates: re-render,
clear every tick, re-ack. The `(id, tier)` pair still earns its place on
the fingerprint-less service path D3 preserves.

On the changed path, **assign the note to the new version row** — it is the
only field this slice persists, and nothing else writes it.

- **Failing tests (integration, the real DB — these are the slice):**
  - concurrent publish moves the baseline, live tree untouched ⇒ refused;
  - tier escalates mid-flight (record a field value between the read and
    the publish) ⇒ refused as `PUBLISH_DIFF_DRIFTED`;
  - acks that match ⇒ publishes v+1, marker cleared, **and the note round
    trips** (`SELECT note` on the new row);
  - `acknowledged: []` with a destructive row ⇒ refused (D4);
  - a refusal leaves `config_draft_since` **set** (placement guard);
  - a caller passing nothing (the clone paths) ⇒ unchanged behaviour,
    proving D3's zero blast radius.
- **Endpoint**: required `RepublishTemplateVersionRequest` body (D4a);
  update the three bodyless POSTs in `test_template_version_republish.py`
  (`:806`, `:829`, `:856`) and the frontend caller.
- **Direct endpoint-coroutine unit tests** for each refusal — the ASGI
  blind spot means integration alone will not cover the handler lines.
  Additionally: one **ASGI POST carrying a real body**, because the
  existing unit test stubs `republish` with a bare `AsyncMock`
  (`test_template_clone_endpoint.py:139`) that would accept an endpoint
  which silently forwards nothing. (A *misspelled* kwarg is already caught
  — the strict mypy ratchet flags `call-arg`, and there is no such
  baseline entry for this file — but "forwards nothing" type-checks clean.)

### T4 — The no-op publish hole

`republish` returns the **existing** version when the snapshot is identical
(`:189-205`), so a note supplied on a no-op has no row to land on and is
currently dropped in silence.

Ruling: a no-op publish with a note **refuses** (`PUBLISH_NOTE_ON_NOOP`)
rather than inventing a version row or silently discarding operator intent.
A no-op *without* a note keeps today's behaviour exactly.

- **Failing tests**: note + no-op ⇒ typed refusal, nothing written; no note
  + no-op ⇒ `changed=False`, still re-pins (the existing test must stay
  green).

### T5 — Frontend: acks, note, and the drift phase

- Destructive rows get a checkbox; Publish stays disabled until all are
  ticked. Additive/cosmetic/semantic unchanged (D1).
- Optional note field.
- **The drift phase clears every tick on each recompute.** Key the ack
  state on the fingerprint: a refetch with a new fingerprint resets the set
  to empty. Silently keeping ticks across a recompute is the whole bug this
  slice exists to prevent.
- `PUBLISH_DIFF_DRIFTED` ⇒ re-render the sheet from the fresh fingerprint
  in the error details and tell the user what happened; never a bare toast.
- All copy through `frontend/lib/copy/`. No `try/finally` in component
  bodies (React Compiler `panicThreshold: all_errors`).
- **Failing tests** (`TemplateConfigPublish.test.tsx`, near its size
  ceiling — split if it grows): ticks clear when the fingerprint changes;
  Publish disabled with an unticked destructive row; drift refusal
  re-renders.

## Explicitly NOT in this slice

- **The second publish path stays open — but it cannot bypass an ack.**
  `RunLifecycleService._snapshot_initial_version` (`:801-870`) mints an
  active v1 from live rows *including a pending draft*, with no advisory
  locks, no many->one re-check, and it does not clear the marker
  (`:826-832`; pinned by `test_template_config_draft_marker.py:271`).
  The panel established the bound: it runs only when there is no active
  version, and that state short-circuits the diff to `INITIAL_VERSION`
  (`template_version_read_service.py:121-122`), which by construction
  carries **zero destructive rows** — and a template with no version has
  no runs, so nothing holds recorded work. Its upsert (`:848-863`) sets
  only `is_active`, so it can never overwrite an existing snapshot. The
  gap is therefore real but narrow: it publishes a draft the manager did
  not confirm, it cannot strand recorded answers. Closing it is B-9x's;
  do not close B-9x while it is open.

- Reconciling the two "recorded data" predicates
  (`template_diff_read._affects_recorded_data` vs
  `template_discard_service._entity_types_with_instances`) — D6 of B-9b2a,
  still unreconciled.
- The clone endpoint flattening typed refusals into
  `HTTPException(409, str(e))` (`project_templates.py:112-121`) — any new
  refusal code raised through the clone path loses `code`/`details`. Left
  as-is deliberately (B-9b0 D3); revisit with B-9g.
- History display of the note (B-9e), the editor lock (B-9f), §6 reopen
  (B-9g), the narrow-snapshot audit (B-9x).
- The chip and the sheet still compute different tiers for the same tree
  (`_pending_change_count` passes `resolve_values=False`,
  `template_version_read_service.py:191-193`). Only `.total` is consumed
  today, so nothing is wrong — it becomes wrong the moment anything
  cross-checks the two by tier.
