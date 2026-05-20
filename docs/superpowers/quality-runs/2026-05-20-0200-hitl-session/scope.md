# Scope

**Run ID**: 2026-05-20-0200-hitl-session
**Created**: 2026-05-20T03:30:37Z
**Scope tag**: `concept:hitl-session`
**Scope hash**: `b3ce287293f1f465b51e3bcf596d7144dcb8c5f8a28476cb5514105fa1dc28e2`

## Files resolved

- backend/app/services/hitl_session_service.py
- backend/app/api/v1/endpoints/hitl_sessions.py

Total: 514 LOC.

## Why this scope

Per the concept-glossary, `concept:hitl-session` resolves to:
- `backend/app/services/hitl_session_service.py`
- `backend/app/api/v1/endpoints/hitl_sessions*.py`
- `frontend/services/hitlSessionService.ts` (does NOT exist today — concept
  is backend-only at the moment)
- `frontend/hooks/extraction/useHitl*.ts` (no current matches)

So this SCAN runs on the 2 backend files only. The frontend pointers
were aspirational; the live HITL session flow is currently exposed
via the runs hooks (`useCreateRun`, `useRun`, etc.) which were
already covered by the previous extraction-services run.
