"""Template versioning: the draft/published boundary of a project template.

A project template has a LIVE structure (``extraction_entity_types`` /
``extraction_fields`` / ``llm_template_instruction``) that the config
editors and the MCP draft tool mutate in place, and an append-only chain of
``extraction_template_versions`` snapshots that runs pin to. This package
owns every operation that moves state across that boundary or reads it:

* :func:`clone_template` — clone a global template into a project and
  publish v1 (or heal and re-publish an existing clone).
* :class:`TemplateVersionService` — ``republish`` the live tree as the next
  active version (and re-pin editable-stage runs to it).
* :func:`discard_draft` — reconcile the live tree back to the active version.
* :func:`restore_version` — stage an older version's shape as the draft.
* :func:`get_template_config_status` / :func:`get_template_config_diff` —
  the draft chip and the Publish sheet read models.
* :func:`get_active_version_tree` / :func:`get_template_version_history` —
  the pinned tree and the version list.

The underscore modules are implementation: the pure snapshot diff
(``_diff``), its wire projection (``_diff_read``), the snapshot→live writer
(``_restore``) and the clone/publish/read/discard/restore orchestration. Nothing
outside this package imports them;
``tests/unit/test_template_versioning_boundary.py`` enforces it.
"""

from app.services.template_clone_service import TemplateNotFoundError
from app.services.template_versioning._clone import clone_template
from app.services.template_versioning._discard import (
    DiscardBlockedByCardinalityError,
    DiscardRacedError,
    NarrowBaselineError,
    OrphanAcknowledgementRequiredError,
    discard_draft,
)
from app.services.template_versioning._publish import (
    PendingConfigDraftError,
    PublishBlockedByMultiEntryError,
    PublishDiffDriftedError,
    PublishMissingAcknowledgementError,
    TemplateVersionService,
)
from app.services.template_versioning._read import (
    NoActiveTemplateVersionError,
    get_active_version_tree,
    get_template_config_diff,
    get_template_config_status,
    get_template_version_history,
)
from app.services.template_versioning._restore_version import (
    VersionNotFoundError,
    restore_version,
)

__all__ = [
    "clone_template",
    "DiscardBlockedByCardinalityError",
    "DiscardRacedError",
    "NarrowBaselineError",
    "NoActiveTemplateVersionError",
    "OrphanAcknowledgementRequiredError",
    "PendingConfigDraftError",
    "PublishBlockedByMultiEntryError",
    "PublishDiffDriftedError",
    "PublishMissingAcknowledgementError",
    "TemplateNotFoundError",
    "TemplateVersionService",
    "VersionNotFoundError",
    "discard_draft",
    "get_active_version_tree",
    "get_template_config_diff",
    "get_template_config_status",
    "get_template_version_history",
    "restore_version",
]
