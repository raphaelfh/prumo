---
status: in_progress
last_reviewed: 2026-09-03
owner: '@raphaelfh'
---

# Typed `MISSING_ENTITY_KEY` refusal — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A keyless repeating group refuses with one machine-readable code, `MISSING_ENTITY_KEY`, on the async section path (job `error_code`) and on the sync models path (typed 409 envelope), and the reviewer reads the title "Entry key missing" with the backend's actionable description on both.

**Architecture:** `MissingEntityKeyError` becomes an `AppError` (the `EngineRetiredError` shape: `code`, `status_code=409`, `details`), so the registered handler serves the typed envelope on the sync route once the models endpoint re-raises `AppError` ahead of its generic arm. The async taxonomy gains `ExtractionErrorCode.MISSING_ENTITY_KEY` with a type-based classify arm, so the job status carries the code. The frontend maps the code in `jobErrorToast` (job path) and reads the envelope code in `useModelExtraction` (sync path); both use one new copy key.

**Tech Stack:** FastAPI + Pydantic v2 (backend), pytest (unit + integration via httpx ASGI), React 19 + TanStack Query + sonner (frontend), Vitest, openapi-typescript (`scripts/generate_api_types.sh`).

Spec: [`docs/superpowers/specs/2026-09-03-entry-group-followup-train-design.md`](../specs/2026-09-03-entry-group-followup-train-design.md) §4 (PR 1).

## Global Constraints

- Zero new tables or columns. No Alembic migration in this PR.
- File-size ratchet: `backend/app/services/section_extraction_service.py` and `frontend/pages/ExtractionFullScreen.tsx` are not touched.
- React Compiler: no `try/catch` value blocks inside components; the hook change stays inside the existing `.catch()` chain.
- All user-facing text through `frontend/lib/copy/`; `scripts/fitness/check_copy_keys.py` is shrink-only (a new key must be referenced).
- `npx knip --no-tag-hints` and `npx knip --production --no-tag-hints` at zero findings; no new `knip.jsonc` exception.
- Vulture baseline never grows; mypy ratchet green.
- `bash scripts/generate_api_types.sh` after the enum change; `frontend/types/api/{openapi.json,schema.d.ts}` committed (CI's api-contract job fails on diff).
- English only in code, comments, tests and commits. Conventional commits.
- Backend commands run inside `backend/` with `uv run`; frontend commands run from the repo root. Integration tests need the local Supabase stack (`make start`); the whole backend suite is `make test-backend`.

---

### Task 1: `MissingEntityKeyError` becomes a typed 409 `AppError`

**Files:**
- Modify: `backend/app/services/entity_key.py:55-81` (imports + the class)
- Test: `backend/tests/unit/test_entity_key.py`

**Interfaces:**
- Consumes: `app.core.error_handler.AppError(code, message, status_code, details)` (existing; `llm_engine_service.py:35` imports it the same way).
- Produces: `MissingEntityKeyError(entity_type_id: UUID, entity_type_label: str | None = None)` with attributes `code == "MISSING_ENTITY_KEY"`, `status_code == 409`, `details == {"entity_type_id": "<uuid>"}`, `entity_type_id`, `entity_type_label`; `str(err)` is the reviewer-facing message. Tasks 2, 3 and 6 rely on these names.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/unit/test_entity_key.py` (add `from uuid import uuid4` at the top if the file does not import it yet):

```python
def test_missing_entity_key_error_is_a_typed_409() -> None:
    """The refusal is an ``AppError`` (spec A §4): the registered handler
    serves ``error.code == "MISSING_ENTITY_KEY"`` with HTTP 409 on the sync
    route, and the worker classifies the same type for the job path."""
    from app.core.error_handler import AppError

    et_id = uuid4()
    err = MissingEntityKeyError(et_id, "Final predictors")

    assert isinstance(err, AppError)
    assert err.code == "MISSING_ENTITY_KEY"
    assert err.status_code == 409
    assert err.details == {"entity_type_id": str(et_id)}
    assert err.entity_type_id == et_id
    assert err.entity_type_label == "Final predictors"
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

    Raised instead of duplicating in silence, before any write or LLM call.
    The template inspector is where a manager satisfies it. The seed stamps
    the global catalogue, the clone copies the flag (``CLONED_FIELD_COLUMNS``)
    and migrations 0059 and 0066 backfilled the rows that predate them, so
    the common path never reaches this.

    An ``AppError`` (the ``EngineRetiredError`` shape): the registered handler
    serves the typed envelope — ``error.code = "MISSING_ENTITY_KEY"``, HTTP
    409 — on the sync models route, and ``classify_extraction_error`` maps
    the same type to ``ExtractionErrorCode.MISSING_ENTITY_KEY`` for the job
    path. The message names the section and the fix; the frontend shows it
    verbatim under its own title.
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
            details={"entity_type_id": str(entity_type_id)},
        )
```

`{name!r}` is kept on purpose: `tests/integration/test_entry_group_extraction.py:453` asserts `"'Numeric performance'" in str(excinfo.value)`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && uv run pytest tests/unit/test_entity_key.py -q`
Expected: all PASS, including the new test.
Run (needs the local stack): `cd backend && uv run pytest tests/integration/test_entry_group_extraction.py -q -k "keyless or MissingEntityKey or no_key"`
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
- Test: `backend/tests/unit/test_extraction_errors.py`, `backend/tests/unit/test_run_section_extraction_task.py`

**Interfaces:**
- Consumes: `MissingEntityKeyError` from Task 1.
- Produces: `ExtractionErrorCode.MISSING_ENTITY_KEY == "MISSING_ENTITY_KEY"`; `classify_extraction_error(MissingEntityKeyError(...))` returns `(ExtractionErrorCode.MISSING_ENTITY_KEY, str(exc))`; the frontend union `components['schemas']['ExtractionErrorCode']` includes `"MISSING_ENTITY_KEY"` (Task 5 relies on it for type-checking the `switch`).

- [ ] **Step 1: Write the failing classify test**

Add to `class TestClassifyExtractionError` in `backend/tests/unit/test_extraction_errors.py`:

```python
    def test_missing_entity_key_maps_to_missing_entity_key(self) -> None:
        """A keyless repeating group refuses before any LLM call (identity
        spec §5.3). The typed code lets the run form show "Entry key missing"
        instead of the generic failure; the message already names the fix."""
        from uuid import uuid4

        from app.services.entity_key import MissingEntityKeyError

        exc = MissingEntityKeyError(uuid4(), "Final predictors")
        code, message = classify_extraction_error(exc)
        assert code is ExtractionErrorCode.MISSING_ENTITY_KEY
        assert message == str(exc)
        assert "Configuration tab" in message
```

- [ ] **Step 2: Write the failing task-level test**

In `backend/tests/unit/test_run_section_extraction_task.py`, in the same class that defines `_run_with_side_effect` and `test_missing_llm_key_carries_missing_api_key_code`, add:

```python
    def test_missing_entity_key_carries_missing_entity_key_code(self):
        from uuid import uuid4

        from app.services.entity_key import MissingEntityKeyError

        exc = MissingEntityKeyError(uuid4(), "Final predictors")
        err = self._run_with_side_effect(exc)
        assert err.error_code == ExtractionErrorCode.MISSING_ENTITY_KEY.value
        assert str(err) == str(exc)
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `cd backend && uv run pytest tests/unit/test_extraction_errors.py tests/unit/test_run_section_extraction_task.py -q -k missing_entity_key`
Expected: FAIL with `AttributeError: MISSING_ENTITY_KEY` (enum member missing).

- [ ] **Step 4: Add the enum member and its docstring bullet**

In `backend/app/schemas/extraction.py`, inside the `ExtractionErrorCode` docstring, add after the `LLM_ENDPOINT_UNAVAILABLE` bullet:

```python
    - ``MISSING_ENTITY_KEY`` — a repeating section declares no
      ``is_entity_key`` field (``MissingEntityKeyError``); refused before
      any LLM call, the sync kickoff serves the same code as a 409.
```

and add the member before `EXTRACTION_FAILED`:

```python
    MISSING_ENTITY_KEY = "MISSING_ENTITY_KEY"
```

- [ ] **Step 5: Add the classify arm**

In `backend/app/services/extraction_errors.py`, inside `classify_extraction_error`, extend the lazy import block:

```python
    from app.services.entity_key import MissingEntityKeyError
```

and add, after the `EndpointUnavailableError` arm and before the `FileNotFoundError` arm:

```python
    if isinstance(exc, MissingEntityKeyError):
        # A keyless repeating group (identity spec §5.3): refused before any
        # LLM call. The message names the section and the fix (a manager
        # marks the entry key in the Configuration tab) — keep it verbatim.
        return ExtractionErrorCode.MISSING_ENTITY_KEY, str(exc).strip() or _GENERIC_MESSAGE
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd backend && uv run pytest tests/unit/test_extraction_errors.py tests/unit/test_run_section_extraction_task.py tests/unit/test_section_extraction_endpoint.py -q`
Expected: all PASS.

- [ ] **Step 7: Regenerate the API contract**

Run from the repo root: `bash scripts/generate_api_types.sh`
Expected output: `Generated frontend/types/api/{openapi.json,schema.d.ts}`.
Run: `git diff --stat frontend/types/api/ && grep -n '"MISSING_ENTITY_KEY"' frontend/types/api/schema.d.ts`
Expected: both files changed; the grep prints the `ExtractionErrorCode` union line containing `"MISSING_ENTITY_KEY"`.
Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add backend/app/schemas/extraction.py backend/app/services/extraction_errors.py backend/tests/unit/test_extraction_errors.py backend/tests/unit/test_run_section_extraction_task.py frontend/types/api/openapi.json frontend/types/api/schema.d.ts
git commit -m "feat(extraction): MISSING_ENTITY_KEY in the async error taxonomy"
```

---

### Task 3: The models endpoint re-raises `AppError` instead of flattening it into a 500

**Files:**
- Modify: `backend/app/api/v1/endpoints/model_extraction.py` (imports; the `except` ladder of `extract_models`, which today ends with `except FileNotFoundError` and a final `except Exception as e:` arm that raises the generic 500)
- Test: `backend/tests/unit/test_one_live_run_conflict_mapping.py` (direct coroutine, the ASGI blind spot), new `backend/tests/integration/test_missing_entity_key_envelope.py` (the envelope through the real app)

**Interfaces:**
- Consumes: `MissingEntityKeyError` (Task 1); `_call_extract_models(payload, service, caller, credentials_error=None)` and `_model_extraction_payload(project_id, article_id, template_id)` helpers already defined in `test_one_live_run_conflict_mapping.py`; fixtures `client_as_manager` and `SEED` from `tests/integration/conftest.py`.
- Produces: `POST /api/v1/extraction/models` answers `409 {"ok": false, "error": {"code": "MISSING_ENTITY_KEY", "message": ..., "details": {"entity_type_id": ...}}}` when the service raises.

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
    service.extract = AsyncMock(
        side_effect=MissingEntityKeyError(uuid4(), "Prediction models")
    )

    with pytest.raises(MissingEntityKeyError) as exc_info:
        await _call_extract_models(
            _model_extraction_payload(project_id, article_id, template_id), service, caller
        )

    assert exc_info.value.status_code == 409
    assert exc_info.value.code == "MISSING_ENTITY_KEY"
```

- [ ] **Step 2: Write the failing integration test**

Create `backend/tests/integration/test_missing_entity_key_envelope.py`:

```python
"""A keyless repeating group refuses the sync models kickoff with the typed
409 envelope (``error.code == "MISSING_ENTITY_KEY"``) — never the generic
500 the route's broad ``except Exception`` used to produce.

The service is patched to raise: the refusal itself is covered by the
entry-group pipeline tests; this test pins the ROUTE + registered handler +
envelope shape through the real ASGI app.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from httpx import AsyncClient

from app.services.engine_credentials import EngineCredentials
from app.services.entity_key import MissingEntityKeyError
from tests.integration.conftest import SEED

pytestmark = pytest.mark.asyncio

_MODEL_EP = "app.api.v1.endpoints.model_extraction"


async def test_models_kickoff_on_keyless_group_is_typed_409(
    client_as_manager: AsyncClient,
) -> None:
    entity_type_id = uuid4()
    service = MagicMock()
    service.extract = AsyncMock(
        side_effect=MissingEntityKeyError(entity_type_id, "Prediction models")
    )
    with (
        patch(
            f"{_MODEL_EP}.resolve_engine_credentials",
            AsyncMock(return_value=EngineCredentials(None, None, None, None)),
        ),
        patch(f"{_MODEL_EP}.create_storage_adapter", return_value=MagicMock()),
        patch(f"{_MODEL_EP}.ModelExtractionService", return_value=service),
    ):
        r = await client_as_manager.post(
            "/api/v1/extraction/models",
            json={
                "projectId": str(SEED.primary_project),
                "articleId": str(SEED.primary_article),
                "templateId": str(SEED.primary_template),
            },
        )

    assert r.status_code == 409, r.text
    body = r.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "MISSING_ENTITY_KEY"
    assert body["error"]["details"] == {"entity_type_id": str(entity_type_id)}
    assert "'Prediction models'" in body["error"]["message"]
    assert "Configuration tab" in body["error"]["message"]
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `cd backend && uv run pytest tests/unit/test_one_live_run_conflict_mapping.py::test_extract_models_lets_missing_entity_key_through -q`
Expected: FAIL — `HTTPException` (500) raised instead of `MissingEntityKeyError`.
Run (needs the local stack): `cd backend && uv run pytest tests/integration/test_missing_entity_key_envelope.py -q`
Expected: FAIL with `assert 500 == 409`.

- [ ] **Step 4: Write the minimal implementation**

In `backend/app/api/v1/endpoints/model_extraction.py`, add the import:

```python
from app.core.error_handler import AppError
```

Inside `extract_models`, insert this arm immediately before the final `except Exception as e:` arm (after the `except FileNotFoundError as e:` arm):

```python
    except AppError:
        # Typed refusals raised inside the service (``MissingEntityKeyError``:
        # 409 ``MISSING_ENTITY_KEY``) reach their registered handler and serve
        # the typed envelope; the generic arm below would flatten them into a
        # 500 no client can act on. Same reason the engine/endpoint resolvers
        # sit above the try.
        await db.rollback()
        raise
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && uv run pytest tests/unit/test_one_live_run_conflict_mapping.py -q`
Expected: all PASS.
Run (needs the local stack): `cd backend && uv run pytest tests/integration/test_missing_entity_key_envelope.py tests/integration/test_llm_engine_kickoff_gate.py -q`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/v1/endpoints/model_extraction.py backend/tests/unit/test_one_live_run_conflict_mapping.py backend/tests/integration/test_missing_entity_key_envelope.py
git commit -m "fix(extraction): models kickoff serves the typed 409 for a keyless group"
```

---

### Task 4: `jobErrorToast` maps the code, with the new copy key (job path)

**Files:**
- Modify: `frontend/lib/copy/extraction.ts:73-75`
- Modify: `frontend/lib/ai-extraction/jobErrorToast.ts:31-45`
- Test: `frontend/lib/ai-extraction/jobErrorToast.test.ts`, `frontend/test/hooks/useSectionExtraction.test.tsx`

**Interfaces:**
- Consumes: the regenerated `ExtractionErrorCode` union (Task 2).
- Produces: copy key `t('extraction', 'sectionExtractionErrorNoEntryKey') === 'Entry key missing'`; `jobErrorToast('MISSING_ENTITY_KEY', msg)` returns `{title, description: msg, duration: 8000}`. Task 5 reuses the copy key.

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

- [ ] **Step 4: Add the copy key and the case**

In `frontend/lib/copy/extraction.ts`, after `sectionExtractionErrorAuthDesc: 'Please sign in again.',` add:

```ts
    sectionExtractionErrorNoEntryKey: 'Entry key missing',
```

In `frontend/lib/ai-extraction/jobErrorToast.ts`, add a case before `default:`:

```ts
    case 'MISSING_ENTITY_KEY':
      // A keyless repeating group refused before any LLM call. The backend
      // message names the section and the fix (a manager marks the entry key
      // in the Configuration tab), so surface it verbatim under its own title.
      return {
        title: t('extraction', 'sectionExtractionErrorNoEntryKey'),
        description: message,
        duration,
      };
```

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

### Task 5: The sync models hook reads the envelope code

**Files:**
- Modify: `frontend/lib/ai-extraction/errors.ts` (new helper after `getErrorCode`)
- Modify: `frontend/hooks/extraction/useModelExtraction.ts:127-140` (the `.catch` branch)
- Test: `frontend/test/hooks/useModelExtraction.test.tsx`

**Interfaces:**
- Consumes: `APIError(message, statusCode?, details?)` from `frontend/lib/ai-extraction/errors.ts` — `sectionExtractionService.extractModels` wraps the client's `ApiError` as `new APIError(error.message, error.status, {code: error.code, traceId})`, so the envelope code lives at `details.code` while `APIError.code` is the fixed `'API_ERROR'` class tag; the copy key from Task 4.
- Produces: `getApiErrorCode(error: unknown): string | null`.

- [ ] **Step 1: Write the failing hook test**

In `frontend/test/hooks/useModelExtraction.test.tsx`, add the imports (the `sonner` module is already mocked in this file, so `toast.error` is a `vi.fn()`):

```ts
import { toast } from 'sonner';
import { APIError } from '@/lib/ai-extraction/errors';
```

and add to `describe('useModelExtraction promise contract')`:

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

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run frontend/test/hooks/useModelExtraction.test.tsx`
Expected: the new case FAILS (`toast.error` was called with `'modelExtractionErrorTitle: ...'`).

- [ ] **Step 3: Add the helper**

In `frontend/lib/ai-extraction/errors.ts`, after `getErrorCode`:

```ts
/**
 * The backend envelope's `error.code` behind a failed FastAPI call.
 *
 * `sectionExtractionService` wraps the client's `ApiError` as an `APIError`
 * whose own `code` is the fixed `'API_ERROR'` class tag; the envelope code
 * travels under `details.code`. `null` for anything else, so callers fall
 * back to their generic copy.
 */
export function getApiErrorCode(error: unknown): string | null {
  if (!isAIExtractionError(error)) {
    return null;
  }
  const details = error.details;
  if (typeof details !== 'object' || details === null) {
    return null;
  }
  const code = (details as Record<string, unknown>).code;
  return typeof code === 'string' ? code : null;
}
```

- [ ] **Step 4: Branch on it in the hook**

In `frontend/hooks/extraction/useModelExtraction.ts`, extend the import:

```ts
import {AuthenticationError, getApiErrorCode, getErrorCode, getErrorMessage, PDFNotFoundError,} from "@/lib/ai-extraction/errors";
```

and inside the `.catch((err: unknown) => { ... })` block, replace the `if (err instanceof PDFNotFoundError || errorCode === 'PDF_NOT_FOUND') {` opener with:

```ts
          if (getApiErrorCode(err) === 'MISSING_ENTITY_KEY') {
            // A keyless repeating group refused the kickoff (typed 409). The
            // backend message names the section and the fix; same title and
            // duration as the job path's toast.
            toast.error(t('extraction', 'sectionExtractionErrorNoEntryKey'), {
              description: message,
              duration: 8000,
            });
          } else if (err instanceof PDFNotFoundError || errorCode === 'PDF_NOT_FOUND') {
```

(the rest of the ladder is unchanged).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run frontend/test/hooks/useModelExtraction.test.tsx frontend/lib/ai-extraction`
Expected: all PASS.
Run: `npm run typecheck && npm run lint`
Expected: exit 0 for both.

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/ai-extraction/errors.ts frontend/hooks/extraction/useModelExtraction.ts frontend/test/hooks/useModelExtraction.test.tsx
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
Expected: 0 failed (the count grows by the six new tests).
Run: `make lint-backend`
Expected: ruff check and format clean.
Run: `cd backend && uv run vulture app --min-confidence 60 --exclude "*/migrations/*" | wc -l` (or the exact ratchet command in `scripts/vulture_baseline.py --help`) and `uv run python ../scripts/vulture_baseline.py --check`
Expected: baseline unchanged (no backend code deleted, none added dead).
Run: `cd backend && uv run mypy app` (the ratchet the CI job runs; see `Makefile` target `typecheck-backend` if it differs)
Expected: no new errors.

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

- [ ] **Step 4: Docs parity statement**

`docs/reference/extraction-hitl-architecture.md` has no row for the job error codes, and this PR changes no endpoint route and no table, so no doc change is needed; say so in the PR body under "Code ↔ doc parity". The enum's own docstring is the code-level reference.

- [ ] **Step 5: Open the PR (auto-merge held; the docs PR #803 holds the merge-train slot)**

```bash
git push -u origin claude/entry-key-typed-refusal
gh pr create --base dev --title "feat(extraction): typed MISSING_ENTITY_KEY refusal for a keyless repeating group" --body "<template-shaped body quoting the gate outputs from Steps 1-3>"
```

Arm `gh pr merge <n> --auto --squash` only after #803 has merged.
