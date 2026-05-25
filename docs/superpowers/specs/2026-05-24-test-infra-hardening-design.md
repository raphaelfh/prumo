# Test infra hardening — detection plugins + SAVEPOINT isolation

**Date:** 2026-05-24
**Status:** Draft
**Authors:** raphaelfh (+ Claude Opus 4.7)
**Successor of:** `docs/superpowers/plans/2026-05-24-integration-test-pollution-cleanup.md`
**Predecessors landed:** PR #137 (self-healing seed), PR #141 (sentinel coherence — concurrency + hitl), PR #142 (sentinel coherence — runs_endpoint_lifecycle, run purge in seed)

## Context

The post-PRs-#137/#141/#142 state of the backend test suite is:

- CI: green on a fresh DB.
- Local dev DB: ~22 failures from cross-test pollution. `backend/tests/conftest.py::db_session` yields a raw `AsyncSession` (no enclosing transaction); every `await db.commit()` inside a test or fixture commits for real; rows leak across runs; subsequent runs collide on partial unique indexes such as `uq_one_active_extraction_template_per_project`.
- Sentinel-binding helpers (PR #142) mitigate the lottery but do not address the leak itself.

This spec covers two of the three layers identified in the analysis:

- **Layer 1 — Detection** (pytest-randomly + pytest-deadfixtures).
- **Layer 2 — Transactional isolation** (SAVEPOINT-based `db_session` with `db_session_real` escape hatch + smoke tests for DEFERRED constraints).

**Layer 3** (template database per worker, full factory adoption, `pytest-xdist`) is **out of scope** for this spec. It is captured in §10 as the natural next step.

## Goals

- Eliminate the "passes in isolation, fails in suite" failure class by design.
- Expose hidden order dependencies via `pytest-randomly` before they reach `main`.
- Preserve genuine coverage of DEFERRED triggers (migrations 0004, 0017) via explicit smoke tests.
- One-PR delivery for both layers; no multi-step rename migration.

## Non-goals

- `pytest-xdist`. Without per-worker DB, parallel workers collide on the same sentinel UUIDs and partial unique indexes. Defer with Layer 3.
- Template DB per worker / Testcontainers. Layer 3.
- Refactoring sentinel-based helpers (`_pick_fixtures`, `auth_as_profile`, sentinel UUIDs exported by `conftest`). They are stable post-PR #142 and will retire naturally with Layer 3 factories.
- Mock-only fixtures (`client`, `mock_supabase`). This spec only touches integration paths.

## Design

### Architecture

```
┌─────────────────────────────────────────────────────┐
│  Layer 1: Test runner plugins                       │
│    pytest-randomly       → random order + seed     │
│    pytest-deadfixtures   → CI job, non-blocking    │
└─────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────┐
│  Layer 2: DB session isolation                      │
│                                                     │
│    backend/tests/conftest.py                        │
│    ├─ _engine          (session-scoped, NullPool)   │
│    ├─ db_session       (SAVEPOINT, new default)     │
│    │   ├─ outer txn → rollback at teardown          │
│    │   └─ savepoint + after_transaction_end hook    │
│    │      (restart savepoint after inner commits)   │
│    └─ db_session_real  (real commit, opt-out)       │
│                                                     │
│    backend/tests/integration/smoke_constraints/     │
│    └─ exercises DEFERRED triggers via db_session_real│
└─────────────────────────────────────────────────────┘
```

### Layer 1 — Detection

#### pytest-randomly

Adds randomized test order on every run; the seed appears in the pytest header and can be re-pinned via `-p no:randomly` or `--randomly-seed=N`. CI runs unpinned so regressions in test ordering get caught before they ship.

Reading the signal:
- Test fails only with certain seeds → ordering dependency. Bisect with `--randomly-seed=N`.
- Test fails with every seed → internal bug.

#### pytest-deadfixtures

Reports unused fixtures. After the sentinel-coherence work in PR #137/#141/#142, several legacy fixtures became dead weight. Initial CI integration is **non-blocking** (report-only) until the first sweep removes the existing dead fixtures.

#### Configuration

- `backend/pyproject.toml`: add both packages to the `dev` extras.
- No `pytest.ini` or `conftest` changes required for either plugin to activate.

### Layer 2 — Transactional isolation

#### `db_session` (new default, SAVEPOINT-based)

```python
@pytest_asyncio.fixture(scope="session")
async def _engine() -> AsyncGenerator[AsyncEngine, None]:
    """Single engine reused across the test session."""
    engine = create_async_engine(
        settings.async_database_url,
        echo=False,
        poolclass=NullPool,
    )
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture(scope="function")
async def db_session(_engine: AsyncEngine) -> AsyncGenerator[AsyncSession, None]:
    """
    SAVEPOINT-isolated session. Inner commits survive during the test
    but the outer rollback wipes everything at teardown — zero cross-test
    pollution by construction.

    Use `db_session_real` for the small set of tests that need genuine
    cross-session visibility or to exercise DEFERRED triggers.
    """
    async with _engine.connect() as conn:
        outer_trans = await conn.begin()
        Session = async_sessionmaker(bind=conn, expire_on_commit=False)
        async with Session() as session:
            await session.begin_nested()  # initial SAVEPOINT

            @event.listens_for(session.sync_session, "after_transaction_end")
            def _restart_savepoint(sess, trans):
                if trans.nested and not trans._parent.nested:
                    sess.begin_nested()

            try:
                yield session
            finally:
                if outer_trans.is_active:
                    await outer_trans.rollback()
```

#### `db_session_real` (escape hatch)

Identical body to the current `db_session` — fresh engine per test, raw session, real commits. Tests that opt in:
- DEFERRED-trigger smoke tests (see below).
- Future tests that genuinely need cross-session visibility.

The three existing concurrency tests (`test_extraction_run_lock.py`, `test_hitl_session_concurrency.py`, `test_run_lifecycle_concurrency.py`) already open their own `async_sessionmaker` and **do not use `db_session`** — they are unaffected by this change.

#### `db_client`

Continues to override `get_db` with the new `db_session`. Endpoints under test commit into the savepoint; the test can verify side effects; teardown wipes them. No code change required in `db_client`'s body; it inherits the new semantics through the fixture dependency.

#### `smoke_constraints/`

New directory: `backend/tests/integration/smoke_constraints/`. Each file uses `db_session_real` and exercises a DEFERRED trigger to commit time:

- `test_template_active_version.py` — migration 0004 (`extraction_project_templates` requires an active version at commit).
- `test_entity_role_parent.py` — migration 0017 (`model_section` parent must be `model_container`, enforced by a deferred trigger).

Each test seeds a transient project + template + entity_type chain, commits, and asserts on either the success path (commit allowed) or the failure path (commit raises `IntegrityError`). The seed graph is created within the test (or via a local helper) and committed for real; cleanup is per-test `DELETE` because the SAVEPOINT mechanism does not apply.

#### `test_db_session_savepoint.py`

New test colocated with the integration suite. Validates:

- An `INSERT` + `commit` inside the test is visible within the same `db_session`.
- After the test ends, no row from this test remains in the DB (assertion lives in a follow-up test that opens its own session via `_engine`).
- An `expunge_all()` mid-test does not break the savepoint restart loop.

This is the executable contract for the fixture; if Layer 3 (or any later refactor) needs to swap the implementation, these tests are the regression net.

### Data flow

1. Test setup: `_engine.connect()` → `conn.begin()` (outer transaction) → `session.begin_nested()` (SAVEPOINT 1) → `yield session`.
2. Test body: endpoints/services call `await db.commit()`. The commit closes the inner SAVEPOINT; the `after_transaction_end` hook reopens a fresh nested SAVEPOINT so subsequent commits keep working.
3. Test teardown (`finally`): `outer_trans.rollback()` discards all savepoints and the outer transaction.
4. Across tests: each test gets a brand-new `conn` from the engine, a brand-new outer transaction, a brand-new savepoint chain. No row from test T1 can be visible to test T2.

### Error handling and edge cases

| Case | Behavior |
|---|---|
| Assertion error inside test | pytest captures; `finally` rolls outer back. No leak. |
| `KeyboardInterrupt` / `SystemExit` | `finally` still runs (Python's normal interruption semantics for `try/finally`). |
| Endpoint calls `session.expunge_all()` | Hook listens on the `sync_session`; expunging objects does not destroy the session itself. Savepoint loop survives. |
| Endpoint dispatches a Celery task | Default test config runs Celery eager; the task gets the same overridden session and writes to the same savepoint. If a test needs the prod (non-eager) behavior, it must use `db_session_real`. |
| DEFERRED trigger | Never fires in SAVEPOINT (no real COMMIT). Covered by `smoke_constraints/`. |
| Test spawns a fresh `async_sessionmaker` (concurrency) | Outside the fixture's contract. Already the pattern for the 3 concurrency tests; they keep their own engine. |
| Engine left open by a hung test | Session-scoped `_engine` calls `dispose()` at the end of the suite regardless. |

## Migration plan

One PR. Order of operations:

1. Add `pytest-randomly>=3.16` and `pytest-deadfixtures>=2.2` to `backend/pyproject.toml` dev extras. Run `uv sync` (or equivalent) to update the lockfile.
2. Rewrite `db_session` body in `backend/tests/conftest.py` to the SAVEPOINT version. Add `_engine` session-scoped fixture above it. Add `db_session_real` below it.
3. Create `backend/tests/integration/smoke_constraints/__init__.py` and the two smoke test files.
4. Create `backend/tests/integration/test_db_session_savepoint.py` to lock the contract.
5. Validate locally: run the new tests in isolation (`pytest backend/tests/integration/test_db_session_savepoint.py backend/tests/integration/smoke_constraints/`) and then a representative slice that exercises the prior pollution path (`pytest backend/tests/integration/test_qa_publish_flow.py backend/tests/integration/test_session_backfill_extensive.py backend/tests/integration/test_single_active_extraction_invariant.py backend/tests/integration/test_template_clone_extraction.py`). The new tests do not depend on pre-existing data.
6. Open PR; mark **depends on PR #137, #141, #142**. Land after those three merge.

### Pre-conditions

- PRs #137, #141, #142 merged to `main`. The sentinel-coherence work in those PRs is orthogonal to SAVEPOINT but the seed helpers they introduce are referenced in test code that this spec touches.
- Local dev DB cleaned once after merge (`make reset-db` or equivalent). After that point, SAVEPOINT keeps it clean forever.

### Validation gate (definition of done)

- All new tests pass locally.
- `backend/tests/integration/test_db_session_savepoint.py` passes when run in isolation **and** when run as part of the full suite.
- The four previously-polluting files (`test_qa_publish_flow.py`, `test_session_backfill_extensive.py`, `test_single_active_extraction_invariant.py`, `test_template_clone_extraction.py`) pass against a fresh local DB and against a polluted local DB (the polluted scenario only validates that SAVEPOINT no longer adds new pollution; pre-existing rows from before merge still need a one-time reset).
- `pytest-randomly` seed appears in the test header on every run; no test fails for a fixed range of seeds while passing for others (would indicate a remaining ordering bug).

## Risks

- **Hidden cross-session dependency**: a test we haven't identified silently depends on a fixture commit being visible to a fresh session. Symptom: row-not-found errors after the flip. Mitigation: switch the test to `db_session_real`. Estimated incidence: low — the 3 known cross-session tests already opt out via their own session_factory.
- **`after_transaction_end` hook misfires**: if a test uses an unusual session lifecycle (manual `session.close()` mid-test, etc.) the hook might not reopen the savepoint and the next `commit()` raises. Mitigation: documented in `db_session` docstring; tests can opt into `db_session_real`.
- **DEFERRED constraint regression**: a future migration adds a deferred trigger but no one adds a smoke test. Mitigation: short, named directory (`smoke_constraints/`) with a one-line README ("one file per deferred trigger") raises the prompt naturally. Long-term: a `migrations/` linter could enforce this.
- **Worktree-vs-main drift**: this spec writes against a worktree branch at `e4f008a`, but expects PRs #137/#141/#142 to be on `main` first. Mitigation: PR depends-on chain documented.

## Open questions

- Should `pytest-deadfixtures` start blocking immediately or after the first sweep? **Recommended: non-blocking for one cycle, then blocking.** Captures noise without paralyzing CI.
- Should we add a `pytest.ini` `randomly_dont_shuffle_by_id` config to keep tests within a file in declared order? **Recommended: no.** Full randomization surfaces more.
- Should `db_session_real` be marked with a custom marker (`@pytest.mark.real_db`) for pytest filtering? **Recommended: defer.** Add only if we need to bulk-exclude these tests from a fast-feedback subset.

## Phase 3 (deferred — next spec)

When this lands, the natural next moves (in increasing investment order):

1. **`pytest-xdist` opt-in local** + nightly CI job. Cheap to install once SAVEPOINT removes the dominant collision class. Speed gain ~4× locally.
2. **Template database per worker**: `CREATE DATABASE prumo_test_$WORKER WITH TEMPLATE prumo_test_template`. Removes the dev-DB ↔ test-DB conflation entirely; combined with xdist gives full isolation by construction. Estimated 3-5 days.
3. **Factory expansion**: extend the existing `backend/tests/factories/template_factory.py` pattern to cover articles, runs, reviewer decisions, etc. Sentinel UUIDs in `conftest.py` retire as each consumer migrates. Estimated 3-5 days, can land incrementally.
4. **Retire `db_session_real`** once every cross-session-visibility need is met by template DB per worker. Pure SAVEPOINT default.

Suggested spec name: `docs/superpowers/specs/YYYY-MM-DD-test-infra-phase3-parallel-and-factories-design.md`.

## References

- Predecessor plan: `docs/superpowers/plans/2026-05-24-integration-test-pollution-cleanup.md`
- SQLAlchemy 2.0 "Joining a Session into an External Transaction (such as for test suites)" — canonical SAVEPOINT pattern.
- Migration sources for DEFERRED triggers: `backend/alembic/versions/0004_*.py` (template active version) and `0017_*.py` (entity role parent).
