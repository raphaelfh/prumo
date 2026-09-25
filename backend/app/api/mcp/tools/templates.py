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
"""

from __future__ import annotations

from uuid import UUID

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
from app.utils.opaque_cursor import InvalidCursorError, decode_cursor, encode_cursor

_SECTION_BUDGET = 24_000
_DIFF_ROW_CAP = 40
_TIER_ORDER = ("additive", "cosmetic", "semantic", "destructive")


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
    start = (int(raw[0]), int(raw[1])) if raw else (0, 0)
    sections, nxt = _page_sections(tree, start, budget=_SECTION_BUDGET)

    diff = None
    if raw is None and is_manager:
        diff = _capped_diff(
            await get_template_config_diff(db, project_id=project_id, template_id=template_id)
        )

    return McpTemplateView(
        template_id=template.id,
        name=template.name,
        kind=template.kind,
        published_version=summary.published_version,
        narrow=summary.narrow,
        draft_open=draft_open,
        sections=sections,
        draft_diff=diff,
        next_cursor=encode_cursor(list(nxt)) if nxt else None,
    )


def _page_sections(
    tree: list[RunViewEntityType], start: tuple[int, int], *, budget: int
) -> tuple[list[McpTemplateSection], tuple[int, int] | None]:
    """Questions from `start` = (section pos, question pos) until the JSON budget is spent.
    Always emits at least one question when any remain; a cut section continues next page."""
    out: list[McpTemplateSection] = []
    used = 0
    for s_pos in range(start[0], len(tree)):
        et = tree[s_pos]
        first_q = start[1] if s_pos == start[0] else 0
        section = McpTemplateSection(
            section_id=et.id,
            name=et.name,
            label=et.label,
            parent_section_id=et.parent_entity_type_id,
            cardinality=et.cardinality,
            continued=first_q > 0,
            questions=[],
        )
        out.append(section)
        for q_pos in range(first_q, len(et.fields)):
            q = _question(et.fields[q_pos])
            cost = len(q.model_dump_json())
            if used + cost > budget and used > 0:
                return out, (s_pos, q_pos)
            section.questions.append(q)
            used += cost
    return out, None


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
