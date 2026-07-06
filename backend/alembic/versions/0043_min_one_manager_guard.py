"""Minimum-one-manager guard: heal + trigger on project_members

Revision ID: 0043_min_one_manager_guard
Revises: 0042_drop_article_blob_columns
Create Date: 2026-07-05

Enforces the invariant "every project retains at least one manager" in the
database — the only layer all writers pass through (membership mutations go
directly to PostgREST under RLS, not through FastAPI). See
docs/superpowers/specs/2026-07-05-min-one-manager-guard-design.md.

Three parts, in order:
  1. Heal: promote each zero-manager project's creator to manager so the
     trigger below never fires against a pre-existing violation, and the
     currently-bricked project is unstuck with no manual SQL. Idempotent
     (the ``WHERE NOT EXISTS (manager)`` guard + ``ON CONFLICT DO NOTHING``
     make re-running — e.g. the roundtrip's downgrade-then-upgrade — a
     no-op).
  2. A VOLATILE SECURITY DEFINER function that blocks any UPDATE/DELETE which
     would drop a project to zero managers. VOLATILE (not STABLE like the
     ``is_project_*`` helpers) because it takes ``FOR UPDATE`` row locks,
     which Postgres forbids in non-volatile functions.
  3. A ``BEFORE UPDATE OF role, project_id OR DELETE`` row trigger wiring the
     function to project_members.

Deliberate deviations, verified against live Postgres:
  - ``SET search_path = public`` (not ``public, pg_temp`` like the helpers):
    for a SECURITY DEFINER function, omitting ``pg_temp`` is the hardened
    choice — it prevents a caller's temp-schema object from shadowing a
    referenced name (matches Supabase's own advisor guidance).
  - ``UPDATE OF role, project_id``: only role/project_id changes can reduce a
    project's manager count, so an unrelated write (``permissions``,
    ``invitation_*``) never even enters the function (house style: baseline
    ``trg_enforce_extraction_instance_cardinality`` etc.). The in-function
    guard still distinguishes a real demotion/move from a no-op role write.

Consequence (intentional, tested): ``project_members.user_id`` cascades from
``profiles``, so deleting a profile that is the sole manager of a *live*
project now raises PM001 instead of silently re-bricking the project. There
is no account-deletion flow in the app (verified: no ``deleteUser`` /
profile-delete path in backend or frontend), so no product path regresses.

downgrade() drops the trigger + function only; the heal is not reverted
(restoring a bricked state is not a rollback goal).
"""

from alembic import op

revision = "0043_min_one_manager_guard"
down_revision = "0042_drop_article_blob_columns"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Data heal — runs before the trigger is created. For a zero-manager
    #    project: promote the creator's existing membership row to manager, or
    #    insert one if the creator has no row. The CTE excludes already-promoted
    #    projects from the INSERT, and ON CONFLICT guards the (never-hit-in-
    #    practice) case where the creator already has a non-manager row.
    op.execute(
        """
        WITH zero_manager_projects AS (
            SELECT p.id AS project_id, p.created_by_id
            FROM public.projects p
            WHERE NOT EXISTS (
                SELECT 1 FROM public.project_members m
                WHERE m.project_id = p.id AND m.role = 'manager'
            )
        ),
        promoted AS (
            UPDATE public.project_members m
            SET role = 'manager'
            FROM zero_manager_projects z
            WHERE m.project_id = z.project_id
              AND m.user_id = z.created_by_id
            RETURNING m.project_id
        )
        INSERT INTO public.project_members (project_id, user_id, role)
        SELECT z.project_id, z.created_by_id, 'manager'
        FROM zero_manager_projects z
        WHERE z.project_id NOT IN (SELECT project_id FROM promoted)
        ON CONFLICT (project_id, user_id) DO NOTHING;
        """
    )

    # 2. Guard function. No volatility keyword => VOLATILE (plpgsql default),
    #    required for the FOR UPDATE lock below.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.enforce_min_one_manager()
            RETURNS trigger
            LANGUAGE plpgsql
            SECURITY DEFINER
            SET search_path = public
            AS $$
            DECLARE
                v_survivors integer;
            BEGIN
                -- Only operations that could reduce OLD.project_id's manager
                -- count need checking (a no-op role write, or a same-project
                -- role='manager' -> 'manager' write, skips here).
                IF NOT (
                    (TG_OP = 'DELETE' AND OLD.role = 'manager')
                    OR (TG_OP = 'UPDATE' AND OLD.role = 'manager'
                        AND (NEW.role <> 'manager'
                             OR NEW.project_id <> OLD.project_id))
                ) THEN
                    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
                END IF;

                -- Cascade carve-out: the parent project row is already gone
                -- when a projects-row DELETE cascades into project_members
                -- (Postgres applies the parent delete before firing the
                -- child's row trigger), so allow the member row to go.
                IF NOT EXISTS (
                    SELECT 1 FROM public.projects WHERE id = OLD.project_id
                ) THEN
                    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
                END IF;

                -- Lock-then-count: FOR UPDATE cannot combine with aggregates,
                -- so lock the surviving manager rows in a subquery and count
                -- the outer result. The locked rows ARE the counted rows: a
                -- concurrent demotion of one of them blocks here, and after it
                -- commits EvalPlanQual re-checks the row against role='manager'
                -- and excludes it, so the second txn sees zero survivors and
                -- raises. A mutual demotion deadlocks; Postgres aborts one.
                SELECT count(*) INTO v_survivors FROM (
                    SELECT 1 FROM public.project_members
                    WHERE project_id = OLD.project_id
                      AND id <> OLD.id
                      AND role = 'manager'
                    FOR UPDATE
                ) s;

                IF v_survivors = 0 THEN
                    RAISE EXCEPTION 'a project must retain at least one manager'
                        USING ERRCODE = 'PM001';
                END IF;

                RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
            END;
            $$;
        """
    )

    # 3. Trigger. DROP IF EXISTS first so the roundtrip's downgrade-0042 ->
    #    upgrade-head cycle re-creates it idempotently.
    op.execute(
        "DROP TRIGGER IF EXISTS trg_project_members_min_one_manager ON public.project_members;"
    )
    op.execute(
        """
        CREATE TRIGGER trg_project_members_min_one_manager
            BEFORE UPDATE OF role, project_id OR DELETE ON public.project_members
            FOR EACH ROW
            EXECUTE FUNCTION public.enforce_min_one_manager();
        """
    )


def downgrade() -> None:
    op.execute(
        "DROP TRIGGER IF EXISTS trg_project_members_min_one_manager ON public.project_members;"
    )
    op.execute("DROP FUNCTION IF EXISTS public.enforce_min_one_manager();")
