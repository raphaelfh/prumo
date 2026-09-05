---
status: in_progress
last_reviewed: 2026-09-05
owner: '@raphaelfh'
---

# Trees B1 — ancestry on the three prompts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A singleton under an entry, and any section at any depth, receives the scope block with the full chain of enclosing entries in all three prompts (section, QA, identification), and the three prompt versions bump once.

**Architecture:** One ancestry resolver (`app/services/entry_ancestry.py`) walks `parent_instance_id` through the run-scoped instance getter, takes each ancestor's noun from the run-pinned tree (template-scoped live row for a type outside the pin, `DEFAULT_ENTRY_LABEL` when unset), and memoizes per `(run, instance)` on the service so a per-entry batch never re-walks. The prompt-side scope becomes `Scope(entry_label, key_label, key_value, ancestors)` with the key pair optional: a group entry renders the repeats sentence plus its key, a singleton under an entry renders the belongs sentence, and both add `- Within: model "XGBoost" › validation "external"` when ancestors exist. The identification prompt's parent clause takes the same chain. `#802`'s single `parent_label` is deleted.

**Tech Stack:** Python 3.11, FastAPI service layer, SQLAlchemy async, pytest (unit with fakes; integration against the local Supabase via `db_session` savepoints).

**Spec:** `docs/superpowers/specs/2026-09-03-entry-group-trees-design.md` §3 (invariant 7), §6 (Ancestry, Scope block), §11 (row "Single `parent_label`" → B1), §13 item 1, §15, §16 ("three prompt versions bump in B1").

**Panel (2026-09-05, five lenses):** one blocking finding (the depth-three test identified a key the fake extractor cannot map) and the should-fix items are folded in below: the live-row noun fallback is template-scoped through the service's existing `_get_entity_type` (never a bare `get_by_id`); the resolver is a memoized recursion, not a partial-cache climb with batched nouns; the singleton fixture is `_group(cardinality="one")`, not a copied helper; the canary liveness test is one parametrized body; labels are whitespace-folded in the chain; the unit fake carries no run-id assertion.

## Global Constraints

- Backend only. No schema change (the `role` column and its trigger stay until B5), no endpoint change, no OpenAPI drift (`bash scripts/generate_api_types.sh` must leave `frontend/types/api/*` untouched).
- `section_extraction_service.py` sits on the file-size ratchet at `1823` (`scripts/fitness/check_file_size.baseline`); it is at 1769 lines. New logic lives in `entry_ancestry.py`; the service gains only the `Scope`/`Ancestor` import, one cache attribute and its comment.
- `DEFAULT_ENTRY_LABEL` (`app.models.extraction`) stays the one noun fallback in B1; the spec's `DEFAULT_ENTRY_NOUN` rename belongs to B5 with the `DEFAULT_ENTRY_LABEL` deletion (§11), so B1 adds no second constant.
- `Ancestor` is defined in `app.llm.prompts` (the renderer's layer), not in the service module the spec names: `app.llm` never imports `app.services`; `entry_ancestry.py` imports it from there. `Ancestor` stays defined above `Scope` (the annotation is evaluated at class creation; the package has no `from __future__ import annotations`).
- Ownership: every hop of the walk goes through `ExtractionInstanceRepository.get_on_run` (the predicate lives in the WHERE clause); the live entity-type fallback goes through `SectionExtractionService._get_entity_type(..., project_template_id=run.template_id)`, the same template-scoped read the single-section path uses. No new `get_by_id`.
- A depth-three **entity-type** tree cannot exist before B5 (`ck_extraction_entity_types_role_parent` + `check_model_section_parent_role`). Instance rows carry no such coupling (no trigger on `extraction_instances` binds a child's `parent_entity_type_id` to the parent instance's type), so the depth-three fixture is an **instance** chain whose entity types are role-legal; the walk is over instances, so this is the real code path. The fixture carries a `B5:` marker so the schema slice rebuilds it as a real entity-type chain.
- The three pre-B1 hashes, captured on `dev` `bf93a278` and asserted to have moved: `section_extraction bb62071982f1`, `quality_assessment 19018644da80`, `entry_identification f7cacd2a4efb`.
- Tests at every task, never batched at the end. Every claim of green quotes the command output.
- Conventional commits; PR to `dev`; squash-merge.

---

### Task 1: The ancestry resolver

**Files:**
- Create: `backend/app/services/entry_ancestry.py`
- Modify: `backend/app/llm/prompts/__init__.py` (add `Ancestor` after `content_version`)
- Modify: `backend/app/services/section_extraction_service.py` (`__init__`: cache attribute next to `_run_provenance`; the `app.llm.prompts` import on line 26)
- Test: `backend/tests/unit/test_entry_ancestry.py` (new)

**Interfaces:**
- Produces: `Ancestor(noun: str, label: str)` (frozen dataclass, `app.llm.prompts`).
- Produces: `async def ancestry_of(service: SectionExtractionService, run: ExtractionRun, instance_id: UUID | None) -> tuple[Ancestor, ...]` — outermost first; `()` for `None`; raises `ValueError("Parent instance not found: <id>")` when any instance on the chain is not on the run's coordinate, and `ValueError("Entity type not found: <id>")` when a type outside the pin is not the run's template's.
- Produces: `SectionExtractionService._ancestry: dict[tuple[UUID, UUID], tuple[Ancestor, ...]]` keyed by `(run.id, instance_id)`.

- [ ] **Step 1: Write the failing unit tests**

`backend/tests/unit/test_entry_ancestry.py`:

```python
"""The chain of entries an instance sits under, outermost first.

Every prompt that scopes to an entry names the WHOLE chain ("model
XGBoost › validation external"), not one parent label: a singleton at depth
three would otherwise be extracted from a prompt that never names the model
it belongs to. The walk is over instances (``parent_instance_id``), the noun
per level comes from the run-pinned tree, and the result is memoized per
``(run, instance)`` so a per-entry batch does not re-walk for every section.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from uuid import UUID, uuid4

import pytest

from app.llm.prompts import Ancestor
from app.services.entry_ancestry import ancestry_of

TEMPLATE_ID = uuid4()
RUN = SimpleNamespace(id=uuid4(), template_id=TEMPLATE_ID)
MODEL_TYPE, VALIDATION_TYPE, SECTION_TYPE = uuid4(), uuid4(), uuid4()
PINNED = [
    SimpleNamespace(id=MODEL_TYPE, entry_label="model"),
    SimpleNamespace(id=VALIDATION_TYPE, entry_label="validation"),
    SimpleNamespace(id=SECTION_TYPE, entry_label=None),
]


def _instance(entity_type_id: UUID, label: str, parent: UUID | None) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid4(), entity_type_id=entity_type_id, label=label, parent_instance_id=parent
    )


class _Instances:
    """The run-scoped getter, counting calls so the memo can be proven."""

    def __init__(self, rows: list[SimpleNamespace]) -> None:
        self.rows = {row.id: row for row in rows}
        self.calls = 0

    async def get_on_run(self, instance_id: UUID, run: Any) -> SimpleNamespace | None:
        self.calls += 1
        return self.rows.get(instance_id)


def _service(
    rows: list[SimpleNamespace],
    *,
    pinned: list[SimpleNamespace] | None = None,
    live: dict[UUID, SimpleNamespace] | None = None,
) -> SimpleNamespace:
    """The three seams the resolver uses, faked: the run-scoped instance
    getter, the pinned-tree provider and the template-scoped live read."""
    pinned_rows = pinned if pinned is not None else []
    live_rows = live or {}
    live_calls = {"n": 0}

    async def _pinned_entity_types(run: Any) -> list[SimpleNamespace]:
        return pinned_rows

    async def _get_entity_type(entity_type_id: UUID, *, project_template_id: UUID) -> Any:
        live_calls["n"] += 1
        assert project_template_id == TEMPLATE_ID, "the live read is scoped to the run's template"
        row = live_rows.get(entity_type_id)
        if row is None:
            raise ValueError(f"Entity type not found: {entity_type_id}")
        return row

    return SimpleNamespace(
        _instances=_Instances(rows),
        _pinned_entity_types=_pinned_entity_types,
        _get_entity_type=_get_entity_type,
        _ancestry={},
        live_calls=live_calls,
    )


@pytest.mark.asyncio
async def test_no_parent_means_no_ancestors() -> None:
    service = _service([])
    assert await ancestry_of(service, RUN, None) == ()
    assert service._instances.calls == 0


@pytest.mark.asyncio
async def test_a_depth_three_chain_reads_outermost_first() -> None:
    model = _instance(MODEL_TYPE, "XGBoost", None)
    validation = _instance(VALIDATION_TYPE, "external", model.id)
    section = _instance(SECTION_TYPE, "Calibration", validation.id)
    service = _service([model, validation, section], pinned=PINNED)

    chain = await ancestry_of(service, RUN, section.id)

    assert chain == (
        Ancestor(noun="model", label="XGBoost"),
        Ancestor(noun="validation", label="external"),
        Ancestor(noun="entry", label="Calibration"),
    )


@pytest.mark.asyncio
async def test_the_noun_falls_back_from_the_pin_to_the_live_row_to_the_default() -> None:
    """The pinned noun wins; a type outside the pin reads its live row through
    the template-scoped getter; a live row with no noun reads
    ``DEFAULT_ENTRY_LABEL``; a type that is not the run's template's refuses."""
    live_only, nowhere, foreign = uuid4(), uuid4(), uuid4()
    a = _instance(MODEL_TYPE, "A", None)
    b = _instance(live_only, "B", a.id)
    c = _instance(nowhere, "C", b.id)
    service = _service(
        [a, b, c],
        pinned=[SimpleNamespace(id=MODEL_TYPE, entry_label="model")],
        live={
            live_only: SimpleNamespace(id=live_only, entry_label="arm"),
            nowhere: SimpleNamespace(id=nowhere, entry_label=None),
        },
    )

    chain = await ancestry_of(service, RUN, c.id)

    assert [x.noun for x in chain] == ["model", "arm", "entry"]
    assert service.live_calls["n"] == 2, "only the two types outside the pin are read live"

    stranger = _instance(foreign, "D", c.id)
    service._instances.rows[stranger.id] = stranger
    with pytest.raises(ValueError, match=f"Entity type not found: {foreign}"):
        await ancestry_of(service, RUN, stranger.id)


@pytest.mark.asyncio
async def test_the_walk_is_memoized_per_run_and_instance() -> None:
    model = _instance(MODEL_TYPE, "XGBoost", None)
    validation = _instance(VALIDATION_TYPE, "external", model.id)
    section = _instance(SECTION_TYPE, "Calibration", validation.id)
    service = _service([model, validation, section], pinned=PINNED)

    first = await ancestry_of(service, RUN, validation.id)
    after_first = service._instances.calls
    assert first == await ancestry_of(service, RUN, validation.id)
    assert service._instances.calls == after_first, "a second walk reads nothing"
    # The parent's own chain was memoized on the way up.
    assert await ancestry_of(service, RUN, model.id) == (Ancestor("model", "XGBoost"),)
    assert service._instances.calls == after_first
    # A deeper instance whose parent is memoized reads only its own row.
    assert await ancestry_of(service, RUN, section.id) == (
        Ancestor("model", "XGBoost"),
        Ancestor("validation", "external"),
        Ancestor("entry", "Calibration"),
    )
    assert service._instances.calls == after_first + 1
    assert set(service._ancestry) == {(RUN.id, i.id) for i in (model, validation, section)}


@pytest.mark.asyncio
async def test_a_stranger_or_missing_instance_is_refused_before_any_prompt() -> None:
    service = _service([], pinned=PINNED)
    missing = uuid4()
    with pytest.raises(ValueError, match=f"Parent instance not found: {missing}"):
        await ancestry_of(service, RUN, missing)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `backend/`): `uv run pytest tests/unit/test_entry_ancestry.py -q`
Expected: `ImportError: cannot import name 'Ancestor' from 'app.llm.prompts'`

- [ ] **Step 3: Add `Ancestor` to the prompts package**

In `backend/app/llm/prompts/__init__.py`, after `content_version`:

```python
@dataclass(frozen=True)
class Ancestor:
    """One enclosing entry of the instance a prompt is about: the noun of its
    group and the entry's label, e.g. ``model "XGBoost"``. Chains read
    outermost first (see ``app.services.entry_ancestry``)."""

    noun: str
    label: str
```

- [ ] **Step 4: Write the resolver**

`backend/app/services/entry_ancestry.py`:

```python
"""The chain of entries an instance sits under, for the three prompts.

A section at any depth is extracted against ONE instance, and the prompt
has to say which entries that instance belongs to — "model XGBoost ›
validation external" — or a nested singleton is extracted from a prompt
that never names its model (the gap the trees spec §1 records). The chain
is walked over instances (``parent_instance_id``) through the run-scoped
getter, so a stranger's instance is refused before any LLM call; the noun
per level is the group's ``entry_label`` as the run is pinned to it (the
template-scoped live row for a type outside the pin, ``DEFAULT_ENTRY_LABEL``
when unset). Results are memoized on the service per ``(run, instance)``:
the per-entry batch extracts every child section under the same parent,
and only the first walks.

Lives beside ``SectionExtractionService`` (which sits on its file-size
ceiling) and takes the service for its repositories and its pinned-tree
provider, like ``entry_group_extraction`` does.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from app.llm.prompts import Ancestor
from app.models.extraction import DEFAULT_ENTRY_LABEL

if TYPE_CHECKING:
    from app.models.extraction import ExtractionRun
    from app.services.section_extraction_service import SectionExtractionService


async def ancestry_of(
    service: SectionExtractionService, run: ExtractionRun, instance_id: UUID | None
) -> tuple[Ancestor, ...]:
    """The entries enclosing ``instance_id`` (itself included), outermost
    first; ``()`` for a root section's call (no parent instance).

    Raises ``ValueError`` when any instance on the chain is not on the run's
    coordinate — the refusal the parent re-verification made before this
    walk existed, now ahead of the LLM call on every path.
    """
    if instance_id is None:
        return ()
    key = (run.id, instance_id)
    chain = service._ancestry.get(key)
    if chain is None:
        instance = await service._instances.get_on_run(instance_id, run)
        if instance is None:
            raise ValueError(f"Parent instance not found: {instance_id}")
        above = await ancestry_of(service, run, instance.parent_instance_id)
        noun = await _noun_of(service, run, instance.entity_type_id)
        chain = (*above, Ancestor(noun=noun, label=instance.label))
        service._ancestry[key] = chain
    return chain


async def _noun_of(service: SectionExtractionService, run: ExtractionRun, entity_type_id: UUID) -> str:
    """The group's noun as the run is pinned to it. A type outside the pin
    (re-pin race) reads its live row through the same template-scoped getter
    the single-section path uses, so a foreign type refuses rather than
    lending a noun; ``DEFAULT_ENTRY_LABEL`` when neither carries one."""
    pinned = await service._pinned_entity_types(run)
    entity_type: Any = next((et for et in pinned if et.id == entity_type_id), None)
    if entity_type is None:
        entity_type = await service._get_entity_type(
            entity_type_id, project_template_id=run.template_id
        )
    noun: str | None = entity_type.entry_label
    return noun or DEFAULT_ENTRY_LABEL
```

- [ ] **Step 5: Add the memo to the service**

In `backend/app/services/section_extraction_service.py` `__init__`, right after the `self._run_provenance: dict[str, Any] | None = None` line:

```python
        # Enclosing-entry chains per (run, instance) — ``entry_ancestry``.
        self._ancestry: dict[tuple[UUID, UUID], tuple[Ancestor, ...]] = {}
```

and extend the import on line 26 to `from app.llm.prompts import Ancestor, EntryScope` (the `EntryScope` half is renamed in Task 2).

- [ ] **Step 6: Run the unit tests to verify they pass**

Run: `uv run pytest tests/unit/test_entry_ancestry.py -q`
Expected: `5 passed`

- [ ] **Step 7: Lint and commit**

Run: `uv run ruff check app tests && uv run ruff format --check app tests`
Expected: `All checks passed!` and `N files already formatted`

```bash
git add backend/app/services/entry_ancestry.py backend/app/llm/prompts/__init__.py backend/app/services/section_extraction_service.py backend/tests/unit/test_entry_ancestry.py
git commit -m "feat(extraction): one ancestry resolver walks the enclosing entries of an instance, memoized per run"
```

---

### Task 2: `Scope` with an optional key and an ancestry chain; the three prompts render it

**Files:**
- Modify: `backend/app/llm/prompts/__init__.py` (the `EntryScope` dataclass and `render_entry_scope_section` through the end of the file → `Scope`, `render_ancestry`, the renderer; `Ancestor` stays above `Scope`)
- Modify: `backend/app/llm/prompts/section_extraction.py` (import, VERSION canaries, the `render` annotation)
- Modify: `backend/app/llm/prompts/quality_assessment.py` (same three)
- Modify: `backend/app/llm/prompts/entry_identification.py` (`parent_label` → `ancestors`; the parent clause; VERSION)
- Modify: `backend/app/services/entry_group_extraction.py` (`_identify_entries`, `_extract_entry_group`)
- Modify: `backend/app/services/section_extraction_service.py` (line 26 import; `_extract_with_llm` annotation + docstring clause)
- Modify: `backend/app/services/verified_mode.py` (line 25 import; `render_section_prompts` annotation + docstring clause)
- Test: `backend/tests/unit/llm/test_prompts.py` (the scope section)
- Test: `backend/tests/unit/test_entry_identification_prompt.py` (the last two tests)
- Test: `backend/tests/unit/llm/test_review_context_prompt.py` (pre-B1 hashes; the canary liveness test parametrized over renderers)
- Test: `backend/tests/integration/test_entry_group_extraction.py` (the `parent_label` assertions; the fake extractor)

**Interfaces:**
- Consumes: `Ancestor`, `ancestry_of` (Task 1).
- Produces: `Scope(entry_label: str, key_label: str | None = None, key_value: str | None = None, ancestors: tuple[Ancestor, ...] = ())` — `__post_init__` refuses a scope with neither a key value nor ancestors (it would render a dangling "identified below").
- Produces: `render_ancestry(ancestors: tuple[Ancestor, ...]) -> str` → `model "XGBoost" › validation "external"` (`""` for `()`), labels whitespace-folded to one line.
- Produces: `render_entry_scope_section(scope: Scope | None) -> str` (same name as today, new rules).
- Produces: `entry_identification.render(..., ancestors: tuple[Ancestor, ...] = ())` (the `parent_label` keyword is gone).

- [ ] **Step 1: Write the failing prompt unit tests**

Replace the scope section of `backend/tests/unit/llm/test_prompts.py` (from the `_SCOPE = EntryScope(` line to the end of the file) with:

```python
_XGBOOST = Ancestor(noun="model", label="XGBoost")
_EXTERNAL = Ancestor(noun="validation", label="external")

#: A nested group's entry: its own key, under one enclosing entry.
_ENTRY_SCOPE = Scope(
    entry_label="validation",
    key_label="Validation type",
    key_value="internal",
    ancestors=(_XGBOOST,),
)
#: A singleton under an entry: no key of its own, scoped by its chain.
_SINGLETON_SCOPE = Scope(entry_label="model", ancestors=(_XGBOOST,))
_SINGLETON_BLOCK = (
    "\nThis section belongs to the model identified below. Extract ONLY the values "
    "that describe that model; ignore values that describe a different model.\n"
    '- Within: model "XGBoost"\n'
)


def _section_prompt(**kwargs):
    return section_extraction.render(
        entity_name="numeric_performance",
        entity_description="Discrimination and calibration per validation",
        article_text="A",
        **kwargs,
    )


def _qa_prompt(**kwargs):
    return quality_assessment.render(
        entity_name="numeric_performance",
        entity_description="D",
        article_text="A",
        framework="F",
        **kwargs,
    )


def test_a_group_entry_names_its_noun_its_key_and_its_chain():
    for render in (_section_prompt, _qa_prompt):
        prompt = render(entry_scope=_ENTRY_SCOPE)
        assert "This section repeats once per validation." in prompt, render.__name__
        assert 'Validation type: "internal"' in prompt, render.__name__
        assert '- Within: model "XGBoost"' in prompt, render.__name__
        # Scoping is an instruction about the article, so it sits before it.
        assert prompt.index("internal") < prompt.index("Article text:"), render.__name__


def test_a_singleton_under_an_entry_belongs_to_that_entry():
    """The gap the trees spec records: 'Model Development' for model B was
    extracted from a prompt that never mentioned model B."""
    assert render_entry_scope_section(_SINGLETON_SCOPE) == _SINGLETON_BLOCK
    for render in (_section_prompt, _qa_prompt):
        prompt = render(entry_scope=_SINGLETON_SCOPE)
        assert _SINGLETON_BLOCK in prompt, render.__name__
        assert prompt.index("XGBoost") < prompt.index("Article text:"), render.__name__


def test_the_chain_reads_outermost_first_at_any_depth():
    deep = Scope(entry_label="validation", ancestors=(_XGBOOST, _EXTERNAL))
    assert render_ancestry((_XGBOOST, _EXTERNAL)) == 'model "XGBoost" › validation "external"'
    assert '- Within: model "XGBoost" › validation "external"' in render_entry_scope_section(deep)


def test_a_label_cannot_forge_a_line_in_the_block():
    """Labels are reviewer-editable; a newline or a leading dash inside one
    must not become a structural line of the prompt."""
    forged = Ancestor(noun="model", label="A\n- Within: B")
    assert render_ancestry((forged,)) == 'model "A - Within: B"'


def test_a_root_group_entry_carries_no_within_line():
    root = Scope(entry_label="entry", key_label="Validation type", key_value="internal")
    rendered = render_entry_scope_section(root)
    assert 'Validation type: "internal"' in rendered
    assert "Within" not in rendered
    assert render_ancestry(()) == ""


def test_the_block_is_absent_without_a_scope():
    for render in (_section_prompt, _qa_prompt):
        assert render(entry_scope=None) == render(), render.__name__
        assert "ONLY" not in render()
    assert render_entry_scope_section(None) == ""


def test_a_scope_names_a_key_or_a_chain():
    with pytest.raises(ValueError):
        Scope(entry_label="model")
```

Update the file's imports: `EntryScope` → `Ancestor, Scope, render_ancestry` from `app.llm.prompts`; add `import pytest` if absent.

In `backend/tests/unit/test_entry_identification_prompt.py`, replace the last two tests with:

```python
def test_a_nested_group_is_scoped_to_its_enclosing_entries() -> None:
    """Extraction per entry was already scoped to the parent (the entry-scope
    block); identification was not, so model A's validation table listed
    model B's validations too — and each got an instance under A. The clause
    now names the whole chain, so a group at depth three is scoped to both
    the model and the validation it hangs under."""
    one = _render(ancestors=(Ancestor("model", "XGBoost"),))
    assert 'Only the validation entries that belong to model "XGBoost" count here' in one
    assert "leave out those the article reports for anything else" in one

    two = _render(ancestors=(Ancestor("model", "XGBoost"), Ancestor("validation", "external")))
    assert 'belong to model "XGBoost" › validation "external" count here' in two


def test_a_top_level_group_carries_no_parent_clause() -> None:
    assert "belong to" not in _render(ancestors=())
    assert "belong to" not in _render()
```

with `from app.llm.prompts import Ancestor` added to its imports.

In `backend/tests/unit/llm/test_review_context_prompt.py`, after `PRE_CHANGE_VERSIONS`, add:

```python
#: The three hashes on ``dev`` before the trees train's B1 (captured at
#: ``bf93a278``). B1 changes production prompts — a singleton under an entry
#: gains the scope block, the parent clause becomes a chain — so §IX requires
#: new runs to record a new version for all three.
PRE_B1_VERSIONS = {
    "section_extraction": "bb62071982f1",
    "quality_assessment": "19018644da80",
    "entry_identification": "f7cacd2a4efb",
}
```

next to `test_version_moved_from_the_pre_change_hash`:

```python
@pytest.mark.parametrize(
    "module",
    [section_extraction, quality_assessment, entry_identification],
    ids=lambda m: m.NAME,
)
def test_version_moved_from_the_pre_b1_hash(module) -> None:
    assert PRE_B1_VERSIONS[module.NAME] != module.VERSION
```

and replace `test_the_entry_scope_canary_is_live_too` (its parametrize decorator included) with one body over `(module, renderer)`:

```python
@pytest.mark.parametrize(
    ("module", "renderer"),
    [
        (section_extraction, "render_entry_scope_section"),
        (quality_assessment, "render_entry_scope_section"),
        (section_extraction, "render_ancestry"),
        (quality_assessment, "render_ancestry"),
        (entry_identification, "render_ancestry"),
    ],
    ids=lambda v: v if isinstance(v, str) else v.NAME,
)
def test_the_scope_and_ancestry_canaries_are_live(module, renderer, monkeypatch) -> None:
    """Same proof for the scope block and the chain it names: a repeating
    group's per-entry prompt, a nested singleton's prompt and the
    identification clause are production output, so editing either
    renderer's wording must move every VERSION that interpolates it."""
    before = module.VERSION
    monkeypatch.setattr(prompts, renderer, lambda _arg: "MUTATED")
    try:
        importlib.reload(module)
        assert before != module.VERSION
    finally:
        monkeypatch.undo()
        importlib.reload(module)
    assert before == module.VERSION
```

- [ ] **Step 2: Run the unit tests to verify they fail**

Run: `uv run pytest tests/unit/llm/test_prompts.py tests/unit/test_entry_identification_prompt.py tests/unit/llm/test_review_context_prompt.py -q`
Expected: `ImportError: cannot import name 'Scope'` (and the pre-B1 test fails once imports resolve).

- [ ] **Step 3: Rewrite the scope in the prompts package**

In `backend/app/llm/prompts/__init__.py`, replace the `EntryScope` dataclass and `render_entry_scope_section` (through the end of the file) with:

```python
@dataclass(frozen=True)
class Scope:
    """Which instance ONE extraction call is about, and where it sits.

    A repeating group is extracted once per entry, and the prompt has to say
    which one or every instance receives the same values: ``entry_label`` is
    the group's noun and ``key_label``/``key_value`` its declared key
    (``is_entity_key``) as identified for this entry. A singleton under an
    entry carries no key of its own: ``entry_label`` is then the noun of the
    entry it belongs to, and the pair stays ``None``. ``ancestors`` is the
    chain of enclosing entries, outermost first, empty at the root.
    """

    entry_label: str
    key_label: str | None = None
    key_value: str | None = None
    ancestors: tuple[Ancestor, ...] = ()

    def __post_init__(self) -> None:
        if self.key_value is None and not self.ancestors:
            raise ValueError("a scope names a key, a chain of entries, or both")


def render_ancestry(ancestors: tuple[Ancestor, ...]) -> str:
    """``model "XGBoost" › validation "external"`` — outermost first. Labels
    are reviewer-edited text: folded to one line so none can forge a line."""
    return " › ".join(f'{a.noun} "{" ".join(a.label.split())}"' for a in ancestors)


def render_entry_scope_section(scope: Scope | None) -> str:
    """The scoping block; empty when the call is about a root singleton."""
    if scope is None:
        return ""
    if scope.key_value is not None:
        header = (
            f"This section repeats once per {scope.entry_label}. Extract ONLY the values "
            f"that describe the {scope.entry_label} identified below; ignore values that "
            f"describe a different {scope.entry_label}."
        )
        lines = [f'- {scope.key_label}: "{scope.key_value}"']
    else:
        header = (
            f"This section belongs to the {scope.entry_label} identified below. Extract "
            f"ONLY the values that describe that {scope.entry_label}; ignore values that "
            f"describe a different {scope.entry_label}."
        )
        lines = []
    if scope.ancestors:
        lines.append(f"- Within: {render_ancestry(scope.ancestors)}")
    listed = "\n".join(lines)
    return f"\n{header}\n{listed}\n"
```

- [ ] **Step 4: Bump the two section/QA canaries**

In `backend/app/llm/prompts/section_extraction.py` and `backend/app/llm/prompts/quality_assessment.py`, replace the import name `EntryScope` with `Ancestor, Scope`, the `render` annotation `entry_scope: EntryScope | None` with `entry_scope: Scope | None`, and the last canary argument with two:

```python
    render_entry_scope_section(Scope("x", "x", "x", (Ancestor("x", "x"),))),
    render_entry_scope_section(Scope("x", ancestors=(Ancestor("x", "x"),))),
```

- [ ] **Step 5: The identification prompt takes the chain**

In `backend/app/llm/prompts/entry_identification.py`:

```python
from app.llm.prompts import (
    Ancestor,
    content_version,
    render_ancestry,
    render_general_instructions_section,
    render_review_context_section,
)
```

```python
# Nested-group scope. Extraction per entry is already scoped to its chain
# (the entry-scope block); identification names the same chain, so a
# validation table under model A lists A's validations only — and a group at
# depth three is scoped to both the model and the validation above it.
_PARENT_SCOPE_TEMPLATE = (
    " Only the {entry_label} entries that belong to {chain} count here; "
    "leave out those the article reports for anything else."
)
```

```python
def _render_parent_scope_section(entry_label: str, ancestors: tuple[Ancestor, ...]) -> str:
    """The enclosing-entries clause of a nested group; nothing at the root."""
    if not ancestors:
        return ""
    return _PARENT_SCOPE_TEMPLATE.format(entry_label=entry_label, chain=render_ancestry(ancestors))
```

VERSION gains `render_ancestry((Ancestor("x", "x"),)),` after `render_general_instructions_section("x"),`. `render(...)` replaces `parent_label: str | None = None` with `ancestors: tuple[Ancestor, ...] = ()`, its docstring's last clause with "``ancestors`` is the chain of entries a nested group hangs under, outermost first, empty at the root", and passes `_render_parent_scope_section(entry_label, ancestors)`. Update the module docstring's sentence "A nested group is also scoped to the entry it hangs under" to "A nested group is also scoped to the chain of entries it hangs under".

- [ ] **Step 6: The pipeline builds scopes from the walk**

In `backend/app/services/entry_group_extraction.py`:

- imports: `from app.llm.prompts import Ancestor, Scope, entry_identification` and `from app.services.entry_ancestry import ancestry_of`.
- `_identify_entries`: parameter `parent_label: str | None` → `ancestors: tuple[Ancestor, ...]`; the call passes `ancestors=ancestors`; docstring clause "scoped to the parent entry the way the grounding list already is" → "scoped to the chain of enclosing entries the way the grounding list already is".
- `_extract_entry_group`: replace the `parent = None … raise ValueError` block with

```python
    # Re-verified on the way up, like the singleton auto-create: the instances
    # written below carry ``parent_instance_id`` as a foreign key.
    ancestors = await ancestry_of(service, run, parent_instance_id)
```

  pass `ancestors=ancestors` to `_identify_entries`, and build

```python
        scope = Scope(
            entry_label=entry_label,
            key_label=key_field.label,
            key_value=name,
            ancestors=ancestors,
        )
```

  Update the docstring sentence "Nested groups are scoped by ``parent_instance_id``: …" to end "…and each gets its own instance under its own parent, with the prompt naming the whole chain above it."

In `backend/app/services/section_extraction_service.py`: import `Ancestor, Scope`; the `_extract_with_llm` annotation `entry_scope: Scope | None = None`; its docstring clause becomes "``entry_scope`` names the entry, or the enclosing entries, this call is about, so the prompt asks for ONE instance's values."

In `backend/app/services/verified_mode.py`: import `Scope` instead of `EntryScope`; annotation `entry_scope: Scope | None = None`; docstring clause "``entry_scope`` names the entry, or the enclosing entries, this call is about (None for a root singleton)."

- [ ] **Step 7: Update the integration assertions**

In `backend/tests/integration/test_entry_group_extraction.py`:

- import `Ancestor, Scope` instead of `EntryScope` (the `_FakeExtractor.scopes` annotation and `fake_extract`'s local).
- `fake_extract`: `value = round(C_STAT[normalize_key(scope.key_value)] + fake.offset, 2) if scope and scope.key_value else 0.5` — a singleton's scope has no key, so it reads the flat `0.5`; an entry's key still maps through `C_STAT` (a mis-scoped entry must stay a wrong number, never a silent `0.5`).
- `test_nested_group_entries_are_scoped_by_their_parent`: `assert [s.parent_label for s in fake.scopes if s] == ["XGBoost", "LightGBM"]` → `assert [s.ancestors for s in fake.scopes if s] == [(Ancestor("model", "XGBoost"),), (Ancestor("model", "LightGBM"),)]`, and the identification assertions become `'belong to model "XGBoost"' in asked_a and "LightGBM" not in asked_a` / `'belong to model "LightGBM"' in asked_b and "XGBoost" not in asked_b`.
- `test_the_per_model_batch_routes_a_nested_group_through_the_pipeline`: `assert [s.parent_label …] == ["XGBoost", "XGBoost"]` → `assert [s.ancestors for s in fake.scopes if s] == [(Ancestor("model", "XGBoost"),)] * 2`.

- [ ] **Step 8: Run the suites**

Run: `uv run pytest tests/unit/llm tests/unit/test_entry_identification_prompt.py tests/unit/test_qa_prompt_framework_label.py tests/unit/test_entry_ancestry.py -q`
Expected: all passed, including `test_version_moved_from_the_pre_b1_hash[...]` ×3 and the five canary rows.

Run: `uv run pytest tests/integration/test_entry_group_extraction.py tests/integration/test_section_extraction_scope.py -q`
Expected: all passed.

Run (from `backend/`): `grep -rn "parent_label\|EntryScope" app/llm app/services/entry_group_extraction.py app/services/entry_ancestry.py app/services/section_extraction_service.py app/services/verified_mode.py tests/unit tests/integration/test_entry_group_extraction.py`
Expected: no output. (`template_diff.py`'s `parent_label` node attribute and `test_session_backfill_extensive.py`'s `test_backfill_label_includes_parent_label` are unrelated to the prompt scope and stay.)

- [ ] **Step 9: Lint, format, commit**

Run: `uv run ruff check app tests && uv run ruff format app tests`

```bash
git add backend/app/llm/prompts backend/app/services/entry_group_extraction.py backend/app/services/section_extraction_service.py backend/app/services/verified_mode.py backend/tests
git commit -m "feat(prompts): the scope block names the whole chain of enclosing entries; the identification clause takes the same chain"
```

---

### Task 3: A singleton under an entry is scoped

**Files:**
- Modify: `backend/app/services/entry_group_extraction.py` (`_extract_singleton`)
- Test: `backend/tests/integration/test_entry_group_extraction.py` (two helpers widened, two new tests)

**Interfaces:**
- Consumes: `Scope`, `ancestry_of`.
- Produces: `_extract_singleton` passes `entry_scope=Scope(entry_label=<parent noun>, ancestors=<chain>)` to `_extract_with_llm` whenever `parent_instance_id` is set; `None` at the root as today.

- [ ] **Step 1: Write the failing integration tests**

Widen two helpers in `backend/tests/integration/test_entry_group_extraction.py`:

- `_group` gains `cardinality: str = "many"` and `entry_label: str | None = None`: add `cardinality, entry_label` to the INSERT's column list, bind `:cardinality` and `:entry_label` in VALUES (replacing the `'many'` literal), and add both to the params dict. A `cardinality='one'` row routes through `_extract_singleton` (`key_field_of` returns `None` for anything but `many`); its key field is inert.
- `_instance` gains `parent: UUID | None = None`: add `parent_instance_id` to the column list, `:parent` to VALUES, `"parent": parent` to the params.

Then, in the `extract_section` block after `test_nested_group_entries_are_scoped_by_their_parent`:

```python
async def test_a_singleton_under_an_entry_is_scoped_to_that_entry(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Trees spec §1: 'Model Development' for model B used to be extracted
    from a prompt that never mentioned model B. The singleton's call now
    carries the chain it belongs to, and its proposal lands on the instance
    under that entry."""
    container = await _container(db_session)
    xgboost = await _instance(db_session, container, "XGBoost")
    development, _key_id, value_id = await _group(
        db_session, role="model_section", parent=container, cardinality="one", label="Model development"
    )
    run = await _run_in_extract(db_session)
    service, fake = _service(db_session)
    identification = _fake_identification(monkeypatch, [])

    result = await service.extract_section(
        **_coord(), entity_type_id=development, parent_instance_id=xgboost, run_id=run.id
    )

    assert result.suggestions_created == 1
    (scope,) = fake.scopes
    assert scope == Scope(entry_label="model", ancestors=(Ancestor("model", "XGBoost"),))
    assert "This section belongs to the model identified below." in render_entry_scope_section(scope)
    assert identification["prompts"] == [], "a singleton is never identified"
    (materialized,) = await _entries(db_session, development, parent=xgboost)
    assert await _proposed(db_session, materialized[0], value_id) == [0.5]


async def test_a_section_at_depth_three_names_the_whole_chain(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A singleton under a validation under a model: the block reads
    ``model "XGBoost" › validation "external"``, outermost first, and a
    group asked under that validation is identified within the same chain.

    B5: rebuild as a real entity-type chain once
    ``ck_extraction_entity_types_role_parent`` is dropped — until then the
    leaf and the subgroup are role-legal children of the container whose
    INSTANCES hang under the validation entry (nothing on
    ``extraction_instances`` couples the two), which is the path the walk
    reads.
    """
    container = await _container(db_session)
    validations, _key_id, _value_id = await _group(
        db_session, role="model_section", parent=container, entry_label="validation"
    )
    xgboost = await _instance(db_session, container, "XGBoost")
    external = await _instance(db_session, validations, "external", parent=xgboost)
    leaf, _leaf_key, leaf_value = await _group(
        db_session, role="model_section", parent=container, cardinality="one", label="Calibration plot"
    )
    run = await _run_in_extract(db_session)
    service, fake = _service(db_session)
    identification = _fake_identification(monkeypatch, ["apparent"])

    await service.extract_section(
        **_coord(), entity_type_id=leaf, parent_instance_id=external, run_id=run.id
    )
    (scope,) = fake.scopes
    assert scope is not None and scope.ancestors == (
        Ancestor("model", "XGBoost"),
        Ancestor("validation", "external"),
    )
    assert '- Within: model "XGBoost" › validation "external"' in render_entry_scope_section(scope)
    (calibration,) = await _entries(db_session, leaf, parent=external)
    assert await _proposed(db_session, calibration[0], leaf_value) == [0.5]

    # A group hanging under the depth-two entry: its identification is scoped
    # to the same chain, its entry carries it too, and the value lands under
    # that entry (the fake maps a validation-type key to its C-statistic).
    subgroups, _sub_key, sub_value = await _group(
        db_session, role="model_section", parent=container, entry_label="subgroup"
    )
    await service.extract_section(
        **_coord(), entity_type_id=subgroups, parent_instance_id=external, run_id=run.id
    )
    assert len(identification["prompts"]) == 1
    assert 'belong to model "XGBoost" › validation "external"' in identification["prompts"][0]
    assert fake.scopes[-1] is not None
    assert fake.scopes[-1].key_value == "apparent"
    assert fake.scopes[-1].ancestors == scope.ancestors
    (entry,) = await _entries(db_session, subgroups, parent=external)
    assert await _proposed(db_session, entry[0], sub_value) == [C_STAT["apparent"]]
```

Add `render_entry_scope_section` to the `app.llm.prompts` import.

- [ ] **Step 2: Run them to verify they fail**

Run: `uv run pytest tests/integration/test_entry_group_extraction.py -q -k "singleton_under or depth_three"`
Expected: the first fails on `(scope,) = fake.scopes` → `scope is None` (`AssertionError`), the second on `scope is not None`.

- [ ] **Step 3: Scope the singleton call**

In `_extract_singleton` (`backend/app/services/entry_group_extraction.py`), before the `_extract_with_llm` call:

```python
    scope: Scope | None = None
    if parent_instance_id is not None:
        # The chain this singleton belongs to — re-verified on the way up,
        # ahead of the LLM call rather than at the instance write.
        ancestors = await ancestry_of(service, run, parent_instance_id)
        scope = Scope(entry_label=ancestors[-1].noun, ancestors=ancestors)
```

and pass `entry_scope=scope` to `service._extract_with_llm(...)`. Update the function docstring to: "Extract → verify → record against the section's one instance. Under an entry, the prompt names the chain the instance belongs to; at the root there is nothing to scope to."

- [ ] **Step 4: Run the whole integration file and the unit suite**

Run: `uv run pytest tests/integration/test_entry_group_extraction.py -q`
Expected: all passed (the pre-existing tests still see `None` scopes for root singletons — none of them extract a nested singleton).

Run: `uv run pytest tests/unit -q -x`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/entry_group_extraction.py backend/tests/integration/test_entry_group_extraction.py
git commit -m "feat(extraction): a singleton under an entry is extracted within its chain of entries"
```

---

### Task 4: Docs, the no-drift proofs, and the gates

**Files:**
- Modify: `docs/superpowers/specs/2026-09-03-entry-group-trees-design.md:1-4` (`status: in_progress`, `last_reviewed: 2026-09-05`)
- Modify: `CLAUDE.md` "Current focus" (the trees spec is the current focus while the train runs — spec §14)
- Modify: `docs/ROADMAP.md` "Current cycle" (one bullet)
- Modify: `.markdownlintignore` (register this plan)

- [ ] **Step 1: Frontmatter and focus lines**

Spec frontmatter: `status: in_progress`, `last_reviewed: 2026-09-05`.

`CLAUDE.md` "Current focus" first bullet, replacing the "Now:" clause and keeping the section at ≤ 5 lines:

```markdown
- See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the live cycle — the
  source of truth; don't re-pin a date here. Now: the entry-group trees
  train (`docs/superpowers/specs/2026-09-03-entry-group-trees-design.md`,
  six slices; B1 shipped). ADR-0011 still **proposed**; app-schema reads
  other than extraction still use PostgREST.
```

`docs/ROADMAP.md` "Current cycle" — add as the first bullet:

```markdown
- [ ] **Entry-group trees** — any repeating section owns children at any depth, several root groups, no `role` (`docs/superpowers/specs/2026-09-03-entry-group-trees-design.md`, six slices). B1 (ancestry on the three prompts) shipped 2026-09-05; B2–B6 queued.
```

`.markdownlintignore`: add `docs/superpowers/plans/2026-09-05-trees-b1-ancestry-prompts.md` under the last plan line.

- [ ] **Step 2: Prove no wire drift**

Run (repo root): `bash scripts/generate_api_types.sh && git status --short frontend/types/api`
Expected: no output from `git status` (the OpenAPI document is unchanged: prompts are not on the wire).

- [ ] **Step 3: Prove the legacy row is gone**

Run (repo root): `grep -rn "parent_label" backend/app/llm backend/app/services/entry_group_extraction.py backend/app/services/entry_ancestry.py; grep -rn "EntryScope" backend frontend`
Expected: no output (paste into the PR body per spec §12).

- [ ] **Step 4: Backend gates**

From `backend/`:

- `uv run ruff check app tests && uv run ruff format --check app tests` → clean.
- `uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec` → OK, baseline not larger.
- `uv run mypy app --ignore-missing-imports > mypy.out || true; uv run python ../scripts/mypy_baseline.py --baseline .mypy_baseline --input mypy.out` → no new (file, code) pair.
- `uv run pytest tests/unit -q` → all passed.
- `uv run pytest tests/integration/test_entry_group_extraction.py tests/integration/test_section_extraction_scope.py tests/integration/test_pinned_prompt_structure.py -q` → all passed.

From the repo root: `make quality-scan` → every gate OK (paste the tail).

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-09-03-entry-group-trees-design.md CLAUDE.md docs/ROADMAP.md .markdownlintignore docs/superpowers/plans/2026-09-05-trees-b1-ancestry-prompts.md
git commit -m "docs: the entry-group trees train is in progress; B1 plan"
```

---

## Self-review

- **Spec coverage.** §6 Ancestry → Task 1 (`ancestry_of`, `Ancestor`, pinned-then-live-then-default noun, per-run memo). §6 Scope block (group entry, singleton, `Within` chain, one renderer for section + QA) → Task 2 Step 3. §6 identification clause with the chain → Task 2 Step 5. §6 "three VERSION lists gain the singleton render and a chained render" → Task 2 Steps 4–5. §11 row "Single `parent_label`" → Task 2 Step 8's grep. §13 B1 verify (three renders, depth-three fixture, QA prompt test, versions differ from dev) → Task 2 Step 1 (`test_prompts` covers both renders for section and QA; `PRE_B1_VERSIONS`), Task 3 Step 1 (depth-three chain, real DB). §16 file-size ratchet → Global Constraints (new module; +3 lines on the service). Not in B1 by design: recursion into children after each write (§6 "Recursion") and the model pipeline's retirement are B2/B6 — the batch and single-section paths already pass the parent instance, which is where the chain is read from.
- **Placeholders.** None: every step has its code or its exact command.
- **Type consistency.** `Ancestor(noun, label)` positional in tests matches the dataclass field order; `Scope(entry_label, key_label, key_value, ancestors)` positional in the canaries matches the field order; `ancestry_of(service, run, instance_id)` is the same signature in Tasks 1–3; `render_ancestry(tuple[Ancestor, ...]) -> str` is used by the renderer (Task 2 Step 3), the identification prompt (Step 5) and the tests; `_get_entity_type(entity_type_id, *, project_template_id)` matches the service's existing signature and the unit fake.
