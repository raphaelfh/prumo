"""The current run for a (project, article, template) coordinate — the one
resolver. The ranking itself is stated once, in
``app.repositories.current_run_repository``.

Readers:

* ``current_by_article`` / ``current_by_template`` — the current run, a
  cancelled one included: export, the agent reads and the MCP article status
  count a cancelled coordinate as such;
* ``resolve`` / ``resolve_by_article`` — the resolved run (live, else
  finalized): what the extraction form shows.

Writers, both under the coordinate's ``(article, template)`` advisory lock so
their SELECT-then-INSERT cannot race (the 0045 index backstops any path that
skips it):

* ``open_for_session`` — the HITL session's run: the resolved run (a finalized
  one is shown read-only, never forked), else a new one;
* ``resolve_or_create_extract`` — standalone AI extraction's run: the live run,
  else a new one; a live run in consensus raises ``RunBusyError``.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any
from uuid import UUID

from sqlalchemy import Select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRun, ExtractionRunStage
from app.repositories.current_run_repository import current_runs, resolved_runs
from app.services.advisory_locks import take_advisory_xact_lock
from app.services.run_lifecycle_service import RunLifecycleService


class RunBusyError(Exception):
    """The coordinate's live run cannot accept the requested work (AI
    extraction against a run already advanced to CONSENSUS)."""


class CurrentRunResolver:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def _load(self, stmt: Select[tuple[ExtractionRun]]) -> Sequence[ExtractionRun]:
        # populate_existing: a run already in the identity map is refreshed, so
        # the caller's stage checks see the row the ranking saw, not a copy a
        # raw UPDATE (or another statement) has since made stale.
        return (
            (await self.db.execute(stmt.execution_options(populate_existing=True))).scalars().all()
        )

    async def current_by_article(
        self, *, project_id: UUID, template_id: UUID, article_ids: Sequence[UUID]
    ) -> dict[UUID, ExtractionRun]:
        """The current run (cancelled included) per article that has one."""
        if not article_ids:
            return {}
        stmt = current_runs(
            ExtractionRun.article_id,
            ExtractionRun.project_id == project_id,
            ExtractionRun.template_id == template_id,
            ExtractionRun.article_id.in_(article_ids),
        )
        return {run.article_id: run for run in await self._load(stmt)}

    async def current_by_template(
        self, *, project_id: UUID, article_id: UUID
    ) -> dict[UUID, ExtractionRun]:
        """The current run (cancelled included) per template the article has one on."""
        stmt = current_runs(
            ExtractionRun.template_id,
            ExtractionRun.project_id == project_id,
            ExtractionRun.article_id == article_id,
        )
        return {run.template_id: run for run in await self._load(stmt)}

    async def resolve_by_article(
        self, *, project_id: UUID, template_id: UUID, article_ids: Sequence[UUID]
    ) -> dict[UUID, ExtractionRun]:
        """The resolved run (live, else finalized) per article that has one."""
        if not article_ids:
            return {}
        stmt = resolved_runs(
            ExtractionRun.article_id,
            ExtractionRun.project_id == project_id,
            ExtractionRun.template_id == template_id,
            ExtractionRun.article_id.in_(article_ids),
        )
        return {run.article_id: run for run in await self._load(stmt)}

    async def resolve(
        self, *, project_id: UUID, article_id: UUID, template_id: UUID
    ) -> ExtractionRun | None:
        """The coordinate's resolved run: live, else finalized, else None."""
        resolved = await self.resolve_by_article(
            project_id=project_id, template_id=template_id, article_ids=[article_id]
        )
        return resolved.get(article_id)

    async def open_for_session(
        self,
        *,
        project_id: UUID,
        article_id: UUID,
        template_id: UUID,
        user_id: UUID,
        parameters: dict[str, Any],
    ) -> tuple[ExtractionRun, bool]:
        """The run a HITL session exposes: the resolved run, else a new one; a
        pending run is parked in EXTRACT. A finalized run is returned as is —
        forking past it would silently abandon its published values; reopen is
        its own explicit action. ``created`` is True only for a new row."""
        await take_advisory_xact_lock(self.db, article_id, template_id)
        lifecycle = RunLifecycleService(self.db)
        run = await self.resolve(
            project_id=project_id, article_id=article_id, template_id=template_id
        )
        created = run is None
        if run is None:
            run = await lifecycle.create_run(
                project_id=project_id,
                article_id=article_id,
                project_template_id=template_id,
                user_id=user_id,
                parameters=parameters,
            )
        if run.stage == ExtractionRunStage.PENDING.value:
            run = await lifecycle.advance_stage(
                run_id=run.id, target_stage=ExtractionRunStage.EXTRACT, user_id=user_id
            )
        return run, created

    async def resolve_or_create_extract(
        self,
        *,
        project_id: UUID,
        article_id: UUID,
        template_id: UUID,
        user_id: UUID,
        parameters: dict[str, Any] | None = None,
    ) -> tuple[ExtractionRun, bool]:
        """The live run in EXTRACT for standalone AI extraction, created only
        when the coordinate has none — AI work lands on the run the reviewer
        is editing instead of forking a shadow run. A live run in CONSENSUS
        raises ``RunBusyError``: adjudication accepts no new AI proposals.

        ``created=True`` → the caller owns the run's lifecycle
        (start/complete/fail); ``created=False`` → session-owned, hands off.
        """
        await take_advisory_xact_lock(self.db, article_id, template_id)
        lifecycle = RunLifecycleService(self.db)
        run = await self.resolve(
            project_id=project_id, article_id=article_id, template_id=template_id
        )
        if run is not None and run.stage in ExtractionRunStage.live():
            if run.stage == ExtractionRunStage.CONSENSUS.value:
                raise RunBusyError(
                    f"Run {run.id} is in consensus; AI extraction can only "
                    "target a run in the extract stage"
                )
            if run.stage == ExtractionRunStage.PENDING.value:
                run = await lifecycle.advance_stage(
                    run_id=run.id, target_stage=ExtractionRunStage.EXTRACT, user_id=user_id
                )
            return run, False

        run = await lifecycle.create_run(
            project_id=project_id,
            article_id=article_id,
            project_template_id=template_id,
            user_id=user_id,
            parameters=parameters,
        )
        run = await lifecycle.advance_stage(
            run_id=run.id, target_stage=ExtractionRunStage.EXTRACT, user_id=user_id
        )
        return run, True
