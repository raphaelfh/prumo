"""Read-side service for the researcher MCP `get_extractions` tool (task 8b).

A new module, not an addition to `extraction_run_read_service.py`: that
module is near its 800-line fitness ceiling and `extraction_export_service.py`
is already vulture-baselined, so a third owner for "extraction data, read
out" would blur which one to touch. This module never re-implements blind
review -- every run read goes through
`extraction_run_read_service.get_run_with_workflow_history`, which applies
`run_reveals_peers` and filters peers' human proposals/decisions (the
lockstep copy of migration 0025). There is no ALL_USERS path here (unlike
the export's `managers_see_reviewers`-blind CSV): an agent call is a single
caller's view, so it always renders through that caller's own blind
boundary, never an unblinded aggregate.

Fix rounds 1-2 (page-size cap): every page's real JSON size is measured
through `compact_json` (`app/utils/compact_json.py`), never
`BaseModel.model_dump_json()` (more compact, and escapes non-ASCII as raw
UTF-8 instead of `\\uXXXX`, so it under-counts long non-ASCII values). The
budget reserves room for `next_cursor` (`_CURSOR_RESERVE`) and charges
every article's own envelope -- `title`/`run`/`reason`/`peer_values_hidden`
-- once per page it appears on, populated, resumed or run-less alike
(`pack_items`'s `header_cost`), not just the packed `values`/`rows`.
"""

from __future__ import annotations

import json
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal, TypeVar
from uuid import UUID

from pydantic import BaseModel
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.article import Article
from app.models.extraction import ExtractionEvidence, ExtractionInstance, ExtractionRun
from app.models.extraction_workflow import ExtractionProposalSource, ExtractionReviewerDecisionType
from app.schemas.extraction_run import (
    ProposalRecordResponse,
    PublishedStateResponse,
    ReviewerDecisionResponse,
    RunDetailResponse,
    RunViewEntityType,
)
from app.schemas.mcp_extractions import (
    McpConciseCell,
    McpDetailedRow,
    McpEvidence,
    McpExtractionArticle,
    McpExtractionQuestion,
    McpExtractionsPage,
    McpRunRef,
)
from app.services.extraction_current_run import select_current_runs_by_article
from app.services.extraction_run_read_service import (
    caller_can_see_peers,
    get_run_with_workflow_history,
    is_run_arbitrator,
)
from app.services.extraction_snapshot import live_entity_types
from app.services.template_version_read_service import (
    NoActiveTemplateVersionError,
    get_active_version_tree,
)
from app.utils.compact_json import compact_json
from app.utils.opaque_cursor import (
    InvalidCursorError,
    cursor_position,
    cursor_uuid,
    decode_cursor,
    encode_cursor,
)
from app.utils.text_caps import cap_text, join_capped
from app.utils.untrusted import wrap_untrusted

_PAGE_BUDGET = 28_000
_CONCISE_VALUE_CAP = 80
_DETAILED_VALUE_CAP = 1_000
_EVIDENCE_QUOTE_CAP = 300
_EVIDENCE_PER_ROW_CAP = 3
_CONCISE_JOIN_CAP = 1_000  # one value per instance: the join is bounded too (F4)
#: Reserved for `next_cursor` itself, same reasoning as `templates.py`: the
#: envelope is measured with it `None`, but a non-last page replaces that
#: with an opaque base64 cursor string a few chars longer.
_CURSOR_RESERVE = 64
#: The question list rides on page 1 only (never paged, per this tool's own
#: contract) -- BOUNDED, not paged, to a fixed sub-budget so an oversized
#: questionnaire can never alone starve page 1's `budget` down to
#: `max(1, ...)` and overflow it (fix round 1, reviewer minor 3). A
#: questionnaire whose flattened JSON exceeds this drops its tail questions
#: from page 1's `questions` list; the article data for those same fields
#: still appears (concise cells / detailed rows are keyed by `field_id`, not
#: gated on the field's presence in `questions`).
_QUESTIONS_CAP = 20_000

T = TypeVar("T")


def pack_items(
    items: list[tuple[UUID, list[T]]],
    *,
    start: tuple[UUID, int] | None,
    budget: int,
    cost: Callable[[T], int],
    header_cost: Callable[[UUID], int] | None = None,
) -> tuple[list[tuple[UUID, int, list[T]]], tuple[UUID, int] | None]:
    """Pack per-article item lists into one page under a byte budget.

    `start` is a prior page's cursor: `(article_id, item position)`. Every
    call guarantees forward progress -- the first article touched always
    ships (its header, plus its first item if it has one) regardless of
    cost. Once the page holds something, crossing into a not-yet-touched
    (or resumed) article needs strictly more headroom than its header costs
    (`used + header_cost(article_id) > budget` defers the WHOLE article);
    an already-started article's later items use inclusive room
    (`used + cost > budget` stops) so fields don't fragment at the boundary.

    `header_cost`, when given, is charged ONCE per article THIS CALL EMITS
    -- before its items and regardless of whether it has any (fix round 2,
    B1-r: a zero-item/no-run article's own envelope costs real bytes too,
    and so does a resumed article's, re-rendered on every page it appears
    on). `None` charges nothing (old callers keep their exact behavior).

    Contract on `items` vs. `start`: the caller's own keyset query already
    filters `items` to articles at-or-after `start`'s article (real callers
    resume with `Article.id >= start[0]`) -- `pack_items` never re-orders or
    filters by article id itself. When `start`'s exact article is present,
    resume mid-article at `start[1]`; when it is absent (deleted since the
    page that issued this cursor), `items[0]` is already the next surviving
    article, so resume there at position 0 (fix round 1, M2), rather than
    dropping every article that sorted after the deleted one.
    """
    start_idx = 0
    start_pos = 0
    if start is not None:
        start_article_id, start_pos = start
        for idx, (article_id, _) in enumerate(items):
            if article_id == start_article_id:
                start_idx = idx
                break
        else:
            start_pos = 0  # exact article gone; items[0] is the next survivor

    out: list[tuple[UUID, int, list[T]]] = []
    used = 0
    for idx in range(start_idx, len(items)):
        article_id, article_items = items[idx]
        first_pos = start_pos if idx == start_idx else 0

        h = header_cost(article_id) if header_cost is not None else 0
        if out and used + h > budget:
            return out, (article_id, first_pos)
        used += h  # charged whether or not this article has any items below

        chosen: list[T] = []
        for pos in range(first_pos, len(article_items)):
            item = article_items[pos]
            c = cost(item)
            if not out and not chosen:
                pass  # forced progress: the very first item this call always ships
            elif not chosen:
                if used + c >= budget:
                    return out, (article_id, first_pos)
            else:
                if used + c > budget:
                    out.append((article_id, first_pos, chosen))
                    return out, (article_id, pos)
            chosen.append(item)
            used += c
        out.append((article_id, first_pos, chosen))
    return out, None


class _ConcisePackItem(BaseModel):
    """Packing unit for concise mode: pack_items is generic over cost+id, so
    a field's cell rides paired with the field_id it belongs to."""

    field_id: UUID
    cell: McpConciseCell


@dataclass(frozen=True, slots=True)
class _Resolved:
    """One (instance, field) coordinate's resolved display value -- the
    Value rule (spec §5.1), computed from an ALREADY blind-filtered
    `RunDetailResponse` (never a fresh query over reviewer_decisions /
    proposal_records: that would re-implement `get_run_with_workflow_history`'s
    filter, the one thing this module must never do)."""

    value: Any
    decider: Literal["human", "ai", "consensus"]
    reviewer: Literal["self", "peer"] | None
    ai_only: bool
    created_at: Any
    proposal_id: UUID | None
    decision_id: UUID | None


def _short(value: Any, *, limit: int) -> str:
    """`_short(value)` (spec §5.1): an absent-reason marker reads as "no
    information"; otherwise the value envelope's own `value` key (or the raw
    value, e.g. a legacy/AI shape with no envelope) -- lists joined with
    ", ", everything else stringified and capped."""
    if isinstance(value, dict) and value.get("absent_reason") is not None:
        return "no information"
    v = value.get("value", value) if isinstance(value, dict) else value
    if isinstance(v, list):
        v = ", ".join(str(x) for x in v)
    return str(v)[:limit]


def _coord_dicts(
    detail: RunDetailResponse,
) -> tuple[
    dict[tuple[UUID, UUID], PublishedStateResponse],
    dict[tuple[UUID, UUID], list[ReviewerDecisionResponse]],
    dict[tuple[UUID, UUID], list[ProposalRecordResponse]],
    dict[tuple[UUID, UUID], list[ProposalRecordResponse]],
    dict[UUID, ProposalRecordResponse],
]:
    """Index an (already blind-filtered) run detail by coordinate, once per
    run, for O(1) lookup per (instance, field) resolution below."""
    published_by_coord = {(p.instance_id, p.field_id): p for p in detail.published_states}

    decisions_by_coord: dict[tuple[UUID, UUID], list[ReviewerDecisionResponse]] = defaultdict(list)
    for d in detail.decisions:
        decisions_by_coord[(d.instance_id, d.field_id)].append(d)

    human_by_coord: dict[tuple[UUID, UUID], list[ProposalRecordResponse]] = defaultdict(list)
    ai_by_coord: dict[tuple[UUID, UUID], list[ProposalRecordResponse]] = defaultdict(list)
    proposals_by_id: dict[UUID, ProposalRecordResponse] = {}
    for p in detail.proposals:
        proposals_by_id[p.id] = p
        if p.source == ExtractionProposalSource.HUMAN.value:
            human_by_coord[(p.instance_id, p.field_id)].append(p)
        elif p.source == ExtractionProposalSource.AI.value:
            ai_by_coord[(p.instance_id, p.field_id)].append(p)

    return published_by_coord, decisions_by_coord, human_by_coord, ai_by_coord, proposals_by_id


def _resolve_reviewer_values(
    instance_id: UUID,
    field_id: UUID,
    *,
    published_by_coord: dict[tuple[UUID, UUID], PublishedStateResponse],
    decisions_by_coord: dict[tuple[UUID, UUID], list[ReviewerDecisionResponse]],
    human_by_coord: dict[tuple[UUID, UUID], list[ProposalRecordResponse]],
    ai_by_coord: dict[tuple[UUID, UUID], list[ProposalRecordResponse]],
    proposals_by_id: dict[UUID, ProposalRecordResponse],
    caller_id: UUID,
) -> list[_Resolved]:
    """The Value rule (spec §5.1), per (instance, field): a published
    (consensus) row wins outright, as the sole entry; else every VISIBLE
    reviewer's own resolved value (the latest non-reject decision, else
    that reviewer's latest human proposal) -- one entry per reviewer, never
    merged, so detailed mode can show a divergence as separate rows and
    concise mode can still pick one value + a disagreement flag from the
    same list; else the latest AI proposal, flagged `ai_only`. An empty
    list means no information at all (no row/cell emitted). Visibility
    itself is never re-decided here: the `*_by_coord` dicts are already
    blind-filtered by `get_run_with_workflow_history`."""
    coord = (instance_id, field_id)

    published = published_by_coord.get(coord)
    if published is not None:
        return [
            _Resolved(
                value=published.value,
                decider="consensus",
                reviewer=None,
                ai_only=False,
                created_at=published.published_at,
                proposal_id=None,
                decision_id=None,
            )
        ]

    latest_decision_by_reviewer: dict[UUID, ReviewerDecisionResponse] = {}
    for d in sorted(decisions_by_coord.get(coord, ()), key=lambda d: d.created_at):
        latest_decision_by_reviewer[d.reviewer_id] = d  # later overwrites -> latest wins

    latest_proposal_by_user: dict[UUID, ProposalRecordResponse] = {}
    for p in sorted(human_by_coord.get(coord, ()), key=lambda p: p.created_at):
        if p.source_user_id is not None:
            latest_proposal_by_user[p.source_user_id] = p

    resolved: list[_Resolved] = []
    for reviewer_id in set(latest_decision_by_reviewer) | set(latest_proposal_by_user):
        decision = latest_decision_by_reviewer.get(reviewer_id)
        if (
            decision is not None
            and decision.decision != ExtractionReviewerDecisionType.REJECT.value
        ):
            if decision.decision == ExtractionReviewerDecisionType.EDIT.value:
                value = decision.value
            else:  # accept_proposal
                referenced = (
                    proposals_by_id.get(decision.proposal_record_id)
                    if decision.proposal_record_id is not None
                    else None
                )
                value = referenced.proposed_value if referenced is not None else None
            resolved.append(
                _Resolved(
                    value=value,
                    decider="human",
                    reviewer="self" if reviewer_id == caller_id else "peer",
                    ai_only=False,
                    created_at=decision.created_at,
                    proposal_id=decision.proposal_record_id,
                    decision_id=decision.id,
                )
            )
            continue
        proposal = latest_proposal_by_user.get(reviewer_id)
        if proposal is not None:
            resolved.append(
                _Resolved(
                    value=proposal.proposed_value,
                    decider="human",
                    reviewer="self" if reviewer_id == caller_id else "peer",
                    ai_only=False,
                    created_at=proposal.created_at,
                    proposal_id=proposal.id,
                    decision_id=None,
                )
            )
    if resolved:
        return resolved

    ai_proposals = ai_by_coord.get(coord, ())
    if ai_proposals:
        latest_ai = max(ai_proposals, key=lambda p: p.created_at)
        return [
            _Resolved(
                value=latest_ai.proposed_value,
                decider="ai",
                reviewer=None,
                ai_only=True,
                created_at=latest_ai.created_at,
                proposal_id=latest_ai.id,
                decision_id=None,
            )
        ]

    return []


def _concise_cell(resolveds: list[_Resolved]) -> _Resolved:
    """The ONE displayed value for a concise cell from a coordinate's
    (possibly multi-reviewer) resolved list: the caller's own entry when
    present, else the earliest. Disagreement is a property of the whole
    list, not of any one entry, so it is computed here rather than carried
    on `_Resolved`."""
    if len(resolveds) == 1:
        return resolveds[0]
    own = next((r for r in resolveds if r.reviewer == "self"), None)
    chosen = own if own is not None else min(resolveds, key=lambda r: r.created_at)
    return chosen


def _evidence_for(
    resolved: _Resolved,
    *,
    evidence_by_proposal: dict[UUID, list[ExtractionEvidence]],
    evidence_by_decision: dict[UUID, list[ExtractionEvidence]],
) -> list[McpEvidence]:
    """Evidence for a resolved value's own source row (its decision, or, when
    that decision carries none itself, the proposal it accepted / the AI
    proposal it came from) -- never a second lookup by (instance, field),
    which would surface a DIFFERENT reviewer's evidence at the same
    coordinate."""
    rows = evidence_by_decision.get(resolved.decision_id, []) if resolved.decision_id else []
    if not rows and resolved.proposal_id is not None:
        rows = evidence_by_proposal.get(resolved.proposal_id, [])
    out: list[McpEvidence] = []
    for ev in rows[:_EVIDENCE_PER_ROW_CAP]:
        if not ev.text_content:
            continue
        out.append(
            McpEvidence(
                quote=wrap_untrusted(ev.text_content[:_EVIDENCE_QUOTE_CAP]),
                locator=f"p{ev.page_number}" if ev.page_number is not None else None,
            )
        )
    return out


def _flatten_tree(
    tree: list[RunViewEntityType],
) -> tuple[
    dict[UUID, int], list[tuple[UUID, UUID, str, str]], dict[UUID, list[tuple[UUID, str, str]]]
]:
    """Tree-order flattening shared by the question list, the concise
    per-field loop and the detailed per-instance loop: entity-type position
    (for ordering an article's instances), the flat `(field_id, entity_type_id,
    label, type)` rows in tree order, and those rows grouped back by
    entity_type_id for the detailed per-instance walk."""
    et_order: dict[UUID, int] = {}
    rows: list[tuple[UUID, UUID, str, str]] = []
    fields_by_et: dict[UUID, list[tuple[UUID, str, str]]] = defaultdict(list)
    for et_pos, et in enumerate(tree):
        et_order[et.id] = et_pos
        for field in et.fields:
            rows.append((field.id, et.id, field.label, field.field_type))
            fields_by_et[et.id].append((field.id, field.label, field.field_type))
    return et_order, rows, fields_by_et


async def _article_page(
    db: AsyncSession,
    *,
    project_id: UUID,
    article_id: UUID | None,
    after: UUID | None,
    limit: int,
) -> tuple[list[tuple[UUID, str]], UUID | None]:
    """The page's article ids + titles, and (project-wide listing only) the
    id of the first article beyond this page, if any -- the tool already
    proved ownership of a single `article_id`, so that path never re-scopes
    by project_id in the WHERE clause (the duplicate-ownership-predicate
    gate)."""
    if article_id is not None:
        title = (
            await db.execute(select(Article.title).where(Article.id == article_id))
        ).scalar_one()
        return [(article_id, title)], None

    stmt = select(Article.id, Article.title).where(Article.project_id == project_id)
    if after is not None:
        stmt = stmt.where(Article.id >= after)
    stmt = stmt.order_by(Article.id).limit(limit + 1)
    rows = (await db.execute(stmt)).all()
    page_rows = [(r[0], r[1]) for r in rows[:limit]]
    overflow_id = rows[limit][0] if len(rows) > limit else None
    return page_rows, overflow_id


def _bounded_questions(
    all_questions: list[McpExtractionQuestion],
) -> tuple[list[McpExtractionQuestion], int, bool]:
    """Bound (never page -- returned once, on page 1) the flattened question
    list to `_QUESTIONS_CAP` bytes of `compact_json`, dropping its tail one
    question at a time until it fits, so an oversized list can never alone
    starve page 1's item budget (fix round 1). The third element is
    `questions_truncated` (fix round 2, Q-trunc): the caller uses it for a
    `next_step` hint pointing the agent at `get_template`'s full list."""
    cost = len(compact_json([q.model_dump(mode="json") for q in all_questions]))
    if cost <= _QUESTIONS_CAP or not all_questions:
        return all_questions, cost, False
    kept = list(all_questions)
    while len(kept) > 1 and cost > _QUESTIONS_CAP:
        kept.pop()
        cost = len(compact_json([q.model_dump(mode="json") for q in kept]))
    return kept, cost, True


def _envelope_header_cost(
    article_pk: UUID, meta: dict[str, Any], response_format: Literal["concise", "detailed"]
) -> int:
    """JSON weight of an article's own envelope fields, excluding
    `values`/`rows` (mirrors `templates.py::_section_header_cost`), `+2` for
    the array separator. `meta["title"]` must already be `cap_text`-bounded."""
    empty = McpExtractionArticle(
        article_id=article_pk,
        title=meta["title"],
        title_truncated=meta["title_truncated"],
        run=meta["run"],
        reason=meta["reason"],
        peer_values_hidden=meta["peer_values_hidden"],
        continued=False,
        values={} if response_format == "concise" else None,
        rows=[] if response_format == "detailed" else None,
    )
    return len(compact_json(empty.model_dump(mode="json"))) + 2


async def list_agent_extractions(
    db: AsyncSession,
    *,
    project_id: UUID,
    template_id: UUID,
    template_kind: str,
    caller_id: UUID,
    article_id: UUID | None,
    response_format: Literal["concise", "detailed"],
    cursor: str | None,
    limit: int,
) -> McpExtractionsPage:
    # Cursor arity 4: (article_id, item position, response_format,
    # article_id filter or "" for none) -- M4 (fix round 1): a cursor is
    # bound to the call shape it was issued for, since concise/detailed and
    # a different article filter page a DIFFERENT item list.
    article_filter_token = str(article_id) if article_id is not None else ""
    raw_cursor = decode_cursor(cursor, arity=4)
    start: tuple[UUID, int] | None = None
    if raw_cursor is not None:
        if raw_cursor[2] != response_format or raw_cursor[3] != article_filter_token:
            raise InvalidCursorError("cursor was issued for a different response_format/article_id")
        start = (cursor_uuid(raw_cursor[0]), cursor_position(raw_cursor[1]))

    try:
        tree = (
            await get_active_version_tree(db, project_id=project_id, template_id=template_id)
        ).entity_types
    except NoActiveTemplateVersionError:
        tree = await live_entity_types(db, template_id=template_id)
    et_order, field_rows, fields_by_et = _flatten_tree(tree)

    questions: list[McpExtractionQuestion] | None = None
    questions_cost = 0
    questions_truncated = False
    if cursor is None:
        label_by_et = {et.id: et.label for et in tree}
        all_questions = [
            McpExtractionQuestion(
                field_id=field_id, section_label=label_by_et[et_id], label=label, type=field_type
            )
            for field_id, et_id, label, field_type in field_rows
        ]
        questions, questions_cost, questions_truncated = _bounded_questions(all_questions)

    article_rows, overflow_article_id = await _article_page(
        db,
        project_id=project_id,
        article_id=article_id,
        after=start[0] if start else None,
        limit=limit,
    )
    article_ids = [a for a, _ in article_rows]

    run_rows = (
        (
            await db.execute(
                select(ExtractionRun).where(
                    ExtractionRun.project_id == project_id,
                    ExtractionRun.template_id == template_id,
                    ExtractionRun.article_id.in_(article_ids),
                )
            )
        )
        .scalars()
        .all()
    )
    current_by_article = select_current_runs_by_article(list(run_rows))

    can_see = await caller_can_see_peers(
        db, project_id=project_id, user_id=caller_id, kind=template_kind
    )
    is_arb = await is_run_arbitrator(db, project_id, caller_id)

    details: dict[UUID, RunDetailResponse] = {}
    for current_run in current_by_article.values():
        details[current_run.id] = await get_run_with_workflow_history(
            db,
            current_run.id,
            caller_id=caller_id,
            can_see_peers=can_see,
            caller_is_arbitrator=is_arb,
        )

    instances_by_article: dict[UUID, list[ExtractionInstance]] = defaultdict(list)
    articles_with_run = list(current_by_article.keys())
    if articles_with_run:
        instance_rows = (
            (
                await db.execute(
                    select(ExtractionInstance)
                    .where(
                        ExtractionInstance.template_id == template_id,
                        ExtractionInstance.article_id.in_(articles_with_run),
                    )
                    .order_by(ExtractionInstance.sort_order, ExtractionInstance.id)  # stable joins
                )
            )
            .scalars()
            .all()
        )
        for inst in instance_rows:
            if inst.article_id is not None:
                instances_by_article[inst.article_id].append(inst)

    evidence_by_proposal: dict[UUID, list[ExtractionEvidence]] = defaultdict(list)
    evidence_by_decision: dict[UUID, list[ExtractionEvidence]] = defaultdict(list)
    if response_format == "detailed" and details:
        visible_proposal_ids = {p.id for d in details.values() for p in d.proposals}
        visible_decision_ids = {rd.id for d in details.values() for rd in d.decisions}
        # M1 (fix round 1): a row can carry BOTH a proposal_record_id and a
        # reviewer_decision_id (the CHECK constraint permits it) -- must
        # never surface via a visible proposal id when its decision id
        # belongs to a hidden peer, so a SET decision id alone decides
        # visibility; only a row with none falls back to the proposal id
        # (an AI proposal's own evidence never carries a decision id).
        conditions = []
        if visible_proposal_ids:
            conditions.append(
                and_(
                    ExtractionEvidence.reviewer_decision_id.is_(None),
                    ExtractionEvidence.proposal_record_id.in_(visible_proposal_ids),
                )
            )
        if visible_decision_ids:
            conditions.append(ExtractionEvidence.reviewer_decision_id.in_(visible_decision_ids))
        if conditions:
            ev_rows = (
                (
                    await db.execute(
                        select(ExtractionEvidence)
                        .where(
                            ExtractionEvidence.project_id == project_id,
                            ExtractionEvidence.run_id.in_(list(details.keys())),
                            or_(*conditions),
                        )
                        .order_by(ExtractionEvidence.rank)
                    )
                )
                .scalars()
                .all()
            )
            for ev in ev_rows:
                if ev.proposal_record_id is not None:
                    evidence_by_proposal[ev.proposal_record_id].append(ev)
                if ev.reviewer_decision_id is not None:
                    evidence_by_decision[ev.reviewer_decision_id].append(ev)

    article_meta: dict[UUID, dict[str, Any]] = {}
    items_by_article: list[tuple[UUID, list[Any]]] = []

    for article_pk, raw_title in article_rows:
        title, title_truncated = cap_text(raw_title)
        run = current_by_article.get(article_pk)
        if run is None:
            article_meta[article_pk] = {
                "title": title,
                "title_truncated": title_truncated,
                "run": None,
                "reason": "no_run",
                "peer_values_hidden": False,
            }
            items_by_article.append((article_pk, []))
            continue

        detail = details[run.id]
        revealed = detail.peers_revealed
        peer_hidden = not revealed
        article_meta[article_pk] = {
            "title": title,
            "title_truncated": title_truncated,
            "run": McpRunRef(run_id=run.id, stage=run.stage),
            "reason": "blind_review" if peer_hidden else None,
            "peer_values_hidden": peer_hidden,
        }
        published_by_coord, decisions_by_coord, human_by_coord, ai_by_coord, proposals_by_id = (
            _coord_dicts(detail)
        )

        if response_format == "concise":
            c_items: list[_ConcisePackItem] = []
            for field_id, et_id, _label, _ftype in field_rows:
                resolved_lists = [
                    _resolve_reviewer_values(
                        inst.id,
                        field_id,
                        published_by_coord=published_by_coord,
                        decisions_by_coord=decisions_by_coord,
                        human_by_coord=human_by_coord,
                        ai_by_coord=ai_by_coord,
                        proposals_by_id=proposals_by_id,
                        caller_id=caller_id,
                    )
                    for inst in instances_by_article.get(article_pk, [])
                    if inst.entity_type_id == et_id
                ]
                resolved_lists = [group for group in resolved_lists if group]
                if not resolved_lists:
                    continue
                cells = [_concise_cell(group) for group in resolved_lists]
                value_str = join_capped(
                    [_short(c.value, limit=_CONCISE_VALUE_CAP) for c in cells],
                    sep=" | ",
                    cap=_CONCISE_JOIN_CAP,
                )
                human_groups = [group for group in resolved_lists if group[0].decider == "human"]
                disagreement = None
                if revealed and human_groups:
                    disagreement = any(
                        len({json.dumps(r.value, sort_keys=True) for r in group}) > 1
                        for group in human_groups
                    )
                c_items.append(
                    _ConcisePackItem(
                        field_id=field_id,
                        cell=McpConciseCell(
                            value=value_str,
                            ai_only=all(c.ai_only for c in cells),
                            disagreement=disagreement,
                        ),
                    )
                )
            items_by_article.append((article_pk, c_items))
        else:
            d_items: list[McpDetailedRow] = []
            sorted_instances = sorted(
                instances_by_article.get(article_pk, []),
                key=lambda i: (et_order.get(i.entity_type_id, 0), i.sort_order, str(i.id)),
            )
            for inst in sorted_instances:
                for field_id, _label, _ftype in fields_by_et.get(inst.entity_type_id, []):
                    for resolved in _resolve_reviewer_values(
                        inst.id,
                        field_id,
                        published_by_coord=published_by_coord,
                        decisions_by_coord=decisions_by_coord,
                        human_by_coord=human_by_coord,
                        ai_by_coord=ai_by_coord,
                        proposals_by_id=proposals_by_id,
                        caller_id=caller_id,
                    ):
                        d_items.append(
                            McpDetailedRow(
                                instance_id=inst.id,
                                field_id=field_id,
                                value=_short(resolved.value, limit=_DETAILED_VALUE_CAP),
                                decider=resolved.decider,
                                reviewer=resolved.reviewer,
                                evidence=_evidence_for(
                                    resolved,
                                    evidence_by_proposal=evidence_by_proposal,
                                    evidence_by_decision=evidence_by_decision,
                                ),
                                run_stage=run.stage,
                            )
                        )
            items_by_article.append((article_pk, d_items))

    def _item_cost(item: Any) -> int:
        # +2: the `", "` separator joining this item to its neighbour in the
        # surrounding JSON array (default `json.dumps` separators) -- summing
        # each item's own compact_json length under-counts the joined array
        # by exactly that, once per item (same reasoning as
        # `templates.py::_page_sections`).
        return len(compact_json(item.model_dump(mode="json"))) + 2

    def _header_cost(article_pk: UUID) -> int:
        return _envelope_header_cost(article_pk, article_meta[article_pk], response_format)

    budget = max(1, _PAGE_BUDGET - questions_cost - _CURSOR_RESERVE)
    packed, next_start = pack_items(
        items_by_article, start=start, budget=budget, cost=_item_cost, header_cost=_header_cost
    )

    articles_out: list[McpExtractionArticle] = []
    for article_pk, first_pos, chosen in packed:
        meta = article_meta[article_pk]
        values = None
        rows_out = None
        if response_format == "concise":
            values = {str(item.field_id): item.cell for item in chosen}
        else:
            rows_out = list(chosen)
        articles_out.append(
            McpExtractionArticle(
                article_id=article_pk,
                title=meta["title"],
                title_truncated=meta["title_truncated"],
                run=meta["run"],
                reason=meta["reason"],
                peer_values_hidden=meta["peer_values_hidden"],
                continued=first_pos > 0,
                values=values,
                rows=rows_out,
            )
        )

    if next_start is not None:
        next_cursor = encode_cursor(
            [str(next_start[0]), next_start[1], response_format, article_filter_token]
        )
    elif overflow_article_id is not None:
        next_cursor = encode_cursor(
            [str(overflow_article_id), 0, response_format, article_filter_token]
        )
    else:
        next_cursor = None

    return McpExtractionsPage(
        template_id=template_id,
        response_format=response_format,
        questions=questions,
        questions_truncated=questions_truncated,
        next_step="the question list was truncated; call get_template for the full list"
        if questions_truncated
        else None,
        articles=articles_out,
        next_cursor=next_cursor,
    )
