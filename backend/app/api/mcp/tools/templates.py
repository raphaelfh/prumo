"""get_template: the questionnaire read tool (task 8a).

Pages sections/questions by a JSON-size budget with an opaque cursor over
`(section position, question position)`; the draft diff rides on the first
page only, capped at 40 rows. Draft state (`draft_open`/`draft_diff`) is
manager-only -- mirrors the REST config-status/diff endpoints, which are
`require_project_manager` (`project_templates.py:557-605`) -- computed only
when `is_project_manager` is true for the caller; any other role gets
`null` for both, and neither read runs.

`draft_open` is `template.config_draft_since is not None` -- the exact
predicate `TemplateConfigStatusRead.has_pending_changes` mirrors -- read
directly off the row `owned_template` already fetched, not through
`get_template_config_status`: that service also computes
`pending_change_count` whenever the marker is set, rebuilding the live
snapshot a SECOND time on top of `get_template_config_diff`'s own build
(`_resolve_template_diff` in both). Calling both would make a page-1 call's
query count depend on whether a draft happens to be open, which spec §8's
bounded-query-count requirement forbids; reading the column directly keeps
the cost to `get_template_config_diff`'s one snapshot build, independent of
draft state.

Size cap (fix round 1, B1): the 32,000-char result cap is the WHOLE
serialized `McpTemplateView`, not just the questions inside it -- the
capped diff (up to ~22k with 40 rows of long before/after) and every
section's own header fields ride on the same budget. `get_template`
builds the diff first, measures the envelope's exact JSON cost with an
empty `sections` list, and only then computes how much budget is left for
`_page_sections`, which charges both a section's header JSON and each
question's JSON against it.
"""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps.security import is_project_manager
from app.api.mcp.asgi_auth import current_principal
from app.api.mcp.errors import McpErrorCode, McpToolError
from app.api.mcp.server import agent_tool
from app.llm.claim_value import normalize_options
from app.schemas.extraction_run import RunViewEntityType, RunViewField
from app.schemas.hitl_session import TemplateConfigDiffRead
from app.schemas.mcp_templates import (
    McpDraftChange,
    McpDraftDiff,
    McpTemplateQuestion,
    McpTemplateSection,
    McpTemplateView,
)
from app.services.extraction_snapshot import live_entity_types
from app.services.project_read_service import template_summaries
from app.services.project_template_active_service import owned_template
from app.services.template_version_read_service import (
    NoActiveTemplateVersionError,
    get_active_version_tree,
    get_template_config_diff,
)
from app.utils.compact_json import compact_json
from app.utils.opaque_cursor import (
    InvalidCursorError,
    cursor_position,
    decode_cursor,
    encode_cursor,
)

_RESULT_CAP = 32_000
_DIFF_ROW_CAP = 40
_TIER_ORDER = ("additive", "cosmetic", "semantic", "destructive")
#: Reserved for `next_cursor` itself: the envelope is measured with it
#: `None`, but a page that is NOT the last one replaces that with an
#: opaque base64 cursor string a caller's later page count could grow
#: (larger ints encode to a few more base64 chars).
_CURSOR_RESERVE = 64


def _json_len(model: BaseModel) -> int:
    """Length of `compact_json` (task 2c's one serializer): the same measure
    the size-cap tests apply (`len(json.dumps(page))`) and the dispatcher
    uses for a result's text copy, which is longer than pydantic's own
    compact `model_dump_json()` -- every key and every list item gets extra
    `", "` / `": "` spacing. All size accounting in this module uses this,
    never the raw `model_dump_json()` length, or the budget under-charges
    and a page can clear the compact count while still exceeding the real
    32,000-char cap."""
    return len(compact_json(model.model_dump(mode="json")))


@agent_tool(
    requires="read",
    project_arg="project_id",
    title="Get template",
    description=(
        "Return a questionnaire: sections -> questions (type, options, instructions), whether a "
        "draft is open, the published version and the draft's changes vs published. Paged: pass "
        "next_cursor until it is null. Draft edits are invisible to reviewers and AI until a "
        "manager publishes in prumo."
    ),
)
async def get_template(
    db: AsyncSession, project_id: UUID, template_id: UUID, cursor: str | None = None
) -> McpTemplateView:
    # ProjectTemplateNotFoundError (foreign or missing) propagates: the dispatcher answers NOT_FOUND.
    template = await owned_template(db, project_id=project_id, template_id=template_id)
    summary = next(
        t
        for t in await template_summaries(db, project_id=project_id)
        if t.template_id == template_id
    )
    try:
        tree = (
            await get_active_version_tree(db, project_id=project_id, template_id=template_id)
        ).entity_types
    except NoActiveTemplateVersionError:
        tree = await live_entity_types(db, template_id=template_id)

    is_manager = await is_project_manager(db, project_id, current_principal().user_sub)
    draft_open = None
    if is_manager:  # config-status/diff are manager-only over REST; same here
        draft_open = template.config_draft_since is not None

    try:
        raw = decode_cursor(cursor, arity=2)
    except InvalidCursorError as exc:
        raise McpToolError(
            McpErrorCode.INVALID_ARGUMENT, "cursor is not valid; restart without it", field="cursor"
        ) from exc
    start = _validated_start(raw, tree)

    diff = None
    if raw is None and is_manager:
        diff = _capped_diff(
            await get_template_config_diff(db, project_id=project_id, template_id=template_id)
        )

    # The diff (built above, since it rides on page 1 only) and every fixed
    # envelope field are charged against the 32,000-char result cap FIRST;
    # what is left is the budget `_page_sections` may spend on section
    # headers and questions (B1: the old fixed 24,000 budget counted
    # questions only and let the diff and section headers ride free).
    envelope = McpTemplateView(
        template_id=template.id,
        name=template.name,
        kind=template.kind,
        published_version=summary.published_version,
        narrow=summary.narrow,
        draft_open=draft_open,
        sections=[],
        draft_diff=diff,
        next_cursor=None,
    )
    section_budget = max(1, _RESULT_CAP - _json_len(envelope) - _CURSOR_RESERVE)
    sections, nxt = _page_sections(tree, start, budget=section_budget)

    return envelope.model_copy(
        update={"sections": sections, "next_cursor": encode_cursor(list(nxt)) if nxt else None}
    )


def _validated_start(raw: list[str | int] | None, tree: list[RunViewEntityType]) -> tuple[int, int]:
    """Decode + bounds-check the cursor's `(section pos, question pos)`.

    A1: a malformed cursor (a non-int position, negative, or out of the
    tree's actual range) is INVALID_ARGUMENT, never an uncaught `ValueError`
    (-> INTERNAL_ERROR) or a silent Python negative-index wrap-around.
    """
    if raw is None:
        return (0, 0)
    try:
        s_pos, q_pos = cursor_position(raw[0]), cursor_position(raw[1])
    except InvalidCursorError as exc:
        raise McpToolError(
            McpErrorCode.INVALID_ARGUMENT, "cursor is not valid; restart without it", field="cursor"
        ) from exc
    valid = s_pos < len(tree) and q_pos < len(tree[s_pos].fields)
    if not valid:
        raise McpToolError(
            McpErrorCode.INVALID_ARGUMENT, "cursor is not valid; restart without it", field="cursor"
        )
    return (s_pos, q_pos)


def _page_sections(
    tree: list[RunViewEntityType], start: tuple[int, int], *, budget: int
) -> tuple[list[McpTemplateSection], tuple[int, int] | None]:
    """Questions from `start` = (section pos, question pos) until the JSON budget is spent.

    Charges BOTH a section's own header JSON and each question's JSON
    against `budget` (B1: a header-only section is not free) -- plus a
    2-byte reserve per item for the `", "` that joins it to its neighbour
    in the surrounding JSON array (default `json.dumps` separators, the
    same ones `_json_len` and the size-cap tests use): summing each item's
    own length under-counts the joined array by exactly that separator,
    (N-1) times over N items, which is what pushed a many-small-sections
    page over the cap even with headers charged; reserving it once per
    item (N, not N-1) leaves a byte of slack. Always emits at least one
    item (a header,
    then if room a question) when the page would otherwise come back with
    nothing, to guarantee forward progress against an oversized single
    question. A2: a section is never emitted with zero questions as a
    paging artifact -- if not even its first remaining question fits, the
    WHOLE section (its header included) defers to the next page. A section
    genuinely empty in the template (no fields at all) is still emitted
    with an empty `questions` list."""
    out: list[McpTemplateSection] = []
    used = 0
    for s_pos in range(start[0], len(tree)):
        et = tree[s_pos]
        first_q = start[1] if s_pos == start[0] else 0
        continued = first_q > 0
        header_cost = _section_header_cost(et, continued) + 2
        if out and used + header_cost > budget:
            return out, (s_pos, first_q)
        used += header_cost

        questions: list[McpTemplateQuestion] = []
        for q_pos in range(first_q, len(et.fields)):
            q = _question(et.fields[q_pos])
            cost = _json_len(q) + 2
            if (out or questions) and used + cost > budget:
                if not questions:
                    # Not even the first question fits (out is non-empty,
                    # so this is not the forced-progress case): defer the
                    # WHOLE section, header included, rather than emit it
                    # with zero questions.
                    return out, (s_pos, first_q)
                out.append(_section(et, continued, questions))
                return out, (s_pos, q_pos)
            questions.append(q)
            used += cost

        # Reaching here means every remaining field of this section fit
        # (the loop above returns directly on any cut, "whole section" or
        # "partial"), so `questions` is non-empty whenever the section had
        # any fields left to place -- a genuinely field-less section is the
        # only way to reach this with an empty `questions` list.
        out.append(_section(et, continued, questions))
    return out, None


def _section_header_cost(et: RunViewEntityType, continued: bool) -> int:
    """JSON weight of a section's own fields, excluding its questions."""
    return _json_len(_section(et, continued, []))


def _section(
    et: RunViewEntityType, continued: bool, questions: list[McpTemplateQuestion]
) -> McpTemplateSection:
    return McpTemplateSection(
        section_id=et.id,
        name=et.name,
        label=et.label,
        parent_section_id=et.parent_entity_type_id,
        cardinality=et.cardinality,
        continued=continued,
        questions=questions,
    )


def _question(field: RunViewField) -> McpTemplateQuestion:
    return McpTemplateQuestion(
        field_id=field.id,
        name=field.name,
        label=field.label,
        description=field.description,
        type=field.field_type,
        options=_options(field.allowed_values),
        instructions=field.llm_description,
        required=field.is_required,
    )


def _options(allowed_values: object) -> list[str] | None:
    opts = normalize_options(allowed_values)
    if not opts:
        return None
    return [
        str(opt.get("label") or opt.get("value")) if isinstance(opt, dict) else str(opt)
        for opt in opts
    ]


def _capped_diff(diff: TemplateConfigDiffRead) -> McpDraftDiff:
    buckets = {
        "additive": diff.changes.additive,
        "cosmetic": diff.changes.cosmetic,
        "semantic": diff.changes.semantic,
        "destructive": diff.changes.destructive,
    }
    counts = {tier: len(rows) for tier, rows in buckets.items()}
    changes: list[McpDraftChange] = []
    truncated = False
    for tier in _TIER_ORDER:
        for row in buckets[tier]:
            if len(changes) >= _DIFF_ROW_CAP:
                truncated = True
                break
            changes.append(
                McpDraftChange(
                    tier=tier,
                    variant=str(row.variant),
                    label_path=row.label_path,
                    attribute=row.attribute,
                    before=_trunc(row.before),
                    after=_trunc(row.after),
                )
            )
        if truncated:
            break
    return McpDraftDiff(
        status=str(diff.status), counts=counts, changes=changes, changes_truncated=truncated
    )


def _trunc(value: str | bool | None) -> str | None:
    if value is None:
        return None
    return str(value)[:200]
