"""Server-curated catalogue of selectable extraction engines (§5, C1b).

The single place that says which (provider, model) pairs a project manager
may pick in the ⚙ popover. Deliberately small, curated data — a roster edit
is a one-line diff here, and a pair dropped from this tuple is *retired*:
projects still storing it are blocked from new runs (typed 409) until a
manager picks a new model.

``byok_only`` is a fact on the entry (not an implicit branch elsewhere):
providers without a global service key (`app.services.api_key_service.
APIKeyService._get_global_key`) run exclusively on each user's own stored
key. Keep the flag in sync when a global key is introduced for a provider.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class CatalogEntry:
    """One selectable engine: identity pair + the copy the picker renders."""

    provider: str
    model: str
    label: str
    best_for: str
    context_window: int
    cost_tier: Literal["$", "$$", "$$$"]
    byok_only: bool = False


CATALOG: tuple[CatalogEntry, ...] = (
    CatalogEntry(
        provider="openai",
        model="gpt-5.6-luna",
        label="GPT-5.6 Luna",
        best_for="Fast, low-cost default for routine extraction",
        context_window=1_050_000,
        cost_tier="$",
    ),
    CatalogEntry(
        provider="openai",
        model="gpt-5.6-terra",
        label="GPT-5.6 Terra",
        best_for="Balanced reasoning and cost on dense or ambiguous articles",
        context_window=1_050_000,
        cost_tier="$$",
    ),
    CatalogEntry(
        provider="openai",
        model="gpt-5.6-sol",
        label="GPT-5.6 Sol",
        best_for="Frontier reasoning for the hardest extractions",
        context_window=1_050_000,
        cost_tier="$$$",
    ),
    CatalogEntry(
        provider="openai",
        model="gpt-4o-mini",
        label="GPT-4o mini",
        best_for="Previous-generation budget option kept for existing projects",
        context_window=128_000,
        cost_tier="$",
    ),
    CatalogEntry(
        provider="anthropic",
        model="claude-sonnet-5",
        label="Claude Sonnet 5",
        best_for="High-quality reasoning and grounded evidence",
        context_window=1_000_000,
        cost_tier="$$",
        byok_only=True,
    ),
    CatalogEntry(
        provider="anthropic",
        model="claude-haiku-4-5",
        label="Claude Haiku 4.5",
        best_for="Fast Claude option for high-volume extraction",
        context_window=200_000,
        cost_tier="$",
        byok_only=True,
    ),
    CatalogEntry(
        provider="anthropic",
        model="claude-opus-5",
        label="Claude Opus 5",
        best_for="Deepest Claude reasoning for complex or degraded articles",
        context_window=1_000_000,
        cost_tier="$$$",
        byok_only=True,
    ),
)


def find_entry(provider: str, model: str) -> CatalogEntry | None:
    """The catalogue entry for an exact (provider, model) pair, or ``None``.

    ``None`` is the *retired* signal: stored engines are validated against
    the catalogue on write, so a miss on read means the roster moved on.
    """
    for entry in CATALOG:
        if entry.provider == provider and entry.model == model:
            return entry
    return None


def canonical(entry: CatalogEntry) -> str:
    """The ``provider:model`` string provenance carries (§5)."""
    return f"{entry.provider}:{entry.model}"
