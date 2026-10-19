"""The one rule that bumps ``projects.protocol_revision``.

The counter tracks changes to the review protocol. Its two writers
(``project_details_service.update_details`` and
``project_ai_context.set_ai_context``) call :func:`bump_protocol_revision`
inside the row lock they already hold, once per call, and only when a
protocol value actually changed.
"""

from __future__ import annotations

from app.models.project import Project

#: Detail columns that are part of the protocol. A write touching only other
#: details (name, description, ...) never bumps.
PROTOCOL_DETAIL_KEYS: frozenset[str] = frozenset(
    {"eligibility_criteria", "study_design", "review_type"}
)


def bump_protocol_revision(project: Project) -> None:
    """Add one to the protocol revision.

    Call only inside the row lock, and only when a protocol value changed.
    """
    # Spelled as a read plus a write: vulture reads `+=` as an unused attribute.
    project.protocol_revision = project.protocol_revision + 1  # NOT NULL DEFAULT 1, CHECK >= 1
