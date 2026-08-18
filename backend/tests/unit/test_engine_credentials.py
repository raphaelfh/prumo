"""B9 — the ONE engine-credentials resolver.

Every LLM call site resolves (api_key, key_scope, base_url, endpoint_id)
here, so an endpoint engine can never run on a cloud key and a cloud
engine can never inherit a stale base_url. The two collaborators are
patched in the RESOLVER's namespace (``LlmEndpointService`` /
``APIKeyService``) — the seam every caller shares.

The endpoint branch NEVER falls back to the cloud path: an endpoint the
project no longer has (deleted, or a cross-project id riding a pinned
snapshot) is the typed ``EndpointUnavailableError``, not somebody else's
key.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest

import app.services.engine_credentials as ec
from app.schemas.llm_target import LlmTarget
from app.services.api_key_service import KeyScope, ResolvedKey
from app.services.engine_credentials import (
    EngineCredentials,
    rekey_for_adopted_engine,
    resolve_engine_credentials,
)
from app.services.llm_endpoint_service import EndpointNotFoundError, EndpointUnavailableError

_PROJECT = UUID("11111111-1111-1111-1111-111111111111")
_USER = "22222222-2222-2222-2222-222222222222"
_KEY = "sk-endpoint-secret-material"


def _endpoint_row(base_url: str = "https://llm.lab.example.com/v1") -> MagicMock:
    row = MagicMock()
    row.base_url = base_url
    return row


def _stub_endpoint_service(
    monkeypatch: pytest.MonkeyPatch,
    *,
    row: Any = None,
    get_error: Exception | None = None,
    key: str | None = _KEY,
    decrypt_error: Exception | None = None,
) -> dict[str, Any]:
    """Patch the resolver's ``LlmEndpointService`` seam; return the call log."""
    log: dict[str, Any] = {}

    class _Service:
        def __init__(self, db: Any) -> None:
            log["db"] = db

        async def get(self, project_id: UUID, endpoint_id: UUID) -> Any:
            log["get"] = (project_id, endpoint_id)
            if get_error is not None:
                raise get_error
            return row

        async def decrypt_key(self, endpoint: Any) -> str | None:
            log["decrypted"] = endpoint
            if decrypt_error is not None:
                raise decrypt_error
            return key

    monkeypatch.setattr(ec, "LlmEndpointService", _Service)
    return log


def _stub_key_service(
    monkeypatch: pytest.MonkeyPatch,
    resolved: ResolvedKey | None,
) -> list[Any]:
    """Patch the resolver's ``APIKeyService`` seam; return the ask log."""
    asked: list[Any] = []

    class _Keys:
        def __init__(self, _db: Any, user_id: Any) -> None:
            asked.append(("init", user_id))

        async def get_key_for_provider(self, provider: str) -> ResolvedKey | None:
            asked.append(("ask", provider))
            return resolved

    monkeypatch.setattr(ec, "APIKeyService", _Keys)
    return asked


@pytest.mark.asyncio
async def test_endpoint_engine_resolves_key_scope_url_and_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The endpoint branch returns all four fields together — the key, the
    SHARED_ENDPOINT scope, the row's base_url and the identity it was
    resolved FOR — and never touches the cloud key path."""
    endpoint_id = uuid4()
    log = _stub_endpoint_service(monkeypatch, row=_endpoint_row())
    asked = _stub_key_service(monkeypatch, ResolvedKey("sk-cloud", KeyScope.USER_BYOK))

    creds = await resolve_engine_credentials(
        MagicMock(),
        user_id=_USER,
        project_id=_PROJECT,
        engine=LlmTarget(
            provider="openai_compatible", model="llama3", endpoint_id=str(endpoint_id)
        ),
    )

    assert creds == EngineCredentials(
        api_key=_KEY,
        key_scope=KeyScope.SHARED_ENDPOINT,
        base_url="https://llm.lab.example.com/v1",
        endpoint_id=str(endpoint_id),
    )
    # Project-scoped fetch: a cross-project id in a pinned snapshot must be a
    # miss, never another project's key (BOLA gate).
    assert log["get"] == (_PROJECT, endpoint_id)
    assert asked == [], f"the endpoint branch reached the cloud key path: {asked}"


@pytest.mark.asyncio
async def test_keyless_endpoint_resolves_to_no_key_but_keeps_the_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A keyless endpoint (local Ollama) is legal: ``api_key`` is None and
    ``build_model``'s ``no-key-required`` placeholder covers it — the
    base_url still has to travel."""
    _stub_endpoint_service(
        monkeypatch, row=_endpoint_row("https://ollama.lab.example.com/v1"), key=None
    )
    _stub_key_service(monkeypatch, None)

    creds = await resolve_engine_credentials(
        MagicMock(),
        user_id=_USER,
        project_id=_PROJECT,
        engine=LlmTarget(provider="openai_compatible", model="llama3", endpoint_id=str(uuid4())),
    )

    assert creds.api_key is None
    assert creds.key_scope is KeyScope.SHARED_ENDPOINT
    assert creds.base_url == "https://ollama.lab.example.com/v1"


@pytest.mark.asyncio
async def test_missing_endpoint_is_the_typed_error_never_a_cloud_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Deleted endpoint (or a cross-project id): typed 409, and the cloud
    key path is NEVER consulted — a silent fallback would bill a stranger's
    key and run a different engine than the run is pinned to."""
    endpoint_id = uuid4()
    _stub_endpoint_service(monkeypatch, get_error=EndpointNotFoundError("gone"))
    asked = _stub_key_service(monkeypatch, ResolvedKey("sk-cloud", KeyScope.GLOBAL_SERVICE))

    with pytest.raises(EndpointUnavailableError) as excinfo:
        await resolve_engine_credentials(
            MagicMock(),
            user_id=_USER,
            project_id=_PROJECT,
            engine=LlmTarget(
                provider="openai_compatible", model="llama3", endpoint_id=str(endpoint_id)
            ),
        )

    assert excinfo.value.code == "LLM_ENDPOINT_UNAVAILABLE"
    assert asked == [], f"a missing endpoint fell back to a cloud key: {asked}"


@pytest.mark.asyncio
async def test_undecryptable_endpoint_key_propagates_the_typed_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``decrypt_key`` already maps ``InvalidToken`` to the typed error (B4);
    the resolver must not swallow it into a keyless run."""
    _stub_endpoint_service(
        monkeypatch,
        row=_endpoint_row(),
        decrypt_error=EndpointUnavailableError("cannot be decrypted"),
    )
    asked = _stub_key_service(monkeypatch, ResolvedKey("sk-cloud", KeyScope.GLOBAL_SERVICE))

    with pytest.raises(EndpointUnavailableError):
        await resolve_engine_credentials(
            MagicMock(),
            user_id=_USER,
            project_id=_PROJECT,
            engine=LlmTarget(
                provider="openai_compatible", model="llama3", endpoint_id=str(uuid4())
            ),
        )
    assert asked == []


@pytest.mark.asyncio
async def test_catalog_engine_passes_through_to_the_api_key_service(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No ``endpoint_id`` → exactly today's BYOK-then-global lookup, with no
    base_url and no endpoint identity."""
    _stub_endpoint_service(monkeypatch, row=_endpoint_row())
    asked = _stub_key_service(monkeypatch, ResolvedKey("sk-cloud", KeyScope.USER_BYOK))

    creds = await resolve_engine_credentials(
        MagicMock(),
        user_id=_USER,
        project_id=_PROJECT,
        engine=LlmTarget(provider="anthropic", model="claude-sonnet-5"),
    )

    assert creds == EngineCredentials(
        api_key="sk-cloud",
        key_scope=KeyScope.USER_BYOK,
        base_url=None,
        endpoint_id=None,
    )
    assert asked == [("init", _USER), ("ask", "anthropic")]


@pytest.mark.asyncio
async def test_catalog_engine_with_no_key_anywhere_resolves_to_all_none(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Nothing stored: no key and no scope — ``build_model``'s global
    fallback stays the last resort, and no scope is invented."""
    _stub_key_service(monkeypatch, None)

    creds = await resolve_engine_credentials(
        MagicMock(),
        user_id=_USER,
        project_id=_PROJECT,
        engine=LlmTarget(provider="openai", model="gpt-4o-mini"),
    )

    assert creds == EngineCredentials(api_key=None, key_scope=None, base_url=None, endpoint_id=None)


def test_repr_never_carries_the_key() -> None:
    """§5.2: the key is never logged. These objects ride in service
    attributes that land in tracebacks and debug logs, so the default
    dataclass repr (which prints every field) is not acceptable."""
    creds = EngineCredentials(
        api_key=_KEY,
        key_scope=KeyScope.SHARED_ENDPOINT,
        base_url="https://llm.lab.example.com/v1",
        endpoint_id="0b8f3d3e-8a54-4c1e-9d8e-1f2a3b4c5d6e",
    )

    for rendered in (repr(creds), str(creds), f"{creds}", repr([creds])):
        assert _KEY not in rendered, f"the key leaked into {rendered!r}"
    assert "redacted" in repr(creds)
    # The safe half must still be debuggable.
    assert "shared_endpoint" in repr(creds)
    assert "https://llm.lab.example.com/v1" in repr(creds)
    assert "0b8f3d3e-8a54-4c1e-9d8e-1f2a3b4c5d6e" in repr(creds)
    assert "api_key=None" in repr(EngineCredentials(None, None, None, None))


@pytest.mark.asyncio
async def test_malformed_endpoint_id_is_the_typed_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A pinned snapshot carries the endpoint id as a plain JSON string, so a
    hand-edited/corrupt one reaches here — typed 409, never a raw 500."""
    _stub_endpoint_service(monkeypatch, row=_endpoint_row())
    asked = _stub_key_service(monkeypatch, ResolvedKey("sk-cloud", KeyScope.GLOBAL_SERVICE))

    with pytest.raises(EndpointUnavailableError):
        await resolve_engine_credentials(
            MagicMock(),
            user_id=_USER,
            project_id=_PROJECT,
            engine=LlmTarget(
                provider="openai_compatible", model="llama3", endpoint_id="not-a-uuid"
            ),
        )
    assert asked == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("keyed_for", "current_endpoint", "engine_endpoint"),
    [
        pytest.param(None, None, "e1", id="no-declared-identity"),
        pytest.param("openai", None, None, id="same-catalog-engine"),
        pytest.param("openai_compatible", "e1", "e1", id="same-endpoint"),
    ],
)
async def test_rekey_returns_none_when_the_identity_still_fits(
    monkeypatch: pytest.MonkeyPatch,
    keyed_for: str | None,
    current_endpoint: str | None,
    engine_endpoint: str | None,
) -> None:
    """No re-resolution when the settled engine is the one the credentials
    were resolved for — and never for a caller that declared no identity."""
    asked = _stub_key_service(monkeypatch, ResolvedKey("sk-cloud", KeyScope.USER_BYOK))
    _stub_endpoint_service(monkeypatch, row=_endpoint_row())

    rekeyed = await rekey_for_adopted_engine(
        MagicMock(),
        user_id=_USER,
        project_id=_PROJECT,
        engine=LlmTarget(provider=keyed_for or "openai", model="m", endpoint_id=engine_endpoint),
        current=EngineCredentials(None, None, None, current_endpoint),
        keyed_for=keyed_for,
    )

    assert rekeyed is None
    assert asked == []


@pytest.mark.asyncio
async def test_rekey_fires_for_two_endpoints_sharing_one_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """THE blocking case: both engines say ``openai_compatible``, so only the
    endpoint half of the identity can tell them apart — provider equality
    alone would run endpoint B's pin on endpoint A's key and host."""
    _stub_endpoint_service(monkeypatch, row=_endpoint_row("https://b.example.com/v1"), key="key-b")
    endpoint_a, endpoint_b = str(uuid4()), str(uuid4())

    rekeyed = await rekey_for_adopted_engine(
        MagicMock(),
        user_id=_USER,
        project_id=_PROJECT,
        engine=LlmTarget(provider="openai_compatible", model="m", endpoint_id=endpoint_b),
        current=EngineCredentials(
            "key-a", KeyScope.SHARED_ENDPOINT, "https://a.example.com/v1", endpoint_a
        ),
        keyed_for="openai_compatible",
    )

    assert rekeyed == EngineCredentials(
        api_key="key-b",
        key_scope=KeyScope.SHARED_ENDPOINT,
        base_url="https://b.example.com/v1",
        endpoint_id=endpoint_b,
    )


@pytest.mark.asyncio
async def test_user_id_may_be_a_uuid_object(monkeypatch: pytest.MonkeyPatch) -> None:
    """The worker holds a str, the services a UUID — both reach the same
    ``APIKeyService`` unchanged."""
    asked = _stub_key_service(monkeypatch, None)
    user = uuid4()

    await resolve_engine_credentials(
        AsyncMock(),
        user_id=user,
        project_id=_PROJECT,
        engine=LlmTarget(provider="openai", model="gpt-4o-mini"),
    )

    assert asked[0] == ("init", user)
