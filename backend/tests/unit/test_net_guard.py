"""Unit tests for the SSRF guard (``app/core/net_guard.py``).

No real DNS anywhere: an autouse fixture replaces the RUNNING LOOP's
``getaddrinfo`` (the resolver ``validate_endpoint_url`` awaits) with a
stub that fails the test; tests that need resolution patch their own
fake resolver on top. Resolution is awaited, never called on the loop
thread — a blackholed NS must not freeze the whole event loop.

Network behavior of ``guarded_json_request`` is exercised through
``httpx.MockTransport`` via the private ``transport`` test seam.
"""

import asyncio
import socket
import ssl

import httpx
import pytest

import app.core.net_guard as net_guard
from app.core.config import settings
from app.core.net_guard import (
    EndpointUrlError,
    VettedUrl,
    guarded_json_request,
    validate_endpoint_url,
)

PUBLIC_IP = "93.184.216.34"
PUBLIC_IP6 = "2606:2800:220:1:248:1893:25c8:1946"


def _fake_getaddrinfo(mapping: dict[str, list[str]]):
    """Return an async getaddrinfo stub resolving only ``mapping``'s hosts."""

    async def fake(host, port, *_args, **_kwargs):
        if host not in mapping:
            raise AssertionError(f"unexpected DNS lookup for {host!r}")
        results = []
        for ip in mapping[host]:
            if ":" in ip:
                results.append((socket.AF_INET6, socket.SOCK_STREAM, 6, "", (ip, port, 0, 0)))
            else:
                results.append((socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port)))
        return results

    return fake


def _patch_dns(monkeypatch, resolver) -> None:
    """Swap the running loop's resolver — the seam the guard awaits."""
    monkeypatch.setattr(asyncio.get_running_loop(), "getaddrinfo", resolver)


@pytest.fixture(autouse=True)
async def _no_real_dns(monkeypatch):
    """Fail loudly if anything under test reaches the real resolver."""

    async def _forbidden(host, *_args, **_kwargs):  # pragma: no cover - defense
        raise AssertionError(f"real DNS lookup attempted for {host!r}")

    _patch_dns(monkeypatch, _forbidden)


def _vetted_public(addresses: tuple[str, ...] = (PUBLIC_IP,)) -> VettedUrl:
    return VettedUrl(
        url="https://api.example.com/v1",
        host="api.example.com",
        port=443,
        addresses=addresses,
    )


# ---------------------------------------------------------------------------
# validate_endpoint_url
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "url",
    [
        "http://localhost:11434/v1",
        "https://127.0.0.1/v1",
        "https://10.0.0.5/v1",
        "https://172.16.0.9/v1",
        "https://192.168.1.2/v1",
        "https://169.254.169.254/v1",
        "https://100.64.0.1/v1",
        "https://[fc00::1]/v1",
        "https://[::1]/v1",
        "https://[::ffff:10.0.0.5]/v1",
        "https://0.0.0.0/v1",
        "https://user:pw@api.example.com/v1",
        "https://api.example.com/v1?x=1",
    ],
)
async def test_guard_rejects(url, monkeypatch):
    monkeypatch.setattr(settings, "ALLOW_PRIVATE_LLM_ENDPOINTS", False)
    with pytest.raises(EndpointUrlError) as exc:
        await validate_endpoint_url(url)
    # Sanitized contract: "<reason-class>: <host>" or bare reason class —
    # never raw resolver/OS error prose.
    message = str(exc.value)
    reason = message.split(":", 1)[0]
    assert reason == reason.strip() and reason.replace("_", "").isalpha()


async def test_guard_rejects_public_name_resolving_private(monkeypatch):
    _patch_dns(monkeypatch, _fake_getaddrinfo({"api.example.com": ["10.0.0.5"]}))
    with pytest.raises(EndpointUrlError) as exc:
        await validate_endpoint_url("https://api.example.com/v1")
    assert "private_address" in str(exc.value)
    assert "api.example.com" in str(exc.value)


async def test_guard_accepts_public(monkeypatch):
    _patch_dns(monkeypatch, _fake_getaddrinfo({"api.example.com": [PUBLIC_IP]}))
    vetted = await validate_endpoint_url("https://API.example.com/v1/")
    assert vetted.url == "https://api.example.com/v1"  # lowercased, no trailing /
    assert vetted.host == "api.example.com"
    assert vetted.port == 443
    assert vetted.addresses == (PUBLIC_IP,)


async def test_local_flag_allows_localhost_http(monkeypatch):
    monkeypatch.setattr(settings, "ALLOW_PRIVATE_LLM_ENDPOINTS", True)
    monkeypatch.setattr(settings, "SUPABASE_ENV", "local")
    _patch_dns(monkeypatch, _fake_getaddrinfo({"localhost": ["127.0.0.1"]}))
    vetted = await validate_endpoint_url("http://localhost:11434/v1")
    assert vetted.host == "localhost"
    assert vetted.port == 11434
    assert vetted.addresses == ("127.0.0.1",)


async def test_flag_is_inert_outside_local_env(monkeypatch):
    monkeypatch.setattr(settings, "ALLOW_PRIVATE_LLM_ENDPOINTS", True)
    monkeypatch.setattr(settings, "SUPABASE_ENV", "production")
    with pytest.raises(EndpointUrlError):
        await validate_endpoint_url("http://localhost:11434/v1")


async def test_resolution_is_awaited_not_run_on_the_loop_thread(monkeypatch):
    """The resolver seam is the LOOP's ``getaddrinfo`` (awaited), never the
    blocking ``socket.getaddrinfo`` — a hostile NS must not freeze uvicorn."""

    def _blocking(*_args, **_kwargs):  # pragma: no cover - defense
        raise AssertionError("blocking socket.getaddrinfo was called")

    monkeypatch.setattr(socket, "getaddrinfo", _blocking)
    _patch_dns(monkeypatch, _fake_getaddrinfo({"api.example.com": [PUBLIC_IP]}))
    vetted = await validate_endpoint_url("https://api.example.com/v1")
    assert vetted.addresses == (PUBLIC_IP,)


async def test_resolution_timeout_is_unreachable(monkeypatch):
    """A blackholed NS is bounded: the resolution cannot outlive the deadline."""

    async def _never_answers(*_args, **_kwargs):
        await asyncio.sleep(30)
        raise AssertionError("should have timed out")  # pragma: no cover

    monkeypatch.setattr(net_guard, "_DNS_TIMEOUT_S", 0.01)
    _patch_dns(monkeypatch, _never_answers)
    with pytest.raises(EndpointUrlError) as exc:
        await validate_endpoint_url("https://slow.example.com/v1")
    assert str(exc.value) == "unreachable: slow.example.com"


# ---------------------------------------------------------------------------
# guarded_json_request
# ---------------------------------------------------------------------------


async def test_request_never_follows_redirect():
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(302, headers={"location": "https://evil.example/"})

    status, body = await guarded_json_request(
        "GET", _vetted_public(), "/models", transport=httpx.MockTransport(handler)
    )
    assert status == 302
    assert len(calls) == 1  # the redirect was returned, never followed


async def test_request_truncates_at_max_bytes():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"x" * 4096)

    with pytest.raises(EndpointUrlError) as exc:
        await guarded_json_request(
            "GET",
            _vetted_public(),
            "/models",
            max_bytes=1024,
            transport=httpx.MockTransport(handler),
        )
    assert str(exc.value) == "response_too_large: api.example.com"


async def test_request_connects_to_pinned_ip():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"ok": True})

    status, body = await guarded_json_request(
        "GET", _vetted_public(), "/models", transport=httpx.MockTransport(handler)
    )
    assert status == 200
    assert body == {"ok": True}
    request = seen[0]
    # Connection pinned to the vetted IP...
    assert request.url.host == PUBLIC_IP
    # ...while Host header and SNI still carry the hostname (TLS verifies
    # against the hostname; verify=True is load-bearing).
    assert request.headers["host"] == "api.example.com"
    assert request.extensions.get("sni_hostname") == "api.example.com"


async def test_request_network_failures_are_one_opaque_class():
    def connect_error(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused to 10.0.0.5 port 11434")

    def tls_error(_request: httpx.Request) -> httpx.Response:
        raise ssl.SSLCertVerificationError("certificate verify failed: self-signed certificate")

    messages = []
    for handler in (connect_error, tls_error):
        with pytest.raises(EndpointUrlError) as exc:
            await guarded_json_request(
                "GET",
                _vetted_public(),
                "/models",
                transport=httpx.MockTransport(handler),
            )
        messages.append(str(exc.value))
    # One opaque class — no port-scan / TLS oracle.
    assert messages == ["unreachable: api.example.com"] * 2
    assert all("refused" not in m and "certificate" not in m for m in messages)


async def test_request_non_http_error_is_also_the_opaque_class():
    """``httpx.InvalidURL`` is NOT an ``HTTPError`` — the one-opaque-class
    contract must hold for every non-``EndpointUrlError`` escape."""

    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.InvalidURL("malformed host 'llm.lab.internal:0'")

    with pytest.raises(EndpointUrlError) as exc:
        await guarded_json_request(
            "GET", _vetted_public(), "/models", transport=httpx.MockTransport(handler)
        )
    assert str(exc.value) == "unreachable: api.example.com"
    assert "malformed" not in str(exc.value)


async def test_request_overall_deadline_is_unreachable():
    """A byte-dripping endpoint cannot outlive ``timeout_s`` — httpx's read
    timeout resets per byte, so the whole exchange carries its own deadline."""

    async def handler(_request: httpx.Request) -> httpx.Response:
        await asyncio.sleep(30)
        return httpx.Response(200, json={})  # pragma: no cover

    with pytest.raises(EndpointUrlError) as exc:
        await guarded_json_request(
            "GET",
            _vetted_public(),
            "/models",
            timeout_s=0.05,
            transport=httpx.MockTransport(handler),
        )
    assert str(exc.value) == "unreachable: api.example.com"


async def test_request_fails_over_to_the_next_vetted_address():
    """Dual-stack: an AAAA-first host with no v6 egress must still reach the
    v4 address — every vetted address is tried before ``unreachable``."""
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.host)
        if request.url.host == PUBLIC_IP6:
            raise httpx.ConnectError("network is unreachable")
        return httpx.Response(200, json={"ok": True})

    status, body = await guarded_json_request(
        "GET",
        _vetted_public(addresses=(PUBLIC_IP6, PUBLIC_IP)),
        "/models",
        transport=httpx.MockTransport(handler),
    )
    assert status == 200
    assert body == {"ok": True}
    assert seen == [PUBLIC_IP6, PUBLIC_IP]


async def test_request_all_addresses_failing_is_unreachable():
    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("network is unreachable")

    with pytest.raises(EndpointUrlError) as exc:
        await guarded_json_request(
            "GET",
            _vetted_public(addresses=(PUBLIC_IP6, PUBLIC_IP)),
            "/models",
            transport=httpx.MockTransport(handler),
        )
    assert str(exc.value) == "unreachable: api.example.com"


async def test_request_oversized_body_never_fails_over():
    """A PROTOCOL-level refusal is the endpoint's answer, not a dead route:
    it must surface as itself, from the first address."""
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.host)
        return httpx.Response(200, content=b"x" * 4096)

    with pytest.raises(EndpointUrlError) as exc:
        await guarded_json_request(
            "GET",
            _vetted_public(addresses=(PUBLIC_IP6, PUBLIC_IP)),
            "/models",
            max_bytes=1024,
            transport=httpx.MockTransport(handler),
        )
    assert str(exc.value) == "response_too_large: api.example.com"
    assert seen == [PUBLIC_IP6]


async def test_request_non_json_body_is_sanitized_error():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"<html>upstream oops</html>")

    with pytest.raises(EndpointUrlError) as exc:
        await guarded_json_request(
            "GET", _vetted_public(), "/models", transport=httpx.MockTransport(handler)
        )
    assert str(exc.value) == "invalid_json: api.example.com"
    assert "<html" not in str(exc.value)


async def test_request_happy_path_returns_status_and_parsed_json():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": [{"id": "m1"}]})

    status, body = await guarded_json_request(
        "GET", _vetted_public(), "/models", transport=httpx.MockTransport(handler)
    )
    assert status == 200
    assert body == {"data": [{"id": "m1"}]}


async def test_no_client_is_built_with_verify_false(monkeypatch):
    recorded: dict = {}
    real_init = httpx.AsyncClient.__init__

    def spy_init(self, *args, **kwargs):
        recorded.update(kwargs)
        real_init(self, *args, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "__init__", spy_init)

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={})

    await guarded_json_request(
        "GET", _vetted_public(), "/models", transport=httpx.MockTransport(handler)
    )
    assert recorded, "spy never saw an AsyncClient being built"
    assert recorded.get("verify", True) is not False
    # Every phase is bounded explicitly — a bare float would leave the
    # overall exchange unbounded once the read timeout resets per byte.
    assert isinstance(recorded.get("timeout"), httpx.Timeout)
