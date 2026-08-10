"""Publish the live template structure as a new active version.

Template configuration edits (sections/fields/flags) are written by the
frontend through the Supabase client, so they never pass through the API
— and until this service existed, nothing ever refreshed
``extraction_template_versions.schema_``. Every run (including brand-new
ones) kept rendering the schema frozen at clone time.

``republish`` closes that gap: it snapshots the live structure into a NEW
version row (v+1, active), leaves prior rows untouched (runs from
``consensus`` on stay pinned to the schema they were assessed under),
re-pins runs still in an editable stage (``pending`` / ``extract``) so
open extraction/QA forms pick up the edit, and materializes the singleton
instances a re-pinned run needs for any newly added section (otherwise
the ADR-0009 finalize gate — which counts required fields per EXISTING
instance — would silently skip the new section).
"""

from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any, cast
from uuid import UUID

from fastapi import status
from sqlalchemy import CursorResult, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_handler import AppError
from app.domain.template_change import DiffStatus
from app.models.extraction import (
    ExtractionEntityType,
    ExtractionRun,
    ExtractionRunStage,
    ProjectExtractionTemplate,
)
from app.models.extraction_versioning import ExtractionTemplateVersion
from app.schemas.hitl_session import (
    TemplateChangeAck,
    TemplatePublishRefusalCode,
    TemplatePublishRefusalDetails,
)
from app.services.advisory_locks import take_advisory_xact_lock
from app.services.extraction_snapshot import build_template_version_snapshot
from app.services.hitl_session_service import HITLSessionService
from app.services.template_clone_service import (
    PendingConfigDraftError,
    TemplateNotFoundError,
)
from app.services.template_section_service import has_multi_entry_parent
from app.services.template_version_read_service import get_template_config_diff

__all__ = [
    "PendingConfigDraftError",
    "PublishBlockedByMultiEntryError",
    "PublishDiffDriftedError",
    "PublishMissingAcknowledgementError",
    "RepublishResult",
    "TemplateNotFoundError",
    "TemplateVersionService",
]


class PublishBlockedByMultiEntryError(AppError):
    """Publish refused: a cardinality-one model_section still has a
    parent entry holding 2+ instances.

    409-class (B-8 review): the many->one flip is validated at PATCH
    time, but a reviewer on a run still pinned to the old 'many'
    snapshot can add a second entry between PATCH and Publish (the
    pinned frontend skips the cardinality check and no DB constraint
    guards article-less rows). Publishing would re-pin those runs to
    the 'one' snapshot, whose run view renders only ``instances[0]``
    while the completion gate counts every instance — leaving the run
    permanently un-completable. Re-checked under the template row FOR
    UPDATE; the message names every offending section.

    An ``AppError`` since B-9b0 D1 so the republish endpoint can let it
    reach ``app_error_handler`` instead of flattening it to
    ``HTTPException(409, str(e))``, which dropped the code and the labels
    the Publish button needs to compose its own sentence."""

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        # By keyword, so ``AppError.__init__``'s ``super().__init__(message)``
        # still runs and ``str(exc)`` stays the message every existing
        # assertion reads (the ``_DiscardRefusal`` precedent).
        super().__init__(
            code=TemplatePublishRefusalCode.PUBLISH_BLOCKED_BY_MULTI_ENTRY,
            message=message,
            status_code=status.HTTP_409_CONFLICT,
            details=details,
        )


class PublishDiffDriftedError(AppError):
    """Publish refused: the projection moved since the sheet was rendered.

    Recoverable, unlike its siblings — the client re-renders from the
    ``fingerprint`` in ``details`` and asks the manager to re-acknowledge.
    Also raised when the client sent NO fingerprint for a diff the server
    can compute, which is the same situation: a sheet nobody looked at."""

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(
            code=TemplatePublishRefusalCode.PUBLISH_DIFF_DRIFTED,
            message=message,
            status_code=status.HTTP_409_CONFLICT,
            details=details,
        )


class PublishMissingAcknowledgementError(AppError):
    """Publish refused: a DESTRUCTIVE row was never ticked.

    ``details.row_ids`` names every one, sorted, for the same reason the
    many->one refusal names every section: one-at-a-time discovery turns a
    single fix into a publish-read-fix-publish loop."""

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(
            code=TemplatePublishRefusalCode.PUBLISH_MISSING_ACKNOWLEDGEMENT,
            message=message,
            status_code=status.HTTP_409_CONFLICT,
            details=details,
        )


_EDITABLE_STAGES = (
    ExtractionRunStage.PENDING.value,
    ExtractionRunStage.EXTRACT.value,
)


class RepublishResult:
    """Result envelope returned by ``TemplateVersionService.republish``."""

    def __init__(
        self,
        *,
        version_id: UUID,
        version: int,
        changed: bool,
        repinned_run_count: int,
    ) -> None:
        self.version_id = version_id
        self.version = version
        self.changed = changed
        self.repinned_run_count = repinned_run_count


class TemplateVersionService:
    """Owns the template-version publish lifecycle for project templates."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def republish(
        self,
        *,
        project_id: UUID,
        project_template_id: UUID,
        user_id: UUID,
        fail_if_pending_draft: bool = False,
        enforce_publish_contract: bool = False,
        expected_fingerprint: str | None = None,
        acknowledged: Sequence[TemplateChangeAck] = (),
        note: str | None = None,
    ) -> RepublishResult:
        # BOLA defense (unlocked read): validate ownership before taking any
        # lock, so a caller who is only a manager elsewhere can never lock —
        # or even match — a foreign project's template row.
        owned = (
            await self.db.execute(
                select(ProjectExtractionTemplate.id).where(
                    ProjectExtractionTemplate.id == project_template_id,
                    ProjectExtractionTemplate.project_id == project_id,
                )
            )
        ).scalar_one_or_none()
        if owned is None:
            raise TemplateNotFoundError(f"Template {project_template_id} not found")

        run_pairs = await self.acquire_publish_locks(project_template_id)

        if fail_if_pending_draft:
            # Authoritative pending-draft check, UNDER the row FOR UPDATE:
            # callers' unlocked pre-checks are TOCTOU-racy — a stamp that
            # committed after their read is visible here and must refuse
            # rather than be silently published (B-4). Callers whose own
            # transaction deliberately stamped (clone fresh/zero-state
            # rebuilds) must NOT pass this flag.
            pending = (
                await self.db.execute(
                    select(ProjectExtractionTemplate.config_draft_since).where(
                        ProjectExtractionTemplate.id == project_template_id
                    )
                )
            ).scalar_one()
            if pending is not None:
                raise PendingConfigDraftError()

        # Publish-time re-validation of the many->one rule (B-8 review),
        # under the same locks as the snapshot build and BEFORE anything
        # is written, so it guards BOTH branches below (changed and
        # unchanged-but-repinned). The PATCH-time check in
        # template_section_service saw the instances that existed THEN;
        # reviewers on runs still pinned to the old 'many' snapshot can
        # add entries until this publish re-pins them.
        await self._refuse_if_one_section_has_multi_entries(project_template_id)

        # The publish contract (B-9b2b), under the same locks and BEFORE the
        # marker UPDATE below: a refusal must not leave config_draft_since
        # cleared for a publish that never happened.
        #
        # Driven by an explicit flag, never inferred from "did the caller
        # pass a fingerprint": with every parameter defaulted, inferring it
        # would mean a bodyless POST silently skipped the whole check. The
        # endpoint passes True; the clone/restore callers keep the default,
        # exactly like fail_if_pending_draft above.
        if enforce_publish_contract:
            await self._refuse_if_publish_contract_unmet(
                project_id=project_id,
                project_template_id=project_template_id,
                expected_fingerprint=expected_fingerprint,
                acknowledged=acknowledged,
            )

        # Publishing makes the live tree the recorded intent — clear the
        # B-4 draft marker under the same locks as the snapshot build.
        # Runs in BOTH branches below (changed and unchanged): a marker
        # set by a snapshot-identical edit chain (A→B→A) must still
        # clear, or the Draft chip sticks with a dead Publish button.
        await self.db.execute(
            update(ProjectExtractionTemplate)
            .where(ProjectExtractionTemplate.id == project_template_id)
            # B-9f: the editor lock dies with the draft it guarded —
            # leaving a holder behind would show "being edited by …" over
            # a template that has no draft at all.
            .values(config_draft_since=None, config_draft_by=None)
        )

        snapshot = await build_template_version_snapshot(self.db, project_template_id)

        current = (
            await self.db.execute(
                select(ExtractionTemplateVersion).where(
                    ExtractionTemplateVersion.project_template_id == project_template_id,
                    ExtractionTemplateVersion.is_active.is_(True),
                )
            )
        ).scalar_one_or_none()

        if current is not None and current.schema_ == snapshot:
            # Nothing changed — don't spawn version rows, but still re-pin:
            # runs created before this service existed may sit on an older
            # version even though the active snapshot is current.
            repinned = await self._repin_editable_runs(project_template_id, current.id)
            if repinned:
                await self._materialize_singleton_instances(
                    project_template_id=project_template_id,
                    run_pairs=run_pairs,
                    user_id=user_id,
                )
            return RepublishResult(
                version_id=current.id,
                version=current.version,
                changed=False,
                repinned_run_count=repinned,
            )

        max_version = (
            await self.db.execute(
                select(func.max(ExtractionTemplateVersion.version)).where(
                    ExtractionTemplateVersion.project_template_id == project_template_id
                )
            )
        ).scalar_one()
        if current is not None:
            # The partial unique index (one active per template) is checked
            # on flush — deactivate before inserting the successor.
            current.is_active = False
            await self.db.flush()

        new_version = ExtractionTemplateVersion(
            project_template_id=project_template_id,
            version=(max_version or 0) + 1,
            schema_=snapshot,
            published_at=datetime.now(UTC),
            published_by=user_id,
            is_active=True,
            # Only this branch has a row to carry it. A note on a no-op
            # publish is dropped — `changed=False` is the signal, and the
            # sheet says so rather than swallowing it silently. Rewriting
            # the CURRENT row's note instead would attribute prose to a
            # version someone else published.
            note=note,
        )
        self.db.add(new_version)
        await self.db.flush()

        repinned = await self._repin_editable_runs(project_template_id, new_version.id)
        await self._materialize_singleton_instances(
            project_template_id=project_template_id,
            run_pairs=run_pairs,
            user_id=user_id,
        )
        return RepublishResult(
            version_id=new_version.id,
            version=new_version.version,
            changed=True,
            repinned_run_count=repinned,
        )

    async def _refuse_if_publish_contract_unmet(
        self,
        *,
        project_id: UUID,
        project_template_id: UUID,
        expected_fingerprint: str | None,
        acknowledged: Sequence[TemplateChangeAck],
    ) -> None:
        """What the manager saw must still be true, or the publish refuses.

        The Publish sheet is computed lock-free by design, so between render
        and click the projection can move three ways: another manager edits
        the tree, a concurrent publish moves the baseline (the live tree
        stays byte-identical — which is why the fingerprint covers the
        PROJECTION, not the snapshot), or a reviewer records one answer and
        a row escalates to DESTRUCTIVE with the template untouched.

        Scope, stated honestly: this closes the render->click window, not
        the one inside this transaction. ``take_advisory_xact_lock`` is
        taken by publish, ``open_or_resume`` and run creation — never by the
        value-write path, so under READ COMMITTED a reviewer's answer can
        still commit between this recompute and our COMMIT. The narrowest
        destructive case is closed by the database anyway: every workflow
        ``field_id`` FK is RESTRICT, so a field holding recorded work cannot
        be deleted at all.

        A ``baseline_too_old`` template cannot be gated — no diff is
        computable against a narrow pre-0026 baseline, so there are no rows
        and no acks. That heals itself: the version written below is built
        from LIVE rows, so the next publish has a wide baseline and is fully
        gated.
        """
        diff = await get_template_config_diff(
            self.db, project_id=project_id, template_id=project_template_id
        )
        if diff.status is not DiffStatus.AVAILABLE:
            return

        if expected_fingerprint != diff.fingerprint:
            # Covers a None fingerprint too: a client that sent none for a
            # diff we CAN compute is a client that published a sheet nobody
            # looked at.
            raise PublishDiffDriftedError(
                "The pending changes moved since this sheet was rendered.",
                details=TemplatePublishRefusalDetails(fingerprint=diff.fingerprint).model_dump(
                    mode="json", exclude_defaults=True
                ),
            )

        # (id, tier) pairs, not bare ids: tier is deliberately absent from
        # the composite id, so a row that escalated since the render fails
        # to match and reads as unacknowledged.
        ticked = {(ack.id, ack.tier) for ack in acknowledged}
        missing = sorted(
            row.id for row in diff.changes.destructive if (row.id, row.tier) not in ticked
        )
        if missing:
            raise PublishMissingAcknowledgementError(
                f"{len(missing)} destructive change(s) were not acknowledged.",
                details=TemplatePublishRefusalDetails(row_ids=missing).model_dump(
                    mode="json", exclude_defaults=True
                ),
            )

    async def acquire_publish_locks(self, project_template_id: UUID) -> list[tuple[UUID, UUID]]:
        """Advisory (article, template) locks for editable-stage runs —
        sorted, FIRST — then the template row FOR UPDATE.

        Lock ordering mirrors HITLSessionService.open_or_resume: it holds
        the advisory lock while create_run takes the template row FOR
        SHARE; taking the template FOR UPDATE before the advisory locks
        would invert that order and deadlock. Idempotent within a
        transaction, so a caller that must hold the locks BEFORE writing
        live rows (the clone service's zero-state rebuild — its mark-draft
        trigger stamps take the template-row lock) can take them early;
        ``republish`` re-takes them harmlessly.

        Returns the (project_id, article_id) pairs of editable-stage runs
        for the instance-materialization pass.
        """
        run_pairs: list[tuple[UUID, UUID]] = [
            (row.project_id, row.article_id)
            for row in (
                await self.db.execute(
                    select(ExtractionRun.project_id, ExtractionRun.article_id)
                    .where(
                        ExtractionRun.template_id == project_template_id,
                        ExtractionRun.stage.in_(_EDITABLE_STAGES),
                    )
                    .distinct()
                )
            ).all()
        ]
        for _, article_id in sorted(run_pairs, key=lambda pair: str(pair[1])):
            await take_advisory_xact_lock(self.db, article_id, project_template_id)

        # Serialization: FOR UPDATE so two concurrent republishes cannot both
        # compute the same next version number (unique on
        # (project_template_id, version)), and so run creation (FOR SHARE on
        # this row) cannot pin a version this transaction is deactivating.
        await self.db.execute(
            select(ProjectExtractionTemplate.id)
            .where(ProjectExtractionTemplate.id == project_template_id)
            .with_for_update()
        )
        return run_pairs

    async def _refuse_if_one_section_has_multi_entries(self, project_template_id: UUID) -> None:
        """Raise ``PublishBlockedByMultiEntryError`` naming EVERY live
        cardinality-one model_section that still has a parent entry
        holding 2+ instances (the shared ``has_multi_entry_parent``
        query — the exact predicate the PATCH-time check enforces).

        B-9b0 D2: ordered, and raised once AFTER the loop. The select had
        no ``ORDER BY`` and the raise sat inside the loop, so with two
        flipped sections the manager was told about whichever one the heap
        yielded first — and only learned about the second by fixing that
        one and publishing again.
        """
        one_sections = (
            await self.db.execute(
                select(ExtractionEntityType.id, ExtractionEntityType.label)
                .where(
                    ExtractionEntityType.project_template_id == project_template_id,
                    ExtractionEntityType.role == "model_section",
                    ExtractionEntityType.cardinality == "one",
                )
                .order_by(ExtractionEntityType.sort_order, ExtractionEntityType.id)
            )
        ).all()
        offenders = [
            section_label
            for section_id, section_label in one_sections
            if await has_multi_entry_parent(self.db, section_id=section_id)
        ]
        if not offenders:
            return

        noun, verb = ("section", "is") if len(offenders) == 1 else ("sections", "are")
        listed = "; ".join(f'"{label}"' for label in offenders)
        raise PublishBlockedByMultiEntryError(
            f"Cannot publish: {noun} {listed} {verb} set to repeat once per "
            "entry, but an entry already has multiple items. Remove the extra "
            "items and publish again.",
            # JSON primitives only: ``app_error_handler`` renders ``details``
            # through a bare ``JSONResponse``, so anything else would raise
            # INSIDE the handler and reach the client as a 500.
            details=TemplatePublishRefusalDetails(section_labels=offenders).model_dump(
                mode="json", exclude_defaults=True
            ),
        )

    async def _repin_editable_runs(self, project_template_id: UUID, version_id: UUID) -> int:
        result = await self.db.execute(
            update(ExtractionRun)
            .where(
                ExtractionRun.template_id == project_template_id,
                ExtractionRun.stage.in_(_EDITABLE_STAGES),
                ExtractionRun.version_id != version_id,
            )
            .values(version_id=version_id)
        )
        # execute() types the return as Result[Any]; an UPDATE yields a
        # CursorResult at runtime, which carries rowcount.
        return cast("CursorResult[Any]", result).rowcount or 0

    async def _materialize_singleton_instances(
        self,
        *,
        project_template_id: UUID,
        run_pairs: list[tuple[UUID, UUID]],
        user_id: UUID,
    ) -> None:
        """Seed missing cardinality-one instances for every re-pinned run.

        Reuses ``HITLSessionService.ensure_instances`` (the session-open
        seeding path) per affected article; idempotent, and the advisory
        lock it re-takes is already held by this transaction.
        """
        if not run_pairs:
            return
        entity_types = list(
            (
                await self.db.execute(
                    select(ExtractionEntityType)
                    .where(ExtractionEntityType.project_template_id == project_template_id)
                    .order_by(ExtractionEntityType.sort_order)
                )
            )
            .scalars()
            .all()
        )
        session_service = HITLSessionService(self.db)
        for run_project_id, article_id in run_pairs:
            await session_service.ensure_instances(
                project_id=run_project_id,
                article_id=article_id,
                project_template_id=project_template_id,
                entity_types=entity_types,
                user_id=user_id,
            )
