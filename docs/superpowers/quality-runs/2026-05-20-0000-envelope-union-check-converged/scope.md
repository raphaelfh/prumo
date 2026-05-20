# Scope

**Run ID**: 2026-05-20-0000-envelope-union-check
**Status**: converged
**Scope**: `scripts/fitness/check_api_response_envelope.py` (extend AST matcher)

## Why this scope

Run 2026-05-19-2310 closed 9/10 envelope violations but left
`articles_export.py:start_export` baselined because its return type is
`Response | ApiResponse[ExportStartedResponse]` — a legitimate PEP 604
Union where one arm is the streaming binary `Response` and the other is
the envelope. The AST matcher only accepted plain `ApiResponse[T]` and
rightly rejected the Union form.

This run extends the matcher to recognise:
- `ApiResponse[T]` (existing)
- `X | ApiResponse[T]` (PEP 604 union, recursive)
- `Union[X, ApiResponse[T]]` (legacy typing.Union)
- `Optional[ApiResponse[T]]` (== `ApiResponse[T] | None`)

After the change, articles_export.py is accepted automatically and the
baseline becomes empty.
