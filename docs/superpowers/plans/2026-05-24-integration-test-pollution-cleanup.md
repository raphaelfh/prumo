# Integration Test DB-Pollution Cleanup

> **Status:** open. Follow-up to PRs [#137](https://github.com/raphaelfh/prumo/pull/137) and [#141](https://github.com/raphaelfh/prumo/pull/141), which made `tests/integration/conftest.py` self-healing and switched four test files from `LIMIT 1` lottery to seeded `SEED.*` constants.
>
> **For agentic workers:** read this in full before touching anything in `backend/tests/integration/`. Use `superpowers:systematic-debugging` for the bisect phase and `superpowers:test-driven-development` for the rollback-fixture phase.

## TL;DR

After [#137](https://github.com/raphaelfh/prumo/pull/137) + [#141](https://github.com/raphaelfh/prumo/pull/141):

- **CI:** 0 failures. Every check on #141 green (8/8). CI starts with an empty DB, the conftest seeds the sentinel graph, all tests pass.
- **Local `make test-backend` on a dev DB with accumulated rows:** ~22 failures, all in **4 specific files** and all driven by cross-file DB-state pollution from earlier tests in the same run. None of them fail in isolation or when those four files are run as a contiguous group.

This document scopes the remaining cleanup work.

## What's done

| PR | Files | Effect |
|---|---|---|
| #137 | `conftest.py`, `test_run_lifecycle_service.py` | Conftest is now self-healing (drops the early-return guard, GCs obsolete sentinel rows, deletes non-sentinel templates from sentinel projects). `_fixtures()` uses `SEED` directly. |
| #141 | `test_run_lifecycle_concurrency.py`, `test_hitl_session.py` | `_pick_basic_fixtures` + the 2 inline template `LIMIT 1`s switched to `SEED.primary_template`. New local `auth_as_seed_primary` fixture for the 2 extraction-template hitl tests. |

The originally-reported 13 failures are all green. Verified by running the four affected files together: 38/38 pass.

## What's left

### Symptom

`make test-backend` on a developer DB produces ~22 failures, exclusively from:

- `tests/integration/test_qa_publish_flow.py` — 15 tests
- `tests/integration/test_session_backfill_extensive.py` — 1 test
- `tests/integration/test_single_active_extraction_invariant.py` — 3 tests
- `tests/integration/test_template_clone_extraction.py` — 3 tests

**Confirmed not real bugs:** running those four files together (`pytest tests/integration/test_qa_publish_flow.py tests/integration/test_session_backfill_extensive.py tests/integration/test_single_active_extraction_invariant.py tests/integration/test_template_clone_extraction.py`) → 77/77 pass. CI passes them too (empty DB). They only fail when the full suite runs earlier files first.

### Why it happens (hypothesis)

`backend/tests/conftest.py::db_session` yields a real `AsyncSession` without wrapping the test body in a transaction:

```python
@pytest_asyncio.fixture(scope="function")
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    engine = create_async_engine(...)
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with async_session() as session:
        yield session
    await engine.dispose()
```

So when an integration test calls `await db_session.commit()` (and many do — `home_project_fixture`, `_create_fresh_extraction_template`, the BOLA fabricators in `test_hitl_session.py`, etc.), the row stays in the DB forever. If a `try/finally` cleanup is skipped — assertion failure inside `try`, KeyboardInterrupt, a previous flaky run leaving the test halfway — the row leaks. The next test that picks `LIMIT 1` or relies on the partial unique index `uq_one_active_extraction_template_per_project` then trips on the leftover.

This matches the failure surface: every failing test deals with `project_extraction_templates`, the table where active-template-per-project + sentinel cleanup intersect.

## Goal

Make `make test-backend` go green on a polluted dev DB, matching CI.

Two complementary tracks:

### Track A — bisect & patch the actual pollution sources (smaller change)

1. Run `pytest --collect-only -q tests/integration/` to get the order pytest will execute.
2. Bisect: run the suite halving the set of earlier-running files until you find which one(s) leak. Likely candidates by content: anything in `test_hitl_session.py`, `test_run_*.py`, `test_extraction_*.py`, `test_template_*.py` that does `await db_session.commit()` and inserts into `project_extraction_templates`, `extraction_template_versions`, or `extraction_runs`.
3. For each leak: convert the test's setup-then-commit pattern to either (a) bracket it with explicit cleanup in a `try/finally`, or (b) drop the commit if the assertion does not require visibility across sessions.

Pros: targeted, no fixture churn.
Cons: every new test that needs to commit risks re-introducing the same class of bug.

### Track B — transactional `db_session` fixture (bigger, but fixes the class)

Convert `backend/tests/conftest.py::db_session` to begin a SAVEPOINT and roll back on teardown, so tests that "commit" actually commit into the savepoint and the outer transaction rolls back cleanly. SQLAlchemy 2.0 pattern:

```python
@pytest_asyncio.fixture(scope="function")
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    engine = create_async_engine(settings.async_database_url)
    async with engine.connect() as connection:
        trans = await connection.begin()
        async_session = async_sessionmaker(bind=connection, ...)
        async with async_session() as session:
            # Nested savepoint so calls to session.commit() inside the test
            # don't end the outer transaction.
            await session.begin_nested()

            @event.listens_for(session.sync_session, "after_transaction_end")
            def restart_savepoint(sess, transaction):
                if transaction.nested and not transaction._parent.nested:
                    sess.begin_nested()

            yield session
        await trans.rollback()
    await engine.dispose()
```

Caveats this introduces:

- The HTTP endpoints under test get the test session via `dependency_overrides[get_db]`. The endpoint's own `await db.commit()` calls now hit the savepoint and survive *within* the test — but the outer rollback wipes them after the test ends, so cross-test isolation is restored.
- Tests that genuinely need *cross-session* visibility (like `test_run_lifecycle_concurrency.py`, which opens two sessions on the same engine to exercise row locks) cannot use this pattern — they must keep their per-test `session_factory` and own their own cleanup. The concurrency file already does this; double-check that no other file silently relies on cross-session commits.
- Deferred constraints (e.g., migration 0004's "every active template has an active version") fire at `COMMIT`. With nested savepoints, they fire at the *outer* commit, which never happens — so the trigger never runs, and a malformed write that would have failed in prod silently succeeds in the test. Need either `SET CONSTRAINTS ALL IMMEDIATE` at fixture start, or accept the gap and rely on a small number of "real commit" smoke tests.

Pros: structural fix; new tests don't have to think about cleanup.
Cons: bigger change; some tests need explicit opt-out; deferred-constraint surface area shrinks.

### Recommendation

Do **Track A first** (mechanical, low risk, fixes today's red). When the test suite is green locally, evaluate Track B as a separate piece of work — the value is preventive (saves future writes from re-introducing the same class of bug), not corrective.

## Reproducer

```bash
# Repro the polluted run (from project root)
make test-backend
# → 22 failures across 4 files

# Same 4 files in isolation pass
.venv/bin/python -m pytest tests/integration/test_qa_publish_flow.py \
  tests/integration/test_session_backfill_extensive.py \
  tests/integration/test_single_active_extraction_invariant.py \
  tests/integration/test_template_clone_extraction.py
# → 77 passed
```

## Out of scope

- The `LIMIT 1` lottery in **other** test files (the ones not currently failing). Convert opportunistically when touching them, but don't refactor en masse — the conftest seed already guarantees coherence on a clean DB and the failing-test PR list converges on the SEED pattern.
- The flaky branch-switching that happened during the PR #137 / #141 sessions (parallel sessions stashing/restoring work). Use git worktrees for any further multi-session AI work on this repo.
- CI changes. CI is already green and doesn't have this problem.

## Definition of done

- `make test-backend` exits 0 on a developer dev DB that has at least: 1 non-sentinel project with articles + multiple extraction templates + a profile that's its manager.
- No regression in the 38 tests covered by #137/#141.
- (If Track B is done) at least one explicit smoke test exercises a deferred-constraint trigger under the new fixture so we know it still fires somewhere.
