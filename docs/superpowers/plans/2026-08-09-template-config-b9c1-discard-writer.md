---
status: draft
last_reviewed: 2026-08-09
owner: '@raphaelfh'
---

# Template config B-9c1 — Discard draft: the snapshot→live writer

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development task-by-task. Built from a
> structural map (Explore, 2026-08-09) against dev @ `b0fcb218` (B-9a
> merged). Spec: §1 of
> `docs/superpowers/specs/2026-08-05-template-config-ux-redesign-design.md`;
> the B-9a plan's "Stale spec facts" still apply and are not repeated.

## Why this slice, and why backend-only

B-9c pays for the **inverse of `SNAPSHOT_SQL`** — JSONB snapshot back into
live `extraction_entity_types` / `extraction_fields` rows. B-9e's
"Restore vN as draft" is the same call with a different source, and B-9d's
"deletes never confirm" needs this as its safety net. Building it inside
History would hide it; building it behind Discard exposes it with the
simplest possible use case.

Split (this plan owns **B-9c1**):
- **B-9c1** — `restore_published_snapshot` + `POST .../discard-draft` +
  the refusal taxonomy + integration tests.
- **B-9c2** — the Discard button, its confirm dialog (carrying B-9a's
  count), and two frontend wiring gaps the map found (below).

The refusal taxonomy is only discoverable by integration test against the
real RESTRICT FKs, and the UI cannot be written until each refusal has a
message. That is a genuine dependency, not padding.

## Load-bearing map facts (verified 2026-08-09)

- **Snapshot is a complete restore source.** Entity keys
  `extraction_snapshot.py:52-61`, field keys `:65-81`, plus top-level
  `llm_template_instruction` emitted **only when truthy** (`:137-141`).
  Columns absent from the snapshot are all derivable
  (`template_id` NULL for the project lineage, `project_template_id` from
  the path, `entity_type_id` from JSON nesting) or cosmetic
  (`created_at`/`updated_at`, rewritten by `trg_*_updated_at`).
- **Ids are preserved in the snapshot** (`:53`, `:66`) — a deleted node
  comes back with its original id, so nothing needs remapping (unlike
  clone, which remaps into a new lineage).
- **A blunt delete-all-and-reinsert is impossible.** `extraction_instances
  .entity_type_id` is RESTRICT (`extraction.py:470-474`) and **five**
  workflow tables hold `field_id` RESTRICT (`extraction_workflow.py:89`,
  `:140`, `:220`, `:326`, `:412`). The writer must be a targeted
  reconcile (upsert-by-id).
- **Deletes of nodes holding recorded work are ALREADY refused** by those
  same FKs (`FieldInUseError` → 409, `template_field_service.py:243-264`;
  `SectionInUseError`, `template_section_service.py:274-298`). So the set
  a draft can delete is exactly the value-free subset — Discard restores
  their schema and strands nothing. It adds no new undo power over data.
- **Instances materialize from LIVE rows, not the snapshot** —
  `hitl_session_service._project_entity_types:194-200` (live query) feeds
  `ensure_instances:107-114`, and `_backfill_child_singletons:275-350`
  seeds every cardinality-one child under every existing parent instance;
  `ModelExtractionService._get_child_entity_types` →
  `ExtractionEntityTypeRepository.get_children:217-239` is live too.
  **Therefore a section added in the draft owns real instances the moment
  any reviewer opens a session, and Discard cannot delete it** — the
  RESTRICT FK fires. It must refuse with a named, actionable error.
- **`uq_extraction_fields_entity_type_name` (0050) is immediate and
  non-deferrable** (`extraction.py:424-429`). A draft that swapped two
  field names, or that renamed A so the restore must re-create A's old
  namesake, collides mid-UPDATE.
- **`ck_extraction_entity_types_role_parent` is immediate**
  (`extraction.py:338-342`) — a `model_section` INSERT needs its container
  present. The deferred trigger (`0016:194-197`) does not constrain
  intra-transaction ordering, but topological ordering is still required
  (clone's `_topologically_sorted`, `template_clone_service.py:290-332`).
- **Era drift silently nulls columns.** A "wide" pre-0038 baseline lacks
  `allows_not_*`; pre-0051 lacks `entry_label`. A naive
  `setattr(row, k, snap.get(k))` wipes them. The canonical defaults
  already exist and must be imported, not re-derived:
  `template_diff.ENTITY_ATTRIBUTE_DEFAULTS:105-114`,
  `FIELD_ATTRIBUTE_DEFAULTS:117-132`, `_normalize_entity:294-301`,
  `_instruction:329-331`.
- **`acquire_publish_locks` is reusable verbatim**
  (`template_version_service.py:222-263`): sorted per-article advisory
  locks (ABBA-safe against session-open) then the template row
  `FOR UPDATE`; documented idempotent, already called by a non-publish
  caller (`template_clone_service.py:141`).
- **The 0048 marker clear must be LAST — inverted vs `republish`.** The
  triggers are unconditional per row (`0048:113-122`), so every restored
  row re-stamps; `republish` clears first (`:150-154`) only because it
  writes no structure rows. `DISABLE TRIGGER` is NOT an option in a
  request path (`ALTER TABLE` takes ACCESS EXCLUSIVE table-wide).
- **`diff_snapshots` cannot drive the patch** — a removed section absorbs
  its fields into one change (`template_diff.py:369-371`), REMOVED changes
  carry no row data (`:393-404`), `sort_order` is excluded by design
  (`:598-637`), options are reported per code not as the raw blob. Use it
  as a post-condition **assertion**, and reuse its constants.
- **Post-restore equality must go through the diff, never `==`.** After a
  correct restore on an era-drifted baseline, `active.schema_ != rebuilt`
  byte-wise while `diff_snapshots(...).total == 0`.
- Endpoint precedent: `POST .../republish-version`
  (`project_templates.py:210-252`) — manager-gated, typed errors →
  `HTTPException(404|409)`, `db.commit()` in the endpoint, `ApiResponse`
  envelope. Module is 307 lines against the ~800 ceiling.

## Decisions (proposed; panel to ratify)

- **D1 — Targeted reconcile, not rebuild.** Compute three id sets from
  baseline vs freshly built live snapshot: **delete** (live-only),
  **update** (both, differing after normalization), **create**
  (baseline-only). Never touch a row that matches.
- **D2 — Ordering that respects immediate constraints.** Within one
  transaction: (1) delete draft-added fields; (2) delete draft-added
  entity types in reverse-topological order; (3) create missing entity
  types in topological order (`_topologically_sorted`, reused); (4)
  create missing fields; (5) update survivors. **Name collisions
  (`uq_extraction_fields_entity_type_name`)**: park every updated field's
  `name` to a transient unique value in one pass, then settle to the
  target names in a second pass — the standard two-phase, chosen over
  delete-then-insert because ids must survive. If two-phase fights back
  in RED, the fallback is to refuse a restore whose update set contains a
  name cycle (typed error, documented as a known gap).
- **D3 — Normalization is imported, not re-derived.** Apply
  `template_diff`'s canonical defaults to the baseline before writing, so
  an era-drifted snapshot never nulls a column it simply predates.
- **D4 — Refusal taxonomy (all typed, all 409 unless noted).**
  - `DiscardBlockedByInstancesError` — a draft-added entity type owns
    `extraction_instances` (the C8 case). Message names the section and
    says the entries must be removed first. **Detected up front by a
    counting query, not by catching 23503**, so the transaction never
    half-applies.
  - `DiscardBlockedByFieldInUseError` — a draft-added field is referenced
    by any of the five workflow tables (same up-front detection).
  - `NarrowBaselineError` — `snapshot_is_narrow((active.schema_ or {})
    .get("entity_types", []))` is True. Restoring a pre-0026 baseline
    would wipe `llm_description`/`allow_other` project-wide. **Legacy
    templates get no Discard until B-9x lands** — state that in the
    error and in the plan's non-goals.
  - `NoActiveTemplateVersionError` (existing) — nothing to restore to.
  - No draft open (`config_draft_since IS NULL`) ⇒ **success, no-op**
    (idempotent), not an error.
- **D5 — The instruction is part of the draft.** Restore
  `project_extraction_templates.llm_template_instruction` from the
  baseline's top-level key with `absent ≡ null ≡ ""` (mirroring
  `template_instruction_service.py:66`). An instruction-only draft must
  be fully discardable — it is the exact case B-9a's D4 exception exists
  for.
- **D6 — Marker cleared last**, inside the same transaction, after every
  structure and instruction write (B6).
- **D7 — Generic source parameter.**
  `restore_published_snapshot(db, *, project_id, template_id, snapshot)`
  takes the snapshot dict, so B-9e's "Restore vN as draft" is the same
  call with `version.schema_` from any version. The endpoint resolves the
  ACTIVE version; the service does not assume it.
- **D8 — Response.** Typed `DiscardDraftResponse` with what actually
  happened: counts of deleted/created/updated entity types and fields,
  and whether the instruction was reset. No diff payload (B-9b owns that
  shape).
- **D9 — Locks.** `acquire_publish_locks` verbatim, first thing in the
  transaction (D4's up-front detection queries run after the locks, so
  the counts cannot change under us).

## Tasks (subagent-driven, TDD per task)

**T1 — The writer (service, backend)**
`backend/app/services/template_restore_service.py` implementing D1–D3,
D5–D7, D9. Integration tests (real DB, RESTRICT FKs are the point), RED
first:
- restore after each single-edit kind: label change, field added, field
  deleted (value-free), section added, section deleted, reorder,
  cardinality flip, `entry_label` change, instruction set/cleared;
- **post-condition on every case:
  `diff_snapshots(active.schema_, rebuilt, fields_with_values=frozenset())
  .total == 0`** — never `==` (era drift);
- **era-drift case**: an active snapshot lacking `entry_label` and
  `allows_not_*` ⇒ restore does NOT null those columns;
- the name-swap collision (two fields exchanging names) ⇒ succeeds under
  two-phase, or raises the documented typed error;
- topological case: a draft that deleted a `model_section` **and** its
  container ⇒ both re-created in the right order;
- idempotence: restoring twice is a no-op the second time, and
  `config_draft_since` is NULL after each;
- no-draft ⇒ no-op success.

**T2 — Refusals + endpoint (backend)**
D4's taxonomy with up-front detection, `POST .../discard-draft` mirroring
the republish endpoint (manager-gated, typed errors → 404/409,
`ApiResponse[DiscardDraftResponse]`, commit in the endpoint). Tests:
- **the C8 case end to end** — add a section in the draft, open a session
  so `_backfill_child_singletons` materializes its instances, then Discard
  ⇒ 409 naming the section, **and the transaction left everything
  untouched** (assert the draft is still intact afterwards);
- a draft-added field referenced by a proposal ⇒ 409;
- narrow baseline ⇒ 409 with the B-9x explanation;
- no active version ⇒ 404;
- BOLA + non-manager;
- endpoint-coroutine coverage (the ASGI diff-cover blind spot).
Regenerate `frontend/types/api/{openapi.json,schema.d.ts}`.

**T3 — Slice close**
Adversarial review (pinned to commits) → fixer → `make quality-scan` +
`make test-backend` (serial) → **no browser pass** (no UI in this slice;
verify instead with a scripted end-to-end call against the local stack,
showing the count returning to zero) → PR + auto-merge + watcher +
memory.

## Verification gates

RED before GREEN; ruff/eslint/tsc clean; no new fitness offenders; backend
suites never concurrent. Frontend suite with the worktree `.env` moved
aside if any frontend file changes (only the generated types should).

## Non-goals

The Discard button and its dialog, the `templateInstructionKeys`
invalidation gap, and `TemplateConfigEditor`'s imperative non-TanStack
`entityTypes` state (all **B-9c2** — the map found the last two and they
are real wiring cost). Deleting instances to make a draft-added section
removable (never — that is run data; refuse instead). Restoring
`created_at`. Legacy pre-0026 templates (blocked on **B-9x**). The
Publish sheet (B-9b), History/Restore UI (B-9e), the editor lock (B-9f),
§6 reopen (B-9g).
