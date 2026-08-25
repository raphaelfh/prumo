---
status: stable
last_reviewed: 2026-08-25
owner: '@raphaelfh'
---

# Seed the database

> **Status:** Stable · Last reviewed: 2026-08-25 · Owner: @raphaelfh

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
- **PROBAST+AI** — global quality-assessment template (Moons et al., BMJ 2025)
  covering regression- and AI/ML-based prediction models. 10 flat sections
  (development D1–D4 judged on Quality; evaluation D1–D3 plus evaluation D4
  split by performance type — apparent / internal / external — judged on Risk
  of Bias), 58 fields: 42 signaling rows and 16 domain judgments. Deterministic
  UUID. Helper: `seed_probast_ai()` in
  [`backend/app/seed_probast_ai.py`](../../backend/app/seed_probast_ai.py)
  (its own module because `seed.py` is at the file-size ratchet cap).
  The four **overall** judgments are deliberately NOT fields: they are computed
  from the domain judgments by the worst-domain rule, configured by the
  `derived_judgments` spec on the template's `schema` JSONB.

> **Re-seeding does not update an existing template.** Every `seed_*` helper is
> idempotent *by primary key*: it returns early when the row already exists and
> never issues an UPDATE. A corrected definition (new field, fixed
> `derived_judgments` coordinate) therefore needs `make db-fresh` locally, or a
> deliberate manual UPDATE in a deployed environment — `make db-seed` alone
> will silently keep the old row.
>
> **The project clone is a second copy with the same problem.** `schema` is
> written once, in the create branch of `TemplateCloneService.clone()`; the
> idempotent re-import branch heals entity types and versions but never
> re-copies it, and nothing else assigns that column. So a corrected
> `derived_judgments` spec has to reach *both* `extraction_templates_global`
> and every `project_extraction_templates` row cloned from it. The run view
> reads the spec live off the project row, so a stale clone is what the
> reviewer actually sees.
>
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

### Default — the deploy converges the seed (adopted since #715)

The Railway `web` service's Dockerfile `CMD` runs the seed on every boot,
between Alembic and gunicorn:

```dockerfile
CMD ["sh", "-c", "alembic upgrade head && python -m app.seed && gunicorn -k uvicorn.workers.UvicornWorker -w 1 -t 120 -b 0.0.0.0:${PORT:-8000} app.main:app"]
```

Because `seed.py` is idempotent, every deploy converges the global template
catalogue with no manual step — a template merged to `main` is installed by
that same deploy. A seed failure aborts the boot: Railway marks the deploy
failed and keeps the previous build live. The `worker` service overrides the
`CMD` (Celery) and runs neither Alembic nor the seed.

### Escape hatch — one-off manual run

Only needed to seed prod *ahead* of a promotion (or against a paused deploy):

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

-- PROBAST + PROBAST+AI + QUADAS-2
SELECT name, kind, version,
       (SELECT COUNT(*) FROM extraction_entity_types et
        WHERE et.template_id = extraction_templates_global.id) AS entity_types,
       (SELECT COUNT(*) FROM extraction_fields ef
        JOIN extraction_entity_types et ON ef.entity_type_id = et.id
        WHERE et.template_id = extraction_templates_global.id) AS fields
FROM extraction_templates_global
WHERE kind = 'quality_assessment'
ORDER BY name;
```

Expected:

| Template | Version | Entity types | Fields |
| --- | --- | --- | --- |
| CHARMS | 1.1.0 | 14 | ~80 |
| PROBAST | 1.0.0 | 5 | 29 |
| PROBAST+AI | 1.0.0 | 10 | 58 |
| QUADAS-2 | 1.0.0 | 5 | 20 |

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
