"""Template QA rules frozen into existing template-version snapshots.

A template version snapshot now carries the template's quality-assessment
rules, ``derived_judgments`` and ``scope_rules``, when the template declares
them (``project_extraction_templates.schema``), so a later re-import that
changes the rules cannot change what runs pinned to older versions compute.
One UPDATE copies each key into every existing version of the template that
lacks it, only when the template's value is non-empty (absent ≡ empty, the
rule the snapshot builder applies). A version that already holds a key keeps
its own value; no version is created, and a template without rules is left
untouched. This backfill is the one sanctioned rewrite of frozen
``extraction_template_versions.schema`` JSON: existing versions get the rules
their template holds at upgrade time. Re-running selects no row.

``extraction_template_versions`` carries no draft-marker trigger, so the
UPDATE stamps no ``config_draft_since``.

Downgrade strips both keys from every version, including versions published
after this revision (the pre-0085 code never reads them). A later re-upgrade
backfills those versions from the template's rules at that time, not the rules
they were published with — accepted: the downgrade is a dev/rollback path only.

Revision ID: 0085_freeze_qa_rules
Revises: 0084_canonical_field_options
"""

from alembic import op

revision = "0085_freeze_qa_rules"
down_revision = "0084_canonical_field_options"
branch_labels = None
depends_on = None

#: The template holds a value Python reads as truthy for ``key``.
_DECLARED = (
    "(t.schema -> '{key}' IS NOT NULL AND t.schema -> '{key}' NOT IN "
    "('null'::jsonb, '[]'::jsonb, '{{}}'::jsonb, '\"\"'::jsonb, '0'::jsonb, 'false'::jsonb))"
)
#: The version lacks ``key`` and its template declares one.
_MISSING = "(NOT v.schema ? '{key}' AND " + _DECLARED + ")"
_COPY = (
    "CASE WHEN " + _MISSING + " THEN jsonb_build_object('{key}', t.schema -> '{key}') "
    "ELSE '{{}}'::jsonb END"
)
_KEYS = ("derived_judgments", "scope_rules")

UPGRADE_SQL = f"""
UPDATE public.extraction_template_versions v
SET schema = v.schema || {" || ".join(_COPY.format(key=k) for k in _KEYS)}
FROM public.project_extraction_templates t
WHERE v.project_template_id = t.id
  AND ({" OR ".join(_MISSING.format(key=k) for k in _KEYS)})
"""

DOWNGRADE_SQL = """
UPDATE public.extraction_template_versions
SET schema = schema - 'derived_judgments' - 'scope_rules'
WHERE schema ? 'derived_judgments' OR schema ? 'scope_rules'
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
