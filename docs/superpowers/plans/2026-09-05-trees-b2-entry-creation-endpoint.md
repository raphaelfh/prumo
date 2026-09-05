---
status: in_progress
last_reviewed: 2026-09-05
owner: '@raphaelfh'
---

# Trees B2 — one entry-creation endpoint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An entry of **any** repeating section — root or nested — is created with its singleton descendants in one transaction through one typed endpoint; the model-only manual endpoint and the browser-side PostgREST insert are gone.

**Architecture:** `POST /api/v1/extraction/instances` joins the existing `extraction_instances` router, which already serves the `PATCH` identity write behind the same member + reviewer gate. A new `app/services/entry_hierarchy_service.py` replaces `model_hierarchy_service.py`: it binds the coordinate through guards that already exist (`owned_template` with `kind`, `owned_section`, `ExtractionInstanceRepository.get_in_coordinate`) plus the one missing pair-guard (`owned_article`), refuses a duplicate key with a typed 409, then writes the entry and its `cardinality='one'` children. Identity matching is delegated to `app.services.entity_key.match_or_none` — the same matcher the AI path uses.

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy 2.0 async, Pydantic v2, pytest (integration against local Supabase via `db_session` savepoints; direct endpoint-coroutine unit tests for the ASGI blind spot). Frontend: TypeScript strict, generated OpenAPI types, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-03-entry-group-trees-design.md` §2 (Creation), §3 (invariants 1, 6, 7), §7, §11 (rows "Model-only manual creation" → B2, "Browser-side instance insert and cardinality RPC" → B2), §12, §13 item 2, §15.

**Panel (2026-09-05, five lenses — all five returned BLOCKING).** Nine blocking findings folded in below. The load-bearing ones: `entity_type.fields` is a lazy relationship that `owned_section` does not eager-load, so the plan's core read raised `MissingGreenlet` in production while the integration test passed off the session identity map (found independently by three lenses); the retired service's `kind` bind was dropped, letting a quality-assessment template accept extraction entries; four of five test-fixture call signatures were fabricated; the singleton recursion is unreachable until B5; and `descendants`/`proposalRunId` reproduce a response field (`childInstances`) that has never had a production consumer. Two panel recommendations are **declined with reason** in "Decisions" below.

## Global Constraints

- **No migration, no model change, no DDL.** The `role` column, its CHECK, its trigger and the one-container indexes stay until B5. Verified by the panel: nothing here touches `app/models/`, `ExtractionErrorCode` is a Pydantic-only enum absent from `POSTGRESQL_ENUM_VALUES`, and the migration-chain test is untouched. (`bash scripts/generate_api_types.sh` regenerates the **OpenAPI** schema — that is not DDL.)
- **Depth two is the schema's ceiling until B5.** Migration 0016's CHECK + `trg_check_model_section_parent_role` make a singleton's children unrepresentable. No test may fake depth three; B5 rebuilds those.
- **No new `role` write anywhere**, tests included. CHARMS already ships both shapes this slice needs — `prediction_models` (root group) and `final_predictors` (nested group, `entry_label="predictor"`, `backend/app/seed.py` `_ET_FINAL_PREDICTORS`). Look them up; never construct an entity type.
- **One ownership predicate, one implementation** (CLAUDE.md; gated by `scripts/fitness/check_scope_guards.py`). Exactly ONE new pair-guard: `owned_article`. Task 1 also repoints the existing compare-after copy at it.
- **A service may not import `app.api.*`.** `assert_kickoff_scope` raises `HTTPException` and is api-layer; the service composes `owned_template` + `owned_article` instead, and the endpoint calls `ensure_project_member` / `ensure_project_reviewer`. That composition is strictly stronger than the kickoff endpoints' — `assert_kickoff_scope` never binds `article_id` at all.
- **English only.** Cleanup gate (§12): both knip modes at zero with no new exception; vulture baseline strictly smaller; `check_copy_keys.py` green; architecture reference rows + `last_reviewed` updated.

## Decisions (state these in the PR body)

1. **Response is `{instanceId, label}`.** Spec §7 names `(instance, descendants, proposalRunId)`. `descendants` reproduces `childInstances`, whose only production caller discards it and refetches ([ExtractionFullScreen.tsx:715](../../../frontend/pages/ExtractionFullScreen.tsx)); `grep -rn proposalRunId frontend` outside generated types returns nothing. Both are cut as unread payload. `label` **is** read (the success toast). **Deviation from §7, recorded deliberately.**
2. **No dataclass layer.** The service returns `EntryCreateResponse` directly, as `extraction_run_read_service.get_run_or_raise` returns `RunSummaryResponse`. `app.schemas` is in the layering check's `SUPPORT_PREFIXES`.
3. **Flat loop over singleton children, not recursion.** A singleton cannot own children until B5, so the recursive call would always SELECT zero rows and could not be tested under this plan's own constraints. B5 adds recursion in the slice that can test it — and adds the depth bound the self-referential FK will then need.
4. **The key declaration is read once, in SQL.** One `select(ExtractionField)... is_entity_key.is_(True)` yields both `key_declared` and the field id the decision write needs. This replaces the plan's earlier three readers. `key_field_of` is deliberately **not** used: it raises `MissingEntityKeyError` for a keyless group, which the human path must never do (§3 invariant 6).
5. **Manual creation reads the LIVE row, not the pinned tree.** Spec §7.2 says "pinned tree (live row fallback)". Reading the pin here would require a run, and entry creation has none. Consequence, stated rather than hidden: an unpublished draft that moves `is_entity_key` changes this endpoint's behaviour immediately while the AI path still honours the pin. Acceptable for a human write that a reviewer can correct; **flagged for B5** when the pinned-tree resolver becomes shared.
6. **`resolve_instance` is NOT reused — declined panel recommendation.** It hardcodes `label=key_value.strip()` and cannot serve the keyless branch, so adopting it would leave *two* construct sites (its own and the keyless one). Calling `match_or_none` — the matcher `resolve_instance` itself calls — single-sources the risky half while keeping one construct site here, in fewer lines.
7. **`entityKey` stays in the request — declined panel recommendation.** The panel observed no client constructs a label≠key payload today. That is not a reason to drop server-side contract validation on a public endpoint; `extra="forbid"` exists for the same reason. Spec §7 names the field.
8. **Provenance on every row.** The entry carries `created_via: "manual"`; singleton descendants carry it too rather than `{}` (constitution §IX). The old path wrote `run_form` from the client and `{}` for children.
9. **Descendant labels lose the trailing `" 1"`** (`"Cox Model - Model Development"`, not `"... 1"`). The counter was always 1. Asserted explicitly.

---

### Task 1: The article-in-project guard, and its one implementation

**Files:**

- Modify: `backend/app/services/article_read_service.py`
- Modify: `backend/app/services/hitl_session_service.py` (repoint `_ensure_article_in_project`)
- Test: `backend/tests/integration/test_article_read_service.py` (create)

**Interfaces:**

- Produces: `async def owned_article(db, *, project_id: UUID, article_id: UUID) -> UUID` — the id, or `ArticleNotFoundError` for missing **and** for foreign, identically.

- [ ] **Step 1: Write the failing test**

```python
"""owned_article: the one article-in-project pair guard.

Scope in the WHERE clause, so foreign and missing are indistinguishable —
no existence oracle (`.claude/rules/backend.md` § Ownership guards).
"""
from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.article_read_service import ArticleNotFoundError, owned_article
from tests.integration.conftest import SEED


async def _article_in(db: AsyncSession, project_id, title: str):
    article_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.articles (id, project_id, title, row_version) "
            "VALUES (:id, :pid, :t, 1)"
        ),
        {"id": str(article_id), "pid": str(project_id), "t": title},
    )
    await db.flush()
    return article_id


@pytest.mark.asyncio
async def test_owned_article_returns_the_id_in_scope(db_session: AsyncSession) -> None:
    article_id = await _article_in(db_session, SEED.primary_project, "In scope")
    got = await owned_article(db_session, project_id=SEED.primary_project, article_id=article_id)
    assert got == article_id


@pytest.mark.asyncio
async def test_a_foreign_article_is_refused_like_a_missing_one(db_session: AsyncSession) -> None:
    foreign = await _article_in(db_session, SEED.secondary_project, "Other project")
    missing = uuid4()

    # PRECONDITION: the foreign row really exists in the other project.
    # Without this the test proves nothing about leak-freedom.
    owner = (
        await db_session.execute(
            text("SELECT project_id FROM public.articles WHERE id = :id"), {"id": str(foreign)}
        )
    ).scalar_one()
    assert owner == SEED.secondary_project

    with pytest.raises(ArticleNotFoundError) as foreign_exc:
        await owned_article(db_session, project_id=SEED.primary_project, article_id=foreign)
    with pytest.raises(ArticleNotFoundError) as missing_exc:
        await owned_article(db_session, project_id=SEED.primary_project, article_id=missing)

    # One message template; only the echoed id differs.
    assert str(foreign_exc.value).replace(str(foreign), "<id>") == str(
        missing_exc.value
    ).replace(str(missing), "<id>")
    # The owning project never leaks.
    assert str(SEED.secondary_project) not in str(foreign_exc.value)
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && uv run pytest tests/integration/test_article_read_service.py -v`
Expected: FAIL — `ImportError: cannot import name 'owned_article'`.

- [ ] **Step 3: Implement**

```python
async def owned_article(db: AsyncSession, *, project_id: UUID, article_id: UUID) -> UUID:
    """The article's id, only when it belongs to ``project_id``.

    THE article-in-project pair guard (`.claude/rules/backend.md`
    § Ownership guards). The scope is in the WHERE clause, not a compare
    after a bare ``db.get``: a foreign article and a missing one answer
    identically, so no caller can leak which articles exist in projects
    the caller cannot see.
    """
    found = (
        await db.execute(
            select(Article.id).where(Article.id == article_id, Article.project_id == project_id)
        )
    ).scalar_one_or_none()
    if found is None:
        raise ArticleNotFoundError(f"Article {article_id} not found")
    return found
```

- [ ] **Step 4: Repoint the existing copy**

`hitl_session_service._ensure_article_in_project` answers the same question with the
resolve-then-compare shape the rules forbid. Replace its body with a call to
`owned_article`, translating `ArticleNotFoundError` to whatever that method already
raises so its callers are unaffected. Read the method first; if the translation is not
mechanical, leave it and say why in the PR body — do not half-convert it.

- [ ] **Step 5: Run tests + the gate**

```bash
cd backend && uv run pytest tests/integration/test_article_read_service.py tests/integration/test_hitl_session_service.py -v
python3 scripts/fitness/check_scope_guards.py
```

Expected: green; `check_scope_guards: OK (... none new)`.

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(extraction): the one article-in-project ownership guard"
```

---

### Task 2: `EntryHierarchyService` — an entry for any group

**Files:**

- Create: `backend/app/services/entry_hierarchy_service.py`
- Modify: `backend/app/schemas/extraction.py` (add `ENTRY_KEY_DUPLICATE`, `EntryCreateRequest`, `EntryCreateResponse`)
- Test: `backend/tests/integration/test_entry_hierarchy_service.py` (create)

**Interfaces:**

- Consumes: `owned_article` (Task 1); `owned_template`; `owned_section`; `ExtractionInstanceRepository.get_in_coordinate`; `entity_key.match_or_none`, `entity_key.stamp`.
- Produces:

```python
class EntryTargetNotFoundError(Exception): ...    # → 404 (missing or foreign)
class InvalidEntryTargetError(ValueError): ...    # → 422 (not repeating / parent mismatch / key arity)
class EntryKeyDuplicateError(AppError): ...       # → typed 409 ENTRY_KEY_DUPLICATE

class EntryHierarchyService:
    def __init__(self, db: AsyncSession) -> None: ...
    async def create_entry(
        self, *, project_id: UUID, article_id: UUID, template_id: UUID,
        entity_type_id: UUID, parent_instance_id: UUID | None,
        label: str, entity_key: str | None, user_id: UUID,
    ) -> EntryCreateResponse: ...
```

Four exception types collapse to three: `SectionDoesNotRepeatError` and
`EntryParentMismatchError` both mapped to the same 422 with the same body, so the
distinction lived entirely in the message string.

- [ ] **Step 1: Add the error code**

In `ExtractionErrorCode`, add `ENTRY_KEY_DUPLICATE = "ENTRY_KEY_DUPLICATE"`, widen the
first docstring line to *"...for a terminal extraction failure or a typed synchronous
refusal on the extraction write paths"*, and add the bullet:

```text
    - ``ENTRY_KEY_DUPLICATE`` — manual entry creation named an identity the
      coordinate already holds (``EntryKeyDuplicateError``), refused as a 409
      rather than silently renaming the entry.
```

- [ ] **Step 2: Write the failing tests**

```python
"""entry_hierarchy_service: one entry, any group, singleton descendants.

Unmocked against a real CHARMS clone, for the reason
``test_model_hierarchy_service`` was written: the endpoint success test
mocks the service, so a broken lookup inside it ships as a deterministic
500 on every click.

CHARMS supplies both shapes this suite needs and no entity type is
constructed here: ``prediction_models`` is the root group and
``final_predictors`` (entry_label "predictor") the nested one.
"""
from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import (
    ExtractionCardinality,
    ExtractionEntityType,
    ExtractionField,
    ExtractionInstance,
)
from app.services.entity_key import key_of
from app.services.entry_hierarchy_service import (
    EntryHierarchyService,
    EntryKeyDuplicateError,
    EntryTargetNotFoundError,
    InvalidEntryTargetError,
)
from tests.integration.conftest import (
    SEED,
    clean_project_clones,
    clone_charms,
    open_session,
)


async def _fresh_article(db: AsyncSession, project_id, title: str = "Entry article"):
    article_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.articles (id, project_id, title, row_version) "
            "VALUES (:id, :pid, :t, 1)"
        ),
        {"id": str(article_id), "pid": str(project_id), "t": title},
    )
    await db.flush()
    return article_id


async def _clone_with_article(db: AsyncSession):
    """CHARMS clone + fresh article in the secondary project.

    ``clone_charms`` is IDEMPOTENT on (project, global template) — a second
    call returns the same clone — so a test needing two coordinates makes
    two ARTICLES, never two clones.
    """
    await clean_project_clones(db, SEED.secondary_project)
    clone = await clone_charms(db, SEED.secondary_project, SEED.primary_profile)
    article_id = await _fresh_article(db, SEED.secondary_project)
    return clone.project_template_id, article_id


async def _group(db: AsyncSession, template_id, *, name: str) -> ExtractionEntityType:
    """A seeded repeating section of the clone, by name. Deterministic:
    ordered and ``scalar_one`` (an unordered ``.first()`` is not a contract)."""
    row = (
        await db.execute(
            select(ExtractionEntityType)
            .where(
                ExtractionEntityType.project_template_id == template_id,
                ExtractionEntityType.name == name,
                ExtractionEntityType.cardinality == ExtractionCardinality.MANY.value,
            )
            .order_by(ExtractionEntityType.sort_order)
        )
    ).scalars().one()
    return row


async def _key_field(db: AsyncSession, entity_type_id):
    return (
        await db.execute(
            select(ExtractionField).where(
                ExtractionField.entity_type_id == entity_type_id,
                ExtractionField.is_entity_key.is_(True),
            )
        )
    ).scalars().first()


@pytest.mark.asyncio
async def test_a_root_group_entry_is_created_with_its_singleton_descendants(
    db_session: AsyncSession,
) -> None:
    template_id, article_id = await _clone_with_article(db_session)
    group = await _group(db_session, template_id, name="prediction_models")
    assert await _key_field(db_session, group.id) is not None, (
        "PRECONDITION: prediction_models must declare an entry key"
    )

    singleton_children = {
        et.id: et.label
        for et in (
            await db_session.execute(
                select(ExtractionEntityType).where(
                    ExtractionEntityType.parent_entity_type_id == group.id,
                    ExtractionEntityType.cardinality == ExtractionCardinality.ONE.value,
                )
            )
        ).scalars()
    }
    assert singleton_children, "PRECONDITION: the group must have singleton children"

    result = await EntryHierarchyService(db_session).create_entry(
        project_id=SEED.secondary_project,
        article_id=article_id,
        template_id=template_id,
        entity_type_id=group.id,
        parent_instance_id=None,
        label="Cox Model",
        entity_key="Cox Model",
        user_id=SEED.primary_profile,
    )

    entry = await db_session.get(ExtractionInstance, result.instance_id)
    assert entry.label == "Cox Model"
    assert entry.parent_instance_id is None
    assert key_of(entry) == "cox model"
    assert entry.metadata_["created_via"] == "manual"

    # Assert the WRITE, not the return value: one instance per singleton
    # child, parented to the new entry, each carrying provenance.
    written = (
        await db_session.execute(
            select(ExtractionInstance).where(
                ExtractionInstance.parent_instance_id == result.instance_id
            )
        )
    ).scalars().all()
    assert {i.entity_type_id for i in written} == set(singleton_children)
    assert all(i.metadata_.get("created_via") == "manual" for i in written)
    # Descendant label format (decision 9): no trailing counter.
    some = next(i for i in written)
    assert some.label == f"Cox Model - {singleton_children[some.entity_type_id]}"


@pytest.mark.asyncio
async def test_a_duplicate_key_is_refused_with_the_typed_409(
    db_session: AsyncSession,
) -> None:
    template_id, article_id = await _clone_with_article(db_session)
    group = await _group(db_session, template_id, name="prediction_models")
    assert await _key_field(db_session, group.id) is not None, (
        "PRECONDITION: without a key field the duplicate check is skipped "
        "and this test would fail with a bare DID NOT RAISE"
    )
    service = EntryHierarchyService(db_session)
    common = dict(
        project_id=SEED.secondary_project,
        article_id=article_id,
        template_id=template_id,
        entity_type_id=group.id,
        parent_instance_id=None,
        user_id=SEED.primary_profile,
    )
    first = await service.create_entry(label="Cox Model", entity_key="Cox Model", **common)
    assert key_of(await db_session.get(ExtractionInstance, first.instance_id)) == "cox model"

    # Normalization folds case and whitespace — this IS the same entity.
    with pytest.raises(EntryKeyDuplicateError) as exc:
        await service.create_entry(label="cox   model", entity_key="cox   model", **common)
    assert exc.value.status_code == 409
    assert exc.value.code == "ENTRY_KEY_DUPLICATE"


@pytest.mark.asyncio
async def test_a_nested_group_entry_lands_under_its_parent(
    db_session: AsyncSession,
) -> None:
    """The §13 B2 happy path for a nested group."""
    template_id, article_id = await _clone_with_article(db_session)
    root = await _group(db_session, template_id, name="prediction_models")
    nested = await _group(db_session, template_id, name="final_predictors")
    assert nested.parent_entity_type_id == root.id, (
        "PRECONDITION: final_predictors must be nested under prediction_models"
    )
    service = EntryHierarchyService(db_session)
    common = dict(
        project_id=SEED.secondary_project,
        article_id=article_id,
        template_id=template_id,
        user_id=SEED.primary_profile,
    )
    parent = await service.create_entry(
        entity_type_id=root.id, parent_instance_id=None,
        label="Cox Model", entity_key="Cox Model", **common
    )
    nested_key = await _key_field(db_session, nested.id)
    child = await service.create_entry(
        entity_type_id=nested.id, parent_instance_id=parent.instance_id,
        label="Age", entity_key="Age" if nested_key else None, **common
    )
    row = await db_session.get(ExtractionInstance, child.instance_id)
    assert row.parent_instance_id == parent.instance_id
    assert row.entity_type_id == nested.id


@pytest.mark.asyncio
async def test_a_nested_group_requires_its_parent_entry(db_session: AsyncSession) -> None:
    template_id, article_id = await _clone_with_article(db_session)
    nested = await _group(db_session, template_id, name="final_predictors")
    with pytest.raises(InvalidEntryTargetError):
        await EntryHierarchyService(db_session).create_entry(
            project_id=SEED.secondary_project, article_id=article_id,
            template_id=template_id, entity_type_id=nested.id,
            parent_instance_id=None, label="Age", entity_key=None,
            user_id=SEED.primary_profile,
        )


@pytest.mark.asyncio
async def test_a_root_group_refuses_a_parent(db_session: AsyncSession) -> None:
    template_id, article_id = await _clone_with_article(db_session)
    root = await _group(db_session, template_id, name="prediction_models")
    service = EntryHierarchyService(db_session)
    common = dict(
        project_id=SEED.secondary_project, article_id=article_id,
        template_id=template_id, user_id=SEED.primary_profile,
    )
    first = await service.create_entry(
        entity_type_id=root.id, parent_instance_id=None,
        label="Cox Model", entity_key="Cox Model", **common
    )
    with pytest.raises(InvalidEntryTargetError):
        await service.create_entry(
            entity_type_id=root.id, parent_instance_id=first.instance_id,
            label="Nested by mistake", entity_key="Nested by mistake", **common
        )


@pytest.mark.asyncio
async def test_an_entry_under_another_articles_parent_is_refused(
    db_session: AsyncSession,
) -> None:
    """The client-supplied parent id is the classic BOLA vector.

    ONE clone (``clone_charms`` is idempotent), TWO articles — what refuses
    the write is the article half of ``get_in_coordinate``.
    """
    template_id, article_a = await _clone_with_article(db_session)
    article_b = await _fresh_article(db_session, SEED.secondary_project, "Second article")
    root = await _group(db_session, template_id, name="prediction_models")
    nested = await _group(db_session, template_id, name="final_predictors")
    service = EntryHierarchyService(db_session)

    other = await service.create_entry(
        project_id=SEED.secondary_project, article_id=article_b, template_id=template_id,
        entity_type_id=root.id, parent_instance_id=None,
        label="Other article's model", entity_key="Other article's model",
        user_id=SEED.primary_profile,
    )
    with pytest.raises(EntryTargetNotFoundError):
        await service.create_entry(
            project_id=SEED.secondary_project, article_id=article_a, template_id=template_id,
            entity_type_id=nested.id, parent_instance_id=other.instance_id,
            label="Age", entity_key=None, user_id=SEED.primary_profile,
        )


@pytest.mark.asyncio
async def test_a_singleton_section_has_no_entries(db_session: AsyncSession) -> None:
    template_id, article_id = await _clone_with_article(db_session)
    singleton = (
        await db_session.execute(
            select(ExtractionEntityType)
            .where(
                ExtractionEntityType.project_template_id == template_id,
                ExtractionEntityType.cardinality == ExtractionCardinality.ONE.value,
            )
            .order_by(ExtractionEntityType.sort_order)
            .limit(1)
        )
    ).scalars().one()
    with pytest.raises(InvalidEntryTargetError):
        await EntryHierarchyService(db_session).create_entry(
            project_id=SEED.secondary_project, article_id=article_id,
            template_id=template_id, entity_type_id=singleton.id,
            parent_instance_id=None, label="Nope", entity_key=None,
            user_id=SEED.primary_profile,
        )


@pytest.mark.asyncio
async def test_a_foreign_article_is_refused_before_any_write(
    db_session: AsyncSession,
) -> None:
    template_id, _ = await _clone_with_article(db_session)
    group = await _group(db_session, template_id, name="prediction_models")
    before = set(
        (
            await db_session.execute(
                select(ExtractionInstance.id).where(
                    ExtractionInstance.project_id == SEED.secondary_project
                )
            )
        ).scalars()
    )
    with pytest.raises(EntryTargetNotFoundError) as exc:
        await EntryHierarchyService(db_session).create_entry(
            project_id=SEED.secondary_project, article_id=uuid4(),
            template_id=template_id, entity_type_id=group.id,
            parent_instance_id=None, label="Cox Model", entity_key="Cox Model",
            user_id=SEED.primary_profile,
        )
    # It refused for the ARTICLE, not incidentally for the template.
    assert "Article" in str(exc.value)
    after = set(
        (
            await db_session.execute(
                select(ExtractionInstance.id).where(
                    ExtractionInstance.project_id == SEED.secondary_project
                )
            )
        ).scalars()
    )
    assert after == before


@pytest.mark.asyncio
async def test_a_quality_assessment_template_is_refused(db_session: AsyncSession) -> None:
    """The retired service bound template KIND; dropping that bind would let a
    QA template accept extraction entries with no run and no audit trail."""
    template_id, article_id = await _clone_with_article(db_session)
    group = await _group(db_session, template_id, name="prediction_models")
    qa_template_id = await _qa_template_in(db_session, SEED.secondary_project)
    with pytest.raises(EntryTargetNotFoundError):
        await EntryHierarchyService(db_session).create_entry(
            project_id=SEED.secondary_project, article_id=article_id,
            template_id=qa_template_id, entity_type_id=group.id,
            parent_instance_id=None, label="Cox Model", entity_key="Cox Model",
            user_id=SEED.primary_profile,
        )


@pytest.mark.asyncio
async def test_a_keyless_group_is_created_from_a_label_alone(
    db_session: AsyncSession,
) -> None:
    """§3 invariant 6 — the human path never refuses for want of a key."""
    template_id, article_id = await _clone_with_article(db_session)
    root = await _group(db_session, template_id, name="prediction_models")
    root_id = root.id  # capture BEFORE expiry: reading it after triggers a refresh
    assert await _key_field(db_session, root_id) is not None, (
        "PRECONDITION: the group must start keyed for this test to mean anything"
    )
    cleared = await db_session.execute(
        update(ExtractionField)
        .where(ExtractionField.entity_type_id == root_id)
        .values(is_entity_key=False)
    )
    assert cleared.rowcount > 0
    await db_session.flush()
    db_session.expire_all()

    result = await EntryHierarchyService(db_session).create_entry(
        project_id=SEED.secondary_project, article_id=article_id,
        template_id=template_id, entity_type_id=root_id,
        parent_instance_id=None, label="Unkeyed model", entity_key=None,
        user_id=SEED.primary_profile,
    )
    entry = await db_session.get(ExtractionInstance, result.instance_id)
    assert entry.label == "Unkeyed model"
    assert key_of(entry) is None


@pytest.mark.asyncio
async def test_a_keyed_group_refuses_a_missing_key(db_session: AsyncSession) -> None:
    template_id, article_id = await _clone_with_article(db_session)
    group = await _group(db_session, template_id, name="prediction_models")
    with pytest.raises(InvalidEntryTargetError):
        await EntryHierarchyService(db_session).create_entry(
            project_id=SEED.secondary_project, article_id=article_id,
            template_id=template_id, entity_type_id=group.id,
            parent_instance_id=None, label="Cox Model", entity_key=None,
            user_id=SEED.primary_profile,
        )
```

> `_qa_template_in` must create a `quality_assessment` project template in the
> project. Look for an existing helper first (`clone_probast`, or the QA fixtures in
> `tests/integration/`); only write one if none exists, and use the same
> `TemplateCloneService` path rather than raw SQL.

- [ ] **Step 3: Run to verify they fail**

Run: `cd backend && uv run pytest tests/integration/test_entry_hierarchy_service.py -v`
Expected: FAIL — `ModuleNotFoundError: app.services.entry_hierarchy_service`.

- [ ] **Step 4: Write the service**

Key points the panel established — do not deviate:

- Read the key declaration in **SQL**, once. Never `entity_type.fields` (lazy
  relationship; `owned_section` does not eager-load it; a same-session test
  passes off the identity map while production raises `MissingGreenlet`).
- `owned_template(..., kind=TemplateKind.EXTRACTION.value)`.
- Flat loop over `cardinality='one'` children — no recursion.
- `sort_order` = `coalesce(max(sort_order), -1) + 1` scoped to
  `(article, entity_type, parent_instance)`, not `COUNT(*)` (which reuses an
  order after a delete).
- Module-scope imports throughout — the panel proved there is no cycle with
  `template_section_service`.

```python
"""Create one entry of any repeating section, with its singleton children.

Replaces ``model_hierarchy_service``, which could only create the one
``model_container`` the ``role`` column allowed. Structure is read from
``parent_entity_type_id`` + ``cardinality``; nothing here is model-shaped.

Scope is bound before any write through guards that already exist; this
module adds none of its own (`.claude/rules/backend.md` § Ownership guards).
"""
```

with the shape sketched in Task 2's Interfaces, plus:

```python
    async def _key_field(self, entity_type_id: UUID) -> ExtractionField | None:
        """The section's entry-key field, read in SQL.

        NOT ``entity_type.fields``: that relationship is ``lazy="select"`` and
        ``owned_section`` does not eager-load it, so touching it raises
        ``MissingGreenlet`` under ``AsyncSession`` — invisible to a test whose
        clone put the field rows in the same session's identity map.

        NOT ``entity_key.key_field_of`` either: that raises for a keyless
        repeating group, and the human path must create one (§3 invariant 6).
        """
        return (
            await self.db.execute(
                select(ExtractionField).where(
                    ExtractionField.entity_type_id == entity_type_id,
                    ExtractionField.is_entity_key.is_(True),
                )
            )
        ).scalars().first()
```

- [ ] **Step 5: Run to verify they pass**

Run: `cd backend && uv run pytest tests/integration/test_entry_hierarchy_service.py -v`
Expected: all passed.

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(extraction): create one entry of any group with its singleton children"
```

---

### Task 3: Record the key value as the reviewer's decision

**Files:** modify the service + its test file.

Port `ModelHierarchyService._record_key_decision` with both load-bearing comments
intact (why a ReviewerDecision and not a proposal; why a mid-flight stage advance must
not 500 the creation), reusing the `_key_field` lookup from Task 2 rather than running
a second query. `proposal_run_id` is **not** returned (decision 1) — the test asserts
the `ExtractionReviewerDecision` row.

- [ ] **Step 1: Write the failing test**

```python
@pytest.mark.asyncio
async def test_the_key_value_is_recorded_as_this_reviewers_decision(
    db_session: AsyncSession,
) -> None:
    template_id, article_id = await _clone_with_article(db_session)
    session = await open_session(
        db_session,
        project_id=SEED.secondary_project,
        article_id=article_id,
        template_id=template_id,
        user_id=SEED.primary_profile,
    )
    group = await _group(db_session, template_id, name="prediction_models")
    key_field = await _key_field(db_session, group.id)
    assert key_field is not None, "PRECONDITION: the group must declare a key"

    result = await EntryHierarchyService(db_session).create_entry(
        project_id=SEED.secondary_project, article_id=article_id,
        template_id=template_id, entity_type_id=group.id,
        parent_instance_id=None, label="Cox Model", entity_key="Cox Model",
        user_id=SEED.primary_profile,
    )
    decision = (
        await db_session.execute(
            select(ExtractionReviewerDecision).where(
                ExtractionReviewerDecision.run_id == session.run_id,
                ExtractionReviewerDecision.instance_id == result.instance_id,
                ExtractionReviewerDecision.field_id == key_field.id,
            )
        )
    ).scalars().first()
    assert decision is not None
    assert decision.value == {"value": "Cox Model"}
    assert decision.reviewer_id == SEED.primary_profile


@pytest.mark.asyncio
async def test_a_keyless_group_records_no_decision(db_session: AsyncSession) -> None:
    """Written out, not stubbed: a `...` body is a passing test."""
    template_id, article_id = await _clone_with_article(db_session)
    session = await open_session(
        db_session, project_id=SEED.secondary_project, article_id=article_id,
        template_id=template_id, user_id=SEED.primary_profile,
    )
    root = await _group(db_session, template_id, name="prediction_models")
    root_id = root.id
    await db_session.execute(
        update(ExtractionField)
        .where(ExtractionField.entity_type_id == root_id)
        .values(is_entity_key=False)
    )
    await db_session.flush()
    db_session.expire_all()

    result = await EntryHierarchyService(db_session).create_entry(
        project_id=SEED.secondary_project, article_id=article_id,
        template_id=template_id, entity_type_id=root_id,
        parent_instance_id=None, label="Unkeyed", entity_key=None,
        user_id=SEED.primary_profile,
    )
    rows = (
        await db_session.execute(
            select(ExtractionReviewerDecision).where(
                ExtractionReviewerDecision.run_id == session.run_id,
                ExtractionReviewerDecision.instance_id == result.instance_id,
            )
        )
    ).scalars().all()
    assert rows == []
```

- [ ] **Steps 2-4:** run (fail) → implement → run (pass) → commit.

```bash
git commit -am "feat(extraction): the entry key value lands as the reviewer's decision"
```

---

### Task 4: `POST /api/v1/extraction/instances`

**Files:**

- Modify: `backend/app/api/v1/endpoints/extraction_instances.py`
- Test: `backend/tests/integration/test_entry_create_endpoint.py` (create)
- Test: `backend/tests/unit/test_entry_create_endpoint_unit.py` (create)

**Fixture pointer (panel-corrected):** model the integration tests on
`backend/tests/integration/test_instance_identity.py` — the PATCH sibling on the same
router — which uses `db_client` plus `as_reviewer` / `as_outsider` overriding
`get_current_user` to a SEED profile. **Not** `test_extraction_endpoints.py`: its
`client` fixture has an `AsyncMock(spec=AsyncSession)` DB and a `"test-user-id"` JWT
sub, so no real row can be created or refused there.

**Schemas** — both response models need `model_config = ConfigDict(populate_by_name=True)`
(the endpoint constructs by field name while the fields carry aliases). `label` carries a
validator refusing blank/whitespace-only, mirroring `InstanceIdentityUpdateRequest`.

```python
class EntryCreateRequest(BaseModel):     # extra="forbid", populate_by_name
    project_id: UUID = Field(..., alias="projectId")
    article_id: UUID = Field(..., alias="articleId")
    template_id: UUID = Field(..., alias="templateId")
    entity_type_id: UUID = Field(..., alias="entityTypeId")
    parent_instance_id: UUID | None = Field(default=None, alias="parentInstanceId")
    label: str = Field(..., max_length=200)
    entity_key: str | None = Field(default=None, alias="entityKey", max_length=500)

class EntryCreateResponse(BaseModel):
    instance_id: UUID = Field(..., alias="instanceId")
    label: str
    model_config = ConfigDict(populate_by_name=True)
```

- [ ] **Step 1: Write the failing integration tests** — written out, no `...` stubs:
  201 happy path; 409 typed `ENTRY_KEY_DUPLICATE`; 404 foreign parent; 404 QA template;
  422 singleton section; 422 blank label; 403 outsider; 403 member-but-not-reviewer.

> The 403-viewer case needs a member-without-reviewer profile. SEED has none and the
> PATCH sibling has the same gap — add the fixture here and note it in the PR body, or
> say explicitly that it is deferred. Do not silently skip it.

> Because the endpoint's error branches call `await db.rollback()`, which unwinds the
> shared `db_session` savepoint, `await db_session.commit()` after fixture setup (which
> releases and re-opens the savepoint) before firing the 409/404/422 requests.

- [ ] **Step 2: Write the direct-coroutine unit tests** — the ASGI blind spot means
  handler lines reached through `ASGITransport` are not attributed. Cover **every**
  branch, not three: the 201 path (response construction, `db.commit`,
  `ApiResponse.success`), both arms of the `trace_id` fallback, and the 409/404/422
  translations.

- [ ] **Step 3: Run both to verify they fail.**

- [ ] **Step 4: Write the endpoint** — `ensure_project_member` then
  `ensure_project_reviewer` before the `try`; `EntryKeyDuplicateError` re-raised for the
  global `AppError` handler's typed 409 envelope; `EntryTargetNotFoundError` → 404;
  `ValueError` (covering `InvalidEntryTargetError`) → 422.

- [ ] **Step 5: Run to verify they pass.**

- [ ] **Step 6:** `bash scripts/generate_api_types.sh && git diff --stat frontend/types/api/`

- [ ] **Step 7: Commit.**

---

### Task 5: Frontend — one typed call replaces the PostgREST insert

**Files:**

- Modify: `frontend/integrations/api/client.ts`, `index.ts` — add `createEntry`
- Modify: `frontend/hooks/extraction/useAddEntry.ts`
- Modify: `frontend/hooks/extraction/useModelManagement.ts`
- Modify: `frontend/services/extractionInstanceService.ts` — delete `createInstance`,
  `createHierarchy`, `ensureUniqueName`, `generateLabel` and their interfaces
- **Delete:** `frontend/test/services/extractionInstanceServiceUniqueName.test.ts`
  (95 lines, tests `ensureUniqueName` exclusively — it must go with it)
- **Rewrite, not tweak:** `frontend/test/hooks/useModelManagement.test.tsx` — its module
  mock exports only `createManualModelHierarchy`, and five assertions bind to the
  `{modelId, modelLabel, childInstances}` shape (lines ~108, 126, 136-165, 170, 470)
- Test: `frontend/test/hooks/useAddEntry.test.tsx` (create)

`useAddEntry` drops `getRequiredUserId` (the server takes identity from the JWT) and the
`wasCreated` branch (the endpoint creates or refuses). One new copy key for the typed
duplicate refusal. `createInstance`'s `check_cardinality_one` RPC call goes — that is
the spec's "cardinality RPC" retirement; the **database function survives**.

- [ ] Steps: failing hook test → `createEntry` client → repoint `useAddEntry` →
  repoint `useModelManagement.createModel` → delete the browser write path →
  `npm run test:run` + `npx tsc --noEmit` → commit.

---

### Task 6: Retire the model-only path

**Files:** delete `backend/app/services/model_hierarchy_service.py` and
`backend/tests/integration/test_model_hierarchy_service.py`; drop the `/manual` route
from `endpoints/model_extraction.py`; drop `CreateModelHierarchyRequest`,
`CreateModelHierarchyResponse`, `ModelHierarchyChildResponse` from
`schemas/extraction.py`; drop `createManualModelHierarchy` + its three types from the
frontend client; update `test_membership_guards.py`, `test_extraction_endpoints.py`,
`tests/unit/test_extraction_schemas.py`; update
`docs/reference/extraction-hitl-architecture.md`.

- [ ] **Step 1: Move the membership-guard case FIRST.** Repoint
  `test_membership_guards.py`'s `/extraction/models/manual` case at
  `POST /api/v1/extraction/instances` and run it **before** deleting the route — a guard
  test deleted with its route is a guard silently dropped.

- [ ] **Step 2: Update the Spec A E2E.** It does **not** pass unchanged (spec §13's claim
  is wrong): `frontend/e2e/flows/extraction-entry-identity.ui.e2e.ts:84` waits on
  `/api/v1/extraction/models/manual` and reads `data.modelId`. Update the URL matcher to
  `/api/v1/extraction/instances`, replace the `ManualModelResponse` type, and
  `modelId` → `instanceId`.

```bash
npx playwright test frontend/e2e/flows/extraction-entry-identity.ui.e2e.ts --project=local-ui --workers 1
```

- [ ] **Step 3: Delete the route, the service and the schemas.**

- [ ] **Step 4: Prove the retirement** (scoped — `check_cardinality_one` is NOT in the
  list: the SQL function survives, with a deliberate contract test at
  `test_schema_drift.py` and an admin RPC call in `extraction-multi-instance.e2e.ts`):

```bash
grep -rn "model_hierarchy_service\|ModelHierarchyService\|CreateModelHierarchy\|ModelHierarchyChildResponse\|createManualModelHierarchy\|models/manual" \
  backend/app backend/tests frontend/hooks frontend/services frontend/integrations frontend/components frontend/e2e \
  || echo "ZERO — retired"
```

- [ ] **Step 5: Architecture reference** — remove the
  `POST /api/v1/extraction/models/manual` row and the "(the manual model endpoint stamps
  it too)" clause, add `POST /api/v1/extraction/instances`, bump `last_reviewed`.

- [ ] **Step 6: Cleanup gate (§12).**

```bash
npx knip --no-tag-hints
npx knip --production --no-tag-hints
python3 scripts/fitness/check_copy_keys.py
python3 scripts/fitness/check_scope_guards.py
cd backend && uv run python ../scripts/vulture_baseline.py --check
```

Vulture baseline must be **strictly smaller** (a service module is deleted); tighten it
in this commit.

- [ ] **Step 7: Commit.**

---

## Verify (the slice's gate, §13 item 2)

```bash
cd backend && uv run pytest tests/integration/test_entry_hierarchy_service.py \
  tests/integration/test_entry_create_endpoint.py \
  tests/unit/test_entry_create_endpoint_unit.py \
  tests/integration/test_membership_guards.py \
  tests/integration/test_article_read_service.py -v
npm run test:run
make quality-scan
npx playwright test frontend/e2e/flows/extraction-entry-identity.ui.e2e.ts --project=local-ui --workers 1
```

Every claim of green quotes the command's output (§15).
