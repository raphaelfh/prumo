# Scope

**Run ID**: 2026-05-19-2310-backend-envelope-batch
**Status**: converged
**Scope**: `backend/app/api/v1/endpoints/{user_api_keys,model_extraction,section_extraction,zotero_import}.py`

## Why this scope

The `check_api_response_envelope.py` baseline (committed in 32b4908)
listed 10 grandfathered endpoints returning bare `ApiResponse` instead
of `ApiResponse[T]`. Of those, 9 are mechanical fixes (just add the
generic type parameter); the 10th — `articles_export.py:start_export` —
returns `Response | ApiResponse[ExportStartedResponse]` and is a union
arm that the current AST check does not recognise. That one stays
baselined and turns into a Phase-2 improvement to the check itself.

## Files in scope (4)

- `backend/app/api/v1/endpoints/user_api_keys.py` (6 endpoints)
- `backend/app/api/v1/endpoints/model_extraction.py` (1 endpoint)
- `backend/app/api/v1/endpoints/section_extraction.py` (1 endpoint)
- `backend/app/api/v1/endpoints/zotero_import.py` (1 endpoint)
