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
