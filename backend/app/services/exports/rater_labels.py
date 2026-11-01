"""The project's rater label map (§6, D4): Member letters and display names.

PURE. Lives directly under ``exports/`` for the same import-cycle reason as
``cell_record``: the export service imports it at load time.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable
from datetime import datetime
from typing import Final
from uuid import UUID

# The reserved ``rater`` literal on consensus rows; no person's label may equal it.
CONSENSUS_RATER: Final[str] = "consensus"

# (actor_id, earliest decision at, full_name, email)
ActorRow = tuple[UUID, datetime, str | None, str | None]


def label_raters(
    rows: Iterable[ActorRow], *, anonymize: bool, named_only: UUID | None
) -> dict[UUID, str]:
    """Letter every actor ``Member A, B, …`` by earliest decision (ties by id),
    then name the allowed ones: nobody when ``anonymize``, only ``named_only``
    when set, else everybody. Colliding names get an id suffix."""
    ordered = sorted(rows, key=lambda r: (r[1], str(r[0])))
    labels = {r[0]: f"Member {letter_for(i)}" for i, r in enumerate(ordered)}
    if anonymize:
        return labels
    names = {
        aid: full_name or email or short_id(aid)
        for aid, _, full_name, email in ordered
        if named_only is None or aid == named_only
    }
    taken = Counter(n.casefold() for n in names.values())
    taken.update(label.casefold() for aid, label in labels.items() if aid not in names)
    for aid, name in names.items():
        clash = taken[name.casefold()] > 1 or name.casefold() == CONSENSUS_RATER
        labels[aid] = f"{name} {short_id(aid)}" if clash else name
    # Short ids can collide too (8 hex chars); the full id cannot.
    suffixed = Counter(label.casefold() for label in labels.values())
    for aid, name in names.items():
        if suffixed[labels[aid].casefold()] > 1:
            labels[aid] = f"{name} {aid}"
    return labels


def short_id(value: UUID) -> str:
    return str(value).split("-")[0]


def letter_for(idx: int) -> str:
    """Convert ``0 → A``, ``1 → B``, … ``25 → Z``, ``26 → AA``."""
    if idx < 0:
        return "?"
    out = ""
    n = idx
    while True:
        out = chr(ord("A") + (n % 26)) + out
        n = n // 26 - 1
        if n < 0:
            break
    return out
