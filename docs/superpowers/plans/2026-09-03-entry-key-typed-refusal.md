---
status: in_progress
last_reviewed: 2026-09-03
owner: '@raphaelfh'
---

# Typed `MISSING_ENTITY_KEY` refusal — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A keyless repeating group refuses with one machine-readable code, `MISSING_ENTITY_KEY`, on the async single-section job path (job `error_code`) and on the sync models path (typed 409 envelope), and the reviewer reads the title "Entry key missing" with the backend's actionable description on both.

**Architecture:** `MissingEntityKeyError` becomes an `AppError` (the `EngineRetiredError` shape: `code`, `status_code=409`), which constitution §VIII mandates for every custom exception; the registered handler serves the typed envelope on the sync route once the models endpoint re-raises `AppError` ahead of its narrower arms. The async taxonomy gains `ExtractionErrorCode.MISSING_ENTITY_KEY` with a type-based classify arm, so the job status carries the code. The frontend maps the code in `jobErrorToast` (one place for the title and the duration); the sync hook reaches it because `APIError` now carries the envelope code as its own `code`.

**Tech Stack:** FastAPI + Pydantic v2 (backend), pytest (unit + integration via httpx ASGI), React 19 + sonner (frontend), Vitest, openapi-typescript (`scripts/generate_api_types.sh`).

Spec: [`docs/superpowers/specs/2026-09-03-entry-group-followup-train-design.md`](../specs/2026-09-03-entry-group-followup-train-design.md) §4 (PR 1). Revised 2026-09-03 after the five-lens adversarial panel (simplicity, test coverage, constitution, security, migration safety); the changes are recorded in §Panel at the end.

## Global Constraints

- Zero new tables or columns. No Alembic migration: `ExtractionErrorCode` is never persisted (verified: the only `error_code` column is `article_sync_events.error_code`, a plain string unrelated to this enum).
- File-size ratchet: `backend/app/services/section_extraction_service.py` and `frontend/pages/ExtractionFullScreen.tsx` are not touched.
- React Compiler: no `try/catch` value blocks inside components; the hook change stays inside the existing `.catch()` chain.
- All user-facing text through `frontend/lib/copy/`; `scripts/fitness/check_copy_keys.py` is shrink-only (a new key must be referenced).
- `npx knip --no-tag-hints` and `npx knip --production --no-tag-hints` at zero findings; no new `knip.jsonc` exception.
- Vulture baseline never grows; mypy ratchet green.
- `bash scripts/generate_api_types.sh` after the enum change; `frontend/types/api/{openapi.json,schema.d.ts}` committed (CI's api-contract job fails on diff). Tasks 4 and 5 fail `npm run typecheck` until that regeneration has happened, so keep the task order.
- English only in code, comments, tests and commits. Conventional commits.
- Backend commands run inside `backend/` with `uv run`; frontend commands run from the repo root (the worktree root, never `backend/`). Integration tests need the local Supabase stack (`make start`); the whole backend suite is `make test-backend`.

---

### Task 1: `MissingEntityKeyError` becomes a typed 409 `AppError`

**Files:**
- Modify: `backend/app/services/entity_key.py:55-81` (imports + the class) and the `key_field_of` docstring at `:165-175`
- Test: `backend/tests/unit/test_entity_key.py` (already imports `uuid4` and `MissingEntityKeyError`)

**Interfaces:**
- Consumes: `app.core.error_handler.AppError(code, message, status_code, details=None)` (existing; `llm_engine_service.py:35` imports it the same way).
- Produces: `MissingEntityKeyError(entity_type_id: UUID, entity_type_label: str | None = None)` with `code == "MISSING_ENTITY_KEY"`, `status_code == 409`, `details is None`; `str(err)` is the reviewer-facing message. Tasks 2 and 3 rely on the class and its `code`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/unit/test_entity_key.py`:

```python
def test_missing_entity_key_error_is_a_typed_409() -> None:
    """The refusal is an ``AppError`` (spec A §4): the registered handler
    serves ``error.code == "MISSING_ENTITY_KEY"`` with HTTP 409 on the sync
    route, and the worker classifies the same type for the job path."""
    from app.core.error_handler import AppError

    err = MissingEntityKeyError(uuid4(), "Final predictors")

    assert isinstance(err, AppError)
    assert err.code == "MISSING_ENTITY_KEY"
    assert err.status_code == 409
    assert str(err) == (
        "The repeating section 'Final predictors' declares no entry key, so AI "
        "extraction cannot tell a new entry from one it already extracted. Ask a "
        "project manager to mark one of its fields as the entry key in the "
        "Configuration tab."
    )
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_entity_key.py::test_missing_entity_key_error_is_a_typed_409 -q`
Expected: FAIL at `assert isinstance(err, AppError)`.

- [ ] **Step 3: Write the minimal implementation**

In `backend/app/services/entity_key.py`, add the import next to the other `app.` imports:

```python
from app.core.error_handler import AppError
```

Replace the class (lines 63-81) with:

```python
class MissingEntityKeyError(AppError):
    """A repeating group declares no ``is_entity_key`` field.

    Raised instead of duplicating in silence, before any write or LLM call;
    a manager satisfies it in the Configuration tab. The seed stamps the
    global catalogue, the clone copies the flag (``CLONED_FIELD_COLUMNS``)
    and migrations 0059 and 0066 backfilled the rows that predate them, so
    the common path never reaches this.

    An ``AppError`` (the ``EngineRetiredError`` shape): the registered
    handler serves ``error.code = "MISSING_ENTITY_KEY"`` as HTTP 409 on the
    sync models route, and ``classify_extraction_error`` maps the same type
    to ``ExtractionErrorCode.MISSING_ENTITY_KEY`` for the job path. The
    message names the section and the fix; the frontend shows it verbatim
    under its own title.
    """

    def __init__(self, entity_type_id: UUID, entity_type_label: str | None = None) -> None:
        self.entity_type_id = entity_type_id
        self.entity_type_label = entity_type_label
        name = entity_type_label or str(entity_type_id)
        super().__init__(
            code="MISSING_ENTITY_KEY",
            message=(
                f"The repeating section {name!r} declares no entry key, so AI "
                "extraction cannot tell a new entry from one it already extracted. "
                "Ask a project manager to mark one of its fields as the entry key "
                "in the Configuration tab."
            ),
            status_code=409,
        )
```

`{name!r}` is kept on purpose: `tests/integration/test_entry_group_extraction.py:453` asserts `"'Numeric performance'" in str(excinfo.value)`.

In the `key_field_of` docstring (line ~173), replace "the message names the section as the template editor shows it" with "the message names the section as the Configuration tab shows it".

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && uv run pytest tests/unit/test_entity_key.py -q`
Expected: all PASS, including the new test.
Run (needs the local stack): `cd backend && uv run pytest tests/integration/test_entry_group_extraction.py -q -k keyless`
Expected: PASS (the message still carries the quoted label).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/entity_key.py backend/tests/unit/test_entity_key.py
git commit -m "feat(extraction): MissingEntityKeyError is a typed 409 AppError (MISSING_ENTITY_KEY)"
```

---

### Task 2: `ExtractionErrorCode.MISSING_ENTITY_KEY`, the classify arm, and the regenerated API contract

**Files:**
- Modify: `backend/app/schemas/extraction.py:521-546` (`ExtractionErrorCode`)
- Modify: `backend/app/services/extraction_errors.py:52-77` (`classify_extraction_error`)
- Regenerate: `frontend/types/api/openapi.json`, `frontend/types/api/schema.d.ts`
- Test: `backend/tests/unit/test_extraction_errors.py`, `backend/tests/unit/test_run_section_extraction_task.py`, `backend/tests/integration/test_entry_group_extraction.py:442-456`

**Interfaces:**
- Consumes: `MissingEntityKeyError` from Task 1.
- Produces: `ExtractionErrorCode.MISSING_ENTITY_KEY == "MISSING_ENTITY_KEY"`; `classify_extraction_error(MissingEntityKeyError(...))` returns `(ExtractionErrorCode.MISSING_ENTITY_KEY, str(exc))`; the frontend union `components['schemas']['ExtractionErrorCode']` includes `"MISSING_ENTITY_KEY"` (Task 4's `switch` type-checks against it).

- [ ] **Step 1: Write the failing classify test**

Add to `class TestClassifyExtractionError` in `backend/tests/unit/test_extraction_errors.py`:

```python
    def test_missing_entity_key_maps_to_missing_entity_key(self) -> None:
        """A keyless repeating group refuses before any LLM call; the code
        lets the run form show "Entry key missing" instead of the generic
        failure, and the message already names the fix."""
        from uuid import uuid4

        from app.services.entity_key import MissingEntityKeyError

        exc = MissingEntityKeyError(uuid4(), "Final predictors")
        code, message = classify_extraction_error(exc)
        assert code is ExtractionErrorCode.MISSING_ENTITY_KEY
        assert message == str(exc)
        assert "Configuration tab" in message
```

- [ ] **Step 2: Write the failing task-level test**

In `backend/tests/unit/test_run_section_extraction_task.py`, inside `class TestRunSectionExtractionTaskErrorCode` (line 350, the class that defines `_run_with_side_effect`), add:

```python
    def test_missing_entity_key_carries_missing_entity_key_code(self):
        from uuid import uuid4

        from app.services.entity_key import MissingEntityKeyError

        exc = MissingEntityKeyError(uuid4(), "Final predictors")
        err = self._run_with_side_effect(exc)
        assert err.error_code == ExtractionErrorCode.MISSING_ENTITY_KEY.value
        assert str(err) == str(exc)
```

- [ ] **Step 3: Extend the real-service integration test with the job code**

In `backend/tests/integration/test_entry_group_extraction.py`, inside `test_a_keyless_repeating_group_is_refused_before_any_write_or_llm_call`, after the line `assert "'Numeric performance'" in str(excinfo.value)` add:

```python
    # The code the single-section job carries for this exact raise: the task
    # wraps whatever the service raises through ``classify_extraction_error``
    # (pinned by ``TestRunSectionExtractionTaskErrorCode``), so this is the
    # real-pipeline half of the section-path proof.
    from app.schemas.extraction import ExtractionErrorCode
    from app.services.extraction_errors import classify_extraction_error

    assert classify_extraction_error(excinfo.value)[0] is ExtractionErrorCode.MISSING_ENTITY_KEY
```

- [ ] **Step 4: Run the three tests to verify they fail**

Run: `cd backend && uv run pytest tests/unit/test_extraction_errors.py tests/unit/test_run_section_extraction_task.py -q -k missing_entity_key`
Expected: FAIL with `AttributeError: MISSING_ENTITY_KEY` (enum member missing).
Run (needs the local stack): `cd backend && uv run pytest tests/integration/test_entry_group_extraction.py -q -k keyless`
Expected: FAIL with the same `AttributeError`.

- [ ] **Step 5: Add the enum member and its docstring bullet**

In `backend/app/schemas/extraction.py`, inside the `ExtractionErrorCode` docstring, add after the `LLM_ENDPOINT_UNAVAILABLE` bullet:

```python
    - ``MISSING_ENTITY_KEY`` — a repeating section declares no
      ``is_entity_key`` field (``MissingEntityKeyError``), refused before any
      LLM call. Carried by the single-section job and, as a 409, by the sync
      models kickoff; a batch run keeps reporting per-section text.
```

and add the member before `EXTRACTION_FAILED`:

```python
    MISSING_ENTITY_KEY = "MISSING_ENTITY_KEY"
```

- [ ] **Step 6: Add the classify arm**

In `backend/app/services/extraction_errors.py`, inside `classify_extraction_error`, extend the lazy import block:

```python
    from app.services.entity_key import MissingEntityKeyError
```

and add, after the `EndpointUnavailableError` arm and before the `FileNotFoundError` arm:

```python
    if isinstance(exc, MissingEntityKeyError):
        # Keyless repeating group: the message already names the section and the fix.
        return ExtractionErrorCode.MISSING_ENTITY_KEY, str(exc).strip() or _GENERIC_MESSAGE
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd backend && uv run pytest tests/unit/test_extraction_errors.py tests/unit/test_run_section_extraction_task.py tests/unit/test_section_extraction_endpoint.py -q`
Expected: all PASS.
Run (needs the local stack): `cd backend && uv run pytest tests/integration/test_entry_group_extraction.py -q -k keyless`
Expected: PASS.

- [ ] **Step 8: Regenerate the API contract**

Run from the repo root: `bash scripts/generate_api_types.sh`
Expected output: `Generated frontend/types/api/{openapi.json,schema.d.ts}`.
Run: `git diff --stat frontend/types/api/ && grep -n '"MISSING_ENTITY_KEY"' frontend/types/api/schema.d.ts`
Expected: both files changed; the grep prints the `ExtractionErrorCode` union line containing `"MISSING_ENTITY_KEY"`.
Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add backend/app/schemas/extraction.py backend/app/services/extraction_errors.py backend/tests/unit/test_extraction_errors.py backend/tests/unit/test_run_section_extraction_task.py backend/tests/integration/test_entry_group_extraction.py frontend/types/api/openapi.json frontend/types/api/schema.d.ts
git commit -m "feat(extraction): MISSING_ENTITY_KEY in the async error taxonomy"
```

---

### Task 3: The models endpoint lets a typed `AppError` reach its handler

**Files:**
- Modify: `backend/app/api/v1/endpoints/model_extraction.py` (imports; the `except` ladder of `extract_models`, whose first arm today is `except CreateRunInputError as e:` and whose last is a generic `except Exception as e:` that raises the 500)
- Test: `backend/tests/unit/test_one_live_run_conflict_mapping.py` (direct coroutine — the ASGI diff-cover blind spot its module docstring names), `backend/tests/integration/test_llm_engine_kickoff_gate.py` (the envelope through the real app; the module already re-exports `client_as_manager` and `client_as_outsider` from `tests/integration/helpers/engine_setup.py` and defines `_models_payload()`)

**Interfaces:**
- Consumes: `MissingEntityKeyError` (Task 1); `_call_extract_models(payload, service, caller, credentials_error=None)` and `_model_extraction_payload(project_id, article_id, template_id)` from `test_one_live_run_conflict_mapping.py`.
- Produces: `POST /api/v1/extraction/models` answers `409 {"ok": false, "error": {"code": "MISSING_ENTITY_KEY", "message": "...", "details": null}}` when the service raises; an outsider still gets 403 before the service is reached.

- [ ] **Step 1: Write the failing direct-coroutine test**

Append to `backend/tests/unit/test_one_live_run_conflict_mapping.py`:

```python
@pytest.mark.asyncio
async def test_extract_models_lets_missing_entity_key_through() -> None:
    """``MissingEntityKeyError`` is an ``AppError`` (typed 409
    ``MISSING_ENTITY_KEY``), not a ``ValueError``: inside the route's broad
    ``except Exception`` it became the generic 500 "Model extraction failed"
    no client could act on. The route must let it reach the registered
    handler, the way the endpoint-unavailable error does."""
    from app.services.entity_key import MissingEntityKeyError

    project_id, article_id, template_id, caller = uuid4(), uuid4(), uuid4(), uuid4()
    service = MagicMock()
    service.extract = AsyncMock(side_effect=MissingEntityKeyError(uuid4(), "Prediction models"))

    with pytest.raises(MissingEntityKeyError) as exc_info:
        await _call_extract_models(
            _model_extraction_payload(project_id, article_id, template_id), service, caller
        )

    assert exc_info.value.status_code == 409
    assert exc_info.value.code == "MISSING_ENTITY_KEY"
```

- [ ] **Step 2: Write the failing integration tests**

Append to `backend/tests/integration/test_llm_engine_kickoff_gate.py` (add `from unittest.mock import AsyncMock, MagicMock, patch`, `from uuid import uuid4` and `from app.services.entity_key import MissingEntityKeyError` to its imports if absent):

```python
_MODEL_EP = "app.api.v1.endpoints.model_extraction"


def _keyless_service() -> MagicMock:
    """A service whose kickoff refuses the way a keyless container does; the
    refusal itself is pinned by the entry-group pipeline tests — these two
    tests pin the ROUTE, the registered handler and the envelope shape."""
    service = MagicMock()
    service.extract = AsyncMock(side_effect=MissingEntityKeyError(uuid4(), "Prediction models"))
    return service


@pytest.mark.asyncio
async def test_models_kickoff_on_keyless_group_is_typed_409(
    client_as_manager: AsyncClient,
) -> None:
    with patch(f"{_MODEL_EP}.ModelExtractionService", return_value=_keyless_service()):
        r = await client_as_manager.post("/api/v1/extraction/models", json=_models_payload())
    assert r.status_code == 409, r.text
    body = r.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "MISSING_ENTITY_KEY"
    assert "'Prediction models'" in body["error"]["message"]
    assert "Configuration tab" in body["error"]["message"]


@pytest.mark.asyncio
async def test_outsider_on_keyless_group_gets_403_not_409(
    client_as_outsider: AsyncClient,
) -> None:
    """Scope runs before the service: an outsider never learns the section
    is keyless (or that the template exists)."""
    service = _keyless_service()
    with patch(f"{_MODEL_EP}.ModelExtractionService", return_value=service):
        r = await client_as_outsider.post("/api/v1/extraction/models", json=_models_payload())
    assert r.status_code == 403, r.text
    service.extract.assert_not_awaited()
```

If the manager test fails before reaching the patched service because `resolve_engine_credentials` raises in the local environment, add `patch(f"{_MODEL_EP}.resolve_engine_credentials", AsyncMock(return_value=EngineCredentials(None, None, None, None)))` (import `EngineCredentials` from `app.services.engine_credentials`) to that test only, and say so in the commit body. The panel verified the seed project resolves the env-default engine without raising and that the storage adapter is only ever handed to the patched service.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd backend && uv run pytest tests/unit/test_one_live_run_conflict_mapping.py::test_extract_models_lets_missing_entity_key_through -q`
Expected: FAIL — `HTTPException` (500) raised instead of `MissingEntityKeyError`.
Run (needs the local stack): `cd backend && uv run pytest tests/integration/test_llm_engine_kickoff_gate.py -q -k keyless`
Expected: the manager test FAILS with `assert 500 == 409`; the outsider test passes already (scope precedes the service).

- [ ] **Step 4: Write the minimal implementation**

In `backend/app/api/v1/endpoints/model_extraction.py`, add the import:

```python
from app.core.error_handler import AppError
```

Inside `extract_models`, insert this arm as the FIRST `except` of the ladder (immediately before `except CreateRunInputError as e:`):

```python
    except AppError as e:
        # Typed refusals raised inside the service (``MissingEntityKeyError``:
        # 409 ``MISSING_ENTITY_KEY``) reach their registered handler and serve
        # the typed envelope. First in the ladder so no narrower arm below can
        # flatten a dual-typed AppError into an HTTP_ERROR, and ahead of the
        # generic arm that would make it a 500 no client can act on.
        await db.rollback()
        logger.warning(
            "model_extraction_refused",
            trace_id=trace_id,
            code=e.code,
            project_id=str(payload.project_id),
            article_id=str(payload.article_id),
            template_id=str(payload.template_id),
        )
        raise
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && uv run pytest tests/unit/test_one_live_run_conflict_mapping.py -q`
Expected: all PASS.
Run (needs the local stack): `cd backend && uv run pytest tests/integration/test_llm_engine_kickoff_gate.py -q`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/v1/endpoints/model_extraction.py backend/tests/unit/test_one_live_run_conflict_mapping.py backend/tests/integration/test_llm_engine_kickoff_gate.py
git commit -m "fix(extraction): models kickoff serves the typed 409 for a keyless group"
```

---

### Task 4: `jobErrorToast` maps the code, with the new copy key (job path)

**Files:**
- Modify: `frontend/lib/copy/extraction.ts:73-75`
- Modify: `frontend/lib/ai-extraction/jobErrorToast.ts` (the parameter type and the `switch`)
- Test: `frontend/lib/ai-extraction/jobErrorToast.test.ts`, `frontend/test/hooks/useSectionExtraction.test.tsx`

**Interfaces:**
- Consumes: the regenerated `ExtractionErrorCode` union (Task 2).
- Produces: copy key `t('extraction', 'sectionExtractionErrorNoEntryKey') === 'Entry key missing'`; `jobErrorToast(code: string | null | undefined, message: string): JobErrorToast | null`, where `'MISSING_ENTITY_KEY'` returns `{title, description: message, duration: 8000}`. Task 5 calls it with the string code the sync path reads.

- [ ] **Step 1: Write the failing unit test**

Add to `describe('jobErrorToast')` in `frontend/lib/ai-extraction/jobErrorToast.test.ts`:

```ts
  it('maps MISSING_ENTITY_KEY to the entry-key title + the backend message', () => {
    const message = "The repeating section 'Final predictors' declares no entry key.";
    expect(jobErrorToast('MISSING_ENTITY_KEY', message)).toEqual({
      title: 'sectionExtractionErrorNoEntryKey',
      description: message,
      duration: 8000,
    });
  });
```

- [ ] **Step 2: Write the failing hook test**

Add to `describe('useSectionExtraction (async job)')` in `frontend/test/hooks/useSectionExtraction.test.tsx`, after the `MISSING_API_KEY` case:

```ts
  it('maps a MISSING_ENTITY_KEY failure code to the entry-key toast copy', async () => {
    const message = "The repeating section 'Final predictors' declares no entry key.";
    apiClientMock.mockResolvedValueOnce({job_id: 'job-sec-1'});
    statusMock.mockResolvedValue({
      ok: true,
      data: makeStatus('failed', {error: message, errorCode: 'MISSING_ENTITY_KEY'}),
    });

    const {wrapper} = createWrapper();
    const {result} = renderHook(() => useSectionExtraction(), {wrapper});

    await act(async () => {
      await result.current.extractSection(PARAMS);
    });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(toast.error).toHaveBeenCalledWith(
      'sectionExtractionErrorNoEntryKey',
      expect.objectContaining({description: message, duration: 8000}),
    );
  });
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `npx vitest run frontend/lib/ai-extraction/jobErrorToast.test.ts frontend/test/hooks/useSectionExtraction.test.tsx`
Expected: the two new cases FAIL (`null` returned; generic title used).

- [ ] **Step 4: Add the copy key, widen the parameter, add the case**

In `frontend/lib/copy/extraction.ts`, after `sectionExtractionErrorAuthDesc: 'Please sign in again.',` add:

```ts
    sectionExtractionErrorNoEntryKey: 'Entry key missing',
```

In `frontend/lib/ai-extraction/jobErrorToast.ts`, change the signature and the `switch` head to:

```ts
export function jobErrorToast(
  code: string | null | undefined,
  message: string,
): JobErrorToast | null {
  // Actionable failures hold the toast as long as the generic failure (8 s)
  // so the user can read the remediation. Owning the duration here keeps both
  // hooks consistent (no per-hook fallback drift).
  const duration = 8000;
  // The parameter is a string because the sync models path reads its code
  // from the untyped error envelope; the switch stays typed by the generated
  // union so a case label the backend does not emit fails typecheck.
  switch (code as ExtractionErrorCode | null | undefined) {
```

and add a case before `default:`:

```ts
    case 'MISSING_ENTITY_KEY':
      // Keyless repeating group: the backend message names the section and
      // the fix, so surface it verbatim under its own title.
      return {
        title: t('extraction', 'sectionExtractionErrorNoEntryKey'),
        description: message,
        duration,
      };
```

Update the module docstring's first paragraph to say the mapping serves both the job path and the sync models path.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run frontend/lib/ai-extraction/jobErrorToast.test.ts frontend/test/hooks/useSectionExtraction.test.tsx`
Expected: all PASS.
Run: `npm run typecheck && python3 scripts/fitness/check_copy_keys.py`
Expected: exit 0 for both (the new key is referenced).

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/copy/extraction.ts frontend/lib/ai-extraction/jobErrorToast.ts frontend/lib/ai-extraction/jobErrorToast.test.ts frontend/test/hooks/useSectionExtraction.test.tsx
git commit -m "feat(extraction): 'Entry key missing' toast for MISSING_ENTITY_KEY jobs"
```

---

### Task 5: The sync models hook reaches the same toast

**Files:**
- Modify: `frontend/lib/ai-extraction/errors.ts:55-64` (`APIError`)
- Modify: `frontend/hooks/extraction/useModelExtraction.ts` (imports; the `.catch` branch at `:127-140`)
- Test: new `frontend/lib/ai-extraction/errors.test.ts`, `frontend/test/hooks/useModelExtraction.test.tsx`

**Interfaces:**
- Consumes: `sectionExtractionService.extractModels` wraps the client's `ApiError` as `new APIError(error.message, error.status, {code: error.code, traceId})`; `getErrorCode(error)` (existing, returns `error.code` for any `AIExtractionError`); `jobErrorToast` from Task 4.
- Produces: `APIError.code` is the envelope code when `details.code` is a string, else the `'API_ERROR'` class tag (nothing reads that tag; the two `getErrorCode` callers compare against `PDF_NOT_FOUND` / `AUTH_ERROR`, which no envelope emits, so the promotion is behaviour-neutral).

- [ ] **Step 1: Write the failing `APIError` tests**

Create `frontend/lib/ai-extraction/errors.test.ts`:

```ts
import {describe, expect, it} from 'vitest';

import {APIError, getErrorCode} from '@/lib/ai-extraction/errors';

describe('APIError', () => {
  it('carries the backend envelope code when the details hold one', () => {
    const err = new APIError('refused', 409, {code: 'MISSING_ENTITY_KEY', traceId: 'tr-1'});
    expect(err.code).toBe('MISSING_ENTITY_KEY');
    expect(getErrorCode(err)).toBe('MISSING_ENTITY_KEY');
    expect(err.details).toEqual({statusCode: 409, code: 'MISSING_ENTITY_KEY', traceId: 'tr-1'});
  });

  it('falls back to the class tag without details', () => {
    expect(new APIError('boom').code).toBe('API_ERROR');
  });

  it('falls back to the class tag when the details carry no string code', () => {
    expect(new APIError('boom', 500, {originalError: 'x'}).code).toBe('API_ERROR');
  });
});
```

- [ ] **Step 2: Write the failing hook test and pin the generic fallback**

In `frontend/test/hooks/useModelExtraction.test.tsx`, add the imports (the `sonner` module is already mocked in this file, so `toast.error` is a `vi.fn()`):

```ts
import { toast } from 'sonner';
import { APIError } from '@/lib/ai-extraction/errors';
```

Inside the existing test `'a service failure rejects the caller promise (allSettled sees it)'`, after `expect(outcome!.status).toBe('rejected');` add:

```ts
    // The generic fallback still fires for an unclassified failure.
    expect(toast.error).toHaveBeenCalledWith('modelExtractionErrorTitle: extraction failed');
```

and add to the same `describe`:

```ts
  it('a MISSING_ENTITY_KEY envelope shows the entry-key toast with the backend message', async () => {
    const message = "The repeating section 'Prediction models' declares no entry key.";
    h.serviceExtractModels.mockRejectedValue(
      new APIError(message, 409, { code: 'MISSING_ENTITY_KEY', traceId: 'tr-1' }),
    );

    const { result } = renderHook(() => useModelExtraction());
    await act(async () => {
      await Promise.allSettled([result.current.extractModels(REQUEST)]);
    });

    expect(toast.error).toHaveBeenCalledWith('sectionExtractionErrorNoEntryKey', {
      description: message,
      duration: 8000,
    });
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run frontend/lib/ai-extraction/errors.test.ts frontend/test/hooks/useModelExtraction.test.tsx`
Expected: the first `APIError` case FAILS (`'API_ERROR'` received); the new hook case FAILS (generic toast); the generic-fallback assertion passes already.

- [ ] **Step 4: Promote the envelope code in `APIError`**

In `frontend/lib/ai-extraction/errors.ts`, replace the `APIError` class body with:

```ts
export class APIError extends AIExtractionError {
  constructor(message: string, statusCode?: number, details?: Record<string, unknown>) {
    // The backend envelope's `error.code` (carried under `details.code` by
    // `sectionExtractionService`) is this error's code; the class tag is the
    // fallback for failures without one (network, unknown shape).
    const code = typeof details?.code === 'string' ? details.code : 'API_ERROR';
    super(message, code, { statusCode, ...details });
    this.name = 'APIError';
  }
}
```

- [ ] **Step 5: Branch through `jobErrorToast` in the hook**

In `frontend/hooks/extraction/useModelExtraction.ts`, add the import:

```ts
import {jobErrorToast} from "@/lib/ai-extraction/jobErrorToast";
```

and inside the `.catch((err: unknown) => { ... })` block, replace

```ts
          const errorCode = code || '';
          if (err instanceof PDFNotFoundError || errorCode === 'PDF_NOT_FOUND') {
```

with

```ts
          const errorCode = code || '';
          // A typed backend refusal (MISSING_ENTITY_KEY: a keyless repeating
          // group) gets the job path's title and duration — one mapping.
          const specific = jobErrorToast(code, message);
          if (specific) {
            toast.error(specific.title, {
              description: specific.description,
              duration: specific.duration,
            });
          } else if (err instanceof PDFNotFoundError || errorCode === 'PDF_NOT_FOUND') {
```

(the rest of the ladder is unchanged).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run frontend/lib/ai-extraction frontend/test/hooks/useModelExtraction.test.tsx frontend/test/hooks/useSectionExtraction.test.tsx frontend/services/sectionExtractionService.test.ts`
Expected: all PASS.
Run: `npm run typecheck && npm run lint`
Expected: exit 0 for both.

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/ai-extraction/errors.ts frontend/lib/ai-extraction/errors.test.ts frontend/hooks/extraction/useModelExtraction.ts frontend/test/hooks/useModelExtraction.test.tsx
git commit -m "feat(extraction): sync models kickoff shows 'Entry key missing' on MISSING_ENTITY_KEY"
```

---

### Task 6: Gates, dead-code checks, and the PR body

**Files:**
- No source change expected. Verification only; fix anything red in place and commit.

**Interfaces:**
- Consumes: everything above.
- Produces: the evidence the PR body quotes.

- [ ] **Step 1: Backend suite and ratchets**

Run: `make test-backend`
Expected: 0 failed (the count grows by the seven new tests).
Run: `make lint-backend`
Expected: ruff check and format clean.
Run: `cd backend && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec` (the exact `deadcode:vulture` gate from `scripts/verify_all.sh`)
Expected: exit 0; findings are a subset of the baseline (no backend code deleted, none added dead, baseline untouched).
Run: `cd backend && uv run mypy app --ignore-missing-imports > mypy.out || true; uv run python ../scripts/mypy_baseline.py --baseline .mypy_baseline --input mypy.out` (the CI mypy ratchet, from the usage block in `scripts/mypy_baseline.py`)
Expected: exit 0; no error outside the baseline.

- [ ] **Step 2: Frontend suite and dead-code gates**

Run: `npm run test:run`
Expected: 0 failed.
Run: `npm run typecheck && npm run lint`
Expected: exit 0.
Run: `npx knip --no-tag-hints && npx knip --production --no-tag-hints`
Expected: zero findings in both modes.
Run: `python3 scripts/fitness/check_copy_keys.py`
Expected: green.

- [ ] **Step 3: Full deterministic gate**

Run: `make quality-scan`
Expected: every gate OK. Any red halts the run; fix and re-run.

- [ ] **Step 4: PR body statements (the panel's declarations)**

The PR body, template-shaped, states:

1. Docs parity: `docs/reference/extraction-hitl-architecture.md` has no row for the job error codes and this PR changes no endpoint route and no table, so no doc change is needed; the enum docstring is the code-level reference.
2. The section-path proof is two-part: the real keyless pipeline raise (`test_entry_group_extraction.py`, now asserting the classify result) plus the task-level wrapping test; there is no end-to-end eager job test because that harness mocks the service.
3. The code surfaces on the single-section job and the sync models kickoff; a batch run keeps reporting per-section text and `BatchAllSectionsFailed`, unchanged.
4. `except AppError` is wider than the one type reachable today on purpose: any typed refusal raised inside the service reaches its handler, and the generic arm already echoed `str(e)`.
5. `MISSING_ENTITY_KEY` is slice-local (like `LLM_ENGINE_RETIRED`), not added to `ApiErrorCode`, which nothing consumes.
6. Flagged, not touched: the unenqueued `extract_section_task` / `extract_models_task` entry points re-raise raw exceptions (the trees spec retires the model branch).
7. `model_container` count under `backend/app/services`: unchanged by this PR (26).

- [ ] **Step 5: Open the PR (auto-merge held; the docs PR #803 holds the merge-train slot)**

```bash
git push -u origin claude/entry-key-typed-refusal
gh pr create --base dev --title "feat(extraction): typed MISSING_ENTITY_KEY refusal for a keyless repeating group" --body "<template-shaped body quoting the gate outputs from Steps 1-3 and the statements from Step 4>"
```

Arm `gh pr merge <n> --auto --squash` only after #803 has merged.

## Panel

Five lenses reviewed the first draft (simplicity, test coverage, constitution/layering, security/RLS/BOLA, migration safety). Blocking findings and their resolution:

- Simplicity: the `getApiErrorCode` helper duplicated `getErrorCode`; `APIError` now carries the envelope code itself (Task 5). The `details={"entity_type_id"}` payload had no reader; dropped (Task 1).
- Test coverage: `client_as_manager` is re-exported per module from `tests/integration/helpers/engine_setup.py`, not a conftest fixture; the integration tests moved into `test_llm_engine_kickoff_gate.py` (Task 3).

Non-blocking findings adopted: the `except AppError` arm goes first in the ladder with a structured log line; an outsider 403-before-409 case; the models hook reuses `jobErrorToast`; a real-service classify assertion on the section path; `errors.test.ts` for the promoted code; the generic-toast assertion in the plain-`Error` hook test; the enum docstring scoped to the single-section job; wording drift ("template editor") fixed in the touched docstrings; the seven PR-body statements above.
