"""Setup readiness: what stands between a project and a useful AI run.

One read over the review question, the active templates and their
questionnaire lint. Each item carries a status, an optional subject, a
message (authored labels embedded, capped) and a next step naming the MCP
tool or prumo page that fixes it. Draft state is manager-only: the caller
passes ``is_manager`` (this module never imports ``app.api``). Reads no
extraction values.
"""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_handler import NotFoundError
from app.models.project import Project
from app.repositories.project_repository import ProjectRepository
from app.schemas.mcp_projects import McpTemplateSummary
from app.schemas.mcp_readiness import (
    McpReadinessItem,
    McpReadinessSubject,
    McpReadinessSummary,
    McpSetupReadiness,
)
from app.schemas.template_lint import LintCode, LintFinding
from app.services.extraction_snapshot import general_instructions_for_version, live_entity_types
from app.services.project_ai_context import build_review_question, picots_switch_on
from app.services.project_read_service import project_name, template_summaries
from app.services.project_template_active_service import owned_template
from app.services.template_lint import lint_tree
from app.services.template_versioning import (
    NoActiveTemplateVersionError,
    get_active_version_tree,
)
from app.utils.app_urls import editor_url
from app.utils.text_caps import cap_text

_MESSAGE_CAP = 500
_NAME_CAP = 80
_LABEL_CAP = 60
_SET_REVIEW_QUESTION = "call set_review_question"
_EDIT_DRAFT = "edit_template_draft"
_Tree = Literal["published", "draft"]

_LINT_TEXT: dict[LintCode, str] = {
    "SELECT_WITHOUT_OPTIONS": "select question(s) without options",
    "REPEATING_SECTION_WITHOUT_ENTITY_KEY": "repeating section(s) without an entity-key question",
    "REPEATING_SECTION_WITHOUT_ENTRY_LABEL": "repeating section(s) without an entry label",
    "EMPTY_SECTION": "section(s) without questions",
    "QUESTION_WITHOUT_AI_GUIDANCE": "question(s) without AI guidance",
    "UNRESOLVED_CUSTOMIZE_SLOT": "unfilled [customize: ...] slot(s)",
}


async def build_setup_readiness(
    db: AsyncSession, *, project_id: UUID, is_manager: bool
) -> McpSetupReadiness:
    """Items in order: review question, review type, the extraction-template
    gate, then per active template its state items and its lint."""
    project = await ProjectRepository(db).get_by_id(project_id)
    if project is None:
        raise NotFoundError("Project", str(project_id))
    items = await _protocol_items(db, project)
    active = [t for t in await template_summaries(db, project_id=project_id) if t.is_active]
    if not any(t.kind == "extraction" for t in active):
        items.append(
            McpReadinessItem(
                code="NO_ACTIVE_EXTRACTION_TEMPLATE",
                status="block",
                message="The project has no active extraction template; AI extraction cannot start.",
                next_step=editor_url(project_id, "extraction"),
            )
        )
    for summary in sorted(active, key=lambda t: t.kind != "extraction"):
        items += await _template_items(db, project_id, summary, is_manager=is_manager)
    block = sum(item.status == "block" for item in items)
    return McpSetupReadiness(
        project_id=project_id,
        project_name=cap_text(await project_name(db, project_id))[0],
        protocol_revision=project.protocol_revision,
        summary=McpReadinessSummary(block=block, warn=len(items) - block, ok=block == 0),
        items=items,
        draft_detail_hidden=not is_manager,
    )


async def _protocol_items(db: AsyncSession, project: Project) -> list[McpReadinessItem]:
    items: list[McpReadinessItem] = []
    if not picots_switch_on(project.settings):
        items.append(
            McpReadinessItem(
                code="REVIEW_QUESTION_DISABLED",
                status="warn",
                message="Sending the review question to the AI is turned off.",
                next_step=_SET_REVIEW_QUESTION,
            )
        )
    else:
        question = await build_review_question(db, project.id)
        if question is None or question.text is None:
            items.append(
                McpReadinessItem(
                    code="REVIEW_QUESTION_EMPTY",
                    status="warn",
                    message="The review question is empty; the AI extracts without the review's scope.",
                    next_step=_SET_REVIEW_QUESTION,
                )
            )
    if not project.review_type:
        items.append(
            McpReadinessItem(
                code="REVIEW_TYPE_MISSING",
                status="warn",
                message="The project has no review type.",
                next_step="call update_project_details with review_type",
            )
        )
    return items


async def _template_items(
    db: AsyncSession, project_id: UUID, summary: McpTemplateSummary, *, is_manager: bool
) -> list[McpReadinessItem]:
    template = await owned_template(db, project_id=project_id, template_id=summary.template_id)
    name = cap_text(summary.name, _NAME_CAP)[0]
    subject = McpReadinessSubject(kind="template", id=summary.template_id, name=name)
    url = editor_url(project_id, summary.kind)
    publish_step = f"a manager publishes in prumo at {url}"
    draft_open = template.config_draft_since is not None
    items: list[McpReadinessItem] = []
    if summary.published_version is None:
        items.append(
            McpReadinessItem(
                code="TEMPLATE_NOT_PUBLISHED",
                status="block",
                subject=subject,
                message=f"Template '{name}' has no published version; reviewers and the AI cannot use it.",
                next_step=url,
            )
        )
    if summary.narrow is True:
        items.append(
            McpReadinessItem(
                code="TEMPLATE_NARROW_BASELINE",
                status="warn",
                subject=subject,
                message=f"Template '{name}' was published empty or in an older format.",
                next_step=publish_step,
            )
        )
    if is_manager and draft_open:
        items.append(
            McpReadinessItem(
                code="DRAFT_PENDING_PUBLISH",
                status="warn",
                subject=subject,
                message=(
                    f"Template '{name}' has unpublished draft changes; reviewers and the AI "
                    "use the published version."
                ),
                next_step=publish_step,
            )
        )

    if summary.published_version is not None:
        try:
            active = await get_active_version_tree(
                db, project_id=project_id, template_id=summary.template_id
            )
        except NoActiveTemplateVersionError:
            pass  # unpublished between the two reads: TEMPLATE_NOT_PUBLISHED is stale, skip lint
        else:
            instruction = await general_instructions_for_version(db, active.version_id)
            for finding in lint_tree(active.entity_types, instruction):
                items.append(_lint_item(finding, subject, "published", url))
    # The draft tree equals the published one unless a draft is open (or
    # nothing is published): lint it only then, so no finding is listed twice.
    if is_manager and (draft_open or summary.published_version is None):
        tree = await live_entity_types(db, template_id=summary.template_id)
        for finding in lint_tree(tree, template.llm_template_instruction):
            items.append(_lint_item(finding, subject, "draft", _EDIT_DRAFT))
    return items


def _lint_item(
    finding: LintFinding, subject: McpReadinessSubject, tree: _Tree, next_step: str
) -> McpReadinessItem:
    return McpReadinessItem(
        code=finding.code,
        status=finding.status,
        subject=subject,
        tree=tree,
        message=_lint_message(finding, subject.name, tree),
        next_step=next_step,
    )


def _lint_message(finding: LintFinding, template: str, tree: _Tree) -> str:
    """Count, rule, template, first section and up to five question labels;
    "and N more" when the count exceeds the examples shown."""
    message = f"{finding.count} {_LINT_TEXT[finding.code]} in the {tree} '{template}'"
    shown = len(finding.question_labels)
    if finding.section_label:
        message += f", first in section '{cap_text(finding.section_label, _NAME_CAP)[0]}'"
        shown = shown or 1
    if finding.question_labels:
        message += ": " + "; ".join(
            cap_text(label, _LABEL_CAP)[0] for label in finding.question_labels
        )
    if finding.count > shown:
        message += f" and {finding.count - shown} more"
    return cap_text(message, _MESSAGE_CAP)[0]
