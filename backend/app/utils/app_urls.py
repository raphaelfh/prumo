"""Links into the prumo web app, for MCP results and services alike.

A support module: it imports only settings, so services may use it without
reaching into ``app.api``.
"""

from uuid import UUID

from app.core.config import settings

# The template editor tab of each template kind.
_EDITOR_TAB = {
    "extraction": "tab=extraction&extractionTab=configuration",
    "quality_assessment": "tab=quality&qaTab=configuration",
}


def editor_url(project_id: UUID, kind: str) -> str:
    """The project page opened on the template editor of ``kind``."""
    return f"{settings.PUBLIC_APP_URL.rstrip('/')}/projects/{project_id}?{_EDITOR_TAB[kind]}"
