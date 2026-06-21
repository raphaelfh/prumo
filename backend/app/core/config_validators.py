"""Pure, side-effect-free validators for application settings.

Kept in a leaf module (no Settings construction, no env access) so the
fail-fast contract checks can be unit-tested without a populated ``.env`` or a
database — importing ``app.core.config`` would otherwise build ``Settings`` at
module load.
"""

from __future__ import annotations

import re

_LINEAR_TEAM_ID_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def validate_linear_team_id(value: str | None) -> str | None:
    """Fail fast if ``LINEAR_TEAM_ID`` is set but is not a Linear team UUID.

    ``issueCreate(teamId:)`` requires the team **UUID**; the human-readable team
    key (e.g. ``FEE``) silently mis-routes in-app feedback to the wrong team (or
    fails outright), so we reject it at startup rather than at the first feedback
    submission. ``None``/empty is allowed (the integration is simply disabled).
    """
    if value is None:
        return None
    stripped = value.strip()
    if not stripped:
        return None
    if not _LINEAR_TEAM_ID_UUID_RE.match(stripped):
        raise ValueError(
            "LINEAR_TEAM_ID must be the Linear team UUID "
            "(e.g. 23d83039-4f9a-444f-905a-9a4cb9fea2b6), not the team key/slug "
            "like 'FEE' — issueCreate(teamId:) requires the UUID."
        )
    return stripped
