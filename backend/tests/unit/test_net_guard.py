"""Unit tests for the SSRF guard (``app/core/net_guard.py``).

No real DNS anywhere: an autouse fixture makes any unexpected
``socket.getaddrinfo`` call fail the test; tests that need resolution
monkeypatch their own fake resolver on top.

Network behavior of ``guarded_json_request`` is exercised through
``httpx.MockTransport`` via the private ``transport`` test seam.
"""

import socket
import ssl

import httpx
import pytest

from app.core.config import settings
from app.core.net_guard import (
    EndpointUrlError,
    VettedUrl,
    guarded_json_request,
    validate_endpoint_url,
)

PUBLIC_IP = "93.184.216.34"


def _fake_getaddrinfo(mapping: dict[str, list[str]]):
    """Return a getaddrinfo stub resolving only the hosts in ``mapping``."""

    def fake(host, port, *_args, **_kwargs):
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


@pytest.fixture(autouse=True)
def _no_real_dns(monkeypatch):
    """Fail loudly if anything under test reaches the real resolver."""

    def _forbidden(host, *_args, **_kwargs):  # pragma: no cover - defense
        raise AssertionError(f"real DNS lookup attempted for {host!r}")

    monkeypatch.setattr(socket, "getaddrinfo", _forbidden)


def _vetted_public() -> VettedUrl:
    return VettedUrl(
        url="https://api.example.com/v1",
        host="api.example.com",
        port=443,
        addresses=(PUBLIC_IP,),
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
def test_guard_rejects(url, monkeypatch):
    monkeypatch.setattr(settings, "ALLOW_PRIVATE_LLM_ENDPOINTS", False)
    with pytest.raises(EndpointUrlError) as exc:
        validate_endpoint_url(url)
    # Sanitized contract: "<reason-class>: <host>" or bare reason class —
    # never raw resolver/OS error prose.
    message = str(exc.value)
    reason = message.split(":", 1)[0]
    assert reason == reason.strip() and reason.replace("_", "").isalpha()


def test_guard_rejects_public_name_resolving_private(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", _fake_getaddrinfo({"api.example.com": ["10.0.0.5"]}))
    with pytest.raises(EndpointUrlError) as exc:
        validate_endpoint_url("https://api.example.com/v1")
    assert "private_address" in str(exc.value)
    assert "api.example.com" in str(exc.value)


def test_guard_accepts_public(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", _fake_getaddrinfo({"api.example.com": [PUBLIC_IP]}))
    vetted = validate_endpoint_url("https://API.example.com/v1/")
    assert vetted.url == "https://api.example.com/v1"  # lowercased, no trailing /
    assert vetted.host == "api.example.com"
    assert vetted.port == 443
    assert vetted.addresses == (PUBLIC_IP,)


def test_local_flag_allows_localhost_http(monkeypatch):
    monkeypatch.setattr(settings, "ALLOW_PRIVATE_LLM_ENDPOINTS", True)
    monkeypatch.setattr(settings, "SUPABASE_ENV", "local")
    monkeypatch.setattr(socket, "getaddrinfo", _fake_getaddrinfo({"localhost": ["127.0.0.1"]}))
    vetted = validate_endpoint_url("http://localhost:11434/v1")
    assert vetted.host == "localhost"
    assert vetted.port == 11434
    assert vetted.addresses == ("127.0.0.1",)


def test_flag_is_inert_outside_local_env(monkeypatch):
    monkeypatch.setattr(settings, "ALLOW_PRIVATE_LLM_ENDPOINTS", True)
    monkeypatch.setattr(settings, "SUPABASE_ENV", "production")
    with pytest.raises(EndpointUrlError):
        validate_endpoint_url("http://localhost:11434/v1")


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
