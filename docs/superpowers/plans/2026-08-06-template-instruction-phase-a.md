---
status: draft
last_reviewed: 2026-08-06
owner: '@raphaelfh'
---

# Template general AI instruction (Phase A) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A template-level ✨ general AI instruction
(`llm_template_instruction`) works end-to-end — stored on both template
tables, versioned via a conditional snapshot key, injected into
extraction/QA prompts strictly from the run-pinned snapshot, copied on
clone, seeded with framework defaults, and editable by managers on the
Configuration tab through a typed endpoint.

**Architecture:** Phase A of
`docs/superpowers/specs/2026-08-05-template-config-ux-redesign-design.md`
(§4, §9-A). Backend: nullable `TEXT` column on
`extraction_templates_global` + `project_extraction_templates` (CHECK ≤
4000); `build_template_version_snapshot` emits a top-level
`llm_template_instruction` key **only when non-NULL** (absent ≡ NULL — a
legacy template's next republish produces a byte-identical snapshot, so
no phantom v+1); prompts read the instruction **only** from the run's
pinned `extraction_template_versions.schema_`; a new manager-gated
GET/PUT endpoint pair updates the project column and republishes in the
same transaction (no fire-and-forget desync). Frontend: a collapsed
"row zero" above the section accordion in `TemplateConfigEditor`,
backed by TanStack Query hooks over the typed endpoint (no new
`supabase.from` — CI forbids it).

**Tech Stack:** FastAPI + SQLAlchemy 2.0 async + Alembic + pytest;
React 19 + TS strict + TanStack Query + shadcn + vitest.

## Global constraints

- English only for code, comments, copy keys, commits.
- Alembic revision id ≤ 32 chars; filename stem == revision id;
  `down_revision = "0046_revoke_min_mgr_exec"`; every op carries
  `schema="public"`.
- Migration touches `extraction_*` ⇒ update the migration-head line +
  `last_reviewed` in `docs/reference/extraction-hitl-architecture.md`.
- `ApiResponse` envelope; typed Pydantic response models (never
  `ApiResponse[dict]`); errors surface `error.message`; every
  project-scoped endpoint BOLA-checks ownership.
- Layering `api → services → repositories → models`
  (CI: `scripts/fitness/check_layered_arch.py`); endpoints import enums
  via `app.schemas.*` re-exports, never `app.models.*`.
- No new `supabase.from(` call sites (CI:
  `scripts/fitness/check_frontend_data_path.py`).
- Frontend copy via `frontend/lib/copy/` (`t('extraction', …)`); manual
  `{{n}}` interpolation.
- React Compiler rules: no `try/finally` in component bodies; IO errors
  via service layer + toasts.
- Query keys via factories in `frontend/lib/query-keys/` (CI:
  `check_react_query_keys.py`).
- After backend schema changes: `npm run generate:api-types`; commit
  `frontend/types/api/openapi.json` + `schema.d.ts` (CI `api-contract`
  fails on drift).
- Instruction semantics: NULL ⇒ nothing injected; snapshot key emitted
  only when non-NULL; prompts NEVER read the live column; whitespace-only
  input normalizes to NULL; limit 4000 chars (Pydantic `max_length` +
  DB CHECK `char_length(...) <= 4000`).
- Spec deviation (recorded): spec §4 says "the four globals", but the
  repo now has FIVE global templates (PROBAST+AI shipped #561 after the
  spec's research window). Seed defaults cover all five.
- Frontend tests run from repo root (`npm run test:run`); backend
  `make test-backend` (needs local Supabase).

---

### Task 1: Column + CHECK on both models, migration 0047, head-pin bump

**Files:**
- Modify: `backend/app/models/extraction.py:134` (global) and `:194-196`
  (project)
- Create: `backend/alembic/versions/0047_llm_template_instruction.py`
- Modify: `backend/tests/integration/test_migration_roundtrip.py`
  (head pin + roundtrip test)
- Modify: `docs/reference/extraction-hitl-architecture.md` (head line +
  `last_reviewed`)

**Interfaces:**
- Produces: `ExtractionTemplateGlobal.llm_template_instruction: str | None`
  and `ProjectExtractionTemplate.llm_template_instruction: str | None`
  (SQLAlchemy `Text`, nullable) — used by Tasks 2, 4, 5, 6.

- [ ] **Step 1: Write the failing tests** — in
  `backend/tests/integration/test_migration_roundtrip.py`: bump the head
  pin string and add the 0047 roundtrip (mirror `test_migration_0039`
  style; downgrade to the explicit parent, never `-1`):

```python
# In test_alembic_head_is_expected_revision, replace the pinned string:
    assert "0047_llm_template_instruction" in out, (
        f"Expected head revision '0047_llm_template_instruction', got:\n{out}"
    )
```

  Then add `test_migration_0047_round_trip` by **replicating
  `test_migration_0034_round_trip` verbatim** (the column-add sibling —
  async, same fixtures/connection pattern, `information_schema.columns`
  assertions) with these substitutions: tables
  `extraction_templates_global` + `project_extraction_templates`, column
  `llm_template_instruction`, downgrade target the explicit parent
  `"0046_revoke_min_mgr_exec"` (never `-1`). Assert for BOTH tables:
  column present at head → absent after downgrade → present after
  re-upgrade. (Panel: the bare "upgrade/downgrade/upgrade doesn't error"
  form proves too little.)

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/integration/test_migration_roundtrip.py -k "head_is_expected or 0047" -x -q`
Expected: FAIL — head is `0046_revoke_min_mgr_exec`, unknown revision `0047_...`.

- [ ] **Step 3: Add the column + CHECK to both models.** In
  `backend/app/models/extraction.py`, after `schema_` in
  `ExtractionTemplateGlobal` (line 134):

```python
    llm_template_instruction: Mapped[str | None] = mapped_column(Text, nullable=True)
```

  and extend its `__table_args__`:

```python
    __table_args__ = (
        Index("idx_extraction_templates_global_schema_gin", "schema", postgresql_using="gin"),
        UniqueConstraint("id", "kind", name="uq_extraction_templates_global_id_kind"),
        # The 'ck' naming convention (app/models/base.py) expands this to
        # ck_extraction_templates_global_llm_instruction_len in the DB —
        # pass the SHORT name or it double-wraps and md5-truncates.
        CheckConstraint(
            "char_length(llm_template_instruction) <= 4000",
            name="llm_instruction_len",
        ),
        {"schema": "public"},
    )
```

  Same two edits in `ProjectExtractionTemplate` (column after
  `schema_`/`is_active`, line ~195; same short constraint name
  `llm_instruction_len` — the convention prefixes per-table). Add
  `CheckConstraint` to the existing `sqlalchemy` import line if absent.
  **Panel finding (verified empirically):** the metadata naming
  convention `ck_%(table_name)s_%(constraint_name)s` wraps EXPLICIT
  names too, and Alembic propagates it into `op.*` at runtime — a
  pre-expanded `ck_...` literal becomes an 81-char doubled name silently
  md5-truncated to 63. Short names everywhere; the
  `ck_extraction_entity_types_template_xor` full-literal precedent in
  this file is a dormant wart, not a pattern to copy.

- [ ] **Step 4: Write the migration by hand** (autogenerate is noisy on
  this repo; the 0034 pattern is the house style). Create
  `backend/alembic/versions/0047_llm_template_instruction.py`:

```python
"""Add llm_template_instruction to both template tables (spec Phase A).

Nullable TEXT + CHECK <= 4000 chars. No backfill: absent ≡ NULL by
design — the snapshot builder emits the key only when non-NULL, so
legacy templates republish byte-identically (no phantom v+1).

Downgrade restores the schema only, not the data: manager-authored
instruction text is dropped with the column (0033/0042 philosophy).

Revision ID: 0047_llm_template_instruction
Revises: 0046_revoke_min_mgr_exec
"""

import sqlalchemy as sa
from alembic import op

revision = "0047_llm_template_instruction"
down_revision = "0046_revoke_min_mgr_exec"
branch_labels = None
depends_on = None

_TABLES = ("extraction_templates_global", "project_extraction_templates")

# SHORT constraint name: the metadata naming convention (propagated into
# op.* by env.py) expands it to ck_<table>_llm_instruction_len. Passing a
# pre-expanded ck_ literal would double-wrap and md5-truncate silently.
_CONSTRAINT = "llm_instruction_len"


def upgrade() -> None:
    for table in _TABLES:
        op.add_column(
            table,
            sa.Column("llm_template_instruction", sa.Text(), nullable=True),
            schema="public",
        )
        op.create_check_constraint(
            _CONSTRAINT,
            table,
            "char_length(llm_template_instruction) <= 4000",
            schema="public",
        )


def downgrade() -> None:
    for table in _TABLES:
        op.drop_constraint(_CONSTRAINT, table, type_="check", schema="public")
        op.drop_column(table, "llm_template_instruction", schema="public")
```

  After applying, verify the real names once:
  `psql "$DATABASE_URL" -c "\d public.extraction_templates_global" | grep llm_instruction`
  must show `ck_extraction_templates_global_llm_instruction_len`.

- [ ] **Step 5: Apply + run the tests**

Run: `cd backend && uv run alembic upgrade head && uv run pytest tests/integration/test_migration_roundtrip.py -q`
Expected: PASS (all roundtrips + head pin).

- [ ] **Step 6: Update the architecture doc.** In
  `docs/reference/extraction-hitl-architecture.md`: bump the
  migration-head line to `0047_llm_template_instruction`, set
  `last_reviewed: 2026-08-06`, and add `llm_template_instruction TEXT
  NULL (CHECK ≤ 4000)` to the two template-table column lists.

- [ ] **Step 7: Commit**

```bash
git add backend/app/models/extraction.py backend/alembic/versions/0047_llm_template_instruction.py backend/tests/integration/test_migration_roundtrip.py docs/reference/extraction-hitl-architecture.md
git commit -m "feat(extraction): llm_template_instruction column on both template tables"
```

---

### Task 2: Conditional snapshot key in `build_template_version_snapshot`

**Files:**
- Modify: `backend/app/services/extraction_snapshot.py:28-79`
- Test: `backend/tests/integration/test_template_version_snapshot_shape.py`
- Test: `backend/tests/integration/test_template_version_republish.py`

**Interfaces:**
- Consumes: Task 1's `ProjectExtractionTemplate.llm_template_instruction`.
- Produces: snapshots carry top-level `"llm_template_instruction": <text>`
  **iff** the live column is non-NULL — read by Task 3's
  `general_instructions_for_version` and asserted by Task 6's service
  tests.

- [ ] **Step 1: Write the failing tests** — append to
  `test_template_version_snapshot_shape.py`:

```python
@pytest.mark.asyncio
async def test_snapshot_omits_instruction_key_when_null(
    db_session: AsyncSession,
) -> None:
    """Absent ≡ NULL: legacy templates must republish byte-identically."""
    snapshot = await build_template_version_snapshot(db_session, SEED.primary_template)
    assert "llm_template_instruction" not in snapshot


@pytest.mark.asyncio
async def test_snapshot_carries_instruction_when_set(
    db_session: AsyncSession,
) -> None:
    await db_session.execute(
        text(
            "UPDATE public.project_extraction_templates "
            "SET llm_template_instruction = 'Focus on the primary cohort.' "
            "WHERE id = :tid"
        ),
        {"tid": str(SEED.primary_template)},
    )
    snapshot = await build_template_version_snapshot(db_session, SEED.primary_template)
    assert snapshot["llm_template_instruction"] == "Focus on the primary cohort."
    # No commit: the fixture transaction rolls the UPDATE back.
```

  And in `test_template_version_republish.py` (reuse that file's
  existing fixture/service invocation style for republish — same
  arguments as its no-op test):

```python
@pytest.mark.asyncio
async def test_republish_versions_instruction_set_and_clear(
    db_session: AsyncSession,
) -> None:
    """Set → v+1 with key; same again → no-op; clear → v+1 without key."""
    svc = TemplateVersionService(db_session)
    baseline = await svc.republish(
        project_id=SEED.primary_project,
        project_template_id=SEED.primary_template,
        user_id=SEED.primary_profile,
    )

    await db_session.execute(
        text(
            "UPDATE public.project_extraction_templates "
            "SET llm_template_instruction = 'General guidance.' WHERE id = :tid"
        ),
        {"tid": str(SEED.primary_template)},
    )
    set_result = await svc.republish(
        project_id=SEED.primary_project,
        project_template_id=SEED.primary_template,
        user_id=SEED.primary_profile,
    )
    assert set_result.changed is True
    assert set_result.version == baseline.version + 1

    noop = await svc.republish(
        project_id=SEED.primary_project,
        project_template_id=SEED.primary_template,
        user_id=SEED.primary_profile,
    )
    assert noop.changed is False

    await db_session.execute(
        text(
            "UPDATE public.project_extraction_templates "
            "SET llm_template_instruction = NULL WHERE id = :tid"
        ),
        {"tid": str(SEED.primary_template)},
    )
    cleared = await svc.republish(
        project_id=SEED.primary_project,
        project_template_id=SEED.primary_template,
        user_id=SEED.primary_profile,
    )
    assert cleared.changed is True
    cleared_version = await db_session.get(ExtractionTemplateVersion, cleared.version_id)
    assert cleared_version is not None
    assert "llm_template_instruction" not in cleared_version.schema_
```

  (Adjust imports to the file's existing ones:
  `TemplateVersionService`, `ExtractionTemplateVersion`, `SEED`, `text`.)

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/integration/test_template_version_snapshot_shape.py tests/integration/test_template_version_republish.py -k instruction -q`
Expected: FAIL — `llm_template_instruction` key never emitted.

- [ ] **Step 3: Implement.** Leave `SNAPSHOT_SQL` **untouched** (its
  migration-0026 keep-in-sync WARNING stays accurate — the conditional
  key never enters the SQL key set) and append the key in Python
  (panel simplification: no behavior change for nonexistent ids, no
  caller audit needed; the no-op compare in `template_version_service`
  is Python dict equality, so a Python-appended key compares
  identically):

```python
_INSTRUCTION_SQL = text(
    """
    SELECT llm_template_instruction
    FROM public.project_extraction_templates
    WHERE id = :tid
    """
)


async def build_template_version_snapshot(
    db: AsyncSession, project_template_id: UUID
) -> dict[str, Any]:
    """Build the frozen ``{entity_types: [...]}`` snapshot for a project template."""
    row = await db.execute(SNAPSHOT_SQL, {"tid": str(project_template_id)})
    snapshot: dict[str, Any] = row.scalar_one()
    instruction = (
        await db.execute(_INSTRUCTION_SQL, {"tid": str(project_template_id)})
    ).scalar_one_or_none()
    if instruction:
        snapshot["llm_template_instruction"] = instruction
    return snapshot
```

  Append to the module docstring: the top-level
  `llm_template_instruction` key is **conditional** (appended in Python
  only when the live column is non-NULL/non-empty; absent ≡ NULL) and is
  deliberately NOT backfilled into old snapshots — unlike the
  entity-type/field key set, it has no migration-0026-style copy to keep
  in sync (0026 only rewrites snapshots lacking `role`, which all
  pre-date this key).

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/integration/test_template_version_snapshot_shape.py tests/integration/test_template_version_republish.py tests/integration/test_template_versions_lifecycle.py -q`
Expected: PASS (new + neighbouring suites).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/extraction_snapshot.py backend/tests/integration/test_template_version_snapshot_shape.py backend/tests/integration/test_template_version_republish.py
git commit -m "feat(extraction): snapshot emits llm_template_instruction only when set"
```

---

### Task 3: Prompt block + pinned-snapshot reader + service threading

**Files:**
- Modify: `backend/app/llm/prompts/__init__.py`
- Modify: `backend/app/llm/prompts/section_extraction.py`
- Modify: `backend/app/llm/prompts/quality_assessment.py`
- Modify: `backend/app/services/extraction_snapshot.py` (reader fn)
- Modify: `backend/app/services/section_extraction_service.py`
  (`_extract_with_llm` + 3 call sites: `extract_section` ~:317,
  `_extract_one_entity_type_for_run` ~:638, `_extract_section_with_memory`
  ~:1045)
- Test: `backend/tests/unit/llm/test_prompts.py`
- Test: `backend/tests/integration/test_template_version_snapshot_shape.py`
  (reader)

**Interfaces:**
- Consumes: Task 2's conditional snapshot key.
- Produces:
  - `render_general_instructions_section(general_instructions: str | None) -> str`
    in `app.llm.prompts`.
  - `section_extraction.render(..., general_instructions: str | None = None)`
    and `quality_assessment.render(..., general_instructions: str | None = None)`.
  - `general_instructions_for_version(db: AsyncSession, version_id: UUID) -> str | None`
    in `app.services.extraction_snapshot`.
  - `_extract_with_llm(..., general_instructions: str | None = None)`.

- [ ] **Step 1: Write the failing unit tests** — append to
  `backend/tests/unit/llm/test_prompts.py`:

```python
def test_general_instructions_block_leads_the_prompt():
    from app.llm.prompts import render_general_instructions_section

    assert render_general_instructions_section(None) == ""
    assert render_general_instructions_section("") == ""

    extraction = section_extraction.render(
        entity_name="Population",
        entity_description="Who was studied",
        article_text="text",
        general_instructions="Report values exactly as stated.",
    )
    assert extraction.startswith(
        "General instructions for this review:\nReport values exactly as stated.\n\n"
    )
    assert "Section: Population" in extraction

    qa = quality_assessment.render(
        entity_name="Domain 1",
        entity_description="Participant selection",
        article_text="text",
        framework="PROBAST",
        general_instructions="Judge conservatively.",
    )
    assert qa.startswith(
        "General instructions for this review:\nJudge conservatively.\n\n"
    )


def test_general_instructions_absent_when_none():
    extraction = section_extraction.render(
        entity_name="Population",
        entity_description="d",
        article_text="t",
    )
    qa = quality_assessment.render(
        entity_name="Domain 1", entity_description="d", article_text="t", framework=None
    )
    assert "General instructions" not in extraction
    assert "General instructions" not in qa
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/unit/llm/test_prompts.py -q`
Expected: FAIL — `render_general_instructions_section` undefined /
unexpected kwarg.

- [ ] **Step 3: Implement the prompt layer.** In
  `app/llm/prompts/__init__.py`:

```python
def render_general_instructions_section(general_instructions: str | None) -> str:
    """Template-level general instruction (from the run-pinned snapshot)."""
    if not general_instructions:
        return ""
    return f"General instructions for this review:\n{general_instructions}\n\n"
```

  In `section_extraction.py`: prefix the template and thread the kwarg
  (the `_USER_TEMPLATE` edit auto-bumps `VERSION` via `content_version`):

```python
_USER_TEMPLATE = """{general_instructions_section}Extract the following information from the scientific article:
...(rest unchanged)...
"""


def render(
    *,
    entity_name: str,
    entity_description: str,
    article_text: str,
    memory_context: list[dict[str, str]] | None = None,
    general_instructions: str | None = None,
) -> str:
    return _USER_TEMPLATE.format(
        entity_name=entity_name,
        entity_description=entity_description,
        memory_section=render_memory_section(memory_context),
        article_text=article_text,
        general_instructions_section=render_general_instructions_section(
            general_instructions
        ),
    )
```

  Mirror in `quality_assessment.py` (`{general_instructions_section}`
  prefixes `Assess the following domain...`; same kwarg + format arg).
  Update both modules' `from app.llm.prompts import ...` lines to add
  `render_general_instructions_section`.

- [ ] **Step 4: Unit tests pass**

Run: `cd backend && uv run pytest tests/unit/llm/test_prompts.py -q`
Expected: PASS.

- [ ] **Step 5: Failing test for the pinned reader** — append to
  `test_template_version_snapshot_shape.py`:

```python
@pytest.mark.asyncio
async def test_general_instructions_reader_prefers_pinned_snapshot(
    db_session: AsyncSession,
) -> None:
    """The prompt path reads the pinned version, never the live column."""
    from app.services.extraction_snapshot import general_instructions_for_version

    version_id = uuid.uuid4()
    await db_session.execute(
        text(
            "INSERT INTO public.extraction_template_versions "
            "(id, project_template_id, version, schema, published_by, is_active) "
            "VALUES (:id, :tid, 999, "
            " '{\"entity_types\": [], \"llm_template_instruction\": \"PINNED\"}'::jsonb, "
            " :pub, false)"
        ),
        {
            "id": str(version_id),
            "tid": str(SEED.primary_template),
            "pub": str(SEED.primary_profile),
        },
    )
    await db_session.execute(
        text(
            "UPDATE public.project_extraction_templates "
            "SET llm_template_instruction = 'LIVE' WHERE id = :tid"
        ),
        {"tid": str(SEED.primary_template)},
    )
    assert await general_instructions_for_version(db_session, version_id) == "PINNED"


@pytest.mark.asyncio
async def test_general_instructions_reader_none_when_key_absent(
    db_session: AsyncSession,
) -> None:
    from app.services.extraction_snapshot import general_instructions_for_version

    active_version_id = (
        await db_session.execute(
            text(
                "SELECT id FROM public.extraction_template_versions "
                "WHERE project_template_id = :tid AND is_active"
            ),
            {"tid": str(SEED.primary_template)},
        )
    ).scalar_one()
    assert await general_instructions_for_version(db_session, active_version_id) is None
```

  (Add `import uuid` to the file.)

- [ ] **Step 6: Implement the reader** in `extraction_snapshot.py`:

```python
_GENERAL_INSTRUCTIONS_SQL = text(
    """
    SELECT schema ->> 'llm_template_instruction'
    FROM public.extraction_template_versions
    WHERE id = :vid
    """
)


async def general_instructions_for_version(
    db: AsyncSession, version_id: UUID
) -> str | None:
    """Template-level general instruction pinned in a version snapshot.

    Prompts must read the pinned snapshot, never the live column — a run
    keeps the instruction it was opened under until a republish re-pins
    it (spec §4). Returns None when the version has no key (legacy) or
    the value is empty.
    """
    value = (
        await db.execute(_GENERAL_INSTRUCTIONS_SQL, {"vid": str(version_id)})
    ).scalar_one_or_none()
    return value or None
```

- [ ] **Step 7: Thread through the service.** In
  `section_extraction_service.py`:
  - Import: `from app.services.extraction_snapshot import general_instructions_for_version`.
  - `_extract_with_llm` gains `general_instructions: str | None = None`
    (documented in its docstring: "Template-level instruction from the
    run-pinned snapshot; prepended to the user prompt when present").
    Pass `general_instructions=general_instructions` to **all four**
    `render(...)` calls (two live at ~:1225/:1235, two composition
    re-renders at ~:1272/:1280 — the persisted composition must stay
    byte-faithful).
  - At each of the three call sites, fetch once and pass:

```python
            general_instructions = await general_instructions_for_version(
                self.db, run.version_id
            )
            extracted_data, llm_usage = await self._extract_with_llm(
                pdf_text=pdf_text,
                entity_type=entity_type,
                model=model,
                general_instructions=general_instructions,
            )
```

  (In `_extract_one_entity_type_for_run` and
  `_extract_section_with_memory`, keep their existing kwargs — `kind`,
  `framework`, `memory_context`, `fields_override` — and add the new
  one.)

- [ ] **Step 8: Threading unit test** — create
  `backend/tests/unit/services/test_general_instructions_prompt.py`:

```python
"""_extract_with_llm prepends the pinned general instruction to the user
prompt (and to the persisted composition re-render)."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.llm.extractor import LlmUsage
from app.services.section_extraction_service import SectionExtractionService


class _Field:
    name = "sample_size"
    label = "Sample size"
    description = ""
    field_type = "number"
    is_required = False
    validation_schema = None
    allowed_values = None
    unit = None
    allowed_units = None
    allow_other = False
    other_label = None
    other_placeholder = None
    allows_not_applicable = False
    allows_not_evaluated = False


class _EntityType:
    name = "Population"
    description = "Who was studied"
    fields = [_Field()]


@pytest.mark.asyncio
async def test_extract_with_llm_prepends_general_instructions(monkeypatch) -> None:
    captured: dict[str, str] = {}

    async def fake_extract_structured(**kwargs):
        captured["user_prompt"] = kwargs["user_prompt"]
        return MagicMock(), LlmUsage()

    monkeypatch.setattr(
        "app.services.section_extraction_service.extract_structured",
        fake_extract_structured,
    )
    monkeypatch.setattr(
        "app.services.section_extraction_service.dump_extraction",
        lambda output: {},
    )
    # Unconditional: build_model raises MissingLLMKeyError without a key;
    # every existing direct _extract_with_llm test patches it.
    monkeypatch.setattr(
        "app.services.section_extraction_service.build_model",
        lambda *a, **k: MagicMock(),
    )

    service = SectionExtractionService(
        db=AsyncMock(),
        user_id="00000000-0000-0000-0000-000000000001",
        storage=MagicMock(),
        trace_id="t",
    )
    await service._extract_with_llm(
        pdf_text="ARTICLE",
        entity_type=_EntityType(),
        model="gpt-test",
        general_instructions="Report values exactly as stated.",
    )
    assert captured["user_prompt"].startswith(
        "General instructions for this review:\nReport values exactly as stated.\n\n"
    )
    # Constitution §IX: the persisted composition re-render must be
    # byte-faithful — it carries the same leading block.
    composition = service._run_provenance["prompt_composition"]
    assert composition["section_instruction"].startswith(
        "General instructions for this review:\nReport values exactly as stated.\n\n"
    )
```

- [ ] **Step 8b: The §9-A headline invariant — a call site passes the
  PINNED value, not live/active** (panel BLOCKING: without this, an
  implementation reading the live column or the active version leaves
  every other test green). Append to
  `backend/tests/integration/test_qa_extraction_skip_flag_field_delete.py`,
  reusing that file's existing run/service scaffolding (it already
  builds a real run and calls `_extract_one_entity_type_for_run` with a
  stubbed `_extract_with_llm` around lines 125-141 — mirror its setup
  helpers exactly):

```python
@pytest.mark.asyncio
async def test_call_site_passes_pinned_not_live_instruction(
    db_session: AsyncSession,
) -> None:
    """Reopened/old runs keep the instruction they were pinned under."""
    # ... build service + run exactly like the sibling test above ...
    old_version_id = uuid.uuid4()
    await db_session.execute(
        text(
            "INSERT INTO public.extraction_template_versions "
            "(id, project_template_id, version, schema, published_by, is_active) "
            "VALUES (:id, :tid, 998, "
            " '{\"entity_types\": [], \"llm_template_instruction\": \"PINNED\"}'::jsonb, "
            " :pub, false)"
        ),
        {"id": str(old_version_id), "tid": str(template_id), "pub": str(user_id)},
    )
    await db_session.execute(
        text("UPDATE public.extraction_runs SET version_id = :vid WHERE id = :rid"),
        {"vid": str(old_version_id), "rid": str(run.id)},
    )
    await db_session.execute(
        text(
            "UPDATE public.project_extraction_templates "
            "SET llm_template_instruction = 'LIVE' WHERE id = :tid"
        ),
        {"tid": str(template_id)},
    )
    await db_session.refresh(run)

    service._extract_with_llm = AsyncMock(return_value=({}, LlmUsage()))
    await service._extract_one_entity_type_for_run(
        run=run,
        entity_type=entity_type,
        pdf_text="X",
        framework=None,
        kind="extraction",
        skip_fields_with_human_proposals=False,
        model="gpt-test",
    )
    assert (
        service._extract_with_llm.call_args.kwargs["general_instructions"] == "PINNED"
    )
```

  (Adapt variable names — `template_id`, `run`, `entity_type`,
  `user_id`, `service` — to the sibling test's fixtures; add the
  `uuid`/`AsyncMock`/`LlmUsage` imports that file lacks. Accepted
  residual risk, recorded: the third call site
  `_extract_section_with_memory` has no direct test — its fetch line is
  shape-identical to this one and mypy pins the kwarg name.)

- [ ] **Step 9: Run the suites**

Run: `cd backend && uv run pytest tests/unit/llm/test_prompts.py tests/unit/services/test_general_instructions_prompt.py tests/integration/test_template_version_snapshot_shape.py tests/integration/test_qa_extraction_skip_flag_field_delete.py -q`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add backend/app/llm/prompts/ backend/app/services/extraction_snapshot.py backend/app/services/section_extraction_service.py backend/tests/
git commit -m "feat(extraction): inject pinned general instruction into extraction/QA prompts"
```

---

### Task 4: Clone copies the column

**Files:**
- Modify: `backend/app/services/template_clone_service.py:182-193`
- Test: `backend/tests/integration/test_template_clone_extraction.py`

**Interfaces:**
- Consumes: Task 1 columns.
- Produces: fresh clones inherit the global's instruction; v1 snapshot
  carries the key (via Task 2).

- [ ] **Step 1: Write the failing test** — append to
  `test_template_clone_extraction.py`, mirroring its existing
  clone-invocation fixture style (global template setup + `TemplateCloneService.clone`):

```python
@pytest.mark.asyncio
async def test_clone_copies_llm_template_instruction(
    db_session: AsyncSession,
) -> None:
    """Imports are born with the framework-tuned default (spec §4)."""
    await db_session.execute(
        text(
            "UPDATE public.extraction_templates_global "
            "SET llm_template_instruction = 'Framework default text.' "
            "WHERE id = :gid"
        ),
        {"gid": str(GLOBAL_TEMPLATE_ID)},
    )
    result = await TemplateCloneService(db_session).clone(
        project_id=SEED.secondary_project,
        global_template_id=GLOBAL_TEMPLATE_ID,
        user_id=SEED.primary_profile,
        kind=TemplateKind.EXTRACTION,
    )
    project_value = (
        await db_session.execute(
            text(
                "SELECT llm_template_instruction "
                "FROM public.project_extraction_templates WHERE id = :tid"
            ),
            {"tid": str(result.project_template_id)},
        )
    ).scalar_one()
    assert project_value == "Framework default text."

    v1_schema = (
        await db_session.execute(
            text(
                "SELECT schema FROM public.extraction_template_versions "
                "WHERE id = :vid"
            ),
            {"vid": str(result.version_id)},
        )
    ).scalar_one()
    assert v1_schema["llm_template_instruction"] == "Framework default text."
```

  (Use the file's existing constant for a seeded global extraction
  template id — e.g. the CHARMS global id it already clones — and its
  existing imports; pick a project that has no prior clone of that
  global so the fresh-clone path runs.)

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/integration/test_template_clone_extraction.py -k instruction -q`
Expected: FAIL — project value is None.

- [ ] **Step 3: Implement** — one line in the constructor at
  `template_clone_service.py:182`:

```python
        project_tpl = ProjectExtractionTemplate(
            project_id=project_id,
            global_template_id=global_template_id,
            name=global_tpl.name,
            description=global_tpl.description,
            framework=global_tpl.framework,
            version=global_tpl.version,
            kind=global_tpl.kind,
            schema_=global_tpl.schema_ or {},
            llm_template_instruction=global_tpl.llm_template_instruction,
            is_active=True,
            created_by=user_id,
        )
```

  Note: the existing-clone (re-import) path deliberately does NOT touch
  the project's instruction — customized text survives re-import, and
  the self-heal drift check compares structure counts only.

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/integration/test_template_clone_extraction.py tests/integration/test_template_clone_service.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/template_clone_service.py backend/tests/integration/test_template_clone_extraction.py
git commit -m "feat(extraction): clone copies llm_template_instruction global to project"
```

---

### Task 5: Seed defaults (fill-if-null, all five globals)

**Files:**
- Modify: `backend/app/seed.py` (instruction map + backfill pass +
  `main()` wiring)
- Test: `backend/tests/integration/test_seed_llm_instructions.py` (new)

**Interfaces:**
- Consumes: Task 1 column on `extraction_templates_global`.
- Produces: `backfill_llm_template_instructions(session)` — idempotent,
  never clobbers non-NULL text. Called from `seed.main()`.

- [ ] **Step 1: Write the failing test** — create
  `backend/tests/integration/test_seed_llm_instructions.py`:

```python
"""Seed fill-if-null for template general AI instructions (spec §4).

The seeders early-return when a template exists, so defaults are
delivered by a separate idempotent backfill pass that never clobbers
customized text.
"""

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.seed import backfill_llm_template_instructions

_TEMPLATE_NAMES = (
    "CHARMS",
    "CHARMS + Multimodal (ML prediction)",
    "PROBAST",
    "QUADAS-2",
    "PROBAST+AI",
)


@pytest.mark.asyncio
async def test_backfill_fills_null_instructions(db_session: AsyncSession) -> None:
    await db_session.execute(
        text(
            "UPDATE public.extraction_templates_global "
            "SET llm_template_instruction = NULL"
        )
    )
    await backfill_llm_template_instructions(db_session)
    for name in _TEMPLATE_NAMES:
        value = (
            await db_session.execute(
                text(
                    "SELECT llm_template_instruction "
                    "FROM public.extraction_templates_global WHERE name = :name"
                ),
                {"name": name},
            )
        ).scalar_one()
        assert value, f"{name} should have a seeded instruction"
        assert len(value) <= 4000


@pytest.mark.asyncio
async def test_backfill_never_clobbers_customized_text(
    db_session: AsyncSession,
) -> None:
    await db_session.execute(
        text(
            "UPDATE public.extraction_templates_global "
            "SET llm_template_instruction = 'CUSTOMIZED' WHERE name = 'CHARMS'"
        )
    )
    await backfill_llm_template_instructions(db_session)
    value = (
        await db_session.execute(
            text(
                "SELECT llm_template_instruction "
                "FROM public.extraction_templates_global WHERE name = 'CHARMS'"
            )
        )
    ).scalar_one()
    assert value == "CUSTOMIZED"
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/integration/test_seed_llm_instructions.py -q`
Expected: FAIL — import error (`backfill_llm_template_instructions` missing).

- [ ] **Step 3: Implement in `backend/app/seed.py`.** Near the template
  id constants, add the five default texts (spec deviation recorded in
  Global Constraints: five globals, not four):

```python
# Template-level general AI instructions (spec Phase A §4). Delivered by
# ``backfill_llm_template_instructions`` — fill-if-null, so re-running the
# seed never clobbers text a manager customized. ``[customize: ...]``
# slots are deliberate: the UI surfaces them until the manager resolves
# them (they are sent verbatim to the AI until then).
_LLM_TEMPLATE_INSTRUCTIONS: dict[UUID, str] = {
    _CHARMS_TEMPLATE_ID: (
        "This review extracts data from studies that develop or validate "
        "clinical prediction models, following the CHARMS checklist. "
        "Report values exactly as the article states them — do not convert "
        "units, pool cohorts, or infer unreported values. When a study "
        "reports several models or cohorts, extract each one separately "
        "rather than averaging. Prefer precise numbers from tables over "
        "rounded prose values, and quote the passage that supports each "
        "value. [customize: name the target condition, population, and "
        "outcome this review focuses on]"
    ),
    _MM_TEMPLATE_ID: (
        "This review extracts data from studies of multimodal "
        "machine-learning prediction models, following an extended CHARMS "
        "checklist. Keep each data modality (imaging, text, structured "
        "data, signals) distinct as the authors describe them, and record "
        "the fusion approach without collapsing modalities. Report "
        "performance exactly as stated, per model and per validation "
        "split, and quote the passage that supports each value. "
        "[customize: name the target condition, population, and outcome "
        "this review focuses on]"
    ),
    _PROBAST_TEMPLATE_ID: (
        "This appraisal judges the risk of bias of prediction-model "
        "studies using PROBAST. Judge strictly from what the article "
        "reports: absence of information is a reason for concern, never "
        "reassurance. Answer each signaling question conservatively and "
        "quote the passage that grounds the judgment. [customize: "
        "describe the review's intended setting and population so "
        "applicability judgments have a reference point]"
    ),
    _QUADAS2_TEMPLATE_ID: (
        "This appraisal judges the risk of bias and applicability of "
        "diagnostic accuracy studies using QUADAS-2. Judge each domain "
        "strictly from the reported conduct of the study — do not assume "
        "unreported safeguards were in place. Quote the passage that "
        "grounds each judgment. [customize: state the review question — "
        "index test, target condition, and intended-use setting — that "
        "applicability is judged against]"
    ),
}


async def backfill_llm_template_instructions(session: AsyncSession) -> None:
    """Fill-if-null: seed the framework default on globals that have none.

    Separate from the per-template seeders (which early-return when the
    template exists), so existing databases receive new defaults while a
    manager's customized text is never overwritten. Idempotent.
    """
    from app.seed_probast_ai import _PROBAST_AI_TEMPLATE_ID

    instructions = {
        **_LLM_TEMPLATE_INSTRUCTIONS,
        _PROBAST_AI_TEMPLATE_ID: (
            "This appraisal judges the risk of bias of AI and "
            "machine-learning prediction-model studies using PROBAST+AI. "
            "Judge strictly from what the article reports, with particular "
            "attention to data leakage, train/test split hygiene, and "
            "evaluation practices specific to machine learning. Absence of "
            "information is a reason for concern, never reassurance. Quote "
            "the passage that grounds each judgment. [customize: describe "
            "the review's intended setting, population, and model scope]"
        ),
    }
    for template_id, instruction_text in instructions.items():
        await session.execute(
            update(ExtractionTemplateGlobal)
            .where(
                ExtractionTemplateGlobal.id == template_id,
                ExtractionTemplateGlobal.llm_template_instruction.is_(None),
            )
            .values(llm_template_instruction=instruction_text)
        )
```

  Wire into `main()` after `seed_probast_ai(session)`:

```python
            await backfill_llm_template_instructions(session)
```

  (Local import of `_PROBAST_AI_TEMPLATE_ID` mirrors `main()`'s local
  import of `seed_probast_ai` — avoids a module-level cycle. Ensure
  `update` is imported from `sqlalchemy` and `AsyncSession` from
  `sqlalchemy.ext.asyncio` at the top of seed.py; add if missing.)

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/integration/test_seed_llm_instructions.py tests/integration/test_qa_seed.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/seed.py backend/tests/integration/test_seed_llm_instructions.py
git commit -m "feat(seed): fill-if-null general AI instruction defaults for the five globals"
```

---

### Task 6: GET/PUT endpoint + service + schemas + generated types

**Files:**
- Modify: `backend/app/schemas/hitl_session.py`
- Modify: `backend/app/services/template_version_service.py` (optional
  `llm_template_instruction` kwarg on `republish`, applied under its locks)
- Create: `backend/app/services/template_instruction_service.py`
- Modify: `backend/app/api/v1/endpoints/project_templates.py`
- Test: `backend/tests/integration/test_template_instruction_service.py` (new)
- Test: `backend/tests/integration/test_membership_guards.py` (2 cases)
- Test: `backend/tests/unit/test_template_instruction_endpoint.py` (new)
- Regenerate: `frontend/types/api/openapi.json`, `frontend/types/api/schema.d.ts`

**Interfaces:**
- Consumes: Tasks 1–2 (column + snapshot key), `TemplateVersionService.republish`.
- Produces (consumed by Task 7's frontend service):
  - `GET /api/v1/projects/{project_id}/templates/{template_id}/llm-instruction`
    → `ApiResponse[TemplateInstructionRead]`
  - `PUT` same path, body `UpdateTemplateInstructionRequest`
    → `ApiResponse[UpdateTemplateInstructionResponse]`
  - Schemas: `TemplateInstructionRead {project_template_id, llm_template_instruction, default_instruction}`;
    `UpdateTemplateInstructionRequest {llm_template_instruction: str | None (max_length=4000)}`;
    `UpdateTemplateInstructionResponse {project_template_id, llm_template_instruction, version_id, version, changed, repinned_run_count}`.
  - Service: `get_template_instruction(db, *, project_id, template_id) -> TemplateInstructionRead`;
    `set_template_instruction(db, *, project_id, template_id, llm_template_instruction, user_id) -> UpdateTemplateInstructionResponse`
    (raises `ProjectTemplateNotFoundError`; does NOT commit — endpoint commits).
  - `TemplateVersionService.republish(..., llm_template_instruction: str | None | _Unset = UNSET)`
    — when provided, the column UPDATE executes INSIDE republish's
    locked section (after the advisory locks + FOR UPDATE re-select,
    before the snapshot build). **Panel MAJOR (lock order):** writing
    the column before republish's advisory locks inverts the documented
    lock order (`template_version_service.py:90-95`) and ABBA-deadlocks
    against a concurrent structure republish or session-open on a
    template with editable runs — the exact state this feature re-pins.

- [ ] **Step 1: Failing service tests** — create
  `backend/tests/integration/test_template_instruction_service.py`:

```python
"""template_instruction_service: BOLA guard, normalization, atomic
column-update + republish (no fire-and-forget desync)."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.project_template_active_service import ProjectTemplateNotFoundError
from app.services.template_instruction_service import (
    get_template_instruction,
    set_template_instruction,
)
from tests.integration.conftest import SEED


@pytest.mark.asyncio
async def test_set_updates_column_and_republishes(db_session: AsyncSession) -> None:
    result = await set_template_instruction(
        db_session,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        llm_template_instruction="Report values exactly as stated.",
        user_id=SEED.primary_profile,
    )
    assert result.llm_template_instruction == "Report values exactly as stated."
    assert result.changed is True

    snapshot = (
        await db_session.execute(
            text(
                "SELECT schema FROM public.extraction_template_versions "
                "WHERE id = :vid"
            ),
            {"vid": str(result.version_id)},
        )
    ).scalar_one()
    assert snapshot["llm_template_instruction"] == "Report values exactly as stated."

    same_again = await set_template_instruction(
        db_session,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        llm_template_instruction="Report values exactly as stated.",
        user_id=SEED.primary_profile,
    )
    assert same_again.changed is False
    assert same_again.version == result.version


@pytest.mark.asyncio
async def test_clear_and_whitespace_normalize_to_null(
    db_session: AsyncSession,
) -> None:
    await set_template_instruction(
        db_session,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        llm_template_instruction="Some text.",
        user_id=SEED.primary_profile,
    )
    cleared = await set_template_instruction(
        db_session,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        llm_template_instruction="   \n  ",
        user_id=SEED.primary_profile,
    )
    assert cleared.llm_template_instruction is None
    assert cleared.changed is True
    # Key-absent snapshot content is Task 2's contract — no re-assert here.


@pytest.mark.asyncio
async def test_set_is_bola_guarded(db_session: AsyncSession) -> None:
    with pytest.raises(ProjectTemplateNotFoundError):
        await set_template_instruction(
            db_session,
            project_id=SEED.secondary_project,
            template_id=SEED.primary_template,
            llm_template_instruction="X",
            user_id=SEED.primary_profile,
        )
    value = (
        await db_session.execute(
            text(
                "SELECT llm_template_instruction "
                "FROM public.project_extraction_templates WHERE id = :tid"
            ),
            {"tid": str(SEED.primary_template)},
        )
    ).scalar_one()
    assert value != "X"


_CHARMS_GLOBAL_ID = uuid.UUID("000c0000-0000-0000-0000-000000000001")


@pytest.mark.asyncio
async def test_get_returns_value_and_origin_default(
    db_session: AsyncSession,
) -> None:
    """default_instruction sources from the origin global. Clone-based
    fixture (panel: no hand-maintained INSERT column lists)."""
    await db_session.execute(
        text(
            "UPDATE public.extraction_templates_global "
            "SET llm_template_instruction = 'Origin default.' WHERE id = :gid"
        ),
        {"gid": str(_CHARMS_GLOBAL_ID)},
    )
    clone = await TemplateCloneService(db_session).clone(
        project_id=SEED.secondary_project,
        global_template_id=_CHARMS_GLOBAL_ID,
        user_id=SEED.primary_profile,
        kind=TemplateKind.EXTRACTION,
    )
    # Clones are born WITH the copied text (Task 4); null the project
    # column to isolate the default_instruction read path.
    await db_session.execute(
        text(
            "UPDATE public.project_extraction_templates "
            "SET llm_template_instruction = NULL WHERE id = :tid"
        ),
        {"tid": str(clone.project_template_id)},
    )
    read = await get_template_instruction(
        db_session,
        project_id=SEED.secondary_project,
        template_id=clone.project_template_id,
    )
    assert read.llm_template_instruction is None
    assert read.default_instruction == "Origin default."

    with pytest.raises(ProjectTemplateNotFoundError):
        await get_template_instruction(
            db_session,
            project_id=SEED.primary_project,
            template_id=clone.project_template_id,
        )
```

  (Extra imports for this file: `TemplateCloneService` from
  `app.services.template_clone_service`, `TemplateKind` from
  `app.schemas.hitl_session`.)

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/integration/test_template_instruction_service.py -q`
Expected: FAIL — module missing.

- [ ] **Step 3: Schemas** — append to `backend/app/schemas/hitl_session.py`:

```python
class TemplateInstructionRead(BaseModel):
    project_template_id: UUID
    llm_template_instruction: str | None
    default_instruction: str | None
    """The origin global template's instruction (None for custom templates)."""


class UpdateTemplateInstructionRequest(BaseModel):
    llm_template_instruction: str | None = Field(default=None, max_length=4000)


class UpdateTemplateInstructionResponse(BaseModel):
    project_template_id: UUID
    llm_template_instruction: str | None
    version_id: UUID
    version: int
    changed: bool
    repinned_run_count: int
```

  (Add `Field` to the existing `pydantic` import if absent.)

- [ ] **Step 4a: Republish gains the column write, under its own locks.**
  In `backend/app/services/template_version_service.py` (panel MAJOR —
  lock-order fix; `update` and `ProjectExtractionTemplate` are already
  imported there):

```python
class _Unset:
    """Sentinel: distinguishes 'kwarg not provided' from an explicit None."""


UNSET = _Unset()
```

  `republish` signature gains the kwarg:

```python
    async def republish(
        self,
        *,
        project_id: UUID,
        project_template_id: UUID,
        user_id: UUID,
        llm_template_instruction: str | None | _Unset = UNSET,
    ) -> RepublishResult:
```

  and immediately AFTER the existing `with_for_update()` re-select
  (line ~116-120), BEFORE `build_template_version_snapshot`:

```python
        if not isinstance(llm_template_instruction, _Unset):
            # Applied under the same locks as the snapshot build. Writing
            # the column before the advisory locks (e.g. in a caller)
            # would invert the documented lock order above and deadlock
            # against session-open / a concurrent republish.
            await self.db.execute(
                update(ProjectExtractionTemplate)
                .where(ProjectExtractionTemplate.id == project_template_id)
                .values(llm_template_instruction=llm_template_instruction)
            )
```

  Add `_Unset` / `UNSET` to `__all__`. Every existing caller passes no
  kwarg → behavior unchanged.

- [ ] **Step 4b: Service** — create
  `backend/app/services/template_instruction_service.py`:

```python
"""Read/update a project template's general AI instruction (spec Phase A).

The column write happens INSIDE ``TemplateVersionService.republish``'s
locked section (advisory locks → row FOR UPDATE → write → snapshot), so
the live column and the active snapshot can never desync the way the
PostgREST-write + fire-and-forget-republish path could — and the write
cannot invert the republish lock order (ABBA deadlock).
"""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionTemplateGlobal, ProjectExtractionTemplate
from app.schemas.hitl_session import (
    TemplateInstructionRead,
    UpdateTemplateInstructionResponse,
)
from app.services.project_template_active_service import ProjectTemplateNotFoundError
from app.services.template_version_service import TemplateVersionService


async def _owned_template(
    db: AsyncSession, *, project_id: UUID, template_id: UUID
) -> ProjectExtractionTemplate:
    """BOLA guard: 404 (not 403) so foreign ids don't leak existence.

    Read-only — callers must not mutate the returned row directly (an
    autoflushed UPDATE before republish's locks would re-introduce the
    lock-order inversion).
    """
    tpl = await db.get(ProjectExtractionTemplate, template_id)
    if tpl is None or tpl.project_id != project_id:
        raise ProjectTemplateNotFoundError(f"Template {template_id} not found")
    return tpl


async def get_template_instruction(
    db: AsyncSession, *, project_id: UUID, template_id: UUID
) -> TemplateInstructionRead:
    tpl = await _owned_template(db, project_id=project_id, template_id=template_id)
    default_instruction: str | None = None
    if tpl.global_template_id is not None:
        origin = await db.get(ExtractionTemplateGlobal, tpl.global_template_id)
        if origin is not None:
            default_instruction = origin.llm_template_instruction
    return TemplateInstructionRead(
        project_template_id=tpl.id,
        llm_template_instruction=tpl.llm_template_instruction,
        default_instruction=default_instruction,
    )


async def set_template_instruction(
    db: AsyncSession,
    *,
    project_id: UUID,
    template_id: UUID,
    llm_template_instruction: str | None,
    user_id: UUID,
) -> UpdateTemplateInstructionResponse:
    """Normalize and write the column inside republish (caller commits)."""
    await _owned_template(db, project_id=project_id, template_id=template_id)
    normalized = (llm_template_instruction or "").strip() or None
    republished = await TemplateVersionService(db).republish(
        project_id=project_id,
        project_template_id=template_id,
        user_id=user_id,
        llm_template_instruction=normalized,
    )
    return UpdateTemplateInstructionResponse(
        project_template_id=template_id,
        llm_template_instruction=normalized,
        version_id=republished.version_id,
        version=republished.version,
        changed=republished.changed,
        repinned_run_count=republished.repinned_run_count,
    )
```

- [ ] **Step 5: Endpoints** — append to
  `backend/app/api/v1/endpoints/project_templates.py` (imports: the two
  service functions, `ProjectTemplateNotFoundError` from
  `app.services.project_template_active_service` — already imported —
  and the three schemas from `app.schemas.hitl_session`):

```python
@router.get(
    "/{project_id}/templates/{template_id}/llm-instruction",
)
async def get_template_llm_instruction(
    project_id: UUID,
    template_id: UUID,
    request: Request,
    db: DbSession,
    _user_sub: UUID = Depends(require_project_manager),
) -> ApiResponse[TemplateInstructionRead]:
    """Current general AI instruction + the origin global's default.

    Manager-gated like the sibling endpoints — the Configuration tab is
    the only consumer.
    """
    try:
        result = await get_template_instruction(
            db, project_id=project_id, template_id=template_id
        )
    except ProjectTemplateNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return ApiResponse.success(
        result,
        trace_id=getattr(request.state, "trace_id", None),
    )


@router.put(
    "/{project_id}/templates/{template_id}/llm-instruction",
)
async def update_template_llm_instruction(
    project_id: UUID,
    template_id: UUID,
    body: UpdateTemplateInstructionRequest,
    request: Request,
    db: DbSession,
    current_user_sub: UUID = Depends(require_project_manager),
) -> ApiResponse[UpdateTemplateInstructionResponse]:
    """Set/clear the instruction and republish in one transaction.

    Whitespace-only normalizes to NULL (nothing injected). Editable-stage
    runs are re-pinned by the republish so open forms and the next AI
    extraction pick the change up; runs from consensus on keep the
    instruction they were assessed under.
    """
    try:
        result = await set_template_instruction(
            db,
            project_id=project_id,
            template_id=template_id,
            llm_template_instruction=body.llm_template_instruction,
            user_id=current_user_sub,
        )
    except (ProjectTemplateNotFoundError, TemplateNotFoundError) as e:
        # TemplateNotFoundError: the inner republish ownership re-check —
        # reachable if the template is deleted between our BOLA check and
        # the locked section (TOCTOU window). Same 404 semantics.
        raise HTTPException(status_code=404, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(
        result,
        trace_id=getattr(request.state, "trace_id", None),
    )
```

- [ ] **Step 6: Endpoint-coroutine unit tests** (ASGI blind spot —
  diff-cover needs direct calls). Create
  `backend/tests/unit/test_template_instruction_endpoint.py` mirroring
  `tests/unit/test_run_write_endpoints_unit.py` (the direct-coroutine
  exemplar whose docstring names the blind spot; NOT
  `test_articles_export_endpoint.py`, which is the httpx/ASGITransport
  pattern — the blind spot itself):

```python
"""Direct endpoint-coroutine tests (httpx/ASGI lines don't register in
diff-cover — see reference_backend_diff_coverage_asgi_blindspot)."""

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

import app.api.v1.endpoints.project_templates as endpoint_module
from app.schemas.hitl_session import (
    TemplateInstructionRead,
    UpdateTemplateInstructionRequest,
    UpdateTemplateInstructionResponse,
)
from app.services.project_template_active_service import ProjectTemplateNotFoundError


def _request() -> MagicMock:
    request = MagicMock()
    request.state.trace_id = "trace-1"
    return request


@pytest.mark.asyncio
async def test_get_llm_instruction_wraps_service_result(monkeypatch) -> None:
    template_id = uuid.uuid4()
    read = TemplateInstructionRead(
        project_template_id=template_id,
        llm_template_instruction="X",
        default_instruction=None,
    )
    monkeypatch.setattr(
        endpoint_module, "get_template_instruction", AsyncMock(return_value=read)
    )
    response = await endpoint_module.get_template_llm_instruction(
        project_id=uuid.uuid4(),
        template_id=template_id,
        request=_request(),
        db=AsyncMock(),
        _user_sub=uuid.uuid4(),
    )
    assert response.ok is True
    assert response.data is read
    assert response.trace_id == "trace-1"


@pytest.mark.asyncio
async def test_get_llm_instruction_maps_not_found_to_404(monkeypatch) -> None:
    monkeypatch.setattr(
        endpoint_module,
        "get_template_instruction",
        AsyncMock(side_effect=ProjectTemplateNotFoundError("nope")),
    )
    with pytest.raises(HTTPException) as exc:
        await endpoint_module.get_template_llm_instruction(
            project_id=uuid.uuid4(),
            template_id=uuid.uuid4(),
            request=_request(),
            db=AsyncMock(),
            _user_sub=uuid.uuid4(),
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_put_llm_instruction_commits_and_wraps(monkeypatch) -> None:
    template_id = uuid.uuid4()
    result = UpdateTemplateInstructionResponse(
        project_template_id=template_id,
        llm_template_instruction="X",
        version_id=uuid.uuid4(),
        version=2,
        changed=True,
        repinned_run_count=1,
    )
    monkeypatch.setattr(
        endpoint_module, "set_template_instruction", AsyncMock(return_value=result)
    )
    db = AsyncMock()
    response = await endpoint_module.update_template_llm_instruction(
        project_id=uuid.uuid4(),
        template_id=template_id,
        body=UpdateTemplateInstructionRequest(llm_template_instruction="X"),
        request=_request(),
        db=db,
        current_user_sub=uuid.uuid4(),
    )
    assert response.ok is True
    assert response.data is result
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_put_llm_instruction_maps_not_found_to_404(monkeypatch) -> None:
    monkeypatch.setattr(
        endpoint_module,
        "set_template_instruction",
        AsyncMock(side_effect=ProjectTemplateNotFoundError("nope")),
    )
    db = AsyncMock()
    with pytest.raises(HTTPException) as exc:
        await endpoint_module.update_template_llm_instruction(
            project_id=uuid.uuid4(),
            template_id=uuid.uuid4(),
            body=UpdateTemplateInstructionRequest(llm_template_instruction="X"),
            request=_request(),
            db=db,
            current_user_sub=uuid.uuid4(),
        )
    assert exc.value.status_code == 404
    db.commit.assert_not_awaited()


def test_request_schema_rejects_over_4000_chars() -> None:
    import pydantic

    with pytest.raises(pydantic.ValidationError):
        UpdateTemplateInstructionRequest(llm_template_instruction="x" * 4001)
```

- [ ] **Step 6b: Membership-guard 403 tests** (panel: the
  `Depends(require_project_manager)` annotation is the entire
  enforcement and no planned test executed it; repo convention is one
  guard test per endpoint). In
  `backend/tests/integration/test_membership_guards.py`, mirror
  `test_patch_template_active_403_for_non_member` (line ~460) and
  `test_clone_template_403_for_non_member` (line ~481) exactly — same
  client fixture, same non-member identity — with two new cases hitting
  `GET` and `PUT`
  `/api/v1/projects/{project_id}/templates/{template_id}/llm-instruction`
  (PUT body `{"llm_template_instruction": "x"}`), both asserting 403.

- [ ] **Step 7: Run the suites**

Run: `cd backend && uv run pytest tests/integration/test_template_instruction_service.py tests/unit/test_template_instruction_endpoint.py -q`
Expected: PASS.

- [ ] **Step 8: Regenerate the API contract**

Run: `npm run generate:api-types` (repo root)
Expected: `frontend/types/api/openapi.json` + `schema.d.ts` gain the two
paths + three schemas. `git diff --stat` shows only those two files.

- [ ] **Step 9: Commit**

```bash
git add backend/app/schemas/hitl_session.py backend/app/services/template_instruction_service.py backend/app/api/v1/endpoints/project_templates.py backend/tests/ frontend/types/api/
git commit -m "feat(api): GET/PUT template llm-instruction endpoints with atomic republish"
```

---

### Task 7: Frontend service + query keys + hooks

**Files:**
- Create: `frontend/services/templateInstructionService.ts`
- Modify: `frontend/lib/query-keys/extraction.ts` (+ re-export in
  `frontend/lib/query-keys/index.ts`)
- Create: `frontend/hooks/extraction/useTemplateInstruction.ts`
- Test: `frontend/test/hooks/useTemplateInstruction.test.tsx` (new)

**Interfaces:**
- Consumes: Task 6's generated `components['schemas']` types + endpoints.
- Produces (consumed by Task 8):
  - `getTemplateInstruction(projectId: string, templateId: string): Promise<TemplateInstructionRead>`
  - `updateTemplateInstruction(projectId: string, templateId: string, value: string | null): Promise<UpdateTemplateInstructionResponse>`
  - `templateInstructionKeys.byTemplate(projectId, templateId)`
  - `useTemplateInstruction(projectId, templateId)` (query)
  - `useUpdateTemplateInstruction(projectId, templateId)` (mutation;
    invalidates `templateInstructionKeys.byTemplate` + `runsKeys.all`).

- [ ] **Step 1: Failing hook test** — create
  `frontend/test/hooks/useTemplateInstruction.test.tsx` (mirror
  `frontend/test/hooks-hitl-config.test.tsx`'s `createWrapper` +
  service-mock pattern):

```tsx
import {renderHook, waitFor} from '@testing-library/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import type {ReactNode} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const getTemplateInstruction = vi.fn();
const updateTemplateInstruction = vi.fn();
vi.mock('@/services/templateInstructionService', () => ({
  getTemplateInstruction: (...a: unknown[]) => getTemplateInstruction(...a),
  updateTemplateInstruction: (...a: unknown[]) => updateTemplateInstruction(...a),
}));

import {
  useTemplateInstruction,
  useUpdateTemplateInstruction,
} from '@/hooks/extraction/useTemplateInstruction';
import {templateInstructionKeys} from '@/lib/query-keys/extraction';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {queries: {retry: false}, mutations: {retry: false}},
  });
  return {
    queryClient,
    wrapper: ({children}: {children: ReactNode}) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useTemplateInstruction', () => {
  it('fetches the instruction for the template', async () => {
    getTemplateInstruction.mockResolvedValue({
      project_template_id: 't1',
      llm_template_instruction: 'Text',
      default_instruction: null,
    });
    const {wrapper} = createWrapper();
    const {result} = renderHook(() => useTemplateInstruction('p1', 't1'), {wrapper});
    await waitFor(() => expect(result.current.data?.llm_template_instruction).toBe('Text'));
    expect(getTemplateInstruction).toHaveBeenCalledWith('p1', 't1');
  });
});

describe('useUpdateTemplateInstruction', () => {
  it('puts the value and invalidates the instruction query', async () => {
    updateTemplateInstruction.mockResolvedValue({
      project_template_id: 't1',
      llm_template_instruction: 'New',
      version_id: 'v2',
      version: 2,
      changed: true,
      repinned_run_count: 0,
    });
    const {queryClient, wrapper} = createWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const {result} = renderHook(() => useUpdateTemplateInstruction('p1', 't1'), {
      wrapper,
    });
    result.current.mutate('New');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(updateTemplateInstruction).toHaveBeenCalledWith('p1', 't1', 'New');
    // Factory call, NOT a literal array — check_react_query_keys.py
    // flags literal queryKey arrays anywhere under frontend/, tests
    // included (its baseline is empty and must stay so).
    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: templateInstructionKeys.byTemplate('p1', 't1'),
      }),
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:run -- frontend/test/hooks/useTemplateInstruction.test.tsx`
Expected: FAIL — modules missing.

- [ ] **Step 3: Service** — create
  `frontend/services/templateInstructionService.ts` (throwing style like
  `hitlConfigService`; hooks own the error handling):

```ts
/**
 * Template general AI instruction (spec Phase A). Typed endpoint pair —
 * the PUT updates the column AND republishes server-side in one
 * transaction, so no separate republish call is needed here.
 */
import {apiClient} from '@/integrations/api';
import type {components} from '@/types/api/schema';

export type TemplateInstructionRead =
  components['schemas']['TemplateInstructionRead'];
export type UpdateTemplateInstructionResponse =
  components['schemas']['UpdateTemplateInstructionResponse'];

export function getTemplateInstruction(
  projectId: string,
  templateId: string,
): Promise<TemplateInstructionRead> {
  return apiClient<TemplateInstructionRead>(
    `/api/v1/projects/${projectId}/templates/${templateId}/llm-instruction`,
  );
}

export function updateTemplateInstruction(
  projectId: string,
  templateId: string,
  llmTemplateInstruction: string | null,
): Promise<UpdateTemplateInstructionResponse> {
  const body: components['schemas']['UpdateTemplateInstructionRequest'] = {
    llm_template_instruction: llmTemplateInstruction,
  };
  return apiClient<UpdateTemplateInstructionResponse>(
    `/api/v1/projects/${projectId}/templates/${templateId}/llm-instruction`,
    {method: 'PUT', body},
  );
}
```

  (Match the exact `apiClient` import path used by
  `hitlConfigService.ts` — `@/integrations/api` or
  `@/integrations/api/client` — whichever that file uses.)

- [ ] **Step 4: Query key** — in `frontend/lib/query-keys/extraction.ts`,
  next to `templateEntityTypesKeys`:

```ts
/** Template general AI instruction (Configuration row zero). */
export const templateInstructionKeys = {
  byTemplate: (projectId: string, templateId: string) =>
    ['template-instruction', projectId, templateId] as const,
};
```

  No `index.ts` edit: import the factory from
  `'@/lib/query-keys/extraction'` directly — `templateEntityTypesKeys`
  is consumed the same way by `useTemplateRepublish.ts` (panel: the
  index re-export was needless).

- [ ] **Step 5: Hooks** — create
  `frontend/hooks/extraction/useTemplateInstruction.ts`:

```ts
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import {runsKeys} from '@/hooks/runs/types';
import {templateInstructionKeys} from '@/lib/query-keys/extraction';
import {
  getTemplateInstruction,
  updateTemplateInstruction,
  type TemplateInstructionRead,
  type UpdateTemplateInstructionResponse,
} from '@/services/templateInstructionService';

export function useTemplateInstruction(projectId: string, templateId: string) {
  return useQuery<TemplateInstructionRead, Error>({
    queryKey: templateInstructionKeys.byTemplate(projectId, templateId),
    queryFn: () => getTemplateInstruction(projectId, templateId),
    enabled: Boolean(projectId && templateId),
  });
}

export function useUpdateTemplateInstruction(projectId: string, templateId: string) {
  const queryClient = useQueryClient();
  return useMutation<UpdateTemplateInstructionResponse, Error, string | null>({
    mutationFn: (value) => updateTemplateInstruction(projectId, templateId, value),
    onSuccess: async () => {
      // The PUT republished server-side: editable-stage runs were
      // re-pinned, so run-scoped reads are stale alongside our own key.
      await queryClient.invalidateQueries({
        queryKey: templateInstructionKeys.byTemplate(projectId, templateId),
      });
      await queryClient.invalidateQueries({queryKey: runsKeys.all});
    },
  });
}
```

  (`runsKeys` lives at `frontend/hooks/runs/types.ts` — the same import
  `useTemplateRepublish.ts:18` uses; verified.)

- [ ] **Step 6: Run tests**

Run: `npm run test:run -- frontend/test/hooks/useTemplateInstruction.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/services/templateInstructionService.ts frontend/lib/query-keys/ frontend/hooks/extraction/useTemplateInstruction.ts frontend/test/hooks/useTemplateInstruction.test.tsx
git commit -m "feat(frontend): typed service + hooks for template llm-instruction"
```

---

### Task 8: TemplateInstructionRow + copy + mount in the editor

**Files:**
- Create: `frontend/components/extraction/TemplateInstructionRow.tsx`
- Modify: `frontend/lib/copy/extraction.ts`
- Modify: `frontend/components/extraction/TemplateConfigEditor.tsx:164-166`
- Test: `frontend/test/components/TemplateInstructionRow.test.tsx` (new)

**Interfaces:**
- Consumes: Task 7's hooks; shadcn `Badge`, `Button`, `Textarea`;
  `Sparkles`/`ChevronDown` from `lucide-react`; `t` from `@/lib/copy`;
  `toast` from `sonner`.
- Produces: `<TemplateInstructionRow projectId templateId />` mounted
  between the command bar and the sections `Accordion`.

- [ ] **Step 1: Copy keys** — in `frontend/lib/copy/extraction.ts`, add a
  `// TemplateInstructionRow` group:

```ts
    // TemplateInstructionRow (general AI instruction, config row zero)
    instructionTitle: 'General AI instruction',
    instructionEmpty: 'No general instruction — the AI receives only section and field instructions.',
    instructionPlaceholder: 'Guidance sent to the AI before every section of this template…',
    instructionCustomizeChip: '{{n}} to customize',
    instructionEditedBadge: 'edited',
    instructionCounter: '{{n}} / 4000',
    instructionSave: 'Save',
    instructionCancel: 'Cancel',
    instructionResetDefault: 'Reset to template default',
    instructionInsertDefault: 'Insert suggested default',
    instructionSuggestedDefault:
      'You are extracting data for a systematic review. Report values exactly as stated in the article, do not infer unreported values, and quote the passage supporting each value. [customize: describe this review\'s scope]',
    instructionSavedToast: 'General AI instruction saved',
    errors_saveInstruction: 'Could not save the general AI instruction',
```

- [ ] **Step 2: Failing component test** — create
  `frontend/test/components/TemplateInstructionRow.test.tsx` (mirror
  `ManagerReviewVisibilityToggle.test.tsx`: mock service + sonner + copy;
  wrap in a fresh `QueryClientProvider`):

```tsx
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const getTemplateInstruction = vi.fn();
const updateTemplateInstruction = vi.fn();
vi.mock('@/services/templateInstructionService', () => ({
  getTemplateInstruction: (...a: unknown[]) => getTemplateInstruction(...a),
  updateTemplateInstruction: (...a: unknown[]) => updateTemplateInstruction(...a),
}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn()}}));
vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));

import {TemplateInstructionRow} from '@/components/extraction/TemplateInstructionRow';

function renderRow() {
  const queryClient = new QueryClient({
    defaultOptions: {queries: {retry: false}, mutations: {retry: false}},
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TemplateInstructionRow projectId="p1" templateId="t1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TemplateInstructionRow', () => {
  it('shows the empty ghost state when no instruction is set', async () => {
    getTemplateInstruction.mockResolvedValue({
      project_template_id: 't1',
      llm_template_instruction: null,
      default_instruction: null,
    });
    renderRow();
    expect(await screen.findByText('instructionEmpty')).toBeInTheDocument();
  });

  it('shows a customize chip when unresolved [customize:] slots remain', async () => {
    getTemplateInstruction.mockResolvedValue({
      project_template_id: 't1',
      llm_template_instruction: 'Do X. [customize: scope] Do Y. [customize: cohort]',
      default_instruction: null,
    });
    renderRow();
    expect(
      await screen.findByTestId('instruction-customize-chip'),
    ).toBeInTheDocument();
  });

  it('renders no customize chip when no slots remain', async () => {
    getTemplateInstruction.mockResolvedValue({
      project_template_id: 't1',
      llm_template_instruction: 'All resolved.',
      default_instruction: null,
    });
    renderRow();
    await screen.findByText(/All resolved/);
    expect(screen.queryByTestId('instruction-customize-chip')).toBeNull();
  });

  it('expands, edits, and saves through the mutation', async () => {
    getTemplateInstruction.mockResolvedValue({
      project_template_id: 't1',
      llm_template_instruction: 'Old text',
      default_instruction: null,
    });
    updateTemplateInstruction.mockResolvedValue({
      project_template_id: 't1',
      llm_template_instruction: 'New text',
      version_id: 'v2',
      version: 2,
      changed: true,
      repinned_run_count: 0,
    });
    renderRow();
    await userEvent.click(await screen.findByRole('button', {name: /instructionTitle/}));
    const textarea = screen.getByRole('textbox');
    await userEvent.clear(textarea);
    await userEvent.type(textarea, 'New text');
    await userEvent.click(screen.getByRole('button', {name: 'instructionSave'}));
    await waitFor(() =>
      expect(updateTemplateInstruction).toHaveBeenCalledWith('p1', 't1', 'New text'),
    );
  });

  it('reset-to-default fills the textarea with the origin text', async () => {
    getTemplateInstruction.mockResolvedValue({
      project_template_id: 't1',
      llm_template_instruction: 'Customized',
      default_instruction: 'Origin default',
    });
    renderRow();
    await userEvent.click(await screen.findByRole('button', {name: /instructionTitle/}));
    await userEvent.click(
      screen.getByRole('button', {name: 'instructionResetDefault'}),
    );
    expect(screen.getByRole('textbox')).toHaveValue('Origin default');
  });
});
```

  (The chip assertions use the `data-testid` because the test mocks `t`
  to return raw keys — interpolated-text assertions can never match.)

- [ ] **Step 3: Run to verify failure**

Run: `npm run test:run -- frontend/test/components/TemplateInstructionRow.test.tsx`
Expected: FAIL — component missing.

- [ ] **Step 4: Implement the component** — create
  `frontend/components/extraction/TemplateInstructionRow.tsx`:

```tsx
import {useState} from 'react';
import {ChevronDown, Sparkles} from 'lucide-react';
import {toast} from 'sonner';

import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {
  useTemplateInstruction,
  useUpdateTemplateInstruction,
} from '@/hooks/extraction/useTemplateInstruction';
import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';

const CUSTOMIZE_SLOT = /\[customize:[^\]]*\]/g;

function customizeSlotCount(value: string | null | undefined): number {
  return value ? (value.match(CUSTOMIZE_SLOT) ?? []).length : 0;
}

interface TemplateInstructionRowProps {
  projectId: string;
  templateId: string;
}

export function TemplateInstructionRow({
  projectId,
  templateId,
}: TemplateInstructionRowProps) {
  const {data, isLoading} = useTemplateInstruction(projectId, templateId);
  const update = useUpdateTemplateInstruction(projectId, templateId);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState('');

  if (isLoading || !data) {
    return <div className="h-12 animate-pulse rounded-md border bg-card" />;
  }

  const value = data.llm_template_instruction ?? '';
  const hasOrigin = data.default_instruction != null;
  const isEdited = hasOrigin && value !== '' && value !== data.default_instruction;
  const slotCount = customizeSlotCount(data.llm_template_instruction);

  const openEditor = () => {
    setDraft(value);
    setExpanded(true);
  };

  const save = () => {
    const normalized = draft.trim() === '' ? null : draft;
    update.mutate(normalized, {
      onSuccess: () => {
        toast.success(t('extraction', 'instructionSavedToast'));
        setExpanded(false);
      },
      onError: () => {
        toast.error(t('extraction', 'errors_saveInstruction'));
      },
    });
  };

  return (
    <div className="rounded-md border bg-card">
      <button
        type="button"
        onClick={() => (expanded ? setExpanded(false) : openEditor())}
        className="flex h-12 w-full items-center gap-2 px-4 text-left"
        aria-expanded={expanded}
      >
        <Sparkles className="size-4 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium">
          {t('extraction', 'instructionTitle')}
        </span>
        {!expanded && (
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
            {value === '' ? t('extraction', 'instructionEmpty') : value}
          </span>
        )}
        {expanded && <span className="flex-1" />}
        {slotCount > 0 && (
          <Badge
            variant="outline"
            data-testid="instruction-customize-chip"
            className="border-amber-500/50 text-amber-600 dark:text-amber-400"
          >
            {t('extraction', 'instructionCustomizeChip').replace(
              '{{n}}',
              String(slotCount),
            )}
          </Badge>
        )}
        {isEdited && (
          <Badge variant="secondary">
            {t('extraction', 'instructionEditedBadge')}
          </Badge>
        )}
        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform',
            expanded && 'rotate-180',
          )}
        />
      </button>
      {expanded && (
        <div className="space-y-2 border-t px-4 py-3">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('extraction', 'instructionPlaceholder')}
            maxLength={4000}
            rows={Math.min(12, Math.max(4, draft.split('\n').length + 1))}
            className="text-sm"
          />
          <div className="flex items-center gap-2">
            {draft.length > 1600 && (
              <span className="text-xs text-muted-foreground">
                {t('extraction', 'instructionCounter').replace(
                  '{{n}}',
                  String(draft.length),
                )}
              </span>
            )}
            <span className="flex-1" />
            {hasOrigin && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setDraft(data.default_instruction ?? '')}
              >
                {t('extraction', 'instructionResetDefault')}
              </Button>
            )}
            {!hasOrigin && draft === '' && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setDraft(t('extraction', 'instructionSuggestedDefault'))
                }
              >
                {t('extraction', 'instructionInsertDefault')}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(false)}
            >
              {t('extraction', 'instructionCancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={save}
              disabled={update.isPending || draft === value}
            >
              {t('extraction', 'instructionSave')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Mount it.** In `TemplateConfigEditor.tsx`, between the
  command bar (closes ~:164) and the `<Accordion>` (~:166):

```tsx
      <TemplateInstructionRow projectId={projectId} templateId={templateId} />
```

  with the import added at the top. No republish call here — the PUT is
  atomic server-side.

- [ ] **Step 6: Run tests**

Run: `npm run test:run -- frontend/test/components/TemplateInstructionRow.test.tsx && npm run lint && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS / clean.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/extraction/ frontend/lib/copy/extraction.ts frontend/test/components/TemplateInstructionRow.test.tsx
git commit -m "feat(frontend): general AI instruction row on the Configuration tab"
```

---

## Verification (whole-diff gate)

- **File-size ratchet (panel MAJOR):** `backend/app/seed.py`,
  `backend/app/services/section_extraction_service.py`, and
  `frontend/lib/copy/extraction.ts` sit exactly AT their pinned maxima
  in `scripts/fitness/check_file_size.baseline` — a baselined oversized
  file may not grow. AFTER the final edit to any of them, run
  `python scripts/fitness/check_file_size.py --update-baseline` and
  commit the baseline bump in the same PR (re-bump after the LAST edit;
  known double-failure mode otherwise).
- Local prerequisite: `make db-fresh` from THIS checkout before
  `make test-backend` — the seed-instructions test hard-fails
  (`scalar_one`) on a DB seeded from a stale checkout (missing
  CHARMS+MM / PROBAST+AI).
- `make quality-scan` — lint + typecheck + tests + arch fitness.
- `make test-backend` — full backend suite (local Supabase up).
- `npm run test:run` — full frontend suite.
- Diff-cover 80: endpoint lines covered by the direct coroutine tests
  (Task 6 Step 6); service/snapshot/seed/prompts covered by integration +
  unit tests. Accepted uncovered lines (recorded):
  `_extract_section_with_memory`'s fetch line (batch path, shape-identical
  to the tested call site) and the `backfill_llm_template_instructions`
  wiring line inside `seed.main()`.
- The editor mount (Task 8 Step 5) has no vitest render; the
  template-import E2E renders the row against the real backend but the
  component fails SOFT (skeleton) on a broken GET — visual confirmation
  comes from the design-review pass, not E2E.
- Not in scope (per spec): Publish-sheet diff rows (B3), View-prompt
  three-level highlight (B2), QA-template in-app instruction editing,
  model-identification prompt, prod seed run (dev ceiling — noted for
  the eventual promotion: `python -m app.seed` against prod).

## Self-review notes

- Spec §4 storage/versioning/prompt/UX requirements each map to Tasks
  1-2/2/3/8; §9-A test contract maps to Tasks 2 (snapshot round-trip),
  3 (pinned prompt assembly), 5 (seed idempotency), 4 (clone copy).
- Deviations (deliberate, recorded): five seeded globals instead of
  four; collapsed-preview `<mark>` highlighting of `[customize:]` spans
  simplified to the amber count chip (the preview is a single truncated
  line — highlight adds markup without information); "counter past
  ~1600" implemented literally; no `Template · versioned` badge (the
  pre-B screen has no engine-chip/versioned contrast for it to teach);
  preview and badges COEXIST with the amber chip rather than being
  swapped for it (single-line row, nothing to swap out of).
- Expectation note: existing QA clones never receive the seeded default
  (fill-if-null touches globals only; re-import deliberately preserves
  project text; QA has no in-app editor) — only NEW imports carry an
  instruction. This is the spec's own design, not a gap.
- Panel record (5 adversarial lenses, findings folded in): short CHECK
  constraint names (convention double-wrap, BLOCKING); pinned-vs-live
  call-site integration test (§9-A, BLOCKING); column write moved
  inside republish's locked section (ABBA deadlock, MAJOR); file-size
  ratchet re-bump step (MAJOR); factory-call queryKey assertion
  (MAJOR); snapshot key appended in Python instead of SQL rewrite;
  composition byte-faithfulness assertion; membership-guard 403 tests;
  `LlmUsage`/`runsKeys` import-path fixes; 0034-style roundtrip test;
  clone-based GET fixture; PUT-404 unit test; both not-found exception
  classes caught on PUT.
- Type consistency: `llm_template_instruction` is the column, snapshot
  key, schema field, and request field everywhere;
  `general_instructions` is the prompt-layer parameter name (matches
  the spec's "General instructions" block).
