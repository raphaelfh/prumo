"""Split CHARMS into study-level and per-model entity types

Revision ID: 0015_charms_studylevel_split
Revises: 0014_one_active_extraction_tpl
Create Date: 2026-05-17

The CHARMS template was seeded with every entity type (Source of Data,
Participants, Outcome, …, Observations) parented under ``prediction_models``,
which forced ALL fields to be rendered per prediction model. CHARMS
methodology (Moons et al., PLoS Med 2014) — and the PROBAST/PROBAST+AI
extensions that build on it — separate items by scope:

* **Study-level** (one record per article): Source of Data, Participants,
  Outcome to be Predicted, Candidate Predictors, Sample Size, Missing
  Data, Observations.
* **Per-model** (one record per prediction model evaluated): Model
  Development, Final Predictors, Performance, Validation, Results,
  Interpretation.

The original structure left ``studyLevelSections`` (root entity types ≠
``prediction_models``) empty in the frontend — so the only way to enter
e.g. participant demographics was inside the per-model accordion, and
each model carried its own duplicate copy. This migration:

1. **Reparents** the seven study-level entity types to ``parent_entity_type_id
   = NULL`` on the global CHARMS template AND on every project clone that
   was created from it.
2. **Renumbers** ``sort_order`` to put study-level first, then the
   ``prediction_models`` selector, then closing observations — matching
   ``seed_charms`` after the fix.
3. **De-duplicates** existing ``extraction_instances`` for the reparented
   types. A project that already had N models will have N copies of e.g.
   "Source of Data" (one under each model). We keep the **oldest** copy
   per ``(article_id, entity_type_id)`` and CASCADE-delete the rest;
   downstream values/proposals/decisions on the deleted copies go with
   them.
4. **Clears** ``parent_instance_id`` on the surviving copies so they are
   no longer nested under a model.

The frozen ``extraction_template_versions.schema`` snapshots are
intentionally left alone — they are the immutable audit record for any
runs that started against the pre-fix structure. Read paths in the
frontend hit ``extraction_entity_types`` directly, so the UI flips to
the new layout the moment the migration commits.

Downgrade is destructive in the same way the upgrade is (you cannot
"un-deduplicate" deleted rows), so it only restores the structural
reparenting under ``prediction_models``.
"""

from alembic import op

revision = "0015_charms_studylevel_split"
down_revision = "0014_one_active_extraction_tpl"
branch_labels = None
depends_on = None


# Stable across environments — same UUID used in seed.py.
_CHARMS_GLOBAL_ID = "000c0000-0000-0000-0000-000000000001"

# Entity-type names that move from being children of ``prediction_models``
# to being study-level (root) sections.
_STUDY_LEVEL_NAMES = (
    "source_of_data",
    "participants",
    "outcome_to_be_predicted",
    "candidate_predictors",
    "sample_size",
    "missing_data",
    "model_observations",
)

# New sort order from seed_charms after the split. Keys are entity-type
# ``name`` (stable identifier across global + clones). Values map to
# ``(new_sort_order, new_parent_name_or_None)``. Values are globally
# unique within the template so ``TemplateCloneService`` — which iterates
# in ``sort_order`` order and expects each row's parent to already be
# mapped — sees ``prediction_models`` (sort=6) before any of its
# children (sort=7-12); ``model_observations`` closes the study-level
# stack at sort=13.
_NEW_LAYOUT: dict[str, tuple[int, str | None]] = {
    # Study-level (root)
    "source_of_data": (0, None),
    "participants": (1, None),
    "outcome_to_be_predicted": (2, None),
    "candidate_predictors": (3, None),
    "sample_size": (4, None),
    "missing_data": (5, None),
    "prediction_models": (6, None),
    # Per-model children — must follow ``prediction_models`` in sort order
    # so the clone service iterates parent → child.
    "model_development": (7, "prediction_models"),
    "final_predictors": (8, "prediction_models"),
    "model_performance": (9, "prediction_models"),
    "model_validation": (10, "prediction_models"),
    "model_results": (11, "prediction_models"),
    "model_interpretation": (12, "prediction_models"),
    # Study-level closing notes
    "model_observations": (13, None),
}


def upgrade() -> None:
    # Step 1 — bump the visible version + description on the global row so
    # the Import dialog and audit log show the change. Idempotent.
    op.execute(
        f"""
        UPDATE public.extraction_templates_global
        SET version = '1.1.0',
            description = 'CHARMS checklist for prediction model studies. '
                          'Study-level sections (Source of Data, Participants, '
                          'Outcome, Candidate Predictors, Sample Size, Missing '
                          'Data, Observations) are filled once per article; '
                          'per-model sections (Model Development, Final '
                          'Predictors, Performance, Validation, Results, '
                          'Interpretation) are filled once per prediction '
                          'model evaluated in the article — matching '
                          'PROBAST/CHARMS methodology.'
        WHERE id = '{_CHARMS_GLOBAL_ID}'
        """
    )

    # Step 2 — reparent + renumber on the global template AND on every
    # project clone of CHARMS in one set-based statement. The CTE finds
    # each CHARMS entity-type tree (global + clones), looks up its target
    # parent by name within the same tree, and applies the new layout.
    op.execute(
        """
        WITH charms_trees AS (
            -- Global CHARMS rows (template_id set, project_template_id null)
            SELECT et.id,
                   et.name,
                   NULL::uuid AS project_template_id,
                   et.template_id AS owner_template_id
            FROM public.extraction_entity_types et
            WHERE et.template_id = '000c0000-0000-0000-0000-000000000001'

            UNION ALL

            -- Project clones of CHARMS (project_template_id set, template_id null)
            SELECT et.id,
                   et.name,
                   pet.id AS project_template_id,
                   NULL::uuid AS owner_template_id
            FROM public.extraction_entity_types et
            JOIN public.project_extraction_templates pet
              ON pet.id = et.project_template_id
            WHERE pet.global_template_id = '000c0000-0000-0000-0000-000000000001'
        ),
        new_layout(name, new_sort_order, new_parent_name) AS (
            VALUES
                ('source_of_data',          0, NULL::text),
                ('participants',            1, NULL),
                ('outcome_to_be_predicted', 2, NULL),
                ('candidate_predictors',    3, NULL),
                ('sample_size',             4, NULL),
                ('missing_data',            5, NULL),
                ('prediction_models',       6, NULL),
                ('model_development',       7, 'prediction_models'),
                ('final_predictors',        8, 'prediction_models'),
                ('model_performance',       9, 'prediction_models'),
                ('model_validation',       10, 'prediction_models'),
                ('model_results',          11, 'prediction_models'),
                ('model_interpretation',   12, 'prediction_models'),
                ('model_observations',     13, NULL)
        ),
        target_parent AS (
            -- Resolve "new parent" id within the same tree (global or clone).
            -- A child's new parent must live in the SAME tree, never a
            -- different project's clone.
            SELECT t.id,
                   t.name,
                   t.project_template_id,
                   t.owner_template_id,
                   nl.new_sort_order,
                   p.id AS new_parent_id
            FROM charms_trees t
            JOIN new_layout nl ON nl.name = t.name
            LEFT JOIN charms_trees p
                   ON p.name = nl.new_parent_name
                  AND p.project_template_id IS NOT DISTINCT FROM t.project_template_id
                  AND p.owner_template_id IS NOT DISTINCT FROM t.owner_template_id
        )
        UPDATE public.extraction_entity_types AS et
        SET parent_entity_type_id = tp.new_parent_id,
            sort_order = tp.new_sort_order
        FROM target_parent tp
        WHERE et.id = tp.id
          AND (
              et.parent_entity_type_id IS DISTINCT FROM tp.new_parent_id
              OR et.sort_order IS DISTINCT FROM tp.new_sort_order
          )
        """
    )

    # Step 3 — de-duplicate ``extraction_instances`` for the reparented
    # types. A project that already had N models holds N copies of e.g.
    # ``source_of_data`` (one nested under each model). Keep the oldest
    # per (article_id, entity_type_id); CASCADE removes the rest along
    # with their values / proposals / decisions / published states.
    op.execute(
        """
        WITH affected_entity_types AS (
            SELECT DISTINCT et.id AS entity_type_id
            FROM public.extraction_entity_types et
            LEFT JOIN public.project_extraction_templates pet
                   ON pet.id = et.project_template_id
            WHERE et.name = ANY(ARRAY[
                    'source_of_data',
                    'participants',
                    'outcome_to_be_predicted',
                    'candidate_predictors',
                    'sample_size',
                    'missing_data',
                    'model_observations'
                ])
              AND (
                  et.template_id = '000c0000-0000-0000-0000-000000000001'
                  OR pet.global_template_id = '000c0000-0000-0000-0000-000000000001'
              )
        ),
        ranked AS (
            SELECT i.id,
                   ROW_NUMBER() OVER (
                       PARTITION BY i.article_id, i.entity_type_id
                       ORDER BY i.created_at, i.id
                   ) AS rn
            FROM public.extraction_instances i
            JOIN affected_entity_types ae ON ae.entity_type_id = i.entity_type_id
            WHERE i.article_id IS NOT NULL
        )
        DELETE FROM public.extraction_instances AS i
        USING ranked r
        WHERE i.id = r.id
          AND r.rn > 1
        """
    )

    # Step 4 — surviving instances of reparented types must no longer point
    # at a model instance via ``parent_instance_id``. The frontend's
    # study-level filter ignores that column, but a stale parent reference
    # would still trip migrations or analytics that join on it.
    op.execute(
        """
        UPDATE public.extraction_instances AS i
        SET parent_instance_id = NULL
        FROM public.extraction_entity_types et
        LEFT JOIN public.project_extraction_templates pet
               ON pet.id = et.project_template_id
        WHERE i.entity_type_id = et.id
          AND i.parent_instance_id IS NOT NULL
          AND et.name = ANY(ARRAY[
                'source_of_data',
                'participants',
                'outcome_to_be_predicted',
                'candidate_predictors',
                'sample_size',
                'missing_data',
                'model_observations'
            ])
          AND (
              et.template_id = '000c0000-0000-0000-0000-000000000001'
              OR pet.global_template_id = '000c0000-0000-0000-0000-000000000001'
          )
        """
    )


def downgrade() -> None:
    # Restore the old (incorrect) hierarchy by reparenting every CHARMS
    # entity type back under ``prediction_models``. The original sort
    # orders are re-applied. Deleted ``extraction_instances`` cannot be
    # resurrected — the downgrade leaves the data thinner than upgrade
    # found it, which is the same compromise migration 0014 makes.
    op.execute(
        """
        WITH charms_trees AS (
            SELECT et.id,
                   et.name,
                   NULL::uuid AS project_template_id,
                   et.template_id AS owner_template_id
            FROM public.extraction_entity_types et
            WHERE et.template_id = '000c0000-0000-0000-0000-000000000001'

            UNION ALL

            SELECT et.id,
                   et.name,
                   pet.id AS project_template_id,
                   NULL::uuid AS owner_template_id
            FROM public.extraction_entity_types et
            JOIN public.project_extraction_templates pet
              ON pet.id = et.project_template_id
            WHERE pet.global_template_id = '000c0000-0000-0000-0000-000000000001'
        ),
        old_layout(name, old_sort_order, parent_name) AS (
            VALUES
                ('prediction_models',      0, NULL::text),
                ('source_of_data',         1, 'prediction_models'),
                ('participants',           2, 'prediction_models'),
                ('outcome_to_be_predicted',3, 'prediction_models'),
                ('candidate_predictors',   4, 'prediction_models'),
                ('sample_size',            5, 'prediction_models'),
                ('missing_data',           6, 'prediction_models'),
                ('model_development',      7, 'prediction_models'),
                ('final_predictors',       8, 'prediction_models'),
                ('model_performance',      9, 'prediction_models'),
                ('model_validation',      10, 'prediction_models'),
                ('model_results',         11, 'prediction_models'),
                ('model_interpretation',  12, 'prediction_models'),
                ('model_observations',    13, 'prediction_models')
        ),
        target_parent AS (
            SELECT t.id,
                   ol.old_sort_order,
                   p.id AS old_parent_id
            FROM charms_trees t
            JOIN old_layout ol ON ol.name = t.name
            LEFT JOIN charms_trees p
                   ON p.name = ol.parent_name
                  AND p.project_template_id IS NOT DISTINCT FROM t.project_template_id
                  AND p.owner_template_id IS NOT DISTINCT FROM t.owner_template_id
        )
        UPDATE public.extraction_entity_types AS et
        SET parent_entity_type_id = tp.old_parent_id,
            sort_order = tp.old_sort_order
        FROM target_parent tp
        WHERE et.id = tp.id
        """
    )

    op.execute(
        """
        UPDATE public.extraction_templates_global
        SET version = '1.0.0',
            description = 'CHARMS Checklist for prediction model studies. All fields are specific per prediction model.'
        WHERE id = '000c0000-0000-0000-0000-000000000001'
        """
    )
