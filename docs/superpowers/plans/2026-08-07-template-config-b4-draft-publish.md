---
status: draft
last_reviewed: 2026-08-08
owner: '@raphaelfh'
---

# Template config B-4 — edits stop republishing; explicit Publish

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.
>
> **Panel-reviewed 2026-08-08** (5 lenses: constitution, security/RLS,
> migration-safety, YAGNI, test-coverage). All BLOCKING findings folded
> in; see "Panel decisions" below.

**Goal:** A template-config edit (field, section, or ✨ instruction) no
longer creates a template version or re-pins any run; a visible Publish
action does exactly that once, and pending edits carry an explicit
persisted marker that drives the Draft chip and blocks template
re-import with a typed 409.

**Architecture:** A nullable `config_draft_since` timestamp on
`project_extraction_templates`, stamped by AFTER-row triggers on the two
live config tables (the editor still writes via PostgREST until B-7, so
the DB is the only chokepoint) and cleared only inside
`TemplateVersionService.republish`'s locked section — which every
publish path now routes through (clone fresh/zero-state/drift heal all
call `republish`; `_upsert_active_version` and the inline v1 build are
deleted). The lazy v1 self-heal deliberately does NOT clear (lock-upgrade
deadlock; see Panel decisions). The frontend drops all per-edit
`republish()` call sites, replaces them with query invalidation, and
gains a Draft chip + Publish button fed by a new manager-gated
`GET .../config-status` endpoint.

**Tech Stack:** Alembic (trigger migration), SQLAlchemy 2.0 async,
FastAPI + ApiResponse envelope, TanStack Query, shadcn.

## Global Constraints

- Ceiling: **dev** (this slice merges to `dev`).
- **Prod gate (recorded):** promoting the Publish button to `main`
  additionally requires the RLS write-tightening on
  `extraction_entity_types`/`extraction_fields` (INSERT/UPDATE →
  `is_project_manager`; today member-writable, `baseline_v1.sql:2470-2524`)
  or B-7's typed endpoints — otherwise any member's PostgREST edit
  becomes a draft a manager may blindly publish (no diff until B-9).
- The pending-draft 409 keys **only** off `config_draft_since IS NOT NULL`
  — never off `snapshot(live) != active.schema_`; and the authoritative
  check happens **under republish's locks** (unlocked reads are a
  fast-fail courtesy only).
- Session-open / run-creation is **never** gated on the draft marker.
  Lazy v1 self-heal stays and is never given new locks.
- `PUT /llm-instruction` stops republishing (Phase-A debt): it becomes a
  plain draft edit.
- Migration revision id ≤ 32 chars; roundtrip head-pin bumped; roundtrip
  downgrades to the EXPLICIT parent (never `-1`); arch-doc migration-head
  line AND the `project_extraction_templates` column-delta row updated.
- English-only copy through `frontend/lib/copy/`; ApiResponse envelope
  (`error.message`); no new `supabase.from(` reads; TanStack keys from
  factories.
- React Compiler: no try/finally in component/hook bodies; IO via
  services returning `ErrorResult<T>`.
- After backend schema changes: `npm run generate:api-types`, commit the
  regenerated files.
- PostToolUse-ruff trap: land import changes + their usages in ONE edit.

## Panel decisions (why the design looks like this)

1. **Trigger stamps with `COALESCE`, no `IS NULL` predicate**
   (`SET config_draft_since = COALESCE(config_draft_since, now())`).
   A `WHERE ... IS NULL` UPDATE that matches zero committed rows takes
   NO row lock, so an edit concurrent with Publish would commit without
   serializing behind Publish's FOR UPDATE — landing outside the
   snapshot with the marker then cleared = silent draft loss (the exact
   state this slice exists to prevent). The always-matching UPDATE
   row-locks the template, serializing every edit against Publish.
   First-edit timestamp is preserved by the COALESCE.
2. **All clone publish paths route through `republish`.** The fresh-clone
   branch built v1 inline and `_upsert_active_version` rewrote the
   active row in place — neither takes republish's locks nor clears the
   marker (fresh imports would 409 forever). Both are deleted; fresh,
   zero-state and drift-heal call `republish`. Zero-state acquires
   republish's lock order (advisory locks → row FOR UPDATE) BEFORE
   rebuilding structure, so its trigger stamps can't invert the
   documented lock order against session-open (ABBA).
3. **Lazy v1 (`_snapshot_initial_version`) does NOT clear the marker.**
   `create_run` holds the template row FOR SHARE; an UPDATE there is an
   in-place exclusive upgrade — two concurrent first-runs (the
   documented #54/#69 race) would deadlock. Cost of not clearing: a
   legacy versionless template can show a phantom "Unpublished changes"
   chip until one no-op Publish click. A structlog warning records the
   publish-with-pending-draft (constitution §IX: no silent drop).
4. **`fail_if_pending_draft` re-check inside republish's locked
   section, and the 409 is DRIFT-PATH-ONLY.** Clone's unlocked
   pre-check is TOCTOU-racy; the authoritative 409 decision re-reads
   the marker after the row FOR UPDATE. Only the drift-heal checks at
   all: it is the one path that would silently PUBLISH a pending draft.
   Zero-state rebuilds regardless of marker (the documented
   factory-recovery workflow: delete-all + re-import); the aligned path
   publishes nothing, so the draft survives re-activation untouched.
   Fresh/zero-state stamp their OWN marker in-txn by construction and
   must not self-409.
5. **Trigger resolves OLD and NEW template ids separately on UPDATE**
   and stamps both when they differ — a same-project re-point
   (RLS-permitted) must not leave the source template in silent-self-heal
   state.
6. **Future-migration hazard recorded in 0048's docstring:** any later
   DML migration touching the two triggered tables (0039-style
   backfills) stamps EVERY template's marker — such migrations must
   `ALTER TABLE ... DISABLE TRIGGER` or clear markers afterwards.
7. **Seed safety is the `v_old`/`v_new` IS NULL skip** — the seed writes
   the SAME two tables in global lineage (`template_id` set,
   `project_template_id` NULL; `seed.py:98/:1364`); a test pins the
   no-stamp guarantee.
8. Deploy-window transient (Railway runs alembic before the new backend
   serves): the OLD backend's clone/republish won't clear markers the
   new triggers stamp — a false chip recoverable with one Publish click.
   Known, accepted, no code.
9. When B-7 lands typed write endpoints, port/retire the trigger (the
   dual mechanism must not fossilize) — recorded here for the B-7 plan.
10. Dropped as speculation (YAGNI): `user_id` param on
    `set_template_instruction` (ruff ARG001 would fail lint),
    `pending_since`/`active_published_at` response fields, a new status
    service module (goes in `template_version_read_service.py`).

## Non-goals (deferred, deliberate)

- Publish diff sheet with severity tiers, editor lock, History, Discard,
  per-change revert → B-9. B-4's Publish is chip + button + toast.
  (Discard deferral is safe: pre-B-4 every fat-finger published
  instantly; post-B-4 it sits inert in live rows, still editable — the
  practical undo is edit-back + Publish.)
- Inline cell editing / dialog deletion → B-5.
- Reopen-finalized-runs section in the publish flow → spec §6, later.
- Typed write endpoints + RLS tightening → B-7 (prod gate above).
- Re-pointing the run-view AI-dispatch section list off live rows → B-5
  (backend already resolves sections from the pinned snapshot).
- Automated E2E of the chip/Publish/409 flow → deferred with B-9's
  publish sheet; this slice verifies via unit/component tests + a manual
  browser pass.

---

### Task 1: Migration 0048 — draft-marker column + triggers + roundtrip pin

**Files:**
- Create: `backend/alembic/versions/0048_config_draft_marker.py`
- Modify: `backend/app/models/extraction.py` (ProjectExtractionTemplate,
  after the `schema_` column ~line 203)
- Modify: `backend/tests/integration/test_migration_roundtrip.py`
  (head-pin assertion ~line 588; add `test_migration_0048_round_trip`)
- Create: `backend/tests/integration/test_template_config_draft_marker.py`
- Modify: `docs/reference/extraction-hitl-architecture.md` (migration-head
  line, `last_reviewed`, AND the `project_extraction_templates`
  column-delta row: `+ config_draft_since … 0048` + the two triggers)
- Modify: `.markdownlintignore` (ONE entry for this plan doc)

**Interfaces:**
- Produces: `ProjectExtractionTemplate.config_draft_since:
  Mapped[datetime | None]`; DB triggers
  `trg_extraction_entity_types_mark_draft` /
  `trg_extraction_fields_mark_draft` calling
  `public.mark_template_config_draft()`.
- Fixtures: integration tests use the plain `db_session` fixture (the
  triggers are NOT deferred) + `from tests.integration.conftest import
  SEED` — `SEED.primary_template`, `SEED.primary_entity_type`,
  `SEED.primary_project` (there is NO `seed_graph` fixture).

- [ ] **Step 1: Write the failing integration test**

```python
"""Draft-marker lifecycle (slice B-4).

The editor writes config through PostgREST until B-7, so the ONLY
reliable place to record "there are unpublished edits" is the DB:
AFTER-row triggers on the two live config tables stamp
``project_extraction_templates.config_draft_since``; publish paths
clear it inside ``TemplateVersionService.republish``'s locked section.
"""

from datetime import UTC, datetime
from uuid import UUID

import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import (
    ExtractionEntityType,
    ExtractionField,
    ProjectExtractionTemplate,
)
from tests.integration.conftest import SEED

# A sentinel far in the past: within one test transaction now() is
# constant, so "second edit keeps the first timestamp" is only
# falsifiable against a PRE-SET value, never against two in-txn stamps.
_SENTINEL = datetime(2020, 1, 1, tzinfo=UTC)


async def _marker(db: AsyncSession, template_id: UUID) -> datetime | None:
    return (
        await db.execute(
            select(ProjectExtractionTemplate.config_draft_since).where(
                ProjectExtractionTemplate.id == template_id
            )
        )
    ).scalar_one()


async def _set_marker(
    db: AsyncSession, template_id: UUID, value: datetime | None
) -> None:
    await db.execute(
        update(ProjectExtractionTemplate)
        .where(ProjectExtractionTemplate.id == template_id)
        .values(config_draft_since=value)
    )
    await db.flush()


def _probe_field(name: str) -> ExtractionField:
    return ExtractionField(
        entity_type_id=SEED.primary_entity_type,
        name=name,
        label=f"probe {name}",
        field_type="text",
        is_required=False,
        validation_schema={},
        sort_order=999,
    )


@pytest.mark.asyncio
async def test_field_insert_update_delete_mark_draft(db_session):
    await _set_marker(db_session, SEED.primary_template, None)

    field = _probe_field("b4_marker_probe")
    db_session.add(field)
    await db_session.flush()
    assert await _marker(db_session, SEED.primary_template) is not None

    await _set_marker(db_session, SEED.primary_template, None)
    field.label = "probe renamed"
    await db_session.flush()
    assert await _marker(db_session, SEED.primary_template) is not None

    await _set_marker(db_session, SEED.primary_template, None)
    await db_session.delete(field)
    await db_session.flush()
    assert await _marker(db_session, SEED.primary_template) is not None


@pytest.mark.asyncio
async def test_entity_type_write_marks_draft(db_session):
    await _set_marker(db_session, SEED.primary_template, None)
    et = await db_session.get(ExtractionEntityType, SEED.primary_entity_type)
    et.label = f"{et.label} (b4)"
    await db_session.flush()
    assert await _marker(db_session, SEED.primary_template) is not None


@pytest.mark.asyncio
async def test_marker_keeps_first_edit_timestamp(db_session):
    """COALESCE semantics: a later edit never moves an existing stamp."""
    await _set_marker(db_session, SEED.primary_template, _SENTINEL)
    et = await db_session.get(ExtractionEntityType, SEED.primary_entity_type)
    et.label = f"{et.label} (later edit)"
    await db_session.flush()
    assert await _marker(db_session, SEED.primary_template) == _SENTINEL


@pytest.mark.asyncio
async def test_global_lineage_writes_never_stamp(db_session):
    """The seed writes these SAME tables in global lineage
    (template_id set, project_template_id NULL) — the trigger's
    v_template IS NULL skip is what keeps seeding a no-op. Pin it."""
    # copy a seeded GLOBAL entity type id from the conftest SEED (or
    # select one where project_template_id IS NULL), touch its label,
    # then assert NO project template's marker moved from a NULL
    # baseline set at test start.
```

(Fill the last test against the real seeded global rows — select one
`ExtractionEntityType` with `project_template_id IS NULL` scoped by the
seeded global template id.)

- [ ] **Step 2: Run to verify it fails**

Run (from `backend/`, local Supabase up):
`uv run pytest tests/integration/test_template_config_draft_marker.py -x -q`
Expected: FAIL — `config_draft_since` column does not exist.

- [ ] **Step 3: Model column + migration**

Model (`backend/app/models/extraction.py`, inside
`ProjectExtractionTemplate`):

```python
    # Slice B-4: stamped by DB triggers on any live config write
    # (extraction_entity_types / extraction_fields — the editor writes
    # via PostgREST until B-7, so the DB is the only chokepoint);
    # cleared ONLY inside TemplateVersionService.republish's locked
    # section. NULL = live == published intent.
    config_draft_since: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
```

Migration `backend/alembic/versions/0048_config_draft_marker.py`:

```python
"""Draft marker for template config edits (slice B-4).

``config_draft_since`` on project_extraction_templates records "there
are unpublished config edits". AFTER-row triggers on the two live
config tables stamp it (editor writes are PostgREST until B-7 — the DB
is the only chokepoint); TemplateVersionService.republish clears it
under its locks. SECURITY DEFINER so the stamp bypasses RLS regardless
of writer; EXECUTE revoked from client roles (0046 precedent).

The stamp is ``COALESCE(config_draft_since, now())`` with NO IS NULL
predicate: an UPDATE whose WHERE misses the committed row takes no row
lock, so a predicate-guarded stamp concurrent with a mid-flight publish
would commit unserialized and the publish would clear a draft it never
snapshotted. The always-matching UPDATE row-locks the template and
serializes every edit behind republish's FOR UPDATE; COALESCE keeps the
first-edit timestamp.

WARNING for future migrations: DML on extraction_entity_types /
extraction_fields now fires these triggers — a 0039-style backfill
would stamp EVERY project template (every chip flips to "Unpublished
changes", every re-import 409s). Wrap such DML in
``ALTER TABLE ... DISABLE TRIGGER trg_<table>_mark_draft`` /
re-ENABLE, or clear the markers afterwards.

Global-lineage rows (template_id set, project_template_id NULL — the
seed's lineage) resolve v_old/v_new to NULL and are skipped.

Revision ID: 0048_config_draft_marker
Revises: 0047_llm_template_instruction
"""

import sqlalchemy as sa

from alembic import op

revision = "0048_config_draft_marker"
down_revision = "0047_llm_template_instruction"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "project_extraction_templates",
        sa.Column("config_draft_since", sa.DateTime(timezone=True), nullable=True),
        schema="public",
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.mark_template_config_draft()
            RETURNS trigger
            LANGUAGE plpgsql
            SECURITY DEFINER
            SET search_path = public
            AS $$
            DECLARE
                v_old uuid;
                v_new uuid;
            BEGIN
                -- Resolve OLD and NEW separately: a same-project
                -- re-point (RLS permits it) must stamp BOTH templates,
                -- or the source is left in silent-self-heal state.
                IF TG_TABLE_NAME = 'extraction_entity_types' THEN
                    IF TG_OP IN ('DELETE', 'UPDATE') THEN
                        v_old := OLD.project_template_id;
                    END IF;
                    IF TG_OP IN ('INSERT', 'UPDATE') THEN
                        v_new := NEW.project_template_id;
                    END IF;
                ELSE
                    -- extraction_fields: resolve via the owning
                    -- section. On a cascade delete the parent row may
                    -- already be gone (NULL lookup → skip; the
                    -- entity-type trigger has stamped already).
                    IF TG_OP IN ('DELETE', 'UPDATE') THEN
                        SELECT project_template_id INTO v_old
                        FROM public.extraction_entity_types
                        WHERE id = OLD.entity_type_id;
                    END IF;
                    IF TG_OP IN ('INSERT', 'UPDATE') THEN
                        SELECT project_template_id INTO v_new
                        FROM public.extraction_entity_types
                        WHERE id = NEW.entity_type_id;
                    END IF;
                END IF;

                IF v_old IS NOT NULL THEN
                    UPDATE public.project_extraction_templates
                    SET config_draft_since =
                        COALESCE(config_draft_since, now())
                    WHERE id = v_old;
                END IF;
                IF v_new IS NOT NULL AND v_new IS DISTINCT FROM v_old THEN
                    UPDATE public.project_extraction_templates
                    SET config_draft_since =
                        COALESCE(config_draft_since, now())
                    WHERE id = v_new;
                END IF;

                -- AFTER trigger: the return value is ignored.
                RETURN NULL;
            END;
            $$;
        """
    )
    op.execute(
        "REVOKE EXECUTE ON FUNCTION public.mark_template_config_draft() "
        "FROM PUBLIC, anon, authenticated;"
    )
    for table in ("extraction_entity_types", "extraction_fields"):
        op.execute(
            f"DROP TRIGGER IF EXISTS trg_{table}_mark_draft "
            f"ON public.{table};"
        )
        op.execute(
            f"""
            CREATE TRIGGER trg_{table}_mark_draft
                AFTER INSERT OR UPDATE OR DELETE ON public.{table}
                FOR EACH ROW
                EXECUTE FUNCTION public.mark_template_config_draft();
            """
        )


def downgrade() -> None:
    for table in ("extraction_entity_types", "extraction_fields"):
        op.execute(
            f"DROP TRIGGER IF EXISTS trg_{table}_mark_draft "
            f"ON public.{table};"
        )
    op.execute(
        "DROP FUNCTION IF EXISTS public.mark_template_config_draft();"
    )
    op.drop_column(
        "project_extraction_templates", "config_draft_since", schema="public"
    )
```

Apply locally: from `backend/`, `uv run alembic upgrade head`.

- [ ] **Step 4: Roundtrip pin + per-migration test**

In `test_migration_roundtrip.py`: bump the head assertion
`0047_llm_template_instruction` → `0048_config_draft_marker`, and add
`test_migration_0048_round_trip` that downgrades to the EXPLICIT parent
(`_run_alembic("downgrade", "0047_llm_template_instruction", ...)` —
NEVER `-1`, per the file's own convention at lines 513-514) and asserts:
- column presence via `information_schema.columns` (0047-test style),
- BOTH triggers via `pg_trigger` with `AND NOT tgisinternal` and the
  function via `pg_proc` (0043-test style, lines 497-501),
gone after downgrade, restored after `upgrade head`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest tests/integration/test_template_config_draft_marker.py tests/integration/test_migration_roundtrip.py -x -q`
Expected: PASS.

- [ ] **Step 6: Docs + lint entry + commit**

Arch doc: head line + `last_reviewed` + the
`project_extraction_templates` column-delta row (`+ config_draft_since
… 0048`, the two triggers, and the lazy-v1 mis-attribution note from
Panel decision 3). `.markdownlintignore`: append
`docs/superpowers/plans/2026-08-07-template-config-b4-draft-publish.md`.

```bash
git add backend/alembic/versions/0048_config_draft_marker.py \
  backend/app/models/extraction.py \
  backend/tests/integration/test_migration_roundtrip.py \
  backend/tests/integration/test_template_config_draft_marker.py \
  docs/reference/extraction-hitl-architecture.md .markdownlintignore \
  docs/superpowers/plans/2026-08-07-template-config-b4-draft-publish.md
git commit -m "feat(extraction): draft marker for template config edits (B-4, 1/7)"
```

### Task 2: Publish clears the marker; clone publish paths unify on republish

**Files:**
- Modify: `backend/app/services/template_version_service.py` (clear in
  the locked section; extract `acquire_publish_locks` — PUBLIC, the
  clone's zero-state branch is a legitimate cross-service caller)
- Modify: `backend/app/services/template_clone_service.py` (fresh branch
  + zero-state branch call `republish`; DELETE `_upsert_active_version`
  and the inline v1 build; delete `_snapshot` if it loses its last
  caller)
- Modify: `backend/app/services/run_lifecycle_service.py` (structlog
  warning ONLY — no clear, no new locks)
- Test: `backend/tests/integration/test_template_config_draft_marker.py`
- Test: `backend/tests/integration/test_template_clone_service.py`
  (existing fresh-clone/zero-state tests must stay green with the new
  path)

**Interfaces:**
- Consumes: `config_draft_since` (Task 1).
- Produces: invariant "every path that publishes live structure routes
  through `republish`, which clears the marker under advisory locks +
  row FOR UPDATE"; `TemplateVersionService.acquire_publish_locks(
  project_template_id) -> list[tuple[UUID, UUID]]` (the advisory-lock +
  FOR UPDATE sequence, returning the run pairs; used internally by
  `republish` and by clone's zero-state branch BEFORE rebuilding —
  public, cross-service use is deliberate).

- [ ] **Step 1: Write the failing tests** (append to
  `test_template_config_draft_marker.py`; reuse the service-construction
  helpers from `test_template_version_republish.py` /
  `test_template_clone_service.py`)

```python
# test_republish_clears_marker_after_change:
#   real edit → marker set → republish → marker NULL, version bumped
# test_republish_clears_marker_when_snapshot_identical:
#   NO structural diff, marker pre-set directly (A→B→A rename or plain
#   _set_marker) → republish → changed is False AND marker NULL
#   (otherwise the chip sticks on "Unpublished changes" with a dead
#   Publish button — the panel's "vacuous unchanged branch" finding)
# test_fresh_clone_commits_clean:
#   clone a global template into a project with no prior clone →
#   marker NULL after clone, active v1 exists
# test_zero_state_heal_commits_clean:
#   wipe live structure for the existing clone (raw SQL), reset marker
#   to NULL, re-clone → structure rebuilt, marker NULL, new ACTIVE
#   version minted (v+1 — the in-place rewrite is gone)
# test_lazy_initial_version_keeps_marker_and_warns:
#   template with NO version rows + marker set → create_run → v1
#   created, run pinned, marker STILL SET (deliberate: no clear under
#   FOR SHARE — deadlock), structlog warning emitted (capture via
#   structlog testing or caplog)
```

- [ ] **Step 2: Run to verify they fail**

Run: `uv run pytest tests/integration/test_template_config_draft_marker.py -x -q`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement**

`template_version_service.py`:

1. Extract lines 104-128 (advisory-lock loop + row FOR UPDATE) into:

```python
    async def acquire_publish_locks(
        self, project_template_id: UUID
    ) -> list[tuple[UUID, UUID]]:
        """Advisory (article, template) locks for editable-stage runs —
        sorted, FIRST — then the template row FOR UPDATE. The one legal
        lock order (mirrors open_or_resume; see republish docstring).
        Idempotent within a transaction, so callers that need the locks
        BEFORE writing live rows (clone's zero-state rebuild) can take
        them early and republish re-takes harmlessly."""
```

2. In `republish`, after the (re-acquired) locks and the existing
   instruction write, ALWAYS clear the marker in the same UPDATE:

```python
        publish_values: dict[str, Any] = {"config_draft_since": None}
        if not isinstance(llm_template_instruction, _Unset):
            publish_values["llm_template_instruction"] = llm_template_instruction
        await self.db.execute(
            update(ProjectExtractionTemplate)
            .where(ProjectExtractionTemplate.id == project_template_id)
            .values(**publish_values)
        )
```

(the kwarg + `_Unset` sentinel are removed in Task 3 with their last
caller — keep them intact here so this commit stands alone).

`template_clone_service.py`:

- Fresh branch (`existing is None`, lines ~182-221): after
  `_insert_project_structure_from_global`, replace the inline
  `ExtractionTemplateVersion(...)` build with:

```python
            republished = await TemplateVersionService(self.db).republish(
                project_id=project_id,
                project_template_id=new_template.id,
                user_id=user_id,
            )
            version = await self.db.get(
                ExtractionTemplateVersion, republished.version_id
            )
```

  (local import per the existing circular-import note at lines 130-134;
  a brand-new template has no runs, so the advisory step is a no-op and
  no ABBA is reachable).
- Zero-state branch: BEFORE `_insert_project_structure_from_global`,
  take republish's lock order:

```python
                await TemplateVersionService(self.db).acquire_publish_locks(
                    existing.id
                )
```

  (Corner, comment it: a zero-state template whose marker was ALREADY
  set by a previous committed session hits the courtesy pre-check 409
  first — recovery is a Publish of the empty live tree, then re-import
  heals as zero-state. Rare corrupted-state path, accepted.)

  then rebuild, then `republish(...)` instead of
  `_upsert_active_version`. (Locks first: the rebuild's trigger stamps
  take the template-row X-lock; taking advisory locks after would
  invert the order session-open relies on.)
- Delete `_upsert_active_version` (and `_snapshot` if now uncalled).
- The drift-heal branch already calls `republish` — unchanged here
  (gains the flag in Task 4).

`run_lifecycle_service.py` — in `create_run` (which holds the loaded
`template` row) and `reopen_run`'s lazy branch, after
`_snapshot_initial_version` returns:

```python
        if template.config_draft_since is not None:
            logger.warning(
                "lazy_initial_version_published_pending_draft",
                project_template_id=str(project_template_id),
                config_draft_since=str(template.config_draft_since),
            )
```

(No clear: an UPDATE here upgrades the FOR SHARE row lock in place —
two concurrent first-runs deadlock. The marker stays; the chip
self-heals on the next no-op Publish.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/integration/test_template_config_draft_marker.py tests/integration/test_template_version_republish.py tests/integration/test_template_clone_service.py tests/integration/test_template_clone_extraction.py tests/integration/test_template_clone_dispositions.py -x -q`
Expected: PASS — including the pre-existing fresh-clone/zero-state/
dispositions suites now running through republish.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/template_version_service.py \
  backend/app/services/template_clone_service.py \
  backend/app/services/run_lifecycle_service.py \
  backend/tests/integration/test_template_config_draft_marker.py \
  backend/tests/integration/test_template_clone_service.py
git commit -m "feat(extraction): publish paths unify on republish and clear the draft marker (B-4, 2/7)"
```

### Task 3: `PUT /llm-instruction` becomes a draft edit (no republish)

**Files:**
- Modify: `backend/app/services/template_instruction_service.py`
  (service body + the now-false module docstring + `_owned_template`
  comment + import changes — ONE atomic edit per file)
- Modify: `backend/app/services/template_version_service.py` (REMOVE the
  `llm_template_instruction` kwarg + `_Unset` sentinel — this task
  deletes their last caller)
- Modify: `backend/app/schemas/hitl_session.py`
  (`UpdateTemplateInstructionResponse` slims to 2 fields)
- Modify: `backend/app/api/v1/endpoints/project_templates.py`
  (PUT docstring + error mapping + `_user_sub` rename; also the
  module-header docstring "after every section/field edit" is now false)
- Test: `backend/tests/integration/test_template_instruction_service.py`
- Test: `backend/tests/unit/test_template_instruction_endpoint.py`
  (constructs the OLD response shape with dead kwargs — pydantic
  `extra='ignore'` would keep it silently green; rewrite it)

**Interfaces:**
- Produces: `UpdateTemplateInstructionResponse{project_template_id: UUID,
  llm_template_instruction: str | None}`;
  `set_template_instruction(db, *, project_id, template_id,
  llm_template_instruction)` (NO `user_id` — ruff ARG001).

- [ ] **Step 1: Rewrite the failing tests**

`test_template_instruction_service.py` — rewrite
`test_set_updates_column_and_republishes` and
`test_clear_and_whitespace_normalize_to_null` to assert:

```python
# after set_template_instruction(...):
# 1. the column is written (normalized; whitespace-only → None)
# 2. NO new ExtractionTemplateVersion row; active snapshot unchanged
# 3. config_draft_since is NOT NULL (an instruction edit is a draft edit)
# 4. a subsequent republish() picks the text into the snapshot and
#    clears the marker
# 5. setting the SAME value again does not stamp (reset marker to None
#    first, write same value, marker stays None)
```

(`test_set_is_bola_guarded` and the GET tests survive unchanged.)
`test_template_instruction_endpoint.py` — update the response-shape
construction to the 2-field schema and drop the republish expectations.

- [ ] **Step 2: Run to verify they fail**

Run: `uv run pytest tests/integration/test_template_instruction_service.py tests/unit/test_template_instruction_endpoint.py -x -q`
Expected: FAIL (service still republishes).

- [ ] **Step 3: Implement**

`set_template_instruction`:

```python
async def set_template_instruction(
    db: AsyncSession,
    *,
    project_id: UUID,
    template_id: UUID,
    llm_template_instruction: str | None,
) -> UpdateTemplateInstructionResponse:
    """Normalize and stage the instruction as a draft edit (slice B-4).

    No republish: the text reaches prompts/snapshots only at Publish.
    Whitespace-only input normalizes to NULL — the snapshot then omits
    the key and prompts inject nothing. A no-op write (same value)
    does not stamp the draft marker. The compare-then-write is an
    unlocked read: two racing PUTs can make one a silent no-op —
    millisecond window, self-correcting on retry, accepted.
    """
    tpl = await _owned_template(db, project_id=project_id, template_id=template_id)
    normalized = (llm_template_instruction or "").strip() or None
    if normalized != tpl.llm_template_instruction:
        await db.execute(
            update(ProjectExtractionTemplate)
            .where(ProjectExtractionTemplate.id == template_id)
            .values(
                llm_template_instruction=normalized,
                config_draft_since=func.coalesce(
                    ProjectExtractionTemplate.config_draft_since, func.now()
                ),
            )
        )
    return UpdateTemplateInstructionResponse(
        project_template_id=template_id,
        llm_template_instruction=normalized,
    )
```

Rewrite the module docstring (it currently narrates the
write-inside-republish lock design) and the `_owned_template` comment;
drop the `TemplateVersionService` import; add `func`/`update` imports —
all in the same edit. Endpoint: 404 maps only
`ProjectTemplateNotFoundError`; `current_user_sub` → `_user_sub`;
docstring says "stages a draft edit; the Publish button publishes".
`template_version_service.py`: delete the kwarg, `_Unset`, `_UNSET`,
and fold `publish_values` back to a plain
`.values(config_draft_since=None)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/integration/test_template_instruction_service.py tests/integration/test_template_config_draft_marker.py tests/unit/test_template_instruction_endpoint.py -x -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/template_instruction_service.py \
  backend/app/services/template_version_service.py \
  backend/app/schemas/hitl_session.py \
  backend/app/api/v1/endpoints/project_templates.py \
  backend/tests/integration/test_template_instruction_service.py \
  backend/tests/unit/test_template_instruction_endpoint.py
git commit -m "feat(extraction): instruction PUT stages a draft edit instead of republishing (B-4, 3/7)"
```

### Task 4: Re-import blocks on a pending draft (typed 409, checked under lock)

**Files:**
- Modify: `backend/app/services/template_version_service.py`
  (`fail_if_pending_draft: bool = False` param; re-check after the row
  FOR UPDATE; `PendingConfigDraftError` is defined in
  `template_clone_service.py` next to `TemplateNotFoundError` — the
  version service ALREADY top-level-imports from the clone service, so
  this direction adds no new cycle)
- Modify: `backend/app/services/template_clone_service.py` (unlocked
  fast-fail pre-check at the top of the existing-clone branch; drift
  heal passes `fail_if_pending_draft=True`)
- Modify: `backend/app/api/v1/endpoints/project_templates.py`
  (409 mapping on the clone endpoint)
- Test: `backend/tests/integration/test_template_clone_service.py` —
  including the TWO existing self-heal tests the triggers now break:
  `test_clone_selfheals_snapshot_from_live_on_drift` (line ~128; its
  raw-SQL DELETE now stamps the marker → must reset
  `config_draft_since = NULL` to simulate the pre-B4 "lost republish")
  and `test_reclone_selfheals_unsnapshotted_edit_without_wiping`
  (line ~224; same reset after its raw-SQL INSERT)
- Must-stay-green: `backend/tests/integration/test_template_clone_extraction.py`
  — especially `test_clone_heals_empty_clone_by_repopulating_entity_types`
  (~line 473: raw-SQL delete-all stamps the marker; the zero-state heal
  must STILL run — the 409 is drift-path-only) — run it in Step 4
- Test: Create `backend/tests/unit/test_template_clone_endpoint.py`
  (per-endpoint naming precedent; NO direct-coroutine test exists for
  the clone endpoint today — verified)

**Interfaces:**
- Produces: `PendingConfigDraftError` (in
  `template_clone_service.py`, re-exported through
  `template_version_service.__all__` like `TemplateNotFoundError`),
  message
  `"Template has unpublished configuration changes. Publish them before re-importing."`,
  mapped to HTTP 409 on the clone endpoint.

- [ ] **Step 1: Write the failing tests**

```python
# test_reimport_with_pending_draft_and_drift_raises(db_session):
#   real structural edit (count drift) → marker stamped by trigger →
#   clone() raises PendingConfigDraftError; structure counts AND active
#   version unchanged (nothing touched)
# test_reimport_aligned_with_pending_draft_succeeds(db_session):
#   marker set via _set_marker, counts ALIGNED → clone() succeeds
#   (re-activation publishes nothing) and the marker SURVIVES
# test_reimport_zero_state_with_marker_still_heals(db_session):
#   raw-SQL delete-all (trigger stamps) → clone() heals (factory
#   restore) and the republish leaves the marker NULL
# test_reimport_drift_without_marker_still_self_heals(db_session):
#   raw-SQL edit → reset marker to NULL (the lost-republish simulation)
#   → clone() self-heals via republish; marker NULL after
# test_locked_recheck_catches_stamp_after_precheck(db_session):
#   simulate the TOCTOU: reset marker NULL, then stamp it AFTER the
#   pre-check would have passed by calling
#   TemplateVersionService.republish(fail_if_pending_draft=True)
#   directly with the marker set → raises PendingConfigDraftError
```

Plus the two existing self-heal tests updated with the marker reset.
Endpoint unit test: direct coroutine call of
`clone_template_into_project` with a stubbed service raising
`PendingConfigDraftError` → HTTPException 409 (mirror
`test_template_instruction_endpoint.py`'s stub pattern + ASGI-blind-spot
docstring).

- [ ] **Step 2: Run to verify they fail**

Run: `uv run pytest tests/integration/test_template_clone_service.py -x -q`
Expected: new tests FAIL; the two updated self-heal tests now PASS
their reset preamble but the 409 tests fail (no exception class yet).

- [ ] **Step 3: Implement**

`template_version_service.py`:

```python
class PendingConfigDraftError(Exception):
    """Publish-adjacent operation refused: unpublished config edits."""
```

In `republish`, right after `_acquire_publish_locks` (row FOR UPDATE
held):

```python
        if fail_if_pending_draft:
            pending = (
                await self.db.execute(
                    select(ProjectExtractionTemplate.config_draft_since).where(
                        ProjectExtractionTemplate.id == project_template_id
                    )
                )
            ).scalar_one()
            if pending is not None:
                raise PendingConfigDraftError(
                    "Template has unpublished configuration changes. "
                    "Publish them before re-importing."
                )
```

`template_clone_service.py`, scoped to the DRIFT-HEAL path ONLY (after
the zero-state detection — NOT at the top of the branch: a top-of-branch
guard would 409 the zero-state heal, breaking the documented
factory-recovery workflow ("true factory recovery is an explicit delete
+ re-import", clone docstring) and
`test_template_clone_extraction.py::test_clone_heals_empty_clone_by_repopulating_entity_types`.
Zero-state rebuilds regardless of marker — an explicit factory restore
whose republish clears it; the aligned path publishes nothing, so a
pending draft is not at risk there and survives re-activation):

```python
            elif entity_types != snapshot_et or fields != snapshot_field:
                if existing.config_draft_since is not None:
                    # Fast-fail courtesy; the AUTHORITATIVE check
                    # re-runs under republish's locks
                    # (fail_if_pending_draft) so a stamp landing after
                    # this read still 409s instead of being silently
                    # published by the drift heal.
                    raise PendingConfigDraftError(...)
                republished = await TemplateVersionService(self.db).republish(
                    ..., fail_if_pending_draft=True
                )
```

(Zero-state/fresh do NOT pass the flag — their own in-transaction
stamps are expected and cleared by the publish.)
Endpoint: `except PendingConfigDraftError as e: raise
HTTPException(status_code=409, detail=str(e)) from e`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/integration/test_template_clone_service.py tests/unit/test_template_clone_endpoint.py -x -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/template_version_service.py \
  backend/app/services/template_clone_service.py \
  backend/app/api/v1/endpoints/project_templates.py \
  backend/tests/integration/test_template_clone_service.py \
  backend/tests/unit/test_template_clone_endpoint.py
git commit -m "feat(extraction): re-import blocks on a pending config draft (B-4, 4/7)"
```

### Task 5: `GET .../config-status` + api-types regen

**Files:**
- Modify: `backend/app/services/template_version_read_service.py` (add
  `get_template_config_status` — the module already owns BOLA-scoped
  template + active-version reads; NO new module)
- Modify: `backend/app/schemas/hitl_session.py` (add
  `TemplateConfigStatusRead`)
- Modify: `backend/app/api/v1/endpoints/project_templates.py` (new GET)
- Test: `backend/tests/integration/test_template_config_status.py`
- Test: Create `backend/tests/unit/test_template_config_status_endpoint.py`
  (per-endpoint naming precedent)
- Regenerate: `frontend/types/api/openapi.json`,
  `frontend/types/api/schema.d.ts`

**Interfaces:**
- Produces:

```python
class TemplateConfigStatusRead(BaseModel):
    project_template_id: UUID
    has_pending_changes: bool
    active_version: int | None
```

(3 fields only — timestamps have zero consumers until B-9) and
`GET /api/v1/projects/{project_id}/templates/{template_id}/config-status`
(manager-gated), consumed by Task 7's hook.

- [ ] **Step 1: Write the failing tests**

Integration: `has_pending_changes` flips False → (field edit) → True →
(republish) → False; `active_version` mirrors the active row (and is
None for a template with no versions); BOLA: foreign project's template
id → 404 (`ProjectTemplateNotFoundError`). Unit: direct coroutine happy
path + 404 mapping.

- [ ] **Step 2: Run to verify they fail** — function doesn't exist.

- [ ] **Step 3: Implement**

In `template_version_read_service.py` (reuse its existing owned-template
lookup + active-version select shapes):

```python
async def get_template_config_status(
    db: AsyncSession, *, project_id: UUID, template_id: UUID
) -> TemplateConfigStatusRead:
    tpl = await db.get(ProjectExtractionTemplate, template_id)
    if tpl is None or tpl.project_id != project_id:
        raise ProjectTemplateNotFoundError(f"Template {template_id} not found")
    active_version = (
        await db.execute(
            select(ExtractionTemplateVersion.version).where(
                ExtractionTemplateVersion.project_template_id == template_id,
                ExtractionTemplateVersion.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    return TemplateConfigStatusRead(
        project_template_id=tpl.id,
        has_pending_changes=tpl.config_draft_since is not None,
        active_version=active_version,
    )
```

Endpoint after the llm-instruction GET, `require_project_manager`,
404 mapping, `ApiResponse[TemplateConfigStatusRead]`.

- [ ] **Step 4: Run tests, regen types**

Run: `uv run pytest tests/integration/test_template_config_status.py tests/unit/test_template_config_status_endpoint.py -x -q` → PASS.
From repo root: `npm run generate:api-types` — diff shows the new
schema + the slimmer `UpdateTemplateInstructionResponse`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/template_version_read_service.py \
  backend/app/schemas/hitl_session.py \
  backend/app/api/v1/endpoints/project_templates.py \
  backend/tests/integration/test_template_config_status.py \
  backend/tests/unit/test_template_config_status_endpoint.py \
  frontend/types/api/openapi.json frontend/types/api/schema.d.ts
git commit -m "feat(extraction): template config-status endpoint (B-4, 5/7)"
```

### Task 6: Frontend — edits stop republishing; invalidation rewiring

**Files:**
- Modify: `frontend/hooks/extraction/useTemplateRepublish.ts`
- Modify: `frontend/hooks/extraction/useFieldManagement.ts` (ALL FIVE
  call sites: addField 211, createOtherSpecifyField 266, updateField
  308, deleteField 341, reorderFields 401)
- Modify: `frontend/hooks/extraction/useUpdateTemplateField.ts`
- Modify: `frontend/hooks/extraction/useTemplateInstruction.ts`
- Modify: `frontend/components/extraction/TemplateConfigEditor.tsx`
- Modify: `frontend/components/extraction/ExtractionInterface.tsx`
  (~line 572: ALREADY invalidation-only — just add
  `templateConfigStatusKeys.all`)
- Modify: `frontend/lib/query-keys/extraction.ts`
- Modify: `frontend/services/templateService.ts`
- Modify: `frontend/lib/copy/extraction.ts` (REWORD
  `errors_republishTemplate` — its current text promises "will be
  published with your next configuration change", now false)
- Modify: comments in
  `frontend/components/extraction/template-config/TemplateConfigGridPanel.tsx`,
  `TemplateGrid.tsx`, `TemplateFieldDialogs.tsx` (republish-cadence
  references)
- Modify: `frontend/e2e/_fixtures/ensure-fixtures.ts` (ONE comment: the
  E2E adminInserts stamp the shared template's marker; the suite
  survives because bootstrap early-returns before clone — a future
  re-clone of E2E_PROJECT_ID would 409)
- Test: `frontend/test/hooks/useFieldManagement.republish.test.tsx`
  (REWRITE to the inversion, covering ALL FIVE mutations)
- Test: `frontend/test/useUpdateTemplateField.test.tsx` (rewrite)
- Test: `frontend/test/hooks/useTemplateInstruction.test.tsx` (stale
  response-shape mocks + assert `runsKeys.all` is NO LONGER invalidated)
- Test: `frontend/test/components/TemplateInstructionRow.test.tsx`
  (stale response-shape mocks)
- Test: Create `frontend/test/hooks/useTemplateConfigCaches.test.tsx`
  (invalidation contract: structure-path does NOT touch `runsKeys`;
  publish-path hits `runsKeys.all` + `templateActiveStructureKeys` +
  both structure keys — no existing test covers worklist refresh after
  publish, so this is the only guard against that stale-cache class)

**Interfaces:**
- Consumes: `TemplateConfigStatusRead` (Task 5 types).
- Produces (for Task 7):
  - `templateConfigStatusKeys` (`all` + `byTemplate(projectId, templateId)`)
  - `useTemplateConfigCaches(projectId, templateId)` in
    `useTemplateRepublish.ts`:
    `{invalidateStructure(): Promise<void>, invalidateAll(): Promise<void>}`
  - `useTemplateRepublish(...).republish():
    Promise<RepublishTemplateVersionResponse | null>` (was boolean)
  - `loadTemplateConfigStatus(projectId, templateId):
    Promise<ErrorResult<TemplateConfigStatus>>`

- [ ] **Step 1: Rewrite/write the failing tests first**

`useFieldManagement.republish.test.tsx`: all five mutations succeed
WITHOUT any call to `republishTemplateVersion`, and each invalidates
`templateEntityTypesKeys.byTemplate` +
`templateConfigStatusKeys.byTemplate` (spy on
`queryClient.invalidateQueries`).
`useUpdateTemplateField.test.tsx`: Save resolves on the write alone; no
republish import; invalidations asserted; `RepublishFailedError` gone.
`useTemplateInstruction.test.tsx`: 2-field response shape; onSuccess
invalidates instruction + config-status keys and NOT `runsKeys`.
`useTemplateConfigCaches.test.tsx`: the contract above.

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:run -- frontend/test/hooks/ frontend/test/useUpdateTemplateField.test.tsx`
Expected: FAIL (hooks still republish).

- [ ] **Step 3: Implement**

`query-keys/extraction.ts`:

```ts
/** Draft/publish status for the Configuration tab (B-4). */
export const templateConfigStatusKeys = {
  all: ['template-config-status'] as const,
  byTemplate: (projectId: string, templateId: string) =>
    ['template-config-status', projectId, templateId] as const,
};
```

`templateService.ts`:

```ts
export type TemplateConfigStatus =
  components['schemas']['TemplateConfigStatusRead'];

/** Draft/publish status for the Configuration tab (B-4). */
export async function loadTemplateConfigStatus(
  projectId: string,
  templateId: string,
): Promise<ErrorResult<TemplateConfigStatus>> {
  return toResult(
    async () =>
      apiClient<TemplateConfigStatus>(
        `/api/v1/projects/${projectId}/templates/${templateId}/config-status`,
      ),
    'loadTemplateConfigStatus',
  );
}
```

`useTemplateRepublish.ts` — now the PUBLISH path + cache helpers:

```ts
export function useTemplateConfigCaches(
  projectId: string | undefined,
  templateId: string | undefined,
) {
  const queryClient = useQueryClient();
  /** After a config edit: the grid + the Draft chip re-read. */
  const invalidateStructure = async (): Promise<void> => {
    if (!projectId || !templateId) return;
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: templateEntityTypesKeys.byTemplate(templateId),
      }),
      queryClient.invalidateQueries({
        queryKey: templateConfigStatusKeys.byTemplate(projectId, templateId),
      }),
    ]);
  };
  /** After a server-side publish (Publish button): run-scoped reads and
   * the ACTIVE snapshot moved too. */
  const invalidateAll = async (): Promise<void> => {
    if (!projectId || !templateId) return;
    await Promise.all([
      invalidateStructure(),
      queryClient.invalidateQueries({queryKey: runsKeys.all}),
      queryClient.invalidateQueries({
        queryKey: templateActiveStructureKeys.byTemplate(projectId, templateId),
      }),
    ]);
  };
  return {invalidateStructure, invalidateAll};
}

export function useTemplateRepublish(
  projectId: string | undefined,
  templateId: string | undefined,
) {
  const {invalidateAll} = useTemplateConfigCaches(projectId, templateId);
  const republish =
    async (): Promise<RepublishTemplateVersionResponse | null> => {
      if (!projectId || !templateId) return null;
      const result = await republishTemplateVersion(projectId, templateId);
      if (!result.ok) {
        console.error('[useTemplateRepublish] publish failed:', result.error);
        toast.error(t('extraction', 'errors_republishTemplate'));
        return null;
      }
      await invalidateAll();
      return result.data;
    };
  return {republish};
}
```

(module doc: this is the Publish path; per-edit callers are gone.)
`useFieldManagement.ts`: swap the hook import for
`useTemplateConfigCaches`; each of the five `void republish();` →
`void invalidateStructure();`.
`useUpdateTemplateField.ts`: delete `RepublishFailedError`; mutationFn
= write alone; onSuccess: toast + `void invalidateStructure()`.
`useTemplateInstruction.ts`: onSuccess invalidates
`templateInstructionKeys.byTemplate` +
`templateConfigStatusKeys.byTemplate`; `runsKeys` import goes.
`TemplateConfigEditor.tsx`: `handleSaveEdit`/`handleSectionAdded`/
`handleSectionRemoved` → `void invalidateStructure()`; the
`onTemplateImported` callback invalidates the **`.all` families**
(import may target a DIFFERENT template than the hook's args:
`templateEntityTypesKeys.all`, `templateConfigStatusKeys.all`,
`templateActiveStructureKeys.all`, `runsKeys.all` — panel finding).
`ExtractionInterface.tsx:571-574`: add `templateConfigStatusKeys.all`
to the existing `.all` invalidation set.
Copy: `errors_republishTemplate` → `'Publishing failed — your changes
are still saved as a draft. Try Publish again.'`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run` and `npx tsc -p tsconfig.app.json --noEmit` and
`npm run lint`. Expected: PASS (fix any caller the compiler flags on
the boolean→object return change).

- [ ] **Step 5: Commit**

```bash
git add frontend/hooks/extraction frontend/components/extraction \
  frontend/lib/query-keys/extraction.ts frontend/services \
  frontend/lib/copy/extraction.ts frontend/e2e/_fixtures/ensure-fixtures.ts \
  frontend/test
git commit -m "feat(frontend): config edits stop republishing — draft-first cache wiring (B-4, 6/7)"
```

### Task 7: Draft chip + Publish button

**Files:**
- Create: `frontend/hooks/extraction/useTemplateConfigStatus.ts`
- Modify: `frontend/components/extraction/TemplateConfigEditor.tsx`
  (command bar)
- Modify: `frontend/lib/copy/extraction.ts` (new keys)
- Test: `frontend/test/TemplateConfigPublish.test.tsx`

**Interfaces:**
- Consumes: `loadTemplateConfigStatus`, `templateConfigStatusKeys`,
  `useTemplateRepublish().republish` (Task 6 signature).

- [ ] **Step 1: Write the failing component test**

`TemplateConfigPublish.test.tsx` (jsdom + QueryClientProvider, mock
`@/services/templateService` and the entity-type loaders):

```
1. has_pending_changes=true  → warning chip "Unpublished changes",
   Publish ENABLED
2. has_pending_changes=false, active_version=3 → outline chip
   "Published · v3", Publish DISABLED
3. has_pending_changes=false, active_version=null → NO version chip
   (never "vundefined"), Publish DISABLED
4. status query still loading → no chip, Publish DISABLED (deliberate:
   unknown status never enables a publish)
5. status query failed → no chip, Publish DISABLED
6. click Publish → republishTemplateVersion called once; success toast
   carries the returned version; config-status refetch (invalidation spy)
7. publish failure → error toast (reworded errors_republishTemplate),
   button re-enabled
```

- [ ] **Step 2: Run to verify it fails** — chip/button don't exist.

- [ ] **Step 3: Implement**

`useTemplateConfigStatus.ts`:

```ts
import {useQuery} from '@tanstack/react-query';
import {templateConfigStatusKeys} from '@/lib/query-keys/extraction';
import {
  loadTemplateConfigStatus,
  type TemplateConfigStatus,
} from '@/services/templateService';

export function useTemplateConfigStatus(projectId: string, templateId: string) {
  return useQuery<TemplateConfigStatus, Error>({
    queryKey: templateConfigStatusKeys.byTemplate(projectId, templateId),
    queryFn: async () => {
      const result = await loadTemplateConfigStatus(projectId, templateId);
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    },
    enabled: Boolean(projectId && templateId),
  });
}
```

Copy keys:

```ts
    configPublishButton: 'Publish',
    configPublishTooltip:
      'Publish these configuration changes so reviewers and AI runs see them',
    configUnpublishedChanges: 'Unpublished changes',
    configPublishedVersion: 'Published · v{{n}}',
    configPublishSuccess: 'Published v{{n}}',
```

`TemplateConfigEditor.tsx` command bar (right cluster, before Import):
`useTemplateConfigStatus` + `useTemplateRepublish` + local `publishing`
state. Chip: pending → `Badge` with the **semantic warning tokens
exactly as `TemplateInstructionRow.tsx:90`**
(`border-warning/50 bg-warning/10 text-warning`) — never raw amber;
published → default `variant="outline"` with the version (render
nothing when `active_version` is null). Publish `Button` `size="sm"`,
`Tooltip` + `aria-label` from `configPublishTooltip`, disabled while
`publishing` or unless `configStatus?.has_pending_changes === true`
(loading/error → disabled). `handlePublish`:

```tsx
const handlePublish = async () => {
  setPublishing(true);
  const result = await republish();
  setPublishing(false);
  if (result) {
    toast.success(
      t('extraction', 'configPublishSuccess').replace(
        '{{n}}',
        String(result.version),
      ),
    );
  }
};
```

(failure toast already lives in the hook).

- [ ] **Step 4: Run tests + suite**

Run: `npm run test:run -- frontend/test/TemplateConfigPublish.test.tsx`
then `npm run test:run`, `npm run lint`,
`npx tsc -p tsconfig.app.json --noEmit`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/hooks/extraction/useTemplateConfigStatus.ts \
  frontend/components/extraction/TemplateConfigEditor.tsx \
  frontend/lib/copy/extraction.ts frontend/test/TemplateConfigPublish.test.tsx
git commit -m "feat(frontend): draft chip + explicit Publish on the Configuration tab (B-4, 7/7)"
```

### Verify (whole slice — Phase 4 gate)

- `make quality-scan` (lint + typecheck + tests + arch fitness) — green.
- `make test-backend` — green (needs local Supabase). Note: diff-cover
  80 runs ONLY in CI (backend, PR-only) — local green does not predict
  it; the direct-coroutine endpoint tests in Tasks 3/4/5 are what keep
  the endpoint diff above the bar.
- `npm run test:run` — green.
- Browser pass on the Configuration tab (seeded CHARMS template): edit a
  field → chip flips to "Unpublished changes", NO new version row
  (config-status response); Publish → chip flips back, version
  increments, worklist numbers move only now; re-import while pending →
  blocked toast with the 409 message.
- `git grep -n "void republish()" frontend/` → zero hits.
