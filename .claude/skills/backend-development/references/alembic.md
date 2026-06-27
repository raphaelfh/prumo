# Alembic migrations (prumo app schema)

Read this with `docs/reference/migrations.md` — the architecture doc is authoritative on squashing, conventions, and the legacy state.

## Where what goes

| System | Owns | Path |
|---|---|---|
| Alembic | `public.*` tables, FKs, indexes, RLS policies on `public.*`, ENUM types | `backend/alembic/versions/NNNN_*.py` |
| Supabase CLI | `auth.users` triggers, storage buckets, RLS on `storage.objects` | `supabase/migrations/*.sql` |

If you're writing `CREATE POLICY ... ON storage.objects`, you're in the wrong system. Likewise: if a Supabase migration touches `public.*`, that change won't survive a Postgres reset because Alembic owns `public`.

## Creating a migration

```bash
cd backend
alembic revision --autogenerate -m "add foo to extraction_runs"
```

Autogenerate is starting material, not the final answer. It misses:
- `CHECK` constraints (it sees them but often serializes them oddly)
- `CREATE POLICY` / `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
- ENUM value additions (`ALTER TYPE ... ADD VALUE`)
- Partial / functional indexes (`CREATE INDEX ... WHERE ...`)
- SECURITY DEFINER function bodies
- Comment changes, `STATEMENT_TIMEOUT` adjustments, anything `text()`-based

Open the generated file. Edit. Re-read.

## Anatomy of a good migration

```python
"""add notes column to extraction_proposal_records

Revision ID: 0013_proposal_notes
Revises: 0012_consensus_decision_run_fk
Create Date: 2026-05-17
"""

from alembic import op
import sqlalchemy as sa

revision = "0013_proposal_notes"
down_revision = "0012_consensus_decision_run_fk"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "extraction_proposal_records",
        sa.Column("notes", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("extraction_proposal_records", "notes")
```

- Filename and `revision` match: `0013_proposal_notes`.
- `down_revision` points at the current head before you started. Check with `alembic heads`.
- Module docstring states *why* — the diff already shows what.
- `downgrade()` must work locally; tests run it on every PR.

## ENUMs — the right dance

Adding a value:

```python
def upgrade() -> None:
    op.execute("ALTER TYPE extraction_run_stage ADD VALUE IF NOT EXISTS 'archived'")
```

Then update `POSTGRESQL_ENUM_VALUES` in `app/models/base.py` so SQLAlchemy knows about it. Skipping that step breaks autogenerate later — it'll keep emitting drops/recreates for that ENUM.

Removing a value: Postgres has no `DROP VALUE`. You must:
1. Migrate all rows off the old value (data migration).
2. Create a new ENUM type with the desired values.
3. `ALTER TABLE ... ALTER COLUMN ... TYPE new_enum USING ...`.
4. Drop the old type.

Rare and disruptive. Avoid unless the value is genuinely dead.

## RLS in Alembic

Because the table lives in `public`, the policy lives in Alembic. Use `op.execute` with a triple-quoted SQL string:

```python
def upgrade() -> None:
    op.execute('ALTER TABLE public.extraction_runs ENABLE ROW LEVEL SECURITY;')
    op.execute(
        """
        CREATE POLICY "extraction_runs_select" ON public.extraction_runs
        FOR SELECT TO authenticated
        USING (public.is_project_member(project_id, auth.uid()));
        """
    )
    op.execute(
        """
        CREATE POLICY "extraction_runs_manage" ON public.extraction_runs
        FOR ALL TO authenticated
        USING (public.is_project_reviewer(project_id, auth.uid()))
        WITH CHECK (public.is_project_reviewer(project_id, auth.uid()));
        """
    )


def downgrade() -> None:
    op.execute('DROP POLICY IF EXISTS "extraction_runs_manage" ON public.extraction_runs;')
    op.execute('DROP POLICY IF EXISTS "extraction_runs_select" ON public.extraction_runs;')
    op.execute('ALTER TABLE public.extraction_runs DISABLE ROW LEVEL SECURITY;')
```

See `references/rls.md` for the policy-shape catalog and `alembic/versions/0009_tighten_rls_policies.py` for a real-world refactor.

## Data migrations

Idempotent or skip. Use `IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, or guard with a SELECT first.

```python
def upgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text(
        """
        INSERT INTO public.feature_flags (name, enabled)
        VALUES ('hitl_qa_consensus', true)
        ON CONFLICT (name) DO NOTHING
        """
    ))
```

For larger backfills, prefer a one-off script outside Alembic (run it manually after deploy) — Alembic migrations should run in seconds. Anything that locks a hot table for minutes belongs in a controlled migration window with a documented runbook.

## Squashing

Authoritative in `docs/reference/migrations.md` (§When to squash) — the rule of thumb, the don't-squash conditions, and the squash recipe. Don't re-derive it here.

## Running

```bash
cd backend
alembic upgrade head       # apply all pending
alembic downgrade -1       # roll back one
alembic current            # show DB's current head
alembic heads              # show files' head (must match `current`)
alembic history            # full chain
```

Local: `make reset-db` wipes the DB cleanly so you can re-run from baseline. CI runs `upgrade head` and then `downgrade -1` on every PR that adds a file under `alembic/versions/`.

## Startup safety net

`app/main.py::check_pending_migrations()` blocks app start if `alembic heads ≠ DB current`. This catches "forgot to run upgrade" in dev and "deployment skipped migrations" in prod.

## CI gotchas (the versioned home for these)

- **Revision id ≤ 32 chars** (see `docs/reference/migrations.md` §Naming
  + ordering) — `alembic_version.version_num` overflows at *apply* time,
  so an over-long id breaks the CI Backend Tests "apply migrations" step
  and the Railway `alembic upgrade head` deploy, and `--sql` offline
  doesn't catch it. Renaming one means updating the `revision`/docstring,
  any child `down_revision`, the filename, and `test_migration_roundtrip.py`
  (it pins the head id).
- **`op.create_check_constraint` is mangled by the naming convention.**
  `MetaData` in `app/models/base.py` sets `"ck": "ck_%(table_name)s_%(constraint_name)s"`,
  so `op.create_check_constraint("user_api_keys_provider_check", ...)`
  emits `ck_user_api_keys_user_api_keys_provider_check` — a silent rename
  that breaks the downgrade. Baseline constraints use literal, un-prefixed
  names, so to DROP+recreate one use raw `op.execute("ALTER TABLE ... ADD
  CONSTRAINT <literal_name> CHECK (...)")` and verify with offline `--sql`
  in both directions before trusting it.
- **Adding a migration trips `test_migration_roundtrip`.** It pins the
  head id and runs `downgrade -1`; bump the pin to the new head and set
  the new file's `down_revision` to the explicit parent.

## AI-assistant pitfalls (read `docs/reference/migrations.md` for full list)

- Don't `op.drop_table` a table autogenerate flagged without checking if it was meant to be renamed.
- Don't accept autogenerate's table-rename guesses — they're often wrong. Verify by reading the down_revision and the model diff.
- Don't put `connection.execute(...)` outside `op.get_bind()` — you'll bypass Alembic's transaction.
- ENUM values: never alter `POSTGRESQL_ENUM_VALUES` without a matching migration. They drift silently otherwise.
