# Archived migrations (pre-squash)

These 18 migration files produced the schema that lives in
`backend/alembic/versions/0001_baseline_v1.py` + `baseline_v1.sql`.
They are kept for historical context (git blame, decision records) but
**Alembic does not load them** — the directory is outside the version
search path.

## When were these executed?

The 18-migration trail ran from project genesis through 2026-04-28. The
final stretch (`20260427_0010` → `20260428_0019`) is the
extraction-centric HITL unification documented in
`docs/architecture/extraction-hitl-architecture.md` and the archived
plans under `docs/superpowers/plans/archive/2026-04-27-hitl-unification/`.

## What replaced them

A single squash baseline:

```
backend/alembic/versions/
├── 0001_baseline_v1.py    # Python wrapper (revision=0001_baseline_v1)
└── baseline_v1.sql        # Cleaned pg_dump of public schema at the
                           # point of squash (3,152 lines).
```

Existing dev databases were stamped (`alembic stamp --purge
0001_baseline_v1`) without re-running the schema. Fresh databases run
the baseline directly via `alembic upgrade head`.

## Why this layout

- New work creates `backend/alembic/versions/<date>_NNNN_<name>.py` on
  top of the baseline. Migrations stay incremental.
- The baseline is a single auditable artefact. AI agents reading the
  schema don't have to chase 18 files.
- Old SQL is preserved in git history but doesn't pollute Alembic's
  graph. If you ever need to inspect the original sequence:
  `git log -- backend/alembic/versions/archive/`.

## When to squash again

See `docs/architecture/migrations.md` §"When to squash". Rule of thumb:
on each stable release, after the in-flight refactors settle.
