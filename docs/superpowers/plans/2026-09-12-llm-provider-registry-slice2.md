---
status: in_progress
last_reviewed: 2026-09-13
owner: '@raphaelfh'
---

# LLM Provider Registry (slice 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One `llm_connections` table (user keys, project shared keys, user-owned hosts) behind two API-only routers, a catalogue loaded from YAML, a per-user engine choice with the project default and a manager lock, and the old `user_api_keys` / `project_llm_endpoints` tables, routers, services, dialogs and copy deleted — one PR to `dev`.

**Architecture:** Backend adds `app/models/llm_connection.py` (two tables), `app/services/llm_connection_service.py` (CRUD with the two ownership guards in the WHERE clause, and the ONE credential ladder `resolve_provider_key`), `app/services/user_engine_service.py` (the viewer's row), and rewires `resolve_engine(db, project_id, user_id)` at every call site. Two new routers (`/me/...`, `/projects/{id}/connections`) plus `/projects/{id}/llm-engine/me` replace the deleted `user_api_keys` and `llm_endpoints` routers. Frontend adds one service/hook family (`llmConnectionsService`, `useLlmConnections`), one copy namespace (`llmConnections`), and three surfaces: Integrations → AI connections, the worklist gear picker, and the Project Settings AI engine card with shared keys. Migrations: `0072_llm_connections` creates the two tables; `0073_drop_legacy_credentials` drops the old tables and strips `alternates` — two revisions so the tree is green after every task; the end state is exactly spec §2.

**Tech Stack:** Python 3.11+, FastAPI, SQLAlchemy 2.0 async, Alembic, Pydantic v2, pyyaml, pytest; TypeScript strict, React 19, TanStack Query v5, shadcn/Radix, vitest, MSW, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-12-llm-provider-registry-and-connections-design.md` §1.1, §1.2, §2–§6, §7.2–§7.8 (slice 2). Slice 1 (§1, §7.1) is on `main` — `docs/superpowers/plans/2026-09-12-llm-provider-registry-slice1.md`.

## Global Constraints

- English only for code, comments, commits, docs and copy keys.
- SQLAlchemy model change ⇒ Alembic migration in the SAME task, hand-written inside `backend/` (never through the Supabase MCP), revision id ≤ 32 chars, `down_revision` = previous head; and the head pin `expected_head` in `backend/tests/integration/test_migration_roundtrip.py` (today `"0071_registry_providers"` at `:1332`) moves in the same change. `alembic check` is a CI gate: models and migrations must agree.
- No dead code ships. Frontend: `npx knip --no-tag-hints` AND `npx knip --production --no-tag-hints` at zero; UI copy: `python3 scripts/fitness/check_copy_keys.py` (shrink-only baseline `scripts/fitness/check_copy_keys.baseline`). Backend: vulture shrink-only ratchet (`backend/.vulture_baseline`, `python3 scripts/vulture_baseline.py`); ownership-predicate ratchet `python3 scripts/fitness/check_scope_guards.py` whose baseline `scripts/fitness/check_scope_guards.baseline` only shrinks (five rows for the dropped tables go in Task 13). Delete dead code in files you touch; never park a finding behind an ignore.
- One ownership predicate, one implementation, in the WHERE clause: `owned_user_connection` (`LlmConnection.id == X AND scope == 'user' AND user_id == caller`) and `owned_project_connection` (`LlmConnection.id == X AND scope == 'project' AND project_id == project`) live once each in `app/services/llm_connection_service.py`; nothing else filters `LlmConnection` by id plus an owner column. Membership/role goes through `api/deps/security.py` (`require_project_scope`, `require_project_manager`) or `SELECT public.is_project_manager(...)` from a service — never raw `project_members` SQL.
- No direct-PostgREST write or read of app data from the frontend: every call goes component → hook (TanStack Query, key factory) → service (`apiClient`, returning `ErrorResult<T>`) → backend. Both new tables are RLS `deny_all` with every privilege revoked from `authenticated` and `anon`.
- Every endpoint returns the `ApiResponse` envelope with a typed Pydantic response model; DELETE returns 200 + a typed result, never 204; errors expose `error.message`. Secrets are `SecretStr` inward and never appear on a read model or a 422 echo (`has_api_key` only).
- Tests use the project's fixtures: backend integration `db_session` / `db_session_real`, `SEED` (`tests/integration/conftest.py`), `tests/integration/helpers/engine_setup.py` (`client_as_manager` / `client_as_reviewer` / `client_as_outsider`, `run_in_extract`, `pin_run`, `set_project_engine`); frontend `frontend/test/mocks/server.ts` (MSW), `frontend/test/mocks/*.ts` builders; E2E `loginViaUi` from `frontend/e2e/_fixtures/auth.ts`.
- After ANY change to a route or a Pydantic request/response model: `bash scripts/generate_api_types.sh` (regenerates `frontend/types/api/{openapi.json,schema.d.ts}`; CI `api-contract` fails on a diff) — commit the regenerated files with the task.
- Conventional commits; every commit message ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Commands: backend from `backend/` with `uv run` (`cd backend && uv run pytest <path> -q`; integration tests need the local Supabase stack — `make start` from the repo root; `uv run alembic upgrade head` before integration tests that touch schema). Frontend from the repo root: `npx vitest run <path>`, `npm run typecheck` (= `tsc -p tsconfig.app.json --noEmit`), `npm run lint`.
- Task tags: `[backend]` tasks are implemented by `ship-implementer-backend`, `[frontend]` by `ship-implementer-frontend`. After every task the tree is green: `cd backend && uv run pytest -q`, `npm run test:run`, `npm run typecheck`.

---

## File map

| file | responsibility |
|---|---|
| Modify `backend/app/llm/registry.py` | `ProviderSpec.scopes` + `key_optional`; docstring for `llm_connections` |
| Create `backend/app/llm/models/{openai,anthropic,google,openai_compatible}.yaml` | catalogue rows per LLM provider (§1.1) |
| Modify `backend/app/llm/catalog.py` | `CATALOG` built from the YAML files through a Pydantic row model; `deprecated` |
| Create `backend/app/models/llm_connection.py` | `LlmConnection`, `UserProjectEngine`, CHECK literals from the registry |
| Create `backend/alembic/versions/0072_llm_connections.py` | create both tables, deny-all posture |
| Create `backend/alembic/versions/0073_drop_legacy_credentials.py` | drop `user_api_keys`, `project_llm_endpoints`, `ensure_single_default_api_key()`; strip `alternates` |
| Create `backend/app/schemas/llm_connection.py` | request/read shapes for both scopes, `SecretStr` inward |
| Create `backend/app/services/llm_connection_service.py` | `KeyScope`, `ResolvedKey`, the two guards, CRUD, `verify`, `resolve_provider_key`, `ConnectionUnavailableError` |
| Create `backend/app/services/provider_key_probe.py` | cheap authenticated call per hosted provider (ported from `api_key_service.py`) |
| Create `backend/app/services/user_engine_service.py` | the viewer's `user_project_engines` row: validate, write, clear |
| Create `backend/app/api/v1/endpoints/user_connections.py` | `/me/connections…`, `/me/providers` |
| Create `backend/app/api/v1/endpoints/project_connections.py` | `/projects/{id}/connections…` |
| Modify `backend/app/api/v1/endpoints/llm_engine.py` | new read shape; `PUT/DELETE /{project_id}/llm-engine/me` |
| Modify `backend/app/services/llm_engine_service.py` | `resolve_engine(db, project_id, user_id)`, lock, `availability` map, `deviation` |
| Modify `backend/app/services/engine_credentials.py` | one path: owned connection or `resolve_provider_key` |
| Modify `backend/app/schemas/{llm_target,llm_engine}.py` | `connection_id`, `deviation`, `user_choice_allowed`; `alternates` gone |
| Modify `backend/app/services/run_engine_freeze.py`, `section_extraction_service.py`, `api/v1/endpoints/section_extraction.py`, `worker/tasks/{extraction_tasks,parsing_tasks}.py` | thread `user_id`; delete the dead worker entry; parsing key via `resolve_provider_key` |
| Delete `backend/app/api/v1/endpoints/{user_api_keys,llm_endpoints}.py`, `services/{api_key_service,llm_endpoint_service}.py`, `repositories/user_api_key_repository.py`, `models/{user_api_key,project_llm_endpoint}.py`, `schemas/user_api_key.py` | legacy credential stack |
| Create `frontend/services/llmConnectionsService.ts`, `frontend/hooks/user/useLlmConnections.ts`, `frontend/hooks/project/useProjectConnections.ts`, `frontend/lib/query-keys/me.ts` | connections data layer |
| Create `frontend/lib/copy/llmConnections.ts` | all new copy (§5.2) |
| Create `frontend/components/user/AiConnectionsSection.tsx` | Integrations → AI connections (§5) |
| Create `frontend/components/extraction/EngineGear.tsx` | worklist gear + picker (§5) |
| Create `frontend/components/project/settings/AiEngineSection.tsx` | AI engine card + shared keys (§5) |
| Rewrite `frontend/services/llmEngineService.ts`, `frontend/hooks/extraction/useLlmEngine.ts` | the §4 read + the two writes |
| Delete `frontend/components/extraction/{LlmEngineChip,LlmEnginePane,LlmEngineSettingsDialog,LlmEndpointsDialog}.tsx`, `components/user/ApiKeysSection.tsx`, `services/{apiKeysService,llmEndpointService}.ts`, `hooks/extraction/useLlmEndpoints.ts`, `lib/llmEngineUpdateBody.ts`, `lib/copy/llmEngine.ts`, their tests and mocks | retired surfaces (§5.1) |

---

### Task 1: Registry `scopes` + `key_optional`; catalogue as YAML `[backend]`

**Files:**

- Modify: `backend/app/llm/registry.py:29-38` (dataclass), `:40-85` (entries)
- Create: `backend/app/llm/models/openai.yaml`, `anthropic.yaml`, `google.yaml`, `openai_compatible.yaml`
- Modify: `backend/app/llm/catalog.py` (whole file: `CATALOG` built from the YAML files)
- Modify: `backend/pyproject.toml:12` (`dependencies` gains `"pyyaml>=6.0"`; run `uv lock`)
- Test: `backend/tests/unit/llm/test_registry.py`, `backend/tests/unit/llm/test_catalog.py`

**Interfaces:**

- Consumes: slice 1's `ProviderSpec`, `REGISTRY`, `get_provider`, `llm_provider_ids`, `provider_ids`, `global_key_for`.
- Produces:
  - `ProviderSpec.scopes: frozenset[str]` (subset of `{"user", "project"}`), `ProviderSpec.key_optional: bool`.
  - `CatalogEntry.deprecated: bool` (default `False`); `CATALOG` unchanged in shape/order semantics; `find_entry` still finds deprecated rows; new `selectable_catalog() -> tuple[CatalogEntry, ...]` = non-deprecated rows in catalogue order.
  - `backend/app/llm/models/<provider>.yaml`: one file per `llm_provider_ids()` entry; a list of rows `{model, label, best_for, context_window, cost_tier, deprecated?}`.

- [ ] **Step 1: Write the failing registry tests**

Append to `backend/tests/unit/llm/test_registry.py` (keep the existing tests; the two `byok_only` tests and the two `user_api_keys` tests retire in Task 13):

```python
def test_scopes_are_per_the_spec_table() -> None:
    """§1: hosted providers are storable at both scopes; a host-bearing
    provider is user-only (a host lives on one person's machine)."""
    assert get_provider("openai").scopes == frozenset({"user", "project"})
    assert get_provider("anthropic").scopes == frozenset({"user", "project"})
    assert get_provider("google").scopes == frozenset({"user", "project"})
    assert get_provider("llama_cloud").scopes == frozenset({"user", "project"})
    assert get_provider("openai_compatible").scopes == frozenset({"user"})


@pytest.mark.parametrize("spec", REGISTRY, ids=lambda s: s.id)
def test_scopes_are_a_nonempty_subset_of_user_project(spec: ProviderSpec) -> None:
    assert spec.scopes and spec.scopes <= {"user", "project"}


def test_key_optional_is_exactly_the_host_bearing_rule() -> None:
    """§1: keyless is legal only where a host is (a local Ollama)."""
    for spec in REGISTRY:
        assert spec.key_optional == spec.needs_host, spec.id
```

- [ ] **Step 2: Write the failing catalogue tests**

Append to `backend/tests/unit/llm/test_catalog.py`:

```python
from pathlib import Path

import yaml
from pydantic import ValidationError

from app.llm import catalog as catalog_module
from app.llm.catalog import CatalogRow, load_catalog, selectable_catalog
from app.llm.registry import llm_provider_ids

_MODELS_DIR = Path(catalog_module.__file__).parent / "models"


def test_catalogue_file_set_equals_the_registry_llm_providers() -> None:
    """§1.1: every file name is a registry LLM provider and every LLM
    provider has a file — a provider without a file has no picker rows."""
    files = {p.stem for p in _MODELS_DIR.glob("*.yaml")}
    assert files == set(llm_provider_ids())


def test_catalog_is_ordered_by_registry_then_file_order() -> None:
    order = list(llm_provider_ids())
    providers = [entry.provider for entry in CATALOG]
    assert providers == sorted(providers, key=order.index)
    for provider in order:
        rows = yaml.safe_load((_MODELS_DIR / f"{provider}.yaml").read_text()) or []
        assert [e.model for e in CATALOG if e.provider == provider] == [r["model"] for r in rows]


def test_malformed_row_fails_to_load(tmp_path: Path) -> None:
    """``extra="forbid"`` + required fields: a typo in the data file is an
    import-time failure, never a silently dropped model."""
    (tmp_path / "openai.yaml").write_text(
        "- model: gpt-x\n  label: X\n  best_for: y\n  context_window: 1\n  cost_tier: '$'\n  colour: red\n"
    )
    with pytest.raises(ValidationError):
        load_catalog(tmp_path, ("openai",))


def test_missing_file_fails_to_load(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        load_catalog(tmp_path, ("openai",))


def test_deprecated_row_resolves_but_is_not_selectable(tmp_path: Path) -> None:
    (tmp_path / "openai.yaml").write_text(
        "- model: gpt-live\n  label: Live\n  best_for: a\n  context_window: 1\n  cost_tier: '$'\n"
        "- model: gpt-old\n  label: Old\n  best_for: b\n  context_window: 1\n  cost_tier: '$'\n"
        "  deprecated: true\n"
    )
    entries = load_catalog(tmp_path, ("openai",))
    assert [e.model for e in entries] == ["gpt-live", "gpt-old"]
    assert entries[1].deprecated is True
    by_pair = {(e.provider, e.model): e for e in entries}
    assert by_pair[("openai", "gpt-old")] is not None  # what find_entry does
    assert [e.model for e in entries if not e.deprecated] == ["gpt-live"]


def test_selectable_catalog_omits_deprecated_rows() -> None:
    assert all(not e.deprecated for e in selectable_catalog())
    assert len(selectable_catalog()) <= len(CATALOG)


def test_catalog_row_defaults_deprecated_false() -> None:
    row = CatalogRow(model="m", label="L", best_for="b", context_window=1, cost_tier="$")
    assert row.deprecated is False
```

- [ ] **Step 3: Run both files to verify they fail**

Run: `cd backend && uv run pytest tests/unit/llm/test_registry.py tests/unit/llm/test_catalog.py -q`
Expected: FAIL — `AttributeError: 'ProviderSpec' object has no attribute 'scopes'` and `ImportError: cannot import name 'CatalogRow' from 'app.llm.catalog'`.

- [ ] **Step 4: Add the two registry fields**

In `backend/app/llm/registry.py` replace the dataclass and add the two fields to every entry:

```python
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
    scopes: frozenset[str]
```

Entries: `openai`, `anthropic`, `google`, `llama_cloud` get `key_optional=False, scopes=frozenset({"user", "project"})`; `openai_compatible` gets `key_optional=True, scopes=frozenset({"user"})`. Leave `storable_providers`, `is_byok_only`, `provider_ids` and the module docstring alone in this task (their consumers still exist; Task 13 retires them).

- [ ] **Step 5: Move the catalogue to YAML**

Add `"pyyaml>=6.0",` under `# Database`'s neighbour block in `backend/pyproject.toml` `dependencies` and run `cd backend && uv lock` (pyyaml is already locked transitively; this only promotes it).

Create the four files under `backend/app/llm/models/` with the rows currently in `catalog.py:32-127`, in the same order, one file per provider (`openai.yaml`: gpt-5.6-luna, gpt-5.6-terra, gpt-5.6-sol, gpt-4o-mini; `anthropic.yaml`: claude-sonnet-5, claude-haiku-4-5, claude-opus-5; `google.yaml`: gemini-3.1-flash-lite, gemini-3.8-flash, gemini-3.1-pro-preview; `openai_compatible.yaml`: an empty list `[]` with a comment "host models come from each connection's allowed_models"). Keep the tier-rationale comments as YAML comments. Example:

```yaml
# backend/app/llm/models/anthropic.yaml — Claude models the picker offers.
- model: claude-sonnet-5
  label: Claude Sonnet 5
  best_for: High-quality reasoning and grounded evidence
  context_window: 1000000
  cost_tier: "$$"

- model: claude-haiku-4-5
  label: Claude Haiku 4.5
  best_for: Fast Claude option for high-volume extraction
  context_window: 200000
  # $1/$5 per MTok sits with terra ($2/$12), not with luna: tiers are
  # honest across providers, not within one.
  cost_tier: "$$"

- model: claude-opus-5
  label: Claude Opus 5
  best_for: Deepest Claude reasoning for complex or degraded articles
  context_window: 1000000
  cost_tier: "$$$"
```

Rewrite `backend/app/llm/catalog.py`:

```python
"""Server-curated catalogue of selectable extraction engines (§5, C1b; §1.1).

The catalogue is DATA: ``models/<provider>.yaml``, one file per registry LLM
provider, loaded once at import through a Pydantic row model. Updating
models is a file edit, no Python. A row marked ``deprecated`` is still
found by :func:`find_entry` (existing pins and the retirement check keep
working) but :func:`selectable_catalog` omits it, so the picker never
offers it.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field

from app.llm.registry import llm_provider_ids

_MODELS_DIR = Path(__file__).parent / "models"


class CatalogRow(BaseModel):
    """One YAML row. ``extra="forbid"``: a typo is an import failure."""

    model_config = ConfigDict(extra="forbid")

    model: str = Field(min_length=1, max_length=200)
    label: str = Field(min_length=1)
    best_for: str = Field(min_length=1)
    context_window: int = Field(gt=0)
    cost_tier: Literal["$", "$$", "$$$"]
    deprecated: bool = False


@dataclass(frozen=True)
class CatalogEntry:
    """One selectable engine: identity pair + the copy the picker renders."""

    provider: str
    model: str
    label: str
    best_for: str
    context_window: int
    cost_tier: Literal["$", "$$", "$$$"]
    deprecated: bool = False


def load_catalog(models_dir: Path, providers: tuple[str, ...]) -> tuple[CatalogEntry, ...]:
    """Every provider's file, in registry order, rows in file order.

    A missing file raises ``FileNotFoundError`` and a malformed row raises
    ``ValidationError`` — both at import, never at request time.
    """
    entries: list[CatalogEntry] = []
    for provider in providers:
        raw = yaml.safe_load((models_dir / f"{provider}.yaml").read_text(encoding="utf-8")) or []
        for item in raw:
            row = CatalogRow.model_validate(item)
            entries.append(CatalogEntry(provider=provider, **row.model_dump()))
    return tuple(entries)


CATALOG: tuple[CatalogEntry, ...] = load_catalog(_MODELS_DIR, llm_provider_ids())

_BY_PAIR: dict[tuple[str, str], CatalogEntry] = {(e.provider, e.model): e for e in CATALOG}


def selectable_catalog() -> tuple[CatalogEntry, ...]:
    """The rows the picker offers: everything not deprecated."""
    return tuple(e for e in CATALOG if not e.deprecated)


def find_entry(provider: str, model: str) -> CatalogEntry | None:
    """The catalogue entry for an exact (provider, model) pair, or ``None``.

    ``None`` is the *retired* signal; a deprecated row is still found.
    """
    return _BY_PAIR.get((provider, model))


def canonical_pair(provider: str, model: str) -> str:
    """The ``provider:model`` string provenance carries (§5)."""
    return f"{provider}:{model}"


def canonical(entry: CatalogEntry) -> str:
    """:func:`canonical_pair` for a catalogue entry."""
    return canonical_pair(entry.provider, entry.model)
```

`selectable_catalog` has no production consumer until Task 12 (the engine read); vulture would flag it. Wire it now: in `backend/app/services/llm_engine_service.py:503` change `for entry in CATALOG` to `for entry in selectable_catalog()` and adjust the import on `:37` (`from app.llm.catalog import canonical, canonical_pair, find_entry, selectable_catalog`; `CATALOG` is still used at `:476` for `availability` — keep it). Check the file's docstring paragraph (`catalog.py:8-11` about `is_byok_only`) is gone — it was replaced above.

- [ ] **Step 6: Run the unit suites**

Run: `cd backend && uv run pytest tests/unit/llm -q && uv run ruff check app tests && uv run ruff format --check app tests`
Expected: all PASS; ruff clean. `test_every_entry_is_buildable` still passes (same rows).

- [ ] **Step 7: Commit**

```bash
git add backend/app/llm backend/app/services/llm_engine_service.py backend/pyproject.toml backend/uv.lock backend/tests/unit/llm
git commit -m "feat(llm): registry scopes/key_optional; catalogue loaded from YAML

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `llm_connections` + `user_project_engines` models and migration 0072 `[backend]`

**Files:**

- Create: `backend/app/models/llm_connection.py`
- Modify: `backend/app/models/__init__.py:58-62` (import + `__all__` for `LlmConnection`, `UserProjectEngine`)
- Create: `backend/alembic/versions/0072_llm_connections.py`
- Modify: `backend/tests/integration/test_migration_roundtrip.py:1332` (head pin) and append the 0072 block
- Test: `backend/tests/unit/llm/test_llm_connection_model.py` (new), `backend/tests/integration/test_llm_connection_rls.py` (new), `backend/tests/integration/test_migration_roundtrip.py`

**Interfaces:**

- Consumes: `provider_ids()`, `get_provider()`, `REGISTRY` from `app.llm.registry`.
- Produces:
  - `LlmConnection` (table `public.llm_connections`): `id: UUID` (PK, no server default — the service supplies it), `scope: str`, `user_id: UUID | None`, `project_id: UUID | None`, `provider: str`, `label: str`, `base_url: str | None`, `encrypted_api_key: str | None`, `allowed_models: list[Any]`, `capabilities: dict[str, Any]`, `validation_status: str`, `last_validated_at: datetime | None`, `last_used_at: datetime | None`, `created_by: UUID`, `created_at`, `updated_at`.
  - `UserProjectEngine` (table `public.user_project_engines`): composite PK `(user_id, project_id)`, `provider: str`, `model: str`, `connection_id: UUID | None` (FK `llm_connections.id` ON DELETE SET NULL), `mode: str`, `updated_at: datetime`.
  - `provider_check_literal() -> str` = `"provider IN ('openai', 'anthropic', 'google', 'openai_compatible', 'llama_cloud')"`; `scopes_check_literal() -> str` = `"scope = 'user' OR provider IN ('openai', 'anthropic', 'google', 'llama_cloud')"`; `base_url_check_literal() -> str` = `"((base_url IS NOT NULL) = (provider IN ('openai_compatible'))) AND (base_url IS NULL OR scope = 'user')"`.
  - Constraint names (literal in the DB): `llm_connections_provider_check`, `llm_connections_scopes_check`, `llm_connections_scope_check`, `llm_connections_owner_check`, `llm_connections_base_url_check`, `llm_connections_label_check`, `llm_connections_validation_status_check`, `user_project_engines_mode_check`; partial unique indexes `uq_llm_connections_user_identity` `(user_id, provider, label) WHERE scope = 'user'`, `uq_llm_connections_project_identity` `(project_id, provider, label) WHERE scope = 'project'`, `uq_llm_connections_user_hosted_provider` `(user_id, provider) WHERE scope = 'user' AND base_url IS NULL` (one key per hosted provider per user).

This task is longer than the ~300-line brief cap because the model and its migration must ship together (Global Constraints); the model, the migration and the roundtrip assertions are one reviewable unit.

Spec §2 says "unique `(scope, user_id, project_id, provider, label)`"; with one owner column always NULL, Postgres' default NULL-distinct semantics would make that constraint inert, so the same uniqueness is expressed as the two partial indexes above (one per scope). Same invariant, version-proof.

- [ ] **Step 1: Write the failing model tests**

```python
# backend/tests/unit/llm/test_llm_connection_model.py
"""The connection model's CHECK literals derive from the registry (§2)."""

from __future__ import annotations

import pytest

from app.llm import registry
from app.llm.registry import REGISTRY
from app.models.llm_connection import (
    LlmConnection,
    UserProjectEngine,
    base_url_check_literal,
    provider_check_literal,
    scopes_check_literal,
)


def _check(name: str) -> str:
    # The "ck" naming convention wraps the given name (ck_<table>_<name>);
    # match by substring like tests/unit/llm/test_registry.py does.
    checks = [
        c for c in LlmConnection.__table__.constraints if name in (getattr(c, "name", None) or "")
    ]
    assert len(checks) == 1, name
    return str(checks[0].sqltext)


def test_provider_check_literal_equals_the_registry() -> None:
    assert _check("llm_connections_provider_check") == provider_check_literal()
    assert provider_check_literal() == (
        "provider IN ('openai', 'anthropic', 'google', 'openai_compatible', 'llama_cloud')"
    )


def test_scopes_check_literal_lists_the_project_scope_providers() -> None:
    assert _check("llm_connections_scopes_check") == scopes_check_literal()
    assert scopes_check_literal() == (
        "scope = 'user' OR provider IN ('openai', 'anthropic', 'google', 'llama_cloud')"
    )


def test_base_url_check_names_the_host_bearing_providers() -> None:
    assert _check("llm_connections_base_url_check") == base_url_check_literal()
    assert "('openai_compatible')" in base_url_check_literal()


def test_removing_a_provider_breaks_the_drift_guard(monkeypatch: pytest.MonkeyPatch) -> None:
    """Mutation test: the baked CHECK must diverge from a freshly computed
    literal once the registry loses a provider — the guard is not vacuous."""
    baked = _check("llm_connections_provider_check")
    trimmed = tuple(spec for spec in REGISTRY if spec.id != "anthropic")
    monkeypatch.setattr(registry, "REGISTRY", trimmed)
    assert baked != provider_check_literal()
    assert _check("llm_connections_scopes_check") != scopes_check_literal()


def test_user_project_engines_pk_is_user_and_project() -> None:
    assert [c.name for c in UserProjectEngine.__table__.primary_key.columns] == [
        "user_id",
        "project_id",
    ]
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && uv run pytest tests/unit/llm/test_llm_connection_model.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.models.llm_connection'`.

- [ ] **Step 3: Write the models**

```python
# backend/app/models/llm_connection.py
"""Connections (§2) and per-user engine rows (§3.1) — SECRETS tables.

``llm_connections`` is ONE table for a user's hosted-provider key, a
project's shared key, and a user-owned custom host. ``encrypted_api_key``
is a Fernet ciphertext under a per-row derived key (``derive_encryption_key``
with input ``connection:{id}``), so the service supplies ``id`` BEFORE
insert. Both tables are API-only: migration 0072 enables RLS with a
``deny_all`` policy and revokes every privilege from ``authenticated`` /
``anon``; the backend's own role owns them and bypasses RLS.

The CHECK literals below are computed from the registry — the ONE list of
providers — and asserted equal to it by ``tests/unit/llm/test_llm_connection_model.py``
and to the live constraint by ``tests/integration/test_migration_roundtrip.py``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.llm.registry import REGISTRY, provider_ids
from app.models.base import Base, BaseModel

VALIDATION_STATUSES = ("unverified", "ok", "failed")


def _quoted(ids: tuple[str, ...]) -> str:
    return ", ".join(f"'{pid}'" for pid in ids)


def provider_check_literal() -> str:
    """The exact SQL text of the ``provider`` CHECK, from the registry."""
    return f"provider IN ({_quoted(provider_ids())})"


def scopes_check_literal() -> str:
    """Project-scope rows may only name providers whose ``scopes`` allow it."""
    project_ids = tuple(spec.id for spec in REGISTRY if "project" in spec.scopes)
    return f"scope = 'user' OR provider IN ({_quoted(project_ids)})"


def base_url_check_literal() -> str:
    """A host is set iff the provider needs one, and only at user scope."""
    host_ids = tuple(spec.id for spec in REGISTRY if spec.needs_host)
    return (
        f"((base_url IS NOT NULL) = (provider IN ({_quoted(host_ids)}))) "
        "AND (base_url IS NULL OR scope = 'user')"
    )


class LlmConnection(BaseModel):
    """A provider, a credential, and (host-bearing providers) a host."""

    __tablename__ = "llm_connections"

    scope: Mapped[str] = mapped_column(Text, nullable=False)
    user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.profiles.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    project_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.projects.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    provider: Mapped[str] = mapped_column(Text, nullable=False)
    label: Mapped[str] = mapped_column(Text, nullable=False)
    base_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    encrypted_api_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    allowed_models: Mapped[list[Any]] = mapped_column(
        JSONB, server_default=text("'[]'::jsonb"), nullable=False
    )
    capabilities: Mapped[dict[str, Any]] = mapped_column(
        JSONB, server_default=text("'{}'::jsonb"), nullable=False
    )
    validation_status: Mapped[str] = mapped_column(
        Text, server_default="unverified", nullable=False
    )
    last_validated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.profiles.id", ondelete="RESTRICT"),
        nullable=False,
    )

    __table_args__ = (
        # Given names mirror the retired user_api_keys model: the DB carries
        # them literally (migration 0072); the "ck" convention's wrapped
        # model-side name is inert — alembic check does not diff CHECKs.
        CheckConstraint(provider_check_literal(), name="llm_connections_provider_check"),
        CheckConstraint(scopes_check_literal(), name="llm_connections_scopes_check"),
        CheckConstraint("scope IN ('user', 'project')", name="llm_connections_scope_check"),
        CheckConstraint(
            "(scope = 'user' AND user_id IS NOT NULL AND project_id IS NULL) "
            "OR (scope = 'project' AND project_id IS NOT NULL AND user_id IS NULL)",
            name="llm_connections_owner_check",
        ),
        CheckConstraint(base_url_check_literal(), name="llm_connections_base_url_check"),
        CheckConstraint("char_length(label) BETWEEN 1 AND 80", name="llm_connections_label_check"),
        CheckConstraint(
            "validation_status IN ('unverified', 'ok', 'failed')",
            name="llm_connections_validation_status_check",
        ),
        Index(
            "uq_llm_connections_user_identity",
            "user_id",
            "provider",
            "label",
            unique=True,
            postgresql_where=text("scope = 'user'"),
        ),
        Index(
            "uq_llm_connections_project_identity",
            "project_id",
            "provider",
            "label",
            unique=True,
            postgresql_where=text("scope = 'project'"),
        ),
        Index(
            "uq_llm_connections_user_hosted_provider",
            "user_id",
            "provider",
            unique=True,
            postgresql_where=text("scope = 'user' AND base_url IS NULL"),
        ),
        {"schema": "public"},
    )

    def __repr__(self) -> str:
        return f"<LlmConnection scope={self.scope} provider={self.provider} label={self.label!r}>"


class UserProjectEngine(Base):
    """The viewer's own engine for new runs in one project (§3.1).

    No row means "follow the project default". ``connection_id`` is nulled
    when the connection is deleted; a host-bearing row with a null pointer
    is *retired* (§3.2 step 2).
    """

    __tablename__ = "user_project_engines"

    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.profiles.id", ondelete="CASCADE"),
        primary_key=True,
    )
    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.projects.id", ondelete="CASCADE"),
        primary_key=True,
    )
    provider: Mapped[str] = mapped_column(Text, nullable=False)
    model: Mapped[str] = mapped_column(Text, nullable=False)
    connection_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.llm_connections.id", ondelete="SET NULL"),
        nullable=True,
    )
    mode: Mapped[str] = mapped_column(Text, server_default="fast", nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        CheckConstraint("mode IN ('fast', 'verified')", name="user_project_engines_mode_check"),
        {"schema": "public"},
    )
```

`Base` is the declarative base `BaseModel` extends (see `backend/app/models/base.py`; `BaseModel` = `Base` + `UUIDMixin` + `TimestampMixin`). `UserProjectEngine` uses `Base` directly because its PK is composite. Register both in `backend/app/models/__init__.py` next to the `project_llm_endpoint` import and in `__all__`.

- [ ] **Step 4: Write the migration**

```python
# backend/alembic/versions/0072_llm_connections.py
"""Create llm_connections and user_project_engines (spec §2, §3.1).

One table replaces ``user_api_keys`` (owner-readable through PostgREST —
a user's ciphertext reached the browser) and ``project_llm_endpoints``:
a connection is a provider, a credential and, for a host-bearing
provider, a host. ``user_project_engines`` holds each member's own engine
for new runs; no row means "follow the project default".

Both are SECRETS/decision tables with the ``project_llm_endpoints``
posture (migration 0055): RLS enabled, ``deny_all`` policy, every
privilege revoked from ``authenticated`` and ``anon``. The backend's own
role owns them and bypasses RLS.

The old tables are dropped by 0073 once every reader has moved; this
revision is additive so each task of the slice-2 plan stays green.

Revision ID: 0072_llm_connections
Revises: 0071_registry_providers
Create Date: 2026-09-13
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

from alembic import op

revision = "0072_llm_connections"
down_revision = "0071_registry_providers"
branch_labels = None
depends_on = None

# Literals, not registry imports: a migration must never change meaning
# when app code moves on. tests/integration/test_migration_roundtrip.py
# asserts the live CHECK equals the registry at head.
_PROVIDER_CHECK = "provider IN ('openai', 'anthropic', 'google', 'openai_compatible', 'llama_cloud')"
_SCOPES_CHECK = "scope = 'user' OR provider IN ('openai', 'anthropic', 'google', 'llama_cloud')"
_BASE_URL_CHECK = (
    "((base_url IS NOT NULL) = (provider IN ('openai_compatible'))) "
    "AND (base_url IS NULL OR scope = 'user')"
)


def _deny_all(table: str) -> None:
    op.execute(f'ALTER TABLE "public"."{table}" ENABLE ROW LEVEL SECURITY;')
    op.execute(f'CREATE POLICY "deny_all" ON "public"."{table}" FOR ALL USING (false);')
    op.execute(f'REVOKE ALL ON "public"."{table}" FROM "authenticated", "anon";')


def upgrade() -> None:
    op.create_table(
        "llm_connections",
        sa.Column("id", PG_UUID(as_uuid=True), primary_key=True),
        sa.Column("scope", sa.Text(), nullable=False),
        sa.Column(
            "user_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("public.profiles.id", ondelete="CASCADE", name="llm_connections_user_id_fkey"),
            nullable=True,
        ),
        sa.Column(
            "project_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("public.projects.id", ondelete="CASCADE", name="llm_connections_project_id_fkey"),
            nullable=True,
        ),
        sa.Column("provider", sa.Text(), nullable=False),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("base_url", sa.Text(), nullable=True),
        sa.Column("encrypted_api_key", sa.Text(), nullable=True),
        sa.Column("allowed_models", JSONB(), server_default=sa.text("'[]'::jsonb"), nullable=False),
        sa.Column("capabilities", JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("validation_status", sa.Text(), server_default="unverified", nullable=False),
        sa.Column("last_validated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_by",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("public.profiles.id", ondelete="RESTRICT", name="llm_connections_created_by_fkey"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(_PROVIDER_CHECK, name="llm_connections_provider_check"),
        sa.CheckConstraint(_SCOPES_CHECK, name="llm_connections_scopes_check"),
        sa.CheckConstraint("scope IN ('user', 'project')", name="llm_connections_scope_check"),
        sa.CheckConstraint(
            "(scope = 'user' AND user_id IS NOT NULL AND project_id IS NULL) "
            "OR (scope = 'project' AND project_id IS NOT NULL AND user_id IS NULL)",
            name="llm_connections_owner_check",
        ),
        sa.CheckConstraint(_BASE_URL_CHECK, name="llm_connections_base_url_check"),
        sa.CheckConstraint("char_length(label) BETWEEN 1 AND 80", name="llm_connections_label_check"),
        sa.CheckConstraint(
            "validation_status IN ('unverified', 'ok', 'failed')",
            name="llm_connections_validation_status_check",
        ),
        schema="public",
    )
    op.create_index("ix_public_llm_connections_user_id", "llm_connections", ["user_id"], schema="public")
    op.create_index("ix_public_llm_connections_project_id", "llm_connections", ["project_id"], schema="public")
    op.create_index(
        "uq_llm_connections_user_identity",
        "llm_connections",
        ["user_id", "provider", "label"],
        unique=True,
        schema="public",
        postgresql_where=sa.text("scope = 'user'"),
    )
    op.create_index(
        "uq_llm_connections_project_identity",
        "llm_connections",
        ["project_id", "provider", "label"],
        unique=True,
        schema="public",
        postgresql_where=sa.text("scope = 'project'"),
    )
    op.create_index(
        "uq_llm_connections_user_hosted_provider",
        "llm_connections",
        ["user_id", "provider"],
        unique=True,
        schema="public",
        postgresql_where=sa.text("scope = 'user' AND base_url IS NULL"),
    )
    _deny_all("llm_connections")

    op.create_table(
        "user_project_engines",
        sa.Column(
            "user_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("public.profiles.id", ondelete="CASCADE", name="user_project_engines_user_id_fkey"),
            primary_key=True,
        ),
        sa.Column(
            "project_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("public.projects.id", ondelete="CASCADE", name="user_project_engines_project_id_fkey"),
            primary_key=True,
        ),
        sa.Column("provider", sa.Text(), nullable=False),
        sa.Column("model", sa.Text(), nullable=False),
        sa.Column(
            "connection_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey(
                "public.llm_connections.id",
                ondelete="SET NULL",
                name="user_project_engines_connection_id_fkey",
            ),
            nullable=True,
        ),
        sa.Column("mode", sa.Text(), server_default="fast", nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("mode IN ('fast', 'verified')", name="user_project_engines_mode_check"),
        schema="public",
    )
    _deny_all("user_project_engines")


def downgrade() -> None:
    # Policies, indexes and constraints fall with their tables.
    op.drop_table("user_project_engines", schema="public")
    op.drop_table("llm_connections", schema="public")
```

- [ ] **Step 5: Apply locally and run `alembic check`**

Run: `cd backend && uv run alembic upgrade head && uv run alembic check`
Expected: `INFO ... Running upgrade 0071_registry_providers -> 0072_llm_connections` then `No new upgrade operations detected.` If `alembic check` reports an index/constraint diff, align the MODEL to the migration (names above are the contract), never the other way.

Note: the local Supabase stack is shared by every session on this machine; `upgrade head` moves it for all of them. That is expected on `dev` work.

- [ ] **Step 6: Move the head pin and add the roundtrip assertions**

In `backend/tests/integration/test_migration_roundtrip.py:1332` set `expected_head = "0072_llm_connections"`. Append:

```python
# --- 0072: llm_connections + user_project_engines -------------------------
_CONN_CHECK_DEF = text(
    "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = :name"
)


@pytest.mark.asyncio
async def test_llm_connections_checks_match_the_registry_at_head(
    migration_session: AsyncSession,
) -> None:
    """The live CHECKs name exactly the registry's providers / project
    scopes — the migration is hand-written literals, so this is the only
    thing tying it to ``app.llm.registry``."""
    import re

    from app.llm.registry import REGISTRY, provider_ids

    provider_def = (
        await migration_session.execute(_CONN_CHECK_DEF, {"name": "llm_connections_provider_check"})
    ).scalar()
    assert provider_def is not None, "llm_connections_provider_check must exist at head"
    assert set(re.findall(r"'([a-z_]+)'", provider_def)) == set(provider_ids())

    scopes_def = (
        await migration_session.execute(_CONN_CHECK_DEF, {"name": "llm_connections_scopes_check"})
    ).scalar()
    assert scopes_def is not None, "llm_connections_scopes_check must exist at head"
    expected = {spec.id for spec in REGISTRY if "project" in spec.scopes}
    assert set(re.findall(r"'([a-z_]+)'", scopes_def)) - {"user"} == expected


@pytest.mark.asyncio
async def test_0072_tables_are_deny_all_and_revoked(migration_session: AsyncSession) -> None:
    for table in ("llm_connections", "user_project_engines"):
        policies = (
            await migration_session.execute(
                text("SELECT polname FROM pg_policy WHERE polrelid = :t::regclass"),
                {"t": f"public.{table}"},
            )
        ).scalars().all()
        assert policies == ["deny_all"], table
        grants = (
            await migration_session.execute(
                text(
                    "SELECT count(*) FROM information_schema.role_table_grants "
                    "WHERE table_schema = 'public' AND table_name = :t "
                    "AND grantee IN ('authenticated', 'anon')"
                ),
                {"t": table},
            )
        ).scalar()
        assert grants == 0, table
```

- [ ] **Step 7: Write the RLS probe test**

Copy `backend/tests/integration/test_llm_endpoint_rls.py` to `backend/tests/integration/test_llm_connection_rls.py`, set `_TABLE = "public.llm_connections"`, and replace `_INSERT_ENDPOINT` with:

```python
_INSERT_CONNECTION = (
    "INSERT INTO public.llm_connections "
    "(id, scope, user_id, provider, label, created_by) "
    "VALUES (:id, 'user', :uid, 'openai', 'rls-probe', :uid)"
)
```

Keep the file's four probes (SELECT denied by grant, INSERT denied by grant, SELECT under re-granted privilege returns zero rows through `deny_all`, service-role insert visible to the owner role) with the new statement; rename the module docstring's table and migration number (0072). The endpoint probe file itself is deleted in Task 13.

- [ ] **Step 8: Run the suites**

Run: `cd backend && uv run pytest tests/unit/llm/test_llm_connection_model.py tests/integration/test_llm_connection_rls.py tests/integration/test_migration_roundtrip.py -q`
Expected: all PASS (the roundtrip suite creates its own scratch database; it takes ~1 minute).

- [ ] **Step 9: Commit**

```bash
git add backend/app/models/llm_connection.py backend/app/models/__init__.py backend/alembic/versions/0072_llm_connections.py backend/tests/unit/llm/test_llm_connection_model.py backend/tests/integration/test_llm_connection_rls.py backend/tests/integration/test_migration_roundtrip.py
git commit -m "feat(db): llm_connections and user_project_engines tables (0072)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Connection request/read schemas `[backend]`

**Files:**

- Create: `backend/app/schemas/llm_connection.py`
- Test: `backend/tests/unit/test_llm_connection_schemas.py` (new)

**Interfaces:**

- Consumes: `get_provider` (registry, with Task 1's `scopes` / `key_optional`), `LlmEndpointCapabilities` (`app.schemas.llm_endpoint`, kept).
- Produces (`app.schemas.llm_connection`): `UserConnectionCreateRequest`, `ProjectConnectionCreateRequest` (`provider`, `label`, `api_key: SecretStr | None`, `base_url: str | None`, `allowed_models: list[str]`; `extra="forbid"`; class attribute `scope`), `LlmConnectionUpdateRequest` (`label`, `api_key: SecretStr | None` tri-state, `base_url: str | None`, `allowed_models`), `LlmConnectionRead` (`id`, `scope`, `provider`, `label`, `base_url`, `has_api_key`, `allowed_models`, `capabilities: LlmEndpointCapabilities`, `validation_status`, `last_validated_at`, `last_used_at`, `created_by_name`, `created_at`), `LlmConnectionDeleteResult` (`deleted`, `id`), `LlmConnectionVerifyResult` (`validation_status: Literal["ok","failed"]`, `output_mode`, `models_seen`, `error`), `ProviderRead` (`id`, `label`, `description`, `docs_url`, `needs_host`, `key_optional`, `scopes: list[str]`, `global_key_available`).

- [ ] **Step 1: Write the failing schema tests**

```python
# backend/tests/unit/test_llm_connection_schemas.py
"""§6: provider not in registry, host on a host-less provider, missing host,
project scope on a host-bearing provider → 422 from the schema."""

from __future__ import annotations

import pytest
from pydantic import SecretStr, ValidationError

from app.schemas.llm_connection import (
    LlmConnectionUpdateRequest,
    ProjectConnectionCreateRequest,
    UserConnectionCreateRequest,
)


def test_unknown_provider_is_rejected() -> None:
    with pytest.raises(ValidationError, match="provider"):
        UserConnectionCreateRequest(provider="grok", label="x", api_key=SecretStr("k"))


def test_host_on_a_hosted_provider_is_rejected() -> None:
    with pytest.raises(ValidationError, match="base_url"):
        UserConnectionCreateRequest(
            provider="openai", label="x", api_key=SecretStr("k"), base_url="https://a.example/v1"
        )


def test_missing_host_on_a_host_bearing_provider_is_rejected() -> None:
    with pytest.raises(ValidationError, match="base_url"):
        UserConnectionCreateRequest(provider="openai_compatible", label="x")


def test_missing_key_is_rejected_unless_the_provider_allows_keyless() -> None:
    with pytest.raises(ValidationError, match="api_key"):
        UserConnectionCreateRequest(provider="anthropic", label="x")
    keyless = UserConnectionCreateRequest(
        provider="openai_compatible", label="ollama", base_url="https://8.8.8.8/v1"
    )
    assert keyless.api_key is None


def test_empty_key_is_a_mistake_not_keyless() -> None:
    with pytest.raises(ValidationError, match="api_key"):
        UserConnectionCreateRequest(provider="openai", label="x", api_key=SecretStr(""))


def test_project_scope_refuses_a_host_bearing_provider() -> None:
    with pytest.raises(ValidationError, match="project"):
        ProjectConnectionCreateRequest(
            provider="openai_compatible", label="x", base_url="https://8.8.8.8/v1"
        )


def test_project_scope_accepts_llama_cloud() -> None:
    req = ProjectConnectionCreateRequest(provider="llama_cloud", label="parsing", api_key=SecretStr("lc"))
    assert req.provider == "llama_cloud"


def test_secret_never_appears_in_repr_or_dump() -> None:
    req = UserConnectionCreateRequest(provider="openai", label="x", api_key=SecretStr("sk-real"))
    assert "sk-real" not in repr(req)
    assert "sk-real" not in str(req.model_dump())


def test_update_clear_key_is_the_empty_string() -> None:
    req = LlmConnectionUpdateRequest(label="x", api_key=SecretStr(""))
    assert req.api_key is not None and req.api_key.get_secret_value() == ""
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_llm_connection_schemas.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.schemas.llm_connection'`.

- [ ] **Step 3: Write the schemas**

```python
# backend/app/schemas/llm_connection.py
"""Connection contract (§2, §4) — secrets never cross this boundary.

``api_key`` is a ``SecretStr`` on every request shape; the read model
carries ``has_api_key`` only. The registry is the validator: an unknown
provider, a host on a host-less provider, a missing host, a missing key
where the provider needs one, or a project-scope request naming a
host-bearing provider are all 422s here — the DB CHECKs are the backstop.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, ClassVar, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator, model_validator

from app.llm.registry import get_provider
from app.schemas.llm_endpoint import LlmEndpointCapabilities

_BASE_URL_MAX = 2048
ModelId = Annotated[str, Field(max_length=200)]


def _non_empty_secret(v: SecretStr | None) -> SecretStr | None:
    if v is not None and v.get_secret_value() == "":
        raise ValueError("api_key must be omitted or non-empty")
    return v


class _ConnectionCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scope: ClassVar[Literal["user", "project"]]

    provider: str = Field(max_length=50)
    label: str = Field(min_length=1, max_length=80)
    api_key: SecretStr | None = None
    base_url: str | None = Field(default=None, max_length=_BASE_URL_MAX)
    allowed_models: list[ModelId] = Field(default=[], max_length=200)

    _reject_empty_key = field_validator("api_key")(_non_empty_secret)

    @model_validator(mode="after")
    def _registry_rules(self) -> _ConnectionCreateRequest:
        spec = get_provider(self.provider)
        if spec is None:
            raise ValueError(f"provider: {self.provider!r} is not a registry provider")
        if self.scope not in spec.scopes:
            raise ValueError(f"provider: {self.provider!r} cannot be stored at {self.scope} scope")
        if spec.needs_host and not self.base_url:
            raise ValueError(f"base_url: {self.provider!r} requires a host")
        if not spec.needs_host and self.base_url is not None:
            raise ValueError(f"base_url: {self.provider!r} is a hosted provider; no host allowed")
        if not spec.key_optional and self.api_key is None:
            raise ValueError(f"api_key: {self.provider!r} requires a key")
        return self


class UserConnectionCreateRequest(_ConnectionCreateRequest):
    scope = "user"


class ProjectConnectionCreateRequest(_ConnectionCreateRequest):
    scope = "project"


class LlmConnectionUpdateRequest(BaseModel):
    """Full-replace ``label`` / ``base_url`` / ``allowed_models``; ``api_key``
    tri-state: ``None`` keeps, ``""`` clears (host-bearing providers only —
    the service refuses it elsewhere), non-empty re-encrypts."""

    model_config = ConfigDict(extra="forbid")

    label: str = Field(min_length=1, max_length=80)
    api_key: SecretStr | None = None
    base_url: str | None = Field(default=None, max_length=_BASE_URL_MAX)
    allowed_models: list[ModelId] = Field(default=[], max_length=200)


class LlmConnectionRead(BaseModel):
    id: UUID
    scope: Literal["user", "project"]
    provider: str
    label: str
    base_url: str | None
    has_api_key: bool
    allowed_models: list[str]
    capabilities: LlmEndpointCapabilities
    validation_status: Literal["unverified", "ok", "failed"]
    last_validated_at: datetime | None
    last_used_at: datetime | None
    created_by_name: str | None
    created_at: datetime


class LlmConnectionDeleteResult(BaseModel):
    deleted: bool
    id: UUID


class LlmConnectionVerifyResult(BaseModel):
    validation_status: Literal["ok", "failed"]
    output_mode: Literal["tool", "native", "prompted"] | None
    models_seen: list[str]
    error: str | None


class ProviderRead(BaseModel):
    """§4 ``GET /me/providers`` row; ``global_key_available`` is per deployment."""

    id: str
    label: str
    description: str
    docs_url: str | None
    needs_host: bool
    key_optional: bool
    scopes: list[str]
    global_key_available: bool
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/schemas/llm_connection.py backend/tests/unit/test_llm_connection_schemas.py
git commit -m "feat(connections): connection request/read schemas

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Connection service and ownership guards `[backend]`

**Files:**

- Create: `backend/app/services/llm_connection_service.py`
- Test: `backend/tests/integration/test_llm_connection_service.py` (new)

**Interfaces:**

- Consumes: `LlmConnection` (Task 2), the Task 3 schemas, `get_provider`, `global_key_for` (registry), `derive_encryption_key` (`app.core.security`), `validate_endpoint_url` (`app.core.net_guard`), `_profile_names` (`app.services.llm_engine_service`).
- Produces (`app.services.llm_connection_service`):

  - `class ConnectionUnavailableError(AppError)` — `code="LLM_ENDPOINT_UNAVAILABLE"`, 409 (the existing typed unavailable 409; `ExtractionErrorCode` is unchanged).
  - `class ConnectionNotFoundError(Exception)` — router maps to 404.
  - `async def owned_user_connection(db, connection_id: UUID, user_id: UUID) -> LlmConnection | None`; `async def owned_project_connection(db, connection_id: UUID, project_id: UUID) -> LlmConnection | None` — THE two ownership predicates.
  - `class LlmConnectionService(db)`: `list_user(user_id) -> list[LlmConnectionRead]`, `list_project(project_id)`, `create_user(*, user_id, payload: UserConnectionCreateRequest) -> LlmConnectionRead`, `create_project(*, project_id, created_by, payload: ProjectConnectionCreateRequest)`, `update_user(*, user_id, connection_id, payload: LlmConnectionUpdateRequest)`, `update_project(*, project_id, connection_id, payload)`, `delete_user(*, user_id, connection_id) -> LlmConnectionDeleteResult`, `delete_project(*, project_id, connection_id)`, `decrypt_key(row) -> str | None`. `ValueError` = duplicate label or a host rule the schema could not check (400 at the router); `EndpointUrlError` propagates (400).
- [ ] **Step 1: Write the failing service tests**

```python
# backend/tests/integration/test_llm_connection_service.py
"""LlmConnectionService against real Postgres: Fernet round-trip, the two
ownership guards (cross-owner = miss) and the identity uniqueness (§2,
§7.3). Literal public IPs pass the SSRF guard without DNS."""

from __future__ import annotations

from uuid import uuid4

import pytest
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.llm_connection import (
    LlmConnectionUpdateRequest,
    ProjectConnectionCreateRequest,
    UserConnectionCreateRequest,
)
from app.services.llm_connection_service import (
    ConnectionNotFoundError,
    LlmConnectionService,
    owned_project_connection,
    owned_user_connection,
)
from tests.integration.conftest import SEED


async def _user_key(db: AsyncSession, provider: str = "openai", key: str = "sk-user") -> str:
    read = await LlmConnectionService(db).create_user(
        user_id=SEED.primary_profile,
        payload=UserConnectionCreateRequest(provider=provider, label=f"my {provider}", api_key=SecretStr(key)),
    )
    return str(read.id)


async def _project_key(db: AsyncSession, provider: str = "openai", key: str = "sk-project") -> str:
    read = await LlmConnectionService(db).create_project(
        project_id=SEED.primary_project,
        created_by=SEED.primary_profile,
        payload=ProjectConnectionCreateRequest(provider=provider, label=f"shared {provider}", api_key=SecretStr(key)),
    )
    return str(read.id)


@pytest.mark.asyncio
async def test_create_encrypts_and_read_never_carries_the_key(db_session: AsyncSession) -> None:
    svc = LlmConnectionService(db_session)
    read = await svc.create_user(
        user_id=SEED.primary_profile,
        payload=UserConnectionCreateRequest(provider="openai", label="k", api_key=SecretStr("sk-plain")),
    )
    assert read.has_api_key is True and "sk-plain" not in read.model_dump_json()
    row = await owned_user_connection(db_session, read.id, SEED.primary_profile)
    assert row is not None and row.encrypted_api_key != "sk-plain"
    assert await svc.decrypt_key(row) == "sk-plain"


@pytest.mark.asyncio
async def test_user_guard_misses_another_users_row(db_session: AsyncSession) -> None:
    cid = await _user_key(db_session)
    assert await owned_user_connection(db_session, cid, SEED.reviewer_profile) is None
    assert await owned_project_connection(db_session, cid, SEED.primary_project) is None


@pytest.mark.asyncio
async def test_project_guard_misses_another_project(db_session: AsyncSession) -> None:
    cid = await _project_key(db_session)
    assert await owned_project_connection(db_session, cid, SEED.secondary_project) is None
    assert await owned_user_connection(db_session, cid, SEED.primary_profile) is None


@pytest.mark.asyncio
async def test_one_hosted_key_per_provider_per_user(db_session: AsyncSession) -> None:
    await _user_key(db_session)
    with pytest.raises(ValueError, match="already"):
        await LlmConnectionService(db_session).create_user(
            user_id=SEED.primary_profile,
            payload=UserConnectionCreateRequest(provider="openai", label="second", api_key=SecretStr("k2")),
        )


@pytest.mark.asyncio
async def test_host_connections_store_the_vetted_url_and_allow_keyless(db_session: AsyncSession) -> None:
    read = await LlmConnectionService(db_session).create_user(
        user_id=SEED.primary_profile,
        payload=UserConnectionCreateRequest(
            provider="openai_compatible", label="ollama", base_url="https://8.8.8.8/v1/", allowed_models=["llama3"]
        ),
    )
    assert read.base_url == "https://8.8.8.8/v1" and read.has_api_key is False
    assert read.validation_status == "unverified" and read.allowed_models == ["llama3"]


@pytest.mark.asyncio
async def test_update_and_delete_go_through_the_guard(db_session: AsyncSession) -> None:
    cid = await _user_key(db_session)
    svc = LlmConnectionService(db_session)
    with pytest.raises(ConnectionNotFoundError):
        await svc.update_user(
            user_id=SEED.reviewer_profile, connection_id=cid, payload=LlmConnectionUpdateRequest(label="stolen")
        )
    with pytest.raises(ConnectionNotFoundError):
        await svc.delete_user(user_id=SEED.reviewer_profile, connection_id=cid)
    read = await svc.update_user(
        user_id=SEED.primary_profile, connection_id=cid, payload=LlmConnectionUpdateRequest(label="renamed")
    )
    assert read.label == "renamed"
    result = await svc.delete_user(user_id=SEED.primary_profile, connection_id=cid)
    assert result.deleted is True and str(result.id) == cid
    assert await svc.list_user(SEED.primary_profile) == []


@pytest.mark.asyncio
async def test_clearing_the_key_is_refused_on_a_hosted_provider(db_session: AsyncSession) -> None:
    cid = await _user_key(db_session)
    with pytest.raises(ValueError, match="key"):
        await LlmConnectionService(db_session).update_user(
            user_id=SEED.primary_profile, connection_id=cid,
            payload=LlmConnectionUpdateRequest(label="k", api_key=SecretStr("")),
        )


```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && uv run pytest tests/integration/test_llm_connection_service.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.llm_connection_service'`.

- [ ] **Step 3: Write the service**

```python
# backend/app/services/llm_connection_service.py
"""Connections (§2, §3.3): CRUD for both scopes, the two ownership guards,
per-row Fernet, and (Task 5) the ONE credential ladder.

Ownership predicates live HERE and nowhere else, in the WHERE clause:
:func:`owned_user_connection` (id + scope 'user' + user_id) and
:func:`owned_project_connection` (id + scope 'project' + project_id). A
cross-owner id is a miss, indistinguishable from a deleted row.

Key handling: ``encrypted_api_key`` is a Fernet ciphertext under
``derive_encryption_key(f"connection:{id}")`` — the ``connection:``
prefix domain-separates the row namespace (constitution §IV, per-row
derived keys). Key material never reaches a read model or an error.
"""

from __future__ import annotations

import base64
from uuid import UUID, uuid4

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_handler import AppError
from app.core.net_guard import validate_endpoint_url
from app.core.security import derive_encryption_key
from app.llm.registry import get_provider
from app.models.llm_connection import LlmConnection
from app.schemas.llm_connection import (
    LlmConnectionDeleteResult,
    LlmConnectionRead,
    LlmConnectionUpdateRequest,
    ProjectConnectionCreateRequest,
    UserConnectionCreateRequest,
)
from app.schemas.llm_endpoint import LlmEndpointCapabilities
from app.services.llm_engine_service import _profile_names

__all__ = [
    "ConnectionNotFoundError",
    "ConnectionUnavailableError",
    "LlmConnectionService",
    "owned_project_connection",
    "owned_user_connection",
]


class ConnectionUnavailableError(AppError):
    """A pinned connection cannot serve (gone, other owner, undecryptable).
    Same code and status as the endpoint-era error: the worker and the
    frontend classify it unchanged."""

    def __init__(self, message: str) -> None:
        super().__init__(code="LLM_ENDPOINT_UNAVAILABLE", message=message, status_code=409)


class ConnectionNotFoundError(Exception):
    """No connection for (owner, id). Routers translate to 404."""


def _fernet_for(connection_id: UUID) -> Fernet:
    return Fernet(base64.urlsafe_b64encode(derive_encryption_key(f"connection:{connection_id}")))


def _encrypt(connection_id: UUID, secret: str) -> str:
    return _fernet_for(connection_id).encrypt(secret.encode()).decode()


async def owned_user_connection(db: AsyncSession, connection_id: UUID, user_id: UUID) -> LlmConnection | None:
    """THE user-scope ownership predicate."""
    return (
        await db.execute(
            select(LlmConnection).where(
                LlmConnection.id == connection_id,
                LlmConnection.scope == "user",
                LlmConnection.user_id == user_id,
            )
        )
    ).scalar_one_or_none()


async def owned_project_connection(db: AsyncSession, connection_id: UUID, project_id: UUID) -> LlmConnection | None:
    """THE project-scope ownership predicate."""
    return (
        await db.execute(
            select(LlmConnection).where(
                LlmConnection.id == connection_id,
                LlmConnection.scope == "project",
                LlmConnection.project_id == project_id,
            )
        )
    ).scalar_one_or_none()


def _to_read(row: LlmConnection, created_by_name: str | None) -> LlmConnectionRead:
    return LlmConnectionRead.model_validate(
        {
            "id": row.id, "scope": row.scope, "provider": row.provider, "label": row.label,
            "base_url": row.base_url, "has_api_key": row.encrypted_api_key is not None,
            "allowed_models": row.allowed_models,
            "capabilities": LlmEndpointCapabilities.model_validate(row.capabilities or {}),
            "validation_status": row.validation_status, "last_validated_at": row.last_validated_at,
            "last_used_at": row.last_used_at, "created_by_name": created_by_name, "created_at": row.created_at,
        }
    )


def _is_unique_violation(exc: IntegrityError) -> bool:
    orig = getattr(exc, "orig", None)
    text = str(orig or exc)
    return "uq_llm_connections_" in text


class LlmConnectionService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def _reads(self, rows: list[LlmConnection]) -> list[LlmConnectionRead]:
        names = await _profile_names(self.db, {r.created_by for r in rows}) if rows else {}
        return [_to_read(r, names.get(r.created_by)) for r in rows]

    async def list_user(self, user_id: UUID) -> list[LlmConnectionRead]:
        rows = (
            await self.db.execute(
                select(LlmConnection)
                .where(LlmConnection.scope == "user", LlmConnection.user_id == user_id)
                .order_by(LlmConnection.created_at, LlmConnection.id)
            )
        ).scalars().all()
        return await self._reads(list(rows))

    async def list_project(self, project_id: UUID) -> list[LlmConnectionRead]:
        rows = (
            await self.db.execute(
                select(LlmConnection)
                .where(LlmConnection.scope == "project", LlmConnection.project_id == project_id)
                .order_by(LlmConnection.created_at, LlmConnection.id)
            )
        ).scalars().all()
        return await self._reads(list(rows))

    async def _create(
        self, *, scope: str, user_id: UUID | None, project_id: UUID | None, created_by: UUID,
        payload: UserConnectionCreateRequest | ProjectConnectionCreateRequest,
    ) -> LlmConnectionRead:
        base_url = (await validate_endpoint_url(payload.base_url)).url if payload.base_url else None
        connection_id = uuid4()  # BEFORE encrypt: it feeds the per-row key
        row = LlmConnection(
            id=connection_id, scope=scope, user_id=user_id, project_id=project_id,
            provider=payload.provider, label=payload.label, base_url=base_url,
            encrypted_api_key=_encrypt(connection_id, payload.api_key.get_secret_value()) if payload.api_key else None,
            allowed_models=list(payload.allowed_models), capabilities={},
            validation_status="unverified", created_by=created_by,
        )
        self.db.add(row)
        try:
            await self.db.flush()
        except IntegrityError as exc:
            if not _is_unique_violation(exc):
                raise
            raise ValueError(
                f"A {payload.provider} connection labeled {payload.label!r} already exists at this scope"
            ) from None
        return (await self._reads([row]))[0]

    async def create_user(self, *, user_id: UUID, payload: UserConnectionCreateRequest) -> LlmConnectionRead:
        return await self._create(scope="user", user_id=user_id, project_id=None, created_by=user_id, payload=payload)

    async def create_project(self, *, project_id: UUID, created_by: UUID, payload: ProjectConnectionCreateRequest) -> LlmConnectionRead:
        return await self._create(scope="project", user_id=None, project_id=project_id, created_by=created_by, payload=payload)

    async def _update(self, row: LlmConnection | None, payload: LlmConnectionUpdateRequest) -> LlmConnectionRead:
        if row is None:
            raise ConnectionNotFoundError("Connection not found")
        spec = get_provider(row.provider)
        assert spec is not None  # CHECK-backed
        if spec.needs_host:
            if not payload.base_url:
                raise ValueError(f"{row.provider} requires a base_url")
            vetted = (await validate_endpoint_url(payload.base_url)).url
        else:
            if payload.base_url is not None:
                raise ValueError(f"{row.provider} is a hosted provider; no base_url allowed")
            vetted = None
        invalidated = vetted != row.base_url or list(payload.allowed_models) != list(row.allowed_models)
        row.label, row.base_url, row.allowed_models = payload.label, vetted, list(payload.allowed_models)
        if payload.api_key is not None:
            secret = payload.api_key.get_secret_value()
            if secret == "" and not spec.key_optional:
                raise ValueError(f"{row.provider} requires a key; it cannot be cleared")
            row.encrypted_api_key = None if secret == "" else _encrypt(row.id, secret)
        if invalidated:
            row.validation_status, row.capabilities, row.last_validated_at = "unverified", {}, None
        try:
            await self.db.flush()
        except IntegrityError as exc:
            if not _is_unique_violation(exc):
                raise
            raise ValueError(f"A connection labeled {payload.label!r} already exists at this scope") from None
        return (await self._reads([row]))[0]

    async def update_user(self, *, user_id: UUID, connection_id: UUID, payload: LlmConnectionUpdateRequest) -> LlmConnectionRead:
        return await self._update(await owned_user_connection(self.db, connection_id, user_id), payload)

    async def update_project(self, *, project_id: UUID, connection_id: UUID, payload: LlmConnectionUpdateRequest) -> LlmConnectionRead:
        return await self._update(await owned_project_connection(self.db, connection_id, project_id), payload)

    async def _delete(self, row: LlmConnection | None) -> LlmConnectionDeleteResult:
        if row is None:
            raise ConnectionNotFoundError("Connection not found")
        await self.db.delete(row)
        await self.db.flush()
        return LlmConnectionDeleteResult(deleted=True, id=row.id)

    async def delete_user(self, *, user_id: UUID, connection_id: UUID) -> LlmConnectionDeleteResult:
        return await self._delete(await owned_user_connection(self.db, connection_id, user_id))

    async def delete_project(self, *, project_id: UUID, connection_id: UUID) -> LlmConnectionDeleteResult:
        return await self._delete(await owned_project_connection(self.db, connection_id, project_id))

    async def decrypt_key(self, row: LlmConnection) -> str | None:
        if row.encrypted_api_key is None:
            return None
        try:
            return _fernet_for(row.id).decrypt(row.encrypted_api_key.encode()).decode()
        except InvalidToken:
            raise ConnectionUnavailableError(
                f"The stored key for connection {row.id} ({row.label!r}) cannot be decrypted. Re-enter the key."
            ) from None


```

The two `owned_*` functions are the only `id`-bound predicates on `LlmConnection` in the tree; every scoped fetch in this module calls one of them.

- [ ] **Step 4: Run the suites and the gates**

Run: `cd backend && uv run pytest tests/unit/test_llm_connection_schemas.py tests/integration/test_llm_connection_service.py -q && uv run ruff check app tests && uv run ruff format --check app tests`
Expected: all PASS.
Run: `python3 scripts/fitness/check_scope_guards.py`
Expected: `0 new duplicate predicates` (exit 0). If it reports `LlmConnection{id,user_id}` or `{id,project_id}` twice, a second copy slipped in — route it through the guard.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/llm_connection_service.py backend/tests/integration/test_llm_connection_service.py
git commit -m "feat(connections): connection service and ownership guards

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The credential ladder `resolve_provider_key`; parsing key re-homed `[backend]`

**Files:**

- Modify: `backend/app/services/llm_connection_service.py` (append `KeyScope`, `ResolvedKey`, `_scoped_key_row`, `resolve_provider_key`; extend `__all__`)
- Modify: `backend/app/worker/tasks/parsing_tasks.py:55` (import) and `:70-73` (the llama_cloud lookup)
- Modify: `backend/app/services/parser_settings_service.py:8` (docstring wording only: "a llama_cloud connection (user or project scope)")
- Modify: `backend/tests/integration/test_parse_article_file_task.py:32` (import) and `:246-250` (patch target)
- Test: `backend/tests/integration/test_llm_connection_service.py` (append)
- Delete: `backend/tests/integration/test_api_key_llama_cloud.py` (ported here, §7.5)

**Interfaces:**

- Consumes: `LlmConnectionService.decrypt_key`, `LlmConnection` (Task 4), `global_key_for` (registry).
- Produces (`app.services.llm_connection_service`):
  - `class KeyScope(StrEnum)`: `USER_BYOK = "user_byok"`, `PROJECT_SHARED = "project_shared"`, `GLOBAL_SERVICE = "global_service"` (no `shared_endpoint` member: legacy provenance strings are never enum-parsed on read — Task 12 pins that).
  - `class ResolvedKey(NamedTuple)`: `key: str`, `scope: KeyScope`.
  - `async def resolve_provider_key(session: AsyncSession, *, provider: str, project_id: UUID, user_id: UUID) -> ResolvedKey | None` — caller's user-scope key → project's shared key → `global_key_for(provider)`; `None` when nothing has a key.
  - Patch path for tests: `app.services.llm_connection_service.resolve_provider_key` (the worker imports the MODULE and calls the attribute, so a monkeypatch of the module attribute takes effect).

- [ ] **Step 1: Write the failing ladder tests**

Append to `backend/tests/integration/test_llm_connection_service.py` (add `from app.core.config import settings` and extend the service import with `KeyScope`, `ResolvedKey`, `resolve_provider_key`):

```python
@pytest.mark.asyncio
async def test_ladder_user_then_project_then_global(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "sk-global")
    kw = dict(provider="openai", project_id=SEED.primary_project)
    assert await resolve_provider_key(db_session, user_id=SEED.reviewer_profile, **kw) == ResolvedKey(
        "sk-global", KeyScope.GLOBAL_SERVICE
    )
    await _project_key(db_session)
    assert await resolve_provider_key(db_session, user_id=SEED.reviewer_profile, **kw) == ResolvedKey(
        "sk-project", KeyScope.PROJECT_SHARED
    )
    await _user_key(db_session)
    assert await resolve_provider_key(db_session, user_id=SEED.primary_profile, **kw) == ResolvedKey(
        "sk-user", KeyScope.USER_BYOK
    )
    # Per caller: the reviewer has no key of their own and still sees the project's.
    assert (await resolve_provider_key(db_session, user_id=SEED.reviewer_profile, **kw)).scope is KeyScope.PROJECT_SHARED
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", None)
    assert await resolve_provider_key(db_session, provider="anthropic", project_id=SEED.primary_project, user_id=SEED.reviewer_profile) is None


@pytest.mark.asyncio
async def test_llama_cloud_key_resolves_for_parsing(db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch) -> None:
    """Port of test_api_key_llama_cloud.py (§7.5): a user-scope llama_cloud
    connection resolves USER_BYOK; a project-scope one resolves
    PROJECT_SHARED for a member without a key."""
    monkeypatch.setattr(settings, "LLAMA_CLOUD_API_KEY", None)
    await _user_key(db_session, "llama_cloud", "lc-secret")
    assert await resolve_provider_key(
        db_session, provider="llama_cloud", project_id=SEED.primary_project, user_id=SEED.primary_profile
    ) == ResolvedKey("lc-secret", KeyScope.USER_BYOK)
    await _project_key(db_session, "llama_cloud", "lc-shared")
    assert await resolve_provider_key(
        db_session, provider="llama_cloud", project_id=SEED.primary_project, user_id=SEED.reviewer_profile
    ) == ResolvedKey("lc-shared", KeyScope.PROJECT_SHARED)
```

Delete `backend/tests/integration/test_api_key_llama_cloud.py` — its two cases are the last test above.

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && uv run pytest tests/integration/test_llm_connection_service.py -q`
Expected: FAIL — `ImportError: cannot import name 'resolve_provider_key'`.

- [ ] **Step 3: Write the ladder**

Append to `backend/app/services/llm_connection_service.py` (add `from datetime import UTC, datetime`, `from enum import StrEnum`, `from typing import NamedTuple`, and `global_key_for` to the registry import; add `"KeyScope"`, `"ResolvedKey"`, `"resolve_provider_key"` to `__all__`). Place `KeyScope` and `ResolvedKey` above `ConnectionUnavailableError`:

```python
class KeyScope(StrEnum):
    """Whose key paid for a call — recordable in provenance; the key never is."""

    USER_BYOK = "user_byok"
    PROJECT_SHARED = "project_shared"
    GLOBAL_SERVICE = "global_service"


class ResolvedKey(NamedTuple):
    key: str
    scope: KeyScope


```

And at the end of the module:

```python
async def _scoped_key_row(db: AsyncSession, *, provider: str, scope: str, owner_column, owner_id: UUID) -> LlmConnection | None:
    return (
        await db.execute(
            select(LlmConnection).where(
                LlmConnection.scope == scope, owner_column == owner_id, LlmConnection.provider == provider,
                LlmConnection.encrypted_api_key.is_not(None),
            )
        )
    ).scalar_one_or_none()


async def resolve_provider_key(session: AsyncSession, *, provider: str, project_id: UUID, user_id: UUID) -> ResolvedKey | None:
    """THE credential ladder: caller's user-scope key → project's shared key →
    the deployment's global setting. First hit wins; ``None`` when nothing has a key."""
    service = LlmConnectionService(session)
    for scope, column, owner, key_scope in (
        ("user", LlmConnection.user_id, user_id, KeyScope.USER_BYOK),
        ("project", LlmConnection.project_id, project_id, KeyScope.PROJECT_SHARED),
    ):
        row = await _scoped_key_row(session, provider=provider, scope=scope, owner_column=column, owner_id=owner)
        if row is not None:
            key = await service.decrypt_key(row)
            if key:
                row.last_used_at = datetime.now(UTC)
                await session.flush()
                return ResolvedKey(key, key_scope)
    global_key = global_key_for(provider)
    return ResolvedKey(global_key, KeyScope.GLOBAL_SERVICE) if global_key else None
```

`_scoped_key_row` filters `(scope, owner, provider)` without `id`, so the scope-guard gate does not read it as an ownership predicate (a list-shaped query, not a guard).

- [ ] **Step 4: Re-home the parse worker's llama_cloud lookup**

In `backend/app/worker/tasks/parsing_tasks.py` replace the local import at `:55` with `from app.services import llm_connection_service` and the lookup at `:70-73` with:

```python
        # llama_cloud key through the ONE ladder (§3.3): the kicker's own
        # connection, the project's shared connection, then the global
        # setting. Parsing records no LLM provenance, so only the key is used.
        llama_key: str | None = None
        if pref in ("auto", "llamaparse"):
            _resolved = await llm_connection_service.resolve_provider_key(
                session, provider="llama_cloud", project_id=UUID(project_id), user_id=UUID(user_id)
            )
            llama_key = _resolved.key if _resolved is not None else None
```

(`project_id` and `user_id` are the string arguments `_run_parse` already receives — check their names at the top of `_run_parse`; `UUID` is already imported in that module.)

In `backend/tests/integration/test_parse_article_file_task.py` change `:32` to `from app.services.llm_connection_service import KeyScope, ResolvedKey` and the patch at `:246-250` to `patch("app.services.llm_connection_service.resolve_provider_key", key_lookup)`. The existing three cases (key → LlamaParse, no key → PyMuPDF, explicit docling never looks up) keep their assertions; they now prove the worker calls the ladder. The project-scope case (§7.5) is proven by `test_llama_cloud_key_resolves_for_parsing`'s `PROJECT_SHARED` assertion: the worker uses the returned key, whatever its scope.

Update the module docstring line at `backend/app/services/parser_settings_service.py:8` so it names "a `llama_cloud` connection at user or project scope (`llm_connection_service.resolve_provider_key`)" instead of `APIKeyService`.

- [ ] **Step 5: Run the suites**

Run: `cd backend && uv run pytest tests/integration/test_llm_connection_service.py tests/integration/test_parse_article_file_task.py -q && uv run ruff check app tests && uv run ruff format --check app tests`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/llm_connection_service.py backend/app/worker/tasks/parsing_tasks.py backend/app/services/parser_settings_service.py backend/tests/integration/test_llm_connection_service.py backend/tests/integration/test_parse_article_file_task.py
git rm backend/tests/integration/test_api_key_llama_cloud.py
git commit -m "feat(connections): one credential ladder; parsing resolves llama_cloud through it

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Verify — hosted-key probe and the host probe ladder, both scopes `[backend]`

**Files:**

- Create: `backend/app/services/provider_key_probe.py` (ported from `backend/app/services/api_key_service.py:437-520`, the four `_validate_*` methods)
- Modify: `backend/app/services/llm_connection_service.py` (add `verify_user`, `verify_project`, `_verify`)
- Test: `backend/tests/unit/test_provider_key_probe.py` (new), `backend/tests/integration/test_llm_connection_service.py` (append)

**Interfaces:**

- Consumes: `probe_endpoint(*, vetted, api_key, allowed_models) -> LlmEndpointProbeResult` (`app.services.llm_endpoint_probe`, unchanged), `validate_endpoint_url`, `owned_user_connection` / `owned_project_connection`, `LlmConnectionVerifyResult` (Task 3).
- Produces:
  - `app.services.provider_key_probe.probe_hosted_key(provider: str, api_key: str) -> tuple[Literal["ok", "failed"], str | None]` — one cheap authenticated call per hosted provider; `(“failed”, "<reason class>")` on 401/403 or an unknown status, `("ok", None)` on 200/429; a transport exception is `("failed", "unreachable")`, never raised. Key travels in headers, never in the URL.
  - `LlmConnectionService.verify_user(*, user_id, connection_id) -> LlmConnectionVerifyResult`, `verify_project(*, project_id, connection_id)`: host-bearing row → `probe_endpoint` (stores `output_mode` + `models_seen`, pre-fills `allowed_models` with `models_seen` when the stored list is empty); hosted row → `probe_hosted_key`. Persists `validation_status`, `capabilities`, `last_validated_at`. Missing row → `ConnectionNotFoundError`.

- [ ] **Step 1: Write the failing probe tests**

```python
# backend/tests/unit/test_provider_key_probe.py
"""One cheap authenticated call per hosted provider (§4 verify)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.provider_key_probe import probe_hosted_key


def _client_returning(status_code: int, *, method: str) -> MagicMock:
    response = MagicMock()
    response.status_code = status_code
    response.text = ""
    client = MagicMock()
    setattr(client.return_value.__aenter__.return_value, method, AsyncMock(return_value=response))
    return client


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("provider", "method", "status_code", "expected"),
    [
        ("openai", "get", 200, ("ok", None)),
        ("openai", "get", 429, ("ok", None)),
        ("openai", "get", 401, ("failed", "unauthorized")),
        ("anthropic", "post", 200, ("ok", None)),
        ("anthropic", "post", 403, ("failed", "unauthorized")),
        ("google", "get", 400, ("failed", "unauthorized")),
        ("llama_cloud", "get", 500, ("failed", "http_500")),
    ],
)
async def test_status_maps_to_outcome(provider: str, method: str, status_code: int, expected) -> None:
    with patch("httpx.AsyncClient", _client_returning(status_code, method=method)):
        assert await probe_hosted_key(provider, "sk-x") == expected


@pytest.mark.asyncio
async def test_transport_error_is_failed_unreachable_never_raised() -> None:
    client = MagicMock()
    client.return_value.__aenter__.return_value.get = AsyncMock(side_effect=OSError("boom"))
    with patch("httpx.AsyncClient", client):
        assert await probe_hosted_key("openai", "sk-x") == ("failed", "unreachable")


@pytest.mark.asyncio
async def test_key_travels_in_a_header_never_the_url() -> None:
    client = _client_returning(200, method="get")
    with patch("httpx.AsyncClient", client):
        await probe_hosted_key("google", "sk-secret")
    call = client.return_value.__aenter__.return_value.get.call_args
    assert "sk-secret" not in call.args[0] and call.kwargs["headers"]["x-goog-api-key"] == "sk-secret"


@pytest.mark.asyncio
async def test_host_bearing_provider_is_not_probed_here() -> None:
    with pytest.raises(ValueError, match="hosted"):
        await probe_hosted_key("openai_compatible", "k")
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_provider_key_probe.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.provider_key_probe'`.

- [ ] **Step 3: Write the probe**

```python
# backend/app/services/provider_key_probe.py
"""Cheap authenticated call per HOSTED provider (§4 verify).

A transport smoke test, never a quality gate: 200 and 429 are ``ok``
(a rate-limited key is a real key), 401/403 (400 for Google) are
``unauthorized``, anything else is ``http_<status>``, and a transport
error is ``unreachable``. The key travels in a header — httpx embeds the
URL in transport-error text, so a query-string key would leak into logs.
"""

from __future__ import annotations

from typing import Literal

import httpx

from app.core.logging import get_logger
from app.llm.registry import get_provider

logger = get_logger(__name__)

_TIMEOUT_S = 10.0

Outcome = tuple[Literal["ok", "failed"], str | None]


def _outcome(status: int, *, unauthorized: tuple[int, ...]) -> Outcome:
    if status in (200, 429):
        return ("ok", None)
    if status in unauthorized:
        return ("failed", "unauthorized")
    return ("failed", f"http_{status}")


async def probe_hosted_key(provider: str, api_key: str) -> Outcome:
    spec = get_provider(provider)
    if spec is None or spec.needs_host:
        raise ValueError(f"{provider!r} is not a hosted provider")
    try:
        async with httpx.AsyncClient() as client:
            if provider == "openai":
                r = await client.get(
                    "https://api.openai.com/v1/models",
                    headers={"Authorization": f"Bearer {api_key}"},
                    timeout=_TIMEOUT_S,
                )
                return _outcome(r.status_code, unauthorized=(401,))
            if provider == "anthropic":
                r = await client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={
                        "x-api-key": api_key,
                        "anthropic-version": "2023-06-01",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": "claude-3-haiku-20240307",
                        "max_tokens": 1,
                        "messages": [{"role": "user", "content": "hi"}],
                    },
                    timeout=_TIMEOUT_S,
                )
                return _outcome(r.status_code, unauthorized=(401, 403))
            if provider == "google":
                r = await client.get(
                    "https://generativelanguage.googleapis.com/v1/models",
                    headers={"x-goog-api-key": api_key},
                    timeout=_TIMEOUT_S,
                )
                return _outcome(r.status_code, unauthorized=(400, 401, 403))
            if provider == "llama_cloud":
                r = await client.get(
                    "https://api.cloud.llamaindex.ai/api/v1/parsing/supported_file_extensions",
                    headers={"Authorization": f"Bearer {api_key}"},
                    timeout=_TIMEOUT_S,
                )
                return _outcome(r.status_code, unauthorized=(401, 403))
    except Exception:
        # Never echo transport detail (it can embed request data); the log has it.
        logger.warning("provider_key_probe_unreachable", provider=provider, exc_info=True)
        return ("failed", "unreachable")
    raise ValueError(f"{provider!r} has no probe")  # unreachable: every hosted provider is listed
```

- [ ] **Step 4: Write the failing verify tests**

Append to `backend/tests/integration/test_llm_connection_service.py` (add `from app.schemas.llm_endpoint import LlmEndpointProbeResult` and `import app.services.llm_connection_service as connection_module`):

```python
@pytest.mark.asyncio
async def test_verify_hosted_key_persists_the_probe_outcome(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    cid = await _user_key(db_session)
    seen: list[tuple[str, str]] = []

    async def fake_probe(provider: str, api_key: str):
        seen.append((provider, api_key))
        return ("ok", None)

    monkeypatch.setattr(connection_module, "probe_hosted_key", fake_probe)
    result = await LlmConnectionService(db_session).verify_user(user_id=SEED.primary_profile, connection_id=cid)
    assert result.validation_status == "ok" and result.output_mode is None
    assert seen == [("openai", "sk-user")]  # decrypted for the wire, never stored
    read = (await LlmConnectionService(db_session).list_user(SEED.primary_profile))[0]
    assert read.validation_status == "ok" and read.last_validated_at is not None


@pytest.mark.asyncio
async def test_verify_host_runs_the_ladder_and_prefills_allowed_models(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    svc = LlmConnectionService(db_session)
    read = await svc.create_user(
        user_id=SEED.primary_profile,
        payload=UserConnectionCreateRequest(provider="openai_compatible", label="ollama", base_url="https://8.8.8.8/v1"),
    )

    async def fake_ladder(*, vetted, api_key, allowed_models):
        assert vetted.url == "https://8.8.8.8/v1" and api_key is None
        return LlmEndpointProbeResult(validation_status="ok", output_mode="tool", models_seen=["llama3", "qwen3"], error=None)

    monkeypatch.setattr(connection_module, "probe_endpoint", fake_ladder)
    result = await svc.verify_user(user_id=SEED.primary_profile, connection_id=read.id)
    assert (result.validation_status, result.output_mode, result.models_seen) == ("ok", "tool", ["llama3", "qwen3"])
    after = (await svc.list_user(SEED.primary_profile))[0]
    assert after.allowed_models == ["llama3", "qwen3"] and after.capabilities.output_mode == "tool"


@pytest.mark.asyncio
async def test_verify_is_owner_scoped(db_session: AsyncSession) -> None:
    cid = await _project_key(db_session)
    with pytest.raises(ConnectionNotFoundError):
        await LlmConnectionService(db_session).verify_project(project_id=SEED.secondary_project, connection_id=cid)
```

- [ ] **Step 5: Add `verify` to the service**

In `backend/app/services/llm_connection_service.py` add imports `from app.schemas.llm_connection import LlmConnectionVerifyResult`, `from app.services.llm_endpoint_probe import probe_endpoint`, `from app.services.provider_key_probe import probe_hosted_key`, and `from app.schemas.llm_endpoint import LlmEndpointCapabilities` (already there). Add to the class:

```python
    async def _verify(self, row: LlmConnection | None) -> LlmConnectionVerifyResult:
        """Reads before the network call, writes after it, no lock held (the
        LlmEndpointService.verify ordering)."""
        if row is None:
            raise ConnectionNotFoundError("Connection not found")
        api_key = await self.decrypt_key(row)
        if row.base_url is not None:
            vetted = await validate_endpoint_url(row.base_url)  # re-vet the stored URL
            probe = await probe_endpoint(vetted=vetted, api_key=api_key, allowed_models=list(row.allowed_models))
            status, output_mode, models_seen, error = (
                probe.validation_status, probe.output_mode, probe.models_seen, probe.error
            )
            if not row.allowed_models and models_seen:
                row.allowed_models = list(models_seen)
        else:
            assert api_key is not None  # hosted rows always carry a key (schema + CHECK)
            status, error = await probe_hosted_key(row.provider, api_key)
            output_mode, models_seen = None, []
        row.capabilities = LlmEndpointCapabilities(output_mode=output_mode, models_seen=models_seen).model_dump(mode="json")
        row.validation_status = status
        row.last_validated_at = datetime.now(UTC)
        await self.db.flush()
        return LlmConnectionVerifyResult(
            validation_status=status, output_mode=output_mode, models_seen=models_seen, error=error
        )

    async def verify_user(self, *, user_id: UUID, connection_id: UUID) -> LlmConnectionVerifyResult:
        return await self._verify(await owned_user_connection(self.db, connection_id, user_id))

    async def verify_project(self, *, project_id: UUID, connection_id: UUID) -> LlmConnectionVerifyResult:
        return await self._verify(await owned_project_connection(self.db, connection_id, project_id))
```

- [ ] **Step 6: Run the suites**

Run: `cd backend && uv run pytest tests/unit/test_provider_key_probe.py tests/integration/test_llm_connection_service.py -q && uv run ruff check app tests && uv run ruff format --check app tests`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/provider_key_probe.py backend/app/services/llm_connection_service.py backend/tests/unit/test_provider_key_probe.py backend/tests/integration/test_llm_connection_service.py
git commit -m "feat(connections): verify — hosted-key probe and the host probe ladder

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: User connections router — `/me/connections…` and `/me/providers` `[backend]`

**Files:**

- Create: `backend/app/api/v1/endpoints/user_connections.py`
- Modify: `backend/app/api/v1/router.py:9-30` (import) and after the `user_api_keys` block at `:54-58` (mount with `prefix="/me"`, `tags=["me"]`)
- Modify: `frontend/types/api/{openapi.json,schema.d.ts}` via `bash scripts/generate_api_types.sh`
- Test: `backend/tests/unit/test_user_connections_unit.py` (new), `backend/tests/integration/test_user_connections_api.py` (new)

**Interfaces:**

- Consumes: `LlmConnectionService` (Tasks 4, 6), `ConnectionNotFoundError`, the Task 3 schemas, `REGISTRY`, `global_key_for`, `get_current_user_sub` (`app.api.deps.security`), `EndpointUrlError` (`app.core.net_guard`), `limiter`.
- Produces routes (all `ApiResponse[...]`, 401 without a session, any signed-in user):
  - `GET /api/v1/me/connections` → `ApiResponse[list[LlmConnectionRead]]`
  - `POST /api/v1/me/connections` (201) body `UserConnectionCreateRequest` → `ApiResponse[LlmConnectionRead]`; 400 on duplicate label / SSRF rejection; 422 from the schema.
  - `PUT /api/v1/me/connections/{connection_id}` body `LlmConnectionUpdateRequest` → `ApiResponse[LlmConnectionRead]`; 404 when not the caller's.
  - `DELETE /api/v1/me/connections/{connection_id}` → 200 `ApiResponse[LlmConnectionDeleteResult]`.
  - `POST /api/v1/me/connections/{connection_id}/verify` → `ApiResponse[LlmConnectionVerifyResult]`.
  - `GET /api/v1/me/providers` → `ApiResponse[list[ProviderRead]]` (every registry provider, registry order).
  - `list_providers_read() -> list[ProviderRead]` (module function; `global_key_available = global_key_for(id) is not None`).

- [ ] **Step 1: Write the failing integration tests**

```python
# backend/tests/integration/test_user_connections_api.py
"""§4 user scope through the real ASGI app: any member may manage their own
rows, never another user's; §7.5 providers payload."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.core.config import settings
from app.llm.registry import REGISTRY
from tests.integration.helpers import engine_setup

client_as_manager = engine_setup.client_as_manager
client_as_reviewer = engine_setup.client_as_reviewer

_BASE = "/api/v1/me/connections"
_OPENAI = {"provider": "openai", "label": "mine", "api_key": "sk-user-secret"}


@pytest.mark.asyncio
async def test_create_list_update_delete_own_rows(client_as_reviewer: AsyncClient) -> None:
    created = await client_as_reviewer.post(_BASE, json=_OPENAI)
    assert created.status_code == 201, created.text
    row = created.json()["data"]
    assert row["has_api_key"] is True and "sk-user-secret" not in created.text
    assert (await client_as_reviewer.get(_BASE)).json()["data"][0]["id"] == row["id"]
    updated = await client_as_reviewer.put(f"{_BASE}/{row['id']}", json={"label": "renamed"})
    assert updated.status_code == 200 and updated.json()["data"]["label"] == "renamed"
    deleted = await client_as_reviewer.delete(f"{_BASE}/{row['id']}")
    assert deleted.status_code == 200 and deleted.json()["data"] == {"deleted": True, "id": row["id"]}


@pytest.mark.asyncio
async def test_another_user_cannot_touch_my_row(
    client_as_reviewer: AsyncClient, client_as_manager: AsyncClient
) -> None:
    row = (await client_as_reviewer.post(_BASE, json=_OPENAI)).json()["data"]
    assert (await client_as_manager.put(f"{_BASE}/{row['id']}", json={"label": "x"})).status_code == 404
    assert (await client_as_manager.delete(f"{_BASE}/{row['id']}")).status_code == 404
    assert (await client_as_manager.post(f"{_BASE}/{row['id']}/verify")).status_code == 404
    assert all(r["id"] != row["id"] for r in (await client_as_manager.get(_BASE)).json()["data"])


@pytest.mark.asyncio
async def test_422_echo_never_carries_the_secret(client_as_reviewer: AsyncClient) -> None:
    r = await client_as_reviewer.post(_BASE, json={"provider": "grok", "label": "x", "api_key": "sk-leak"})
    assert r.status_code == 422 and "sk-leak" not in r.text


@pytest.mark.asyncio
async def test_providers_payload_has_exactly_the_spec_fields(
    client_as_reviewer: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", None)
    rows = (await client_as_reviewer.get("/api/v1/me/providers")).json()["data"]
    assert [r["id"] for r in rows] == [s.id for s in REGISTRY]
    assert all(
        set(r) == {"id", "label", "description", "docs_url", "needs_host", "key_optional", "scopes", "global_key_available"}
        for r in rows
    )
    by_id = {r["id"]: r for r in rows}
    assert by_id["openai_compatible"]["scopes"] == ["user"] and by_id["openai_compatible"]["key_optional"] is True
    assert by_id["anthropic"]["global_key_available"] is False
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-ant-global")
    rows = (await client_as_reviewer.get("/api/v1/me/providers")).json()["data"]
    assert {r["id"]: r for r in rows}["anthropic"]["global_key_available"] is True
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && uv run pytest tests/integration/test_user_connections_api.py -q`
Expected: FAIL — every request returns 404 (no route).

- [ ] **Step 3: Write the router**

```python
# backend/app/api/v1/endpoints/user_connections.py
"""User-scope connections and the registry read (§4), mounted at ``/me``.

Auth + service call + error mapping + envelope, nothing else. Every row
is bound to the caller inside the service's WHERE clause
(``owned_user_connection``): a foreign id is a 404, never a leak.
``ConnectionUnavailableError`` (AppError) propagates to the typed 409.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.deps.security import get_current_user_sub
from app.core.deps import DbSession
from app.core.net_guard import EndpointUrlError
from app.llm.registry import REGISTRY, global_key_for
from app.schemas.common import ApiResponse
from app.schemas.llm_connection import (
    LlmConnectionDeleteResult,
    LlmConnectionRead,
    LlmConnectionUpdateRequest,
    LlmConnectionVerifyResult,
    ProviderRead,
    UserConnectionCreateRequest,
)
from app.services.llm_connection_service import ConnectionNotFoundError, LlmConnectionService
from app.utils.rate_limiter import limiter

router = APIRouter()


def list_providers_read() -> list[ProviderRead]:
    return [
        ProviderRead(
            id=spec.id,
            label=spec.label,
            description=spec.description,
            docs_url=spec.docs_url,
            needs_host=spec.needs_host,
            key_optional=spec.key_optional,
            scopes=sorted(spec.scopes),
            global_key_available=global_key_for(spec.id) is not None,
        )
        for spec in REGISTRY
    ]


@router.get("/providers", response_model=ApiResponse[list[ProviderRead]])
@limiter.limit("60/minute")
async def list_providers(
    request: Request, _user: UUID = Depends(get_current_user_sub)
) -> ApiResponse[list[ProviderRead]]:
    return ApiResponse.success(list_providers_read(), trace_id=getattr(request.state, "trace_id", None))


@router.get("/connections", response_model=ApiResponse[list[LlmConnectionRead]])
@limiter.limit("60/minute")
async def list_my_connections(
    request: Request, db: DbSession, user_id: UUID = Depends(get_current_user_sub)
) -> ApiResponse[list[LlmConnectionRead]]:
    data = await LlmConnectionService(db).list_user(user_id)
    return ApiResponse.success(data, trace_id=getattr(request.state, "trace_id", None))


@router.post(
    "/connections", response_model=ApiResponse[LlmConnectionRead], status_code=status.HTTP_201_CREATED
)
@limiter.limit("20/minute")
async def create_my_connection(
    body: UserConnectionCreateRequest,
    request: Request,
    db: DbSession,
    user_id: UUID = Depends(get_current_user_sub),
) -> ApiResponse[LlmConnectionRead]:
    try:
        data = await LlmConnectionService(db).create_user(user_id=user_id, payload=body)
    except (EndpointUrlError, ValueError) as e:  # sanitized URL reason / duplicate label
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(data, trace_id=getattr(request.state, "trace_id", None))


@router.put("/connections/{connection_id}", response_model=ApiResponse[LlmConnectionRead])
@limiter.limit("20/minute")
async def update_my_connection(
    connection_id: UUID,
    body: LlmConnectionUpdateRequest,
    request: Request,
    db: DbSession,
    user_id: UUID = Depends(get_current_user_sub),
) -> ApiResponse[LlmConnectionRead]:
    try:
        data = await LlmConnectionService(db).update_user(
            user_id=user_id, connection_id=connection_id, payload=body
        )
    except ConnectionNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    except (EndpointUrlError, ValueError) as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(data, trace_id=getattr(request.state, "trace_id", None))


@router.delete("/connections/{connection_id}", response_model=ApiResponse[LlmConnectionDeleteResult])
@limiter.limit("20/minute")
async def delete_my_connection(
    connection_id: UUID, request: Request, db: DbSession, user_id: UUID = Depends(get_current_user_sub)
) -> ApiResponse[LlmConnectionDeleteResult]:
    try:
        data = await LlmConnectionService(db).delete_user(user_id=user_id, connection_id=connection_id)
    except ConnectionNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(data, trace_id=getattr(request.state, "trace_id", None))


@router.post(
    "/connections/{connection_id}/verify", response_model=ApiResponse[LlmConnectionVerifyResult]
)
@limiter.limit("30/minute")
async def verify_my_connection(
    connection_id: UUID, request: Request, db: DbSession, user_id: UUID = Depends(get_current_user_sub)
) -> ApiResponse[LlmConnectionVerifyResult]:
    try:
        data = await LlmConnectionService(db).verify_user(user_id=user_id, connection_id=connection_id)
    except ConnectionNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    except EndpointUrlError as e:  # the stored URL failed its re-vet
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(data, trace_id=getattr(request.state, "trace_id", None))
```

Mount in `backend/app/api/v1/router.py`: add `user_connections` to the import list and, directly after the `user_api_keys` block, `api_router.include_router(user_connections.router, prefix="/me", tags=["me"])`.

- [ ] **Step 4: Write the unit tests (diff-cover blind spot)**

```python
# backend/tests/unit/test_user_connections_unit.py
"""Direct endpoint-coroutine tests with the service patched in the ENDPOINT
MODULE'S namespace (the test_llm_engine_endpoints_unit pattern)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.user_connections import (
    delete_my_connection,
    list_providers,
    update_my_connection,
)
from app.schemas.llm_connection import LlmConnectionDeleteResult, LlmConnectionUpdateRequest
from app.services.llm_connection_service import ConnectionNotFoundError

_EP = "app.api.v1.endpoints.user_connections"
_delete = getattr(delete_my_connection, "__wrapped__", delete_my_connection)
_update = getattr(update_my_connection, "__wrapped__", update_my_connection)
_providers = getattr(list_providers, "__wrapped__", list_providers)


@pytest.mark.asyncio
async def test_delete_maps_not_found_to_404() -> None:
    service = MagicMock()
    service.delete_user = AsyncMock(side_effect=ConnectionNotFoundError("nope"))
    with patch(f"{_EP}.LlmConnectionService", return_value=service):
        with pytest.raises(HTTPException) as exc:
            await _delete(uuid4(), MagicMock(), AsyncMock(), uuid4())
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_delete_commits_and_wraps_the_typed_result() -> None:
    cid, db = uuid4(), AsyncMock()
    service = MagicMock()
    service.delete_user = AsyncMock(return_value=LlmConnectionDeleteResult(deleted=True, id=cid))
    with patch(f"{_EP}.LlmConnectionService", return_value=service):
        resp = await _delete(cid, MagicMock(), db, uuid4())
    assert resp.ok is True and resp.data.id == cid
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_update_maps_value_error_to_400() -> None:
    service = MagicMock()
    service.update_user = AsyncMock(side_effect=ValueError("already exists"))
    with patch(f"{_EP}.LlmConnectionService", return_value=service):
        with pytest.raises(HTTPException) as exc:
            await _update(uuid4(), LlmConnectionUpdateRequest(label="x"), MagicMock(), AsyncMock(), uuid4())
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_providers_read_is_the_registry() -> None:
    resp = await _providers(MagicMock(), uuid4())
    assert [p.id for p in resp.data] == ["openai", "anthropic", "google", "openai_compatible", "llama_cloud"]
```

- [ ] **Step 5: Run the suites, regenerate the contract**

Run: `cd backend && uv run pytest tests/unit/test_user_connections_unit.py tests/integration/test_user_connections_api.py -q && uv run ruff check app tests && uv run ruff format --check app tests`
Expected: all PASS.
Run: `bash scripts/generate_api_types.sh && npm run typecheck`
Expected: `Generated frontend/types/api/{openapi.json,schema.d.ts}`; tsc clean (additive routes only).

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/v1/endpoints/user_connections.py backend/app/api/v1/router.py backend/tests/unit/test_user_connections_unit.py backend/tests/integration/test_user_connections_api.py frontend/types/api/openapi.json frontend/types/api/schema.d.ts
git commit -m "feat(api): /me/connections and /me/providers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Project connections router — `/projects/{id}/connections…` `[backend]`

**Files:**

- Create: `backend/app/api/v1/endpoints/project_connections.py`
- Modify: `backend/app/api/v1/router.py` (import; mount with `prefix="/projects"`, `tags=["projects"]`, next to the `llm_endpoints` block at `:126-129`)
- Modify: `frontend/types/api/{openapi.json,schema.d.ts}` (regenerate)
- Test: `backend/tests/integration/test_project_connections_api.py` (new), `backend/tests/unit/test_project_connections_unit.py` (new)

**Interfaces:**

- Consumes: `LlmConnectionService.{list_project,create_project,update_project,delete_project,verify_project}`, `ProjectConnectionCreateRequest`, `require_project_manager` (`app.api.deps.security`).
- Produces routes, every one `Depends(require_project_manager)` (outsider and plain member → 403):
  - `GET /api/v1/projects/{project_id}/connections` → `ApiResponse[list[LlmConnectionRead]]`
  - `POST …/connections` (201) body `ProjectConnectionCreateRequest` (host-bearing provider → 422 from the schema)
  - `PUT …/connections/{connection_id}`, `DELETE …/connections/{connection_id}` (200 + `LlmConnectionDeleteResult`), `POST …/connections/{connection_id}/verify` — 404 for a connection of another project.

- [ ] **Step 1: Write the failing integration tests**

```python
# backend/tests/integration/test_project_connections_api.py
"""§4 project scope: manager-gated, project-scoped WHERE guard, hosted
providers only, llama_cloud included (§5 shared keys cover parsing)."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from tests.integration.conftest import SEED
from tests.integration.helpers import engine_setup

client_as_manager = engine_setup.client_as_manager
client_as_reviewer = engine_setup.client_as_reviewer
client_as_outsider = engine_setup.client_as_outsider


def _base(project_id=SEED.primary_project) -> str:
    return f"/api/v1/projects/{project_id}/connections"


@pytest.mark.asyncio
async def test_member_and_outsider_are_403(client_as_reviewer: AsyncClient, client_as_outsider: AsyncClient) -> None:
    body = {"provider": "openai", "label": "shared", "api_key": "sk-shared"}
    assert (await client_as_reviewer.get(_base())).status_code == 403
    assert (await client_as_reviewer.post(_base(), json=body)).status_code == 403
    assert (await client_as_outsider.get(_base())).status_code == 403


@pytest.mark.asyncio
async def test_manager_crud_and_llama_cloud_is_offered(client_as_manager: AsyncClient) -> None:
    created = await client_as_manager.post(_base(), json={"provider": "llama_cloud", "label": "parsing", "api_key": "lc-shared"})
    assert created.status_code == 201, created.text
    row = created.json()["data"]
    assert row["scope"] == "project" and row["has_api_key"] is True and "lc-shared" not in created.text
    assert [r["id"] for r in (await client_as_manager.get(_base())).json()["data"]] == [row["id"]]
    assert (await client_as_manager.delete(f"{_base()}/{row['id']}")).status_code == 200


@pytest.mark.asyncio
async def test_host_bearing_provider_is_422_at_project_scope(client_as_manager: AsyncClient) -> None:
    r = await client_as_manager.post(
        _base(), json={"provider": "openai_compatible", "label": "lab", "base_url": "https://8.8.8.8/v1", "api_key": "k"}
    )
    assert r.status_code == 422 and "k\"" not in r.text


@pytest.mark.asyncio
async def test_row_of_another_project_is_404(client_as_manager: AsyncClient) -> None:
    row = (await client_as_manager.post(_base(), json={"provider": "openai", "label": "s", "api_key": "sk"})).json()["data"]
    # The manager also manages the secondary project (seed graph); the row is not there.
    assert (await client_as_manager.put(f"{_base(SEED.secondary_project)}/{row['id']}", json={"label": "x"})).status_code == 404
    assert (await client_as_manager.delete(f"{_base(SEED.secondary_project)}/{row['id']}")).status_code == 404
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && uv run pytest tests/integration/test_project_connections_api.py -q`
Expected: FAIL — 404 on every route.

- [ ] **Step 3: Write the router**

```python
# backend/app/api/v1/endpoints/project_connections.py
"""Project-scope connections (§4): a project's shared hosted-provider keys.

Manager-only CRUD + verify. Every fetch is project-scoped inside the
service (``owned_project_connection``): a cross-project id is a 404.
Host-bearing providers are refused by ``ProjectConnectionCreateRequest``
(422) — a host is user-owned. ``ConnectionUnavailableError`` propagates
to the AppError handler's typed 409.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.deps.security import require_project_manager
from app.core.deps import DbSession
from app.core.net_guard import EndpointUrlError
from app.schemas.common import ApiResponse
from app.schemas.llm_connection import (
    LlmConnectionDeleteResult,
    LlmConnectionRead,
    LlmConnectionUpdateRequest,
    LlmConnectionVerifyResult,
    ProjectConnectionCreateRequest,
)
from app.services.llm_connection_service import ConnectionNotFoundError, LlmConnectionService
from app.utils.rate_limiter import limiter

router = APIRouter()


def _trace(request: Request) -> str | None:
    return getattr(request.state, "trace_id", None)


@router.get("/{project_id}/connections", response_model=ApiResponse[list[LlmConnectionRead]])
@limiter.limit("60/minute")
async def list_project_connections(
    project_id: UUID, request: Request, db: DbSession, _manager: UUID = Depends(require_project_manager)
) -> ApiResponse[list[LlmConnectionRead]]:
    return ApiResponse.success(await LlmConnectionService(db).list_project(project_id), trace_id=_trace(request))


@router.post(
    "/{project_id}/connections",
    response_model=ApiResponse[LlmConnectionRead],
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("20/minute")
async def create_project_connection(
    project_id: UUID,
    body: ProjectConnectionCreateRequest,
    request: Request,
    db: DbSession,
    manager_id: UUID = Depends(require_project_manager),
) -> ApiResponse[LlmConnectionRead]:
    try:
        data = await LlmConnectionService(db).create_project(
            project_id=project_id, created_by=manager_id, payload=body
        )
    except (EndpointUrlError, ValueError) as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(data, trace_id=_trace(request))


@router.put("/{project_id}/connections/{connection_id}", response_model=ApiResponse[LlmConnectionRead])
@limiter.limit("20/minute")
async def update_project_connection(
    project_id: UUID,
    connection_id: UUID,
    body: LlmConnectionUpdateRequest,
    request: Request,
    db: DbSession,
    _manager: UUID = Depends(require_project_manager),
) -> ApiResponse[LlmConnectionRead]:
    try:
        data = await LlmConnectionService(db).update_project(
            project_id=project_id, connection_id=connection_id, payload=body
        )
    except ConnectionNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    except (EndpointUrlError, ValueError) as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(data, trace_id=_trace(request))


@router.delete(
    "/{project_id}/connections/{connection_id}", response_model=ApiResponse[LlmConnectionDeleteResult]
)
@limiter.limit("20/minute")
async def delete_project_connection(
    project_id: UUID,
    connection_id: UUID,
    request: Request,
    db: DbSession,
    _manager: UUID = Depends(require_project_manager),
) -> ApiResponse[LlmConnectionDeleteResult]:
    try:
        data = await LlmConnectionService(db).delete_project(project_id=project_id, connection_id=connection_id)
    except ConnectionNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(data, trace_id=_trace(request))


@router.post(
    "/{project_id}/connections/{connection_id}/verify",
    response_model=ApiResponse[LlmConnectionVerifyResult],
)
@limiter.limit("30/minute")
async def verify_project_connection(
    project_id: UUID,
    connection_id: UUID,
    request: Request,
    db: DbSession,
    _manager: UUID = Depends(require_project_manager),
) -> ApiResponse[LlmConnectionVerifyResult]:
    try:
        data = await LlmConnectionService(db).verify_project(project_id=project_id, connection_id=connection_id)
    except ConnectionNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    except EndpointUrlError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(data, trace_id=_trace(request))
```

Mount: `api_router.include_router(project_connections.router, prefix="/projects", tags=["projects"])` right after the `llm_endpoints` block.

- [ ] **Step 4: Unit tests**

`backend/tests/unit/test_project_connections_unit.py`: the same three coroutine tests as Task 7 Step 4 (`delete` → 404 on `ConnectionNotFoundError`, `delete` commits and wraps `LlmConnectionDeleteResult`, `update` maps `ValueError` → 400) against `delete_project_connection` / `update_project_connection`, calling them as `await _delete(project_id, connection_id, request, db, manager_id)` with `_EP = "app.api.v1.endpoints.project_connections"`.

- [ ] **Step 5: Run the suites, regenerate the contract**

Run: `cd backend && uv run pytest tests/unit/test_project_connections_unit.py tests/integration/test_project_connections_api.py tests/integration/test_user_connections_api.py -q && uv run ruff check app tests && uv run ruff format --check app tests`
Expected: all PASS.
Run: `bash scripts/generate_api_types.sh && npm run typecheck`
Expected: regenerated; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/v1/endpoints/project_connections.py backend/app/api/v1/router.py backend/tests/unit/test_project_connections_unit.py backend/tests/integration/test_project_connections_api.py frontend/types/api/openapi.json frontend/types/api/schema.d.ts
git commit -m "feat(api): /projects/{id}/connections (manager-gated shared keys)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Frontend connections data layer; parsing toggle reads connections `[frontend]`

**Files:**

- Create: `frontend/services/llmConnectionsService.ts` (read side only — mutations arrive with their consumers in Tasks 10 and 17, so knip `--production` stays at zero after this task)
- Create: `frontend/lib/query-keys/me.ts`; Modify: `frontend/lib/query-keys/index.ts` (re-export `meKeys`), `frontend/lib/query-keys/project.ts:18-21` (add `connections`)
- Create: `frontend/hooks/user/useLlmConnections.ts`, `frontend/hooks/project/useProjectConnections.ts`
- Modify: `frontend/components/project/settings/AdvancedSettingsSection.tsx:24` (import), `:82-101` (the `hasLlamaCloudKey` effect), `:280` (unchanged prop)
- Test: `frontend/test/services/llmConnectionsService.test.ts`, `frontend/test/hooks/useLlmConnections.test.tsx`, `frontend/test/components/AdvancedSettingsSection.test.tsx` (all new)

**Interfaces:**

- Consumes: `components['schemas']['LlmConnectionRead']`, `components['schemas']['ProviderRead']` from `@/types/api/schema` (regenerated in Tasks 7–8); `apiClient`; `toResult`.
- Produces:
  - `frontend/services/llmConnectionsService.ts`: `export type LlmConnectionRead = components['schemas']['LlmConnectionRead']`, `export type ProviderRead = components['schemas']['ProviderRead']`; `fetchMyConnections(): Promise<ErrorResult<LlmConnectionRead[]>>` (GET `/api/v1/me/connections`), `fetchProviders(): Promise<ErrorResult<ProviderRead[]>>` (GET `/api/v1/me/providers`), `fetchProjectConnections(projectId: string): Promise<ErrorResult<LlmConnectionRead[]>>` (GET `/api/v1/projects/${projectId}/connections`).
  - `meKeys = { all: ['me'], connections: () => ['me','connections'], providers: () => ['me','providers'] }`; `projectKeys.connections(projectId)` = `['projects','connections',projectId]`.
  - `useMyConnections()`, `useProviders()` (`frontend/hooks/user/useLlmConnections.ts`); `useProjectConnections(projectId: string | null | undefined)` (`frontend/hooks/project/useProjectConnections.ts`; `enabled: Boolean(projectId)`) — TanStack queries, `staleTime` 5 min, a failed read is the query's error state.

- [ ] **Step 1: Write the failing service test**

```ts
// frontend/test/services/llmConnectionsService.test.ts
import {beforeEach, describe, expect, it, vi} from 'vitest';

const {apiClientMock} = vi.hoisted(() => ({apiClientMock: vi.fn()}));
vi.mock('@/integrations/api/client', () => ({apiClient: apiClientMock}));

import {
  fetchMyConnections,
  fetchProjectConnections,
  fetchProviders,
} from '@/services/llmConnectionsService';

beforeEach(() => vi.clearAllMocks());

describe('llmConnectionsService reads', () => {
  it('GETs the three routes and returns ErrorResult data', async () => {
    apiClientMock.mockResolvedValueOnce([{id: 'c1'}]);
    expect(await fetchMyConnections()).toEqual({ok: true, data: [{id: 'c1'}]});
    expect(apiClientMock).toHaveBeenLastCalledWith('/api/v1/me/connections');

    apiClientMock.mockResolvedValueOnce([{id: 'openai'}]);
    expect((await fetchProviders()).ok).toBe(true);
    expect(apiClientMock).toHaveBeenLastCalledWith('/api/v1/me/providers');

    apiClientMock.mockResolvedValueOnce([]);
    await fetchProjectConnections('p1');
    expect(apiClientMock).toHaveBeenLastCalledWith('/api/v1/projects/p1/connections');
  });

  it('never throws across the boundary', async () => {
    apiClientMock.mockRejectedValueOnce(new Error('boom'));
    const result = await fetchMyConnections();
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run frontend/test/services/llmConnectionsService.test.ts`
Expected: FAIL — `Failed to resolve import "@/services/llmConnectionsService"`.

- [ ] **Step 3: Write the service, keys and hooks**

```ts
// frontend/services/llmConnectionsService.ts
/**
 * AI connections (spec §4): a user's own keys and hosts (`/me/connections`),
 * the registry read (`/me/providers`) and a project's shared keys
 * (`/projects/{id}/connections`). Every call routes through the typed
 * client and returns `ErrorResult<T>` — never throws, never toasts. The
 * read never carries key material (`has_api_key` only).
 */
import {apiClient} from '@/integrations/api/client';
import {toResult, type ErrorResult} from '@/lib/error-utils';
import type {components} from '@/types/api/schema';

export type LlmConnectionRead = components['schemas']['LlmConnectionRead'];
export type ProviderRead = components['schemas']['ProviderRead'];

const ME = '/api/v1/me/connections';
export const projectConnectionsPath = (projectId: string): string =>
  `/api/v1/projects/${projectId}/connections`;

export function fetchMyConnections(): Promise<ErrorResult<LlmConnectionRead[]>> {
  return toResult(() => apiClient<LlmConnectionRead[]>(ME), 'llmConnectionsService.fetchMyConnections');
}

export function fetchProviders(): Promise<ErrorResult<ProviderRead[]>> {
  return toResult(() => apiClient<ProviderRead[]>('/api/v1/me/providers'), 'llmConnectionsService.fetchProviders');
}

export function fetchProjectConnections(projectId: string): Promise<ErrorResult<LlmConnectionRead[]>> {
  return toResult(
    () => apiClient<LlmConnectionRead[]>(projectConnectionsPath(projectId)),
    'llmConnectionsService.fetchProjectConnections',
  );
}
```

`projectConnectionsPath` is consumed by `fetchProjectConnections` in the same module (knip's `ignoreExportsUsedInFile`); Task 17's mutations reuse it — do not mark it `@internal`.

```ts
// frontend/lib/query-keys/me.ts
/** Keys for the signed-in user's own data (connections, providers). */
export const meKeys = {
  all: ['me'] as const,
  connections: () => [...meKeys.all, 'connections'] as const,
  providers: () => [...meKeys.all, 'providers'] as const,
} as const;
```

Add `export { meKeys } from './me';` to `frontend/lib/query-keys/index.ts` and, in `project.ts` after `llmEndpoints`, `connections: (projectId: string) => [...projectKeys.all, 'connections', projectId] as const,`.

```ts
// frontend/hooks/user/useLlmConnections.ts
/** TanStack reads for the viewer's own connections and the registry (§4). */
import {useQuery} from '@tanstack/react-query';

import {meKeys} from '@/lib/query-keys';
import {
  fetchMyConnections,
  fetchProviders,
  type LlmConnectionRead,
  type ProviderRead,
} from '@/services/llmConnectionsService';

const STALE_MS = 5 * 60_000;

export function useMyConnections() {
  return useQuery({
    queryKey: meKeys.connections(),
    staleTime: STALE_MS,
    queryFn: async (): Promise<LlmConnectionRead[]> => {
      const result = await fetchMyConnections();
      if (!result.ok) throw result.error;
      return result.data;
    },
  });
}

export function useProviders() {
  return useQuery({
    queryKey: meKeys.providers(),
    staleTime: STALE_MS,
    queryFn: async (): Promise<ProviderRead[]> => {
      const result = await fetchProviders();
      if (!result.ok) throw result.error;
      return result.data;
    },
  });
}
```

```ts
// frontend/hooks/project/useProjectConnections.ts
/** The project's shared keys (§4) — manager-gated on the API, so callers
 * pass `null` for a non-manager and the query stays disabled. */
import {useQuery} from '@tanstack/react-query';

import {projectKeys} from '@/lib/query-keys';
import {fetchProjectConnections, type LlmConnectionRead} from '@/services/llmConnectionsService';

const STALE_MS = 5 * 60_000;

export function useProjectConnections(projectId: string | null | undefined) {
  return useQuery({
    queryKey: projectKeys.connections(projectId ?? ''),
    enabled: Boolean(projectId),
    staleTime: STALE_MS,
    queryFn: async (): Promise<LlmConnectionRead[]> => {
      const result = await fetchProjectConnections(projectId!);
      if (!result.ok) throw result.error;
      return result.data;
    },
  });
}
```

- [ ] **Step 4: Write the failing hook and section tests**

```tsx
// frontend/test/hooks/useLlmConnections.test.tsx
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {renderHook, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/services/llmConnectionsService', () => ({
  fetchMyConnections: vi.fn(),
  fetchProviders: vi.fn(),
  fetchProjectConnections: vi.fn(),
}));

import {meKeys, projectKeys} from '@/lib/query-keys';
import {fetchMyConnections, fetchProjectConnections} from '@/services/llmConnectionsService';
import {useMyConnections} from '@/hooks/user/useLlmConnections';
import {useProjectConnections} from '@/hooks/project/useProjectConnections';

function wrapper() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  return ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('connection hooks', () => {
  it('keys come from the factories', () => {
    expect(meKeys.connections()).toEqual(['me', 'connections']);
    expect(projectKeys.connections('p1')).toEqual(['projects', 'connections', 'p1']);
  });

  it('a failed read is the query error state', async () => {
    vi.mocked(fetchMyConnections).mockResolvedValue({ok: false, error: new Error('x')});
    const {result} = renderHook(() => useMyConnections(), {wrapper: wrapper()});
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('project connections stay disabled without a project id', () => {
    const {result} = renderHook(() => useProjectConnections(null), {wrapper: wrapper()});
    expect(result.current.fetchStatus).toBe('idle');
    expect(fetchProjectConnections).not.toHaveBeenCalled();
  });
});
```

```tsx
// frontend/test/components/AdvancedSettingsSection.test.tsx
/** §7.5: `hasLlamaCloudKey` is true from a project-scope row when the viewer
 * is a manager and from a user-scope row otherwise. */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, waitFor} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/services/llmConnectionsService', () => ({
  fetchMyConnections: vi.fn(),
  fetchProviders: vi.fn(),
  fetchProjectConnections: vi.fn(),
}));
vi.mock('@/services/projectSettingsService', () => ({deleteProject: vi.fn()}));
vi.mock('@/services/parserSettingsService', () => ({setParserType: vi.fn()}));
vi.mock('react-router', async (importActual) => ({
  ...(await importActual<typeof import('react-router')>()),
  useNavigate: () => vi.fn(),
}));

import {fetchMyConnections, fetchProjectConnections} from '@/services/llmConnectionsService';
import {AdvancedSettingsSection} from '@/components/project/settings/AdvancedSettingsSection';

const LLAMA = {id: 'c1', provider: 'llama_cloud', has_api_key: true} as never;
const PROJECT = {name: 'p', eligibility_criteria: null, study_design: null, review_keywords: [], settings: {}};

function renderSection(isManager: boolean) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  return render(
    <QueryClientProvider client={client}>
      <AdvancedSettingsSection project={PROJECT} onChange={vi.fn()} projectId="p1" isManager={isManager} />
    </QueryClientProvider>,
  );
}

describe('AdvancedSettingsSection — llama_cloud key from connections', () => {
  it('a manager gets the key from the project-scope row', async () => {
    vi.mocked(fetchMyConnections).mockResolvedValue({ok: true, data: []});
    vi.mocked(fetchProjectConnections).mockResolvedValue({ok: true, data: [LLAMA]});
    renderSection(true);
    await waitFor(() => expect(screen.getByRole('switch')).not.toBeDisabled());
  });

  it('a non-manager gets the key from their own row and never reads the project list', async () => {
    vi.mocked(fetchMyConnections).mockResolvedValue({ok: true, data: [LLAMA]});
    vi.mocked(fetchProjectConnections).mockClear();
    renderSection(false);
    await waitFor(() => expect(screen.getByRole('switch')).toBeDisabled()); // disabled={!isManager} still wins
    expect(fetchProjectConnections).not.toHaveBeenCalled();
  });
});
```

The second case pins the read (no project fetch for a non-manager) while the switch stays disabled for the role — the boolean's truth for a non-manager is asserted through the hint text: add `expect(screen.getByText(t('parsing', 'highQualityHint'))).toBeInTheDocument()` with `import {t} from '@/lib/copy'` (the toggle renders `highQualityHint` only when `hasLlamaCloudKey` is true, `HighQualityParsingToggle.tsx:60`).

- [ ] **Step 5: Switch `AdvancedSettingsSection`**

Replace the import at `:24` with `import {useMyConnections} from '@/hooks/user/useLlmConnections';` and `import {useProjectConnections} from '@/hooks/project/useProjectConnections';`; delete the `useState`/`useEffect` block at `:82-101` and derive:

```tsx
  // §2: a llama_cloud connection satisfies parsing — the viewer's own, or
  // (manager only: the API gates the list) the project's shared one.
  const myConnections = useMyConnections();
  const projectConnections = useProjectConnections(isManager ? projectId : null);
  const hasLlamaCloud = (rows: {provider: string; has_api_key: boolean}[] | undefined) =>
    Boolean(rows?.some((c) => c.provider === 'llama_cloud' && c.has_api_key));
  const hasLlamaCloudKey = hasLlamaCloud(myConnections.data) || hasLlamaCloud(projectConnections.data);
```

Drop `useEffect` from the React import if nothing else uses it. The `HighQualityParsingToggle` prop and its test are unchanged.

- [ ] **Step 6: Run the suites and gates**

Run: `npx vitest run frontend/test/services/llmConnectionsService.test.ts frontend/test/hooks/useLlmConnections.test.tsx frontend/test/components/AdvancedSettingsSection.test.tsx frontend/test/components/HighQualityParsingToggle.test.tsx && npm run typecheck && npm run lint && npx knip --no-tag-hints && npx knip --production --no-tag-hints && python3 scripts/fitness/check_react_query_keys.py`
Expected: all PASS; knip 0 findings in both modes.

- [ ] **Step 7: Commit**

```bash
git add frontend/services/llmConnectionsService.ts frontend/lib/query-keys frontend/hooks/user/useLlmConnections.ts frontend/hooks/project/useProjectConnections.ts frontend/components/project/settings/AdvancedSettingsSection.tsx frontend/test/services/llmConnectionsService.test.ts frontend/test/hooks/useLlmConnections.test.tsx frontend/test/components/AdvancedSettingsSection.test.tsx
git commit -m "feat(frontend): connections service, keys and hooks; parsing toggle reads connections

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Integrations → AI connections; retire the API keys section `[frontend]`

**Files:**

- Create: `frontend/components/user/AiConnectionsSection.tsx`, `frontend/lib/copy/llmConnections.ts`
- Modify: `frontend/lib/copy/index.ts:23-24,34,57` (register `llmConnections`), `frontend/services/llmConnectionsService.ts` (add the three user-scope mutations), `frontend/hooks/user/useLlmConnections.ts` (add the three mutation hooks), `frontend/lib/query-keys/project.ts` (add `llmEngines()`), `frontend/components/user/IntegrationsSection.tsx:6,13-18`
- Delete: `frontend/components/user/ApiKeysSection.tsx`, `frontend/services/apiKeysService.ts`, `frontend/services/apiKeysService.test.ts`, `frontend/e2e/flows/settings-api-keys.e2e.ts`
- Modify: `frontend/lib/copy/user.ts:71-73,77-119` (delete `integrationsApiKeys*` and every `apiKeys*` key), `scripts/fitness/check_copy_keys.baseline:121-123` (delete the three `user.ts:apiKeys*` rows)
- Create: `frontend/e2e/flows/settings-connections.e2e.ts`
- Test: `frontend/test/components/AiConnectionsSection.test.tsx` (new)

**Interfaces:**

- Consumes: `useMyConnections`, `useProviders` (Task 9), `components['schemas']['UserConnectionCreateRequest' | 'LlmConnectionVerifyResult' | 'LlmConnectionDeleteResult']`, `SettingsSection` (`@/components/settings`), shadcn `Select`, `Input`, `Label`, `Button`, `Badge`, `Skeleton`, `AlertDialog`, `Tooltip`, `sonner` toast.
- Produces:
  - Service: `createMyConnection(body: UserConnectionCreateRequest): Promise<ErrorResult<LlmConnectionRead>>` (POST `/api/v1/me/connections`), `deleteMyConnection(id: string): Promise<ErrorResult<LlmConnectionDeleteResult>>`, `verifyMyConnection(id: string): Promise<ErrorResult<LlmConnectionVerifyResult>>` (POST `…/{id}/verify`); exported types `UserConnectionCreateRequest`, `LlmConnectionVerifyResult`, `LlmConnectionDeleteResult`.
  - Hooks: `useCreateMyConnection()`, `useDeleteMyConnection()`, `useVerifyMyConnection()` — `useMutation`s that on success invalidate `meKeys.connections()` and `projectKeys.llmEngines()` (a new key changes every project's `availability`).
  - `projectKeys.llmEngines = () => [...projectKeys.all, 'llm-engine'] as const` (prefix of `projectKeys.llmEngine(id)`).
  - `AiConnectionsSection` (no props), mounted by `IntegrationsSection` in place of `ApiKeysSection`.
  - Copy namespace `llmConnections` — this task adds exactly the keys the section references (listed in Step 3); later tasks append theirs.
  - States (§5.3): loading → `Skeleton` rows and the Add button `disabled` until `useProviders` resolves; empty → one line `listEmpty` with the Add button inline; error → `listLoadError` line with a `retry` button (`refetch`); the form stays usable.

- [ ] **Step 1: Write the failing section test**

```tsx
// frontend/test/components/AiConnectionsSection.test.tsx
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {TooltipProvider} from '@/components/ui/tooltip';
import {t} from '@/lib/copy';

vi.mock('@/services/llmConnectionsService', () => ({
  fetchMyConnections: vi.fn(),
  fetchProviders: vi.fn(),
  fetchProjectConnections: vi.fn(),
  createMyConnection: vi.fn(),
  deleteMyConnection: vi.fn(),
  verifyMyConnection: vi.fn(),
}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn()}}));

import * as svc from '@/services/llmConnectionsService';
import {AiConnectionsSection} from '@/components/user/AiConnectionsSection';

const OPENAI = {
  id: 'openai', label: 'OpenAI', description: 'GPT models', docs_url: 'https://platform.openai.com/api-keys',
  needs_host: false, key_optional: false, scopes: ['project', 'user'], global_key_available: true,
};
const HOST = {...OPENAI, id: 'openai_compatible', label: 'Custom host', needs_host: true, key_optional: true, scopes: ['user'], global_key_available: false};
const ROW = {
  id: 'c1', scope: 'user', provider: 'openai', label: 'mine', base_url: null, has_api_key: true,
  allowed_models: [], capabilities: {output_mode: null, models_seen: []}, validation_status: 'unverified',
  last_validated_at: null, last_used_at: null, created_by_name: null, created_at: '2026-09-13T00:00:00Z',
} as never;

function renderSection() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}});
  return render(
    <QueryClientProvider client={client}><TooltipProvider><AiConnectionsSection /></TooltipProvider></QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(svc.fetchProviders).mockResolvedValue({ok: true, data: [OPENAI, HOST] as never});
});

describe('AiConnectionsSection', () => {
  it('renders the empty state with the Add action once providers resolve', async () => {
    vi.mocked(svc.fetchMyConnections).mockResolvedValue({ok: true, data: []});
    renderSection();
    expect(screen.getByRole('button', {name: t('llmConnections', 'addButton')})).toBeDisabled();
    await waitFor(() => expect(screen.getByText(t('llmConnections', 'listEmpty'))).toBeInTheDocument());
    expect(screen.getByRole('button', {name: t('llmConnections', 'addButton')})).not.toBeDisabled();
  });

  it('renders the load-error line with a retry that refetches', async () => {
    vi.mocked(svc.fetchMyConnections).mockResolvedValueOnce({ok: false, error: new Error('x')}).mockResolvedValue({ok: true, data: [ROW]});
    renderSection();
    await waitFor(() => expect(screen.getByText(t('llmConnections', 'listLoadError'))).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', {name: t('llmConnections', 'retry')}));
    await waitFor(() => expect(screen.getByText('mine')).toBeInTheDocument());
  });

  it('the host field appears only for a host-bearing provider and the add posts', async () => {
    vi.mocked(svc.fetchMyConnections).mockResolvedValue({ok: true, data: []});
    vi.mocked(svc.createMyConnection).mockResolvedValue({ok: true, data: ROW});
    renderSection();
    await waitFor(() => expect(screen.getByRole('button', {name: t('llmConnections', 'addButton')})).not.toBeDisabled());
    await userEvent.click(screen.getByRole('button', {name: t('llmConnections', 'addButton')}));
    expect(screen.queryByLabelText(t('llmConnections', 'hostLabel'))).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(t('llmConnections', 'labelLabel')), 'mine');
    await userEvent.type(screen.getByLabelText(t('llmConnections', 'keyLabel')), 'sk-test');
    await userEvent.click(screen.getByRole('button', {name: t('llmConnections', 'saveButton')}));
    await waitFor(() => expect(svc.createMyConnection).toHaveBeenCalledWith({provider: 'openai', label: 'mine', api_key: 'sk-test', base_url: null, allowed_models: []}));
  });

  it('remove confirms then deletes', async () => {
    vi.mocked(svc.fetchMyConnections).mockResolvedValue({ok: true, data: [ROW]});
    vi.mocked(svc.deleteMyConnection).mockResolvedValue({ok: true, data: {deleted: true, id: 'c1'}});
    renderSection();
    await waitFor(() => expect(screen.getByText('mine')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', {name: t('llmConnections', 'removeAria')}));
    await userEvent.click(screen.getByRole('button', {name: t('llmConnections', 'removeConfirm')}));
    await waitFor(() => expect(svc.deleteMyConnection).toHaveBeenCalledWith('c1'));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run frontend/test/components/AiConnectionsSection.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/user/AiConnectionsSection"`.

- [ ] **Step 3: Copy namespace**

```ts
// frontend/lib/copy/llmConnections.ts
/**
 * UI copy for AI connections (spec §5.2): the Integrations list and form,
 * the worklist engine picker, and the project AI engine card. English only.
 */
export const llmConnections = {
    // --- Integrations → AI connections ---
    integrationsTitle: 'AI connections',
    integrationsDescription: 'Your own keys and hosts for AI providers. Encrypted, never shared.',
    listLoading: 'Loading connections…',
    listEmpty: 'No AI connections yet',
    listLoadError: "Couldn't load your connections.",
    retry: 'Retry',
    addButton: 'Add connection',
    providerLabel: 'Provider',
    providerPlaceholder: 'Select provider',
    docsLink: 'How to get a key?',
    keyLabel: 'API key',
    keyPlaceholder: 'sk-…',
    keyOptionalPlaceholder: 'Leave blank for a keyless host',
    hostLabel: 'Base URL',
    hostHint: 'HTTPS only, reachable from the internet.',
    labelLabel: 'Label',
    labelPlaceholder: 'e.g. Personal key',
    saveButton: 'Save connection',
    saving: 'Saving…',
    cancelButton: 'Cancel',
    verifyAria: 'Verify connection',
    removeAria: 'Remove connection',
    removeTitle: 'Remove this connection?',
    removeDescription: 'The stored key is destroyed. Any run pinned to this connection stops working.',
    removeConfirm: 'Remove',
    statusUnverified: 'Unverified',
    statusOk: 'Verified',
    statusFailed: 'Failed',
    hostTag: 'host',
    globalKeyNote: 'prumo provides a key for this provider; add your own to run on it instead.',
    createSuccess: 'Connection added.',
    createError: 'Failed to add the connection',
    removeSuccess: 'Connection removed.',
    removeError: 'Failed to remove the connection',
    verifySuccess: 'Connection verified.',
    verifyFailed: 'Verification failed: {{reason}}',
    verifyError: 'Failed to verify the connection',
} as const;
```

Register it in `frontend/lib/copy/index.ts`: `import {llmConnections} from './llmConnections';`, add to the named `export {…}` list and to the `copy` object (next to `llmEngine`).

- [ ] **Step 4: Mutations and hooks**

Append to `frontend/services/llmConnectionsService.ts`:

```ts
export type UserConnectionCreateRequest = components['schemas']['UserConnectionCreateRequest'];
export type LlmConnectionVerifyResult = components['schemas']['LlmConnectionVerifyResult'];
export type LlmConnectionDeleteResult = components['schemas']['LlmConnectionDeleteResult'];

export function createMyConnection(body: UserConnectionCreateRequest): Promise<ErrorResult<LlmConnectionRead>> {
  return toResult(() => apiClient<LlmConnectionRead>(ME, {method: 'POST', body}), 'llmConnectionsService.createMyConnection');
}

export function deleteMyConnection(id: string): Promise<ErrorResult<LlmConnectionDeleteResult>> {
  return toResult(() => apiClient<LlmConnectionDeleteResult>(`${ME}/${id}`, {method: 'DELETE'}), 'llmConnectionsService.deleteMyConnection');
}

export function verifyMyConnection(id: string): Promise<ErrorResult<LlmConnectionVerifyResult>> {
  return toResult(() => apiClient<LlmConnectionVerifyResult>(`${ME}/${id}/verify`, {method: 'POST'}), 'llmConnectionsService.verifyMyConnection');
}
```

Append to `frontend/hooks/user/useLlmConnections.ts` (import `useMutation`, `useQueryClient`, `projectKeys`, the three service functions and types):

```ts
function useInvalidateMine() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({queryKey: meKeys.connections()});
    // A new or removed credential changes every project's `availability`.
    void queryClient.invalidateQueries({queryKey: projectKeys.llmEngines()});
  };
}

export function useCreateMyConnection() {
  const invalidate = useInvalidateMine();
  return useMutation<LlmConnectionRead, Error, UserConnectionCreateRequest>({
    mutationFn: async (body) => {
      const result = await createMyConnection(body);
      if (!result.ok) throw result.error;
      return result.data;
    },
    onSuccess: invalidate,
  });
}

export function useDeleteMyConnection() {
  const invalidate = useInvalidateMine();
  return useMutation<LlmConnectionDeleteResult, Error, string>({
    mutationFn: async (id) => {
      const result = await deleteMyConnection(id);
      if (!result.ok) throw result.error;
      return result.data;
    },
    onSuccess: invalidate,
  });
}

export function useVerifyMyConnection() {
  const invalidate = useInvalidateMine();
  return useMutation<LlmConnectionVerifyResult, Error, string>({
    mutationFn: async (id) => {
      const result = await verifyMyConnection(id);
      if (!result.ok) throw result.error;
      return result.data;
    },
    onSuccess: invalidate,
  });
}
```

In `frontend/lib/query-keys/project.ts` add `llmEngines: () => [...projectKeys.all, 'llm-engine'] as const,` directly above `llmEngine`.

- [ ] **Step 5: The section**

```tsx
// frontend/components/user/AiConnectionsSection.tsx
/**
 * Me → Settings → Integrations → AI connections (spec §5): every connection
 * the viewer owns — hosted keys and custom hosts — in one list, with one
 * Add form: provider (user-scope providers only), docs link, key, host
 * (only when the provider needs one). Replaces the API keys section.
 */
import {useState} from 'react';
import {ExternalLink, Loader2, Plus, RefreshCw, Trash2} from 'lucide-react';
import {toast} from 'sonner';

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {Skeleton} from '@/components/ui/skeleton';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {
  useCreateMyConnection, useDeleteMyConnection, useMyConnections, useProviders, useVerifyMyConnection,
} from '@/hooks/user/useLlmConnections';
import {t} from '@/lib/copy';
import type {LlmConnectionRead, ProviderRead} from '@/services/llmConnectionsService';

const STATUS_COPY = {
  unverified: 'statusUnverified',
  ok: 'statusOk',
  failed: 'statusFailed',
} as const;

function ConnectionRow({row, provider}: {row: LlmConnectionRead; provider: ProviderRead | undefined}) {
  const verify = useVerifyMyConnection();
  const remove = useDeleteMyConnection();
  const onVerify = () =>
    verify.mutate(row.id, {
      onSuccess: (r) =>
        r.validation_status === 'ok'
          ? toast.success(t('llmConnections', 'verifySuccess'))
          : toast.error(t('llmConnections', 'verifyFailed').replace('{{reason}}', r.error ?? r.validation_status)),
      onError: () => toast.error(t('llmConnections', 'verifyError')),
    });
  const onRemove = () =>
    remove.mutate(row.id, {
      onSuccess: () => toast.success(t('llmConnections', 'removeSuccess')),
      onError: () => toast.error(t('llmConnections', 'removeError')),
    });
  return (
    <li className="flex items-center gap-3 px-2 py-1.5 text-[13px]">
      <span className="font-medium">{row.label}</span>
      <span className="text-muted-foreground">{provider?.label ?? row.provider}</span>
      {row.base_url && <Badge variant="outline">{t('llmConnections', 'hostTag')}</Badge>}
      <Badge variant={row.validation_status === 'ok' ? 'default' : 'secondary'}>
        {t('llmConnections', STATUS_COPY[row.validation_status])}
      </Badge>
      <div className="ml-auto flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t('llmConnections', 'verifyAria')} onClick={onVerify} disabled={verify.isPending}>
              {verify.isPending ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} /> : <RefreshCw className="h-4 w-4" strokeWidth={1.5} />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('llmConnections', 'verifyAria')}</TooltipContent>
        </Tooltip>
        <AlertDialog>
          <Tooltip>
            <TooltipTrigger asChild>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={t('llmConnections', 'removeAria')}>
                  <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                </Button>
              </AlertDialogTrigger>
            </TooltipTrigger>
            <TooltipContent>{t('llmConnections', 'removeAria')}</TooltipContent>
          </Tooltip>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('llmConnections', 'removeTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('llmConnections', 'removeDescription')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('llmConnections', 'cancelButton')}</AlertDialogCancel>
              <AlertDialogAction onClick={onRemove}>{t('llmConnections', 'removeConfirm')}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </li>
  );
}

function AddForm({providers, onDone}: {providers: ProviderRead[]; onDone: () => void}) {
  const create = useCreateMyConnection();
  const [provider, setProvider] = useState(providers[0]?.id ?? '');
  const [label, setLabel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const spec = providers.find((p) => p.id === provider);
  const submit = () =>
    create.mutate(
      {provider, label, api_key: apiKey === '' ? null : apiKey, base_url: spec?.needs_host ? baseUrl : null, allowed_models: []},
      {
        onSuccess: () => { toast.success(t('llmConnections', 'createSuccess')); onDone(); },
        onError: () => toast.error(t('llmConnections', 'createError')),
      },
    );
  return (
    <form className="space-y-3 rounded-md border border-border/40 p-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="space-y-1.5">
        <Label htmlFor="conn-provider" className="text-[13px] font-medium">{t('llmConnections', 'providerLabel')}</Label>
        <Select value={provider} onValueChange={setProvider}>
          <SelectTrigger id="conn-provider" className="h-9 text-[13px]"><SelectValue placeholder={t('llmConnections', 'providerPlaceholder')} /></SelectTrigger>
          <SelectContent>
            {providers.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.label} <span className="text-[12px] text-muted-foreground">({p.description})</span></SelectItem>
            ))}
          </SelectContent>
        </Select>
        {spec?.docs_url && (
          <a href={spec.docs_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[12px] text-primary hover:underline">
            {t('llmConnections', 'docsLink')}<ExternalLink className="h-3 w-3" strokeWidth={1.5} />
          </a>
        )}
        {spec?.global_key_available && <p className="text-[12px] text-muted-foreground">{t('llmConnections', 'globalKeyNote')}</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="conn-label" className="text-[13px] font-medium">{t('llmConnections', 'labelLabel')}</Label>
        <Input id="conn-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('llmConnections', 'labelPlaceholder')} className="h-9 text-[13px]" maxLength={80} />
      </div>
      {spec?.needs_host && (
        <div className="space-y-1.5">
          <Label htmlFor="conn-host" className="text-[13px] font-medium">{t('llmConnections', 'hostLabel')}</Label>
          <Input id="conn-host" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://host/v1" className="h-9 text-[13px]" />
          <p className="text-[12px] text-muted-foreground">{t('llmConnections', 'hostHint')}</p>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="conn-key" className="text-[13px] font-medium">{t('llmConnections', 'keyLabel')}</Label>
        <Input id="conn-key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
          placeholder={spec?.key_optional ? t('llmConnections', 'keyOptionalPlaceholder') : t('llmConnections', 'keyPlaceholder')} className="h-9 text-[13px]" />
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={create.isPending || label === '' || (!spec?.key_optional && apiKey === '') || (Boolean(spec?.needs_host) && baseUrl === '')}>
          {create.isPending ? t('llmConnections', 'saving') : t('llmConnections', 'saveButton')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>{t('llmConnections', 'cancelButton')}</Button>
      </div>
    </form>
  );
}

export function AiConnectionsSection() {
  const connections = useMyConnections();
  const providers = useProviders();
  const [adding, setAdding] = useState(false);
  const userProviders = (providers.data ?? []).filter((p) => p.scopes.includes('user'));
  const addButton = (
    <Button size="sm" onClick={() => setAdding(true)} disabled={!providers.data || adding}>
      <Plus className="mr-1 h-4 w-4" strokeWidth={1.5} />{t('llmConnections', 'addButton')}
    </Button>
  );
  return (
    <div className="space-y-3">
      {connections.isPending && (
        <ul className="space-y-0.5" aria-label={t('llmConnections', 'listLoading')}>
          <li><Skeleton className="h-7 w-full" /></li><li><Skeleton className="h-7 w-full" /></li>
        </ul>
      )}
      {connections.isError && (
        <p className="flex items-center gap-2 text-[13px] text-destructive">
          {t('llmConnections', 'listLoadError')}
          <Button size="sm" variant="ghost" onClick={() => void connections.refetch()}>{t('llmConnections', 'retry')}</Button>
        </p>
      )}
      {connections.data && connections.data.length === 0 && !adding && (
        <p className="flex items-center gap-3 text-[13px] text-muted-foreground">{t('llmConnections', 'listEmpty')}{addButton}</p>
      )}
      {connections.data && connections.data.length > 0 && (
        <ul className="divide-y divide-border/40">
          {connections.data.map((row) => (
            <ConnectionRow key={row.id} row={row} provider={providers.data?.find((p) => p.id === row.provider)} />
          ))}
        </ul>
      )}
      {adding ? <AddForm providers={userProviders} onDone={() => setAdding(false)} /> : (connections.data?.length ?? 0) > 0 || connections.isError || connections.isPending ? addButton : null}
    </div>
  );
}
```

In `IntegrationsSection.tsx` replace the `ApiKeysSection` import and mount with `AiConnectionsSection`, titled `t('llmConnections', 'integrationsTitle')` / `t('llmConnections', 'integrationsDescription')`. Delete `ApiKeysSection.tsx`, `apiKeysService.ts`, `apiKeysService.test.ts`; delete the `integrationsApiKeys*` and `apiKeys*` keys from `frontend/lib/copy/user.ts` and the three `frontend/lib/copy/user.ts:apiKeys*` rows from `scripts/fitness/check_copy_keys.baseline`.

- [ ] **Step 6: Rewrite the settings E2E flow**

Create `frontend/e2e/flows/settings-connections.e2e.ts` (delete `settings-api-keys.e2e.ts`):

```ts
import {expect, test} from '@playwright/test';

import {loginViaUi, resolveAuthToken} from '../_fixtures/auth';
import {authHeaders, parseEnvelope} from '../_fixtures/api';
import {createTraceId, loadE2EEnv, missingEnvKeys} from '../_fixtures/env';

test.describe('Settings and AI connection flows', () => {
  test('opens the Integrations tab with the AI connections section', async ({page}) => {
    const required = missingEnvKeys(['E2E_USER_EMAIL', 'E2E_USER_PASSWORD']);
    test.skip(required.length > 0, `Missing required env: ${required.join(', ')}`);
    const env = loadE2EEnv();
    await loginViaUi(page);
    await page.goto(`${env.frontendUrl}/settings?tab=integrations`);
    await expect(page.getByText('AI connections')).toBeVisible();
  });

  test('lists providers and runs the connection lifecycle', async ({request, page}) => {
    const env = loadE2EEnv();
    const token = await resolveAuthToken(page);
    const traceId = createTraceId('e2e-connections');
    const headers = authHeaders(token, traceId);

    const providers = await request.get(`${env.apiUrl}/api/v1/me/providers`, {headers});
    expect(providers.ok()).toBeTruthy();
    const providersBody = await parseEnvelope<Array<{id: string; scopes: string[]}>>(providers);
    expect(providersBody.data.some((p) => p.id === 'openai')).toBeTruthy();

    const created = await request.post(`${env.apiUrl}/api/v1/me/connections`, {
      headers, data: {provider: 'openai', label: `E2E ${traceId}`, api_key: 'sk-e2e-fake-key-value-1234567890'},
    });
    expect(created.status()).toBe(201);
    const {data: row} = await parseEnvelope<{id: string; has_api_key: boolean}>(created);
    expect(row.has_api_key).toBe(true);

    const list = await request.get(`${env.apiUrl}/api/v1/me/connections`, {headers});
    const listBody = await parseEnvelope<Array<{id: string}>>(list);
    expect(listBody.data.some((c) => c.id === row.id)).toBeTruthy();

    const verify = await request.post(`${env.apiUrl}/api/v1/me/connections/${row.id}/verify`, {headers});
    expect(verify.status()).toBe(200); // a failed probe is a typed `failed`, never an error status

    const deleted = await request.delete(`${env.apiUrl}/api/v1/me/connections/${row.id}`, {headers});
    expect(deleted.ok()).toBeTruthy();
  });
});
```

(`loginViaUi` throws without `E2E_USER_EMAIL`/`E2E_USER_PASSWORD`; the first test skips, the second relies on `resolveAuthToken` exactly as the old flow did.)

- [ ] **Step 7: Run the suites and gates**

Run: `npx vitest run frontend/test/components/AiConnectionsSection.test.tsx frontend/test/components/AdvancedSettingsSection.test.tsx && npm run typecheck && npm run lint && npx knip --no-tag-hints && npx knip --production --no-tag-hints && python3 scripts/fitness/check_copy_keys.py`
Expected: all PASS; knip 0 in both modes; copy-key gate `0 unreferenced keys` (the baseline shrank by three). If the copy gate reports a new unreferenced `llmConnections.ts` key, the section must reference it — do not baseline it.

- [ ] **Step 8: Commit**

```bash
git add frontend/components/user frontend/lib/copy frontend/services/llmConnectionsService.ts frontend/hooks/user/useLlmConnections.ts frontend/lib/query-keys/project.ts frontend/test/components/AiConnectionsSection.test.tsx frontend/e2e/flows/settings-connections.e2e.ts scripts/fitness/check_copy_keys.baseline
git rm frontend/components/user/ApiKeysSection.tsx frontend/services/apiKeysService.ts frontend/services/apiKeysService.test.ts frontend/e2e/flows/settings-api-keys.e2e.ts
git commit -m "feat(frontend): Integrations → AI connections replaces the API keys section

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Retire the engine chip, the Model tab, the endpoints/engine dialogs and their data layer `[frontend]`

The spec's Delivery note groups these removals with the gear task; they are pulled forward as their own task so `npm run typecheck` stays green through Task 12's backend rename (the retiring components are the only consumers of the `endpoint_id` / `alternates` / `byok_only` wire fields that Task 12 removes and Task 14 regenerates).

**Files:**

- Delete: `frontend/components/extraction/{LlmEngineChip,LlmEnginePane,LlmEngineSettingsDialog,LlmEndpointsDialog}.tsx`, `frontend/services/{llmEngineService,llmEndpointService}.ts`, `frontend/hooks/extraction/{useLlmEngine,useLlmEndpoints}.ts`, `frontend/lib/{llmEngineUpdateBody,llmEndpointHost}.ts`, `frontend/lib/copy/llmEngine.ts`
- Delete tests/mocks: `frontend/test/{LlmEngineChip,LlmEngineChip.endpoints,LlmEngineSettingsDialog,LlmEndpointsDialog}.test.tsx`, `frontend/test/hooks/{useLlmEngine,useLlmEndpoints}.test.tsx`, `frontend/test/services/{llmEngineService,llmEngineService.deployWindow,llmEndpointService}.test.ts`, `frontend/test/mocks/{llmEngineRead,llmEndpointRead}.ts`
- Modify: `frontend/components/extraction/ExtractionInterface.tsx:24` (import), `:352-358` (no-template mount + its comment), `:416-427` (`engineSlot` prop); `frontend/components/extraction/TemplateConfigEditor.tsx:52-57`, `:72`, `:330-345` (the `engineSlot` prop and its render fragment); `frontend/components/project/AiConfigDialog.tsx:42,44,81,106,116,147-151,166-177,220,224,247` (`LlmEnginePane`, `AiConfigTab`, `withModel`); `frontend/components/extraction/TemplateInstructionControl.tsx:120` (`withModel` prop); `frontend/lib/copy/index.ts` (drop `llmEngine`); `frontend/lib/query-keys/project.ts:20-21` (drop `llmEndpoints`); `frontend/test/AiConfigDialog.test.tsx:25-27,242,251,261,280`; `scripts/fitness/check_copy_keys.baseline:67` (drop `llmEngine.ts:alternatesAddLabel`); `.claude/rules/frontend.md:59-62` (the `LlmEngineChip` example sentence)

**Interfaces:**

- Consumes: nothing new.
- Produces: `AiConfigTab = 'picots' | 'instruction'` (`AiConfigDialog.tsx`); `AiConfigDialogProps` loses `withModel`; `tabbed = template != null`; `TemplateConfigEditorProps` loses `engineSlot`. `projectKeys.llmEngine(id)` and `projectKeys.llmEngines()` stay (Task 16 reads them; `llmEngines()` is consumed by Task 10's mutations, `llmEngine(id)` by nothing until Task 16 — a key factory member is an object property, not an export, so knip does not see it).

- [ ] **Step 1: Narrow the dialog and its test first (failing test)**

In `frontend/test/AiConfigDialog.test.tsx`: delete the `vi.mock('@/hooks/extraction/useLlmEngine', …)` block at `:25-27`; change both `'model' | 'picots' | 'instruction'` literals (`:242`, `:261`) to `'picots' | 'instruction'`; delete the `withModel` line at `:251`; replace the assertion at `:280` with `expect(screen.queryByRole('tab', {name: /Model/})).not.toBeInTheDocument();` and update the comment above it ("One popup for the project's question and the template's instruction; the engine lives on the worklist gear").

Run: `npx vitest run frontend/test/AiConfigDialog.test.tsx`
Expected: FAIL — the Model tab still renders (`withModel` is still a prop with the tab behind it) and the `useLlmEngine` mock removal makes `LlmEnginePane`'s real hook run against no `QueryClient` data → the tab assertion fails.

- [ ] **Step 2: Drop the Model tab**

In `frontend/components/project/AiConfigDialog.tsx`: remove the `LlmEnginePane` import (`:42`); `export type AiConfigTab = 'picots' | 'instruction';` (`:44`); delete `withModel?: boolean` from `AiConfigDialogProps` (`:81`) and `withModel: boolean` from `AiConfigTabsProps` (`:106`) and the destructure (`:116`); delete the `{withModel && (<TabsTrigger value="model" …/>)}` block (`:147-151`) and the `{withModel && (<TabsContent … value="model" …/>)}` block (`:166-177`); in `AiConfigDialog` delete `withModel = false` (`:220`), set `const tabbed = template != null;` (`:224`), and drop `withModel={withModel}` (`:247`). In `frontend/components/extraction/TemplateInstructionControl.tsx:120` delete the `withModel` line.

Run: `npx vitest run frontend/test/AiConfigDialog.test.tsx frontend/test/components/TemplateInstructionControl.test.tsx`
Expected: PASS.

- [ ] **Step 3: Unmount the chip and the slot**

`frontend/components/extraction/ExtractionInterface.tsx`: delete the import at `:24`, the `{!activeTemplate && <LlmEngineChip projectId={projectId} />}` line and the two comment blocks above it (`:349-358`, the "chip OWNS its flex row" / "rides IN the config bar" comments), and the `engineSlot={…}` prop (`:422-427`); if `renderConfigurationBody`'s comment at `:416` mentions "the engine chip", reword it to "the project-regime chrome row". `frontend/components/extraction/TemplateConfigEditor.tsx`: delete the `engineSlot` prop doc + declaration (`:52-57`), the destructure (`:72`) and the whole `{engineSlot && (<>…</>)}` fragment (`:330-345`, hairline comment included).

- [ ] **Step 4: Delete the retired files and copy**

`git rm` every file under "Delete" above. In `frontend/lib/copy/index.ts` remove the `llmEngine` import, its named export and its `copy` entry. In `frontend/lib/query-keys/project.ts` delete `llmEndpoints`. In `scripts/fitness/check_copy_keys.baseline` delete the `frontend/lib/copy/llmEngine.ts:alternatesAddLabel` row. In `.claude/rules/frontend.md:59-62` replace the parenthetical example with: "and the QA surface's AI-instruction trigger (`TemplateInstructionControl` — the config bar's ONE trigger into `AiConfigDialog`) must read \"General AI instruction1 to customize\"" — keep the sentence's rule, drop the chip example.

- [ ] **Step 5: Run the full frontend gate**

Run: `npm run test:run && npm run typecheck && npm run lint && npx knip --no-tag-hints && npx knip --production --no-tag-hints && python3 scripts/fitness/check_copy_keys.py && python3 scripts/fitness/check_react_query_keys.py`
Expected: all PASS; knip 0 in both modes (if knip names a surviving import of a deleted module, that consumer belongs in the Delete list above — remove it, do not restore the module); copy gate `0 unreferenced keys`.

- [ ] **Step 6: Commit**

```bash
git add -A frontend .claude/rules/frontend.md scripts/fitness/check_copy_keys.baseline
git commit -m "refactor(frontend): retire the engine chip, Model tab, endpoints and engine dialogs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Engine setting shape — `connection_id`, `user_choice_allowed`, no `alternates`, no endpoint branch `[backend]`

**Files:**

- Modify: `backend/app/schemas/llm_engine.py` (whole file: delete `LlmEngineAlternate`, `LlmEngineAlternateRead`, `_drop_garbage_alternates`, every `alternates` field; rename `endpoint_id` → `connection_id`; add `user_choice_allowed`; drop `endpoint_label`)
- Modify: `backend/app/services/llm_engine_service.py:37-53` (imports), `:99-129` (delete `_endpoint_row`, `_endpoint_unhealthy`), `:132-183` (`resolve_project_engine` loses the endpoint branch), `:186-203` (`ResolvedProjectEngine`), `:244-282` (`get_for_project`), `:284-408` (`set_for_project`), `:410-446` (delete `_validate_endpoint_choice`), `:448-517` (`get_engine_read`)
- Modify: `backend/app/api/v1/endpoints/llm_engine.py:54-75` (PUT passes `user_choice_allowed`)
- Modify: `backend/tests/integration/helpers/engine_setup.py:33-37` (imports), `:181-197` (`set_project_engine`), append `make_host_connection` (keep `make_endpoint` and its imports: `test_run_engine_freeze.py` still calls it until Task 13 deletes both)
- Test: `backend/tests/unit/test_llm_engine_schemas.py`, `backend/tests/unit/test_llm_engine_endpoints_unit.py:93-135,163-190`, `backend/tests/integration/test_llm_engine_service.py:121-140,208-395,466-730`, `backend/tests/integration/test_llm_engine_endpoint.py`, `backend/tests/integration/test_llm_engine_kickoff_gate.py:84-107`
- Modify: `frontend/types/api/{openapi.json,schema.d.ts}` (regenerate; Task 11 removed every frontend consumer of the dropped fields)

**Interfaces:**

- Consumes: `LlmConnectionService`, `owned_user_connection` (Task 4), `find_entry`, `selectable_catalog` (Task 1).
- Produces:
  - `LlmEngineStored(provider, model, mode="fast", updated_by=None, updated_at=None, previous_model=None, connection_id: UUID | None = None, user_choice_allowed: bool = True)` — the default never carries a `connection_id`; a legacy payload with `endpoint_id` validates (extra keys ignored) and reads `connection_id is None`.
  - `LlmEngineUpdateRequest(provider, model, mode: Literal["fast","verified"]="fast", user_choice_allowed: bool = True, connection_id: UUID | None = None)` — a non-`None` `connection_id` is a `ValueError` in a `field_validator` (422, spec §6).
  - `LlmEngineService.set_for_project(*, project_id, provider, model, mode, updated_by, user_choice_allowed: bool = True) -> LlmEngineStored`; `provider == "openai_compatible"` or a catalogue miss → `ValueError` (400).
  - `ResolvedProjectEngine(provider, model, mode, source: Literal["project","default"], retired, stored, user_choice_allowed: bool)`.
  - `LlmEngineRead` keeps `provider, model, mode, source, retired, updated_by_name, updated_at, previous_model, catalog (byok_only still on entries until Task 15), availability: dict[str, bool]` and gains `user_choice_allowed: bool`; `alternates`, `endpoint_id`, `endpoint_label` are gone.
  - `engine_setup.set_project_engine(db, provider, model, mode="fast", user_choice_allowed=True)`; `engine_setup.make_host_connection(db, *, user_id=SEED.primary_profile, label="engine-suite-host", base_url="https://8.8.8.8/v1", api_key="sk-engine-suite", allowed_models=None, validation_status="ok", output_mode="tool") -> UUID` (creates through `LlmConnectionService.create_user`, arms the probe state on the row fetched by `owned_user_connection`).

- [ ] **Step 1: Write the failing schema tests**

In `backend/tests/unit/test_llm_engine_schemas.py` delete the alternates tests (`test_stored_alternates_default_empty_for_old_payloads`, `test_stored_alternates_garbage_entry_degrades_entry_not_payload`, `test_update_request_alternates_default_none_keeps`, `test_stored_alternate_with_extra_key_is_dropped_entry_not_payload`, `test_stored_alternate_oversized_field_is_dropped`, `test_request_alternate_with_extra_key_is_refused`, `test_read_alternates_default_empty`) and the four endpoint tests from `:221` on (`test_stored_endpoint_id_*`, `test_update_request_endpoint_id_*`, `test_read_endpoint_scalars_default_none`, `test_read_carries_the_endpoint_scalars`); drop `LlmEngineAlternate` from the import. Append:

```python
def test_stored_legacy_endpoint_id_payload_validates_and_reads_no_connection() -> None:
    """Read tolerance (§3.1): a pre-slice-2 payload carrying ``endpoint_id``
    still validates; the pointer is gone (the table is dropped), so the
    engine reads as a catalogue pair — retired if it named a host."""
    stored = LlmEngineStored.model_validate(
        {"provider": "openai_compatible", "model": "llama3", "endpoint_id": str(uuid4())}
    )
    assert stored.connection_id is None and stored.user_choice_allowed is True


def test_stored_lock_roundtrips_through_its_json_dump() -> None:
    stored = LlmEngineStored(provider="openai", model="gpt-4o-mini", user_choice_allowed=False)
    assert LlmEngineStored.model_validate(stored.model_dump(mode="json")).user_choice_allowed is False


def test_update_request_refuses_a_connection_id() -> None:
    """§6: the default is always a catalogue pair — a set pointer is a 422."""
    with pytest.raises(ValidationError, match="connection_id"):
        LlmEngineUpdateRequest(provider="openai", model="gpt-4o-mini", connection_id=uuid4())


def test_update_request_lock_defaults_open() -> None:
    assert LlmEngineUpdateRequest(provider="openai", model="gpt-4o-mini").user_choice_allowed is True


def test_update_request_refuses_alternates_and_endpoint_id() -> None:
    for extra in ({"alternates": []}, {"endpoint_id": str(uuid4())}):
        with pytest.raises(ValidationError):
            LlmEngineUpdateRequest(provider="openai", model="gpt-4o-mini", **extra)
```

(`uuid4` from `uuid`, `ValidationError` from `pydantic` — add the imports if the file lacks them.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_llm_engine_schemas.py -q`
Expected: FAIL — `connection_id` / `user_choice_allowed` unknown, `alternates` still accepted.

- [ ] **Step 3: Rewrite the schemas**

`backend/app/schemas/llm_engine.py` keeps its module docstring's first three paragraphs (drop the sentence about `alternates` entries) and becomes:

```python
class LlmEngineStored(BaseModel):
    """The persisted project default: identity pair, attribution, lock.

    ``mode`` stays a plain ``str`` on purpose (panel migration B1): reads
    normalize an unknown mode to "fast"; the closed enum is on the write gate.
    ``connection_id`` is always ``None`` for a default (§3.1: the default is
    a catalogue pair) and exists so the field name matches ``LlmTarget``; a
    legacy ``endpoint_id`` key is ignored on read. ``user_choice_allowed``
    is the manager lock (§3.2 step 3): ``False`` binds members to this
    default; managers are never bound.
    """

    provider: str
    model: str
    mode: str = "fast"
    updated_by: UUID | None = None
    updated_at: datetime | None = None
    previous_model: str | None = None
    connection_id: UUID | None = None
    user_choice_allowed: bool = True

    @field_validator("mode", mode="before")
    @classmethod
    def _stringify_garbage_mode(cls, v: Any) -> Any:
        return v if isinstance(v, str) else str(v)


class LlmEngineUpdateRequest(BaseModel):
    """PUT body for the project default (§4). ``extra="forbid"`` blocks
    smuggled keys; ``connection_id`` is accepted only as ``None`` (§6)."""

    model_config = ConfigDict(extra="forbid")

    provider: str
    model: str
    mode: Literal["fast", "verified"] = "fast"
    user_choice_allowed: bool = True
    connection_id: UUID | None = None

    @field_validator("connection_id")
    @classmethod
    def _default_is_a_catalogue_pair(cls, v: UUID | None) -> UUID | None:
        if v is not None:
            raise ValueError("connection_id: the project default is always a catalogue pair")
        return v


class LlmEngineCatalogEntryRead(BaseModel):
    provider: str
    model: str
    canonical: str
    label: str
    best_for: str
    context_window: int
    cost_tier: Literal["$", "$$", "$$$"]
    byok_only: bool


class LlmEngineRead(BaseModel):
    """The member-visible read (reshaped in Task 15 into default/effective)."""

    provider: str
    model: str
    mode: Literal["fast", "verified"]
    source: Literal["project", "default"]
    retired: bool
    user_choice_allowed: bool
    updated_by_name: str | None = None
    updated_at: datetime | None = None
    previous_model: str | None = None
    catalog: list[LlmEngineCatalogEntryRead]
    availability: dict[str, bool]
```

Remove the now-unused `ValidationError`, `Field`, `logger`/`get_logger` imports if nothing references them.

- [ ] **Step 4: Trim the engine service and the router**

`backend/app/services/llm_engine_service.py`: drop the imports of `ProjectLlmEndpoint`, `LlmEndpointCapabilities`, `LlmEngineAlternate`, `LlmEngineAlternateRead`; delete `_endpoint_row`, `_endpoint_unhealthy` and `_validate_endpoint_choice`; in `resolve_project_engine` delete the `if stored.endpoint_id is not None:` branch (a stored `openai_compatible` pair misses the catalogue and raises `EngineRetiredError` as before); `ResolvedProjectEngine` drops `endpoint_id`/`endpoint_label` and gains `user_choice_allowed: bool` (set `True` on the env-default branch, `stored.user_choice_allowed` otherwise); `get_for_project` loses its endpoint branch; `set_for_project` becomes:

```python
    async def set_for_project(
        self,
        *,
        project_id: UUID,
        provider: str,
        model: str,
        mode: Literal["fast", "verified"],
        updated_by: UUID,
        user_choice_allowed: bool = True,
    ) -> LlmEngineStored:
        """Persist the project default (a catalogue pair) and the lock, with
        attribution. ``updated_by`` comes from the auth dependency and
        ``previous_model`` from the stored value — never client-supplied."""
        if provider == "openai_compatible":
            raise ValueError("The project default is a catalogue pair; a host is a per-user engine")
        if find_entry(provider, model) is None:
            raise ValueError(f"Unknown engine {provider}:{model} — not in the server catalogue")
        project = (
            await self.db.execute(
                select(Project)
                .where(Project.id == project_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if project is None:
            raise ProjectNotFoundError(f"Project {project_id} not found")
        previous = _stored_engine(project.settings)
        stored = LlmEngineStored(
            provider=provider,
            model=model,
            mode=mode,
            updated_by=updated_by,
            updated_at=datetime.now(UTC),
            previous_model=previous.model if previous is not None else None,
            user_choice_allowed=user_choice_allowed,
        )
        new_settings = dict(project.settings or {})
        new_settings["llm_engine"] = stored.model_dump(mode="json")
        project.settings = new_settings
        await self.db.flush()
        return stored
```

Keep the row-lock comment block. `get_engine_read` drops `alternates`, `endpoint_id`, `endpoint_label`, `_viewer_is_manager` stays (Task 14 uses it) and the read gains `user_choice_allowed=resolved.user_choice_allowed`. Rewrite the module docstring's endpoint paragraph (`:15-20`) to: "The default is always a catalogue pair (§3.1); per-user engines and hosts live in `user_engine_service` / `llm_connection_service`."

`backend/app/api/v1/endpoints/llm_engine.py` PUT: pass `user_choice_allowed=body.user_choice_allowed` instead of `alternates=`/`endpoint_id=`; update the docstring.

- [ ] **Step 5: Retarget the fixtures and tests**

`engine_setup.py`: drop the `LlmEngineAlternate` import, add `from app.schemas.llm_connection import UserConnectionCreateRequest` and `from app.services.llm_connection_service import LlmConnectionService, owned_user_connection` (keep the `LlmEndpoint*` imports for `make_endpoint` until Task 13); `set_project_engine(db, provider, model, mode="fast", user_choice_allowed=True)` forwards `user_choice_allowed` and loses `alternates` / `endpoint_id`; add beside `make_endpoint`:

```python
async def make_host_connection(
    db: AsyncSession,
    *,
    user_id: UUID = SEED.primary_profile,
    label: str = "engine-suite-host",
    base_url: str = "https://8.8.8.8/v1",
    api_key: str | None = "sk-engine-suite",
    allowed_models: list[str] | None = None,
    validation_status: str = "ok",
    output_mode: str | None = "tool",
) -> UUID:
    """A user-owned host connection in the given probe state (the retired
    ``make_endpoint`` shape): created through the real service, then armed
    directly on the row — the probe itself is the verify suite's contract."""
    read = await LlmConnectionService(db).create_user(
        user_id=user_id,
        payload=UserConnectionCreateRequest(
            provider="openai_compatible",
            label=label,
            base_url=base_url,
            api_key=SecretStr(api_key) if api_key is not None else None,
            allowed_models=allowed_models if allowed_models is not None else ["endpoint-model-x"],
        ),
    )
    row = await owned_user_connection(db, read.id, user_id)
    assert row is not None
    row.validation_status = validation_status
    row.capabilities = {"output_mode": output_mode, "models_seen": []}
    await db.flush()
    return read.id
```

`pin_run` keeps its shape for now (`endpoint_id` → `connection_id` happens with `LlmTarget` in Task 13).

`test_llm_engine_service.py`: delete the seven alternates tests (`:208-395`) and every test from `test_set_endpoint_engine_requires_openai_compatible` (`:466`) to the end of the file; drop the `LlmEngineAlternate` import; in `test_get_engine_read_serves_catalog_and_caller_availability` delete the two `alternates` lines; add:

```python
@pytest.mark.asyncio
async def test_set_refuses_a_host_provider_as_default(db_session: AsyncSession) -> None:
    with pytest.raises(ValueError, match="catalogue pair"):
        await engine_setup.set_project_engine(db_session, "openai_compatible", "llama3")


@pytest.mark.asyncio
async def test_set_persists_the_lock_and_the_read_carries_it(db_session: AsyncSession) -> None:
    await engine_setup.set_project_engine(db_session, "openai", "gpt-5.6-terra", user_choice_allowed=False)
    read = await LlmEngineService(db_session).get_engine_read(SEED.primary_project, SEED.reviewer_profile)
    assert read.user_choice_allowed is False
```

`test_llm_engine_endpoints_unit.py`: in `test_put_writes_named_fields_and_returns_the_fresh_read` build the body as `LlmEngineUpdateRequest(provider="openai", model="gpt-4o", user_choice_allowed=False)` and assert `set_for_project.assert_awaited_once_with(project_id=…, provider="openai", model="gpt-4o", mode="fast", updated_by=manager, user_choice_allowed=False)`; delete `test_put_maps_an_alternates_value_error_to_400`; drop the `LlmEngineAlternate` import; `_read()` gains `user_choice_allowed=True`.

`test_llm_engine_endpoint.py`: append

```python
@pytest.mark.asyncio
async def test_put_with_a_connection_id_is_422(client_as_manager: AsyncClient) -> None:
    r = await client_as_manager.put(
        _url(), json={"provider": "openai", "model": "gpt-5.6-terra", "connection_id": str(uuid4())}
    )
    assert r.status_code == 422
```

(`from uuid import uuid4`.) `test_llm_engine_kickoff_gate.py`: delete `test_kickoff_on_dangling_endpoint_engine_is_typed_409` (`:84-107`; Task 14 adds the user-row equivalent) and the now-unused `text` / `db_session` imports if any.

- [ ] **Step 6: Run the suites, regenerate**

Run: `cd backend && uv run pytest tests/unit/test_llm_engine_schemas.py tests/unit/test_llm_engine_endpoints_unit.py tests/integration/test_llm_engine_service.py tests/integration/test_llm_engine_endpoint.py tests/integration/test_llm_engine_kickoff_gate.py tests/integration/test_llm_endpoint_service.py -q && uv run ruff check app tests && uv run ruff format --check app tests`
Expected: all PASS (the endpoint-service suite still passes: its module is untouched until Task 16).
Run: `bash scripts/generate_api_types.sh && npm run typecheck`
Expected: regenerated; tsc clean.

- [ ] **Step 7: Commit**

```bash
git add backend/app/schemas/llm_engine.py backend/app/services/llm_engine_service.py backend/app/api/v1/endpoints/llm_engine.py backend/tests frontend/types/api
git commit -m "refactor(llm-engine): connection_id + lock on the stored default; alternates and the endpoint branch removed

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: `LlmTarget.connection_id` + `deviation`; one credential path; dead worker entry deleted `[backend]`

**Files:**

- Modify: `backend/app/schemas/llm_target.py:39-50`
- Modify: `backend/app/services/engine_credentials.py` (whole file)
- Modify: `backend/app/services/run_engine_freeze.py:27-28` (TYPE_CHECKING import), `:121-135` (`build_proposal_engine`)
- Modify: `backend/app/services/section_extraction_service.py:152-153` (docstring), `:229` (log field)
- Modify: `backend/app/services/verified_mode.py:34`, `backend/app/services/extraction_errors.py:53,66-71`, `backend/app/services/extraction_proposal_service.py:31` (comment)
- Modify: `backend/app/worker/tasks/extraction_tasks.py:12-28` (imports), `:36-67` (delete `_with_byok_override`), `:81-185` (delete `extract_section_task`)
- Modify: `backend/tests/integration/helpers/engine_setup.py` (`pin_run(connection_id=)`; delete `make_endpoint` and its `LlmEndpoint*` imports)
- Test: `backend/tests/unit/test_engine_credentials.py` (rewrite), `backend/tests/integration/test_run_engine_freeze.py`, `backend/tests/unit/test_run_section_extraction_task.py:49-58,158,200,238,292,333,372,435,515`, `backend/tests/integration/test_worker_eager_mode.py:29,274-468`, `backend/tests/unit/test_extraction_errors.py:38`, `backend/tests/integration/test_extraction_proposal_service.py:485`, `backend/tests/integration/test_suggestion_read.py:2052`, `backend/tests/integration/test_review_context_end_to_end.py:106`

**Interfaces:**

- Consumes: `owned_user_connection`, `LlmConnectionService.decrypt_key`, `resolve_provider_key`, `KeyScope`, `ResolvedKey`, `ConnectionUnavailableError` (Tasks 4–5), `make_host_connection` (Task 12).
- Produces:
  - `LlmTarget(provider, model, mode_requested="fast", mode_executed="fast", connection_id: str | None = None, deviation: bool = False)`; a legacy snapshot with `endpoint_id` validates (`connection_id` reads `None`).
  - `EngineCredentials(api_key, key_scope: KeyScope | None, base_url, connection_id: str | None)`.
  - `resolve_engine_credentials(db, *, user_id: UUID | str, project_id: UUID, engine: LlmTarget) -> EngineCredentials` — `connection_id` set → `owned_user_connection`, missing/foreign/corrupt id/undecryptable → `ConnectionUnavailableError` (409), `key_scope = USER_BYOK`, `base_url` from the row; else `resolve_provider_key(...)` for `engine.provider`.
  - `rekey_for_adopted_engine(...)` unchanged except the identity pair is `(provider, connection_id)`.
  - `build_proposal_engine` records `"connection_id"` (never `endpoint_id`) and `"deviation"`.
  - `extraction_tasks` exports only `run_section_extraction_task` and `batch_extract_sections_task` (whatever the file's other tasks are — the only deletions are `extract_section_task` and `_with_byok_override`); the patch seam `extraction_tasks.resolve_engine_for_run` stays; `extraction_tasks.resolve_project_engine` is gone.
  - `engine_setup.pin_run(db, run, provider, model, mode="fast", connection_id: str | None = None)`.

- [ ] **Step 1: Write the failing credential tests (rewrite the file)**

```python
# backend/tests/unit/test_engine_credentials.py
"""The ONE place an engine turns into credentials (§3.3): a pinned
connection through the owner guard, else the one ladder; never a cloud
fallback for a pinned host."""

from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

import pytest

import app.services.engine_credentials as ec
from app.schemas.llm_target import LlmTarget
from app.services.engine_credentials import (
    EngineCredentials,
    rekey_for_adopted_engine,
    resolve_engine_credentials,
)
from app.services.llm_connection_service import (
    ConnectionUnavailableError,
    KeyScope,
    ResolvedKey,
)

_PROJECT = uuid4()
_USER = uuid4()


def _row(connection_id: UUID, *, base_url: str = "https://8.8.8.8/v1") -> Any:
    row = type("Row", (), {})()
    row.id, row.base_url, row.label, row.encrypted_api_key = connection_id, base_url, "host", "cipher"
    return row


def _stub_guard(monkeypatch: pytest.MonkeyPatch, row: Any | None) -> list[tuple[UUID, UUID]]:
    calls: list[tuple[UUID, UUID]] = []

    async def fake(db: Any, connection_id: UUID, user_id: UUID) -> Any:
        calls.append((connection_id, user_id))
        return row

    monkeypatch.setattr(ec, "owned_user_connection", fake)
    return calls


def _stub_decrypt(monkeypatch: pytest.MonkeyPatch, key: str | None, error: Exception | None = None) -> None:
    class _Service:
        def __init__(self, db: Any) -> None: ...
        async def decrypt_key(self, row: Any) -> str | None:
            if error is not None:
                raise error
            return key

    monkeypatch.setattr(ec, "LlmConnectionService", _Service)


def _stub_ladder(monkeypatch: pytest.MonkeyPatch, resolved: ResolvedKey | None) -> list[str]:
    asked: list[str] = []

    async def fake(session: Any, *, provider: str, project_id: UUID, user_id: UUID) -> ResolvedKey | None:
        asked.append(provider)
        return resolved

    monkeypatch.setattr(ec, "resolve_provider_key", fake)
    return asked


@pytest.mark.asyncio
async def test_pinned_connection_resolves_through_the_owner_guard(monkeypatch: pytest.MonkeyPatch) -> None:
    cid = uuid4()
    calls = _stub_guard(monkeypatch, _row(cid))
    _stub_decrypt(monkeypatch, "sk-host")
    asked = _stub_ladder(monkeypatch, ResolvedKey("cloud", KeyScope.GLOBAL_SERVICE))
    creds = await resolve_engine_credentials(
        object(), user_id=str(_USER), project_id=_PROJECT,
        engine=LlmTarget(provider="openai_compatible", model="llama3", connection_id=str(cid)),
    )
    assert creds == EngineCredentials(api_key="sk-host", key_scope=KeyScope.USER_BYOK, base_url="https://8.8.8.8/v1", connection_id=str(cid))
    assert calls == [(cid, _USER)] and asked == []


@pytest.mark.asyncio
@pytest.mark.parametrize("connection_id", [str(uuid4()), "not-a-uuid"])
async def test_missing_foreign_or_corrupt_pin_is_the_typed_409_never_a_cloud_key(
    monkeypatch: pytest.MonkeyPatch, connection_id: str
) -> None:
    _stub_guard(monkeypatch, None)
    asked = _stub_ladder(monkeypatch, ResolvedKey("cloud", KeyScope.GLOBAL_SERVICE))
    with pytest.raises(ConnectionUnavailableError):
        await resolve_engine_credentials(
            object(), user_id=_USER, project_id=_PROJECT,
            engine=LlmTarget(provider="openai_compatible", model="m", connection_id=connection_id),
        )
    assert asked == []


@pytest.mark.asyncio
async def test_undecryptable_pin_propagates_the_typed_409(monkeypatch: pytest.MonkeyPatch) -> None:
    cid = uuid4()
    _stub_guard(monkeypatch, _row(cid))
    _stub_decrypt(monkeypatch, None, ConnectionUnavailableError("cannot decrypt"))
    with pytest.raises(ConnectionUnavailableError):
        await resolve_engine_credentials(
            object(), user_id=_USER, project_id=_PROJECT,
            engine=LlmTarget(provider="openai_compatible", model="m", connection_id=str(cid)),
        )


@pytest.mark.asyncio
async def test_keyless_host_is_legal(monkeypatch: pytest.MonkeyPatch) -> None:
    cid = uuid4()
    _stub_guard(monkeypatch, _row(cid))
    _stub_decrypt(monkeypatch, None)
    creds = await resolve_engine_credentials(
        object(), user_id=_USER, project_id=_PROJECT,
        engine=LlmTarget(provider="openai_compatible", model="m", connection_id=str(cid)),
    )
    assert creds.api_key is None and creds.key_scope is KeyScope.USER_BYOK and creds.base_url


@pytest.mark.asyncio
async def test_catalogue_engine_walks_the_one_ladder(monkeypatch: pytest.MonkeyPatch) -> None:
    asked = _stub_ladder(monkeypatch, ResolvedKey("sk-shared", KeyScope.PROJECT_SHARED))
    creds = await resolve_engine_credentials(
        object(), user_id=_USER, project_id=_PROJECT, engine=LlmTarget(provider="anthropic", model="m")
    )
    assert creds == EngineCredentials(api_key="sk-shared", key_scope=KeyScope.PROJECT_SHARED, base_url=None, connection_id=None)
    assert asked == ["anthropic"]


@pytest.mark.asyncio
async def test_no_key_anywhere_is_none_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    _stub_ladder(monkeypatch, None)
    creds = await resolve_engine_credentials(
        object(), user_id=_USER, project_id=_PROJECT, engine=LlmTarget(provider="openai", model="m")
    )
    assert creds == EngineCredentials(api_key=None, key_scope=None, base_url=None, connection_id=None)


def test_repr_never_prints_the_key() -> None:
    creds = EngineCredentials(api_key="sk-secret", key_scope=KeyScope.USER_BYOK, base_url=None, connection_id=None)
    assert "sk-secret" not in repr(creds) and "<redacted>" in repr(creds)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("keyed_for", "current_cid", "engine_cid", "expect_rekey"),
    [
        ("openai", None, None, False),
        ("openai", None, "c", True),
        ("openai_compatible", "a", "b", True),
        ("openai_compatible", "a", "a", False),
        (None, None, None, False),
        (None, "a", "a", True),
    ],
)
async def test_rekey_identity_is_provider_plus_connection(
    monkeypatch: pytest.MonkeyPatch, keyed_for: str | None, current_cid: str | None, engine_cid: str | None, expect_rekey: bool
) -> None:
    asked = _stub_ladder(monkeypatch, ResolvedKey("k", KeyScope.USER_BYOK))
    _stub_guard(monkeypatch, _row(uuid4()))
    _stub_decrypt(monkeypatch, "k")
    provider = "openai_compatible" if engine_cid else "openai"
    result = await rekey_for_adopted_engine(
        object(), user_id=_USER, project_id=_PROJECT,
        engine=LlmTarget(provider=provider, model="m", connection_id=engine_cid and str(uuid4())),
        current=EngineCredentials(api_key="old", key_scope=KeyScope.USER_BYOK, base_url=None, connection_id=current_cid),
        keyed_for=keyed_for,
    )
    assert (result is not None) is expect_rekey, asked


def test_legacy_pinned_snapshot_with_endpoint_id_validates() -> None:
    """§7.4 read tolerance: nothing writes ``endpoint_id`` again; old pins read."""
    target = LlmTarget.model_validate({"provider": "openai_compatible", "model": "m", "endpoint_id": "x"})
    assert target.connection_id is None and target.deviation is False
```

The `("openai_compatible", "a", "a", False)` row needs `engine_cid` to equal `current_cid` literally — build the engine with `connection_id=engine_cid` (not a fresh uuid) and use plain strings for `current_cid` / `engine_cid`; adjust the parametrisation to pass the same string in both columns (the guard stub ignores the value).

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_engine_credentials.py -q`
Expected: FAIL — `LlmTarget` has no field `connection_id`; `ec.owned_user_connection` does not exist.

- [ ] **Step 3: Rename the spine and rewrite the resolver**

`backend/app/schemas/llm_target.py:39-50`: replace the `endpoint_id` paragraph and field with:

```python
    ``connection_id`` (§3.1) pins the caller's own host connection an
    ``openai_compatible`` engine runs through — a plain ``str`` so the
    pinned JSONB stays a bag of JSON scalars. ``deviation`` (§3.2) says the
    pinned engine differed from the project default at pin time; computed
    once, never recomputed. Both default so every older snapshot — including
    one carrying the retired ``endpoint_id`` key, which is ignored — keeps
    validating.
    """

    provider: str
    model: str
    mode_requested: str = "fast"
    mode_executed: str = "fast"
    connection_id: str | None = None
    deviation: bool = False
```

`backend/app/services/engine_credentials.py` becomes:

```python
"""The ONE place an engine turns into the credentials it runs on (§3.3).

An :class:`LlmTarget` names WHAT to run; this module answers WITH WHAT —
key, whose key, and (for a host connection) which host. One path:

* ``connection_id`` set — always the caller's own user-scope host, fetched
  through the ONE ownership predicate (``owned_user_connection``, in the
  WHERE clause). Missing, foreign, corrupt id or undecryptable is the typed
  :class:`ConnectionUnavailableError` (409); there is NO cloud fallback.
* otherwise — :func:`resolve_provider_key`, the one ladder (caller's key →
  project's shared key → the deployment's global setting).
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.llm_target import LlmTarget
from app.services.llm_connection_service import (
    ConnectionUnavailableError,
    KeyScope,
    LlmConnectionService,
    owned_user_connection,
    resolve_provider_key,
)

__all__ = ["EngineCredentials", "rekey_for_adopted_engine", "resolve_engine_credentials"]


@dataclass(frozen=True)
class EngineCredentials:
    """What one engine needs at the wire, plus the identity it was resolved
    FOR: ``(provider, connection_id)`` — two hosts share the provider string."""

    api_key: str | None
    key_scope: KeyScope | None
    base_url: str | None
    connection_id: str | None

    def __repr__(self) -> str:
        key = "<redacted>" if self.api_key is not None else "None"
        scope = self.key_scope.value if self.key_scope is not None else None
        return (
            f"EngineCredentials(api_key={key}, key_scope={scope!r}, "
            f"base_url={self.base_url!r}, connection_id={self.connection_id!r})"
        )


def _unavailable(connection_id: str) -> ConnectionUnavailableError:
    return ConnectionUnavailableError(
        f"The engine runs on connection {connection_id}, which is no longer available "
        "to you. Pick another engine, or re-add the connection under Integrations."
    )


async def resolve_engine_credentials(
    db: AsyncSession, *, user_id: UUID | str, project_id: UUID, engine: LlmTarget
) -> EngineCredentials:
    caller = user_id if isinstance(user_id, UUID) else UUID(str(user_id))
    if engine.connection_id is not None:
        try:
            connection_id = UUID(engine.connection_id)
        except ValueError:  # a corrupt pinned id is a typed 409, not a 500
            raise _unavailable(engine.connection_id) from None
        row = await owned_user_connection(db, connection_id, caller)
        if row is None:
            raise _unavailable(engine.connection_id)
        return EngineCredentials(
            api_key=await LlmConnectionService(db).decrypt_key(row),
            key_scope=KeyScope.USER_BYOK,
            base_url=row.base_url,
            connection_id=engine.connection_id,
        )
    resolved = await resolve_provider_key(
        db, provider=engine.provider, project_id=project_id, user_id=caller
    )
    return EngineCredentials(
        api_key=resolved.key if resolved is not None else None,
        key_scope=resolved.scope if resolved is not None else None,
        base_url=None,
        connection_id=None,
    )


async def rekey_for_adopted_engine(
    db: AsyncSession,
    *,
    user_id: UUID | str,
    project_id: UUID,
    engine: LlmTarget,
    current: EngineCredentials,
    keyed_for: str | None,
) -> EngineCredentials | None:
    """Credentials for ``engine`` when ``current`` was resolved for another
    engine — ``None`` when they still fit. The identity is the PAIR
    ``(provider, connection_id)``; ``keyed_for=None`` (direct/legacy callers)
    keeps the injected credentials unless they carry a connection identity,
    which only the engine that settled can vouch for."""
    if keyed_for is None:
        if current.connection_id is None:
            return None
    elif keyed_for == engine.provider and current.connection_id == engine.connection_id:
        return None
    return await resolve_engine_credentials(db, user_id=user_id, project_id=project_id, engine=engine)
```

- [ ] **Step 4: Rename at the other sites; delete the dead worker entry**

- `run_engine_freeze.py:28`: `from app.services.llm_connection_service import KeyScope`; `build_proposal_engine` returns `"connection_id": engine.connection_id, "deviation": engine.deviation` in place of `"endpoint_id"` and its docstring paragraph names `connection_id`.
- `section_extraction_service.py:153` docstring → `connection_id`; `:229` → `connection_id=self._engine.connection_id`.
- `verified_mode.py:34` → `from app.services.llm_connection_service import KeyScope`.
- `extraction_errors.py:53` → `from app.services.llm_connection_service import ConnectionUnavailableError`; the `isinstance` branch at `:66-71` uses it (the comment: "a pinned connection gone / foreign / undecryptable"); the `ExtractionErrorCode.LLM_ENDPOINT_UNAVAILABLE` value is unchanged.
- `extraction_proposal_service.py:31` comment: `provider/model/connection_id/key_scope/mode_requested`.
- `extraction_tasks.py`: delete `extract_section_task` (`:81-185`) and `_with_byok_override` (`:36-67`); delete the imports that only they used (`replace` from `dataclasses`, `KeyScope`, `EngineCredentials`, `resolve_project_engine`) and rewrite the seam comment at `:25-28` to name `extraction_tasks.resolve_engine_for_run` only. Run `cd backend && uv run ruff check app` to catch any other now-unused import.
- `engine_setup.py`: `pin_run(..., connection_id: str | None = None)` passes `connection_id=connection_id` to `LlmTarget`; delete `make_endpoint` and the `LlmEndpointCreateRequest` / `LlmEndpointService` imports.

- [ ] **Step 5: Retarget the integration and task tests**

`test_run_engine_freeze.py`:

- `:44` → `from app.services.llm_connection_service import KeyScope, ResolvedKey`; every `endpoint_id=None` / `"endpoint_id": None` (`:77,277,317,389,422,464,955`) → `connection_id`.
- `test_pinned_endpoint_engine_survives_the_freeze_roundtrip` / `test_old_pinned_snapshot_without_the_endpoint_key_reads_none` (`:211-251`): rename to `..._connection_...`, use `connection_id=_ENDPOINT_ID` (rename the constant `_CONNECTION_ID`) and assert `pinned.connection_id`.
- `_stub_key_service` (`:575-594`) becomes:

```python
def _stub_key_service(monkeypatch: pytest.MonkeyPatch, resolved: ResolvedKey | None) -> list[str]:
    """Patch the RESOLVER's ladder seam; return the providers asked for."""
    asked: list[str] = []

    async def fake(session: Any, *, provider: str, project_id: UUID, user_id: UUID) -> ResolvedKey | None:
        asked.append(provider)
        return resolved

    monkeypatch.setattr(ec, "resolve_provider_key", fake)
    return asked
```

- `_keyed_service(..., connection_id: str | None = None)` builds `EngineCredentials(..., connection_id=connection_id)`.
- The two B9 tests (`:767-902`): replace `engine_setup.make_endpoint(db_session, label=..., base_url=..., api_key=..., allowed_models=[...])` with `engine_setup.make_host_connection(db_session, label=..., base_url=..., api_key=..., allowed_models=[...])`; every `endpoint_id=` → `connection_id=`; the provenance assertion `KeyScope.SHARED_ENDPOINT.value` → `KeyScope.USER_BYOK.value` (a user host runs on its owner's key); rename the tests `test_adoption_across_two_hosts_carries_the_pinned_hosts_key_and_url` and `test_catalog_to_host_adoption_populates_the_base_url`, and the section comment "B9 — the rekey identity is (provider, connection_id)".

`test_run_section_extraction_task.py`: in `engine_seams` (`:49-58`) delete the `resolve_project_engine` monkeypatch (keep `resolve_engine_for_run`); replace each `patch("app.services.engine_credentials.APIKeyService", return_value=fake_api_key)` (`:158,200,238,292,333,372,435,515`) with `patch("app.services.engine_credentials.resolve_provider_key", AsyncMock(return_value=None))` and delete the `fake_api_key = MagicMock(); fake_api_key.get_key_for_provider = AsyncMock(return_value=None)` pairs above them.

`test_worker_eager_mode.py`: delete section 4 and 4b (`:274-468`: `test_extract_section_task_signature_and_kwargs_alignment`, `_endpoint_credentials`, `_catalog_credentials`, `_run_section_task_with`, the two byok tests) and the `KeyScope, ResolvedKey` import (`:29`); keep `_FakeAsyncSession` / `_session_factory_returning` (sections 1–3 use them).

`test_extraction_errors.py:38` → `from app.services.llm_connection_service import ConnectionUnavailableError` (rename the test's local variable; the asserted code stays `LLM_ENDPOINT_UNAVAILABLE`). `test_extraction_proposal_service.py:485`, `test_suggestion_read.py:2052`: `"endpoint_id": None` → `"connection_id": None`. `test_review_context_end_to_end.py:106`: `endpoint_id=None` → `connection_id=None`.

- [ ] **Step 6: Run the suites and the gates**

Run: `cd backend && uv run pytest tests/unit/test_engine_credentials.py tests/unit/test_run_section_extraction_task.py tests/unit/test_extraction_errors.py tests/integration/test_run_engine_freeze.py tests/integration/test_worker_eager_mode.py tests/integration/test_extraction_proposal_service.py tests/integration/test_review_context_end_to_end.py -q && uv run ruff check app tests && uv run ruff format --check app tests && uv run vulture`
Expected: all PASS; no new vulture finding (`_with_byok_override` and the dead task are gone, not baselined).
Run: `python3 scripts/fitness/check_scope_guards.py && python3 scripts/fitness/check_layered_arch.py`
Expected: exit 0 each.

- [ ] **Step 7: Commit**

```bash
git add backend/app backend/tests
git commit -m "refactor(engine): connection_id + deviation on the pinned spine; one credential path; dead worker entry deleted

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Per-user engine rows and `resolve_engine(db, project_id, user_id)` at every call site `[backend]`

**Files:**

- Create: `backend/app/services/user_engine_service.py`
- Modify: `backend/app/services/llm_connection_service.py` (append `availability_map`)
- Modify: `backend/app/services/llm_engine_service.py:55-61` (`__all__`), `:132-183` (`resolve_project_engine` → `resolve_engine`), `:519-530` (`_viewer_is_manager` → module-level `viewer_is_manager`)
- Modify: `backend/app/api/v1/endpoints/section_extraction.py:218`, `backend/app/services/section_extraction_service.py:1734-1736`, `backend/app/services/run_engine_freeze.py:25,74-95`, `backend/app/worker/tasks/extraction_tasks.py` (the `resolve_engine_for_run(...)` call inside `run_section_extraction_task`, today `:253-258`)
- Test: `backend/tests/integration/test_user_engine_service.py` (new), `backend/tests/integration/test_llm_engine_service.py:22,396-460`, `backend/tests/unit/test_run_from_request.py:41`, `backend/tests/unit/test_run_section_extraction_task.py:524-560`, `backend/tests/integration/test_run_engine_freeze.py:1274-1306`, `backend/tests/integration/test_llm_engine_kickoff_gate.py` (append)

**Interfaces:**

- Consumes: `UserProjectEngine` (Task 2), `owned_user_connection`, `LlmConnection` (Task 4), `find_entry`, `_stored_engine`, `_normalized_mode`, `EngineRetiredError`, `LlmTarget` (Task 13), `SEED`, `engine_setup.make_host_connection`.
- Produces:
  - `llm_connection_service.availability_map(session, *, project_id: UUID, user_id: UUID, providers: Iterable[str]) -> dict[str, Literal["user","project","global"] | None]` — the ladder's dry run per provider (no decrypt, no `last_used_at` write); for a host-bearing provider `"user"` when the caller owns at least one connection for it, else `None`.
  - `user_engine_service.EngineLockedError(AppError)` — `code="LLM_ENGINE_LOCKED"`, 403; `user_engine_service.EngineNeedsKeyError(AppError)` — `code="LLM_ENGINE_NEEDS_KEY"`, 422.
  - `get_user_engine(db, *, user_id, project_id) -> UserProjectEngine | None`; `user_row_is_retired(db, row) -> bool` (catalogue miss, or — with a `connection_id` — the caller's connection gone / not `ok` / model not allowed; a nulled pointer on `openai_compatible` is retired); `set_user_engine(db, *, user_id, project_id, provider, model, mode: Literal["fast","verified"], connection_id: UUID | None, is_manager: bool) -> UserProjectEngine` (lock → `EngineLockedError` unless manager; `connection_id` requires `provider == "openai_compatible"`, the caller's own verified connection and an allowed model, else `ValueError`; a catalogue miss is `ValueError`; `availability_map(...)[provider] is None` → `EngineNeedsKeyError`); `clear_user_engine(db, *, user_id, project_id) -> bool`.
  - `llm_engine_service.resolve_engine(db, project_id: UUID, user_id: UUID) -> LlmTarget` (§3.2 order; `deviation` computed against the default at that moment); `resolve_project_engine` is deleted. `viewer_is_manager(db, project_id, viewer_id) -> bool` becomes a module function.
  - `run_engine_freeze.resolve_engine_for_run(db, *, run_id, project_id, repin, user_id: UUID) -> LlmTarget` — the fallback is `resolve_engine(db, project_id, user_id)`.

- [ ] **Step 1: Write the failing service tests**

```python
# backend/tests/integration/test_user_engine_service.py
"""§3.2 resolution order, the lock, deviation, ownership (§7.2, §7.3)."""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.services.llm_connection_service import LlmConnectionService, availability_map
from app.services.llm_engine_service import EngineRetiredError, resolve_engine
from app.services.user_engine_service import (
    EngineLockedError,
    EngineNeedsKeyError,
    clear_user_engine,
    get_user_engine,
    set_user_engine,
)
from tests.integration.conftest import SEED
from tests.integration.helpers import engine_setup

_P = SEED.primary_project


async def _set(db: AsyncSession, user_id, provider="anthropic", model="claude-haiku-4-5", **kw):
    return await set_user_engine(
        db, user_id=user_id, project_id=_P, provider=provider, model=model, mode="fast",
        connection_id=kw.get("connection_id"), is_manager=kw.get("is_manager", False),
    )


@pytest.mark.asyncio
async def test_no_row_resolves_the_project_default_without_deviation(db_session: AsyncSession) -> None:
    await engine_setup.set_project_engine(db_session, "openai", "gpt-5.6-terra")
    target = await resolve_engine(db_session, _P, SEED.reviewer_profile)
    assert (target.provider, target.model, target.deviation) == ("openai", "gpt-5.6-terra", False)


@pytest.mark.asyncio
async def test_user_row_wins_and_is_a_deviation(db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-ant-global")
    await engine_setup.set_project_engine(db_session, "openai", "gpt-5.6-terra")
    await _set(db_session, SEED.reviewer_profile)
    target = await resolve_engine(db_session, _P, SEED.reviewer_profile)
    assert (target.provider, target.model, target.deviation) == ("anthropic", "claude-haiku-4-5", True)
    # Same pair as the default = no deviation.
    await _set(db_session, SEED.reviewer_profile, "openai", "gpt-5.6-terra")
    assert (await resolve_engine(db_session, _P, SEED.reviewer_profile)).deviation is False


@pytest.mark.asyncio
async def test_lock_ignores_a_member_row_but_never_a_manager_row(db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-ant-global")
    await engine_setup.set_project_engine(db_session, "openai", "gpt-5.6-terra")
    await _set(db_session, SEED.reviewer_profile)
    await _set(db_session, SEED.primary_profile, is_manager=True)
    await engine_setup.set_project_engine(db_session, "openai", "gpt-5.6-terra", user_choice_allowed=False)
    assert (await resolve_engine(db_session, _P, SEED.reviewer_profile)).provider == "openai"
    assert (await resolve_engine(db_session, _P, SEED.primary_profile)).provider == "anthropic"
    with pytest.raises(EngineLockedError):
        await _set(db_session, SEED.reviewer_profile)
    await _set(db_session, SEED.primary_profile, is_manager=True)  # managers are never bound


@pytest.mark.asyncio
async def test_row_without_a_credential_is_refused_422(db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", None)
    with pytest.raises(EngineNeedsKeyError):
        await _set(db_session, SEED.reviewer_profile)


@pytest.mark.asyncio
async def test_retired_project_default_blocks_before_the_user_row(db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-ant-global")
    await _set(db_session, SEED.reviewer_profile)
    await engine_setup.set_project_engine(db_session, "openai", "gpt-5.6-terra")
    monkeypatch.setattr(
        "app.services.llm_engine_service.find_entry",
        lambda p, m: None if (p, m) == ("openai", "gpt-5.6-terra") else __import__("app.llm.catalog", fromlist=["find_entry"]).find_entry(p, m),
    )
    with pytest.raises(EngineRetiredError, match="manager"):
        await resolve_engine(db_session, _P, SEED.reviewer_profile)


@pytest.mark.asyncio
async def test_host_row_retires_when_the_connection_is_deleted(db_session: AsyncSession) -> None:
    cid = await engine_setup.make_host_connection(db_session, user_id=SEED.reviewer_profile, label="mine")
    await _set(db_session, SEED.reviewer_profile, "openai_compatible", "endpoint-model-x", connection_id=cid)
    target = await resolve_engine(db_session, _P, SEED.reviewer_profile)
    assert (target.connection_id, target.deviation) == (str(cid), True)
    await LlmConnectionService(db_session).delete_user(user_id=SEED.reviewer_profile, connection_id=cid)
    row = await get_user_engine(db_session, user_id=SEED.reviewer_profile, project_id=_P)
    assert row is not None and row.connection_id is None  # ON DELETE SET NULL
    with pytest.raises(EngineRetiredError, match="[Pp]ick a new model"):
        await resolve_engine(db_session, _P, SEED.reviewer_profile)
    assert await clear_user_engine(db_session, user_id=SEED.reviewer_profile, project_id=_P) is True
    assert (await resolve_engine(db_session, _P, SEED.reviewer_profile)).connection_id is None


@pytest.mark.asyncio
async def test_another_users_connection_is_refused_and_a_bypass_write_is_a_409(db_session: AsyncSession) -> None:
    """§7.3 ownership: never a key for a foreign connection id."""
    cid = await engine_setup.make_host_connection(db_session, user_id=SEED.primary_profile, label="managers")
    with pytest.raises(ValueError, match="connection"):
        await _set(db_session, SEED.reviewer_profile, "openai_compatible", "endpoint-model-x", connection_id=cid)
    row = await _set(db_session, SEED.primary_profile, "openai_compatible", "endpoint-model-x", connection_id=cid, is_manager=True)
    row.user_id = SEED.reviewer_profile  # bypass: re-home the row onto another user
    await db_session.flush()
    with pytest.raises(EngineRetiredError):
        await resolve_engine(db_session, _P, SEED.reviewer_profile)


@pytest.mark.asyncio
async def test_availability_map_is_per_caller(db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "sk-global")
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", None)
    from pydantic import SecretStr
    from app.schemas.llm_connection import ProjectConnectionCreateRequest, UserConnectionCreateRequest
    svc = LlmConnectionService(db_session)
    await svc.create_project(project_id=_P, created_by=SEED.primary_profile, payload=ProjectConnectionCreateRequest(provider="openai", label="s", api_key=SecretStr("k")))
    await svc.create_user(user_id=SEED.primary_profile, payload=UserConnectionCreateRequest(provider="openai", label="m", api_key=SecretStr("k")))
    providers = ("openai", "anthropic", "openai_compatible")
    assert await availability_map(db_session, project_id=_P, user_id=SEED.primary_profile, providers=providers) == {"openai": "user", "anthropic": None, "openai_compatible": None}
    assert (await availability_map(db_session, project_id=_P, user_id=SEED.reviewer_profile, providers=providers))["openai"] == "project"
    await engine_setup.make_host_connection(db_session, user_id=SEED.reviewer_profile, label="h")
    assert (await availability_map(db_session, project_id=_P, user_id=SEED.reviewer_profile, providers=providers))["openai_compatible"] == "user"
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && uv run pytest tests/integration/test_user_engine_service.py -q`
Expected: FAIL — `ImportError: cannot import name 'availability_map'` / no module `app.services.user_engine_service`.

- [ ] **Step 3: `availability_map`**

Append to `backend/app/services/llm_connection_service.py` (add `from collections.abc import Iterable` and `from typing import Literal`):

```python
Availability = Literal["user", "project", "global"] | None


async def availability_map(
    session: AsyncSession, *, project_id: UUID, user_id: UUID, providers: Iterable[str]
) -> dict[str, Availability]:
    """Whose credential a row on each provider would run on, for THIS
    caller — the ladder's dry run (§4). Host-bearing providers: ``"user"``
    when the caller owns a connection for it, else ``None``."""
    rows = (
        await session.execute(
            select(LlmConnection.scope, LlmConnection.provider, LlmConnection.base_url).where(
                ((LlmConnection.scope == "user") & (LlmConnection.user_id == user_id))
                | ((LlmConnection.scope == "project") & (LlmConnection.project_id == project_id)),
                LlmConnection.encrypted_api_key.is_not(None) | LlmConnection.base_url.is_not(None),
            )
        )
    ).all()
    present = {(scope, provider) for scope, provider, _ in rows}
    out: dict[str, Availability] = {}
    for provider in providers:
        spec = get_provider(provider)
        if spec is None:
            out[provider] = None
        elif ("user", provider) in present:
            out[provider] = "user"
        elif not spec.needs_host and ("project", provider) in present:
            out[provider] = "project"
        elif not spec.needs_host and global_key_for(provider) is not None:
            out[provider] = "global"
        else:
            out[provider] = None
    return out
```

- [ ] **Step 4: The user engine service**

```python
# backend/app/services/user_engine_service.py
"""The viewer's own engine for new runs in one project (§3.1, §3.2, §4).

No row = follow the project default. Writes validate exactly what
resolution re-checks (catalogue pair, or the caller's own verified host
through ``owned_user_connection``), so a pick can never lead to a
guaranteed 409 at kickoff; the lock is enforced HERE and in
``resolve_engine``, never in the UI. Imports ``llm_engine_service`` at
module level; that module imports this one lazily (circular import).
"""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_handler import AppError
from app.llm.catalog import find_entry
from app.models.llm_connection import UserProjectEngine
from app.services.llm_connection_service import availability_map, owned_user_connection
from app.services.llm_engine_service import LlmEngineService

__all__ = [
    "EngineLockedError",
    "EngineNeedsKeyError",
    "clear_user_engine",
    "get_user_engine",
    "set_user_engine",
    "user_row_is_retired",
]


class EngineLockedError(AppError):
    def __init__(self) -> None:
        super().__init__(
            code="LLM_ENGINE_LOCKED",
            message="A project manager locked this project to its default engine.",
            status_code=403,
        )


class EngineNeedsKeyError(AppError):
    def __init__(self, provider: str) -> None:
        super().__init__(
            code="LLM_ENGINE_NEEDS_KEY",
            message=(
                f"No credential for {provider}: add your own key under Integrations, ask a "
                "manager for a shared key, or ask the operator to set one."
            ),
            status_code=422,
        )


async def get_user_engine(db: AsyncSession, *, user_id: UUID, project_id: UUID) -> UserProjectEngine | None:
    return await db.get(UserProjectEngine, (user_id, project_id))


async def user_row_is_retired(db: AsyncSession, row: UserProjectEngine) -> bool:
    """Catalogue miss, or a host row whose connection is gone / unverified /
    no longer allows the model (§3.2 step 2). ONE predicate for the write
    gate and for resolution."""
    if row.provider == "openai_compatible":
        if row.connection_id is None:
            return True
        conn = await owned_user_connection(db, row.connection_id, row.user_id)
        return conn is None or conn.validation_status != "ok" or row.model not in (conn.allowed_models or [])
    return find_entry(row.provider, row.model) is None


async def set_user_engine(
    db: AsyncSession,
    *,
    user_id: UUID,
    project_id: UUID,
    provider: str,
    model: str,
    mode: Literal["fast", "verified"],
    connection_id: UUID | None,
    is_manager: bool,
) -> UserProjectEngine:
    default = await LlmEngineService(db).get_for_project(project_id)  # ProjectNotFoundError → 404
    if not default.user_choice_allowed and not is_manager:
        raise EngineLockedError()
    if (connection_id is not None) != (provider == "openai_compatible"):
        raise ValueError("A connection_id is required for, and only for, provider 'openai_compatible'")
    row = UserProjectEngine(
        user_id=user_id, project_id=project_id, provider=provider, model=model,
        connection_id=connection_id, mode=mode,
    )
    if await user_row_is_retired(db, row):
        raise ValueError(
            f"Unknown engine {provider}:{model} — not in the catalogue, or not one of your verified connections"
        )
    if (await availability_map(db, project_id=project_id, user_id=user_id, providers=(provider,)))[provider] is None:
        raise EngineNeedsKeyError(provider)
    merged = await db.merge(row)
    await db.flush()
    return merged


async def clear_user_engine(db: AsyncSession, *, user_id: UUID, project_id: UUID) -> bool:
    row = await get_user_engine(db, user_id=user_id, project_id=project_id)
    if row is None:
        return False
    await db.delete(row)
    await db.flush()
    return True
```

- [ ] **Step 5: `resolve_engine` and the call sites**

In `backend/app/services/llm_engine_service.py` replace `resolve_project_engine` (and its `__all__` entry) with:

```python
async def resolve_engine(db: AsyncSession, project_id: UUID, user_id: UUID) -> LlmTarget:
    """The engine ``user_id``'s next run in ``project_id`` runs on (§3.2).

    1. The project default; retired (catalogue miss) → ``EngineRetiredError``
       (a manager must re-choose).
    2. If the caller may choose (``user_choice_allowed``, or a manager) and a
       ``user_project_engines`` row exists: validate it the same way; retired
       → ``EngineRetiredError`` worded for the user; valid → that engine with
       ``deviation`` computed against the default NOW and never recomputed.
    3. Otherwise the default. The lock is enforced here, not in the UI.
    """
    from app.services.user_engine_service import get_user_engine, user_row_is_retired

    project = await db.get(Project, project_id)
    stored = _stored_engine(project.settings if project is not None else None)
    if stored is None:
        default = LlmTarget(provider=settings.LLM_PROVIDER, model=settings.LLM_DEFAULT_MODEL)
        allowed = True
    else:
        if find_entry(stored.provider, stored.model) is None:
            raise EngineRetiredError(
                f"The project's stored engine {stored.provider}:{stored.model} is no longer "
                "available. Ask a project manager to choose a new model."
            )
        mode = _normalized_mode(stored, project_id)
        default = LlmTarget(provider=stored.provider, model=stored.model, mode_requested=mode, mode_executed=mode)
        allowed = stored.user_choice_allowed
    row = await get_user_engine(db, user_id=user_id, project_id=project_id)
    if row is None or not (allowed or await viewer_is_manager(db, project_id, user_id)):
        return default
    if await user_row_is_retired(db, row):
        raise EngineRetiredError(
            f"Your engine for this project ({row.provider}:{row.model}) is no longer available. "
            "Pick a new model."
        )
    mode = row.mode if row.mode in ("fast", "verified") else "fast"
    return LlmTarget(
        provider=row.provider,
        model=row.model,
        mode_requested=mode,
        mode_executed=mode,
        connection_id=str(row.connection_id) if row.connection_id is not None else None,
        deviation=(row.provider, row.model) != (default.provider, default.model) or row.connection_id is not None,
    )
```

Move `LlmEngineService._viewer_is_manager` to a module function `viewer_is_manager(db, project_id, viewer_id) -> bool` (same SQL) and update its one caller. Then: `section_extraction.py:218` → `engine = await resolve_engine(db, payload.project_id, current_user_sub)` (import swap); `section_extraction_service.py:1736` → `engine = await resolve_engine(self.db, payload.project_id, UUID(self.user_id))`; `run_engine_freeze.py:25` imports `resolve_engine`, `resolve_engine_for_run(db, *, run_id, project_id, repin, user_id: UUID)` ends with `return await resolve_engine(db, project_id, user_id)`; `extraction_tasks.py` passes `user_id=UUID(user_id)` to `resolve_engine_for_run` (docstring: "the kicker's id decides whose engine and whose key").

- [ ] **Step 6: Retarget the tests**

- `test_llm_engine_service.py:22` import `resolve_engine`; every `resolve_project_engine(db_session, SEED.primary_project)` in `:396-460` → `resolve_engine(db_session, SEED.primary_project, SEED.reviewer_profile)`.
- `test_run_from_request.py:41` → `"app.services.section_extraction_service.resolve_engine"`.
- `test_run_section_extraction_task.py`: the `_apply_attempt` tests add `assert resolver.await_args.kwargs["user_id"] is not None` after the `repin` assertion (the worker threads the kicker's id).
- `test_run_engine_freeze.py:1274-1306`: add `"user_id": SEED.primary_profile` to `coords`.
- `test_llm_engine_kickoff_gate.py`: append

```python
@pytest.mark.asyncio
async def test_kickoff_on_a_user_row_whose_connection_is_gone_is_typed_409(
    client_as_manager: AsyncClient, db_session: AsyncSession
) -> None:
    from app.services.llm_connection_service import LlmConnectionService
    from app.services.user_engine_service import set_user_engine

    cid = await engine_setup.make_host_connection(db_session, label="kickoff-gone")
    await set_user_engine(
        db_session, user_id=SEED.primary_profile, project_id=SEED.primary_project,
        provider="openai_compatible", model="endpoint-model-x", mode="fast", connection_id=cid, is_manager=True,
    )
    await LlmConnectionService(db_session).delete_user(user_id=SEED.primary_profile, connection_id=cid)
    r = await client_as_manager.post("/api/v1/extraction/sections", json=_section_payload())
    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "LLM_ENGINE_RETIRED"
```

- [ ] **Step 7: Run the suites and gates**

Run: `cd backend && uv run pytest tests/integration/test_user_engine_service.py tests/integration/test_llm_engine_service.py tests/integration/test_llm_engine_kickoff_gate.py tests/integration/test_run_engine_freeze.py tests/unit/test_run_from_request.py tests/unit/test_run_section_extraction_task.py -q && uv run ruff check app tests && uv run ruff format --check app tests`; then from the repo root `python3 scripts/fitness/check_scope_guards.py && python3 scripts/fitness/check_layered_arch.py`
Expected: all PASS; scope gate exit 0 (`user_row_is_retired` reaches the row through `owned_user_connection`, never its own WHERE).

- [ ] **Step 8: Commit**

```bash
git add backend/app backend/tests
git commit -m "feat(engine): per-user engine rows; resolve_engine(project, user) with lock and deviation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: The §4 engine read (`default` / `effective` / `availability`) and `PUT`/`DELETE /llm-engine/me` `[backend]`

**Files:**

- Modify: `backend/app/schemas/llm_engine.py` (`LlmEngineRead` reshaped; `LlmEngineCatalogEntryRead` loses `byok_only`; add `LlmEngineDefaultRead`, `LlmEngineEffectiveRead`, `UserEngineUpdateRequest`, `UserEngineClearResult`)
- Modify: `backend/app/services/llm_engine_service.py` (`get_engine_read`), `backend/app/api/v1/endpoints/llm_engine.py` (two new routes)
- Modify: `backend/app/llm/registry.py:1-21` (docstring), `:121-126` (delete `is_byok_only`), `backend/app/core/config.py:124-128` (comment)
- Modify: `frontend/types/api/{openapi.json,schema.d.ts}` (regenerate)
- Test: `backend/tests/integration/test_llm_engine_endpoint.py`, `backend/tests/unit/test_llm_engine_endpoints_unit.py`, `backend/tests/integration/test_llm_engine_service.py:121-152`, `backend/tests/unit/llm/test_registry.py:80-88` (delete the two `byok_only` tests and the `is_byok_only` import)

**Interfaces:**

- Consumes: `availability_map`, `get_user_engine`, `user_row_is_retired`, `set_user_engine`, `clear_user_engine`, `EngineLockedError`, `EngineNeedsKeyError`, `viewer_is_manager` (Task 14), `selectable_catalog`, `llm_provider_ids`, `owned_user_connection`.
- Produces (`app.schemas.llm_engine`):
  - `LlmEngineDefaultRead(provider, model, mode: Literal["fast","verified"], source: Literal["project","env_default"], retired: bool, user_choice_allowed: bool, updated_by_name: str | None = None, updated_at: datetime | None = None, previous_model: str | None = None)`
  - `LlmEngineEffectiveRead(provider, model, mode, source: Literal["user","project","env_default"], retired: bool, connection_id: UUID | None = None, connection_label: str | None = None)`
  - `LlmEngineCatalogEntryRead(provider, model, canonical, label, best_for, context_window, cost_tier)` — no `byok_only`.
  - `LlmEngineRead(default: LlmEngineDefaultRead, effective: LlmEngineEffectiveRead, source: Literal["user","project","env_default"], catalog: list[LlmEngineCatalogEntryRead], availability: dict[str, Literal["user","project","global"] | None])` — `availability` has one entry per `llm_provider_ids()`.
  - `UserEngineUpdateRequest(provider, model, mode: Literal["fast","verified"] = "fast", connection_id: UUID | None = None)` (`extra="forbid"`); `UserEngineClearResult(cleared: bool)`.
  - Routes: `PUT /api/v1/projects/{project_id}/llm-engine/me` (member; body `UserEngineUpdateRequest`; 403 `LLM_ENGINE_LOCKED`, 422 `LLM_ENGINE_NEEDS_KEY`, 400 on an invalid pair/connection, 404 project) → `ApiResponse[LlmEngineRead]`; `DELETE …/llm-engine/me` → `ApiResponse[UserEngineClearResult]`. Handler names `set_my_llm_engine`, `clear_my_llm_engine`.
  - `LlmEngineService.get_engine_read(project_id, viewer_id) -> LlmEngineRead` (the new shape).

- [ ] **Step 1: Write the failing integration tests**

Rewrite the body assertions in `backend/tests/integration/test_llm_engine_endpoint.py` to the new shape: `test_member_get_returns_resolved_view` reads `data["default"]["source"] == "env_default"`, `data["effective"]["model"] == settings.LLM_DEFAULT_MODEL`, `data["source"] == "env_default"`, keeps the catalogue pair assertions on `data["catalog"]`, asserts `all("byok_only" not in e for e in data["catalog"])`, `set(data["availability"]) == {"openai", "anthropic", "google", "openai_compatible"}` and `data["availability"]["anthropic"] is None`; `test_manager_put_persists_and_attributes` / `test_put_verified_mode_round_trips` / `test_get_normalizes_a_stored_unknown_mode_to_fast` read `data["default"][...]`; delete `test_byok_only_reflects_the_deployment_global_key`. Append:

```python
@pytest.mark.asyncio
async def test_availability_is_per_caller(
    client_as_manager: AsyncClient, client_as_reviewer: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """§7.5: user > project > global > null, and the map is the CALLER's."""
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "sk-global")
    monkeypatch.setattr(settings, "GOOGLE_API_KEY", None)
    assert (await client_as_reviewer.get(_url())).json()["data"]["availability"]["openai"] == "global"
    await client_as_manager.post(
        f"/api/v1/projects/{SEED.primary_project}/connections",
        json={"provider": "openai", "label": "shared", "api_key": "sk-shared"},
    )
    assert (await client_as_reviewer.get(_url())).json()["data"]["availability"]["openai"] == "project"
    await client_as_reviewer.post("/api/v1/me/connections", json={"provider": "openai", "label": "mine", "api_key": "sk-mine"})
    body = (await client_as_reviewer.get(_url())).json()["data"]["availability"]
    assert body["openai"] == "user" and body["google"] is None and body["openai_compatible"] is None
    assert (await client_as_manager.get(_url())).json()["data"]["availability"]["openai"] == "project"


@pytest.mark.asyncio
async def test_user_row_put_and_delete(client_as_reviewer: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-ant")
    r = await client_as_reviewer.put(f"{_url()}/me", json={"provider": "anthropic", "model": "claude-haiku-4-5"})
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["source"] == "user" and data["effective"]["model"] == "claude-haiku-4-5"
    assert data["default"]["source"] == "env_default"
    r = await client_as_reviewer.delete(f"{_url()}/me")
    assert r.status_code == 200 and r.json()["data"] == {"cleared": True}
    assert (await client_as_reviewer.get(_url())).json()["data"]["source"] == "env_default"


@pytest.mark.asyncio
async def test_user_row_put_is_403_while_locked_for_a_member(
    client_as_manager: AsyncClient, client_as_reviewer: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-ant")
    r = await client_as_manager.put(_url(), json={"provider": "openai", "model": "gpt-5.6-terra", "user_choice_allowed": False})
    assert r.status_code == 200 and r.json()["data"]["default"]["user_choice_allowed"] is False
    r = await client_as_reviewer.put(f"{_url()}/me", json={"provider": "anthropic", "model": "claude-haiku-4-5"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "LLM_ENGINE_LOCKED"
    r = await client_as_manager.put(f"{_url()}/me", json={"provider": "anthropic", "model": "claude-haiku-4-5"})
    assert r.status_code == 200 and r.json()["data"]["source"] == "user"


@pytest.mark.asyncio
async def test_user_row_put_without_a_credential_is_422(client_as_reviewer: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "GOOGLE_API_KEY", None)
    r = await client_as_reviewer.put(f"{_url()}/me", json={"provider": "google", "model": "gemini-3.8-flash"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "LLM_ENGINE_NEEDS_KEY"


@pytest.mark.asyncio
async def test_outsider_user_row_put_is_403(client_as_outsider: AsyncClient) -> None:
    r = await client_as_outsider.put(f"{_url()}/me", json={"provider": "openai", "model": "gpt-5.6-terra"})
    assert r.status_code == 403
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && uv run pytest tests/integration/test_llm_engine_endpoint.py -q`
Expected: FAIL — `KeyError: 'default'`; `/me` routes 404/405.

- [ ] **Step 3: Schemas**

In `backend/app/schemas/llm_engine.py` remove `byok_only` from `LlmEngineCatalogEntryRead`, replace `LlmEngineRead` and add:

```python
class LlmEngineDefaultRead(BaseModel):
    """The project default with its lock and attribution (§4)."""

    provider: str
    model: str
    mode: Literal["fast", "verified"]
    source: Literal["project", "env_default"]
    retired: bool
    user_choice_allowed: bool
    updated_by_name: str | None = None
    updated_at: datetime | None = None
    previous_model: str | None = None


class LlmEngineEffectiveRead(BaseModel):
    """What the VIEWER's next run runs on: their own row, or the default.
    The run form renders this, never ``default``."""

    provider: str
    model: str
    mode: Literal["fast", "verified"]
    source: Literal["user", "project", "env_default"]
    retired: bool
    connection_id: UUID | None = None
    connection_label: str | None = None


class LlmEngineRead(BaseModel):
    """§4: ``availability`` says whose credential a row on each provider would
    run on for THIS caller — a scope tag, never key material."""

    default: LlmEngineDefaultRead
    effective: LlmEngineEffectiveRead
    source: Literal["user", "project", "env_default"]
    catalog: list[LlmEngineCatalogEntryRead]
    availability: dict[str, Literal["user", "project", "global"] | None]


class UserEngineUpdateRequest(BaseModel):
    """PUT body for the viewer's own row (§4). ``connection_id`` is the
    caller's own host connection, required iff ``provider`` is
    ``openai_compatible`` (the service checks ownership and the probe)."""

    model_config = ConfigDict(extra="forbid")

    provider: str
    model: str
    mode: Literal["fast", "verified"] = "fast"
    connection_id: UUID | None = None


class UserEngineClearResult(BaseModel):
    cleared: bool
```

- [ ] **Step 4: The read and the routes**

`LlmEngineService.get_engine_read` becomes:

```python
    async def get_engine_read(self, project_id: UUID, viewer_id: UUID) -> LlmEngineRead:
        from app.services.user_engine_service import get_user_engine, user_row_is_retired

        resolved = await self.get_for_project(project_id)
        stored = resolved.stored
        updated_by_name: str | None = None
        if stored is not None and stored.updated_by is not None:
            updated_by_name = (await _profile_names(self.db, {stored.updated_by})).get(stored.updated_by)
        default_source: Literal["project", "env_default"] = "project" if stored is not None else "env_default"
        default = LlmEngineDefaultRead(
            provider=resolved.provider, model=resolved.model, mode=resolved.mode, source=default_source,
            retired=resolved.retired, user_choice_allowed=resolved.user_choice_allowed,
            updated_by_name=updated_by_name,
            updated_at=stored.updated_at if stored is not None else None,
            previous_model=stored.previous_model if stored is not None else None,
        )
        effective = LlmEngineEffectiveRead(
            provider=default.provider, model=default.model, mode=default.mode,
            source=default_source, retired=default.retired,
        )
        row = await get_user_engine(self.db, user_id=viewer_id, project_id=project_id)
        if row is not None and (
            resolved.user_choice_allowed or await viewer_is_manager(self.db, project_id, viewer_id)
        ):
            label: str | None = None
            if row.connection_id is not None:
                conn = await owned_user_connection(self.db, row.connection_id, viewer_id)
                label = conn.label if conn is not None else None
            effective = LlmEngineEffectiveRead(
                provider=row.provider, model=row.model,
                mode=row.mode if row.mode in ("fast", "verified") else "fast",  # type: ignore[arg-type]
                source="user", retired=await user_row_is_retired(self.db, row),
                connection_id=row.connection_id, connection_label=label,
            )
        return LlmEngineRead(
            default=default,
            effective=effective,
            source=effective.source,
            catalog=[
                LlmEngineCatalogEntryRead(
                    provider=e.provider, model=e.model, canonical=canonical(e), label=e.label,
                    best_for=e.best_for, context_window=e.context_window, cost_tier=e.cost_tier,
                )
                for e in selectable_catalog()
            ],
            availability=await availability_map(
                self.db, project_id=project_id, user_id=viewer_id, providers=llm_provider_ids()
            ),
        )
```

Imports: `from app.llm.registry import llm_provider_ids`, `from app.services.llm_connection_service import availability_map, owned_user_connection`; drop `APIKeyService`, `is_byok_only`, `CATALOG`, `canonical_pair`. Delete `is_byok_only` from `backend/app/llm/registry.py` and rewrite its module docstring: "... the DB CHECK literals on `llm_connections.provider` and the `scopes` CHECK (asserted equal by `tests/unit/llm/test_llm_connection_model.py` and `test_migration_roundtrip.py`) ... `global_key_for` feeds the `global` tier of the engine read's `availability`." Reword `backend/app/core/config.py:124-128` to "when it is empty the provider needs a user or project key in this deployment (the engine read's `availability`)".

Append to `backend/app/api/v1/endpoints/llm_engine.py`:

```python
@router.put("/{project_id}/llm-engine/me", response_model=ApiResponse[LlmEngineRead])
@limiter.limit("30/minute")
async def set_my_llm_engine(
    project_id: UUID,
    body: UserEngineUpdateRequest,
    request: Request,
    db: DbSession,
    viewer_id: UUID = Depends(require_project_scope),
) -> ApiResponse[LlmEngineRead]:
    """The viewer's own engine for new runs (§4): 403 while locked for a
    non-manager, 422 without a credential (AppErrors, typed envelopes)."""
    trace_id = getattr(request.state, "trace_id", None)
    try:
        await set_user_engine(
            db, user_id=viewer_id, project_id=project_id, provider=body.provider, model=body.model,
            mode=body.mode, connection_id=body.connection_id,
            is_manager=await viewer_is_manager(db, project_id, viewer_id),
        )
        data = await LlmEngineService(db).get_engine_read(project_id, viewer_id)
    except ProjectNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(data, trace_id=trace_id)


@router.delete("/{project_id}/llm-engine/me", response_model=ApiResponse[UserEngineClearResult])
@limiter.limit("30/minute")
async def clear_my_llm_engine(
    project_id: UUID, request: Request, db: DbSession, viewer_id: UUID = Depends(require_project_scope)
) -> ApiResponse[UserEngineClearResult]:
    cleared = await clear_user_engine(db, user_id=viewer_id, project_id=project_id)
    await db.commit()
    return ApiResponse.success(
        UserEngineClearResult(cleared=cleared), trace_id=getattr(request.state, "trace_id", None)
    )
```

(imports: `UserEngineUpdateRequest`, `UserEngineClearResult`, `viewer_is_manager`, `set_user_engine`, `clear_user_engine`.)

- [ ] **Step 5: Unit and service tests**

`test_llm_engine_endpoints_unit.py`: `_read()` builds the new shape (`default=LlmEngineDefaultRead(...)`, `effective=LlmEngineEffectiveRead(...)`, `source="env_default"`, `catalog=[]`, `availability={"openai": "global", "anthropic": None}`); add two coroutine tests for `set_my_llm_engine` (patch `f"{_EP}.set_user_engine"`, `f"{_EP}.viewer_is_manager"` → `AsyncMock(return_value=False)` and `LlmEngineService`; a `ValueError` maps to 400; the happy path commits and returns the read) and one for `clear_my_llm_engine` (patch `f"{_EP}.clear_user_engine"` → `AsyncMock(return_value=True)`; `resp.data.cleared is True`, commit awaited). `test_llm_engine_service.py:121-152`: `read.source == "env_default"`, `read.effective.model == settings.LLM_DEFAULT_MODEL`, `set(read.availability) == set(llm_provider_ids())`, `read.availability["anthropic"] is None`; the updater-name test reads `read.default.updated_by_name`. `test_registry.py`: delete `test_byok_only_is_computed_from_the_deployment`, `test_host_bearing_provider_is_never_byok_only` and the `is_byok_only` import.

- [ ] **Step 6: Run, regenerate**

Run: `cd backend && uv run pytest tests/integration/test_llm_engine_endpoint.py tests/unit/test_llm_engine_endpoints_unit.py tests/integration/test_llm_engine_service.py tests/unit/llm/test_registry.py -q && uv run ruff check app tests && uv run ruff format --check app tests && uv run vulture`
Expected: all PASS; vulture: no new finding (`is_byok_only` deleted, not baselined).
Run: `bash scripts/generate_api_types.sh && npm run typecheck`
Expected: regenerated; tsc clean (no frontend consumer of `LlmEngineRead` exists since Task 11).

- [ ] **Step 7: Commit**

```bash
git add backend/app backend/tests frontend/types/api
git commit -m "feat(api): engine read with default/effective/availability; PUT/DELETE /llm-engine/me

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 16: Delete the legacy credential stack; migration 0073 drops the old tables and strips `alternates` `[backend]`

**Files:**

- Delete: `backend/app/api/v1/endpoints/user_api_keys.py`, `backend/app/api/v1/endpoints/llm_endpoints.py`, `backend/app/services/api_key_service.py`, `backend/app/services/llm_endpoint_service.py`, `backend/app/repositories/user_api_key_repository.py`, `backend/app/models/user_api_key.py`, `backend/app/models/project_llm_endpoint.py`, `backend/app/schemas/user_api_key.py`
- Delete tests: `backend/tests/unit/test_api_key_service.py`, `test_user_api_key_schemas.py`, `test_user_api_key_repository.py`, `test_user_api_keys_endpoint.py`, `test_llm_endpoints_unit.py`, `test_llm_endpoint_schemas.py` (its two `capabilities` tests move to `backend/tests/unit/test_llm_connection_schemas.py`), `backend/tests/integration/test_llm_endpoint_service.py`, `test_llm_endpoints_api.py`, `test_llm_endpoint_rls.py`
- Modify: `backend/app/api/v1/router.py` (imports + the two `include_router` blocks), `backend/app/models/__init__.py:58,62,117-118,162-163`, `backend/app/repositories/__init__.py:33,60`, `backend/app/schemas/__init__.py:41-46,106-109`, `backend/app/models/user.py:49-54` (delete the `api_keys` relationship), `backend/app/schemas/llm_endpoint.py` (keep only `LlmEndpointCapabilities` and `LlmEndpointProbeResult`; docstring: "probe shapes shared by the host probe and the connection read"), `backend/tests/unit/test_typed_envelope_schemas.py:19-23` and its three `*APIKey*`/`Providers` test classes, `backend/app/llm/registry.py:105-107` (comment), `scripts/fitness/check_scope_guards.baseline:14-19`
- Create: `backend/alembic/versions/0073_drop_legacy_credentials.py`
- Modify: `backend/tests/integration/test_migration_roundtrip.py:1332` (head pin → `"0073_drop_legacy_credentials"`), `:1335-1368` (the `user_api_keys_provider_check` test is deleted — Task 2's `llm_connections` test is its successor), `:1370-1430` (the whole 0071 block is deleted), append the 0073 block
- Modify: `frontend/integrations/supabase/types.ts` (regenerate: `supabase gen types typescript --local > frontend/integrations/supabase/types.ts` with the local stack at head), `frontend/types/api/{openapi.json,schema.d.ts}` (regenerate)

**Interfaces:**

- Consumes: everything above is already unreferenced by production code after Tasks 5–15 (`grep -rn "api_key_service\|llm_endpoint_service\|user_api_key\|project_llm_endpoint\|APIKeyService\|LlmEndpointService" backend/app` must list only the files being deleted, `schemas/llm_endpoint.py`, and comments — run it first; anything else is a Task 5–15 miss to fix here).
- Produces: head revision `0073_drop_legacy_credentials`; `projects.settings->'llm_engine'` never carries `alternates`; the scope-guard baseline is five rows shorter; `registry.provider_ids` keeps its baseline row with a comment naming `app/models/llm_connection.py`.

- [ ] **Step 1: Write the failing roundtrip tests**

Append to `backend/tests/integration/test_migration_roundtrip.py` (after deleting the `_PROVIDER_CHECK_DEF` test and the 0071 block):

```python
# --- 0073: drop user_api_keys / project_llm_endpoints, strip alternates -----
_R73_PROFILE = "00730000-0000-4000-8000-00000000000a"
_R73_WITH = "00730000-0000-4000-8000-000000000001"
_R73_WITHOUT = "00730000-0000-4000-8000-000000000002"
_R73_SEED = (
    "INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES "
    f"('{_R73_PROFILE}', 'legacy-0073@integration-test.prumo.local', "
    "'00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')",
    "INSERT INTO public.profiles (id, email, full_name) VALUES "
    f"('{_R73_PROFILE}', 'legacy-0073@integration-test.prumo.local', 'Legacy 0073')",
    "INSERT INTO public.projects (id, name, created_by_id, is_active, settings) VALUES "
    f"('{_R73_WITH}', 'Alternates 0073', '{_R73_PROFILE}', true, "
    "'{\"parsing\": {\"type\": \"standard\"}, \"llm_engine\": {\"provider\": \"openai\", "
    "\"model\": \"gpt-5.6-terra\", \"mode\": \"fast\", \"alternates\": [{\"provider\": \"anthropic\", "
    "\"model\": \"claude-sonnet-5\"}]}}'::jsonb)",
    "INSERT INTO public.projects (id, name, created_by_id, is_active, settings) VALUES "
    f"('{_R73_WITHOUT}', 'No alternates 0073', '{_R73_PROFILE}', true, "
    "'{\"llm_engine\": {\"provider\": \"openai\", \"model\": \"gpt-5.6-terra\", \"mode\": \"verified\"}}'::jsonb)",
)
_R73_SETTINGS = text("SELECT settings::text FROM public.projects WHERE id = :pid")
_R73_TABLE_EXISTS = text("SELECT to_regclass(:name) IS NOT NULL")


@pytest.mark.asyncio
async def test_migration_0073_drops_the_legacy_tables_and_strips_alternates(
    migration_db_url: str, migration_session: AsyncSession
) -> None:
    """§2 + §7.5: driven through alembic. Seeded while downgraded to 0072,
    upgraded to head: ``alternates`` is gone from the row that carried it,
    the row without it is byte-identical, both legacy tables and the
    orphaned trigger function are gone; the downgrade re-creates the
    tables' schema and never resurrects ``alternates``."""
    _run_alembic("downgrade", "0072_llm_connections", database_url=migration_db_url)
    try:
        for stmt in _R73_SEED:
            await migration_session.execute(text(stmt))
        await migration_session.commit()
        before_without = (await migration_session.execute(_R73_SETTINGS, {"pid": _R73_WITHOUT})).scalar_one()
        assert (await migration_session.execute(_R73_TABLE_EXISTS, {"name": "public.user_api_keys"})).scalar() is True
    finally:
        _run_alembic("upgrade", "head", database_url=migration_db_url)
    await migration_session.commit()

    with_settings = (await migration_session.execute(_R73_SETTINGS, {"pid": _R73_WITH})).scalar_one()
    assert "alternates" not in with_settings and '"parsing"' in with_settings
    assert (await migration_session.execute(_R73_SETTINGS, {"pid": _R73_WITHOUT})).scalar_one() == before_without
    for name in ("public.user_api_keys", "public.project_llm_endpoints"):
        assert (await migration_session.execute(_R73_TABLE_EXISTS, {"name": name})).scalar() is False, name
    assert (
        await migration_session.execute(
            text("SELECT count(*) FROM pg_proc WHERE proname = 'ensure_single_default_api_key'")
        )
    ).scalar() == 0

    _run_alembic("downgrade", "0072_llm_connections", database_url=migration_db_url)
    try:
        await migration_session.commit()
        assert (await migration_session.execute(_R73_TABLE_EXISTS, {"name": "public.user_api_keys"})).scalar() is True
        assert "alternates" not in (await migration_session.execute(_R73_SETTINGS, {"pid": _R73_WITH})).scalar_one()
    finally:
        _run_alembic("upgrade", "head", database_url=migration_db_url)
    await migration_session.commit()
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && uv run pytest tests/integration/test_migration_roundtrip.py -q -k "0073 or head_is_expected"`
Expected: FAIL — `alembic downgrade 0072_llm_connections` "Can't locate revision" (the head is 0072), head pin mismatch.

- [ ] **Step 3: Write the migration**

```python
# backend/alembic/versions/0073_drop_legacy_credentials.py
"""Drop user_api_keys and project_llm_endpoints; strip llm_engine.alternates.

llm_connections (0072) replaced both credential tables and every reader
has moved (slice-2 plan tasks 5-15). No active users exist, so the rows
are dropped, not migrated (spec §Non-goals). What falls with each table:
its PK, FKs, CHECKs, indexes, triggers, RLS policies and grants. The
trigger FUNCTION ensure_single_default_api_key() is a separate object and
is dropped explicitly (its grants fall with it); update_updated_at_column()
is shared by other tables and stays. alternates (retired fallback list,
spec §3.1) is removed from every projects.settings->'llm_engine' that
carries it — self-guarding SQL, a no-op on a row without the key.

Downgrade re-creates both tables' SCHEMA (baseline_v1.sql / 0055 shape,
with 0071's CHECK) and the trigger function, so ``downgrade -1`` works;
it never resurrects rows or alternates (data loss accepted, spec).

Revision ID: 0073_drop_legacy_credentials
Revises: 0072_llm_connections
Create Date: 2026-09-13
"""

from alembic import op

revision = "0073_drop_legacy_credentials"
down_revision = "0072_llm_connections"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.project_llm_endpoints")
    op.execute("DROP TABLE IF EXISTS public.user_api_keys")
    op.execute("DROP FUNCTION IF EXISTS public.ensure_single_default_api_key()")
    # Self-guarding: only rows whose llm_engine carries the key are touched.
    op.execute(
        "UPDATE public.projects "
        "SET settings = jsonb_set(settings, '{llm_engine}', (settings->'llm_engine') - 'alternates') "
        "WHERE settings->'llm_engine' ? 'alternates'"
    )


def downgrade() -> None:
    op.execute(
        """
        CREATE FUNCTION public.ensure_single_default_api_key() RETURNS trigger
            LANGUAGE plpgsql
            SET search_path = public, pg_catalog
            AS $$
            BEGIN
              IF NEW.is_default THEN
                UPDATE user_api_keys SET is_default = false
                WHERE user_id = NEW.user_id AND provider = NEW.provider AND id != NEW.id;
              END IF;
              RETURN NEW;
            END;
            $$;
        """
    )
    op.execute(
        """
        CREATE TABLE public.user_api_keys (
            id uuid DEFAULT gen_random_uuid() NOT NULL,
            user_id uuid NOT NULL,
            provider text NOT NULL,
            encrypted_api_key text NOT NULL,
            key_name text,
            is_active boolean DEFAULT true NOT NULL,
            is_default boolean DEFAULT false NOT NULL,
            last_used_at timestamp with time zone,
            last_validated_at timestamp with time zone,
            validation_status text,
            metadata jsonb,
            created_at timestamp with time zone DEFAULT now() NOT NULL,
            updated_at timestamp with time zone DEFAULT now() NOT NULL,
            CONSTRAINT user_api_keys_pkey PRIMARY KEY (id),
            CONSTRAINT user_api_keys_user_id_fkey FOREIGN KEY (user_id)
                REFERENCES public.profiles(id) ON DELETE CASCADE,
            CONSTRAINT user_api_keys_provider_check CHECK (
                provider IN ('openai', 'anthropic', 'google', 'openai_compatible', 'llama_cloud')),
            CONSTRAINT user_api_keys_validation_status_check CHECK (
                validation_status IS NULL OR validation_status IN ('valid', 'invalid', 'pending'))
        )
        """
    )
    op.execute("CREATE INDEX idx_user_api_keys_provider ON public.user_api_keys USING btree (provider)")
    op.execute("CREATE INDEX idx_user_api_keys_user_id ON public.user_api_keys USING btree (user_id)")
    op.execute(
        "CREATE TRIGGER trg_ensure_single_default_api_key BEFORE INSERT OR UPDATE OF is_default "
        "ON public.user_api_keys FOR EACH ROW EXECUTE FUNCTION public.ensure_single_default_api_key()"
    )
    op.execute(
        "CREATE TRIGGER trg_user_api_keys_updated_at BEFORE UPDATE ON public.user_api_keys "
        "FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()"
    )
    op.execute("ALTER TABLE public.user_api_keys ENABLE ROW LEVEL SECURITY")
    for verb, clause in (
        ("SELECT", "USING (user_id = auth.uid())"),
        ("INSERT", "WITH CHECK (user_id = auth.uid())"),
        ("UPDATE", "USING (user_id = auth.uid())"),
        ("DELETE", "USING (user_id = auth.uid())"),
    ):
        op.execute(
            f'CREATE POLICY "user_api_keys_{verb.lower()}" ON public.user_api_keys FOR {verb} {clause}'
        )
    op.execute("GRANT ALL ON TABLE public.user_api_keys TO authenticated, service_role")

    op.execute(
        """
        CREATE TABLE public.project_llm_endpoints (
            id uuid NOT NULL,
            project_id uuid NOT NULL,
            label text NOT NULL,
            base_url text NOT NULL,
            encrypted_api_key text,
            allowed_models jsonb DEFAULT '[]'::jsonb NOT NULL,
            capabilities jsonb DEFAULT '{}'::jsonb NOT NULL,
            validation_status text DEFAULT 'unverified' NOT NULL,
            last_validated_at timestamp with time zone,
            created_by uuid NOT NULL,
            created_at timestamp with time zone DEFAULT now() NOT NULL,
            updated_at timestamp with time zone DEFAULT now() NOT NULL,
            CONSTRAINT project_llm_endpoints_pkey PRIMARY KEY (id),
            CONSTRAINT project_llm_endpoints_project_id_fkey FOREIGN KEY (project_id)
                REFERENCES public.projects(id) ON DELETE CASCADE,
            CONSTRAINT project_llm_endpoints_created_by_fkey FOREIGN KEY (created_by)
                REFERENCES public.profiles(id) ON DELETE RESTRICT,
            CONSTRAINT uq_llm_endpoint_label UNIQUE (project_id, label),
            CONSTRAINT ck_project_llm_endpoints_llm_ep_vstatus CHECK (
                validation_status IN ('unverified','ok','failed'))
        )
        """
    )
    op.execute(
        "CREATE INDEX ix_public_project_llm_endpoints_project_id "
        "ON public.project_llm_endpoints USING btree (project_id)"
    )
    op.execute("ALTER TABLE public.project_llm_endpoints ENABLE ROW LEVEL SECURITY")
    op.execute('CREATE POLICY "deny_all" ON public.project_llm_endpoints FOR ALL USING (false)')
    op.execute("REVOKE ALL ON public.project_llm_endpoints FROM authenticated, anon")
```

- [ ] **Step 4: Delete the stack**

`git rm` every file under "Delete". Then: `router.py` drops the `user_api_keys` and `llm_endpoints` imports and blocks; `models/__init__.py`, `repositories/__init__.py`, `schemas/__init__.py` drop the listed imports and `__all__` entries; `user.py:49-54` drops the `api_keys` relationship (and its comment); `schemas/llm_endpoint.py` keeps only the two probe shapes; `test_typed_envelope_schemas.py` drops the `user_api_key` import and its `TestCreateAPIKeyWire`, `TestKeyValidationWire`, `TestProvidersWire` classes; move `test_capabilities_defaults` and `test_capabilities_normalizes_an_unknown_output_mode` from `test_llm_endpoint_schemas.py` into `test_llm_connection_schemas.py` (import `LlmEndpointCapabilities` from `app.schemas.llm_endpoint`). In `backend/app/llm/registry.py:105-107` rewrite the comment: "Consumed by app.models.llm_connection (the CHECK literals); that module is excluded from the vulture scan ([tool.vulture].exclude), so this call site is invisible to the ratchet even though it is real." — the baseline row `app/llm/registry.py:function:provider_ids` (`backend/.vulture_baseline:27`) stays. Delete rows 14–19 of `scripts/fitness/check_scope_guards.baseline` (the `ProjectLlmEndpoint` and `UserAPIKey` rows) by hand — never `--update-baseline`, which rewrites every row.

- [ ] **Step 5: Apply, check, regenerate**

Run: `cd backend && uv run alembic upgrade head && uv run alembic check`
Expected: `Running upgrade 0072_llm_connections -> 0073_drop_legacy_credentials`; `No new upgrade operations detected.` (the two model files are gone, so the ORM no longer expects the tables).
Run: `cd backend && uv run alembic downgrade -1 && uv run alembic upgrade head`
Expected: both succeed (the downgrade's DDL is exercised).
Run: `supabase gen types typescript --local > frontend/integrations/supabase/types.ts && git diff --stat frontend/integrations/supabase/types.ts`
Expected: the `user_api_keys` block (around `:2083-2135`) is removed and nothing else changes; if unrelated tables changed, the local stack is not at this branch's head — `make db-fresh` and regenerate.
Run: `bash scripts/generate_api_types.sh && npm run typecheck`
Expected: `/api/v1/user-api-keys*` and `/api/v1/projects/{project_id}/llm-endpoints*` paths gone from `openapi.json`; tsc clean.

- [ ] **Step 6: Run the whole backend suite and the gates**

Run: `cd backend && uv run pytest -q`
Expected: all pass (read the summary line; the shared-stack `test_run_read_manager_blind` artefact noted in the ledger is not from this branch). Then from the repo root: `python3 scripts/fitness/check_scope_guards.py && python3 scripts/fitness/check_layered_arch.py && python3 scripts/fitness/check_rls_coverage.py && (cd backend && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec)`
Expected: exit 0 each; the vulture ratchet reports no new finding and — if it lists baseline rows now clean — tighten with `--update` in the same commit.

- [ ] **Step 7: Commit**

```bash
git add -A backend scripts/fitness/check_scope_guards.baseline frontend/integrations/supabase/types.ts frontend/types/api
git commit -m "refactor(credentials): drop user_api_keys/project_llm_endpoints and their stack (0073); strip alternates

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 17: Worklist gear — "Your engine for new runs" `[frontend]`

**Files:**

- Create: `frontend/services/llmEngineService.ts` (read + the viewer's own writes; the manager's default write arrives in Task 18 with its consumer), `frontend/hooks/extraction/useLlmEngine.ts`, `frontend/components/extraction/EngineGear.tsx`
- Modify: `frontend/lib/copy/llmConnections.ts` (append the picker keys), `frontend/components/extraction/ExtractionInterface.tsx:311-330` (`toolbarActions`), `frontend/components/quality/QualityAssessmentInterface.tsx:246-265` (`toolbarActions`)
- Test: `frontend/test/services/llmEngineService.test.ts`, `frontend/test/hooks/useLlmEngine.test.tsx`, `frontend/test/components/EngineGear.test.tsx`, `frontend/test/components/ExtractionInterface.gear.test.tsx` (all new), `frontend/test/QualityAssessmentInterface.test.tsx` (append one case)

**Interfaces:**

- Consumes: `components['schemas']['LlmEngineRead' | 'LlmEngineCatalogEntryRead' | 'UserEngineUpdateRequest' | 'UserEngineClearResult']` (regenerated in Task 15), `useMyConnections`, `useProviders` (Task 9), `useProjectMemberRole`, `projectKeys.llmEngine(id)`, shadcn `Popover`, `Command*`, `ToggleGroup`, `Tooltip`, `Skeleton`, `Badge`, react-router `Link`.
- Produces:
  - `llmEngineService.ts`: `export type LlmEngineRead`, `LlmEngineCatalogEntry`, `UserEngineUpdateRequest`; `fetchLlmEngine(projectId): Promise<ErrorResult<LlmEngineRead>>` (GET `/api/v1/projects/${projectId}/llm-engine`), `setMyEngine(projectId, body: UserEngineUpdateRequest): Promise<ErrorResult<LlmEngineRead>>` (PUT `…/llm-engine/me`), `clearMyEngine(projectId): Promise<ErrorResult<{cleared: boolean}>>` (DELETE `…/llm-engine/me`). No wire normalization: the routes are greenfield.
  - `useLlmEngine(projectId)` (query on `projectKeys.llmEngine(projectId)`, `staleTime` 5 min), `useSetMyEngine(projectId)`, `useClearMyEngine(projectId)` (mutations; `onSuccess` writes the returned read onto `projectKeys.llmEngine(projectId)` via `setQueryData` when the result is a read, and invalidates it).
  - `EngineGear({projectId})` — an icon button (`aria-label` = `llmConnections.gearAria`, tooltip = `gearTooltip` with `{{engine}}` = the effective catalogue label or `provider:model`, or `gearLoading` while pending) opening a `Popover` with the picker. `data-testid="engine-gear"`.
  - States (§5.3): loading → tooltip `gearLoading`, popover shows two `Skeleton` groups; error → popover shows `pickerLoadError` + `retry` (refetch), gear stays mounted; no host connection → no host group, a `Link` to `/settings?tab=integrations` labelled `noHostsLink`; member under lock → every row `aria-disabled`, one line `lockedReason`; manager → editable regardless of the lock; non-member never reaches the worklist (ProjectView's not-found branch). Managers see nothing extra.
  - Copy keys added (all referenced by the gear): `gearAria`, `gearLoading`, `gearTooltip`, `projectDefaultLine`, `lockedReason`, `pickerLoadError`, `pickerNoMatch`, `tagYourKey`, `tagProjectKey`, `tagPrumo`, `tagNeedsKey`, `needsKeyLink`, `noHostsLink`, `hostGroupNote`, `modeLabel`, `modeFast`, `modeVerified`, `followDefault`, `retiredNote`, `pickSuccess`, `pickError`.

- [ ] **Step 1: Write the failing service and hook tests**

```ts
// frontend/test/services/llmEngineService.test.ts
import {beforeEach, describe, expect, it, vi} from 'vitest';

const {apiClientMock} = vi.hoisted(() => ({apiClientMock: vi.fn()}));
vi.mock('@/integrations/api/client', () => ({apiClient: apiClientMock}));

import {clearMyEngine, fetchLlmEngine, setMyEngine} from '@/services/llmEngineService';

beforeEach(() => vi.clearAllMocks());

describe('llmEngineService', () => {
  it('reads the project engine and writes the viewer row', async () => {
    apiClientMock.mockResolvedValueOnce({source: 'env_default'});
    expect((await fetchLlmEngine('p1')).ok).toBe(true);
    expect(apiClientMock).toHaveBeenLastCalledWith('/api/v1/projects/p1/llm-engine');

    apiClientMock.mockResolvedValueOnce({source: 'user'});
    await setMyEngine('p1', {provider: 'openai', model: 'gpt-4o-mini', mode: 'fast', connection_id: null});
    expect(apiClientMock).toHaveBeenLastCalledWith('/api/v1/projects/p1/llm-engine/me', {
      method: 'PUT',
      body: {provider: 'openai', model: 'gpt-4o-mini', mode: 'fast', connection_id: null},
    });

    apiClientMock.mockResolvedValueOnce({cleared: true});
    expect(await clearMyEngine('p1')).toEqual({ok: true, data: {cleared: true}});
    expect(apiClientMock).toHaveBeenLastCalledWith('/api/v1/projects/p1/llm-engine/me', {method: 'DELETE'});
  });

  it('never throws across the boundary', async () => {
    apiClientMock.mockRejectedValueOnce(new Error('403'));
    expect((await setMyEngine('p1', {provider: 'openai', model: 'm', mode: 'fast', connection_id: null})).ok).toBe(false);
  });
});
```

```tsx
// frontend/test/hooks/useLlmEngine.test.tsx
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, renderHook, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/services/llmEngineService', () => ({
  fetchLlmEngine: vi.fn(),
  setMyEngine: vi.fn(),
  clearMyEngine: vi.fn(),
}));

import {projectKeys} from '@/lib/query-keys';
import {fetchLlmEngine, setMyEngine} from '@/services/llmEngineService';
import {useLlmEngine, useSetMyEngine} from '@/hooks/extraction/useLlmEngine';

function harness() {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}});
  const wrapper = ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return {wrapper, queryClient};
}

describe('useLlmEngine / useSetMyEngine', () => {
  it('a failed read is the query error state', async () => {
    vi.mocked(fetchLlmEngine).mockResolvedValue({ok: false, error: new Error('x')});
    const {wrapper} = harness();
    const {result} = renderHook(() => useLlmEngine('p1'), {wrapper});
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('a successful write lands on the read key synchronously', async () => {
    const read = {source: 'user'} as never;
    vi.mocked(setMyEngine).mockResolvedValue({ok: true, data: read});
    const {wrapper, queryClient} = harness();
    const {result} = renderHook(() => useSetMyEngine('p1'), {wrapper});
    await act(async () => {
      await result.current.mutateAsync({provider: 'openai', model: 'm', mode: 'fast', connection_id: null});
    });
    expect(queryClient.getQueryData(projectKeys.llmEngine('p1'))).toBe(read);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run frontend/test/services/llmEngineService.test.ts frontend/test/hooks/useLlmEngine.test.tsx`
Expected: FAIL — unresolved imports `@/services/llmEngineService`, `@/hooks/extraction/useLlmEngine`.

- [ ] **Step 3: Service and hooks**

```ts
// frontend/services/llmEngineService.ts
/**
 * Project engine read + the viewer's own engine writes (spec §4). The read
 * carries `default` (the project's, with lock and attribution), `effective`
 * (what the viewer's next run runs on) and `availability` (whose credential
 * each provider would run on, for this caller). Every call routes through
 * the typed client and returns `ErrorResult<T>` — never throws, never toasts.
 */
import {apiClient} from '@/integrations/api/client';
import {toResult, type ErrorResult} from '@/lib/error-utils';
import type {components} from '@/types/api/schema';

export type LlmEngineRead = components['schemas']['LlmEngineRead'];
export type LlmEngineCatalogEntry = components['schemas']['LlmEngineCatalogEntryRead'];
export type UserEngineUpdateRequest = components['schemas']['UserEngineUpdateRequest'];
type UserEngineClearResult = components['schemas']['UserEngineClearResult'];

export const enginePath = (projectId: string): string => `/api/v1/projects/${projectId}/llm-engine`;

export function fetchLlmEngine(projectId: string): Promise<ErrorResult<LlmEngineRead>> {
  return toResult(() => apiClient<LlmEngineRead>(enginePath(projectId)), 'llmEngineService.fetchLlmEngine');
}

export function setMyEngine(projectId: string, body: UserEngineUpdateRequest): Promise<ErrorResult<LlmEngineRead>> {
  return toResult(
    () => apiClient<LlmEngineRead>(`${enginePath(projectId)}/me`, {method: 'PUT', body}),
    'llmEngineService.setMyEngine',
  );
}

export function clearMyEngine(projectId: string): Promise<ErrorResult<UserEngineClearResult>> {
  return toResult(
    () => apiClient<UserEngineClearResult>(`${enginePath(projectId)}/me`, {method: 'DELETE'}),
    'llmEngineService.clearMyEngine',
  );
}
```

```ts
// frontend/hooks/extraction/useLlmEngine.ts
/** TanStack hooks for the project engine read and the viewer's own row (§4). */
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import {projectKeys} from '@/lib/query-keys';
import {
  clearMyEngine,
  fetchLlmEngine,
  setMyEngine,
  type LlmEngineRead,
  type UserEngineUpdateRequest,
} from '@/services/llmEngineService';

const STALE_MS = 5 * 60_000;

export function useLlmEngine(projectId: string | null | undefined) {
  return useQuery({
    queryKey: projectKeys.llmEngine(projectId ?? ''),
    enabled: Boolean(projectId),
    staleTime: STALE_MS,
    queryFn: async (): Promise<LlmEngineRead> => {
      const result = await fetchLlmEngine(projectId!);
      if (!result.ok) throw result.error;
      return result.data;
    },
  });
}

export function useSetMyEngine(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation<LlmEngineRead, Error, UserEngineUpdateRequest>({
    mutationFn: async (body) => {
      const result = await setMyEngine(projectId, body);
      if (!result.ok) throw result.error;
      return result.data;
    },
    onSuccess: (data) => {
      // The response IS the fresh read: land it synchronously, then reconcile.
      queryClient.setQueryData(projectKeys.llmEngine(projectId), data);
      void queryClient.invalidateQueries({queryKey: projectKeys.llmEngine(projectId)});
    },
  });
}

export function useClearMyEngine(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation<{cleared: boolean}, Error, void>({
    mutationFn: async () => {
      const result = await clearMyEngine(projectId);
      if (!result.ok) throw result.error;
      return result.data;
    },
    onSuccess: () => void queryClient.invalidateQueries({queryKey: projectKeys.llmEngine(projectId)}),
  });
}
```

- [ ] **Step 4: Write the failing gear test**

```tsx
// frontend/test/components/EngineGear.test.tsx
import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter} from 'react-router';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {t} from '@/lib/copy';

const hooks = vi.hoisted(() => ({
  engine: vi.fn(), setMine: vi.fn(), clearMine: vi.fn(), role: vi.fn(), mine: vi.fn(), providers: vi.fn(),
}));
vi.mock('@/hooks/extraction/useLlmEngine', () => ({
  useLlmEngine: hooks.engine, useSetMyEngine: hooks.setMine, useClearMyEngine: hooks.clearMine,
}));
vi.mock('@/hooks/user/useLlmConnections', () => ({useMyConnections: hooks.mine, useProviders: hooks.providers}));
vi.mock('@/hooks/useProjectMemberRole', () => ({useProjectMemberRole: hooks.role}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn()}}));

import {EngineGear} from '@/components/extraction/EngineGear';

const entry = (provider: string, model: string, label: string) => ({
  provider, model, canonical: `${provider}:${model}`, label, best_for: 'b', context_window: 1000, cost_tier: '$',
});
const READ = {
  default: {provider: 'openai', model: 'gpt-4o-mini', mode: 'fast', source: 'project', retired: false, user_choice_allowed: true},
  effective: {provider: 'openai', model: 'gpt-4o-mini', mode: 'fast', source: 'project', retired: false, connection_id: null, connection_label: null},
  source: 'project',
  catalog: [entry('openai', 'gpt-4o-mini', 'GPT-4o mini'), entry('anthropic', 'claude-haiku-4-5', 'Claude Haiku'), entry('google', 'gemini-3.8-flash', 'Gemini Flash')],
  availability: {openai: 'global', anthropic: 'user', google: null, openai_compatible: 'user'},
} as never;
const HOST = {id: 'c1', provider: 'openai_compatible', label: 'Lab Ollama', base_url: 'https://8.8.8.8/v1', allowed_models: ['llama3'], validation_status: 'ok', has_api_key: false} as never;
const setMutate = vi.fn();

function renderGear() {
  return render(<MemoryRouter><EngineGear projectId="p1" /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  hooks.engine.mockReturnValue({data: READ, isPending: false, isError: false, refetch: vi.fn()});
  hooks.setMine.mockReturnValue({mutate: setMutate, isPending: false});
  hooks.clearMine.mockReturnValue({mutate: vi.fn(), isPending: false});
  hooks.role.mockReturnValue({isManager: false, role: 'reviewer', loading: false});
  hooks.mine.mockReturnValue({data: [HOST]});
  hooks.providers.mockReturnValue({data: [{id: 'openai', label: 'OpenAI'}, {id: 'anthropic', label: 'Anthropic'}, {id: 'google', label: 'Google'}, {id: 'openai_compatible', label: 'Custom host'}]});
});

describe('EngineGear', () => {
  it('names the effective engine in its tooltip and shows the project default line', async () => {
    renderGear();
    const gear = screen.getByRole('button', {name: t('llmConnections', 'gearAria')});
    await userEvent.hover(gear);
    expect(await screen.findAllByText(t('llmConnections', 'gearTooltip').replace('{{engine}}', 'GPT-4o mini'))).not.toHaveLength(0);
    await userEvent.click(gear);
    expect(screen.getByText(t('llmConnections', 'projectDefaultLine').replace('{{engine}}', 'GPT-4o mini'))).toBeInTheDocument();
  });

  it('renders the three scope tags and the needs-a-key row unselectable with a link out', async () => {
    renderGear();
    await userEvent.click(screen.getByTestId('engine-gear'));
    expect(screen.getByText(t('llmConnections', 'tagPrumo'))).toBeInTheDocument();
    expect(screen.getAllByText(t('llmConnections', 'tagYourKey')).length).toBeGreaterThan(0);
    const gemini = screen.getByText('Gemini Flash').closest('[role="option"]')!;
    expect(gemini).toHaveAttribute('aria-disabled', 'true');
    expect(within(gemini).getByText(t('llmConnections', 'tagNeedsKey'))).toBeInTheDocument();
    expect(screen.getByRole('link', {name: t('llmConnections', 'needsKeyLink')})).toHaveAttribute('href', '/settings?tab=integrations');
  });

  it('a pick writes the viewer row; the host group lists allowed models', async () => {
    renderGear();
    await userEvent.click(screen.getByTestId('engine-gear'));
    await userEvent.click(screen.getByText('llama3'));
    expect(setMutate).toHaveBeenCalledWith({provider: 'openai_compatible', model: 'llama3', mode: 'fast', connection_id: 'c1'}, expect.anything());
  });

  it('the mode toggle writes the effective pair with the new mode', async () => {
    renderGear();
    await userEvent.click(screen.getByTestId('engine-gear'));
    await userEvent.click(screen.getByRole('radio', {name: t('llmConnections', 'modeVerified')}));
    expect(setMutate).toHaveBeenCalledWith({provider: 'openai', model: 'gpt-4o-mini', mode: 'verified', connection_id: null}, expect.anything());
  });

  it('is read-only with the reason for a locked member, editable for a manager', async () => {
    hooks.engine.mockReturnValue({data: {...READ, default: {...READ.default, user_choice_allowed: false}}, isPending: false, isError: false, refetch: vi.fn()});
    renderGear();
    await userEvent.click(screen.getByTestId('engine-gear'));
    expect(screen.getByText(t('llmConnections', 'lockedReason'))).toBeInTheDocument();
    expect(screen.getByText('Claude Haiku').closest('[role="option"]')).toHaveAttribute('aria-disabled', 'true');
    hooks.role.mockReturnValue({isManager: true, role: 'manager', loading: false});
    renderGear();
    const gears = screen.getAllByTestId('engine-gear');
    await userEvent.click(gears[1]);
    expect(screen.queryByText(t('llmConnections', 'lockedReason'))).not.toBeInTheDocument();
  });

  it('shows the load-error line with a retry and keeps the gear mounted', async () => {
    const refetch = vi.fn();
    hooks.engine.mockReturnValue({data: undefined, isPending: false, isError: true, refetch});
    renderGear();
    await userEvent.click(screen.getByTestId('engine-gear'));
    await userEvent.click(screen.getByRole('button', {name: t('llmConnections', 'retry')}));
    expect(refetch).toHaveBeenCalled();
  });
});
```

The locked test renders twice; scope the second popover with `gears[1]` as written, or unmount between renders with the `unmount` handle from `render` — either is fine, the assertion is on the absence of the reason line for the manager.

- [ ] **Step 5: Copy keys**

Append to `frontend/lib/copy/llmConnections.ts`:

```ts
    // --- Worklist gear picker ---
    gearAria: 'Your engine for new runs',
    gearLoading: 'Loading…',
    gearTooltip: 'Your engine for new runs: {{engine}}',
    projectDefaultLine: 'Project default: {{engine}}',
    lockedReason: 'A project manager locked this project to its default engine.',
    pickerLoadError: "Couldn't load the engines.",
    pickerNoMatch: 'No engines match.',
    tagYourKey: 'your key',
    tagProjectKey: 'project key',
    tagPrumo: 'prumo',
    tagNeedsKey: 'needs a key',
    needsKeyLink: 'Add a key under Integrations',
    noHostsLink: 'Connect your own host under Integrations',
    hostGroupNote: 'Your host — runs on your connection',
    modeLabel: 'Mode',
    modeFast: 'Fast',
    modeVerified: 'Verified',
    followDefault: 'Follow the project default',
    retiredNote: 'This engine is no longer available. Pick a new model.',
    pickSuccess: 'Your engine for new runs is set.',
    pickError: 'Failed to set your engine',
```

- [ ] **Step 6: The gear**

```tsx
// frontend/components/extraction/EngineGear.tsx
/**
 * Worklist gear → "Your engine for new runs" (spec §5). Writes the VIEWER's
 * own row (`PUT /llm-engine/me`); the project default lives in Project
 * Settings. Rows are grouped by provider from the catalogue plus one group
 * per host the viewer owns; each row carries a scope tag from
 * `availability` — a row with none is not selectable and links to
 * Integrations, so a pick can never lead to a guaranteed 409 at kickoff.
 * The lock binds members, not managers; it is enforced server-side, this
 * surface only mirrors it. One row per (user, project): the extraction and
 * QA worklists edit the same choice.
 */
import {useState} from 'react';
import {Link} from 'react-router';
import {Cpu} from 'lucide-react';
import {toast} from 'sonner';

import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList} from '@/components/ui/command';
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';
import {Skeleton} from '@/components/ui/skeleton';
import {ToggleGroup, ToggleGroupItem} from '@/components/ui/toggle-group';
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from '@/components/ui/tooltip';
import {useClearMyEngine, useLlmEngine, useSetMyEngine} from '@/hooks/extraction/useLlmEngine';
import {useMyConnections, useProviders} from '@/hooks/user/useLlmConnections';
import {useProjectMemberRole} from '@/hooks/useProjectMemberRole';
import {t} from '@/lib/copy';
import type {LlmEngineCatalogEntry, LlmEngineRead} from '@/services/llmEngineService';

const INTEGRATIONS_ROUTE = '/settings?tab=integrations';

type Availability = LlmEngineRead['availability'][string];
const TAG_COPY: Record<NonNullable<Availability>, 'tagYourKey' | 'tagProjectKey' | 'tagPrumo'> = {
  user: 'tagYourKey',
  project: 'tagProjectKey',
  global: 'tagPrumo',
};

function engineLabel(read: LlmEngineRead): string {
  const {effective} = read;
  const entry = read.catalog.find((e) => e.provider === effective.provider && e.model === effective.model);
  return entry?.label ?? (effective.connection_label ? `${effective.connection_label} · ${effective.model}` : `${effective.provider}:${effective.model}`);
}

function defaultLabel(read: LlmEngineRead): string {
  const entry = read.catalog.find((e) => e.provider === read.default.provider && e.model === read.default.model);
  return entry?.label ?? `${read.default.provider}:${read.default.model}`;
}

function groupByProvider(catalog: LlmEngineCatalogEntry[]): Array<{provider: string; entries: LlmEngineCatalogEntry[]}> {
  const groups: Array<{provider: string; entries: LlmEngineCatalogEntry[]}> = [];
  for (const entry of catalog) {
    const group = groups.find((g) => g.provider === entry.provider);
    if (group) group.entries.push(entry);
    else groups.push({provider: entry.provider, entries: [entry]});
  }
  return groups;
}

export function EngineGear({projectId}: {projectId: string}) {
  const [open, setOpen] = useState(false);
  const engine = useLlmEngine(projectId);
  const setMine = useSetMyEngine(projectId);
  const clearMine = useClearMyEngine(projectId);
  const {isManager} = useProjectMemberRole(projectId);
  const mine = useMyConnections();
  const providers = useProviders();
  const read = engine.data;
  const locked = Boolean(read && !read.default.user_choice_allowed && !isManager);
  const providerLabel = (id: string) => providers.data?.find((p) => p.id === id)?.label ?? id;
  const hosts = (mine.data ?? []).filter((c) => c.base_url !== null && c.validation_status === 'ok');
  const tooltip = engine.isPending || !read ? t('llmConnections', 'gearLoading') : t('llmConnections', 'gearTooltip').replace('{{engine}}', engineLabel(read));

  const pick = (body: {provider: string; model: string; connection_id: string | null}) => {
    if (!read) return;
    setMine.mutate(
      {...body, mode: read.effective.mode},
      {
        onSuccess: () => toast.success(t('llmConnections', 'pickSuccess')),
        onError: () => toast.error(t('llmConnections', 'pickError')),
      },
    );
  };
  const setMode = (mode: string) => {
    if (!read || (mode !== 'fast' && mode !== 'verified')) return;
    setMine.mutate(
      {provider: read.effective.provider, model: read.effective.model, mode, connection_id: read.effective.connection_id ?? null},
      {onError: () => toast.error(t('llmConnections', 'pickError'))},
    );
  };
  const isCurrent = (provider: string, model: string, connectionId: string | null) =>
    Boolean(read && read.effective.provider === provider && read.effective.model === model && (read.effective.connection_id ?? null) === connectionId);

  return (
    <TooltipProvider>
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="p-0 rounded-md hover:bg-muted/50 text-muted-foreground" aria-label={t('llmConnections', 'gearAria')} data-testid="engine-gear">
                <Cpu className="h-4 w-4" strokeWidth={1.5} />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>{tooltip}</TooltipContent>
        </Tooltip>
        <PopoverContent align="end" className="w-80 p-0">
          {engine.isPending && (
            <div className="space-y-2 p-3" aria-busy="true"><Skeleton className="h-6 w-full" /><Skeleton className="h-6 w-full" /></div>
          )}
          {engine.isError && (
            <p className="flex items-center gap-2 p-3 text-[13px] text-destructive">
              {t('llmConnections', 'pickerLoadError')}
              <Button size="sm" variant="ghost" onClick={() => void engine.refetch()}>{t('llmConnections', 'retry')}</Button>
            </p>
          )}
          {read && (
            <Command>
              <div className="space-y-1 border-b border-border/40 px-3 py-2 text-[12px] text-muted-foreground">
                <p>{t('llmConnections', 'projectDefaultLine').replace('{{engine}}', defaultLabel(read))}</p>
                {locked && <p>{t('llmConnections', 'lockedReason')}</p>}
                {read.effective.retired && <p className="text-destructive">{t('llmConnections', 'retiredNote')}</p>}
                <div className="flex items-center gap-2">
                  <span>{t('llmConnections', 'modeLabel')}</span>
                  <ToggleGroup type="single" size="sm" value={read.effective.mode} onValueChange={setMode} disabled={locked} aria-label={t('llmConnections', 'modeLabel')}>
                    <ToggleGroupItem value="fast">{t('llmConnections', 'modeFast')}</ToggleGroupItem>
                    <ToggleGroupItem value="verified">{t('llmConnections', 'modeVerified')}</ToggleGroupItem>
                  </ToggleGroup>
                </div>
              </div>
              <CommandInput placeholder={t('llmConnections', 'gearAria')} />
              <CommandList>
                <CommandEmpty>{t('llmConnections', 'pickerNoMatch')}</CommandEmpty>
                {groupByProvider(read.catalog).map((group) => (
                  <CommandGroup key={group.provider} heading={providerLabel(group.provider)}>
                    {group.entries.map((entry) => {
                      const availability = read.availability[entry.provider] ?? null;
                      const selectable = availability !== null && !locked;
                      return (
                        <CommandItem key={entry.canonical} value={`${entry.label} ${entry.canonical}`} disabled={!selectable} aria-disabled={!selectable} data-current={isCurrent(entry.provider, entry.model, null)} onSelect={() => pick({provider: entry.provider, model: entry.model, connection_id: null})}>
                          <span className="flex-1">{entry.label}</span>
                          {availability ? (
                            <Badge variant="outline">{t('llmConnections', TAG_COPY[availability])}</Badge>
                          ) : (
                            <Badge variant="secondary">{t('llmConnections', 'tagNeedsKey')}</Badge>
                          )}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                ))}
                {hosts.map((host) => (
                  <CommandGroup key={host.id} heading={host.label}>
                    {host.allowed_models.map((model) => (
                      <CommandItem key={`${host.id}:${model}`} value={`${host.label} ${model}`} disabled={locked} aria-disabled={locked} data-current={isCurrent('openai_compatible', model, host.id)} onSelect={() => pick({provider: 'openai_compatible', model, connection_id: host.id})}>
                        <span className="flex-1">{model}</span>
                        <Badge variant="outline">{t('llmConnections', 'tagYourKey')}</Badge>
                      </CommandItem>
                    ))}
                    <p className="px-2 py-1 text-[11px] text-muted-foreground">{t('llmConnections', 'hostGroupNote')}</p>
                  </CommandGroup>
                ))}
              </CommandList>
              <div className="flex items-center justify-between border-t border-border/40 px-3 py-2 text-[12px]">
                {Object.values(read.availability).some((a) => a === null) ? (
                  <Link to={INTEGRATIONS_ROUTE} className="text-primary hover:underline">{t('llmConnections', 'needsKeyLink')}</Link>
                ) : hosts.length === 0 ? (
                  <Link to={INTEGRATIONS_ROUTE} className="text-primary hover:underline">{t('llmConnections', 'noHostsLink')}</Link>
                ) : <span />}
                {read.source === 'user' && !locked && (
                  <Button size="sm" variant="ghost" onClick={() => clearMine.mutate()}>{t('llmConnections', 'followDefault')}</Button>
                )}
              </div>
            </Command>
          )}
        </PopoverContent>
      </Popover>
    </TooltipProvider>
  );
}
```

- [ ] **Step 7: Mount on both worklists**

`ExtractionInterface.tsx` (`toolbarActions` at `:311-330`): wrap the existing export `TooltipProvider` block and `<EngineGear projectId={projectId} />` in a fragment `<>…</>` (gear after the export button; import `EngineGear` from `./EngineGear`). `QualityAssessmentInterface.tsx` (`toolbarActions` at `:246-265`): same fragment, same order. No other layout change; the tables already render `toolbarActions` in their loading/empty/populated branches.

Tests: append to `frontend/test/QualityAssessmentInterface.test.tsx` the hook mocks `vi.mock('@/hooks/extraction/useLlmEngine', …)` (returning the `READ` fixture from the gear test — copy the literal), `vi.mock('@/hooks/user/useLlmConnections', …)` (`useMyConnections: () => ({data: []})`, `useProviders: () => ({data: []})`) and one case:

```tsx
  it('mounts the engine gear on the QA worklist with the effective engine in its tooltip', async () => {
    renderInterface();
    const gear = await screen.findByTestId('engine-gear');
    await userEvent.hover(gear);
    expect((await screen.findAllByText(/Your engine for new runs: GPT-4o mini/)).length).toBeGreaterThan(0);
  });
```

Create `frontend/test/components/ExtractionInterface.gear.test.tsx`: mock `@/hooks/hitl/useProjectTemplates` (`useProjectTemplates: () => ({data: [{id: 'tpl-1', name: 'T', kind: 'extraction', is_active: true}], isLoading: false, error: null})`, `useInvalidateProjectTemplates: () => vi.fn()`), `@/hooks/extraction/useArticleExtractionValues` (`() => ({valuesByArticle: new Map()})`), `@/hooks/extraction/useActiveTemplateStructure` (`() => ({entityTypes: [], isLoading: false, isError: false})`), `@/hooks/extraction/useTemplateRepublish` (`useTemplateConfigCaches: () => ({invalidateAfterImport: vi.fn()})`), `@/hooks/useProjectMemberRole`, `@/contexts/AuthContext`, `@/services/articlesService` (`loadProjectArticles: vi.fn(() => new Promise(() => {}))`), `@/components/extraction/ArticleExtractionTable` (`ArticleExtractionTable: ({toolbarActions}) => <div data-testid="table-stub">{toolbarActions}</div>`), plus the three gear-hook mocks from above; render `<MemoryRouter><ExtractionInterface projectId="p1" /></MemoryRouter>` inside a `QueryClientProvider` and assert `await screen.findByTestId('engine-gear')` is inside `screen.getByTestId('table-stub')`. The table stub proves the interface hands the gear to the table's `toolbarActions`; the table's three branches already render that prop (code comments at `ArticleExtractionTable.tsx:588-591`, `:658-661`, `:715`).

- [ ] **Step 8: Run the suites and gates**

Run: `npx vitest run frontend/test/services/llmEngineService.test.ts frontend/test/hooks/useLlmEngine.test.tsx frontend/test/components/EngineGear.test.tsx frontend/test/components/ExtractionInterface.gear.test.tsx frontend/test/QualityAssessmentInterface.test.tsx && npm run typecheck && npm run lint && npx knip --no-tag-hints && npx knip --production --no-tag-hints && python3 scripts/fitness/check_copy_keys.py && python3 scripts/fitness/check_react_query_keys.py`
Expected: all PASS; knip 0 in both modes; copy gate 0 unreferenced.

- [ ] **Step 9: Commit**

```bash
git add frontend/services/llmEngineService.ts frontend/hooks/extraction/useLlmEngine.ts frontend/components/extraction/EngineGear.tsx frontend/components/extraction/ExtractionInterface.tsx frontend/components/quality/QualityAssessmentInterface.tsx frontend/lib/copy/llmConnections.ts frontend/test
git commit -m "feat(frontend): worklist gear — your engine for new runs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 18: Project Settings → AI engine card + Shared keys `[frontend]`

**Files:**

- Create: `frontend/components/project/settings/AiEngineSection.tsx`, `frontend/test/components/AiEngineSection.test.tsx`
- Modify: `frontend/services/llmEngineService.ts` (add `setLlmEngine`; export `LlmEngineUpdateRequest`), `frontend/hooks/extraction/useLlmEngine.ts` (add `useSetLlmEngine`), `frontend/services/llmConnectionsService.ts` (add `createProjectConnection`, `deleteProjectConnection`; export `ProjectConnectionCreateRequest`), `frontend/hooks/project/useProjectConnections.ts` (add `useCreateProjectConnection`, `useDeleteProjectConnection`), `frontend/lib/copy/llmConnections.ts` (append the card keys), `frontend/components/project/ProjectSettings.tsx:15-18,119-121` (mount next to `ReviewDetailsSection` on the review tab)

**Interfaces:**

- Consumes: `useLlmEngine`, `useProviders`, `useProjectConnections`, `useProjectMemberRole`, `SettingsCard` (`@/components/settings`), shadcn `Switch`, `Select`, `Input`, `Label`, `Button`, `Badge`, `Skeleton`, `AlertDialog`; MSW `server` (`frontend/test/mocks/server.ts`) in the test.
- Produces:
  - `llmEngineService.setLlmEngine(projectId, body: LlmEngineUpdateRequest): Promise<ErrorResult<LlmEngineRead>>` (PUT `/api/v1/projects/${projectId}/llm-engine`); `useSetLlmEngine(projectId)` (mutation; `setQueryData` + invalidate `projectKeys.llmEngine(projectId)`).
  - `llmConnectionsService.createProjectConnection(projectId, body: ProjectConnectionCreateRequest)` (POST `projectConnectionsPath(projectId)`), `deleteProjectConnection(projectId, id)` (DELETE `${projectConnectionsPath(projectId)}/${id}`); `useCreateProjectConnection(projectId)`, `useDeleteProjectConnection(projectId)` (invalidate `projectKeys.connections(projectId)` and `projectKeys.llmEngine(projectId)` — a shared key changes every member's `availability`).
  - `AiEngineSection({projectId})`: the card (project default select over the catalogue grouped by provider, mode toggle, lock `Switch`) and the *Shared keys* table (provider select limited to `scopes ∋ project`, each row and option tagged `serves` — `servesLlm` / `servesParsing` — key field, label field, Add, Remove with confirm). Manager: editable; non-manager: read-only card (default, mode, lock shown as text), no shared-keys table (`useProjectConnections(isManager ? projectId : null)`).
  - States (§5.3): card loading → `Skeleton`; table loading → skeleton rows; shared keys empty → `sharedEmpty` line with the Add action; each block renders its own `cardLoadError` / `sharedLoadError` line with `retry`, independently.
  - Copy keys added: `cardTitle`, `cardDescription`, `cardLoadError`, `defaultLabel`, `lockLabel`, `lockHint`, `lockedBadge`, `defaultSaveSuccess`, `defaultSaveError`, `sharedTitle`, `sharedDescription`, `sharedEmpty`, `sharedLoadError`, `sharedAddButton`, `sharedRemoveAria`, `sharedRemoveTitle`, `sharedRemoveDescription`, `sharedCreateSuccess`, `sharedCreateError`, `sharedRemoveSuccess`, `sharedRemoveError`, `servesLlm`, `servesParsing`.

- [ ] **Step 1: Write the failing section test (MSW, real client)**

```tsx
// frontend/test/components/AiEngineSection.test.tsx
/** §7.6: manager editable card + Shared keys; non-manager read-only, no table;
 * empty shared keys; independent load errors; add posts / remove deletes. */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {http, HttpResponse} from 'msw';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {TooltipProvider} from '@/components/ui/tooltip';
import {t} from '@/lib/copy';
import {server} from '../mocks/server';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getSession: vi.fn(async () => ({data: {session: {access_token: 'test-token'}}}))}},
}));
const role = vi.hoisted(() => ({isManager: true}));
vi.mock('@/hooks/useProjectMemberRole', () => ({
  useProjectMemberRole: () => ({isManager: role.isManager, role: role.isManager ? 'manager' : 'reviewer', loading: false}),
}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn()}}));

import {AiEngineSection} from '@/components/project/settings/AiEngineSection';

const ok = <T,>(data: T) => HttpResponse.json({ok: true, data});
const READ = {
  default: {provider: 'openai', model: 'gpt-4o-mini', mode: 'fast', source: 'project', retired: false, user_choice_allowed: true},
  effective: {provider: 'openai', model: 'gpt-4o-mini', mode: 'fast', source: 'project', retired: false, connection_id: null, connection_label: null},
  source: 'project',
  catalog: [{provider: 'openai', model: 'gpt-4o-mini', canonical: 'openai:gpt-4o-mini', label: 'GPT-4o mini', best_for: 'b', context_window: 1, cost_tier: '$'}],
  availability: {openai: 'global', anthropic: null, google: null, openai_compatible: null},
};
const PROVIDERS = [
  {id: 'openai', label: 'OpenAI', description: 'GPT', docs_url: 'https://x', needs_host: false, key_optional: false, scopes: ['project', 'user'], global_key_available: true},
  {id: 'llama_cloud', label: 'LlamaCloud', description: 'parsing', docs_url: 'https://y', needs_host: false, key_optional: false, scopes: ['project', 'user'], global_key_available: false},
  {id: 'openai_compatible', label: 'Custom host', description: 'h', docs_url: null, needs_host: true, key_optional: true, scopes: ['user'], global_key_available: false},
];
const SHARED = {id: 's1', scope: 'project', provider: 'llama_cloud', label: 'parsing key', base_url: null, has_api_key: true, allowed_models: [], capabilities: {output_mode: null, models_seen: []}, validation_status: 'unverified', last_validated_at: null, last_used_at: null, created_by_name: 'Alice', created_at: '2026-09-13T00:00:00Z'};

function renderSection() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}});
  return render(<QueryClientProvider client={client}><TooltipProvider><AiEngineSection projectId="p1" /></TooltipProvider></QueryClientProvider>);
}

beforeEach(() => {
  role.isManager = true;
  server.use(
    http.get('*/api/v1/projects/p1/llm-engine', () => ok(READ)),
    http.get('*/api/v1/me/providers', () => ok(PROVIDERS)),
    http.get('*/api/v1/projects/p1/connections', () => ok([SHARED])),
  );
});

describe('AiEngineSection', () => {
  it('a manager sees the editable default, mode, lock and the Shared keys table with serves tags', async () => {
    renderSection();
    expect(await screen.findByRole('switch', {name: t('llmConnections', 'lockLabel')})).not.toBeDisabled();
    const table = screen.getByRole('table');
    expect(within(table).getByText('parsing key')).toBeInTheDocument();
    expect(within(table).getByText(t('llmConnections', 'servesParsing'))).toBeInTheDocument();
  });

  it('a non-manager sees a read-only card and no shared-keys table', async () => {
    role.isManager = false;
    let projectListHits = 0;
    server.use(http.get('*/api/v1/projects/p1/connections', () => { projectListHits += 1; return ok([]); }));
    renderSection();
    expect(await screen.findByText('GPT-4o mini')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(projectListHits).toBe(0);
  });

  it('renders the empty shared-keys state', async () => {
    server.use(http.get('*/api/v1/projects/p1/connections', () => ok([])));
    renderSection();
    expect(await screen.findByText(t('llmConnections', 'sharedEmpty'))).toBeInTheDocument();
  });

  it('each block renders its own load error without blanking the other', async () => {
    server.use(http.get('*/api/v1/projects/p1/connections', () => HttpResponse.json({ok: false, error: {code: 'X', message: 'boom'}}, {status: 500})));
    renderSection();
    expect(await screen.findByText(t('llmConnections', 'sharedLoadError'))).toBeInTheDocument();
    expect(await screen.findByRole('switch', {name: t('llmConnections', 'lockLabel')})).toBeInTheDocument();
  });

  it('adding a shared key posts and the table refreshes; removing deletes', async () => {
    const posted: unknown[] = [];
    let rows: unknown[] = [];
    server.use(
      http.get('*/api/v1/projects/p1/connections', () => ok(rows)),
      http.post('*/api/v1/projects/p1/connections', async ({request}) => { posted.push(await request.json()); rows = [SHARED]; return ok(SHARED); }),
      http.delete('*/api/v1/projects/p1/connections/s1', () => { rows = []; return ok({deleted: true, id: 's1'}); }),
    );
    renderSection();
    await userEvent.click(await screen.findByRole('button', {name: t('llmConnections', 'sharedAddButton')}));
    await userEvent.type(screen.getByLabelText(t('llmConnections', 'labelLabel')), 'parsing key');
    await userEvent.type(screen.getByLabelText(t('llmConnections', 'keyLabel')), 'lc-1');
    await userEvent.click(screen.getByRole('button', {name: t('llmConnections', 'saveButton')}));
    await waitFor(() => expect(posted).toEqual([{provider: 'openai', label: 'parsing key', api_key: 'lc-1', base_url: null, allowed_models: []}]));
    expect(await screen.findByText('parsing key')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', {name: t('llmConnections', 'sharedRemoveAria')}));
    await userEvent.click(screen.getByRole('button', {name: t('llmConnections', 'removeConfirm')}));
    await waitFor(() => expect(screen.getByText(t('llmConnections', 'sharedEmpty'))).toBeInTheDocument());
  });

  it('toggling the lock PUTs the default with user_choice_allowed=false', async () => {
    const puts: unknown[] = [];
    server.use(http.put('*/api/v1/projects/p1/llm-engine', async ({request}) => { puts.push(await request.json()); return ok({...READ, default: {...READ.default, user_choice_allowed: false}}); }));
    renderSection();
    await userEvent.click(await screen.findByRole('switch', {name: t('llmConnections', 'lockLabel')}));
    await waitFor(() => expect(puts).toEqual([{provider: 'openai', model: 'gpt-4o-mini', mode: 'fast', user_choice_allowed: false}]));
  });
});
```

(`frontend/test/setup.ts` starts the MSW server with `onUnhandledRequest: 'error'`, so every route the section touches is handled above.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run frontend/test/components/AiEngineSection.test.tsx`
Expected: FAIL — unresolved import `@/components/project/settings/AiEngineSection`.

- [ ] **Step 3: Service, hooks, copy**

`llmEngineService.ts`: add `export type LlmEngineUpdateRequest = components['schemas']['LlmEngineUpdateRequest'];` and

```ts
export function setLlmEngine(projectId: string, body: LlmEngineUpdateRequest): Promise<ErrorResult<LlmEngineRead>> {
  return toResult(() => apiClient<LlmEngineRead>(enginePath(projectId), {method: 'PUT', body}), 'llmEngineService.setLlmEngine');
}
```

`useLlmEngine.ts`: `useSetLlmEngine(projectId)` — identical to `useSetMyEngine` with `setLlmEngine` and `LlmEngineUpdateRequest`. `llmConnectionsService.ts`: `export type ProjectConnectionCreateRequest = components['schemas']['ProjectConnectionCreateRequest'];` plus `createProjectConnection(projectId, body)` (POST `projectConnectionsPath(projectId)`) and `deleteProjectConnection(projectId, id)` (DELETE) shaped like `createMyConnection` / `deleteMyConnection`. `useProjectConnections.ts`: `useCreateProjectConnection(projectId)` / `useDeleteProjectConnection(projectId)` shaped like Task 10's mutations, invalidating `projectKeys.connections(projectId)` and `projectKeys.llmEngine(projectId)`.

Append to `frontend/lib/copy/llmConnections.ts`:

```ts
    // --- Project Settings → AI engine card + Shared keys ---
    cardTitle: 'AI engine',
    cardDescription: 'The project default for new runs. Members may pick their own engine unless locked.',
    cardLoadError: "Couldn't load the AI engine.",
    defaultLabel: 'Project default',
    lockLabel: 'Lock members to the project default',
    lockHint: 'Managers are never bound by the lock.',
    lockedBadge: 'Locked',
    defaultSaveSuccess: 'Project default updated.',
    defaultSaveError: 'Failed to update the project default',
    sharedTitle: 'Shared keys',
    sharedDescription: 'Keys every member of this project runs on when they have none of their own. LlamaCloud here enables high-quality parsing for everyone.',
    sharedEmpty: 'No shared keys yet',
    sharedLoadError: "Couldn't load the shared keys.",
    sharedAddButton: 'Add shared key',
    sharedRemoveAria: 'Remove shared key',
    sharedRemoveTitle: 'Remove this shared key?',
    sharedRemoveDescription: 'Members without a key of their own lose this provider until another key is added.',
    sharedCreateSuccess: 'Shared key added.',
    sharedCreateError: 'Failed to add the shared key',
    sharedRemoveSuccess: 'Shared key removed.',
    sharedRemoveError: 'Failed to remove the shared key',
    servesLlm: 'LLM',
    servesParsing: 'parsing',
```

- [ ] **Step 4: The section**

```tsx
// frontend/components/project/settings/AiEngineSection.tsx
/**
 * Project → Settings → review tab → AI engine card + Shared keys (spec §5).
 * The card writes the project DEFAULT (a catalogue pair), its mode and the
 * lock; the table is the project's hosted-provider keys — every provider
 * with "project" in its scopes, llama_cloud included, each tagged by what it
 * serves. Both reads load independently and fail independently.
 */
import {useState} from 'react';
import {Plus, Trash2} from 'lucide-react';
import {toast} from 'sonner';

import {AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger} from '@/components/ui/alert-dialog';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {Skeleton} from '@/components/ui/skeleton';
import {Switch} from '@/components/ui/switch';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {SettingsCard} from '@/components/settings';
import {useLlmEngine, useSetLlmEngine} from '@/hooks/extraction/useLlmEngine';
import {useCreateProjectConnection, useDeleteProjectConnection, useProjectConnections} from '@/hooks/project/useProjectConnections';
import {useProviders} from '@/hooks/user/useLlmConnections';
import {useProjectMemberRole} from '@/hooks/useProjectMemberRole';
import {t} from '@/lib/copy';
import type {LlmEngineRead} from '@/services/llmEngineService';
import type {ProviderRead} from '@/services/llmConnectionsService';

const SERVES_COPY = {llm: 'servesLlm', parsing: 'servesParsing'} as const;
const servesOf = (provider: ProviderRead | undefined) => (provider?.id === 'llama_cloud' ? 'parsing' : 'llm');

function EngineCard({projectId, read, isManager, providers}: {projectId: string; read: LlmEngineRead; isManager: boolean; providers: ProviderRead[]}) {
  const save = useSetLlmEngine(projectId);
  const label = (p: string, m: string) => read.catalog.find((e) => e.provider === p && e.model === m)?.label ?? `${p}:${m}`;
  const write = (patch: Partial<{provider: string; model: string; mode: 'fast' | 'verified'; user_choice_allowed: boolean}>) =>
    save.mutate(
      {provider: read.default.provider, model: read.default.model, mode: read.default.mode, user_choice_allowed: read.default.user_choice_allowed, ...patch},
      {onSuccess: () => toast.success(t('llmConnections', 'defaultSaveSuccess')), onError: () => toast.error(t('llmConnections', 'defaultSaveError'))},
    );
  const current = `${read.default.provider}:${read.default.model}`;
  return (
    <div className="space-y-3 text-[13px]">
      <div className="space-y-1.5">
        <Label htmlFor="engine-default" className="font-medium">{t('llmConnections', 'defaultLabel')}</Label>
        {isManager ? (
          <Select value={current} onValueChange={(v) => { const [provider, model] = v.split(':'); write({provider, model}); }}>
            <SelectTrigger id="engine-default" className="h-9 text-[13px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {read.catalog.map((e) => (
                <SelectItem key={e.canonical} value={e.canonical}>{e.label} <span className="text-[12px] text-muted-foreground">({providers.find((p) => p.id === e.provider)?.label ?? e.provider})</span></SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p id="engine-default">{label(read.default.provider, read.default.model)}{!read.default.user_choice_allowed && <Badge className="ml-2" variant="secondary">{t('llmConnections', 'lockedBadge')}</Badge>}</p>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className="font-medium">{t('llmConnections', 'modeLabel')}</span>
        {isManager ? (
          <Select value={read.default.mode} onValueChange={(v) => write({mode: v as 'fast' | 'verified'})}>
            <SelectTrigger className="h-8 w-32 text-[13px]" aria-label={t('llmConnections', 'modeLabel')}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="fast">{t('llmConnections', 'modeFast')}</SelectItem>
              <SelectItem value="verified">{t('llmConnections', 'modeVerified')}</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <span>{read.default.mode === 'verified' ? t('llmConnections', 'modeVerified') : t('llmConnections', 'modeFast')}</span>
        )}
      </div>
      {isManager && (
        <div className="flex items-center gap-3">
          <Switch id="engine-lock" checked={!read.default.user_choice_allowed} disabled={save.isPending} onCheckedChange={(checked) => write({user_choice_allowed: !checked})} aria-label={t('llmConnections', 'lockLabel')} />
          <Label htmlFor="engine-lock">{t('llmConnections', 'lockLabel')}</Label>
          <span className="text-[12px] text-muted-foreground">{t('llmConnections', 'lockHint')}</span>
        </div>
      )}
    </div>
  );
}

function SharedKeys({projectId, providers}: {projectId: string; providers: ProviderRead[]}) {
  const connections = useProjectConnections(projectId);
  const create = useCreateProjectConnection(projectId);
  const remove = useDeleteProjectConnection(projectId);
  const options = providers.filter((p) => p.scopes.includes('project'));
  const [adding, setAdding] = useState(false);
  const [provider, setProvider] = useState(options[0]?.id ?? 'openai');
  const [label, setLabel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const submit = () =>
    create.mutate(
      {provider, label, api_key: apiKey, base_url: null, allowed_models: []},
      {
        onSuccess: () => { toast.success(t('llmConnections', 'sharedCreateSuccess')); setAdding(false); setLabel(''); setApiKey(''); },
        onError: () => toast.error(t('llmConnections', 'sharedCreateError')),
      },
    );
  const addButton = <Button size="sm" onClick={() => setAdding(true)} disabled={adding}><Plus className="mr-1 h-4 w-4" strokeWidth={1.5} />{t('llmConnections', 'sharedAddButton')}</Button>;
  return (
    <div className="space-y-3">
      {connections.isPending && <div className="space-y-1"><Skeleton className="h-7 w-full" /><Skeleton className="h-7 w-full" /></div>}
      {connections.isError && (
        <p className="flex items-center gap-2 text-[13px] text-destructive">{t('llmConnections', 'sharedLoadError')}<Button size="sm" variant="ghost" onClick={() => void connections.refetch()}>{t('llmConnections', 'retry')}</Button></p>
      )}
      {connections.data && connections.data.length === 0 && !adding && (
        <p className="flex items-center gap-3 text-[13px] text-muted-foreground">{t('llmConnections', 'sharedEmpty')}{addButton}</p>
      )}
      {connections.data && connections.data.length > 0 && (
        <Table>
          <TableHeader><TableRow><TableHead>{t('llmConnections', 'labelLabel')}</TableHead><TableHead>{t('llmConnections', 'providerLabel')}</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {connections.data.map((row) => {
              const spec = providers.find((p) => p.id === row.provider);
              return (
                <TableRow key={row.id}>
                  <TableCell>{row.label}</TableCell>
                  <TableCell>{spec?.label ?? row.provider} <Badge variant="outline">{t('llmConnections', SERVES_COPY[servesOf(spec)])}</Badge></TableCell>
                  <TableCell className="text-right">
                    <AlertDialog>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label={t('llmConnections', 'sharedRemoveAria')}><Trash2 className="h-4 w-4" strokeWidth={1.5} /></Button>
                          </AlertDialogTrigger>
                        </TooltipTrigger>
                        <TooltipContent>{t('llmConnections', 'sharedRemoveAria')}</TooltipContent>
                      </Tooltip>
                      <AlertDialogContent>
                        <AlertDialogHeader><AlertDialogTitle>{t('llmConnections', 'sharedRemoveTitle')}</AlertDialogTitle><AlertDialogDescription>{t('llmConnections', 'sharedRemoveDescription')}</AlertDialogDescription></AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t('llmConnections', 'cancelButton')}</AlertDialogCancel>
                          <AlertDialogAction onClick={() => remove.mutate(row.id, {onSuccess: () => toast.success(t('llmConnections', 'sharedRemoveSuccess')), onError: () => toast.error(t('llmConnections', 'sharedRemoveError'))})}>{t('llmConnections', 'removeConfirm')}</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {adding ? (
        <form className="space-y-3 rounded-md border border-border/40 p-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div className="space-y-1.5">
            <Label htmlFor="shared-provider" className="text-[13px] font-medium">{t('llmConnections', 'providerLabel')}</Label>
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger id="shared-provider" className="h-9 text-[13px]"><SelectValue placeholder={t('llmConnections', 'providerPlaceholder')} /></SelectTrigger>
              <SelectContent>
                {options.map((p) => (<SelectItem key={p.id} value={p.id}>{p.label} <span className="text-[12px] text-muted-foreground">({t('llmConnections', SERVES_COPY[servesOf(p)])})</span></SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="shared-label" className="text-[13px] font-medium">{t('llmConnections', 'labelLabel')}</Label>
            <Input id="shared-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('llmConnections', 'labelPlaceholder')} className="h-9 text-[13px]" maxLength={80} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="shared-key" className="text-[13px] font-medium">{t('llmConnections', 'keyLabel')}</Label>
            <Input id="shared-key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={t('llmConnections', 'keyPlaceholder')} className="h-9 text-[13px]" />
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={create.isPending || label === '' || apiKey === ''}>{create.isPending ? t('llmConnections', 'saving') : t('llmConnections', 'saveButton')}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>{t('llmConnections', 'cancelButton')}</Button>
          </div>
        </form>
      ) : (connections.data?.length ?? 0) > 0 || connections.isError ? addButton : null}
    </div>
  );
}

export function AiEngineSection({projectId}: {projectId: string}) {
  const {isManager} = useProjectMemberRole(projectId);
  const engine = useLlmEngine(projectId);
  const providers = useProviders();
  const providerRows = providers.data ?? [];
  return (
    <>
      <SettingsCard title={t('llmConnections', 'cardTitle')} description={t('llmConnections', 'cardDescription')}>
        {engine.isPending && <Skeleton className="h-20 w-full" />}
        {engine.isError && (
          <p className="flex items-center gap-2 text-[13px] text-destructive">{t('llmConnections', 'cardLoadError')}<Button size="sm" variant="ghost" onClick={() => void engine.refetch()}>{t('llmConnections', 'retry')}</Button></p>
        )}
        {engine.data && <EngineCard projectId={projectId} read={engine.data} isManager={isManager} providers={providerRows} />}
      </SettingsCard>
      {isManager && (
        <SettingsCard title={t('llmConnections', 'sharedTitle')} description={t('llmConnections', 'sharedDescription')}>
          <SharedKeys projectId={projectId} providers={providerRows} />
        </SettingsCard>
      )}
    </>
  );
}
```

`servesOf` reads `serves` off the registry: `/me/providers` does not carry `serves` (§4 field list), so the card derives it from the id — `llama_cloud` is the only parsing provider (registry §1). Mount: in `ProjectSettings.tsx` import `AiEngineSection` and render `<AiEngineSection projectId={projectId} />` directly under `ReviewDetailsSection` inside the `activeTab === 'review'` branch (wrap both in a fragment). The shadcn `table` primitives are `@/components/ui/table`.

- [ ] **Step 5: Run the suites and gates**

Run: `npx vitest run frontend/test/components/AiEngineSection.test.tsx frontend/test/hooks/useLlmConnections.test.tsx frontend/test/hooks/useLlmEngine.test.tsx && npm run typecheck && npm run lint && npx knip --no-tag-hints && npx knip --production --no-tag-hints && python3 scripts/fitness/check_copy_keys.py`
Expected: all PASS; knip 0 in both modes; copy gate 0 unreferenced. Then `/design-review /projects/<a local project id>/settings` (review tab) per `.claude/rules/frontend.md` — screenshot, compare with the sibling cards' density, fix, re-screenshot.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/project frontend/services frontend/hooks frontend/lib/copy/llmConnections.ts frontend/test/components/AiEngineSection.test.tsx
git commit -m "feat(frontend): project AI engine card with lock and shared keys

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 19: Final cleanup — gates, baselines, docs `[backend]`

**Files:**

- Modify: `.claude/rules/backend.md:47-53` (the Row-in-parent guard list gains `llm_connection_service.owned_user_connection` and `owned_project_connection`), `docs/ROADMAP.md:24`, `backend/.vulture_baseline` (tighten if the ratchet reports clean rows), `scripts/fitness/check_copy_keys.baseline` (must have shrunk by four rows in total: three `user.ts:apiKeys*` in Task 10, `llmEngine.ts:alternatesAddLabel` in Task 11), `backend/tests/integration/test_migration_roundtrip.py` (head pin already `0073_drop_legacy_credentials`)
- Verify only: `frontend/types/api/{openapi.json,schema.d.ts}`, `frontend/integrations/supabase/types.ts`

**Interfaces:**

- Consumes: everything above.
- Produces: a green `make quality-scan`; the PR.

- [ ] **Step 1: Docs**

`.claude/rules/backend.md`, Row-in-parent list: add `llm_connection_service.owned_user_connection` (user-scope connection) and `llm_connection_service.owned_project_connection` (project-scope connection) — "Need a new pair? Add ONE guard" now has these two examples for owner-scoped rows. `docs/ROADMAP.md:24`: replace "connections + per-user engine follow as slice 2" with "Slice 2 (connections + per-user engine) — see docs/superpowers/plans/2026-09-12-llm-provider-registry-slice2.md; audit + rate limits remain."

- [ ] **Step 2: Grep for stragglers**

Run: `grep -rn "user_api_keys\|project_llm_endpoints\|APIKeyService\|LlmEndpointService\|user-api-keys\|llm-endpoints\|endpoint_id\|byok_only\|alternates\|storable_providers\|is_byok_only\|SHARED_ENDPOINT\|LlmEngineChip\|apiKeysService\|llmEndpointService" backend/app frontend .claude/rules scripts/fitness --include=*.py --include=*.ts --include=*.tsx --include=*.md --include=*.baseline -l`
Expected: only `backend/alembic/versions/0073_drop_legacy_credentials.py` (the drop), `backend/alembic/versions/0055_project_llm_endpoints.py` / `0071_registry_providers.py` / `baseline_v1.sql` (history), and `frontend/types/api/*` if a stale generation slipped — regenerate if so. Anything else is a miss: fix it here.

- [ ] **Step 3: The full deterministic gate**

Run: `make db-fresh && make test-backend` from the repo root (local Supabase up), then `make quality-scan`.
Expected: backend suite green (summary line); `scripts/verify_all.sh` reports every gate OK — `alembic check`, vulture ratchet, `check_scope_guards` (baseline five rows shorter), `check_copy_keys`, knip (both modes), typecheck, vitest, Playwright, `check_layered_arch`, `check_rls_coverage`, `api-contract` (no diff after `bash scripts/generate_api_types.sh`). If the vulture gate lists baseline rows now clean, run, from `backend/`, `uv run vulture > vulture.out || true` then `uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --input vulture.out --update` (the invocation documented at `scripts/vulture_baseline.py:20-28`), delete `vulture.out`, and commit the tightened baseline.

- [ ] **Step 4: Run the settings E2E flow locally**

Run: `npm run test:e2e:local -- frontend/e2e/flows/settings-connections.e2e.ts`
Expected: both cases pass (the first skips without `E2E_USER_EMAIL` / `E2E_USER_PASSWORD`).

- [ ] **Step 5: Commit and open the PR**

```bash
git add .claude/rules/backend.md docs/ROADMAP.md backend/.vulture_baseline
git commit -m "docs: register the connection ownership guards; link slice 2

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Open ONE PR to `dev` titled `feat(llm): connections and per-user engine (slice 2)`; the body lists: the two new tables and the two dropped ones (0072/0073), the two new routers and the two deleted ones, `/llm-engine/me`, the three surfaces, the gate deltas (scope-guard baseline −5, copy baseline −4, vulture unchanged or tightened), and "prod: the Railway deploy runs `alembic upgrade head` — 0073 is destructive by design (spec §Non-goals: no active users)". Run `/code-review` before marking ready. Merge-train rule: arm auto-merge only when no other PR into `dev` is armed. Then `/ship-spec --to prod` continues with the promotion.

---

## Self-review

- **Spec coverage.** See the table below; every slice-2 section maps to a task. §1 residue (§1.2) is spread over Tasks 1, 15 and 16 as each stand-in loses its last consumer; §2's single migration is delivered as 0072 (create) + 0073 (drop + strip) so every task is green — the end state is byte-for-byte §2's list. `llmEngine.ts` is deleted whole (Task 11) rather than trimmed: the tree has no reference to any of its keys outside the retiring components (`grep -rn "llmEngine\." frontend` returns only `AiConfigDialog.tsx`, whose Model tab retires), so "what the run form's `effective` rendering and the typed 409s still reference" is the empty set — the run form reads provenance data-driven and the 409 copy lives in the backend messages.
- **Placeholders.** None: every code step carries its code; "copy the shape of" instructions were replaced by full listings (Task 8); the two test-file copies (Task 2 Step 7 RLS probe) name the exact source file and the exact substitutions.
- **Type consistency.** `owned_user_connection(db, connection_id, user_id)` / `owned_project_connection(db, connection_id, project_id)` (Task 4) are called with that order in Tasks 6, 12–15; `resolve_provider_key(session, *, provider, project_id, user_id)` (Task 5) in Tasks 5, 13; `resolve_engine(db, project_id, user_id)` (Task 14) in Tasks 14–15; `resolve_engine_for_run(db, *, run_id, project_id, repin, user_id)` in Tasks 13–14; `make_host_connection(db, *, user_id, label, base_url, api_key, allowed_models, validation_status, output_mode)` (Task 12) in Tasks 13–14; `LlmEngineRead.{default,effective,source,catalog,availability}` (Task 15) matches the frontend fixtures in Tasks 17–18; `UserEngineUpdateRequest {provider, model, mode, connection_id}` (Task 15) matches `setMyEngine` bodies in Task 17; `KeyScope` is imported from `app.services.llm_connection_service` everywhere after Task 5.
- **Green after every task.** Additive backend first (1–8), additive frontend (9–10), frontend removals before the backend rename regenerates types (11 → 12), spine + credentials (13), resolution (14), read shape (15), legacy deletion (16), new frontend surfaces (17–18), gates (19). Each task's last step runs the touched suites, `ruff`, and — where a route or schema changed — `bash scripts/generate_api_types.sh && npm run typecheck`.

## Spec coverage

| spec § | task |
|---|---|
| §1 `scopes`, `key_optional` on `ProviderSpec` | 1 (consumers: 3, 7, 2) |
| §1.1 catalogue as YAML, `deprecated`, pyyaml | 1 |
| §1.2 `storable_providers` retired | 16 (last consumers deleted) |
| §1.2 `is_byok_only` + `byok_only` field + tests retired | 15 |
| §1.2 `provider_ids` baseline row + comment | 16 |
| §1.2 registry docstring; `test_registry` CHECK tests retargeted | 15 (docstring), 2 (the `llm_connections` drift + mutation tests), 16 (the `user_api_keys` tests go with the model) |
| §1.2 `KeyScope.SHARED_ENDPOINT` read tolerance | 5 (enum), 13 (legacy-snapshot test) |
| §1.2 repository/router unit tests deleted; 0071 live-DB assertions retired | 16 |
| §2 `llm_connections` table, constraints, deny-all posture | 2 |
| §2 `user_project_engines` | 2 |
| §2 drop inventory (tables, function, policies, grants, models, repository) | 16 |
| §2 llama_cloud parsing key re-homed (worker, docstring, frontend toggle) | 5 (backend), 9 (frontend) |
| §2 `alternates` stripped by migration; writers stop | 16 (migration), 12 (backend writer), 11 (frontend writer) |
| §3.1 stored shapes: `connection_id`, `user_choice_allowed`, no `alternates`; `LlmTarget.deviation` | 12, 13 |
| §3.2 `resolve_engine` at every call site; `resolve_engine_for_run(user_id)`; dead worker entry deleted; test-side seams | 14 (call sites), 13 (dead entry + seams) |
| §3.3 connection service, guards, `resolve_provider_key`, `resolve_engine_credentials` one path, `rekey_for_adopted_engine` | 3, 4, 5, 13 |
| §4 `/me/connections…`, `/me/providers` | 7 |
| §4 `/projects/{id}/connections…` | 8 |
| §4 verify (probe ladder / cheap authenticated call) | 6 |
| §4 engine read (`default`, `effective`, `source`, `availability`), `PUT` default + lock, `PUT`/`DELETE …/llm-engine/me` | 15 (routes), 12 (lock on the PUT) |
| §4 old routes deleted; OpenAPI regenerated | 16 (and every route-touching task) |
| §5 Integrations → AI connections | 10 |
| §5 worklist gear + picker (both tables, all three branches) | 17 |
| §5 AI engine card + Shared keys (`serves` tag, llama_cloud) | 18 |
| §5 AI configuration dialog loses its Model tab; chip/dialogs retired | 11 |
| §5.1 removal sites (components, tests, `AiConfigTab`, backend tests) | 11 (frontend), 16 (backend) |
| §5.2 copy namespace; retiring keys removed | 10, 17, 18 (new keys); 10, 11 (removals) |
| §5.3 surface states | 10, 17, 18 |
| §6 error outcomes (409s, 422s, 403, probe `failed`) | 13 (unavailable 409), 14 (retired 409, 403, 422), 3 (schema 422s), 12 (default `connection_id` 422), 6 (probe) |
| §7.2 resolution order tests | 14 |
| §7.3 ownership tests; scope-guard baseline shrink | 4, 14 (tests), 16 (baseline) |
| §7.4 provenance compatibility | 13 |
| §7.5 API tests: scope rules, secret absent, lock 403, default 422, `/me/providers` payload, `availability` map, parsing key path, migration strips `alternates` | 7, 8, 12, 15, 5, 16 |
| §7.6 frontend tests: scope tags, needs-a-key row, mode toggle, lock, gear on both worklists, two-tab dialog, E2E rewrite, `AiEngineSection` cases | 17, 11, 10, 18 |
| §7.7 catalogue file tests | 1 |
| §7.8 gates: knip, copy ratchet, vulture, `alembic check`, scope-guard baseline, head pin, `provider_ids` row, docstring | 2, 16, 19 (and each deletion task) |
