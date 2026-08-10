---
status: draft
last_reviewed: 2026-08-09
owner: '@raphaelfh'
---

# Template config B-9c1 — Discard draft: the snapshot→live writer

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development task-by-task. Built from a
> structural map (Explore) + a 3-lens adversarial panel (**20 findings,
> 6 blocking**, all folded) against dev @ `b0fcb218` (B-9a merged).
> Spec: §1 of
> `docs/superpowers/specs/2026-08-05-template-config-ux-redesign-design.md`;
> the B-9a plan's "Stale spec facts" still apply and are not repeated.

## Why this slice, and why backend-only

B-9c pays for the **inverse of `SNAPSHOT_SQL`** — a published JSONB
snapshot written back into live `extraction_entity_types` /
`extraction_fields` rows. B-9e's "Restore vN as draft" is the same writer
with a different source and a different marker policy; B-9d's
"deletes never confirm" leans on it. Building it inside History would
hide it; building it behind Discard exposes it with the simplest use
case.

**B-9c1** = writer + `POST .../discard-draft` + the refusal/report
taxonomy + telemetry + tests. **B-9c2** = the button, its dialog, and two
frontend wiring gaps the map found. The refusal taxonomy is only
discoverable by integration test against the real RESTRICT FKs, and the
UI cannot be written until each outcome has a message — a genuine
dependency, not padding.

## Load-bearing facts (map + panel, verified 2026-08-09)

- **Snapshot is a complete restore source**: entity keys
  `extraction_snapshot.py:52-61`, field keys `:65-81`, top-level
  `llm_template_instruction` emitted **only when truthy** (`:137-141`).
  Ids are preserved (`:53`, `:66`) — nothing needs remapping. Absent
  columns are derivable (`template_id` NULL for the project lineage,
  `project_template_id` from the path, `entity_type_id` from **nesting**)
  or cosmetic (`created_at`/`updated_at`).
- **Blunt delete-all-and-reinsert is impossible**:
  `extraction_instances.entity_type_id` RESTRICT
  (`extraction.py:470-474`) and five workflow tables with `field_id`
  RESTRICT (`extraction_workflow.py:89,140,220,326,412`).
- **`extraction_fields.entity_type_id` is ON DELETE CASCADE**
  (`extraction.py:371`). **This is the trap**: deleting a draft-added
  section destroys any *baseline* field the draft had moved into it.
- **Instances materialize from LIVE rows**:
  `hitl_session_service._project_entity_types:194-200` →
  `ensure_instances:107-114` → `_backfill_child_singletons:275-350`; also
  `ModelExtractionService` via `get_children` (`extraction_repository.py:217-239`).
  A draft-added section owns real instances as soon as any session opens.
- **`snapshot_is_narrow` returns True for an EMPTY entity-types list by
  design** (`extraction_snapshot.py:166-167`) — an empty published
  baseline is *wide and restorable*, not legacy.
- **`uq_extraction_fields_entity_type_name` (0050) is immediate and
  non-deferrable** (`extraction.py:420-428`); `extraction_fields.name`
  is an unconstrained `String` (the 50-char cap is application-level
  only), so a long transient park value is legal.
- **`ck_extraction_entity_types_role_parent` is immediate**
  (`extraction.py:338-342`); the role trigger
  (`0016:194-197`) is `DEFERRABLE INITIALLY DEFERRED` and **does not
  fire under the default test session**, which never commits — tests
  must `SET CONSTRAINTS ALL IMMEDIATE` (precedent
  `test_published_state_integrity.py:91-99`).
- **`_topologically_sorted` (`template_clone_service.py:290-332`) takes
  ORM rows, not snapshot dicts**, and SQLAlchemy will not honour insert
  order without level-by-level flushes.
- **The 0048 triggers are AFTER-ROW and unconditional** (`0048:113-122`),
  re-stamping on every write; `republish` clears the marker with a Core
  `update(...)` (`template_version_service.py:143-154`), which is the
  mechanism to copy — an ORM attribute set may be flushed early.
- **`acquire_publish_locks` (`template_version_service.py:222-263`)
  reduces but does not eliminate the race**: it locks only articles with
  runs in `pending|extract`, and advisory locks bind only cooperating
  writers — `ModelExtractionService` and the proposal writers take none.
- **`diff_snapshots` cannot drive the patch and cannot fully verify it**:
  it excludes `sort_order` (entity-type order is never compared at all),
  collapses removed sections, and reports options per code
  (`template_diff.py:105-132`, `:294-307`, `:369-371`, `:598-637`).

## Decisions (panel-ratified)

- **D1 — Comparison key set.** Identity is the node id. The writer
  compares the snapshot key set **plus two derived columns**:
  `entity_type_id` (from JSON nesting) for fields, and `sort_order` for
  **both** node kinds. `template_diff`'s canonical defaults
  (`ENTITY_ATTRIBUTE_DEFAULTS:105-114`,
  `FIELD_ATTRIBUTE_DEFAULTS:117-132`, `_normalize_entity:294-301`,
  `_instruction:329-331`) are imported for **defaults only** — they are
  not the comparison projection, because they omit exactly those two
  columns. Without this, a field the draft only *moved* or *reordered*
  compares byte-identical and Discard silently fails to undo it.
- **D2 — Phase order (the CASCADE-safe sequence).** One transaction,
  explicit `await db.flush()` between every phase:
  0. **Park** the `name` of every field in the update set — including
     fields whose only change is the parent — to `__restore_{uuid4().hex}`.
     (Parking must precede the create pass: a draft that deleted field
     `x` and renamed a sibling to `x` otherwise collides during create.)
  1. **Create** missing entity types, topologically. Materialize
     unflushed ORM objects first, pass *those* through
     `_topologically_sorted`, then add+flush level by level.
  2. **Re-parent** every surviving field to its baseline parent, so no
     baseline row sits under a section about to be deleted.
  3. **Delete** draft-added fields.
  4. **Delete** draft-added entity types, reverse-topologically.
  5. **Create** missing fields.
  6. **Settle** parked names and the remaining field attributes.
  7. **Update** survivor entity types.
  8. **Instruction**: reset `llm_template_instruction` from the
     baseline's top-level key with `absent ≡ null ≡ ""` (mirroring
     `template_instruction_service.py:66`).
  The marker is **not** the writer's business (D7).
- **D3 — Container swap is refused.** If the delete set contains a
  `model_container` while the create set also contains one, phase 1
  collides with `uq_extraction_entity_types_one_container_per_project`.
  Refuse with a typed `DiscardBlockedByContainerSwapError` (409),
  documented as a known gap rather than solved with a third phase.
- **D4 — Partial discard, not all-or-nothing.** A draft-added node that
  owns instances (or a draft-added field referenced by any of the five
  workflow tables) cannot be deleted. Refusing the *whole* Discard would
  make it permanently unavailable in the commonest draft shape — the
  spec sells Discard as the escape hatch for structural changes that
  have no per-change Revert. So: compute the **blocked set** up front
  (the offending nodes plus their subtrees), exclude it from the delete
  set, restore everything else, and **report what was kept**. The marker
  is cleared only when nothing was kept; otherwise the template stays in
  draft with a smaller draft.
- **D5 — Refusals (typed, 409 unless noted).** These abort the whole
  operation because restoring them would corrupt data:
  - `DiscardBlockedByCardinalityError` — a survivor update would lower
    `cardinality` from `many` to `one` while some parent instance holds
    ≥2 children. Reuse the shared `has_multi_entry_parent`
    (`template_section_service.py:206`); this is the same hazard the
    PATCH-time and publish-time guards already refuse, and Discard is
    the third door into it.
  - `DiscardBlockedByContainerSwapError` — D3.
  - `NarrowBaselineError` — **`entity_types and snapshot_is_narrow(entity_types)`**
    (an empty baseline is wide). Restoring a pre-0026 baseline would wipe
    `llm_description`/`allow_other` project-wide. Legacy templates get no
    Discard until **B-9x**; the message says so.
  - `NoActiveTemplateVersionError` (existing) → 404.
- **D6 — Value-orphaning updates need an explicit ack.** The claim that
  Discard "adds no new undo power over data" is **false for the update
  set**: removing a draft-added select option a reviewer already picked,
  or reverting a `field_type` on a field holding values, orphans or
  re-interprets recorded work — and `diff total == 0` cannot see it.
  The endpoint therefore resolves the **real** `fields_with_values` set
  (one grouped query, the same B-9b will use), asks
  `diff_snapshots` for `destructive`-tier changes touching it, and when
  any exist **without** `acknowledge_orphans=true` in the body, returns
  409 with the list. The client re-posts with the ack. This mirrors the
  spec's per-item ack for destructive publishes rather than inventing a
  new gate.
- **D7 — The writer does not touch the marker.**
  `restore_snapshot(db, *, project_id, template_id, snapshot)` is a pure
  reconcile. The **Discard service** clears `config_draft_since` last, in
  the same transaction, with a Core
  `update(ProjectExtractionTemplate).values(config_draft_since=None)`
  after the final flush (an ORM attribute set can be flushed early and
  then re-stamped by the 0048 triggers). B-9e's restore-as-draft caller
  simply does not clear it. **There is no "no draft open ⇒ no-op"
  short-circuit in the writer** — Restore-vN runs on clean templates, and
  a marker-NULL template whose live tree drifted is a real state; a
  genuinely identical tree costs three empty id sets.
- **D8 — Detection is advisory; the DB is authoritative.** Keep the
  up-front queries for good messages, but every delete phase also
  catches `IntegrityError` (23503 on the instance/workflow FKs) and
  `DeadlockDetected` (40P01), rolls back, and raises the **same** typed
  error — never continues issuing SQL. `acquire_publish_locks` is taken
  first (D9) and the plan states plainly that it narrows, not closes,
  the window.
- **D9 — Locks.** `acquire_publish_locks` verbatim, first statement of
  the transaction, before the detection queries.
- **D10 — Telemetry (this is the most destructive op in the stack).**
  The service captures `build_template_version_snapshot(live)` **before**
  writing and emits one structlog event with `project_id`,
  `template_id`, `user_id`, the prior `config_draft_since`, the
  deleted/created/updated counts, the kept set, and the discarded diff
  summary by tier — so an accidental Discard is reconstructable from
  logs. Every refusal emits a `warning` naming the type and the blocking
  node id.
- **D11 — Response.** `DiscardDraftResponse`: counts of
  deleted/created/updated entity types and fields, `draft_was_open: bool`,
  `kept: list[{node_id, label, reason}]` (D4), and whether the
  instruction was reset. No diff payload (B-9b owns that shape).
- **D12 — Availability must be visible before the click.**
  `TemplateConfigStatusRead` gains `discard_available: bool` (false for a
  narrow baseline), so B-9c2 disables the button with the right tooltip
  instead of discovering the refusal by clicking.

## Tasks (subagent-driven, TDD per task)

**T1 — The writer (service, backend)**
`backend/app/services/template_restore_service.py` implementing D1–D3,
D7's purity, D9. Integration tests (real DB — the RESTRICT FKs *are* the
subject), RED first.

Cases: label change; field added; field deleted (value-free); section
added; section deleted; **field moved INTO a draft-added section**;
**field moved OUT of a draft-deleted section**; reorder; **move that
renumbers two sections**; `entry_label`; instruction set and cleared;
**delete-plus-rename-into-the-freed-name**; two fields swapping names;
a draft that deleted a `model_section` *and* its container.

Every case asserts **all** of:
- `diff_snapshots(active.schema_, rebuilt, fields_with_values=frozenset()).total == 0`
  (never `==` on the raw JSON — era drift makes that false while the
  tree is correct);
- the full `(id, sort_order)` maps match the baseline exactly, for both
  node kinds (the diff cannot see entity-type order at all);
- row counts and id sets equal the baseline's;
- `created_at`/`updated_at` of every row the restore should not have
  touched are byte-identical to a pre-restore capture — the only real
  test of D1's "never touch a matching row";
- `SET CONSTRAINTS ALL IMMEDIATE` before assertions on any case that
  must prove a valid role/parent tree.

Also: idempotence (restoring twice is a second no-op), and era drift (a
baseline lacking `entry_label`/`allows_not_*` must not null those
columns).

**T2 — Discard service, refusals, endpoint (backend)**
D4, D5, D6, D8, D10, D11, D12. `POST .../discard-draft` mirroring the
republish endpoint (manager-gated, typed errors → 404/409,
`ApiResponse[DiscardDraftResponse]`, commit in the endpoint), body
carrying `acknowledge_orphans: bool = False`.

Tests:
- **partial discard** — draft adds a top-level `study_section`
  (`cardinality='one'`, no parent: the *cheap* materialization path),
  one session opens so it owns an instance, Discard ⇒ **200** with that
  section in `kept`, everything else restored, marker **still set**;
- a draft-added field referenced by a proposal ⇒ kept, not fatal;
- cardinality many→one with two entries ⇒ **409**, draft intact;
- container swap ⇒ 409; narrow baseline ⇒ 409 naming B-9x; empty
  baseline ⇒ **success** (not narrow);
- no active version ⇒ 404; BOLA; non-manager;
- **orphan ack** — draft adds an option, a decision records it, Discard
  without the ack ⇒ 409 listing it; with the ack ⇒ 200;
- `draft_was_open=false` path (clean template, drifted live);
- endpoint-coroutine coverage (ASGI diff-cover blind spot).

Shared fixtures (`open_session`, `make_proposal`) go into
`backend/tests/integration/conftest.py`, which already hosts the B-4 /
clone helpers (`:453-479`) — not imported across test modules.
Regenerate `frontend/types/api/{openapi.json,schema.d.ts}`.

**T3 — Slice close**
Adversarial review (pinned to commits) → fixer → `make quality-scan` +
`make test-backend` (serial) → **no browser pass** (no UI here): verify
instead with a scripted call against the local stack showing the count
returning to zero and the log event emitted → PR + auto-merge + watcher
+ memory.

## Verification gates

RED before GREEN; ruff/eslint/tsc clean; no new fitness offenders;
backend suites never concurrent. Frontend suite with the worktree `.env`
moved aside if any frontend file changes (only generated types should).

## Non-goals

The button, its dialog, the `templateInstructionKeys` invalidation gap,
and `TemplateConfigEditor`'s imperative non-TanStack `entityTypes` state
(**B-9c2** — the last two are real wiring cost the map found). Deleting
instances to make a blocked node removable (never — that is run data;
keep it and report). Restoring `created_at`. Legacy pre-0026 templates
(**B-9x**). Solving the container swap (D3). Guarding `move_field` /
`field_type` changes on value-bearing fields at their own write path —
already spawned as separate work, and the honest scope of B-9d's
"deletes never confirm" is now: *deletes* skip the confirm because the DB
refuses the destructive ones and Discard restores the rest; *moves* and
*type changes* keep their gate at the Publish ack.
