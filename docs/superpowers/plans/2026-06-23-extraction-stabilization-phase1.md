---
status: draft
last_reviewed: 2026-06-23
owner: '@raphaelfh'
---

# Extraction Stabilization — Phase 1 (C1 + extractor reliability) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Centralize LLM model/provider config (one setting, Claude selectable via a global switch + BYOK), and fix four real extractor reliability bugs (timeout, retry classification, batch fail-closed, schema duplicate-name data-loss) — with no Alembic migration.

**Architecture:** Keep `pydantic-ai` as the single call layer. `build_model` becomes provider-aware (OpenAI + Anthropic); `extractor.extract_structured` selects `NativeOutput` (OpenAI) vs `ToolOutput` (Anthropic) and enforces a client-level timeout; a typed error taxonomy (`app/llm/errors.py`) drives Celery retry-with-backoff and fail-fast; the all-sections-failed batch path raises instead of reporting success; duplicate field names fail closed.

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy 2.0 async, Celery, `pydantic-ai-slim` 1.107 (`[openai,anthropic]`), pytest, `uv`.

## Global Constraints

- **English only** for code, comments, commits.
- **Four-layer architecture** (api → service → repository → model): endpoints never touch the DB; services never import endpoints/return HTTP; repositories call `flush()`, never `commit()`.
- **Typed everything**: type hints on all public functions; Pydantic for all API I/O.
- **`backend/app/llm/` is the single provider doorway** (`build_model`); services stay provider-agnostic.
- **pydantic-ai pinned `>=1.107.0,<2.0.0`**.
- **No Alembic migration in Phase 1** (verified: `user_api_keys.provider` CHECK already allows `anthropic`; nothing here changes the schema).
- **Claude is BYOK-only** in this effort — no global `ANTHROPIC_API_KEY`.
- **Live default unchanged**: `LLM_PROVIDER="openai"`, `LLM_DEFAULT_MODEL="gpt-4o-mini"` — behavior/cost identical until an operator flips config.
- **Tests**: prefer real-DB integration for service/DB behavior; pure unit tests for pure logic. LLM calls are mocked (`patch` `extract_structured`, or `FunctionModel`). Run `make test-backend`; lint `make lint-backend` (ruff, 100-char).
- **Commits**: conventional, on branch `feat/extraction-pipeline-stabilization`, one commit per task.
- **Run from `backend/`** for `uv`/`alembic`/pytest; frontend tooling is repo-root (not used in Phase 1).

---

### Task 1: Typed LLM error taxonomy + transient classifier

**Files:**
- Create: `backend/app/llm/errors.py`
- Test: `backend/tests/unit/llm/test_errors.py`

**Interfaces:**
- Produces: `class LLMError(Exception)`, `class TransientLLMError(LLMError)`, `class PermanentLLMError(LLMError)`, `def is_transient_llm_error(exc: BaseException) -> bool`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/llm/test_errors.py
import asyncio

import httpx
import pytest
from pydantic_ai.exceptions import ModelHTTPError, UsageLimitExceeded

from app.llm.errors import (
    PermanentLLMError,
    TransientLLMError,
    is_transient_llm_error,
)


def test_explicit_transient_is_transient():
    assert is_transient_llm_error(TransientLLMError("x")) is True


def test_explicit_permanent_is_not_transient():
    assert is_transient_llm_error(PermanentLLMError("x")) is False


def test_usage_limit_exceeded_is_permanent():
    # Reask budget exhausted => bad schema/template, retry will not help.
    assert is_transient_llm_error(UsageLimitExceeded("limit")) is False


def test_timeout_is_transient():
    assert is_transient_llm_error(asyncio.TimeoutError()) is True
    assert is_transient_llm_error(httpx.TimeoutException("t")) is True


@pytest.mark.parametrize("status,expected", [(429, True), (503, True), (500, True), (401, False), (400, False)])
def test_model_http_error_classified_by_status(status, expected):
    err = ModelHTTPError(status_code=status, model_name="m", body=None)
    assert is_transient_llm_error(err) is expected


def test_unknown_exception_defaults_permanent():
    # Fail fast on unknown types so a real bug does not burn the retry budget.
    assert is_transient_llm_error(ValueError("boom")) is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/llm/test_errors.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.llm.errors'`.

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/llm/errors.py
"""Transient vs permanent classification for LLM-call failures.

The Celery extraction tasks use ``is_transient_llm_error`` to decide whether
to retry with backoff (transient) or fail fast (permanent). Unknown exception
types default to permanent so a real bug does not consume the whole retry
budget on useless retries.
"""

from __future__ import annotations

import asyncio

import httpx
from pydantic_ai.exceptions import ModelHTTPError, UsageLimitExceeded

# 408 request timeout, 425 too early, 429 rate limit, 5xx upstream — retryable.
_TRANSIENT_HTTP_STATUS = frozenset({408, 425, 429, 500, 502, 503, 504})


class LLMError(Exception):
    """Base for LLM-call failures with a known retry disposition."""


class TransientLLMError(LLMError):
    """Retryable failure (timeout, rate limit, upstream 5xx)."""


class PermanentLLMError(LLMError):
    """Non-retryable failure (missing key, missing input, bad template)."""


def is_transient_llm_error(exc: BaseException) -> bool:
    """Return True when ``exc`` should be retried with backoff."""
    if isinstance(exc, TransientLLMError):
        return True
    if isinstance(exc, PermanentLLMError):
        return False
    if isinstance(exc, UsageLimitExceeded):
        return False
    if isinstance(exc, asyncio.TimeoutError | httpx.TimeoutException | httpx.ConnectError):
        return True
    if isinstance(exc, ModelHTTPError):
        return exc.status_code in _TRANSIENT_HTTP_STATUS
    return False
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/unit/llm/test_errors.py -q`
Expected: PASS (7 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/llm/errors.py backend/tests/unit/llm/test_errors.py
git commit -m "feat(llm): typed transient/permanent error taxonomy for retry control"
```

---

### Task 2: Central LLM config settings

**Files:**
- Modify: `backend/app/core/config.py:91-94` (the OPENAI block)
- Test: `backend/tests/unit/test_config_llm.py`

**Interfaces:**
- Produces: `settings.LLM_PROVIDER: str` (default `"openai"`), `settings.LLM_DEFAULT_MODEL: str` (default `"gpt-4o-mini"`), `settings.LLM_TIMEOUT_SECONDS: float` (default `120.0`). Removes the dead `settings.OPENAI_DEFAULT_MODEL`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/test_config_llm.py
from app.core.config import settings


def test_llm_defaults_preserve_current_behavior():
    assert settings.LLM_PROVIDER == "openai"
    assert settings.LLM_DEFAULT_MODEL == "gpt-4o-mini"
    assert settings.LLM_TIMEOUT_SECONDS == 120.0


def test_dead_openai_default_model_removed():
    # OPENAI_DEFAULT_MODEL was never read at runtime; collapsed into LLM_DEFAULT_MODEL.
    assert not hasattr(settings, "OPENAI_DEFAULT_MODEL")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_config_llm.py -q`
Expected: FAIL (`AttributeError: ... LLM_PROVIDER`, and the second test fails because the attribute still exists).

- [ ] **Step 3: Write minimal implementation**

Replace lines 91-94 of `backend/app/core/config.py`:

```python
    # =================== OPENAI ===================
    # Optional: global fallback when user does not have BYOK configured
    OPENAI_API_KEY: str | None = None

    # =================== LLM (provider-agnostic) ===================
    # Single authoritative model/provider for AI extraction. The former
    # OPENAI_DEFAULT_MODEL was defined but never read at runtime; it is
    # collapsed here. Claude is selectable by setting LLM_PROVIDER="anthropic"
    # plus an "anthropic" BYOK key (no global Anthropic key is configured).
    LLM_PROVIDER: str = "openai"
    LLM_DEFAULT_MODEL: str = "gpt-4o-mini"
    LLM_TIMEOUT_SECONDS: float = 120.0
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/unit/test_config_llm.py -q`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/config.py backend/tests/unit/test_config_llm.py
git commit -m "feat(config): collapse model config into LLM_PROVIDER/LLM_DEFAULT_MODEL/LLM_TIMEOUT_SECONDS"
```

---

### Task 3: Provider-aware `build_model` (OpenAI + Anthropic)

**Files:**
- Modify: `backend/pyproject.toml:37` (add `anthropic` extra)
- Modify: `backend/app/llm/provider.py:17-25`
- Modify call sites: `backend/app/services/section_extraction_service.py:1174`, `backend/app/services/model_extraction_service.py:330`
- Test: `backend/tests/unit/llm/test_provider.py`

**Interfaces:**
- Consumes: `settings.LLM_PROVIDER` (Task 2).
- Produces: `build_model(provider: str, model_name: str, *, api_key: str | None = None) -> Model`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/llm/test_provider.py  (add these)
import pytest
from pydantic_ai.models.openai import OpenAIChatModel

from app.llm.provider import MissingLLMKeyError, build_model


def test_openai_branch_builds_openai_model():
    model = build_model("openai", "gpt-4o-mini", api_key="sk-test")
    assert isinstance(model, OpenAIChatModel)


def test_anthropic_branch_builds_anthropic_model():
    model = build_model("anthropic", "claude-3-5-sonnet-latest", api_key="sk-ant-test")
    assert type(model).__name__ == "AnthropicModel"


def test_anthropic_without_key_raises_missing_key():
    with pytest.raises(MissingLLMKeyError):
        build_model("anthropic", "claude-3-5-sonnet-latest", api_key=None)


def test_unknown_provider_raises():
    with pytest.raises(ValueError, match="Unsupported LLM provider"):
        build_model("grok", "grok-2", api_key="x")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/llm/test_provider.py -q`
Expected: FAIL (`build_model()` takes the old signature; anthropic import unavailable).

- [ ] **Step 3a: Add the anthropic extra**

In `backend/pyproject.toml`, change line 37:

```toml
    "pydantic-ai-slim[openai,anthropic]>=1.107.0,<2.0.0",
```

Then sync: `cd backend && uv sync`

- [ ] **Step 3b: Rewrite `build_model`**

Replace `backend/app/llm/provider.py:17-25`:

```python
def build_model(provider: str, model_name: str, *, api_key: str | None = None) -> Model:
    if not model_name or not model_name.strip():
        raise ValueError("model_name must be a non-empty string.")
    provider = (provider or "openai").lower()
    if provider == "openai":
        key = api_key or settings.OPENAI_API_KEY
        if not key:
            raise MissingLLMKeyError(
                "No OpenAI API key available: pass a BYOK key or set OPENAI_API_KEY."
            )
        return OpenAIChatModel(model_name, provider=OpenAIProvider(api_key=key))
    if provider == "anthropic":
        if not api_key:
            raise MissingLLMKeyError(
                "No Anthropic API key available: add an 'anthropic' BYOK key "
                "(no global Anthropic key is configured)."
            )
        # Lazy import: only needed on the Anthropic path.
        from pydantic_ai.models.anthropic import AnthropicModel
        from pydantic_ai.providers.anthropic import AnthropicProvider

        return AnthropicModel(model_name, provider=AnthropicProvider(api_key=api_key))
    raise ValueError(f"Unsupported LLM provider: {provider!r}")
```

- [ ] **Step 3c: Update the two call sites**

`backend/app/services/section_extraction_service.py:1174` — change `build_model(model, api_key=...)` to:

```python
        llm_model = build_model(settings.LLM_PROVIDER, model, api_key=self.openai_api_key)
```

`backend/app/services/model_extraction_service.py:330` — change the `build_model(...)` call to:

```python
        llm_model = build_model(settings.LLM_PROVIDER, model, api_key=self.openai_api_key)
```

(Confirm each file imports `from app.core.config import settings`; add the import if missing. Match the existing local variable name used for the model result.)

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/unit/llm/test_provider.py -q && uv run pytest tests/unit/llm -q`
Expected: PASS (new provider tests + existing llm unit suite green).

- [ ] **Step 5: Commit**

```bash
git add backend/pyproject.toml backend/uv.lock backend/app/llm/provider.py \
  backend/app/services/section_extraction_service.py \
  backend/app/services/model_extraction_service.py \
  backend/tests/unit/llm/test_provider.py
git commit -m "feat(llm): provider-aware build_model with Anthropic branch (BYOK)"
```

---

### Task 4: Provider-aware output mode + client-level timeout in `extract_structured`

**Files:**
- Modify: `backend/app/llm/extractor.py:11-27,49-74`
- Test: `backend/tests/unit/llm/test_extractor.py`

**Interfaces:**
- Consumes: `settings.LLM_TIMEOUT_SECONDS` (Task 2).
- Produces: `_output_for(model: Model, output_model: type[OutputT]) -> NativeOutput | ToolOutput`; `extract_structured` now passes `model_settings={"temperature": 0.1, "timeout": settings.LLM_TIMEOUT_SECONDS}` and `output_type=_output_for(...)`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/llm/test_extractor.py  (add these)
from pydantic import BaseModel
from pydantic_ai import NativeOutput, ToolOutput

from app.llm.extractor import _output_for


class _Out(BaseModel):
    value: str


class _FakeAnthropic:  # only the class name matters to _output_for
    pass


_FakeAnthropic.__name__ = "AnthropicModel"


def test_output_for_uses_native_for_non_anthropic():
    # Any model whose class is not AnthropicModel (OpenAI, FunctionModel, etc.)
    # stays on NativeOutput; a bare object stands in for "not Anthropic".
    assert isinstance(_output_for(object(), _Out), NativeOutput)


def test_output_for_uses_tooloutput_for_anthropic():
    assert isinstance(_output_for(_FakeAnthropic(), _Out), ToolOutput)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/llm/test_extractor.py -q`
Expected: FAIL (`cannot import name '_output_for'`).

- [ ] **Step 3: Implement**

In `backend/app/llm/extractor.py`, update the import line 18 and add the helper + wire it.

Change line 18:

```python
from pydantic_ai import Agent, NativeOutput, ToolOutput, UsageLimits
```

Add a settings import near the top imports:

```python
from app.core.config import settings
```

Add the helper above `extract_structured`:

```python
def _output_for(model: Model, output_model: type[OutputT]) -> NativeOutput | ToolOutput:
    """OpenAI supports JSON-schema response_format (NativeOutput); Anthropic
    has no response_format, so structured output must use tool-calling
    (ToolOutput). Detection is by class name to avoid importing the optional
    anthropic package and to leave test models (FunctionModel) on NativeOutput."""
    if type(model).__name__ == "AnthropicModel":
        return ToolOutput(output_model)
    return NativeOutput(output_model)
```

In `extract_structured`, replace the `Agent(...)` construction (lines 61-67):

```python
    agent: Agent[None, OutputT] = Agent(
        model,
        output_type=_output_for(model, output_model),
        instructions=system_prompt,
        retries={"output": output_retries},
        model_settings={"temperature": 0.1, "timeout": settings.LLM_TIMEOUT_SECONDS},
    )
```

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/unit/llm/test_extractor.py -q`
Expected: PASS (new `_output_for` tests + existing extractor tests green — FunctionModel stays on NativeOutput).

- [ ] **Step 5: Commit**

```bash
git add backend/app/llm/extractor.py backend/tests/unit/llm/test_extractor.py
git commit -m "feat(llm): provider-aware output mode (ToolOutput for Anthropic) + client timeout"
```

---

### Task 5: Centralize model defaults + provider/key resolution

**Files:**
- Modify (model literal → `settings.LLM_DEFAULT_MODEL`): `backend/app/schemas/extraction.py:19,75,225`; `backend/app/api/v1/endpoints/section_extraction.py:146,180,218`; `backend/app/api/v1/endpoints/model_extraction.py:175`; `backend/app/services/model_extraction_service.py:105`; `backend/app/services/section_extraction_service.py:135,322,676`
- Modify (key resolution `"openai"` → `settings.LLM_PROVIDER`): `backend/app/worker/tasks/extraction_tasks.py:70,150`
- Test: `backend/tests/unit/test_model_default_centralized.py`

**Interfaces:**
- Consumes: `settings.LLM_DEFAULT_MODEL`, `settings.LLM_PROVIDER`.
- Produces: zero hardcoded `"gpt-4o-mini"` literals in `app/`; the Celery tasks resolve the key for `settings.LLM_PROVIDER`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/test_model_default_centralized.py
import subprocess
from pathlib import Path

APP = Path(__file__).resolve().parents[2] / "app"


def test_no_hardcoded_gpt_4o_mini_in_app():
    # The model default lives only in config (LLM_DEFAULT_MODEL).
    hits = subprocess.run(
        ["grep", "-rn", "gpt-4o-mini", str(APP)],
        capture_output=True, text=True,
    ).stdout.strip()
    offending = [
        ln for ln in hits.splitlines()
        if "config.py" not in ln  # the single allowed default
    ]
    assert offending == [], "hardcoded model literals remain:\n" + "\n".join(offending)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_model_default_centralized.py -q`
Expected: FAIL listing the ~12 offending lines.

- [ ] **Step 3: Replace each literal**

At each listed site, replace the literal with the config default. Two shapes occur:

Pydantic field default (`schemas/extraction.py`), e.g.:
```python
    model: str = Field(default_factory=lambda: settings.LLM_DEFAULT_MODEL)
```
(Ensure `from app.core.config import settings` is imported in the schema module.)

`payload.model or "gpt-4o-mini"` (endpoints) and `model: str = "gpt-4o-mini"` (service signatures), e.g.:
```python
    model = payload.model or settings.LLM_DEFAULT_MODEL
```
```python
        model: str | None = None,
```
…and resolve `model = model or settings.LLM_DEFAULT_MODEL` at the top of the method body (services already import `settings` after Task 3). Use `None` defaults on signatures + resolve in-body so the config value is read at call time, not at import time.

In `backend/app/worker/tasks/extraction_tasks.py`, change both key resolutions (lines 70 and 150) from:
```python
                    api_key = await api_key_service.get_key_for_provider("openai")
```
to:
```python
                    api_key = await api_key_service.get_key_for_provider(settings.LLM_PROVIDER)
```
(Add `from app.core.config import settings` to that module's imports.)

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/unit/test_model_default_centralized.py -q && uv run pytest tests/unit/llm tests/unit -q`
Expected: PASS (no offending literals; existing suites green).

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/extraction.py backend/app/api/v1/endpoints/section_extraction.py \
  backend/app/api/v1/endpoints/model_extraction.py backend/app/services/model_extraction_service.py \
  backend/app/services/section_extraction_service.py backend/app/worker/tasks/extraction_tasks.py \
  backend/tests/unit/test_model_default_centralized.py
git commit -m "refactor(llm): centralize model default to LLM_DEFAULT_MODEL; resolve key for LLM_PROVIDER"
```

---

### Task 6: Celery retry with backoff + fail-fast on permanent errors

**Files:**
- Modify: `backend/app/worker/tasks/extraction_tasks.py:21-26,100-103,106-111,196-199`
- Test: `backend/tests/unit/worker/test_extraction_tasks_retry.py`

**Interfaces:**
- Consumes: `is_transient_llm_error` (Task 1).
- Produces: `def _retry_countdown(retries: int) -> float` (module-level helper).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/worker/test_extraction_tasks_retry.py
from app.worker.tasks.extraction_tasks import _retry_countdown


def test_retry_countdown_is_exponential_and_capped():
    assert _retry_countdown(0) >= 60
    assert _retry_countdown(0) < _retry_countdown(1) < _retry_countdown(2)
    assert _retry_countdown(10) <= 600  # capped
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/worker/test_extraction_tasks_retry.py -q`
Expected: FAIL (`cannot import name '_retry_countdown'`).

- [ ] **Step 3: Implement**

In `backend/app/worker/tasks/extraction_tasks.py`, add imports + helper after the existing imports:

```python
import random

from app.llm.errors import is_transient_llm_error

_RETRY_BASE_SECONDS = 60
_RETRY_MAX_SECONDS = 600


def _retry_countdown(retries: int) -> float:
    """Exponential backoff with jitter, capped at 10 minutes."""
    base = min(_RETRY_BASE_SECONDS * (2**retries), _RETRY_MAX_SECONDS)
    return base + random.uniform(0, base * 0.1)
```

Replace the trailing `try/except` of **both** `extract_section_task` (lines 100-103) and `extract_models_task` (lines 196-199) with:

```python
    try:
        return run_task(run)
    except Exception as exc:
        if not is_transient_llm_error(exc):
            raise  # permanent: fail fast, no retry
        raise self.retry(exc=exc, countdown=_retry_countdown(self.request.retries))
```

(Leave `max_retries=3` on the decorators; `default_retry_delay` is now superseded by the explicit `countdown`.)

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/unit/worker/test_extraction_tasks_retry.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/worker/tasks/extraction_tasks.py backend/tests/unit/worker/test_extraction_tasks_retry.py
git commit -m "fix(worker): exponential retry backoff + fail-fast on permanent LLM errors"
```

---

### Task 7: Batch extraction fails closed when every section fails

**Files:**
- Modify: `backend/app/services/section_extraction_service.py` — add `BatchAllSectionsFailed`; add the guard before `complete_run` in `extract_for_run` (before line 433) and in `extract_all_sections` (before line 821)
- Test: `backend/tests/unit/services/test_batch_failclosed.py`

**Interfaces:**
- Produces: `class BatchAllSectionsFailed(Exception)` (module-level in `section_extraction_service.py`).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/services/test_batch_failclosed.py
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.services.section_extraction_service import (
    BatchAllSectionsFailed,
    SectionExtractionService,
)


@pytest.mark.asyncio
async def test_extract_for_run_raises_when_all_sections_fail():
    svc = SectionExtractionService.__new__(SectionExtractionService)
    svc.logger = SimpleNamespace(error=lambda *a, **k: None, info=lambda *a, **k: None)
    svc.trace_id = "t"
    run = SimpleNamespace(
        id="r", template_id="tpl", article_id="a", kind="extraction",
        stage="extract",
    )
    svc.db = SimpleNamespace(get=AsyncMock(return_value=run))
    svc._runs = SimpleNamespace(
        start_run=AsyncMock(), complete_run=AsyncMock(),
        rollback_and_fail=AsyncMock(),
    )
    svc.pdf_processor = SimpleNamespace(extract_text=AsyncMock(return_value="text"))
    svc._get_pdf = AsyncMock(return_value=b"%PDF")
    et = SimpleNamespace(id="e1", name="Sec")
    svc._top_level_entity_types_for_template = AsyncMock(return_value=[et])
    # Every entity-type extraction raises -> successful == 0.
    svc._extract_one_entity_type_for_run = AsyncMock(side_effect=RuntimeError("llm down"))

    with patch.object(SectionExtractionService, "ExtractionRun", create=True):
        with pytest.raises(BatchAllSectionsFailed):
            await svc.extract_for_run(run_id="r")

    svc._runs.complete_run.assert_not_called()
    svc._runs.rollback_and_fail.assert_awaited()
```

> Note for the implementer: adapt the constructor stubbing to the real
> `extract_for_run` signature and the `ExtractionRun` import it uses
> (`svc.db.get(ExtractionRun, run_id)`); the assertion that matters is
> **`BatchAllSectionsFailed` raised + `complete_run` not called + `rollback_and_fail` awaited**.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/services/test_batch_failclosed.py -q`
Expected: FAIL (`cannot import name 'BatchAllSectionsFailed'`).

- [ ] **Step 3: Implement**

Add at module level in `backend/app/services/section_extraction_service.py` (near the other module-level defs):

```python
class BatchAllSectionsFailed(Exception):
    """Every section in a batch extraction failed — the run is failed, not
    reported as a success. Permanent by default (see app/llm/errors.py:
    unknown types are non-retryable)."""
```

In `extract_for_run`, immediately before `duration_ms = (perf_counter() - start_time) * 1000` (line 431):

```python
            if top_level and successful == 0:
                raise BatchAllSectionsFailed(
                    f"All {failed} section(s) failed for run {run.id}."
                )
```

In `extract_all_sections`, immediately before `duration = (perf_counter() - start_time) * 1000` (line 817):

```python
            if total_sections and successful == 0:
                raise BatchAllSectionsFailed(
                    f"All {failed} section(s) failed for run {run.id}."
                )
```

(Both are inside the method's `try`, so the existing `except` runs `rollback_and_fail` → run `FAILED` and re-raises. Partial failures keep completing and already surface `failed_sections` + per-section `success=False` rows.)

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/unit/services/test_batch_failclosed.py -q && uv run pytest tests/unit/services -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/section_extraction_service.py backend/tests/unit/services/test_batch_failclosed.py
git commit -m "fix(extraction): fail closed when every section in a batch fails"
```

---

### Task 8: Schema build fails closed on duplicate field names

**Files:**
- Modify: `backend/app/llm/schema.py:1-9,108-119`
- Test: `backend/tests/unit/llm/test_schema.py`

**Interfaces:**
- Produces: `class SchemaBuildError(ValueError)`; `build_output_models` raises it on a duplicate `(entity_type, field name)` instead of silently dropping the earlier field.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/llm/test_schema.py  (add)
from types import SimpleNamespace

import pytest

from app.llm.schema import SchemaBuildError, build_output_models


def _field(name):
    return SimpleNamespace(
        name=name, field_type="text", allowed_values=None,
        llm_description="d", description="d", is_required=False,
    )


def test_duplicate_field_names_fail_closed():
    et = SimpleNamespace(id="et1", fields=[_field("Notes"), _field("Notes")])
    with pytest.raises(SchemaBuildError, match="Notes"):
        build_output_models(et)


def test_unique_field_names_still_build():
    et = SimpleNamespace(id="et1", fields=[_field("A"), _field("B")])
    models = build_output_models(et)
    assert len(models) == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/llm/test_schema.py -q`
Expected: FAIL (`cannot import name 'SchemaBuildError'`; the dup case currently last-wins silently).

- [ ] **Step 3: Implement**

Add the exception after the imports in `backend/app/llm/schema.py`:

```python
class SchemaBuildError(ValueError):
    """A template cannot be turned into an output schema (e.g. duplicate
    field names within one entity type — which would silently drop data)."""
```

Replace lines 114-119 (the silent dedup):

```python
    fields = list(getattr(entity_type, "fields", None) or [])
    seen: set[str] = set()
    for field in fields:
        name = str(field.name)
        if name in seen:
            raise SchemaBuildError(
                f"Duplicate field name {name!r} in entity type "
                f"{getattr(entity_type, 'id', '?')}: extraction_fields has no "
                "(entity_type, name) unique constraint; fix the template."
            )
        seen.add(name)
```

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/unit/llm/test_schema.py -q`
Expected: PASS (dup raises; unique still builds; existing schema tests green).

- [ ] **Step 5: Commit**

```bash
git add backend/app/llm/schema.py backend/tests/unit/llm/test_schema.py
git commit -m "fix(llm): fail closed on duplicate template field names (no silent data loss)"
```

---

### Task 9: Design-stability assertions (#6 / #8 / #9)

**Files:**
- Test: `backend/tests/unit/llm/test_design_stability.py`
- Test: `backend/tests/unit/services/test_extract_section_stays_in_extract.py`

**Interfaces:**
- Consumes: the existing prompt `render(...)` functions and the run-stage behavior — no production change; these lock current correct behavior.

- [ ] **Step 1: Write the failing test (#6 — `.format()` is injection-safe)**

```python
# backend/tests/unit/llm/test_design_stability.py
"""Design-stability assertions: these lock deliberate design choices.
A refactor that breaks one of these is changing behavior, not fixing a bug."""

from app.llm.prompts import section_extraction


def test_format_renders_brace_laden_entity_name_literally():
    # WHY: prompts use str.format(**kwargs); user values are arguments, never
    # the template, so braces/format-specs in entity_name render literally.
    # A refactor to f-strings over user values would reintroduce injection risk.
    out = section_extraction.render(
        entity_name="Dataset {article_text} {0:.2f}",
        entity_description="desc",
        article_text="SECRET",
        memory_context=None,
    )
    assert "Dataset {article_text} {0:.2f}" in out
    assert "SECRET" in out  # the real article_text slot still substituted
    assert out.count("SECRET") == 1  # entity_name's {article_text} did NOT re-substitute
```

> Implementer: confirm `section_extraction.render`'s exact parameter names
> (read `backend/app/llm/prompts/section_extraction.py`) and adjust kwargs.

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `cd backend && uv run pytest tests/unit/llm/test_design_stability.py -q`
Expected: PASS immediately (this asserts current correct behavior). If it ERRORs on a signature mismatch, fix the kwargs to match `render`.

- [ ] **Step 3: Write the #9 assertion (run stays in EXTRACT after AI extraction)**

```python
# backend/tests/unit/services/test_extract_section_stays_in_extract.py
"""#9: after AI extraction the run MUST stay in EXTRACT so proposals hydrate
in the extract-stage form. Auto-advancing to CONSENSUS here would leave the
form empty (the documented #bug). This test guards that design choice."""

import inspect

from app.services import section_extraction_service


def test_extract_path_does_not_advance_stage():
    # The extract methods must not call advance_stage/open_consensus.
    src = inspect.getsource(section_extraction_service)
    # The single-section + batch extract paths leave the run in EXTRACT;
    # the only stage transitions are start_run/complete_run/rollback_and_fail.
    assert "advance_stage" not in src
    assert "open_consensus" not in src
```

> Implementer: if the module legitimately references those names, tighten the
> assertion to the specific extract methods via `inspect.getsource(extract_section)`.
> #8 (key validated at endpoint entry) is already covered by the existing
> endpoint tests + Task 3's `MissingLLMKeyError`; add an explicit assertion there
> only if coverage shows the early-validation line uncovered.

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/unit/llm/test_design_stability.py tests/unit/services/test_extract_section_stays_in_extract.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/tests/unit/llm/test_design_stability.py \
  backend/tests/unit/services/test_extract_section_stays_in_extract.py
git commit -m "test(extraction): design-stability assertions for prompt safety + extract-stage hydration"
```

---

## Phase 1 exit gate (run before opening the PR)

- [ ] `cd backend && uv run ruff check . && uv run ruff format --check .`
- [ ] `make test-backend` — full backend suite green (paste output).
- [ ] Confirm no `gpt-4o-mini` literal remains outside `config.py` (Task 5 test).
- [ ] `code-review` skill on the diff; address findings.
- [ ] PR to `dev`, conventional title `feat(extraction): centralize LLM model/provider + extractor reliability (Phase 1)`, squash-merge.

## Self-review notes (spec coverage)

- C1 (centralize + Claude selectable + keep pydantic-ai): Tasks 2, 3, 4, 5.
- Bug #4 (timeout): Task 4 (client-level). Bug #5 (retry): Tasks 1, 6.
- Bug #3 (batch swallow): Task 7. Bug #7 (schema dedup): Task 8.
- Non-fixes #6/#8/#9 as design-stability assertions: Task 9.
- Out of Phase 1 (own plans): A1 block-markdown input (#1, #10) → Phase 2; B1 frontend bbox deletion → Phase 3. Per-request/per-project provider selection (beyond the global `LLM_PROVIDER` switch) is deferred unless Phase 2 needs it.
