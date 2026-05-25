---
status: stable
last_reviewed: 2026-05-24
owner: '@raphaelfh'
---

# Seed the database

> **Status:** Stable · Last reviewed: 2026-05-24 · Owner: @raphaelfh

This guide explains how to load seed data after the schema migrations run.

## What gets seeded

- **CHARMS v1.1** — global extraction template (`kind=extraction`) for
  prediction-model data. ~14 entity types, ~80 fields. Helper:
  `seed_charms()` in [`backend/app/seed.py`](../../backend/app/seed.py).
  Split into study-level fields (entered once per article) and per-model
  fields (entered once per evaluated model) since 2026-05-17.
- **PROBAST** — global quality-assessment template
  (`kind=quality_assessment`). 5 domains (Participants, Predictors, Outcome,
  Analysis, Overall) + 22 signaling + summary fields. Deterministic UUID.
  Helper: `seed_probast()`.
- **QUADAS-2** — global quality-assessment template for diagnostic-accuracy
  studies. 5 domains + Overall, 11 signaling questions + summary fields with
  `allowed_values=['Y','N','Unclear']`. Deterministic UUID. Helper:
  `seed_quadas2()`.

> Quality-assessment templates are seeded as `kind=quality_assessment` in
> `extraction_templates_global`. When the frontend opens an assessment via
> `POST /api/v1/hitl/sessions` with `kind=quality_assessment`, the backend
> clones the template into `project_extraction_templates` (idempotent).
> See [`docs/reference/extraction-hitl-architecture.md`](../reference/extraction-hitl-architecture.md)
> for the full flow.

## Local development

### Automatic (recommended)

```bash
make reset-db    # Reset + seed in one shot
```

### Manual

```bash
make seed                                                       # via the Makefile
# or
cd backend && uv run python -m app.seed                         # directly
```

## Production (Supabase)

### Option 1 — Wire into the Railway boot

The Railway `web` service runs `alembic upgrade head && gunicorn ...` from
`backend/Dockerfile` on every deploy. To also run the seed on boot, change
the Dockerfile `CMD` to:

```dockerfile
CMD ["sh", "-c", "alembic upgrade head && python -m app.seed && gunicorn -k uvicorn.workers.UvicornWorker -w 1 -t 120 -b 0.0.0.0:${PORT:-8000} app.main:app"]
```

Because `seed.py` is idempotent, running it on every boot is safe. Do **not**
add the seed to the `worker` service — it has no need for it and does not
run Alembic.

### Option 2 — One-off manual run

```bash
# Use the Supabase connection string (Settings → Database → Connection String → URI)
export DATABASE_URL="postgresql://postgres:PASSWORD@db.PROJECT.supabase.co:5432/postgres"

cd backend && uv run python -m app.seed

# Verify
psql "$DATABASE_URL" -c "SELECT name, version, kind FROM extraction_templates_global ORDER BY kind, name;"
```

## Re-seeding

The script is **idempotent**. If a template already exists it is left alone;
otherwise it is created.

## Verification queries

```sql
-- CHARMS
SELECT name,
       framework,
       version,
       (SELECT COUNT(*) FROM extraction_entity_types
        WHERE template_id = extraction_templates_global.id)  AS entity_types,
       (SELECT COUNT(*) FROM extraction_fields ef
        JOIN extraction_entity_types et ON ef.entity_type_id = et.id
        WHERE et.template_id = extraction_templates_global.id) AS fields
FROM extraction_templates_global
WHERE framework = 'CHARMS';

-- PROBAST + QUADAS-2
SELECT name, kind, version
FROM extraction_templates_global
WHERE kind = 'quality_assessment'
ORDER BY name;
```

Expected:

| Template | Version | Entity types | Fields |
| --- | --- | --- | --- |
| CHARMS | 1.1.0 | 14 | ~80 |
| PROBAST | 1.0.0 | 5 | 22+ |
| QUADAS-2 | 1.0.0 | 5 | 11+ |

## Troubleshooting

### `column ... does not exist`

Supabase migrations ran but Alembic did not. Fix:

```bash
cd backend && uv run alembic upgrade head && make seed
```

### `DATABASE_URL pointing to wrong database`

A shell-level `DATABASE_URL` is overriding `.env`. Either `unset DATABASE_URL`
or override explicitly:

```bash
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" make seed
```

### "Seed appears to do nothing"

Idempotency. Verify rows exist:

```bash
psql "$DATABASE_URL" -c "SELECT name FROM extraction_templates_global;"
```

## References

- Seed script: [`backend/app/seed.py`](../../backend/app/seed.py)
- Makefile target: `seed` (search the Makefile for `seed:`)
- PROBAST source: <https://www.probast.org/>
- CHARMS source: <https://bmcmedresmethodol.biomedcentral.com/articles/10.1186/s12874-023-01849-0>
- TRIPOD+AI: <https://www.tripod-statement.org/>
