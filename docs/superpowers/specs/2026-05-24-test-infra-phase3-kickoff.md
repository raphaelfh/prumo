---
status: draft
last_reviewed: 2026-05-24
owner: '@raphaelfh'
---

# Phase 3 kickoff — parallelism + per-worker DB + factory expansion

**Date:** 2026-05-24
**Status:** Kickoff brief (not yet a full spec)
**Predecessor:** `docs/superpowers/specs/2026-05-24-test-infra-hardening-design.md`
**Predecessor PR:** `de3b985` test(infra): SAVEPOINT db_session + pytest-randomly/deadfixtures + smoke constraints

## Why this exists

Phase 1 + 2 stopped cross-test pollution and added detection. What they
*did not* do:

- Speed up the suite (we are still serial; integration suite ≈ 16s).
- Separate the test DB from the developer DB. Devs running `make
  start` against the same Supabase local end up sharing rows with the
  test suite. SAVEPOINT means tests no longer add pollution, but
  pre-existing rows still leak into `LIMIT 1`-based fixture lookups
  (the symptoms PRs #137/#141/#142 papered over with sentinel binding).
- Eliminate the sentinel UUIDs in `backend/tests/conftest.py` and the
  helpers (`_pick_article`, `auth_as_profile`) that rely on them. They
  still work but they are a structural smell: every test is
  inadvertently coupled to a single graph of seeded rows.

Phase 3 retires all of the above by giving every worker its own
template-cloned database and replacing seed-coupled helpers with
factories.

## What changes (sketch)

```text
backend/tests/conftest.py
  _bootstrap_test_db   session-scoped, autouse
    - On session start, ensure `prumo_test_template` exists with full
      Alembic schema applied (sync setup, ~seconds, runs once).
    - Per worker (or per process, if not xdist), clone the template
      into `prumo_test_${WORKER_ID}_${PID}` via
      `CREATE DATABASE ... WITH TEMPLATE prumo_test_template` (O(ms)).
    - Rebind `settings.async_database_url` to the cloned DB for the
      worker's lifetime.
    - At session end, DROP the cloned DB.

  _engine, db_session, db_session_real  (unchanged surface — pointed at
                                         the worker's cloned DB)

backend/tests/factories/  (existing skeleton — already houses
                           template_factory.py)
  + project_factory.py
  + article_factory.py
  + run_factory.py
  + reviewer_factory.py
  - Sentinel UUIDs in conftest.py retire as consumers migrate.

backend/pyproject.toml
  + pytest-xdist[psutil]>=3.6  in dev extras.
  - CI runs `pytest -n auto` once template-DB-per-worker is wired
    (parallel safe by construction).

backend/tests/integration/helpers/
  - The existing `auth_as_profile` / `_pick_fixtures` helpers become
    thin wrappers around factories rather than seed-coupled `LIMIT 1`
    queries.
```

## Open questions to brainstorm next

1. **Template DB or Testcontainers?** Template DB is faster and matches
   what the team already runs (Supabase Docker locally). Testcontainers
   is hermetic but adds 3-5s per session. Suspect: template DB.
2. **Where does the template DB live?** Same Postgres instance as
   Supabase local? A separate one provisioned by `make setup`? The
   simplest is "same instance, different database name", at the cost
   of needing superuser on the local Supabase Postgres.
3. **Migration order vs Supabase migrations.** Alembic runs on
   `public`; Supabase CLI runs on `auth`/`storage`. The template DB
   needs both, applied in the right order. The bootstrap script should
   call both — what is the contract?
4. **How does this interact with Supabase Auth?** The smoke
   constraint tests already work around `profiles.id → auth.users.id`
   FK by reusing an existing profile. A worker's fresh DB has no
   profiles. The bootstrap probably wants to insert a small set of
   test users in `auth.users` (e.g., `teste@prumo.local` from the
   existing test account memory) at template-build time.
5. **Factory framework: polyfactory, factory-boy, or hand-rolled?**
   The existing `template_factory.py` is hand-rolled and works. The
   ROI of adopting a library should be weighed against the cost of
   migrating ~5 model classes.
6. **What stays in `db_session_real`?** With per-worker DB, the
   savepoint isolation is no longer doing the load-bearing work — the
   per-worker DB is. Can we retire `db_session_real` entirely? Or
   keep it for the rare cross-session test?
7. **CI parallelism factor.** Local: `-n auto` (cores - 1). CI:
   GitHub Actions runners typically have 2-4 cores; `-n 2` is
   probably right. Measure first.

## Suggested starting move

```bash
# In a fresh session, after this PR merges:
/superpowers:brainstorming Phase 3 from \
  docs/superpowers/specs/2026-05-24-test-infra-phase3-kickoff.md \
  — focus on questions 1, 2, and 4 first (DB strategy), then 5
  (factory framework), then sequence.
```

Expected output: a full design spec at
`docs/superpowers/specs/YYYY-MM-DD-test-infra-phase3-parallel-and-factories-design.md`
followed by an implementation PR.

## What NOT to do in Phase 3

- **Don't** introduce `pytest-xdist` before per-worker DB lands.
  Parallel workers against a shared DB collide on sentinel UUIDs and
  partial unique indexes (the exact failure class Phase 2 just
  closed). Per-worker DB is a precondition.
- **Don't** delete `db_session_real` in the same PR that introduces
  per-worker DB. Keep the escape hatch around for one cycle; remove
  it once nothing uses it.
- **Don't** migrate every test file to factories at once. Pick one
  model at a time (Project → Article → Template → Run), each in its
  own small PR with its own test sweep.
