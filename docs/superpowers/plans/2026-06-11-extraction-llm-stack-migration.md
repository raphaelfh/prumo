---
status: ready
created: 2026-06-11
last_reviewed: 2026-06-11
owner: '@raphaelfh'
---

# Extraction LLM Stack Migration (Pydantic AI + Logfire) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-rolled OpenAI-over-httpx extraction call layer with a typed Pydantic AI v1 call layer (`backend/app/llm/`), versioned prompts, and Logfire observability — then delete the legacy layer entirely.

**Architecture:** A new bounded module `backend/app/llm/` becomes the single doorway to LLMs (provider resolution, runtime schema building from `extraction_fields` rows, typed extraction calls with semantic reask, versioned prompts, observability bootstrap). The two extraction services keep their public APIs, DB writes, API envelopes, and structlog events unchanged; only their internals migrate. Spec: `docs/superpowers/specs/2026-06-11-extraction-llm-stack-design.md`.

**Tech Stack:** Python 3.11, FastAPI, Celery (async bridge via `app.worker._runner.run_task`), SQLAlchemy 2.0 async, Pydantic v2, `pydantic-ai-slim[openai]` (pinned `<2`), `logfire[fastapi,celery]`, pytest (asyncio auto mode), uv.

---

## Execution notes (read first)

- **Branch:** work on `claude/extraction-llm-stack-design` (the spec lives there). Use a worktree if the main checkout is busy.
- **All backend commands run from `backend/`** with `uv run ...`. Unit tests need no Docker; only `tests/integration/` needs local Supabase.
- **Verification gate per phase:** `make quality-scan` from the repo root must be green at the end of each phase (tasks 7, 9, 12, 14).
- **Invariants (do not break):** same DB writes (`extraction_proposal_records`, `extraction_evidence`, `extraction_runs`), same `tokens_prompt`/`tokens_completion`/`tokens_total` keys in `extraction_runs.results`, same structlog event names, same service public signatures (`extract_section`, `extract_for_run`, `extract_all_sections`, `extract`), same API envelopes.
- **Behavior changes that ARE intended:** (1) malformed/invalid LLM output no longer degrades to a silent empty dict — it reasks up to 2x then fails the run; (2) an entity type with zero fields no longer makes an LLM call at all; (3) the `build_schema` key disappears from `phase_durations_ms` (informational only).
- Python version note: `pydantic-ai-slim` v1 supports Python 3.11.

---

## File structure (the decomposition)

```text
backend/app/llm/                      # NEW — single doorway to LLMs
  __init__.py                         # empty marker
  provider.py                         # BYOK key + model name → pydantic-ai Model
  schema.py                           # extraction_fields rows → runtime Pydantic models (+ chunker)
  validators.py                       # semantic checks that raise ModelRetry
  extractor.py                        # extract_structured() + LlmUsage
  observability.py                    # Logfire bootstrap (inert without LOGFIRE_TOKEN)
  prompts/
    __init__.py                       # MAX_PDF_CHARS, content_version(), render_memory_section()
    section_extraction.py             # NAME, VERSION, SYSTEM_PROMPT, render()
    quality_assessment.py             # NAME, VERSION, system_prompt(), render()
    model_identification.py           # NAME, VERSION, SYSTEM_PROMPT, render(), output models

backend/tests/unit/llm/               # NEW — mirrors the package
  __init__.py
  test_provider.py
  test_schema.py
  test_validators.py
  test_extractor.py
  test_prompts.py
  test_observability.py
  test_live_smoke.py                  # @pytest.mark.llm, opt-in via env

MODIFIED:
  backend/pyproject.toml              # deps in/out + new `llm` marker
  backend/tests/conftest.py           # ALLOW_MODEL_REQUESTS=False + logfire off
  backend/app/main.py                 # lifespan: configure_observability + instrument_fastapi
  backend/app/worker/celery_app.py    # worker_init signal → configure_observability
  backend/app/core/logging.py         # conditional logfire.StructlogProcessor
  backend/app/core/config.py          # (Phase 4) remove LANGSMITH block
  backend/app/services/model_extraction_service.py
  backend/app/services/section_extraction_service.py
  backend/tests/unit/test_model_extraction_service.py
  backend/tests/unit/test_section_extraction_service.py
  scripts/fitness/check_layered_arch.py  # register app.llm as a support prefix
  app/utils/__init__.py               # (Phase 4) drop json_parser re-exports

DELETED (Phase 2/4):
  backend/app/services/llm/           # old prompt location (ported to app/llm/prompts/)
  backend/app/services/openai_service.py
  backend/tests/unit/test_openai_service.py
  backend/app/utils/json_parser.py
```

---

# Phase 1 — Foundation (`app/llm/` package)

### Task 1: Dependencies + test-suite guards

**Files:**
- Modify: `backend/pyproject.toml`
- Modify: `backend/tests/conftest.py`
- Modify: `scripts/fitness/check_layered_arch.py`

- [ ] **Step 1: Add the new dependencies via uv**

```bash
cd backend && uv add "pydantic-ai-slim[openai]>=1.107.0,<2.0.0" "logfire[fastapi,celery]>=3.0.0"
```

Expected: `pyproject.toml` gains both entries under `dependencies` and `uv.lock` is updated. (Move the two lines next to the `# AI/LLM` comment block for tidiness.)

- [ ] **Step 2: Verify imports resolve**

```bash
cd backend && uv run python -c "import pydantic_ai, logfire; print(pydantic_ai.__version__)"
```

Expected: prints a `1.x` version (>= 1.107), no errors. If it prints `2.x`, the pin is wrong — fix the constraint before continuing.

- [ ] **Step 3: Register the `llm` pytest marker**

In `backend/pyproject.toml`, extend `[tool.pytest.ini_options] markers`:

```toml
markers = [
    "e2e: end-to-end tests against live stack",
    "performance: performance-sensitive or long-running tests",
    "integration: integration test requiring db_session + seeded fixtures from tests/integration/conftest.py",
    "llm: live LLM smoke test; excluded unless PRUMO_LLM_SMOKE=1",
]
```

- [ ] **Step 4: Make the test suite LLM-proof**

In `backend/tests/conftest.py`, immediately after the existing imports add:

```python
import logfire
import pydantic_ai.models

# No telemetry export and no real LLM call can escape the test suite.
logfire.configure(send_to_logfire=False, console=False)
pydantic_ai.models.ALLOW_MODEL_REQUESTS = False
```

- [ ] **Step 5: Declare `app.llm` a cross-cutting module in the fitness rule**

In `scripts/fitness/check_layered_arch.py`, extend `SUPPORT_PREFIXES`:

```python
SUPPORT_PREFIXES = (
    "app.core",
    "app.utils",
    "app.config",
    "app.exceptions",
    "app.domain",
    "app.schemas",
    "app.llm",
)
```

- [ ] **Step 6: Run the existing unit suite to confirm nothing broke**

```bash
cd backend && uv run pytest tests/unit -q 2>&1 | tail -5
```

Expected: same pass count as before this task (the conftest guards are additive).

- [ ] **Step 7: Commit**

```bash
git add backend/pyproject.toml backend/uv.lock backend/tests/conftest.py scripts/fitness/check_layered_arch.py
git commit -m "feat(llm): add pydantic-ai-slim + logfire deps, test guards, fitness support prefix"
```

---

### Task 2: `app/llm/schema.py` — runtime output models + chunker

**Files:**
- Create: `backend/app/llm/__init__.py`
- Create: `backend/app/llm/schema.py`
- Create: `backend/tests/unit/llm/__init__.py`
- Test: `backend/tests/unit/llm/test_schema.py`

- [ ] **Step 1: Create package markers**

`backend/app/llm/__init__.py` and `backend/tests/unit/llm/__init__.py`, both containing only:

```python
"""LLM call layer — the single doorway to language models."""
```

(test package marker may be an empty file)

- [ ] **Step 2: Write the failing tests**

`backend/tests/unit/llm/test_schema.py`:

```python
"""Unit tests for the runtime schema builder (DB field rows → Pydantic models)."""

from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.llm.schema import (
    OPENAI_STRICT_PROPERTY_BUDGET,
    build_output_models,
    dump_extraction,
)


def _field(name="population", field_type="text", llm_description="desc",
           description=None, allowed_values=None, is_required=False):
    return SimpleNamespace(
        name=name,
        field_type=field_type,
        llm_description=llm_description,
        description=description,
        allowed_values=allowed_values,
        is_required=is_required,
    )


def _entity_type(fields):
    return SimpleNamespace(name="study_section", description="A section", fields=fields)


def test_no_fields_returns_no_models():
    assert build_output_models(_entity_type([])) == []
    assert build_output_models(_entity_type(None)) == []


def test_text_field_round_trip():
    [model] = build_output_models(_entity_type([_field(name="population")]))
    instance = model.model_validate(
        {
            "population": {
                "value": "adults with sepsis",
                "confidence": 0.9,
                "reasoning": "stated in methods",
                "evidence": {"text": "We enrolled adults...", "page_number": 3},
            }
        }
    )
    data = dump_extraction(instance)
    assert data["population"]["value"] == "adults with sepsis"
    assert data["population"]["confidence"] == 0.9
    assert data["population"]["evidence"]["page_number"] == 3


def test_value_may_be_null_when_not_found():
    [model] = build_output_models(_entity_type([_field()]))
    instance = model.model_validate(
        {"population": {"value": None, "confidence": 0.0, "reasoning": None, "evidence": None}}
    )
    assert dump_extraction(instance)["population"]["value"] is None


def test_select_field_rejects_out_of_enum_value():
    field = _field(
        name="risk",
        field_type="select",
        allowed_values={"options": [{"value": "Low"}, {"value": "High"}]},
    )
    [model] = build_output_models(_entity_type([field]))
    with pytest.raises(ValidationError):
        model.model_validate(
            {"risk": {"value": "Medium", "confidence": 0.5, "reasoning": None, "evidence": None}}
        )
    instance = model.model_validate(
        {"risk": {"value": "Low", "confidence": 0.5, "reasoning": None, "evidence": None}}
    )
    assert dump_extraction(instance)["risk"]["value"] == "Low"


def test_multiselect_field_is_list_of_enum():
    field = _field(
        name="outcomes",
        field_type="multiselect",
        allowed_values=["mortality", "icu_stay"],
    )
    [model] = build_output_models(_entity_type([field]))
    instance = model.model_validate(
        {
            "outcomes": {
                "value": ["mortality"],
                "confidence": 0.8,
                "reasoning": None,
                "evidence": None,
            }
        }
    )
    assert dump_extraction(instance)["outcomes"]["value"] == ["mortality"]
    with pytest.raises(ValidationError):
        model.model_validate(
            {"outcomes": {"value": ["weird"], "confidence": 0.8, "reasoning": None, "evidence": None}}
        )


def test_confidence_out_of_range_rejected():
    [model] = build_output_models(_entity_type([_field()]))
    with pytest.raises(ValidationError):
        model.model_validate(
            {"population": {"value": "x", "confidence": 1.2, "reasoning": None, "evidence": None}}
        )


def test_number_and_boolean_types():
    fields = [_field(name="sample_size", field_type="number"),
              _field(name="multicentre", field_type="boolean")]
    [model] = build_output_models(_entity_type(fields))
    instance = model.model_validate(
        {
            "sample_size": {"value": 412, "confidence": 1.0, "reasoning": None, "evidence": None},
            "multicentre": {"value": True, "confidence": 1.0, "reasoning": None, "evidence": None},
        }
    )
    data = dump_extraction(instance)
    assert data["sample_size"]["value"] == 412
    assert data["multicentre"]["value"] is True


def test_field_name_with_spaces_round_trips_via_alias():
    [model] = build_output_models(_entity_type([_field(name="sample size (n)")]))
    instance = model.model_validate(
        {"sample size (n)": {"value": "412", "confidence": 1.0, "reasoning": None, "evidence": None}}
    )
    assert "sample size (n)" in dump_extraction(instance)


def test_chunking_splits_large_templates():
    n_fields = 30
    fields = [_field(name=f"field_{i}") for i in range(n_fields)]
    models = build_output_models(_entity_type(fields))
    assert len(models) >= 2
    per_chunk = OPENAI_STRICT_PROPERTY_BUDGET // 7
    total = sum(len(m.model_fields) for m in models)
    assert total == n_fields
    assert all(len(m.model_fields) <= per_chunk for m in models)


def test_extra_fields_forbidden():
    [model] = build_output_models(_entity_type([_field()]))
    with pytest.raises(ValidationError):
        model.model_validate(
            {
                "population": {"value": "x", "confidence": 0.5, "reasoning": None, "evidence": None},
                "hallucinated": {"value": "y", "confidence": 0.5, "reasoning": None, "evidence": None},
            }
        )
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd backend && uv run pytest tests/unit/llm/test_schema.py -q
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.llm.schema'`.

- [ ] **Step 4: Implement `backend/app/llm/schema.py`**

```python
"""extraction_fields rows → runtime Pydantic output models.

Builds one Pydantic model per chunk of fields. OpenAI strict-mode schemas
allow ~100 properties and each extraction field expands to ~7 (value,
confidence, reasoning, evidence{text, page_number} + the container), so
large UI-built templates are split into multiple calls and merged by the
caller. DB field names are mapped through aliases so any template name —
spaces, parentheses, leading digits — round-trips safely.
"""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, create_model

OPENAI_STRICT_PROPERTY_BUDGET = 100
_PROPERTIES_PER_FIELD = 7


class Evidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(description="Short verbatim quote from the article supporting the value.")
    page_number: int | None = Field(
        description="1-based page number of the quote, null if unknown."
    )


_SCALAR_TYPES: dict[str, type] = {
    "text": str,
    "string": str,
    "date": str,
    "number": float,
    "integer": float,
    "float": float,
    "boolean": bool,
}

_LIST_TYPES = ("array", "list", "multiselect")


def _enum_values(field: Any) -> list[Any]:
    """allowed_values can be {"options": [...]} or [...]; options are
    dicts with a "value" key or plain strings (same tolerance as the
    legacy schema builder)."""
    allowed = getattr(field, "allowed_values", None)
    if isinstance(allowed, dict) and "options" in allowed:
        options = allowed["options"]
    elif isinstance(allowed, list):
        options = allowed
    else:
        return []
    values: list[Any] = []
    for opt in options or []:
        if isinstance(opt, dict) and "value" in opt:
            values.append(opt["value"])
        elif isinstance(opt, str):
            values.append(opt)
    return values


def _description(field: Any) -> str:
    raw = getattr(field, "llm_description", None) or getattr(field, "description", None) or ""
    return str(raw)


def _value_type(field: Any) -> Any:
    field_type = getattr(field, "field_type", None) or "text"
    enum_values = _enum_values(field)
    if enum_values:
        literal = Literal[tuple(enum_values)]
        if field_type in _LIST_TYPES:
            return list[literal]
        return literal
    if field_type in _LIST_TYPES:
        return list[str]
    return _SCALAR_TYPES.get(field_type, str)


def _field_result_model(field: Any, index: int) -> type[BaseModel]:
    # Every property is required (nullable where optional) so the schema
    # stays inside the OpenAI strict-mode subset.
    return create_model(
        f"Field{index}Result",
        __config__=ConfigDict(extra="forbid"),
        value=(
            _value_type(field) | None,
            Field(description="The extracted value; null when the article does not contain it."),
        ),
        confidence=(
            float,
            Field(ge=0.0, le=1.0, description="1 = very confident, 0 = not found/uncertain."),
        ),
        reasoning=(
            str | None,
            Field(description="1-2 sentence justification for the value, null if none."),
        ),
        evidence=(
            Evidence | None,
            Field(description="Supporting quote from the article, null if none."),
        ),
    )


def build_output_models(entity_type: Any) -> list[type[BaseModel]]:
    """One Pydantic model per chunk of the entity type's fields.

    Returns an empty list when the template has no fields — callers skip
    the LLM call entirely.
    """
    fields = list(getattr(entity_type, "fields", None) or [])
    if not fields:
        return []
    max_fields = max(1, OPENAI_STRICT_PROPERTY_BUDGET // _PROPERTIES_PER_FIELD)
    chunks = [fields[i : i + max_fields] for i in range(0, len(fields), max_fields)]
    models: list[type[BaseModel]] = []
    for chunk_index, chunk in enumerate(chunks):
        definitions: dict[str, Any] = {
            f"field_{index}": (
                _field_result_model(field, index=index),
                Field(alias=str(field.name), description=_description(field)),
            )
            for index, field in enumerate(chunk)
        }
        models.append(
            create_model(
                f"ExtractionChunk{chunk_index}",
                __config__=ConfigDict(extra="forbid"),
                **definitions,
            )
        )
    return models


def dump_extraction(output: BaseModel) -> dict[str, Any]:
    """Typed output → the dict shape ``_create_suggestions`` consumes:
    ``{field_name: {value, confidence, reasoning, evidence}}``."""
    return output.model_dump(by_alias=True)
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd backend && uv run pytest tests/unit/llm/test_schema.py -q
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/llm/__init__.py backend/app/llm/schema.py backend/tests/unit/llm/
git commit -m "feat(llm): runtime schema builder with typed enums and strict-mode chunker"
```

---

### Task 3: `app/llm/prompts/` — versioned prompt templates

**Files:**
- Create: `backend/app/llm/prompts/__init__.py`
- Create: `backend/app/llm/prompts/section_extraction.py`
- Create: `backend/app/llm/prompts/quality_assessment.py`
- Create: `backend/app/llm/prompts/model_identification.py`
- Test: `backend/tests/unit/llm/test_prompts.py`

- [ ] **Step 1: Write the failing tests**

`backend/tests/unit/llm/test_prompts.py`:

```python
"""Prompt templates: rendering, truncation, and stable content versions."""

from app.llm.prompts import MAX_PDF_CHARS, content_version, render_memory_section
from app.llm.prompts import model_identification, quality_assessment, section_extraction


def test_content_version_is_stable_and_short():
    v1 = content_version("a", "b")
    assert v1 == content_version("a", "b")
    assert v1 != content_version("a", "c")
    assert len(v1) == 12


def test_all_prompt_modules_declare_name_and_version():
    for module in (section_extraction, quality_assessment, model_identification):
        assert isinstance(module.NAME, str) and module.NAME
        assert isinstance(module.VERSION, str) and len(module.VERSION) == 12


def test_memory_section_empty_and_populated():
    assert render_memory_section(None) == ""
    assert render_memory_section([]) == ""
    rendered = render_memory_section(
        [{"entity_type_name": "Population", "summary": "adults, n=412"}]
    )
    assert "1. Population: adults, n=412" in rendered
    assert "PREVIOUSLY EXTRACTED SECTIONS" in rendered


def test_section_extraction_render_includes_context_and_truncates():
    prompt = section_extraction.render(
        entity_name="Population",
        entity_description="Who was studied",
        article_text="x" * (MAX_PDF_CHARS + 5000),
        memory_context=[{"entity_type_name": "Methods", "summary": "RCT"}],
    )
    assert "Section: Population" in prompt
    assert "Who was studied" in prompt
    assert "1. Methods: RCT" in prompt
    assert prompt.count("x") == MAX_PDF_CHARS


def test_quality_assessment_render_mentions_framework():
    prompt = quality_assessment.render(
        entity_name="Domain 1",
        entity_description="Participant selection",
        article_text="text",
        framework="PROBAST",
    )
    assert "PROBAST" in prompt
    assert "Domain: Domain 1" in prompt
    system = quality_assessment.system_prompt("PROBAST")
    assert "PROBAST" in system
    assert "the assessment tool" in quality_assessment.system_prompt(None)


def test_model_identification_render_and_output_model():
    prompt = model_identification.render(
        container_label="prediction models", article_text="y" * (MAX_PDF_CHARS + 10)
    )
    assert "prediction models" in prompt
    assert prompt.count("y") == MAX_PDF_CHARS
    output = model_identification.ModelIdentificationOutput.model_validate(
        {"models": [{"name": "Cox model"}]}
    )
    assert output.models[0].name == "Cox model"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && uv run pytest tests/unit/llm/test_prompts.py -q
```

Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Implement `backend/app/llm/prompts/__init__.py`**

```python
"""Versioned prompt templates.

Each module exposes ``NAME``, ``VERSION`` (a content hash — editing the
template bumps it automatically) and a ``render(...)`` function. The
extractor stamps ``prompt.name`` / ``prompt.version`` on every span, so
every production trace resolves to an exact git version of the prompt.
"""

import hashlib

# Truncation budget carried over from the legacy prompts.
MAX_PDF_CHARS = 15_000


def content_version(*parts: str) -> str:
    digest = hashlib.sha256("\n---\n".join(parts).encode("utf-8")).hexdigest()
    return digest[:12]


def render_memory_section(memory_context: list[dict[str, str]] | None) -> str:
    """Summarized history of previously extracted sections (batch mode)."""
    if not memory_context:
        return ""
    memory_lines = [
        f"{idx + 1}. {mem['entity_type_name']}: {mem['summary']}"
        for idx, mem in enumerate(memory_context)
    ]
    joined = "\n".join(memory_lines)
    return f"""
--- CONTEXT FROM PREVIOUSLY EXTRACTED SECTIONS ---
{joined}

Use this context to maintain consistency and avoid contradictions with previously extracted data.
"""
```

- [ ] **Step 4: Implement `backend/app/llm/prompts/section_extraction.py`**

The text is the legacy prompt from `section_extraction_service._extract_with_llm`, minus the inline JSON-schema dump and the example block (the schema now travels via structured output).

```python
"""Prompt for extracting one template section from an article."""

from app.llm.prompts import MAX_PDF_CHARS, content_version, render_memory_section

NAME = "section_extraction"

SYSTEM_PROMPT = (
    "You are an expert at extracting structured data from scientific "
    "articles. For each field, provide the value, your confidence level "
    "(0-1), and brief reasoning."
)

_USER_TEMPLATE = """Extract the following information from the scientific article:

Section: {entity_name}
Description: {entity_description}
{memory_section}
Article text:
{article_text}

For EACH field in the response schema, return an object with:
- "value": the extracted value (matching the field type and allowed values if specified); null when the article does not contain it
- "confidence": a number between 0 and 1 indicating your confidence in the extraction (1 = very confident, 0 = not found/uncertain)
- "reasoning": a brief explanation (1-2 sentences) of why you extracted this value or why you're uncertain
- "evidence": an object with "text" (short quoted passage from the article supporting the value) and "page_number" (integer, if known), or null
"""

VERSION = content_version(SYSTEM_PROMPT, _USER_TEMPLATE)


def render(
    *,
    entity_name: str,
    entity_description: str,
    article_text: str,
    memory_context: list[dict[str, str]] | None = None,
) -> str:
    return _USER_TEMPLATE.format(
        entity_name=entity_name,
        entity_description=entity_description,
        memory_section=render_memory_section(memory_context),
        article_text=article_text[:MAX_PDF_CHARS],
    )
```

- [ ] **Step 5: Implement `backend/app/llm/prompts/quality_assessment.py`**

```python
"""Prompt for grading a study against a bias-assessment framework
(PROBAST / QUADAS-2). Same response shape as section extraction so the
downstream proposal writes are identical."""

from app.llm.prompts import MAX_PDF_CHARS, content_version, render_memory_section

NAME = "quality_assessment"

_SYSTEM_TEMPLATE = (
    "You are a clinical-evidence methodologist assessing a study using "
    "{framework_label}. For each signaling question or judgment field, "
    "choose strictly from the field's allowed values, justify your "
    "choice with a one or two-sentence reasoning, and include a short "
    "verbatim quote from the article as evidence whenever possible. "
    "Be conservative: when the article does not provide enough "
    "information to decide, prefer the value that captures uncertainty "
    "(e.g., 'No information' or 'Probably no') over guessing."
)

_USER_TEMPLATE = """Assess the following domain of {framework_label} for the study below.

Domain: {entity_name}
Description: {entity_description}
{memory_section}
Article text:
{article_text}

For EACH field in the response schema, return an object with:
- "value": one of the field's allowed values
- "confidence": number between 0 and 1 (1 = very confident in the judgment, 0 = no signal in the article)
- "reasoning": 1-2 sentences justifying the judgment against the {framework_label} criterion
- "evidence": an object with "text" (short quoted passage supporting the judgment) and "page_number" (integer, if known), or null
"""

VERSION = content_version(_SYSTEM_TEMPLATE, _USER_TEMPLATE)

_DEFAULT_FRAMEWORK_LABEL = "the assessment tool"


def system_prompt(framework: str | None) -> str:
    return _SYSTEM_TEMPLATE.format(framework_label=framework or _DEFAULT_FRAMEWORK_LABEL)


def render(
    *,
    entity_name: str,
    entity_description: str,
    article_text: str,
    framework: str | None,
    memory_context: list[dict[str, str]] | None = None,
) -> str:
    return _USER_TEMPLATE.format(
        framework_label=framework or _DEFAULT_FRAMEWORK_LABEL,
        entity_name=entity_name,
        entity_description=entity_description,
        memory_section=render_memory_section(memory_context),
        article_text=article_text[:MAX_PDF_CHARS],
    )
```

- [ ] **Step 6: Implement `backend/app/llm/prompts/model_identification.py`**

Ports `app/services/llm/model_identification_prompt.py`. The output model is static (not template-driven), so it lives here with its prompt. The JSON-shape instructions and the legacy `model_name` tolerance disappear — typed output makes both obsolete.

```python
"""Prompt + typed output for prediction-model identification.

The contract stays intentionally narrow: the LLM returns a list of model
names. Anything richer is captured later by section extraction against
the container's children."""

from pydantic import BaseModel, ConfigDict, Field

from app.llm.prompts import MAX_PDF_CHARS, content_version

NAME = "model_identification"

SYSTEM_PROMPT = "You are an expert at identifying prediction models in scientific articles."


class IdentifiedModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(
        description=(
            "A clear, descriptive name for this prediction model as it "
            'appears in the article (e.g. "Multivariable Cox proportional hazards model").'
        )
    )


class ModelIdentificationOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    models: list[IdentifiedModel] = Field(
        description="All prediction models described in the article; empty when none are found."
    )


_USER_TEMPLATE = """Analyze the following scientific article and identify all {container_label} described in it. For each one, return a clear and descriptive name as it appears in the article.

Article text:
{article_text}
"""

VERSION = content_version(SYSTEM_PROMPT, _USER_TEMPLATE)


def render(*, container_label: str, article_text: str) -> str:
    return _USER_TEMPLATE.format(
        container_label=container_label,
        article_text=article_text[:MAX_PDF_CHARS],
    )
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
cd backend && uv run pytest tests/unit/llm/test_prompts.py -q
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/app/llm/prompts/ backend/tests/unit/llm/test_prompts.py
git commit -m "feat(llm): versioned prompt templates (section, QA, model identification)"
```

---

### Task 4: `app/llm/validators.py` — semantic reask checks

**Files:**
- Create: `backend/app/llm/validators.py`
- Test: `backend/tests/unit/llm/test_validators.py`

- [ ] **Step 1: Write the failing tests**

`backend/tests/unit/llm/test_validators.py`:

```python
"""Semantic validators raise ModelRetry so the model corrects itself."""

from types import SimpleNamespace

import pytest
from pydantic_ai import ModelRetry

from app.llm.schema import build_output_models
from app.llm.validators import evidence_is_plausible


def _instance(evidence):
    field = SimpleNamespace(
        name="population", field_type="text", llm_description="d",
        description=None, allowed_values=None, is_required=False,
    )
    [model] = build_output_models(SimpleNamespace(name="s", description="", fields=[field]))
    return model.model_validate(
        {"population": {"value": "x", "confidence": 0.5, "reasoning": None, "evidence": evidence}}
    )


def test_passes_with_no_evidence():
    output = _instance(None)
    assert evidence_is_plausible(output) is output


def test_passes_with_plausible_evidence():
    output = _instance({"text": "We enrolled adults.", "page_number": 2})
    assert evidence_is_plausible(output) is output


def test_rejects_blank_evidence_text():
    with pytest.raises(ModelRetry, match="population"):
        evidence_is_plausible(_instance({"text": "   ", "page_number": 2}))


def test_rejects_non_positive_page_number():
    with pytest.raises(ModelRetry, match="page_number"):
        evidence_is_plausible(_instance({"text": "quote", "page_number": 0}))
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && uv run pytest tests/unit/llm/test_validators.py -q
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.llm.validators'`.

- [ ] **Step 3: Implement `backend/app/llm/validators.py`**

```python
"""Semantic output validators.

Raising ModelRetry feeds the message back to the model for another
attempt — the structured replacement for the legacy silent-empty-dict
fallback. Pydantic itself already enforces types, enums, and the 0-1
confidence range; these validators cover what a type system cannot."""

from typing import Any

from pydantic_ai import ModelRetry


def evidence_is_plausible(output: Any) -> Any:
    """Reject impossible evidence so it never reaches the database."""
    for field_name, field_info in type(output).model_fields.items():
        label = field_info.alias or field_name
        field_result = getattr(output, field_name)
        evidence = getattr(field_result, "evidence", None)
        if evidence is None:
            continue
        if not evidence.text.strip():
            raise ModelRetry(
                f"Field '{label}': evidence.text must be a non-empty quote from the "
                "article; return null evidence when there is no quote."
            )
        if evidence.page_number is not None and evidence.page_number < 1:
            raise ModelRetry(
                f"Field '{label}': evidence.page_number must be a 1-based page number or null."
            )
    return output
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && uv run pytest tests/unit/llm/test_validators.py -q
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/llm/validators.py backend/tests/unit/llm/test_validators.py
git commit -m "feat(llm): evidence plausibility validator with ModelRetry reask"
```

---

### Task 5: `app/llm/provider.py` — BYOK → model instances

**Files:**
- Create: `backend/app/llm/provider.py`
- Test: `backend/tests/unit/llm/test_provider.py`

- [ ] **Step 1: Write the failing tests**

`backend/tests/unit/llm/test_provider.py`:

```python
"""BYOK key resolution → pydantic-ai model instances."""

import pytest

from app.core.config import settings
from app.llm.provider import MissingLLMKeyError, build_model


def test_byok_key_builds_openai_model():
    model = build_model("gpt-4o-mini", api_key="sk-user-key")
    assert model.model_name == "gpt-4o-mini"


def test_falls_back_to_global_key(monkeypatch):
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "sk-global")
    model = build_model("gpt-4o-mini", api_key=None)
    assert model.model_name == "gpt-4o-mini"


def test_raises_clear_error_when_no_key_anywhere(monkeypatch):
    monkeypatch.setattr(settings, "OPENAI_API_KEY", None)
    with pytest.raises(MissingLLMKeyError, match="OPENAI_API_KEY"):
        build_model("gpt-4o-mini", api_key=None)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && uv run pytest tests/unit/llm/test_provider.py -q
```

Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Implement `backend/app/llm/provider.py`**

```python
"""BYOK key resolution → pydantic-ai model instances.

The single place that knows which providers exist. Adding Anthropic
later is one new branch here — services stay provider-agnostic."""

from pydantic_ai.models import Model
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider

from app.core.config import settings


class MissingLLMKeyError(ValueError):
    """No usable API key: neither BYOK nor the global fallback is set."""


def build_model(model_name: str, *, api_key: str | None = None) -> Model:
    key = api_key or settings.OPENAI_API_KEY
    if not key:
        raise MissingLLMKeyError(
            "No OpenAI API key available: pass a BYOK key or set OPENAI_API_KEY."
        )
    return OpenAIChatModel(model_name, provider=OpenAIProvider(api_key=key))
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && uv run pytest tests/unit/llm/test_provider.py -q
```

Expected: all PASS. (The legacy `OpenAIService` silently sent `Bearer None` when no key existed and failed at HTTP time; the explicit error is intentional.)

- [ ] **Step 5: Commit**

```bash
git add backend/app/llm/provider.py backend/tests/unit/llm/test_provider.py
git commit -m "feat(llm): provider resolution with BYOK fallback and explicit missing-key error"
```

---

### Task 6: `app/llm/extractor.py` — the typed call

**Files:**
- Create: `backend/app/llm/extractor.py`
- Test: `backend/tests/unit/llm/test_extractor.py`

- [ ] **Step 1: Write the failing tests**

`backend/tests/unit/llm/test_extractor.py`:

```python
"""The typed LLM call, exercised through FunctionModel — no network."""

import json

import pytest
from pydantic import BaseModel, ConfigDict, Field
from pydantic_ai import ModelResponse, ModelRetry, TextPart, UnexpectedModelBehavior
from pydantic_ai.models.function import AgentInfo, FunctionModel

from app.llm.extractor import LlmUsage, extract_structured


class Demo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    answer: str = Field(description="The answer.")


def _canned(payload: dict) -> FunctionModel:
    def respond(messages, info: AgentInfo) -> ModelResponse:
        return ModelResponse(parts=[TextPart(json.dumps(payload))])

    return FunctionModel(respond)


async def test_returns_typed_output_and_usage():
    output, usage = await extract_structured(
        output_model=Demo,
        system_prompt="sys",
        user_prompt="user",
        model=_canned({"answer": "42"}),
        prompt_name="demo",
        prompt_version="abcdefabcdef",
    )
    assert output.answer == "42"
    assert isinstance(usage, LlmUsage)
    assert usage.total_tokens == usage.prompt_tokens + usage.completion_tokens


async def test_validator_rejection_exhausts_retries_and_raises():
    def always_reject(output: Demo) -> Demo:
        raise ModelRetry("not good enough")

    with pytest.raises(UnexpectedModelBehavior):
        await extract_structured(
            output_model=Demo,
            system_prompt="sys",
            user_prompt="user",
            model=_canned({"answer": "x"}),
            prompt_name="demo",
            prompt_version="abcdefabcdef",
            validators=[always_reject],
            output_retries=1,
        )


async def test_invalid_payload_exhausts_retries_and_raises():
    with pytest.raises(UnexpectedModelBehavior):
        await extract_structured(
            output_model=Demo,
            system_prompt="sys",
            user_prompt="user",
            model=_canned({"wrong_key": True}),
            prompt_name="demo",
            prompt_version="abcdefabcdef",
            output_retries=1,
        )


def test_llm_usage_addition():
    total = LlmUsage(prompt_tokens=10, completion_tokens=5) + LlmUsage(
        prompt_tokens=1, completion_tokens=2
    )
    assert (total.prompt_tokens, total.completion_tokens, total.total_tokens) == (11, 7, 18)
```

Note for the implementer: if `NativeOutput` + `FunctionModel` errors with an
output-mode/profile complaint on the pinned version, swap the test double to
`TestModel(custom_output_args={"answer": "42"})` from `pydantic_ai.models.test`
— do not change the production output mode.

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && uv run pytest tests/unit/llm/test_extractor.py -q
```

Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Implement `backend/app/llm/extractor.py`**

```python
"""The typed LLM call.

A fresh tools-free Agent is built per call: the output type changes per
template, and per-run output_type is incompatible with agent-level
validators in pydantic-ai v1. Agents are cheap objects; this also keeps
BYOK fully state-free."""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any, TypeVar

import logfire
from pydantic import BaseModel
from pydantic_ai import Agent, NativeOutput, UsageLimits
from pydantic_ai.models import Model

OutputT = TypeVar("OutputT", bound=BaseModel)

# Reask ceiling: the initial request plus output retries, with headroom.
# Under BYOK the key is the user's — a runaway reask loop is their bill.
DEFAULT_USAGE_LIMITS = UsageLimits(request_limit=5)


@dataclass
class LlmUsage:
    """Token accounting in the legacy OpenAIUsage vocabulary so
    extraction_runs.results keeps its tokens_* keys unchanged."""

    prompt_tokens: int = 0
    completion_tokens: int = 0

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens

    def __add__(self, other: "LlmUsage") -> "LlmUsage":
        return LlmUsage(
            prompt_tokens=self.prompt_tokens + other.prompt_tokens,
            completion_tokens=self.completion_tokens + other.completion_tokens,
        )


async def extract_structured(
    *,
    output_model: type[OutputT],
    system_prompt: str,
    user_prompt: str,
    model: Model,
    prompt_name: str,
    prompt_version: str,
    validators: Sequence[Callable[..., Any]] = (),
    output_retries: int = 2,
    usage_limits: UsageLimits | None = None,
) -> tuple[OutputT, LlmUsage]:
    agent: Agent[None, OutputT] = Agent(
        model,
        output_type=NativeOutput(output_model),
        instructions=system_prompt,
        output_retries=output_retries,
        model_settings={"temperature": 0.1},
    )
    for validator in validators:
        agent.output_validator(validator)
    with logfire.span(
        "llm_extraction",
        **{"prompt.name": prompt_name, "prompt.version": prompt_version},
    ):
        result = await agent.run(user_prompt, usage_limits=usage_limits or DEFAULT_USAGE_LIMITS)
    return result.output, LlmUsage(
        prompt_tokens=result.usage.input_tokens or 0,
        completion_tokens=result.usage.output_tokens or 0,
    )
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && uv run pytest tests/unit/llm/test_extractor.py -q
```

Expected: all PASS, no network access (the conftest guard would raise otherwise).

- [ ] **Step 5: Commit**

```bash
git add backend/app/llm/extractor.py backend/tests/unit/llm/test_extractor.py
git commit -m "feat(llm): typed extract_structured call with reask budget and usage mapping"
```

---

### Task 7: Observability wiring (Logfire, inert without token)

**Files:**
- Create: `backend/app/llm/observability.py`
- Modify: `backend/app/main.py` (lifespan, ~line 75)
- Modify: `backend/app/worker/celery_app.py` (bottom of module)
- Modify: `backend/app/core/logging.py:28-36`
- Test: `backend/tests/unit/llm/test_observability.py`

- [ ] **Step 1: Write the failing test**

`backend/tests/unit/llm/test_observability.py`:

```python
"""Observability bootstrap must be a safe no-op without LOGFIRE_TOKEN."""

from app.llm.observability import configure_observability


def test_configure_is_inert_without_token(monkeypatch):
    monkeypatch.delenv("LOGFIRE_TOKEN", raising=False)
    # Must not raise and must be safe to call more than once.
    configure_observability(service_name="test-api")
    configure_observability(service_name="test-api")
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && uv run pytest tests/unit/llm/test_observability.py -q
```

Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Implement `backend/app/llm/observability.py`**

```python
"""Logfire bootstrap — the single place that wires LLM observability.

Inert without LOGFIRE_TOKEN: ``send_to_logfire="if-token-present"`` makes
every span a local no-op in dev, CI, and tests. The SDK emits pure OTel
(GenAI semconv); switching backends later means pointing
OTEL_EXPORTER_OTLP_ENDPOINT elsewhere, with no code change."""

import logfire


def configure_observability(*, service_name: str) -> None:
    logfire.configure(
        service_name=service_name,
        send_to_logfire="if-token-present",
        console=False,
    )
    logfire.instrument_pydantic_ai()
    # Producer AND worker side: both processes call this so enqueue → task
    # execution stitches into one distributed trace.
    logfire.instrument_celery()
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && uv run pytest tests/unit/llm/test_observability.py -q
```

Expected: PASS.

- [ ] **Step 5: Wire the FastAPI process**

In `backend/app/main.py`, add to the imports:

```python
import logfire

from app.llm.observability import configure_observability
```

and in `lifespan`, replace the startup block's first lines:

```python
    # Startup
    configure_logging()
    check_pending_migrations()
```

with:

```python
    # Startup
    configure_observability(service_name="prumo-api")
    configure_logging()
    logfire.instrument_fastapi(app)
    check_pending_migrations()
```

- [ ] **Step 6: Wire the Celery worker process**

At the bottom of `backend/app/worker/celery_app.py` (after the existing `task_unknown` handler), add:

```python
from celery.signals import worker_init  # noqa: E402


@worker_init.connect
def _configure_worker_observability(**_kwargs: Any) -> None:
    """Logfire bootstrap for the worker process. Runs via signal (not at
    import time) so the API process importing this module for ``.delay()``
    doesn't get configured with the wrong service_name."""
    from app.llm.observability import configure_observability

    configure_observability(service_name="prumo-worker")
```

- [ ] **Step 7: Correlate structlog with traces**

In `backend/app/core/logging.py`, add `import os` to the imports and append a conditional processor to `shared_processors` (after the `UnicodeDecoder()` entry):

```python
    shared_processors: list[Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.UnicodeDecoder(),
    ]

    if os.getenv("LOGFIRE_TOKEN"):
        # Mirrors every structlog event into the active Logfire trace so
        # extraction logs and LLM spans correlate. Gated on the token so
        # local/CI logging behavior is byte-identical to before.
        import logfire

        shared_processors.append(logfire.StructlogProcessor())
```

- [ ] **Step 8: Run the full unit suite + commit**

```bash
cd backend && uv run pytest tests/unit -q 2>&1 | tail -5
```

Expected: all PASS.

```bash
git add backend/app/llm/observability.py backend/tests/unit/llm/test_observability.py backend/app/main.py backend/app/worker/celery_app.py backend/app/core/logging.py
git commit -m "feat(llm): logfire observability wiring for api, worker, and structlog"
```

- [ ] **Step 9: Phase 1 gate**

```bash
make quality-scan
```

Expected: green. Fix anything it flags before starting Phase 2.

> **Deploy note (no code):** when this ships, set `LOGFIRE_TOKEN` on both Railway services (web + worker) to activate export. Without it everything stays inert by design.

---

# Phase 2 — Model identification migrates (pilot)

### Task 8: Migrate `ModelExtractionService`

**Files:**
- Modify: `backend/app/services/model_extraction_service.py`
- Test: `backend/tests/unit/test_model_extraction_service.py`

- [ ] **Step 1: Update the service imports**

In `backend/app/services/model_extraction_service.py` replace:

```python
from app.services.llm.model_identification_prompt import (
    ModelIdentificationPrompt,
    parse_models_from_response,
)
from app.services.openai_service import OpenAIService
```

with:

```python
from app.llm.extractor import LlmUsage, extract_structured
from app.llm.prompts import model_identification
from app.llm.provider import build_model
```

- [ ] **Step 2: Update the constructor**

Replace (line ~90):

```python
        self.pdf_processor = PDFProcessor()
        self.openai_service = OpenAIService(trace_id=trace_id, api_key=openai_api_key)
```

with:

```python
        self.pdf_processor = PDFProcessor()
        self._llm_api_key = openai_api_key
```

- [ ] **Step 3: Replace `_identify_models`**

Replace the whole method (lines ~298-364) with:

```python
    async def _identify_models(
        self,
        pdf_text: str,
        template: Any,
        model: str,
    ) -> tuple[list[dict[str, Any]], LlmUsage]:
        """
        Use LLM to identify models in PDF text.

        Returns:
            Tuple of model list and token usage.
        """
        # Find the model container entity type by structural role —
        # replaces the legacy ``name in ("prediction_models", "model", ...)``
        # lookup that silently masked typos and template renames.
        entity_types = template.entity_types if hasattr(template, "entity_types") else []
        model_entity = next(
            (et for et in entity_types if et.role == ExtractionEntityRole.MODEL_CONTAINER.value),
            None,
        )

        if not model_entity:
            self.logger.warning(
                "no_model_container_entity_type",
                trace_id=self.trace_id,
                template_id=str(template.id),
                available_entity_types=[{"name": et.name, "role": et.role} for et in entity_types]
                if entity_types
                else [],
            )

        container_label = model_entity.label if model_entity else "prediction models"
        output, usage = await extract_structured(
            output_model=model_identification.ModelIdentificationOutput,
            system_prompt=model_identification.SYSTEM_PROMPT,
            user_prompt=model_identification.render(
                container_label=container_label,
                article_text=pdf_text,
            ),
            model=build_model(model, api_key=self._llm_api_key),
            prompt_name=model_identification.NAME,
            prompt_version=model_identification.VERSION,
        )
        models = [m.model_dump() for m in output.models]

        self.logger.info(
            "models_identified",
            trace_id=self.trace_id,
            models_count=len(models),
            tokens_total=usage.total_tokens,
        )

        return models, usage
```

- [ ] **Step 4: Update the caller in `extract()`**

In `extract()` (lines ~170-243), the variable `llm_response` becomes `llm_usage`:

```python
            # 5. Identify models using LLM (with token tracking)
            phase_start = perf_counter()
            models, llm_usage = await self._identify_models(pdf_text, template, model)
            phase_durations_ms["identify_models_llm"] = (perf_counter() - phase_start) * 1000
```

and every `llm_response.usage.prompt_tokens` / `.completion_tokens` / `.total_tokens` in the method body (in `complete_run` results, the `model_extraction_complete` log, and the returned `ModelExtractionResult`) becomes `llm_usage.prompt_tokens` / `llm_usage.completion_tokens` / `llm_usage.total_tokens`. The JSONB keys (`tokens_prompt`, `tokens_completion`, `tokens_total`) stay identical.

- [ ] **Step 5: Update the unit tests**

In `backend/tests/unit/test_model_extraction_service.py`:

1. In the service fixture, delete the `patch(...OpenAIService)` context-manager line and the `mock_openai_instance` setup.
2. Tests that stubbed `chat_completion_full` with a models JSON payload now stub `extract_structured` at the service module seam. Pattern — old:

```python
mock_openai_instance.chat_completion_full = AsyncMock(
    return_value=OpenAIResponse(
        content=json.dumps({"models": [{"name": "Cox model"}]}),
        usage=OpenAIUsage(prompt_tokens=100, completion_tokens=50, total_tokens=150),
        model="gpt-4o-mini",
    )
)
```

new (patch where it is *used*, and avoid a real key requirement by patching `build_model` too):

```python
from app.llm.extractor import LlmUsage
from app.llm.prompts.model_identification import IdentifiedModel, ModelIdentificationOutput

with (
    patch(
        "app.services.model_extraction_service.extract_structured",
        AsyncMock(
            return_value=(
                ModelIdentificationOutput(models=[IdentifiedModel(name="Cox model")]),
                LlmUsage(prompt_tokens=100, completion_tokens=50),
            )
        ),
    ),
    patch("app.services.model_extraction_service.build_model", MagicMock()),
):
    result = await service.extract(...)
```

3. Run `grep -n "chat_completion_full\|OpenAIResponse\|OpenAIUsage\|parse_models" tests/unit/test_model_extraction_service.py` and convert every remaining site with the same pattern. Tests asserting `parse_models_from_response` tolerance of the legacy `model_name` key (if any) are deleted — typed output made the parser unnecessary.

- [ ] **Step 6: Run the test file**

```bash
cd backend && uv run pytest tests/unit/test_model_extraction_service.py -q
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/model_extraction_service.py backend/tests/unit/test_model_extraction_service.py
git commit -m "refactor(extraction): model identification on typed pydantic-ai call layer"
```

---

### Task 9: Delete the old prompt module + Phase 2 gate

**Files:**
- Delete: `backend/app/services/llm/` (whole directory)

- [ ] **Step 1: Verify nothing references it anymore**

```bash
cd backend && grep -rn "services.llm\|ModelIdentificationPrompt\|parse_models_from_response\|MODEL_IDENTIFICATION_RESPONSE_SCHEMA" app/ tests/ --include="*.py"
```

Expected: no matches outside `app/services/llm/` itself. If a test file for the old prompt module exists in the matches, delete it too.

- [ ] **Step 2: Delete and verify**

```bash
git rm -r backend/app/services/llm/
cd backend && uv run pytest tests/unit -q 2>&1 | tail -3
```

Expected: all PASS.

- [ ] **Step 3: Phase 2 gate + commit**

```bash
make quality-scan
git commit -m "refactor(extraction): drop legacy model-identification prompt module"
```

Expected: quality-scan green.

---

# Phase 3 — Section extraction migrates

### Task 10: Migrate `SectionExtractionService` internals

**Files:**
- Modify: `backend/app/services/section_extraction_service.py`

- [ ] **Step 1: Update imports**

Replace:

```python
import json
from dataclasses import dataclass
```

with:

```python
from dataclasses import dataclass
```

and replace:

```python
from app.services.openai_service import OpenAIResponse, OpenAIService
```

```python
from app.utils.json_parser import parse_json_safe
```

with (one block, keeping the other imports as they are):

```python
from app.llm.extractor import LlmUsage, extract_structured
from app.llm.prompts import quality_assessment, section_extraction
from app.llm.provider import build_model
from app.llm.schema import build_output_models, dump_extraction
from app.llm.validators import evidence_is_plausible
```

- [ ] **Step 2: Update the constructor**

Replace (line ~107):

```python
        self.pdf_processor = PDFProcessor()
        self.openai_service = OpenAIService(trace_id=trace_id, api_key=openai_api_key)
```

with:

```python
        self.pdf_processor = PDFProcessor()
        self._llm_api_key = openai_api_key
```

- [ ] **Step 3: Delete `_build_extraction_schema` and replace `_extract_with_llm`**

Delete the whole `_build_extraction_schema` method (lines ~1043-1122) and replace the whole `_extract_with_llm` method (lines ~1124-1261) with:

```python
    async def _extract_with_llm(
        self,
        pdf_text: str,
        entity_type: Any,
        model: str,
        memory_context: list[dict[str, str]] | None = None,
        kind: str = "extraction",
        framework: str | None = None,
    ) -> tuple[dict[str, Any], LlmUsage]:
        """
        Run extraction using the typed LLM call layer.

        Args:
            pdf_text: PDF text.
            entity_type: Entity type to extract (fields drive the output model).
            model: OpenAI model name.
            memory_context: Summarized memory context (optional).
            kind: 'extraction' or 'quality_assessment' — selects the prompt
                pair. The response shape is identical either way, so
                downstream proposal writes are unchanged.
            framework: When kind=='quality_assessment', the assessment
                framework (PROBAST / QUADAS-2) the prompts ground in.

        Returns:
            Tuple of extracted data ({field_name: {value, confidence,
            reasoning, evidence}}) and token usage. Templates larger than
            the strict-mode property budget are split into multiple calls
            and merged transparently.
        """
        entity_name = entity_type.name if hasattr(entity_type, "name") else "data"
        entity_description = entity_type.description if hasattr(entity_type, "description") else ""

        if kind == "quality_assessment":
            prompt_module: Any = quality_assessment
            system_prompt = quality_assessment.system_prompt(framework)
            user_prompt = quality_assessment.render(
                entity_name=entity_name,
                entity_description=entity_description,
                article_text=pdf_text,
                framework=framework,
                memory_context=memory_context,
            )
        else:
            prompt_module = section_extraction
            system_prompt = section_extraction.SYSTEM_PROMPT
            user_prompt = section_extraction.render(
                entity_name=entity_name,
                entity_description=entity_description,
                article_text=pdf_text,
                memory_context=memory_context,
            )

        output_models = build_output_models(entity_type)
        if not output_models:
            self.logger.info(
                "extraction_skipped_no_fields",
                trace_id=self.trace_id,
                entity_type_name=entity_name,
            )
            return {}, LlmUsage()

        llm_model = build_model(model, api_key=self._llm_api_key)

        extracted_data: dict[str, Any] = {}
        usage = LlmUsage()
        for output_model in output_models:
            output, call_usage = await extract_structured(
                output_model=output_model,
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                model=llm_model,
                prompt_name=prompt_module.NAME,
                prompt_version=prompt_module.VERSION,
                validators=[evidence_is_plausible],
            )
            extracted_data.update(dump_extraction(output))
            usage = usage + call_usage

        return extracted_data, usage
```

- [ ] **Step 4: Update caller `extract_section`**

Replace (lines ~214-227):

```python
            # 5. Build extraction schema
            phase_start = perf_counter()
            extraction_schema = self._build_extraction_schema(entity_type)
            phase_durations_ms["build_schema"] = (perf_counter() - phase_start) * 1000

            # 6. Run LLM extraction (with token tracking)
            phase_start = perf_counter()
            extracted_data, llm_response = await self._extract_with_llm(
                pdf_text=pdf_text,
                entity_type=entity_type,
                schema=extraction_schema,
                model=model,
            )
            phase_durations_ms["extract_llm"] = (perf_counter() - phase_start) * 1000
```

with:

```python
            # 5. Run LLM extraction (with token tracking)
            phase_start = perf_counter()
            extracted_data, llm_usage = await self._extract_with_llm(
                pdf_text=pdf_text,
                entity_type=entity_type,
                model=model,
            )
            phase_durations_ms["extract_llm"] = (perf_counter() - phase_start) * 1000
```

Then in the rest of `extract_section`, replace every `llm_response.usage.prompt_tokens` → `llm_usage.prompt_tokens`, `llm_response.usage.completion_tokens` → `llm_usage.completion_tokens`, `llm_response.usage.total_tokens` → `llm_usage.total_tokens` (occurs in the `complete_run` results dict, the `section_extraction_complete` log call, and the returned `SectionExtractionResult`).

- [ ] **Step 5: Update caller `_extract_one_entity_type_for_run`**

Replace (lines ~508-529):

```python
        try:
            schema = self._build_extraction_schema(full_entity_type)
            extracted_data, llm_response = await self._extract_with_llm(
                pdf_text=pdf_text,
                entity_type=full_entity_type,
                schema=schema,
                model=model,
                kind=kind,
                framework=framework,
            )
```

with:

```python
        try:
            extracted_data, llm_usage = await self._extract_with_llm(
                pdf_text=pdf_text,
                entity_type=full_entity_type,
                model=model,
                kind=kind,
                framework=framework,
            )
```

and in the same method's return dict, `"tokens_total": llm_response.usage.total_tokens` → `"tokens_total": llm_usage.total_tokens`.

- [ ] **Step 6: Update caller `_extract_section_with_memory`**

Replace (lines ~854-869):

```python
            # Build schema
            phase_start = perf_counter()
            extraction_schema = self._build_extraction_schema(entity_type)
            section_phase_durations_ms["build_schema"] = (perf_counter() - phase_start) * 1000

            # Run extraction with memory context
            phase_start = perf_counter()
            extracted_data, llm_response = await self._extract_with_llm(
                pdf_text=pdf_text,
                entity_type=entity_type,
                schema=extraction_schema,
                model=model,
                memory_context=memory_history,
            )
            section_phase_durations_ms["extract_llm"] = (perf_counter() - phase_start) * 1000
```

with:

```python
            # Run extraction with memory context
            phase_start = perf_counter()
            extracted_data, llm_usage = await self._extract_with_llm(
                pdf_text=pdf_text,
                entity_type=entity_type,
                model=model,
                memory_context=memory_history,
            )
            section_phase_durations_ms["extract_llm"] = (perf_counter() - phase_start) * 1000
```

and replace the three `llm_response.usage.*` reads in this method's `complete_run` results and return dict with `llm_usage.*` (same key names in the results JSONB).

- [ ] **Step 7: Confirm no stragglers**

```bash
cd backend && grep -n "openai_service\|OpenAIService\|OpenAIResponse\|parse_json_safe\|_build_extraction_schema\|llm_response\|schema=" app/services/section_extraction_service.py
```

Expected: no matches (a `schema=` match inside unrelated code is acceptable only if it is not an `_extract_with_llm` argument — there should be none).

- [ ] **Step 8: Commit (tests fixed in the next task — expected red here)**

```bash
git add backend/app/services/section_extraction_service.py
git commit -m "refactor(extraction): section extraction on typed pydantic-ai call layer"
```

---

### Task 11: Update section-extraction unit tests

**Files:**
- Modify: `backend/tests/unit/test_section_extraction_service.py`

- [ ] **Step 1: Map the work**

```bash
cd backend && grep -n "OpenAIService\|chat_completion_full\|OpenAIResponse\|OpenAIUsage\|_build_extraction_schema\|parse_json" tests/unit/test_section_extraction_service.py
```

Expected: a list of (a) the service fixture's `patch(...OpenAIService)` line, (b) tests stubbing `chat_completion_full`, (c) tests of `_build_extraction_schema`, (d) possibly JSON-parse fallback tests.

- [ ] **Step 2: Update the service fixture**

Remove the `patch("app.services.section_extraction_service.OpenAIService") as mock_openai` line and the `mock_openai_instance` blocks from the fixture (and the corresponding yield tuple entries, if any).

- [ ] **Step 3: Convert orchestration tests to the `_extract_with_llm` seam**

Every test that previously did:

```python
service.openai_service.chat_completion_full = AsyncMock(
    return_value=OpenAIResponse(
        content=json.dumps(PAYLOAD),
        usage=OpenAIUsage(prompt_tokens=P, completion_tokens=C, total_tokens=T),
        model="gpt-4o-mini",
    )
)
```

now does (with `from app.llm.extractor import LlmUsage` added to the test imports):

```python
service._extract_with_llm = AsyncMock(
    return_value=(PAYLOAD, LlmUsage(prompt_tokens=P, completion_tokens=C))
)
```

where `PAYLOAD` is the dict the old JSON encoded (drop the `json.dumps`). Assertions on `tokens_total` keep working because `LlmUsage.total_tokens == P + C` — adjust any test where the old stub's `total_tokens` was not `P + C`.

- [ ] **Step 4: Replace `_build_extraction_schema` tests**

Delete tests that exercised `_build_extraction_schema` directly — their coverage moved to `tests/unit/llm/test_schema.py` in Task 2 (enum normalization, type mapping, descriptions). If any asserted behavior is missing there (e.g., a specific `allowed_values` shape), add the equivalent case to `tests/unit/llm/test_schema.py` instead.

- [ ] **Step 5: Add wiring tests for the new `_extract_with_llm`**

Append to `backend/tests/unit/test_section_extraction_service.py`:

```python
class TestExtractWithLlmWiring:
    """The service-level _extract_with_llm: prompt selection, chunk merge,
    usage accumulation — through the real schema builder, no network."""

    @staticmethod
    def _entity_type(n_fields=1):
        from types import SimpleNamespace

        fields = [
            SimpleNamespace(
                name=f"field_{i}", field_type="text", llm_description="d",
                description=None, allowed_values=None, is_required=False,
            )
            for i in range(n_fields)
        ]
        return SimpleNamespace(name="population", description="who", fields=fields)

    async def test_no_fields_skips_llm_entirely(self, service):
        with patch("app.services.section_extraction_service.extract_structured") as mock_x:
            data, usage = await service._extract_with_llm(
                pdf_text="text", entity_type=self._entity_type(0), model="gpt-4o-mini"
            )
        assert data == {}
        assert usage.total_tokens == 0
        mock_x.assert_not_called()

    async def test_chunked_template_merges_results_and_usage(self, service):
        from app.llm.extractor import LlmUsage
        from app.llm.schema import build_output_models

        entity_type = self._entity_type(30)  # > 14 fields → 2+ chunks
        chunk_models = build_output_models(entity_type)
        assert len(chunk_models) >= 2

        def _payload(model_cls):
            return model_cls.model_validate(
                {
                    info.alias: {
                        "value": "v", "confidence": 0.5,
                        "reasoning": None, "evidence": None,
                    }
                    for info in model_cls.model_fields.values()
                }
            )

        outputs = [( _payload(m), LlmUsage(prompt_tokens=10, completion_tokens=5))
                   for m in chunk_models]
        with (
            patch(
                "app.services.section_extraction_service.extract_structured",
                AsyncMock(side_effect=outputs),
            ),
            patch("app.services.section_extraction_service.build_model", MagicMock()),
        ):
            data, usage = await service._extract_with_llm(
                pdf_text="text", entity_type=entity_type, model="gpt-4o-mini"
            )
        assert len(data) == 30
        assert usage.prompt_tokens == 10 * len(chunk_models)

    async def test_quality_assessment_kind_selects_qa_prompt(self, service):
        from app.llm.extractor import LlmUsage
        from app.llm.prompts import quality_assessment
        from app.llm.schema import build_output_models

        entity_type = self._entity_type(1)
        [model_cls] = build_output_models(entity_type)
        output = model_cls.model_validate(
            {"field_0": {"value": "Low", "confidence": 0.5, "reasoning": None, "evidence": None}}
        )
        mock_x = AsyncMock(return_value=(output, LlmUsage(prompt_tokens=1, completion_tokens=1)))
        with (
            patch("app.services.section_extraction_service.extract_structured", mock_x),
            patch("app.services.section_extraction_service.build_model", MagicMock()),
        ):
            await service._extract_with_llm(
                pdf_text="text", entity_type=entity_type, model="gpt-4o-mini",
                kind="quality_assessment", framework="PROBAST",
            )
        kwargs = mock_x.call_args.kwargs
        assert kwargs["prompt_name"] == quality_assessment.NAME
        assert "PROBAST" in kwargs["system_prompt"]
        assert "PROBAST" in kwargs["user_prompt"]
```

(Adjust the existing `service` fixture import block if `AsyncMock`/`MagicMock`/`patch` are not already imported — they are, per the current file header.)

- [ ] **Step 6: Run the file until green**

```bash
cd backend && uv run pytest tests/unit/test_section_extraction_service.py -q
```

Expected: all PASS. Iterate on remaining conversion sites from Step 1's grep until clean.

- [ ] **Step 7: Commit**

```bash
git add backend/tests/unit/test_section_extraction_service.py
git commit -m "test(extraction): section extraction tests on the typed call seam"
```

---

### Task 12: Phase 3 gate

- [ ] **Step 1: Full backend suite + integration check**

```bash
cd backend && uv run pytest tests/unit -q 2>&1 | tail -3
cd backend && grep -rn "OpenAIService\|chat_completion" tests/integration/ --include="*.py"
```

Expected: unit suite PASS; integration grep returns no matches (the worker eager-mode tests patch the service classes themselves, which kept their signatures).

- [ ] **Step 2: quality-scan + commit anything it fixes**

```bash
make quality-scan
```

Expected: green (lint, typecheck, tests, fitness).

```bash
git status --short   # commit any formatter fallout with:
git commit -am "chore(extraction): phase 3 gate fixups" || true
```

---

# Phase 4 — Demolition + live smoke

### Task 13: Delete the legacy layer and dead dependencies

**Files:**
- Delete: `backend/app/services/openai_service.py`
- Delete: `backend/tests/unit/test_openai_service.py`
- Delete: `backend/app/utils/json_parser.py`
- Modify: `backend/app/utils/__init__.py`
- Modify: `backend/app/core/config.py:111-114`
- Modify: `backend/pyproject.toml`

- [ ] **Step 1: Verify the blast radius is still clean**

```bash
cd backend && grep -rn "openai_service\|OpenAIService" app/ tests/ --include="*.py" | grep -v "app/services/openai_service.py" | grep -v "tests/unit/test_openai_service.py"
cd backend && grep -rn "json_parser\|parse_json_safe\|parse_json_array_safe\|extract_models_from_response\|JSONParseError" app/ tests/ --include="*.py" | grep -v "app/utils/json_parser.py" | grep -v "app/utils/__init__.py"
cd backend && grep -rn "tenacity" app/ --include="*.py" | grep -v openai_service
```

Expected: every command prints nothing. If a match appears, migrate that consumer first — do not delete under it.

- [ ] **Step 2: Delete the files**

```bash
git rm backend/app/services/openai_service.py backend/tests/unit/test_openai_service.py backend/app/utils/json_parser.py
```

- [ ] **Step 3: Empty the utils re-exports**

Replace the whole content of `backend/app/utils/__init__.py` with:

```python
"""Utils module - Utility functions and helpers."""
```

- [ ] **Step 4: Remove dead dependencies**

```bash
cd backend && uv remove langchain langchain-openai instructor tenacity
```

Expected: `pyproject.toml` loses the three AI deps and `tenacity`; `uv.lock` shrinks accordingly. `openai` stays (it is the transport `pydantic-ai-slim[openai]` uses).

- [ ] **Step 5: Remove the LangSmith settings block**

In `backend/app/core/config.py`, delete lines 111-114 (verified unreferenced anywhere else):

```python
    # =================== LANGSMITH (OPCIONAL) ===================
    LANGCHAIN_TRACING_V2: bool = False
    LANGCHAIN_API_KEY: str | None = None
    LANGCHAIN_PROJECT: str = "review-hub"
```

- [ ] **Step 6: Full verification**

```bash
cd backend && uv run python -c "import app.main"
cd backend && uv run pytest tests/unit -q 2>&1 | tail -3
make quality-scan
```

Expected: import clean, unit suite PASS, quality-scan green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(extraction)!: delete legacy openai service, json parser, and dead llm deps"
```

---

### Task 14: Live smoke test + docs accuracy pass

**Files:**
- Create: `backend/tests/unit/llm/test_live_smoke.py`
- Modify: `docs/reference/extraction-hitl-architecture.md` (only if stale references exist)

- [ ] **Step 1: Create the opt-in smoke test**

`backend/tests/unit/llm/test_live_smoke.py`:

```python
"""Opt-in live round-trip against the real OpenAI API.

Run with: PRUMO_LLM_SMOKE=1 OPENAI_API_KEY=sk-... uv run pytest -m llm
Never runs in CI (skipped without the env var)."""

import os

import pytest
from pydantic import BaseModel, ConfigDict, Field

pytestmark = [
    pytest.mark.llm,
    pytest.mark.skipif(
        not os.getenv("PRUMO_LLM_SMOKE"),
        reason="live LLM smoke test; set PRUMO_LLM_SMOKE=1 and OPENAI_API_KEY to run",
    ),
]


class SmokeOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    capital: str = Field(description="The capital city.")
    confidence: float = Field(ge=0.0, le=1.0)


async def test_live_extraction_round_trip():
    import pydantic_ai.models as pai_models

    from app.llm.extractor import extract_structured
    from app.llm.provider import build_model

    previous = pai_models.ALLOW_MODEL_REQUESTS
    pai_models.ALLOW_MODEL_REQUESTS = True
    try:
        output, usage = await extract_structured(
            output_model=SmokeOutput,
            system_prompt="You answer geography questions as structured data.",
            user_prompt="What is the capital of France?",
            model=build_model("gpt-4o-mini"),
            prompt_name="live_smoke",
            prompt_version="live",
        )
    finally:
        pai_models.ALLOW_MODEL_REQUESTS = previous

    assert output.capital == "Paris"
    assert usage.total_tokens > 0
```

- [ ] **Step 2: Verify it is skipped by default and the suite stays green**

```bash
cd backend && uv run pytest tests/unit/llm/ -q 2>&1 | tail -3
```

Expected: PASS with 1 skipped (the smoke test).

- [ ] **Step 3: Docs accuracy pass**

```bash
grep -rn "openai_service\|OpenAIService\|json_parser\|chat_completion" docs/reference/ docs/how-to/ llms.txt CLAUDE.md 2>/dev/null
```

For each match describing the call layer, update the sentence to reference the new module — e.g. "LLM calls go through the typed call layer in `backend/app/llm/` (Pydantic AI; see `extractor.py`), with prompts versioned under `backend/app/llm/prompts/`." Do not rewrite unrelated content. If the grep returns nothing, skip this step.

- [ ] **Step 4: Final gate + commit**

```bash
make quality-scan
git add -A
git commit -m "test(llm): opt-in live smoke test + docs accuracy pass"
```

Expected: quality-scan green. The branch is now ready for the finishing-a-development-branch flow (PR to `dev`, squash-merge).

---

## Self-review notes (kept for the executor)

- **Spec §4 (architecture)** → Tasks 2-7. **§5 (data flow)** → Tasks 8, 10. **§6 (error handling)** → Tasks 4, 6 (`output_retries=2`, `UsageLimits`, chunker in Task 2; `rollback_and_fail` paths untouched by design). **§7 (testing)** → conftest guard (Task 1), TestModel/FunctionModel (Task 6), wiring tests (Task 11), live smoke (Task 14). **§8 (phases + invariants)** → phase gates in Tasks 7, 9, 12, 13/14. **§9 (risks)** → v1 pin (Task 1), chunker (Task 2), OTel portability (Task 7).
- The `tokens_*` JSONB keys are preserved by `LlmUsage`'s field names at every `complete_run` call site (Tasks 8, 10).
- Frontend, API schemas, repositories, and Alembic are intentionally untouched.
