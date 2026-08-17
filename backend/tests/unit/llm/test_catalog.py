"""T1 — the server-curated engine catalogue (§5, C1b).

The roster is deliberately small, curated data: a roster edit is a one-line
diff. These tests pin the invariants the rest of the surface leans on —
pair uniqueness (the canonical string is an identifier), lookup semantics,
and the guarantee that every listed provider is one ``build_model`` accepts
(a roster entry that cannot reach the wire is a lie in the picker).
"""

from __future__ import annotations

import pytest

from app.core.config import settings
from app.llm.catalog import CATALOG, CatalogEntry, canonical, find_entry
from app.llm.provider import build_model

_VALID_COST_TIERS = {"$", "$$", "$$$"}


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
