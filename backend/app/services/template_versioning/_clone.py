"""Clone a global template into a project, and publish what was cloned.

``TemplateCloneService`` materializes structure; this module decides when
that structure becomes an active ``extraction_template_versions`` row.
Three dispositions, one publish path (``TemplateVersionService.republish``,
B-4):

* **fresh** — no clone yet: insert the row and its structure, publish v1.
* **zero-state heal** — the clone exists but its live structure was never
  inserted (legacy data, aborted clone): rebuild from the global and publish.
* **drift heal** — live counts differ from the ACTIVE SNAPSHOT: publish the
  LIVE structure as a new version. Never wipe — with user-editable templates
  a count mismatch is indistinguishable from a deliberate edit whose
  republish was lost, and the historical wipe-and-rebuild destroyed
  customizations. Live is authoritative; true factory recovery is an
  explicit delete + re-import.
* **rules refresh** — the catalogue's QA rules (``derived_judgments``,
  ``scope_rules``) differ from the active snapshot's: write them to the
  clone and publish a new version, alongside either heal or alone on an
  aligned clone. Runs pinned to older versions keep their rules.

Idempotent on ``(project_id, global_template_id)``: a second call returns
the existing clone (re-activated) instead of creating duplicates. Flushes,
never commits.
"""

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionTemplateGlobal, ProjectExtractionTemplate
from app.models.extraction_versioning import ExtractionTemplateVersion, TemplateKind
from app.repositories.extraction_template_version_repository import (
    ExtractionTemplateVersionRepository,
)
from app.services.extraction_snapshot import qa_rules_of
from app.services.template_clone_service import TemplateCloneService
from app.services.template_versioning._diff import (
    TEMPLATE_INSTRUCTION_KEY,
    normalize_instruction,
)
from app.services.template_versioning._publish import (
    PendingConfigDraftError,
    TemplateVersionService,
)


@dataclass(frozen=True, slots=True, kw_only=True)
class TemplateClone:
    """Result envelope returned by :func:`clone_template`."""

    project_template_id: UUID
    version_id: UUID
    entity_type_count: int
    field_count: int
    created: bool


def _snapshot_structure_counts(version: ExtractionTemplateVersion) -> tuple[int, int]:
    """Entity-type and field counts recorded in a version snapshot."""
    entity_types = (version.schema_ or {}).get("entity_types", [])
    return len(entity_types), sum(len(et.get("fields", [])) for et in entity_types)


async def clone_template(
    db: AsyncSession,
    *,
    project_id: UUID,
    global_template_id: UUID,
    user_id: UUID,
    kind: TemplateKind,
) -> TemplateClone:
    """Clone ``global_template_id`` into ``project_id`` and publish it.

    ``kind`` requires a specific lineage at the global level; a mismatch is
    ``TemplateNotFoundError`` like a missing id. Raises
    ``PendingConfigDraftError`` when either heal or a rules refresh would
    publish an unpublished draft (B-4).
    """
    structure = TemplateCloneService(db)
    publisher = TemplateVersionService(db)
    global_tpl = await structure.global_template(global_template_id, kind=kind)

    existing = await structure.resolve_existing_clone(project_id, global_template_id)
    if existing is None:
        project_tpl, entity_type_count, field_count = await structure.create_from_global(
            project_id=project_id, global_tpl=global_tpl, user_id=user_id, kind=kind
        )
        # Publish v1 through the one publish path (B-4): republish
        # snapshots under its locks and clears the draft marker the
        # structure inserts above just stamped. A brand-new template has
        # no runs, so the advisory step is a no-op (no ABBA reachable).
        first = await publisher.republish(
            project_id=project_id,
            project_template_id=project_tpl.id,
            user_id=user_id,
        )
        return TemplateClone(
            project_template_id=project_tpl.id,
            version_id=first.version_id,
            entity_type_count=entity_type_count,
            field_count=field_count,
            created=True,
        )

    entity_types, fields = await structure.structure_counts(existing.id)
    version = await ExtractionTemplateVersionRepository(db).get_active(existing.id)
    # The deferred constraint trigger
    # ``project_extraction_templates_active_version`` (migration 0004) makes
    # a template-without-active-version state unrepresentable, so this
    # lookup is a hard guarantee.
    assert version is not None, (
        f"Active-version invariant violated for project_extraction_template "
        f"{existing.id}; the DB trigger should have prevented this."
    )
    snapshot_et, snapshot_field = _snapshot_structure_counts(version)
    # Heal existing clones. Drift is measured against the template's
    # ACTIVE SNAPSHOT, never against the global template — deliberate
    # config edits are republished as a new version, so a healthy edited
    # template has live == snapshot. A legacy clone may carry an empty
    # placeholder snapshot (live == snapshot == 0), so zero-state gets its
    # own clause.
    zero_state = entity_types == 0 and fields == 0
    drifted = entity_types != snapshot_et or fields != snapshot_field
    rules_changed = qa_rules_of(global_tpl.schema_) != qa_rules_of(version.schema_)
    version_id = version.id
    if zero_state:
        # Locks BEFORE the rebuild: the rebuild's mark-draft trigger
        # stamps take the template-row lock, and taking republish's
        # advisory locks after that would invert the documented
        # order against session-open (ABBA).
        await publisher.acquire_publish_locks(existing.id)
        # Strictly between the locks and the rebuild: after the
        # locks so the read is authoritative, and BEFORE the inserts
        # because they stamp the marker themselves (0048) and would
        # make the guard's own early-out unreachable.
        await _refuse_if_instruction_draft_pending(
            db, existing.id, active_snapshot=version.schema_ or {}
        )
        if rules_changed:
            # Under the locks above: the schema UPDATE takes the
            # template-row lock (see ``_write_catalogue_rules``).
            await _write_catalogue_rules(db, existing, global_tpl)
        entity_types, fields = await structure.rebuild_from_global(
            project_template_id=existing.id, global_template_id=global_template_id
        )
        # A NEW active version (append-only — never rewrite the placeholder
        # in place), draft marker cleared under the locks above.
        republished = await publisher.republish(
            project_id=project_id,
            project_template_id=existing.id,
            user_id=user_id,
        )
        version_id = republished.version_id
    elif drifted or rules_changed:
        if drifted and existing.config_draft_since is not None:
            # B-4: a marker-set drift is a PENDING DRAFT, and this
            # heal would silently publish it. Fast-fail courtesy —
            # the AUTHORITATIVE re-check runs under republish's
            # locks (fail_if_pending_draft), so a stamp landing
            # after this read still refuses. A marker-NULL drift
            # is a lost republish and self-heals as before. A rules
            # refresh on aligned structure refuses there too, rather
            # than ship a pending draft with the new rules.
            raise PendingConfigDraftError()
        # Locks BEFORE the rules write, as in the zero-state branch:
        # the schema UPDATE takes the template-row lock.
        await publisher.acquire_publish_locks(existing.id)
        if rules_changed:
            await _write_catalogue_rules(db, existing, global_tpl)
        republished = await publisher.republish(
            project_id=project_id,
            project_template_id=existing.id,
            user_id=user_id,
            fail_if_pending_draft=True,
        )
        version_id = republished.version_id
    # ``version`` is deliberately NOT refreshed from the global: it names
    # the structure lineage this clone was built from, and the non-empty
    # heal never rebuilds structure from the global.
    await structure.reactivate(existing, global_tpl=global_tpl, kind=kind)
    return TemplateClone(
        project_template_id=existing.id,
        version_id=version_id,
        entity_type_count=entity_types,
        field_count=fields,
        created=False,
    )


async def _write_catalogue_rules(
    db: AsyncSession,
    existing: ProjectExtractionTemplate,
    global_tpl: ExtractionTemplateGlobal,
) -> None:
    """Write the catalogue's rules to the clone, flushed so ``republish``
    (which reads the LIVE ``schema`` through SQL) snapshots them.

    The caller holds ``acquire_publish_locks`` first. The UPDATE row-locks
    the template, while ``republish``, run creation and session-open take
    the advisory publish locks BEFORE the template row; writing first
    would invert that order and can deadlock a re-import against a run
    being opened (ABBA). ``reactivate`` repeats the same assignment
    idempotently.
    """
    existing.schema_ = dict(global_tpl.schema_ or {})
    await db.flush()


async def _refuse_if_instruction_draft_pending(
    db: AsyncSession,
    project_template_id: UUID,
    *,
    active_snapshot: dict[str, Any],
) -> None:
    """Refuse a zero-state heal that would publish a staged instruction.

    ``republish`` snapshots the LIVE ``llm_template_instruction``, and
    this branch resets structure from the global but never that column
    — so healing over a staged draft ships unapproved text into
    prompts, and session-open reaches it as any project MEMBER.
    ``fail_if_pending_draft`` cannot guard it: the rebuild's own
    inserts stamp the marker, so the flag would refuse every heal.

    Hence two conditions, because each alone over-refuses:

    * marker alone — deleting every section stamps it as a byproduct
      (0048 trigger), and delete-everything + re-import is the
      documented factory-recovery workflow, which must keep working;
    * content alone — a legacy clone published before the snapshot
      carried ``llm_template_instruction`` reads live != pinned with
      nothing actually pending.

    The LIVE columns are read fresh (not off the identity-mapped row
    loaded before the locks) so the check is authoritative rather than
    TOCTOU-racy. The pinned side needs no such read: version rows are
    append-only, so ``active_snapshot`` cannot have gone stale.

    The instruction is the only draft-editable template-level key in the
    snapshot. The QA rules keys (``derived_judgments``, ``scope_rules``)
    change only by re-import from the global catalogue, which refreshes and
    republishes them, so no draft of theirs can be pending here.
    """
    marker, live = (
        await db.execute(
            select(
                ProjectExtractionTemplate.config_draft_since,
                ProjectExtractionTemplate.llm_template_instruction,
            ).where(ProjectExtractionTemplate.id == project_template_id)
        )
    ).one()
    if marker is None:
        return
    if normalize_instruction(live) != normalize_instruction(
        active_snapshot.get(TEMPLATE_INSTRUCTION_KEY)
    ):
        raise PendingConfigDraftError()
