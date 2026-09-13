"""T1 — the server-curated engine catalogue (§5, C1b).

The roster is deliberately small, curated data: a roster edit is a one-line
diff. These tests pin the invariants the rest of the surface leans on —
pair uniqueness (the canonical string is an identifier), lookup semantics,
and the guarantee that every listed provider is one ``build_model`` accepts
(a roster entry that cannot reach the wire is a lie in the picker).
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml
from pydantic import ValidationError

from app.core.config import settings
from app.llm import catalog as catalog_module
from app.llm.catalog import (
    CATALOG,
    CatalogEntry,
    CatalogRow,
    canonical,
    find_entry,
    load_catalog,
    selectable_catalog,
)
from app.llm.provider import build_model
from app.llm.registry import get_provider, llm_provider_ids

_VALID_COST_TIERS = {"$", "$$", "$$$"}
_MODELS_DIR = Path(catalog_module.__file__).parent / "models"


def test_catalog_pairs_are_unique() -> None:
    pairs = [(entry.provider, entry.model) for entry in CATALOG]
    assert len(pairs) == len(set(pairs)), "duplicate (provider, model) pair in CATALOG"


def test_catalog_is_not_empty() -> None:
    assert CATALOG, "an empty catalogue would make every stored engine retired"


def test_find_entry_returns_the_matching_entry() -> None:
    entry = CATALOG[0]
    assert find_entry(entry.provider, entry.model) is entry


def test_find_entry_misses_unknown_model() -> None:
    assert find_entry("openai", "not-a-model") is None


def test_find_entry_misses_unknown_provider() -> None:
    assert find_entry("not-a-provider", CATALOG[0].model) is None


def test_canonical_is_provider_colon_model() -> None:
    entry = CatalogEntry(
        provider="openai",
        model="gpt-4o-mini",
        label="GPT-4o mini",
        best_for="tests",
        context_window=128_000,
        cost_tier="$",
    )
    assert canonical(entry) == "openai:gpt-4o-mini"


def test_cost_tiers_are_valid() -> None:
    assert all(entry.cost_tier in _VALID_COST_TIERS for entry in CATALOG)


def test_default_engine_is_in_the_catalog() -> None:
    """A default that falls off the roster reads as retired and blocks every
    project that never chose an engine (typed 409 at kickoff)."""
    assert find_entry(settings.LLM_PROVIDER, settings.LLM_DEFAULT_MODEL) is not None


@pytest.mark.parametrize(
    "entry", CATALOG, ids=lambda e: f"{e.provider}:{e.model}" if isinstance(e, CatalogEntry) else e
)
def test_every_entry_is_buildable(entry: CatalogEntry) -> None:
    """Every provider in the roster is one ``build_model`` accepts.

    Construction only — ``conftest`` sets ``ALLOW_MODEL_REQUESTS = False``,
    so no request can leave the process.
    """
    model = build_model(entry.provider, entry.model, api_key="sk-test-not-real")
    assert model is not None


def test_every_catalog_provider_is_a_registry_llm_provider() -> None:
    for entry in CATALOG:
        spec = get_provider(entry.provider)
        assert spec is not None and spec.serves == "llm"


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
