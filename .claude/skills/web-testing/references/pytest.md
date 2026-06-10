# pytest (backend) — deep dive

Read this when writing or fixing tests under `backend/tests/`. SKILL.md covers the rules; this file is the recipe book.

## 1. Async mode

`backend/pyproject.toml` sets `asyncio_mode = "auto"`, so `async def test_*` runs without a marker. The codebase still annotates many tests with `@pytest.mark.asyncio` for clarity — match the surrounding file's style. The marker also lets you pass `loop_scope`:

```python
@pytest.mark.asyncio(loop_scope="function")  # default; one loop per test
async def test_isolated(...): ...

@pytest.mark.asyncio(loop_scope="session")   # one loop for the whole session
async def test_shared_state(...): ...
```

**When to use `session` scope:** fixtures that own expensive resources (engine, app instance) and don't mutate per test. **Pitfall:** sharing an `AsyncSession` across loop scopes causes `RuntimeError: Future attached to a different loop`. `db_session` in our conftest is function-scoped on purpose.

## 2. The two HTTP fixtures, in detail

### `client` — mocked everything

```python
async def test_health_endpoint(client: AsyncClient) -> None:
    r = await client.get("/api/v1/health")
    assert r.status_code == 200
```

What it mocks: `get_db` (an `AsyncMock(spec=AsyncSession)`), `get_current_user` (a static `TokenPayload`), `get_supabase` (a `MagicMock` chain). Use only for:
- transport-layer assertions (status codes for malformed input, auth header presence),
- pure-logic endpoints that don't query.

### `db_client` — real Postgres

```python
async def test_create_run(db_client: AsyncClient, db_session: AsyncSession) -> None:
    r = await db_client.post("/api/v1/hitl/sessions", json={...})
    assert r.status_code == 201
    # read-back through SQLAlchemy
    row = await db_session.execute(text("SELECT stage FROM extraction_runs WHERE id = :id"), {"id": r.json()["data"]["run_id"]})
    assert row.scalar() == "PENDING"
```

Auth is still mocked (returns `test-user-id` with `role=authenticated`). If your test needs a specific role or `is_project_reviewer` to return true, build the row directly via SQL or seed via the service layer.

## 3. Builder fixtures (lightweight factory pattern)

Avoid factory-boy unless you have ≥5 use sites — for most cases a function returning a model is simpler:

```python
@pytest_asyncio.fixture
async def make_project(db_session: AsyncSession):
    created: list[UUID] = []

    async def _make(*, name: str = "Test", owner_id: UUID | None = None) -> UUID:
        owner_id = owner_id or (await db_session.execute(
            text("SELECT id FROM profiles LIMIT 1")
        )).scalar()
        pid = (await db_session.execute(
            text("INSERT INTO projects (name, owner_id) VALUES (:n, :o) RETURNING id"),
            {"n": name, "o": owner_id},
        )).scalar()
        created.append(pid)
        return pid

    yield _make
    # teardown: cascade via FK or explicit delete
    if created:
        await db_session.execute(text("DELETE FROM projects WHERE id = ANY(:ids)"), {"ids": created})
```

Closure-captured cleanup beats `addfinalizer` for async — finalizers run sync.

## 4. Parametrize with intent

```python
@pytest.mark.parametrize(
    ("payload", "expected_status", "expected_code"),
    [
        ({}, 422, "VALIDATION_ERROR"),
        ({"kind": "extraction"}, 400, "MISSING_TEMPLATE"),
        ({"kind": "quality_assessment", "project_template_id": "..."}, 201, None),
    ],
    ids=["empty", "extraction-no-template", "qa-happy-path"],
)
async def test_hitl_session_open(payload, expected_status, expected_code, db_client): ...
```

The `ids=` list is mandatory once a parameter is a dict — without it, pytest generates `test_name[payload0]` which is unreadable in CI logs.

## 5. monkeypatch and env

```python
def test_uses_dev_supabase_url(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "http://127.0.0.1:54321")
    monkeypatch.setattr("app.core.config.settings.supabase_url", "http://127.0.0.1:54321")
    # ...
```

For settings that are evaluated at import time, `monkeypatch.setattr` on the already-imported `settings` instance is more reliable than `setenv` alone. Reset is automatic at end of test.

## 6. Time control

`freezegun` or `time-machine` — check `pyproject.toml` for which is installed. `time-machine` is faster and supports async:

```python
import time_machine

@time_machine.travel("2026-05-17 12:00:00")
async def test_run_created_at_is_frozen(db_client): ...
```

For relative time, use `tick=True` to let the clock advance normally inside the block.

## 7. Indirect fixtures (for parametrized setup)

```python
@pytest_asyncio.fixture
async def run_in_stage(db_session, request):
    stage = request.param  # value comes from parametrize
    # ... build a run pinned to that stage
    return run_id

@pytest.mark.parametrize("run_in_stage", ["PENDING", "REVIEW", "PUBLISHED"], indirect=True)
async def test_publish_only_from_review(run_in_stage, db_client): ...
```

Use this when the parametrized value drives fixture setup, not the test body.

## 8. Skipping responsibly

```python
@pytest.mark.skipif(not _has_seed_data(), reason="run `python -m backend.app.seed` first")
async def test_uses_probast_template(...): ...
```

Better than failing with `IntegrityError`. Even better: build the prerequisites in a fixture.

```python
@pytest.mark.skip(reason="blocked by alembic migration 0019 — see #123")
```

Always cite a ticket. Skips without context become permanent.

## 9. Markers we use

```toml
markers = [
  "e2e: end-to-end tests against live stack",
  "performance: performance-sensitive or long-running tests",
]
```

Run subsets:
```bash
pytest -m "not e2e"             # default CI path
pytest -m e2e                    # heavy path
pytest -m "not performance"      # quick PR feedback
```

## 10. RLS testing

The `db_client` fixture's mocked user is `role=authenticated` with `sub=test-user-id`. RLS policies that depend on `auth.uid()` need that uid to actually exist in `profiles` and be a member of the row's project. Either:
- seed via the service layer (preferred), or
- set the session GUC: `await db_session.execute(text("SET LOCAL request.jwt.claims = '{\"sub\":\"...\"}'"))` — fragile, avoid.

Test the policy directly against `db_session` with raw SQL — `app.dependency_overrides` doesn't run RLS unless the connection uses an anon/auth role. By default test connections use the service role, which bypasses RLS.

To test RLS for real, you need to run queries with `SET ROLE authenticated` and `SET LOCAL request.jwt.claims` inside a transaction. See `backend/tests/integration/test_run_reviewers_endpoint.py` for an existing pattern.

## 11. Common failure modes

| Symptom                                                | Cause                                                   | Fix                                                              |
|--------------------------------------------------------|---------------------------------------------------------|------------------------------------------------------------------|
| `RuntimeError: Future attached to different loop`      | Mixed loop scopes; session-scoped engine + function fixtures | Stick to function-scoped engines; conftest already does this.    |
| `IntegrityError` on FK to `profiles`                    | Test assumes seed data                                  | Build the profile in a fixture or `pytest.skip` with a reason.   |
| `asyncpg.exceptions.UndefinedTableError`                | Forgot to run `alembic upgrade head` against test DB    | `cd backend && alembic upgrade head` before pytest.              |
| Test passes locally, fails in CI                       | Order dependency; another test leaks state              | Run locally with `pytest -p no:randomly` then re-add randomization. |
| `DeprecationWarning: There is no current event loop`    | Top-level `asyncio.get_event_loop()` outside a fixture  | Move into a fixture; conftest's `event_loop` fixture handles it. |

## 12. Coverage

```bash
cd backend && pytest --cov=app --cov-report=term-missing
```

No hard threshold yet, but PRs that drop coverage on touched modules get pushback. Focus on integration paths — unit-coverage alone is misleading per the project memory.
