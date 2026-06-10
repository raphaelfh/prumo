# FastAPI patterns for prumo

Deep-dive on patterns that show up repeatedly under `backend/app/api/`. See SKILL.md for the endpoint shape baseline.

## Lifespan, not on_event

`backend/app/main.py` uses the async lifespan context manager. Old `@app.on_event("startup")` is deprecated since FastAPI 0.93 and removed from new code.

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    # startup
    configure_logging()
    check_pending_migrations()
    yield
    # shutdown — flush metrics, close pools (engine.dispose() happens via deps)

app = FastAPI(lifespan=lifespan, title=settings.PROJECT_NAME)
```

Heavy startup work (loading JWKS, warming caches) belongs here. Do not put it at module import time — it breaks tests and Vercel cold-start budgets.

## Annotated dependencies

Prefer `Annotated[T, Depends(...)]` over bare `Depends(...)`. It plays nicely with type checkers and lets you alias common dependencies.

```python
from typing import Annotated
from app.core.deps import DbSession        # Annotated[AsyncSession, Depends(get_db)]
from app.core.security import CurrentUser  # Annotated[TokenPayload, Depends(get_current_user)]

async def endpoint(
    body: SomeRequest,
    db: DbSession,
    user: CurrentUser,
) -> ApiResponse[SomeResponse]: ...
```

If a dependency needs parameters (e.g. a project-scoped check), keep it as a free async function called from the body — see `ensure_project_member` in `app/api/deps/security.py`. FastAPI dependencies can't take a body-derived path arg cleanly, so manual call-after-resolution is the pragmatic move.

## Response envelope

All write endpoints return `ApiResponse[T]` from `app/schemas/common.py` for client-side uniformity. Read endpoints can return the DTO directly when high-traffic. Don't mix conventions within a single router.

```python
return ApiResponse(data=OpenHITLSessionResponse.model_validate(result, from_attributes=True))
```

## Status codes that aren't 200/201

| Code | When |
|---|---|
| 201 | Resource created (default for POST `/sessions`) |
| 200 | Idempotent POST that resumed an existing resource — override via `response.status_code = 200` |
| 202 | Accepted (queued Celery task) — body returns the run/job id so the client can poll |
| 204 | Successful DELETE with no body |
| 207 | Multi-status (bulk endpoints — rare here) |

For 200-vs-201 in idempotent POSTs, see `endpoints/hitl_sessions.py` for the canonical override pattern.

## Error handlers

Register once in `register_exception_handlers` (`app/core/error_handler.py`). Domain exceptions get translated to `HTTPException` with structured detail. The translation lives at the boundary, never deep inside services.

```python
@app.exception_handler(HITLSessionInputError)
async def hitl_input_error_handler(_: Request, exc: HITLSessionInputError):
    return JSONResponse(status_code=400, content={"detail": str(exc)})
```

Validation errors from Pydantic are intercepted by `RequestValidationError`. Customize the response shape there if the frontend needs a specific format — keep it stable across versions.

## Rate limiting

SlowAPI middleware is wired in `app/utils/rate_limiter.py`. Decorate sensitive endpoints (auth, AI extraction triggers, export jobs) with `@limiter.limit("...")`. Per-IP by default; switch to per-user via `key_func=lambda r: r.state.user.sub` for authenticated endpoints.

## Streaming responses

For long-running work that needs to push progress, prefer SSE over WebSockets — easier to proxy through Vercel and survives reconnects.

```python
from fastapi.responses import StreamingResponse

async def stream():
    async for event in service.iter_progress(run_id):
        yield f"event: progress\ndata: {event.model_dump_json()}\n\n"

return StreamingResponse(stream(), media_type="text/event-stream")
```

Set `X-Accel-Buffering: no` if you ever sit behind nginx. Vercel handles SSE natively but caps response time at 300s on the Pro plan — for jobs longer than that, queue to Celery and poll instead.

## Routers

One router per endpoint module. Aggregate in `app/api/v1/router.py`:

```python
api_router = APIRouter(prefix="/api/v1")
api_router.include_router(hitl_sessions.router, prefix="/hitl", tags=["hitl"])
```

Tags map to OpenAPI groups in the docs.

## Dependency overrides in tests

```python
@pytest.fixture
async def client(test_db_session):
    app.dependency_overrides[get_db] = lambda: test_db_session
    app.dependency_overrides[get_current_user_sub] = lambda: TEST_USER_ID
    async with AsyncClient(app=app, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()
```

Override only what the test needs. Resetting `dependency_overrides` between tests prevents bleed.

## CORS and middleware

Configured in `app/core/middleware.py`. Add new middleware *after* `CORSMiddleware` but *before* request-context middleware (rate limiter, structlog binding) so error responses still get the CORS headers.

## Not used here (out of scope)

- Strawberry/Ariadne GraphQL — REST only.
- gRPC — not used.
- WebSockets — exists for one or two surfaces but SSE preferred. If you must, isolate them in their own router with their own lifespan-bound connection registry.
