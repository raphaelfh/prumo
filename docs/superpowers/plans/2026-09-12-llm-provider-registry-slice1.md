---
status: in_progress
last_reviewed: 2026-09-12
owner: '@raphaelfh'
---

# LLM Provider Registry (slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One typed provider registry that every backend layer derives its provider knowledge from, with a drift test, gemini/grok removed, and an optional global Anthropic key — no behaviour change otherwise.

**Architecture:** `backend/app/llm/registry.py` holds four frozen `ProviderSpec`s (openai, anthropic, openai_compatible, llama_cloud). `build_model`, the catalogue, the key schema validator, the provider metadata read, the global-key lookup, the DB CHECK constraint, and the API `byok_only` flag all read the registry. `byok_only` is computed per deployment (hosted provider whose global setting is empty), never stored. Slice 2 (connections + per-user engine) is a separate plan written after this slice merges.

**Tech Stack:** Python 3.11+, FastAPI, SQLAlchemy 2.0 async, Alembic, Pydantic v2, pydantic-ai, pytest.

**Spec:** `docs/superpowers/specs/2026-09-12-llm-provider-registry-and-connections-design.md` §1, §7.1.

## Global Constraints

- English only for code, comments, commits, docs.
- SQLAlchemy model change ⇒ Alembic migration, generated inside `backend/` (`uv run alembic revision -m ...`); never through the Supabase MCP.
- Backend dead code is gated by vulture (`backend/.vulture_baseline`, shrink-only). Delete, never park behind an ignore.
- `alembic check` is a CI gate: model and migration must agree.
- Frontend is untouched in this slice: the API read keeps the `byok_only` field with the same meaning.
- Every commit uses conventional-commit prefixes and ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Run backend commands from `backend/` with `uv run`. Unit tests need no database: `uv run pytest tests/unit/...`. Integration tests need the local Supabase stack (`make start` from the repo root).

---

## File map

| file | responsibility |
|---|---|
| Create `backend/app/llm/registry.py` | `ProviderSpec`, `REGISTRY`, `get_provider`, `llm_provider_ids`, `provider_ids`, `global_key_for`, `is_byok_only` |
| Modify `backend/app/core/config.py:124-138` | add `ANTHROPIC_API_KEY: str \| None = None` |
| Modify `backend/app/llm/provider.py` | `build_model` becomes a registry lookup plus one shared host/key check |
| Modify `backend/app/llm/catalog.py` | drop `CatalogEntry.byok_only`; keep everything else |
| Modify `backend/app/models/user_api_key.py:24,116-119` | `SUPPORTED_PROVIDERS` derives from the registry; CHECK literal narrows |
| Create `backend/alembic/versions/0071_registry_providers.py` | delete gemini/grok rows, narrow the CHECK |
| Modify `backend/app/services/api_key_service.py` | metadata, `_get_global_key`, validation dispatch read the registry; gemini/grok validators deleted |
| Modify `backend/app/services/llm_engine_service.py:497-501` | `byok_only=is_byok_only(entry.provider)` |
| Create `backend/tests/unit/llm/test_registry.py` | drift tests + mutation test |
| Modify `backend/tests/unit/llm/test_provider.py`, `test_catalog.py`, `tests/unit/test_api_key_service.py`, `tests/unit/test_user_api_key_schemas.py` | adapt to the registry |

---

### Task 1: The registry module and its drift tests

**Files:**
- Create: `backend/app/llm/registry.py`
- Modify: `backend/app/core/config.py:124-126`
- Test: `backend/tests/unit/llm/test_registry.py`

**Interfaces:**
- Produces:
  - `ProviderSpec` (frozen dataclass): `id: str`, `label: str`, `serves: Literal["llm", "parsing"]`, `needs_host: bool`, `key_optional: bool`, `global_key_setting: str | None`, `docs_url: str | None`, `scopes: frozenset[str]`, `description: str`
  - `REGISTRY: tuple[ProviderSpec, ...]`
  - `get_provider(provider_id: str) -> ProviderSpec | None`
  - `provider_ids() -> tuple[str, ...]` — every id, registry order
  - `llm_provider_ids() -> tuple[str, ...]` — ids with `serves == "llm"`
  - `global_key_for(provider_id: str) -> str | None` — the value of the settings field, or `None`
  - `is_byok_only(provider_id: str) -> bool` — hosted provider whose global setting is empty in this deployment
  - `settings.ANTHROPIC_API_KEY: str | None`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/unit/llm/test_registry.py
"""The provider registry (§1) — the only file that names a provider.

Drift tests: anything that lists providers elsewhere must equal this.
"""

from __future__ import annotations

import pytest

from app.core.config import Settings, settings
from app.llm import registry
from app.llm.registry import (
    REGISTRY,
    ProviderSpec,
    get_provider,
    global_key_for,
    is_byok_only,
    llm_provider_ids,
    provider_ids,
)


def test_registry_ids_are_exactly_the_four_providers() -> None:
    assert provider_ids() == ("openai", "anthropic", "openai_compatible", "llama_cloud")


def test_llm_provider_ids_exclude_parsing_providers() -> None:
    assert llm_provider_ids() == ("openai", "anthropic", "openai_compatible")


def test_ids_are_unique() -> None:
    ids = [spec.id for spec in REGISTRY]
    assert len(ids) == len(set(ids))


@pytest.mark.parametrize("spec", REGISTRY, ids=lambda s: s.id)
def test_every_provider_has_label_and_description(spec: ProviderSpec) -> None:
    assert spec.label.strip()
    assert spec.description.strip()


@pytest.mark.parametrize("spec", REGISTRY, ids=lambda s: s.id)
def test_hosted_providers_name_a_real_settings_field(spec: ProviderSpec) -> None:
    """Every hosted provider has a global key setting; only a host-bearing
    provider has none (a host is a per-connection fact)."""
    if spec.needs_host:
        assert spec.global_key_setting is None
        assert spec.docs_url is None
    else:
        assert spec.global_key_setting is not None
        assert spec.global_key_setting in Settings.model_fields
        assert spec.docs_url is not None and spec.docs_url.startswith("https://")


def test_only_host_bearing_providers_allow_keyless() -> None:
    for spec in REGISTRY:
        assert spec.key_optional == spec.needs_host


def test_get_provider_misses_unknown_id() -> None:
    assert get_provider("grok") is None
    assert get_provider("gemini") is None


def test_global_key_for_reads_the_named_settings_field(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-ant-global")
    assert global_key_for("anthropic") == "sk-ant-global"
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", None)
    assert global_key_for("anthropic") is None


def test_global_key_for_host_bearing_provider_is_none() -> None:
    assert global_key_for("openai_compatible") is None


def test_global_key_for_unknown_provider_is_none() -> None:
    assert global_key_for("grok") is None


def test_byok_only_is_computed_from_the_deployment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", None)
    assert is_byok_only("anthropic") is True
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-ant-global")
    assert is_byok_only("anthropic") is False


def test_host_bearing_provider_is_never_byok_only() -> None:
    assert is_byok_only("openai_compatible") is False


def test_removing_a_provider_breaks_the_drift_guard(monkeypatch: pytest.MonkeyPatch) -> None:
    """Mutation test: the drift check in the model must FAIL when the
    registry loses a provider — proves the guard is not vacuous."""
    from app.models.user_api_key import provider_check_literal

    trimmed = tuple(spec for spec in REGISTRY if spec.id != "anthropic")
    monkeypatch.setattr(registry, "REGISTRY", trimmed)
    assert provider_check_literal() != provider_check_literal(ids=provider_ids())
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/unit/llm/test_registry.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.llm.registry'`.

- [ ] **Step 3: Add the setting**

In `backend/app/core/config.py`, replace the `OPENAI` block header and field:

```python
    # =================== GLOBAL PROVIDER KEYS ===================
    # Optional operator keys. Each hosted provider in app.llm.registry names
    # ONE of these; when it is empty the provider is BYOK-only in this
    # deployment (registry.is_byok_only). Never a host-bearing provider —
    # a host is a per-connection fact.
    OPENAI_API_KEY: str | None = None
    ANTHROPIC_API_KEY: str | None = None
```

Leave `LLAMA_CLOUD_API_KEY` where it is under PARSING.

- [ ] **Step 4: Write the registry**

```python
# backend/app/llm/registry.py
"""The provider registry (§1) — the ONLY file that names a provider.

Every layer derives from this tuple: ``build_model``, the catalogue's
provider ids, the key schema validator, the provider metadata the API
returns, the global-key lookup, and the DB CHECK literal on
``user_api_keys.provider`` (asserted equal by a test — adding a provider
is one entry here plus one migration, and forgetting the migration fails
the test).

Rules encoded as data, not comments elsewhere:

* Every hosted provider names a global key setting; only a host-bearing
  provider has none (a host is a per-connection fact, there is no
  operator default host).
* ``byok_only`` is never stored: :func:`is_byok_only` computes it per
  deployment as "hosted provider whose global setting is empty".
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from app.core.config import settings

Scope = Literal["user", "project"]


@dataclass(frozen=True)
class ProviderSpec:
    id: str
    label: str
    description: str
    serves: Literal["llm", "parsing"]
    needs_host: bool
    key_optional: bool
    global_key_setting: str | None
    docs_url: str | None
    scopes: frozenset[Scope]


_BOTH: frozenset[Scope] = frozenset({"user", "project"})

REGISTRY: tuple[ProviderSpec, ...] = (
    ProviderSpec(
        id="openai",
        label="OpenAI",
        description="GPT models",
        serves="llm",
        needs_host=False,
        key_optional=False,
        global_key_setting="OPENAI_API_KEY",
        docs_url="https://platform.openai.com/api-keys",
        scopes=_BOTH,
    ),
    ProviderSpec(
        id="anthropic",
        label="Anthropic",
        description="Claude models",
        serves="llm",
        needs_host=False,
        key_optional=False,
        global_key_setting="ANTHROPIC_API_KEY",
        docs_url="https://console.anthropic.com/settings/keys",
        scopes=_BOTH,
    ),
    ProviderSpec(
        id="openai_compatible",
        label="Custom host",
        description="Any OpenAI-compatible server (Ollama, vLLM, LM Studio, OpenRouter)",
        serves="llm",
        needs_host=True,
        key_optional=True,
        global_key_setting=None,
        docs_url=None,
        scopes=_BOTH,
    ),
    ProviderSpec(
        id="llama_cloud",
        label="LlamaCloud",
        description="High-quality cloud PDF parsing (LlamaParse), opt-in per project",
        serves="parsing",
        needs_host=False,
        key_optional=False,
        global_key_setting="LLAMA_CLOUD_API_KEY",
        docs_url="https://cloud.llamaindex.ai",
        scopes=_BOTH,
    ),
)


def get_provider(provider_id: str) -> ProviderSpec | None:
    for spec in REGISTRY:
        if spec.id == provider_id:
            return spec
    return None


def provider_ids() -> tuple[str, ...]:
    return tuple(spec.id for spec in REGISTRY)


def llm_provider_ids() -> tuple[str, ...]:
    return tuple(spec.id for spec in REGISTRY if spec.serves == "llm")


def global_key_for(provider_id: str) -> str | None:
    """The operator's key for ``provider_id`` in this deployment, or None."""
    spec = get_provider(provider_id)
    if spec is None or spec.global_key_setting is None:
        return None
    value = getattr(settings, spec.global_key_setting, None)
    return value or None


def is_byok_only(provider_id: str) -> bool:
    """Hosted provider with no operator key in this deployment."""
    spec = get_provider(provider_id)
    if spec is None or spec.needs_host:
        return False
    return global_key_for(provider_id) is None
```

Note `get_provider` scans the tuple rather than a dict so the mutation
test's `monkeypatch.setattr(registry, "REGISTRY", ...)` takes effect.

- [ ] **Step 5: Run the tests**

Run: `cd backend && uv run pytest tests/unit/llm/test_registry.py -v`
Expected: every test passes except `test_removing_a_provider_breaks_the_drift_guard`, which fails with `ImportError: cannot import name 'provider_check_literal'` — Task 3 provides it.

- [ ] **Step 6: Commit**

```bash
git add backend/app/llm/registry.py backend/app/core/config.py backend/tests/unit/llm/test_registry.py
git commit -m "feat(llm): provider registry with per-deployment byok_only

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `build_model` reads the registry

**Files:**
- Modify: `backend/app/llm/provider.py`
- Modify: `backend/app/llm/catalog.py`
- Test: `backend/tests/unit/llm/test_provider.py`, `backend/tests/unit/llm/test_catalog.py`

**Interfaces:**
- Consumes: `get_provider`, `global_key_for` from Task 1.
- Produces: `build_model(provider: str, model_name: str, *, api_key: str | None = None, base_url: str | None = None) -> Model` — same signature as today; `MissingLLMKeyError` unchanged. `CatalogEntry` loses `byok_only`.

- [ ] **Step 1: Update the provider tests**

In `backend/tests/unit/llm/test_provider.py` change the two tests below; every other test stays verbatim.

```python
def test_anthropic_falls_back_to_global_key(monkeypatch):
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-ant-global")
    model = build_model("anthropic", "claude-3-5-sonnet-latest", api_key=None)
    assert type(model).__name__ == "AnthropicModel"


def test_anthropic_without_key_raises_missing_key(monkeypatch):
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", None)
    with pytest.raises(MissingLLMKeyError, match="ANTHROPIC_API_KEY"):
        build_model("anthropic", "claude-3-5-sonnet-latest", api_key=None)
```

Add:

```python
def test_parsing_provider_is_not_buildable():
    with pytest.raises(ValueError, match="Unsupported LLM provider"):
        build_model("llama_cloud", "anything", api_key="x")
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd backend && uv run pytest tests/unit/llm/test_provider.py -v`
Expected: `test_anthropic_falls_back_to_global_key` FAILS (`MissingLLMKeyError`); `test_parsing_provider_is_not_buildable` FAILS (`Unsupported LLM provider: 'llama_cloud'` is raised today too — it passes; keep it as a regression pin). Others pass.

- [ ] **Step 3: Rewrite `build_model`**

Replace the whole of `backend/app/llm/provider.py`:

```python
"""Credentials → pydantic-ai model instances, driven by the registry.

Three LLM providers today (``app.llm.registry``): ``openai`` and
``anthropic`` (a caller's key, else the operator's global key), and
``openai_compatible`` (needs a ``base_url``; key optional — keyless
hosts get the literal placeholder ``"no-key-required"``). Hosted
providers ignore ``base_url``. A parsing provider is not buildable."""

from pydantic_ai.models import Model
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider

from app.llm.registry import get_provider, global_key_for


class MissingLLMKeyError(ValueError):
    """No usable API key: neither the caller's nor the global fallback is set."""


def build_model(
    provider: str, model_name: str, *, api_key: str | None = None, base_url: str | None = None
) -> Model:
    if not model_name or not model_name.strip():
        raise ValueError("model_name must be a non-empty string.")
    provider = (provider or "openai").lower()
    spec = get_provider(provider)
    if spec is None or spec.serves != "llm":
        raise ValueError(f"Unsupported LLM provider: {provider!r}")

    if spec.needs_host:
        if not base_url:
            raise ValueError(f"{provider} requires a base_url.")
        return OpenAIChatModel(
            model_name,
            provider=OpenAIProvider(api_key=api_key or "no-key-required", base_url=base_url),
        )

    key = api_key or global_key_for(provider)
    if not key:
        raise MissingLLMKeyError(
            f"No {spec.label} API key available: pass a key or set {spec.global_key_setting}."
        )
    if provider == "openai":
        return OpenAIChatModel(model_name, provider=OpenAIProvider(api_key=key))
    if provider == "anthropic":
        # Lazy import: only needed on the Anthropic path.
        from pydantic_ai.models.anthropic import AnthropicModel
        from pydantic_ai.providers.anthropic import AnthropicProvider

        return AnthropicModel(model_name, provider=AnthropicProvider(api_key=key))
    raise ValueError(f"Unsupported LLM provider: {provider!r}")
```

- [ ] **Step 4: Drop `byok_only` from the catalogue**

In `backend/app/llm/catalog.py`: delete the `byok_only: bool = False` field from `CatalogEntry`, delete the three `byok_only=True,` lines on the anthropic entries, and replace the docstring paragraph starting "``byok_only`` is a fact on the entry" with:

```python
Whether a provider needs the user's own key is NOT a catalogue fact: it
depends on the deployment (``app.llm.registry.is_byok_only``) and is
computed on the engine read.
```

Add a drift test to `backend/tests/unit/llm/test_catalog.py`:

```python
from app.llm.registry import llm_provider_ids


def test_every_catalog_provider_is_a_registry_llm_provider() -> None:
    assert {entry.provider for entry in CATALOG} <= set(llm_provider_ids())
```

The existing `test_every_entry_is_buildable` keeps passing.

- [ ] **Step 5: Run both files**

Run: `cd backend && uv run pytest tests/unit/llm/test_provider.py tests/unit/llm/test_catalog.py -v`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/llm/provider.py backend/app/llm/catalog.py backend/tests/unit/llm/test_provider.py backend/tests/unit/llm/test_catalog.py
git commit -m "refactor(llm): build_model and catalogue derive from the registry

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Model, CHECK literal and migration 0071

**Files:**
- Modify: `backend/app/models/user_api_key.py:20-30,112-125`
- Create: `backend/alembic/versions/0071_registry_providers.py`
- Test: `backend/tests/unit/llm/test_registry.py` (mutation test from Task 1), `backend/tests/unit/test_user_api_key_schemas.py`

**Interfaces:**
- Consumes: `provider_ids` from Task 1.
- Produces: `SUPPORTED_PROVIDERS: tuple[str, ...]` (now `provider_ids()`), `provider_check_literal(ids: tuple[str, ...] | None = None) -> str` in `app.models.user_api_key`.

- [ ] **Step 1: Write the failing drift test**

Append to `backend/tests/unit/llm/test_registry.py`:

```python
def test_user_api_keys_check_literal_equals_the_registry() -> None:
    from app.models.user_api_key import UserAPIKey, provider_check_literal

    checks = [
        c for c in UserAPIKey.__table__.constraints
        if getattr(c, "name", None) == "user_api_keys_provider_check"
    ]
    assert len(checks) == 1
    assert str(checks[0].sqltext) == provider_check_literal()
    assert provider_check_literal() == (
        "provider IN ('openai', 'anthropic', 'openai_compatible', 'llama_cloud')"
    )
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && uv run pytest tests/unit/llm/test_registry.py -v -k "check_literal or mutation or removing"`
Expected: FAIL — `ImportError: cannot import name 'provider_check_literal'`.

- [ ] **Step 3: Derive the model's provider list**

In `backend/app/models/user_api_key.py` replace line 24 (`SUPPORTED_PROVIDERS = (...)`) with:

```python
from app.llm.registry import provider_ids

# Derived from the registry — the ONE list of providers. The CHECK below
# repeats it as a literal because Postgres needs one; the registry test
# asserts the two agree.
SUPPORTED_PROVIDERS: tuple[str, ...] = provider_ids()


def provider_check_literal(ids: tuple[str, ...] | None = None) -> str:
    """The exact SQL text of the ``provider`` CHECK for ``ids``."""
    quoted = ", ".join(f"'{pid}'" for pid in (ids if ids is not None else provider_ids()))
    return f"provider IN ({quoted})"
```

Replace the CHECK constraint literal at lines 116-119 with:

```python
        CheckConstraint(
            provider_check_literal(),
            name="user_api_keys_provider_check",
        ),
```

Check that `app.llm.registry` imports nothing from `app.models` (it imports only `app.core.config`), so there is no import cycle.

- [ ] **Step 4: Write the migration**

```python
# backend/alembic/versions/0071_registry_providers.py
"""Narrow ``user_api_keys.provider`` to the registry's four providers.

gemini and grok were storable as keys and buildable by nothing — no code
path ever turned them into a model. The registry (``app.llm.registry``)
is now the one list of providers, and the CHECK literal must equal it
(pinned by ``tests/unit/llm/test_registry.py``). No active users exist;
their rows are deleted, not migrated.

Revision ID: 0071_registry_providers
Revises: 0070_annotation_updated_at
"""

from alembic import op

revision = "0071_registry_providers"
down_revision = "0070_annotation_updated_at"
branch_labels = None
depends_on = None

_NEW = "provider IN ('openai', 'anthropic', 'openai_compatible', 'llama_cloud')"
_OLD = "provider IN ('openai', 'anthropic', 'gemini', 'grok', 'llama_cloud')"


def upgrade() -> None:
    op.execute("DELETE FROM public.user_api_keys WHERE provider IN ('gemini', 'grok')")
    op.execute(
        "ALTER TABLE public.user_api_keys DROP CONSTRAINT IF EXISTS user_api_keys_provider_check"
    )
    op.execute(
        f"ALTER TABLE public.user_api_keys ADD CONSTRAINT user_api_keys_provider_check CHECK ({_NEW})"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE public.user_api_keys DROP CONSTRAINT IF EXISTS user_api_keys_provider_check"
    )
    op.execute(
        f"ALTER TABLE public.user_api_keys ADD CONSTRAINT user_api_keys_provider_check CHECK ({_OLD})"
    )
```

`openai_compatible` enters the CHECK now so slice 2's connection table can reuse the literal; no code writes such a key row in this slice.

- [ ] **Step 5: Fix the schema tests**

In `backend/tests/unit/test_user_api_key_schemas.py`: at line 39 change `"provider": "gemini"` to `"provider": "anthropic"`; at lines 49 and 163 change `"grok"` to `"openai"`. Add:

```python
def test_gemini_and_grok_are_rejected_at_the_schema() -> None:
    for provider in ("gemini", "grok"):
        with pytest.raises(ValidationError, match="not supported"):
            CreateAPIKeyRequest.model_validate({"provider": provider, "apiKey": "0123456789"})
```

(`ValidationError` from `pydantic`; check the file's existing imports and add it if missing.)

- [ ] **Step 6: Run the tests and the migration check**

Run: `cd backend && uv run pytest tests/unit/llm/test_registry.py tests/unit/test_user_api_key_schemas.py -v`
Expected: all PASS, including the mutation test.

Run (local stack up): `cd backend && uv run alembic upgrade head && uv run alembic check`
Expected: `No new upgrade operations detected.`

- [ ] **Step 7: Commit**

```bash
git add backend/app/models/user_api_key.py backend/alembic/versions/0071_registry_providers.py backend/tests/unit/llm/test_registry.py backend/tests/unit/test_user_api_key_schemas.py
git commit -m "feat(llm): user_api_keys provider CHECK derives from the registry; drop gemini/grok

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `APIKeyService` reads the registry

**Files:**
- Modify: `backend/app/services/api_key_service.py:22-75,317-330,465-580`
- Test: `backend/tests/unit/test_api_key_service.py`

**Interfaces:**
- Consumes: `REGISTRY`, `get_provider`, `global_key_for` from Task 1.
- Produces: `list_providers_info() -> list[dict[str, str]]` with the same keys (`id`, `name`, `description`, `docsUrl`) and only the four registry providers; `_get_global_key` delegates to the registry; `_validate_gemini` / `_validate_grok` are gone.

- [ ] **Step 1: Update the tests**

In `backend/tests/unit/test_api_key_service.py` delete the tests that call `_validate_gemini` (around lines 550-590) and `_validate_grok` (around lines 600-625). Add:

```python
def test_list_providers_info_is_the_registry() -> None:
    from app.llm.registry import REGISTRY
    from app.services.api_key_service import list_providers_info

    infos = list_providers_info()
    assert [i["id"] for i in infos] == [s.id for s in REGISTRY]
    for info, spec in zip(infos, REGISTRY, strict=True):
        assert info["name"] == spec.label
        assert info["description"] == spec.description
        assert info["docsUrl"] == (spec.docs_url or "")


@pytest.mark.asyncio
async def test_global_key_comes_from_the_registry(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.services.api_key_service import APIKeyService

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-ant-global")
    svc = APIKeyService(db=MagicMock(), user_id="not-a-uuid")
    assert svc._get_global_key("anthropic") == "sk-ant-global"
    assert svc._get_global_key("openai_compatible") is None
    assert svc._get_global_key("grok") is None
```

(Match the file's existing fixtures for constructing the service; it already builds `APIKeyService` with a mocked db and a non-UUID user id in other tests — reuse that pattern.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && uv run pytest tests/unit/test_api_key_service.py -v -k "registry"`
Expected: `test_list_providers_info_is_the_registry` FAILS (gemini/grok present); `test_global_key_comes_from_the_registry` FAILS (`anthropic` returns None).

- [ ] **Step 3: Rewrite the metadata and lookups**

In `backend/app/services/api_key_service.py`:

Delete `_PROVIDER_METADATA` (lines 27-52) and replace `list_providers_info` with:

```python
def list_providers_info() -> list[dict[str, str]]:
    """Provider catalogue for the API, derived from the registry."""
    return [
        {
            "id": spec.id,
            "name": spec.label,
            "description": spec.description,
            "docsUrl": spec.docs_url or "",
        }
        for spec in REGISTRY
    ]
```

Change the import line `from app.models.user_api_key import SUPPORTED_PROVIDERS, UserAPIKey` to `from app.models.user_api_key import UserAPIKey` and add `from app.llm.registry import REGISTRY, global_key_for`.

Replace the body of `_get_global_key`:

```python
    def _get_global_key(self, provider: str) -> str | None:
        """The operator's key for ``provider`` (registry.global_key_for)."""
        return global_key_for(provider)
```

In the validation dispatch (around lines 470-480) delete the two `elif` branches for gemini and grok, and delete the `_validate_gemini` and `_validate_grok` methods entirely.

- [ ] **Step 4: Run the whole file and vulture**

Run: `cd backend && uv run pytest tests/unit/test_api_key_service.py tests/unit/test_user_api_keys_endpoint.py -v`
Expected: all PASS.

Run: `cd backend && uv run vulture` (or the project's `make lint-backend` from the repo root)
Expected: no new findings. If `SUPPORTED_PROVIDERS` or `provider_check_literal` show up as unused, they are used by `app/models/__init__.py` and the model's CHECK respectively; do not baseline them.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/api_key_service.py backend/tests/unit/test_api_key_service.py
git commit -m "refactor(api-keys): provider metadata and global keys come from the registry

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Engine read computes `byok_only`

**Files:**
- Modify: `backend/app/services/llm_engine_service.py:497-501`
- Test: `backend/tests/integration/test_llm_engine_endpoint.py`

**Interfaces:**
- Consumes: `is_byok_only` from Task 1.
- Produces: `LlmEngineCatalogEntryRead.byok_only` unchanged in shape; now computed.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/integration/test_llm_engine_endpoint.py`, following the file's existing fixture names for an authenticated member client and a project (read the top of the file and reuse the same fixtures the neighbouring `GET /llm-engine` tests use):

```python
@pytest.mark.asyncio
async def test_byok_only_reflects_the_deployment_global_key(
    client, project, monkeypatch
) -> None:
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", None)
    body = (await client.get(f"/api/v1/projects/{project.id}/llm-engine")).json()["data"]
    anthropic = [e for e in body["catalog"] if e["provider"] == "anthropic"]
    assert anthropic and all(e["byok_only"] is True for e in anthropic)

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-ant-global")
    body = (await client.get(f"/api/v1/projects/{project.id}/llm-engine")).json()["data"]
    anthropic = [e for e in body["catalog"] if e["provider"] == "anthropic"]
    assert all(e["byok_only"] is False for e in anthropic)
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && uv run pytest tests/integration/test_llm_engine_endpoint.py -v -k byok_only`
Expected: FAIL — `AttributeError: 'CatalogEntry' object has no attribute 'byok_only'` (Task 2 removed it).

- [ ] **Step 3: Compute it**

In `backend/app/services/llm_engine_service.py` add `from app.llm.registry import is_byok_only` and change line 500 to `byok_only=is_byok_only(entry.provider),`.

- [ ] **Step 4: Run the engine tests**

Run: `cd backend && uv run pytest tests/integration/test_llm_engine_endpoint.py tests/integration/test_llm_engine_service.py tests/unit/test_llm_engine_endpoints_unit.py tests/unit/test_llm_engine_schemas.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/llm_engine_service.py backend/tests/integration/test_llm_engine_endpoint.py
git commit -m "feat(llm-engine): byok_only computed from the deployment's global keys

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Full gate and PR

**Files:**
- Modify: `backend/.env.example:27-29` (document `ANTHROPIC_API_KEY`), `docs/ROADMAP.md:25` (link this slice)

- [ ] **Step 1: Document the setting**

In `backend/.env.example` after the `OPENAI_API_KEY` line add:

```
# Optional operator key; when empty, Claude models are BYOK-only in this deployment.
ANTHROPIC_API_KEY=""
```

In `docs/ROADMAP.md` line 25, append to the "Provider flexibility (BYOK)" bullet: `Slice 1 (provider registry) — see docs/superpowers/plans/2026-09-12-llm-provider-registry-slice1.md; connections + per-user engine follow as slice 2.`

- [ ] **Step 2: Run the full backend suite and the deterministic gate**

Run: `make test-backend` from the repo root (local Supabase up).
Expected: all pass; read the summary line, do not grep for `FAILED` mid-run.

Run: `make quality-scan`
Expected: every gate OK, including `alembic check`, vulture, and `check_scope_guards`.

- [ ] **Step 3: Commit and open the PR**

```bash
git add backend/.env.example docs/ROADMAP.md
git commit -m "docs: document ANTHROPIC_API_KEY and link the registry slice

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Open a PR to `dev` titled `feat(llm): provider registry (slice 1)`; body lists the four registry providers, the dropped gemini/grok rows, the new optional `ANTHROPIC_API_KEY`, and "no frontend change; `byok_only` keeps its shape". Run `/code-review` before marking ready. Merge-train rule: arm auto-merge only when no other PR into `dev` is armed.

---

## Self-review

- **Spec coverage.** §1 registry: Tasks 1-2. Derived consumers (validator, metadata, `_get_global_key`, catalogue ids, CHECK): Tasks 2-4. `byok_only` computed: Tasks 2 and 5. Slice 1 migration (gemini/grok + CHECK): Task 3. `ANTHROPIC_API_KEY`: Task 1. §7.1 drift + mutation tests: Tasks 1 and 3. Frontend provider labels from `/providers` is slice 2 (the endpoint does not exist yet); the frontend is untouched here by design.
- **Placeholders.** None. The two "reuse the file's fixtures" notes point at concrete neighbouring tests rather than inventing fixture names that may not exist.
- **Type consistency.** `provider_ids()`, `llm_provider_ids()`, `global_key_for()`, `is_byok_only()`, `get_provider()`, `provider_check_literal()` are used with the same names and signatures in every task.
