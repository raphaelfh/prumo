"""Retire ``role``: structure becomes parent links plus cardinality.

Migration 0016 made every section carry a ``role`` — ``model_container``
(the single root repeating section a template was allowed, by two partial
unique indexes, and the only section permitted to own children),
``model_section`` (a child, whose parent had to BE that container, by a
deferred trigger) and ``study_section`` (any other root, childless). That
capped depth at two and allowed exactly one group per template.

Structure is now ``parent_entity_type_id`` + ``cardinality``: a repeating
section is an entry group, a section may name a parent only if that parent
repeats, and a template may hold as many root groups at as many depths as
its author wants (spec §3-4).

``check_cardinality_one`` goes too. Only the browser CALL retired in B2;
the function survived as SECURITY DEFINER granted to ``authenticated``,
with an admin-RPC probe as its only caller — a live, privileged entry
point with nothing behind it.

Downgrade is honest rather than convenient: it re-derives ``role`` (root +
``one`` -> ``study_section``, root + ``many`` -> ``model_container``,
nested -> ``model_section``) and then RAISES if the data no longer fits
0016's world — several root groups, or any section deeper than two. Data
this migration makes representable cannot be squeezed back, and silently
dropping it would be worse than refusing.

Revision ID: 0069_entry_group_trees
Revises: 0068_seeded_entry_nouns
"""

from alembic import op

revision = "0069_entry_group_trees"
down_revision = "0068_seeded_entry_nouns"
branch_labels = None
depends_on = None


# 0048 stamps `config_draft_since` on ANY DML against this table, and its own
# docstring warns future migrations about exactly this: a bare backfill flips
# every project template to "Unpublished changes" and 409s the drift-path
# re-import. 0051's backfill disables the trigger for its UPDATE; so does this
# one, on the way down as well as up. Caught by
# `test_migration_0051_round_trip`, which asserts the marker stays NULL.
_DRAFT_TRIGGER = "trg_extraction_entity_types_mark_draft"

# A repeating section always carries a noun (spec §3.5). Backfill first:
# the CHECK is added in the same transaction and would reject the rows
# 0068 could not reach (project clones keep NULL until a manager names one).
BACKFILL_NOUNS = """
UPDATE public.extraction_entity_types
SET entry_label = 'entry'
WHERE cardinality = 'many' AND entry_label IS NULL
"""

NOUN_CHECK = """
ALTER TABLE public.extraction_entity_types
ADD CONSTRAINT ck_extraction_entity_types_noun_on_repeating
CHECK (cardinality <> 'many' OR entry_label IS NOT NULL)
"""

# A CHECK cannot reference another row, so the parent-repeats invariant is a
# deferred constraint trigger — the same shape 0016 used, and deferred for the
# same reason: a clone or a restore inserts parent and child in one
# transaction and may reach the child first.
PARENT_REPEATS_FN = """
CREATE OR REPLACE FUNCTION public.check_section_parent_repeats()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    parent_cardinality text;
    child_count integer;
BEGIN
    -- A row that names a parent requires that parent to repeat: only an
    -- entry group can own per-entry children.
    IF NEW.parent_entity_type_id IS NOT NULL THEN
        SELECT cardinality INTO parent_cardinality
        FROM public.extraction_entity_types
        WHERE id = NEW.parent_entity_type_id;

        IF parent_cardinality IS NULL THEN
            RAISE EXCEPTION
                'extraction_entity_types.parent_entity_type_id % does not exist',
                NEW.parent_entity_type_id
                USING ERRCODE = 'foreign_key_violation';
        END IF;

        IF parent_cardinality <> 'many' THEN
            RAISE EXCEPTION
                'section % names a parent that does not repeat: a parent must be an entry group',
                NEW.id
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    -- The symmetric half: a section that stops repeating cannot keep
    -- children, or they would hang off a singleton.
    IF NEW.cardinality <> 'many' THEN
        SELECT count(*) INTO child_count
        FROM public.extraction_entity_types
        WHERE parent_entity_type_id = NEW.id;

        IF child_count > 0 THEN
            RAISE EXCEPTION
                'section % owns % child section(s) and cannot stop repeating',
                NEW.id, child_count
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    RETURN NEW;
END;
$$
"""

PARENT_REPEATS_TRIGGER = """
CREATE CONSTRAINT TRIGGER trg_check_section_parent_repeats
AFTER INSERT OR UPDATE OF parent_entity_type_id, cardinality
ON public.extraction_entity_types
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.check_section_parent_repeats()
"""


def upgrade() -> None:
    op.execute(f"ALTER TABLE public.extraction_entity_types DISABLE TRIGGER {_DRAFT_TRIGGER}")
    op.execute(BACKFILL_NOUNS)
    op.execute(f"ALTER TABLE public.extraction_entity_types ENABLE TRIGGER {_DRAFT_TRIGGER}")
    op.execute(NOUN_CHECK)

    # 0016's three role guards, in dependency order.
    op.execute(
        "DROP TRIGGER IF EXISTS trg_check_model_section_parent_role "
        "ON public.extraction_entity_types"
    )
    op.execute("DROP FUNCTION IF EXISTS public.check_model_section_parent_role()")
    op.execute("DROP INDEX IF EXISTS public.uq_extraction_entity_types_one_container_per_project")
    op.execute("DROP INDEX IF EXISTS public.uq_extraction_entity_types_one_container_per_global")
    op.execute(
        "ALTER TABLE public.extraction_entity_types "
        "DROP CONSTRAINT IF EXISTS ck_extraction_entity_types_role_parent"
    )

    op.execute("ALTER TABLE public.extraction_entity_types DROP COLUMN IF EXISTS role")
    op.execute("DROP TYPE IF EXISTS public.extraction_entity_role")

    # Retired with the role world it guarded: only the browser CALL went in
    # B2, leaving a SECURITY DEFINER function granted to `authenticated`
    # with no caller.
    op.execute("DROP FUNCTION IF EXISTS public.check_cardinality_one(uuid, uuid, uuid)")

    op.execute(PARENT_REPEATS_FN)
    op.execute(PARENT_REPEATS_TRIGGER)


# Guards, run BEFORE any downgrade DDL so the transaction aborts with a
# readable reason rather than half-applying and then tripping a CHECK.
#
# `raise ... using errcode` inside a DO block rather than a bare CHECK: the
# CHECK would report "constraint violated by row X", which does not tell an
# operator that their template has two root groups and one must go.
DOWNGRADE_GUARDS = """
DO $$
DECLARE
    offending integer;
BEGIN
    -- 0016 allowed at most ONE root group per template.
    SELECT count(*) INTO offending FROM (
        SELECT coalesce(template_id, project_template_id) AS owner
        FROM public.extraction_entity_types
        WHERE parent_entity_type_id IS NULL AND cardinality = 'many'
        GROUP BY 1 HAVING count(*) > 1
    ) AS multi;
    IF offending > 0 THEN
        RAISE EXCEPTION
            '% template(s) hold more than one root entry group; 0016''s schema '
            'allows one. Merge or delete the extra groups before downgrading.',
            offending
            USING ERRCODE = 'check_violation';
    END IF;

    -- 0016 capped depth at two: a child's parent had to be a root container.
    SELECT count(*) INTO offending
    FROM public.extraction_entity_types AS child
    JOIN public.extraction_entity_types AS parent
      ON parent.id = child.parent_entity_type_id
    WHERE parent.parent_entity_type_id IS NOT NULL;
    IF offending > 0 THEN
        RAISE EXCEPTION
            '% section(s) sit deeper than two levels; 0016''s schema caps depth '
            'at two. Flatten them before downgrading.',
            offending
            USING ERRCODE = 'check_violation';
    END IF;
END
$$
"""

# Root + one -> study_section; root + many -> model_container;
# nested -> model_section. Exactly 0016's partition, read backwards.
DERIVE_ROLE = """
UPDATE public.extraction_entity_types
SET role = CASE
    WHEN parent_entity_type_id IS NOT NULL THEN 'model_section'
    WHEN cardinality = 'many' THEN 'model_container'
    ELSE 'study_section'
END::public.extraction_entity_role
"""


# The baseline's definition, verbatim. 0069's downgrade MUST recreate it:
# 0008's downgrade re-GRANTs on this function by name, so a chain that
# downgrades past 0069 without it fails with `function ... does not exist`.
# The first version of this migration left it dropped on the way down, on
# the reasoning that resurrecting a privileged function nobody calls is a
# regression rather than an undo. That reasoning was wrong about what a
# downgrade IS: the chain has to run, and 0069 is not the revision that
# gets to decide 0008's grants are obsolete.
RECREATE_CARDINALITY_FN = """
CREATE OR REPLACE FUNCTION public.check_cardinality_one(
    p_article_id uuid, p_entity_type_id uuid, p_parent_instance_id uuid DEFAULT NULL::uuid
) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
    DECLARE
        v_cardinality extraction_cardinality;
        v_parent_key UUID := COALESCE(
            p_parent_instance_id, '00000000-0000-0000-0000-000000000000'::uuid
        );
    BEGIN
        PERFORM pg_advisory_xact_lock(hashtextextended(
            p_article_id::text || ':' || p_entity_type_id::text || ':' || v_parent_key::text,
            0
        ));

        SELECT et.cardinality
        INTO v_cardinality
        FROM public.extraction_entity_types et
        WHERE et.id = p_entity_type_id;

        IF v_cardinality IS DISTINCT FROM 'one' THEN
            RETURN TRUE;
        END IF;

        RETURN NOT EXISTS (
            SELECT 1
            FROM public.extraction_instances ei
            WHERE ei.article_id = p_article_id
              AND ei.entity_type_id = p_entity_type_id
              AND ei.parent_instance_id IS NOT DISTINCT FROM p_parent_instance_id
        );
    END;
    $$
"""

GRANT_CARDINALITY_FN = """
GRANT ALL ON FUNCTION public.check_cardinality_one(uuid, uuid, uuid)
TO authenticated, service_role
"""


def downgrade() -> None:
    op.execute(DOWNGRADE_GUARDS)

    op.execute(
        "DROP TRIGGER IF EXISTS trg_check_section_parent_repeats ON public.extraction_entity_types"
    )
    op.execute("DROP FUNCTION IF EXISTS public.check_section_parent_repeats()")
    op.execute(
        "ALTER TABLE public.extraction_entity_types "
        "DROP CONSTRAINT IF EXISTS ck_extraction_entity_types_noun_on_repeating"
    )

    op.execute(
        """
        CREATE TYPE public.extraction_entity_role AS ENUM (
            'study_section', 'model_container', 'model_section'
        )
        """
    )
    op.execute(
        "ALTER TABLE public.extraction_entity_types ADD COLUMN role public.extraction_entity_role"
    )
    op.execute(f"ALTER TABLE public.extraction_entity_types DISABLE TRIGGER {_DRAFT_TRIGGER}")
    op.execute(DERIVE_ROLE)
    op.execute(f"ALTER TABLE public.extraction_entity_types ENABLE TRIGGER {_DRAFT_TRIGGER}")
    op.execute("ALTER TABLE public.extraction_entity_types ALTER COLUMN role SET NOT NULL")

    op.execute(
        """
        CREATE UNIQUE INDEX uq_extraction_entity_types_one_container_per_global
        ON public.extraction_entity_types (template_id)
        WHERE role = 'model_container' AND template_id IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX uq_extraction_entity_types_one_container_per_project
        ON public.extraction_entity_types (project_template_id)
        WHERE role = 'model_container' AND project_template_id IS NOT NULL
        """
    )
    op.execute(
        """
        ALTER TABLE public.extraction_entity_types
        ADD CONSTRAINT ck_extraction_entity_types_role_parent
        CHECK (
            (role IN ('study_section', 'model_container') AND parent_entity_type_id IS NULL)
            OR
            (role = 'model_section' AND parent_entity_type_id IS NOT NULL)
        )
        """
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.check_model_section_parent_role()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        DECLARE
            parent_role text;
        BEGIN
            IF NEW.role <> 'model_section' THEN
                RETURN NEW;
            END IF;
            SELECT role INTO parent_role
              FROM public.extraction_entity_types
             WHERE id = NEW.parent_entity_type_id;
            IF parent_role IS NULL THEN
                RAISE EXCEPTION
                    'model_section % has no parent row %',
                    NEW.id, NEW.parent_entity_type_id
                    USING ERRCODE = 'foreign_key_violation';
            END IF;
            IF parent_role <> 'model_container' THEN
                RAISE EXCEPTION
                    'model_section % must have a model_container parent, '
                    'got parent role %',
                    NEW.id, parent_role
                    USING ERRCODE = 'check_violation';
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE CONSTRAINT TRIGGER trg_check_model_section_parent_role
        AFTER INSERT OR UPDATE OF role, parent_entity_type_id
        ON public.extraction_entity_types
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW
        EXECUTE FUNCTION public.check_model_section_parent_role()
        """
    )
    op.execute(RECREATE_CARDINALITY_FN)
    op.execute(GRANT_CARDINALITY_FN)
