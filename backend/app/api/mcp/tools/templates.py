"""get_template: the questionnaire read tool (task 8a).

Pages sections/questions by a JSON-size budget with an opaque cursor over
`(section position, question position)`; the draft diff rides on the first
page only, capped at 40 rows. Draft state (`draft_open`/`draft_diff`) is
manager-only -- mirrors the REST config-status/diff endpoints, which are
`require_project_manager` (`project_templates.py:557-605`) -- computed only
when `is_project_manager` is true for the caller; any other role gets
`null` for both, and neither read runs.

`view` picks what is paged: `published` (the default above), `draft` (the
live tree and instruction, with the diff fingerprint and `lint_tree`
findings on page 1) or `changes` (every diff row, paged by
`template_changes`). The last two are manager-only: anyone else gets
MANAGER_REQUIRED before any draft read runs.

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

from typing import Literal
from uuid import UUID

from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps.security import is_project_manager
from app.api.mcp.apps import DRAFT_REVIEW_URI
from app.api.mcp.asgi_auth import current_principal
from app.api.mcp.draft_diff import capped_diff
from app.api.mcp.errors import McpErrorCode, McpToolError
from app.api.mcp.server import agent_tool
from app.api.mcp.template_changes import changes_view
from app.llm.claim_value import normalize_options
from app.schemas.extraction_run import RunViewEntityType, RunViewField
from app.schemas.mcp_templates import (
    McpOption,
    McpTemplateQuestion,
    McpTemplateSection,
    McpTemplateView,
)
from app.services.extraction_snapshot import general_instructions_for_version, live_entity_types
from app.services.project_read_service import project_name, template_summaries
from app.services.project_template_active_service import owned_template
from app.services.template_instruction_service import get_template_instruction
from app.services.template_lint import lint_tree
from app.services.template_versioning import (
    NoActiveTemplateVersionError,
    get_active_version_tree,
    get_template_config_diff,
)
from app.utils import app_urls
from app.utils.compact_json import RESULT_CAP, compact_json
from app.utils.opaque_cursor import (
    CURSOR_RESERVE,
    InvalidCursorError,
    cursor_position,
    decode_cursor,
    encode_cursor,
)
from app.utils.text_caps import cap_text

#: (flag, RunViewField attribute) in the order `flags` lists the true ones.
_FLAGS = (
    ("required", "is_required"),
    ("entity_key", "is_entity_key"),
    ("allows_not_applicable", "allows_not_applicable"),
    ("allows_not_evaluated", "allows_not_evaluated"),
    ("allows_no_information", "allows_no_information"),
    ("allow_other", "allow_other"),
)


def _json_len(model: BaseModel) -> int:
    """Length of `compact_json` (task 2c's one serializer): the same measure
    the size-cap tests apply (`len(compact_json(page))`) and the dispatcher
    uses for a result's text copy, which is longer than pydantic's own
    compact `model_dump_json()` -- every key and every list item gets extra
    `", "` / `": "` spacing. Non-ASCII renders raw (one char each); only
    quotes, backslashes and control characters grow when escaped. All size accounting in this module uses this,
    never the raw `model_dump_json()` length, or the budget under-charges
    and a page can clear the compact count while still exceeding the real
    32,000-char cap."""
    return len(compact_json(model.model_dump(mode="json")))


_NO_DRAFT = "No draft is open; this is the published questionnaire."
_MANAGER_ONLY = "Only a project manager can read the draft."


@agent_tool(
    requires="read",
    project_arg="project_id",
    title="Get template",
    ui_resource=DRAFT_REVIEW_URI,
    destructive=False,
    description=(
        "Return a questionnaire: the template instruction (and whether it is still the "
        "imported default), sections (description, entry label, required) -> questions "
        "(type, options, instructions, unit, allowed units, flags), whether a draft is open, "
        "the published version and the draft's changes vs published. `instrument` is the "
        "stable code of the tool the template comes from (custom for an in-house one). "
        "`narrow` is true when the published version is empty or in an older format (a "
        "publish in prumo refreshes it), null when nothing is published. `flags` lists "
        "only the flags that are true. Paged: pass next_cursor until it is null. "
        'Three views: view="published" (default) is what reviewers and AI use; its '
        "first page carries a capped draft_diff for managers. "
        'view="draft" (managers only) is the unpublished questionnaire as edited; its '
        "first page carries `fingerprint` and `lint` (problems that block or weaken AI "
        'extraction). view="changes" (managers only) pages every row Publish would '
        "apply, with affects_recorded_data and affects_ai; page it to read every row "
        "when draft_diff is truncated. `fingerprint` is the one Publish checks. Draft "
        "edits are invisible to reviewers and AI until a manager publishes in prumo."
    ),
)
async def get_template(
    db: AsyncSession,
    project_id: UUID,
    template_id: UUID,
    view: Literal["published", "draft", "changes"] = "published",
    cursor: str | None = None,
) -> McpTemplateView:
    # ProjectTemplateNotFoundError (foreign or missing) propagates: the dispatcher answers NOT_FOUND.
    template = await owned_template(db, project_id=project_id, template_id=template_id)
    is_manager = await is_project_manager(db, project_id, current_principal().user_sub)
    if view != "published" and not is_manager:
        raise McpToolError(McpErrorCode.MANAGER_REQUIRED, _MANAGER_ONLY)
    summary = next(
        t
        for t in await template_summaries(db, project_id=project_id)
        if t.template_id == template_id
    )
    # config-status/diff are manager-only over REST; same here
    draft_open = (template.config_draft_since is not None) if is_manager else None
    envelope = McpTemplateView(
        template_id=template.id,
        template_name=cap_text(template.name)[0],
        project_name=cap_text(await project_name(db, project_id))[0],
        view=view,
        kind=template.kind,
        instrument=summary.instrument,
        published_version=summary.published_version,
        narrow=summary.narrow,
        instruction=None,
        instruction_is_default=False,
        draft_open=draft_open,
        sections=[],
        draft_diff=None,
        next_cursor=None,
        editor_url=app_urls.editor_url(project_id, template.kind) if is_manager else None,
    )
    if view == "changes":
        return await changes_view(
            db, project_id=project_id, template_id=template_id, cursor=cursor, envelope=envelope
        )

    instruction: str | None = None
    if view == "draft":
        tree = await live_entity_types(db, template_id=template_id)
        instruction = template.llm_template_instruction
    else:
        try:
            active = await get_active_version_tree(
                db, project_id=project_id, template_id=template_id
            )
        except NoActiveTemplateVersionError:
            tree = await live_entity_types(db, template_id=template_id)
        else:
            tree = active.entity_types
            instruction = await general_instructions_for_version(db, active.version_id)
    is_default = False
    if template.global_template_id is not None:
        default = (
            await get_template_instruction(db, project_id=project_id, template_id=template_id)
        ).default_instruction
        is_default = instruction == default

    try:
        raw = decode_cursor(cursor, arity=2)
    except InvalidCursorError as exc:
        raise McpToolError(
            McpErrorCode.INVALID_ARGUMENT, "cursor is not valid; restart without it", field="cursor"
        ) from exc
    start = _validated_start(raw, tree)

    page1: dict[str, object] = {}
    if raw is None and is_manager:  # draft state rides on page 1 only
        diff = await get_template_config_diff(db, project_id=project_id, template_id=template_id)
        if view == "published":
            page1["draft_diff"] = capped_diff(diff)
        else:
            page1.update(fingerprint=diff.fingerprint, lint=lint_tree(tree, instruction))
    if view == "draft" and not draft_open:
        page1["note"] = _NO_DRAFT

    # The diff (built above, since it rides on page 1 only) and every fixed
    # envelope field are charged against the 32,000-char result cap FIRST;
    # what is left is the budget `_page_sections` may spend on section
    # headers and questions (B1: the old fixed 24,000 budget counted
    # questions only and let the diff and section headers ride free).
    envelope = envelope.model_copy(
        update={"instruction": instruction, "instruction_is_default": is_default, **page1}
    )
    section_budget = max(1, RESULT_CAP - _json_len(envelope) - CURSOR_RESERVE)
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
        description=et.description,
        entry_label=et.entry_label,
        required=et.is_required,
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
        unit=field.unit,
        allowed_units=_unit_strings(field.allowed_units),
        flags=[flag for flag, attr in _FLAGS if getattr(field, attr)],
    )


def _unit_strings(allowed_units: object) -> list[str] | None:
    """The string units of a list; any other stored shape reads as None."""
    if not isinstance(allowed_units, list):
        return None
    return [u for u in allowed_units if isinstance(u, str)]


def _options(allowed_values: object) -> list[McpOption] | None:
    return [McpOption(**o) for o in normalize_options(allowed_values)] or None
