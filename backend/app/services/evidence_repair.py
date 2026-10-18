"""Repair legacy AI evidence: an operator command, dry run by default.

Three commands, each reporting per project what it would do (or did):

* ``llm-pages`` — an AI evidence row with no anchor (``position`` NULL or
  ``{}``) but a ``page_number`` carries a page the model supplied, which no
  anchor backs. Apply clears the page and labels the row ``ungroundable``.
* ``stamp-versions`` — a grounded AI row with an unknown ``content_version``
  is given one: the file's current version when its stored range still
  slices to its quote, the current version with a new anchor when the quote
  can be matched again, otherwise ``file version - 1`` so it reads stale.
  Apply holds the file's parse lock (the one a reparse holds) and re-reads
  the file, its blocks and its rows under it, one transaction per file.
* ``reparse`` — enqueues a reparse of each ``MAIN`` file of one project on
  behalf of a named project manager.

Only evidence on an AI proposal and on no human decision is ever selected;
``text_content`` and the stored ``anchor.quote`` never change. A dry run is
read-only on the server (``SET TRANSACTION READ ONLY``) and writes nothing.
``--apply`` and ``reparse`` run only with the maintainer's go.

Run it with::

    cd backend && uv run python -m app.services.evidence_repair \\
        llm-pages|stamp-versions [--apply]
    cd backend && uv run python -m app.services.evidence_repair \\
        reparse --project ID --as-user PROFILE_ID [--apply]
"""

from __future__ import annotations

import argparse
import asyncio
import uuid
from collections import Counter, defaultdict
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any
from uuid import UUID

from sqlalchemy import ColumnElement, and_, func, or_, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.evidence_block_refs import normalize_text
from app.infrastructure.parsing.base import ParsedBlock, concat_page_text
from app.models.article import Article, ArticleFile
from app.models.extraction import ExtractionEvidence
from app.repositories.article_text_block_repository import ArticleTextBlockRepository
from app.schemas.extraction import PositionV1, stored_anchor
from app.services.article_file_service import ArticleFileService, ParseEnqueueError
from app.services.evidence_reanchor import (
    ai_evidence_filter,
    lock_file_blocks,
    match_anchor,
    reanchored_position,
)
from app.services.llm_engine_service import viewer_is_manager


class RepairAction(StrEnum):
    """What the command does (or would do) to one row or file."""

    CLEAR_LLM_PAGE = "clear_llm_page"
    STAMP_CURRENT = "stamp_current"
    REANCHOR = "reanchor"
    STAMP_STALE = "stamp_stale"
    REPARSE = "reparse"
    REPARSE_FAILED = "reparse_failed"
    NONE = "none"


def classify_llm_page(*, position: dict[str, Any] | None, page_number: int | None) -> RepairAction:
    """An unanchored row that carries a page carries the model's page."""
    if not position and page_number is not None:
        return RepairAction.CLEAR_LLM_PAGE
    return RepairAction.NONE


def classify_version(*, slice_matches: bool, reanchorable: bool) -> RepairAction:
    """The version a grounded, unversioned row is given."""
    if slice_matches:
        return RepairAction.STAMP_CURRENT
    if reanchorable:
        return RepairAction.REANCHOR
    return RepairAction.STAMP_STALE


@dataclass
class RepairReport:
    """Per-project counts and the ids behind them.

    ``row_ids`` holds evidence ids, or article file ids for ``reparse``. On an
    apply they are the rows actually written (a row a reparse already
    stamped is reported under ``NONE``).
    """

    command: str
    applied: bool
    per_project: dict[UUID, Counter[RepairAction]] = field(default_factory=dict)
    row_ids: dict[RepairAction, list[UUID]] = field(default_factory=dict)

    def record(self, project_id: UUID, action: RepairAction, row_id: UUID) -> None:
        """Count *row_id* under *action* for *project_id*."""
        self.per_project.setdefault(project_id, Counter())[action] += 1
        self.row_ids.setdefault(action, []).append(row_id)


def format_report(report: RepairReport) -> str:
    """The operator-facing report. Pure, so its wording is testable."""

    def counts(counter: Counter[RepairAction]) -> str:
        return " ".join(f"{a.value}={counter[a]}" for a in RepairAction if counter[a]) or "nothing"

    mode = "applied" if report.applied else "dry run"
    lines = [f"evidence_repair {report.command} ({mode})"]
    total: Counter[RepairAction] = Counter()
    for project_id in sorted(report.per_project, key=str):
        lines.append(f"project {project_id}: {counts(report.per_project[project_id])}")
        total.update(report.per_project[project_id])
    lines.append(f"Total: {counts(total)}")
    return "\n".join(lines)


@asynccontextmanager
async def _read_only(db: AsyncSession) -> AsyncIterator[None]:
    """A savepoint the server refuses writes in, always rolled back."""
    savepoint = await db.begin_nested()
    try:
        await db.execute(text("SET TRANSACTION READ ONLY"))
        yield
    finally:
        await savepoint.rollback()


# ---------------------------------------------------------------------------
# llm-pages
# ---------------------------------------------------------------------------


def _llm_page_filter() -> ColumnElement[bool]:
    return and_(
        ai_evidence_filter(),
        ExtractionEvidence.page_number.is_not(None),
        or_(
            ExtractionEvidence.position.is_(None),
            func.jsonb_typeof(ExtractionEvidence.position) == "null",
            ExtractionEvidence.position == text("'{}'::jsonb"),
        ),
    )


async def llm_pages(db: AsyncSession, *, apply: bool) -> RepairReport:
    """Clear model-supplied pages on unanchored AI evidence."""
    report = RepairReport(command="llm-pages", applied=apply)
    query = select(
        ExtractionEvidence.id,
        ExtractionEvidence.project_id,
        ExtractionEvidence.position,
        ExtractionEvidence.page_number,
    ).where(_llm_page_filter())

    if not apply:
        async with _read_only(db):
            rows = (await db.execute(query)).all()
        for row_id, project_id, position, page_number in rows:
            report.record(
                project_id, classify_llm_page(position=position, page_number=page_number), row_id
            )
        return report

    rows = (await db.execute(query)).all()
    targets = [
        row_id
        for row_id, _, position, page_number in rows
        if classify_llm_page(position=position, page_number=page_number)
        is RepairAction.CLEAR_LLM_PAGE
    ]
    if targets:
        written = await db.execute(
            update(ExtractionEvidence)
            .where(ExtractionEvidence.id.in_(targets), _llm_page_filter())
            .values(page_number=None, attribution_label="ungroundable")
            .returning(ExtractionEvidence.id, ExtractionEvidence.project_id)
            .execution_options(synchronize_session=False)
        )
        for row_id, project_id in written.all():
            report.record(project_id, RepairAction.CLEAR_LLM_PAGE, row_id)
    await db.commit()
    return report


# ---------------------------------------------------------------------------
# stamp-versions
# ---------------------------------------------------------------------------


def _unversioned_grounded_filter() -> ColumnElement[bool]:
    return and_(
        ai_evidence_filter(),
        ExtractionEvidence.article_file_id.is_not(None),
        ExtractionEvidence.content_version.is_(None),
        func.jsonb_typeof(ExtractionEvidence.position) == "object",
        ExtractionEvidence.position.has_key("anchor"),
    )


@dataclass(frozen=True)
class _Classified:
    row_id: UUID
    project_id: UUID
    action: RepairAction
    stored: PositionV1 | None = None
    match: PositionV1 | None = None


@dataclass(frozen=True)
class _FileClassification:
    version: int
    rows: list[_Classified]


def _slice_matches(stored: PositionV1, page_texts: dict[int, str], quote: str) -> bool:
    anchor = stored.anchor
    if anchor.kind == "region" or not normalize_text(quote):
        return False
    page_text = page_texts.get(anchor.range.page)
    if page_text is None:
        return False
    sliced = page_text[anchor.range.char_start : anchor.range.char_end]
    return normalize_text(sliced) == normalize_text(quote)


def _parsed(blocks: Sequence[Any]) -> list[ParsedBlock]:
    return [
        ParsedBlock(
            page_number=b.page_number,
            block_index=b.block_index,
            text=b.text,
            char_start=b.char_start,
            char_end=b.char_end,
            bbox=b.bbox,
            block_type=b.block_type,
        )
        for b in blocks
    ]


async def _classify_file(db: AsyncSession, file_id: UUID) -> _FileClassification:
    """Classify *file_id*'s grounded, unversioned AI rows against its blocks.

    Every read is a fresh statement (column selects), so a reparse that
    committed earlier in this session or on another connection is seen.
    """
    version = (
        await db.execute(select(ArticleFile.content_version).where(ArticleFile.id == file_id))
    ).scalar_one()
    blocks = _parsed(await ArticleTextBlockRepository(db).list_ordered_for_file(file_id))
    page_texts = concat_page_text(blocks)
    rows = (
        await db.execute(
            select(
                ExtractionEvidence.id,
                ExtractionEvidence.project_id,
                ExtractionEvidence.position,
                ExtractionEvidence.text_content,
            )
            .where(_unversioned_grounded_filter(), ExtractionEvidence.article_file_id == file_id)
            .order_by(ExtractionEvidence.id)
        )
    ).all()

    classified: list[_Classified] = []
    for row_id, project_id, position, text_content in rows:
        stored = stored_anchor(position)
        if stored is None:
            continue  # not grounded: llm-pages' business, or malformed
        if not blocks:
            classified.append(_Classified(row_id, project_id, RepairAction.NONE))
            continue
        quote = text_content or ""
        slice_ok = _slice_matches(stored, page_texts, quote)
        match = None if slice_ok else match_anchor(quote, blocks)
        action = classify_version(slice_matches=slice_ok, reanchorable=match is not None)
        classified.append(_Classified(row_id, project_id, action, stored, match))
    return _FileClassification(version=version, rows=classified)


async def _candidates(db: AsyncSession) -> dict[UUID, list[tuple[UUID, UUID]]]:
    """``file id → [(row id, project id)]`` of every candidate row."""
    rows = (
        await db.execute(
            select(
                ExtractionEvidence.article_file_id,
                ExtractionEvidence.id,
                ExtractionEvidence.project_id,
            )
            .where(_unversioned_grounded_filter())
            .order_by(ExtractionEvidence.article_file_id, ExtractionEvidence.id)
        )
    ).all()
    by_file: dict[UUID, list[tuple[UUID, UUID]]] = defaultdict(list)
    for file_id, row_id, project_id in rows:
        by_file[file_id].append((row_id, project_id))
    return by_file


def _values(row: _Classified, version: int) -> dict[str, Any]:
    if row.action is RepairAction.STAMP_CURRENT:
        return {"content_version": version}
    if row.action is RepairAction.REANCHOR:
        assert row.match is not None
        position, page = reanchored_position(row.stored, row.match)
        return {"position": position, "page_number": page, "content_version": version}
    # STAMP_STALE: any version other than the file's reads stale.
    return {"content_version": version - 1}


async def _apply_file(
    db: AsyncSession, file_id: UUID, listed: list[tuple[UUID, UUID]], report: RepairReport
) -> None:
    """Stamp one file's rows under its parse lock, then commit (releases it)."""
    await lock_file_blocks(db, file_id)
    classification = await _classify_file(db, file_id)
    seen: set[UUID] = set()
    for row in classification.rows:
        seen.add(row.row_id)
        action = row.action
        if action is not RepairAction.NONE:
            written = await db.execute(
                update(ExtractionEvidence)
                .where(
                    ExtractionEvidence.id == row.row_id,
                    ExtractionEvidence.content_version.is_(None),
                )
                .values(**_values(row, classification.version))
                .returning(ExtractionEvidence.id)
                .execution_options(synchronize_session=False)
            )
            if written.scalar_one_or_none() is None:
                action = RepairAction.NONE
        report.record(row.project_id, action, row.row_id)
    # Listed before the lock but no longer a candidate under it: a reparse
    # stamped (or moved) the row meanwhile.
    for row_id, project_id in listed:
        if row_id not in seen:
            report.record(project_id, RepairAction.NONE, row_id)
    await db.commit()


async def stamp_versions(db: AsyncSession, *, apply: bool) -> RepairReport:
    """Give grounded AI evidence with an unknown version a version."""
    report = RepairReport(command="stamp-versions", applied=apply)
    if not apply:
        async with _read_only(db):
            for file_id in await _candidates(db):
                for row in (await _classify_file(db, file_id)).rows:
                    report.record(row.project_id, row.action, row.row_id)
        return report

    for file_id, listed in (await _candidates(db)).items():
        await _apply_file(db, file_id, listed, report)
    return report


# ---------------------------------------------------------------------------
# reparse
# ---------------------------------------------------------------------------


async def reparse_project(
    db: AsyncSession, *, project_id: UUID, as_user: UUID, apply: bool, trace_id: str
) -> RepairReport:
    """Enqueue a reparse of each ``MAIN`` file of *project_id* as *as_user*.

    Raises ``ValueError`` unless *as_user* manages the project.
    """
    if not await viewer_is_manager(db, project_id, as_user):
        raise ValueError("--as-user must be a manager of --project")
    report = RepairReport(command="reparse", applied=apply)
    file_ids = (
        await db.scalars(
            select(ArticleFile.id)
            .join(Article, Article.id == ArticleFile.article_id)
            .where(Article.project_id == project_id, ArticleFile.file_role == "MAIN")
            .order_by(ArticleFile.id)
        )
    ).all()
    if not apply:
        for file_id in file_ids:
            report.record(project_id, RepairAction.REPARSE, file_id)
        return report

    service = ArticleFileService(db)
    for file_id in file_ids:
        try:
            enqueued = await service.reparse(
                article_file_id=file_id,
                project_id=project_id,
                user_id=str(as_user),
                trace_id=trace_id,
            )
        except ParseEnqueueError:
            enqueued = None
        action = RepairAction.REPARSE if enqueued is not None else RepairAction.REPARSE_FAILED
        report.record(project_id, action, file_id)
    await db.commit()
    return report


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m app.services.evidence_repair")
    parser.add_argument("command", choices=["llm-pages", "stamp-versions", "reparse"])
    parser.add_argument("--apply", action="store_true", help="write (default: dry run)")
    parser.add_argument("--project", type=UUID, help="reparse: the project")
    parser.add_argument("--as-user", type=UUID, help="reparse: a manager's profile id")
    return parser


async def _run(args: argparse.Namespace) -> RepairReport:
    from app.core import deps

    async with deps.AsyncSessionLocal() as db:
        if args.command == "llm-pages":
            return await llm_pages(db, apply=args.apply)
        if args.command == "stamp-versions":
            return await stamp_versions(db, apply=args.apply)
        return await reparse_project(
            db,
            project_id=args.project,
            as_user=args.as_user,
            apply=args.apply,
            trace_id=f"evidence-repair-{uuid.uuid4()}",
        )


def main(argv: list[str] | None = None) -> int:
    """Parse *argv*, run the command, print its report; 0 on completion."""
    parser = _parser()
    args = parser.parse_args(argv)
    if args.command == "reparse" and (args.project is None or args.as_user is None):
        parser.error("reparse needs --project and --as-user")
    if args.command != "reparse" and (args.project is not None or args.as_user is not None):
        parser.error(f"{args.command} does not take --project or --as-user")
    print(format_report(asyncio.run(_run(args))))
    return 0


if __name__ == "__main__":  # pragma: no cover - operator entry point
    raise SystemExit(main())
