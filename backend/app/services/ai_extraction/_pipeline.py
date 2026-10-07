"""The per-request state of one AI extraction, and the reads every step shares.

One :class:`Pipeline` per ``AiExtraction``: the frozen engine and its
credentials, the article text assembled once per run (with the parsed blocks
evidence is anchored to), the run-pinned entity tree, and the memoized
field filter and entry chains. The section steps (``_sections``), the model
calls (``_model_calls``) and the candidate build (``_candidates``) take it
as their one collaborator; writes go through its :class:`ProposalLanding`.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import get_logger
from app.infrastructure.parsing.base import ParsedBlock
from app.infrastructure.storage import StorageAdapter
from app.llm.extractor import StructuredCall
from app.llm.prompts import Ancestor
from app.llm.provider import build_model
from app.models.extraction import ExtractionRun
from app.models.extraction_workflow import (
    ExtractionProposalRecord,
    ExtractionProposalSource,
    ExtractionReviewerDecision,
    ExtractionReviewerDecisionType,
    ExtractionReviewerState,
)
from app.repositories import (
    ArticleFileRepository,
    ExtractionEntityTypeRepository,
    ExtractionInstanceRepository,
    ExtractionRunRepository,
)
from app.schemas.llm_target import LlmTarget
from app.services.ai_extraction.landing import ProposalLanding
from app.services.engine_credentials import EngineCredentials, rekey_for_adopted_engine
from app.services.extraction_prompt_input import PromptInputInfo, build_prompt_input
from app.services.extraction_snapshot import entity_types_for_version
from app.services.llm_field_filter import LlmFieldFilter, build_llm_field_filter
from app.services.run_engine_freeze import freeze_run_engine, read_attempt_engine

#: The settled reviewer decisions that protect a field from a re-run.
_SETTLED = {
    ExtractionReviewerDecisionType.EDIT.value,
    ExtractionReviewerDecisionType.ACCEPT_PROPOSAL.value,
}


class Pipeline:
    """Shared state and reads for one AI extraction request."""

    def __init__(
        self,
        db: AsyncSession,
        *,
        user_id: str,
        storage: StorageAdapter,
        trace_id: str,
        credentials: EngineCredentials | None,
        key_provider: str | None,
        repin: bool,
        attempt_id: UUID | None,
        owns_transactions: bool,
        llm: StructuredCall,
    ) -> None:
        self.db = db
        self.user_id = user_id
        self.storage = storage
        self.trace_id = trace_id
        self.attempt_id = attempt_id
        self.llm = llm
        self.logger = get_logger("AiExtraction")
        self.credentials = credentials or EngineCredentials(None, None, None, None, None)
        self._key_provider = key_provider
        self._repin = repin
        self._owns_transactions = owns_transactions
        self.article_files = ArticleFileRepository(db)
        self.entity_types = ExtractionEntityTypeRepository(db)
        self.instances = ExtractionInstanceRepository(db)
        self.runs = ExtractionRunRepository(db)
        self.landing = ProposalLanding(
            db, user_id=user_id, trace_id=trace_id, owns_transactions=owns_transactions
        )
        # The env-default candidate until a caller passes a resolved engine;
        # ``adopt_frozen_engine`` rebinds it to the run's pin before any call.
        self.engine = LlmTarget(provider=settings.LLM_PROVIDER, model=settings.LLM_DEFAULT_MODEL)
        #: Assembly of the run's article text (anchor blocks, truncation,
        #: source file) — set once per run by :meth:`assemble_prompt_text`.
        self.prompt_input: PromptInputInfo | None = None
        #: Enclosing-entry chains per ``(run, instance)`` — ``_ancestry``.
        self.ancestry: dict[tuple[UUID, UUID], tuple[Ancestor, ...]] = {}
        self._field_filter = LlmFieldFilter()
        self._filter_run_id: UUID | None = None

    @property
    def anchor_blocks(self) -> list[ParsedBlock]:
        return self.prompt_input.anchor_blocks if self.prompt_input else []

    @property
    def anchor_file_id(self) -> UUID | None:
        return self.prompt_input.anchor_file_id if self.prompt_input else None

    async def adopt_frozen_engine(
        self, run_id: UUID, candidate: LlmTarget, project_id: UUID
    ) -> str:
        """Freeze-or-read the run's engine, adopt it, return its model.

        Adoption can settle on a DIFFERENT engine than the caller resolved
        credentials for (the run's pin wins — the standalone path REUSES the
        coordinate's live run, whose pin can predate a manager's engine
        flip). ``rekey_for_adopted_engine`` owns the identity check and hands
        back a WHOLE credential; storing the provider keeps a later adoption
        from double-keying. Under ``repin`` the freeze installs ``candidate``,
        so adoption is a no-op. An attempt's own frozen engine always wins.
        """
        if self.attempt_id is not None:
            self.engine = await read_attempt_engine(self.db, self.attempt_id)
            await freeze_run_engine(self.runs, run_id, self.engine, repin=True)
        else:
            self.engine = await freeze_run_engine(self.runs, run_id, candidate, repin=self._repin)
        rekeyed = await rekey_for_adopted_engine(
            self.db,
            user_id=self.user_id,
            project_id=project_id,
            engine=self.engine,
            current=self.credentials,
            keyed_for=self._key_provider,
        )
        if rekeyed is not None:
            self.credentials = rekeyed
            self._key_provider = self.engine.provider
            self.logger.info(
                "section_extraction_rekeyed_for_pinned_engine",
                trace_id=self.trace_id,
                provider=self.engine.provider,
                connection_id=self.engine.connection_id,
                key_scope=rekeyed.key_scope.value if rekeyed.key_scope is not None else None,
            )
        return self.engine.model

    async def before_external_work(self) -> None:
        """A worker-owned session commits before storage, parsing and every
        model call, so no run lock is held across external work."""
        if self._owns_transactions:
            await self.db.commit()

    def wire_model(self) -> Any:
        """The model client for the frozen engine on the resolved credentials
        — ONE site, because key, host and probed output mode travel together
        (a key alone posts an endpoint key to the cloud; a dropped mode sends
        a host a response_format its probe showed it ignores). The verify pass
        builds its model here too, so verified mode runs the same way."""
        return build_model(
            self.engine.provider,
            self.engine.model,
            api_key=self.credentials.api_key,
            base_url=self.credentials.base_url,
            output_mode=self.credentials.output_mode,
        )

    async def assemble_prompt_text(self, article_id: UUID, model: str) -> str:
        """Budgeted block-markdown prompt input; keeps its assembly info.

        Storage download and parsing are external work: the run row the entry
        gate locked (``open_run_for_write``) is released first."""
        await self.before_external_work()
        text, info = await build_prompt_input(
            db=self.db,
            article_files=self.article_files,
            storage=self.storage,
            article_id=article_id,
            model=model,
            logger=self.logger,
            user_id=self.user_id,
            trace_id=self.trace_id,
        )
        self.prompt_input = info
        return text

    async def pinned_entity_types(self, run: ExtractionRun) -> list[Any]:
        """The frozen tree this run is pinned to (shared B-2 provider)."""
        return await entity_types_for_version(
            self.db, version_id=run.version_id, template_id=run.template_id
        )

    async def entity_type_on_run(
        self, run: ExtractionRun, entity_type_id: UUID
    ) -> tuple[Any, bool]:
        """``(row, from_pin)``: the pinned row when the id is in the run's pin,
        else the template-scoped live row (re-pin race) — never a bare get."""
        pinned = await self.pinned_entity_types(run)
        entity_type: Any = next((et for et in pinned if et.id == entity_type_id), None)
        if entity_type is not None:
            return entity_type, True
        live = await self.entity_types.get_with_fields(entity_type_id)
        if not live or live.project_template_id != run.template_id:
            raise ValueError(f"Entity type not found: {entity_type_id}")
        return live, False

    async def live_field_intersection(self, entity_type: Any) -> list[Any] | None:
        """Snapshot fields ∩ live field ids for one pinned entity type.

        ``None`` means the entity type no longer exists live (skip — a
        proposal write could not resolve it anyway). The field NAME is the
        write-layer bridge: the model answers with the prompt's property key
        and the candidate build resolves it against LIVE names, so a field
        renamed live carries the LIVE name into the prompt while the semantic
        content (label, description, llm_description) stays pinned.
        """
        live = await self.entity_types.get_with_fields(entity_type.id)
        if live is None:
            return None
        live_by_id = {f.id: f for f in (live.fields or [])}
        result: list[Any] = []
        for field in entity_type.fields:
            live_field = live_by_id.get(field.id)
            if live_field is None:
                continue
            if field.name != live_field.name:
                field = field.model_copy(update={"name": live_field.name})
            result.append(field)
        return result

    async def field_filter(self, run: ExtractionRun) -> LlmFieldFilter:
        """What the model may see for *run*, memoised: building it reads the
        live template, and extract-all walks ~16 sections."""
        if self._filter_run_id != run.id:
            self._field_filter = await build_llm_field_filter(self.db, run)
            self._filter_run_id = run.id
        return self._field_filter

    async def fields_left_for(
        self, run: ExtractionRun, instance_id: UUID, fields: list[Any]
    ) -> list[Any]:
        """``fields`` minus those a human already settled on this instance.

        Settled on EITHER track: a latest ``human`` proposal (the QA surface
        still holds these) or a committed ``edit`` / ``accept_proposal``
        reviewer decision (the collapsed ``extract`` lifecycle routes human
        extraction values to per-reviewer decisions). Any reviewer's settled
        decision protects the field — AI proposals are shared across
        reviewers; ``reject`` leaves it open. Never mutates ``fields`` — the
        live ORM collection cascades delete-orphan.
        """
        field_ids = [f.id for f in fields]
        if not field_ids:
            return []
        settled = await self._latest_human_proposals(run.id, instance_id, field_ids)
        settled |= await self._settled_decisions(run.id, instance_id, field_ids)
        return [f for f in fields if f.id not in settled]

    async def _latest_human_proposals(
        self, run_id: UUID, instance_id: UUID, field_ids: list[UUID]
    ) -> set[UUID]:
        rows = (
            await self.db.execute(
                select(ExtractionProposalRecord.field_id, ExtractionProposalRecord.source)
                .where(
                    ExtractionProposalRecord.run_id == run_id,
                    ExtractionProposalRecord.instance_id == instance_id,
                    ExtractionProposalRecord.field_id.in_(field_ids),
                )
                .order_by(
                    ExtractionProposalRecord.field_id,
                    ExtractionProposalRecord.created_at.desc(),
                )
            )
        ).all()
        seen: set[UUID] = set()
        human: set[UUID] = set()
        for field_id, source in rows:
            if field_id in seen:
                continue
            seen.add(field_id)
            if source == ExtractionProposalSource.HUMAN.value:
                human.add(field_id)
        return human

    async def _settled_decisions(
        self, run_id: UUID, instance_id: UUID, field_ids: list[UUID]
    ) -> set[UUID]:
        rows = (
            await self.db.execute(
                select(ExtractionReviewerState.field_id, ExtractionReviewerDecision.decision)
                .join(
                    ExtractionReviewerDecision,
                    and_(
                        ExtractionReviewerDecision.run_id == ExtractionReviewerState.run_id,
                        ExtractionReviewerDecision.id
                        == ExtractionReviewerState.current_decision_id,
                    ),
                )
                .where(
                    ExtractionReviewerState.run_id == run_id,
                    ExtractionReviewerState.instance_id == instance_id,
                    ExtractionReviewerState.field_id.in_(field_ids),
                )
            )
        ).all()
        return {field_id for field_id, decision in rows if decision in _SETTLED}
