"""The recording fake for ``app.services.ai_usage_metering.UsageSink``.

Tests that build ``AiExtraction`` on ``db_session`` inject a
:class:`RecordingUsageSink`: every ``record(...)`` call is kept in memory and
nothing is written, so no ledger row lands on the shared test connection.
Durability is proven separately, with ``LedgerSink`` on its own engine.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from app.llm.extractor import LlmUsage
from app.llm.pass_kinds import PassKind
from app.services.ai_usage_metering import UsageContext


@dataclass(frozen=True)
class UsageEntry:
    """One recorded ``record(...)`` call."""

    ctx: UsageContext
    pass_kind: PassKind
    prompt_version: str
    usage: LlmUsage
    outcome: Literal["ok", "failed"]


@dataclass
class RecordingUsageSink:
    """Keeps every metered call; writes nothing."""

    entries: list[UsageEntry] = field(default_factory=list)

    async def record(
        self,
        ctx: UsageContext,
        *,
        pass_kind: PassKind,
        prompt_version: str,
        usage: LlmUsage,
        outcome: Literal["ok", "failed"],
    ) -> None:
        self.entries.append(UsageEntry(ctx, pass_kind, prompt_version, usage, outcome))

    def ok_sum(self) -> dict[str, int]:
        """``{prompt, completion, total}`` over the ``ok`` entries."""
        ok = [e.usage for e in self.entries if e.outcome == "ok"]
        prompt = sum(u.prompt_tokens for u in ok)
        completion = sum(u.completion_tokens for u in ok)
        return {"prompt": prompt, "completion": completion, "total": prompt + completion}
