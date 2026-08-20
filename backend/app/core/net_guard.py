"""SSRF guard for custom LLM endpoints.

Vets a user-supplied endpoint URL (``validate_endpoint_url``) and performs
outbound JSON requests pinned to the vetted addresses
(``guarded_json_request``).

Security posture:

- ``https`` only; plain ``http`` and private/loopback ranges are allowed
  ONLY under the local escape hatch (``ALLOW_PRIVATE_LLM_ENDPOINTS=True``
  AND ``settings.supabase_env == "local"`` — the flag is inert everywhere
  else, in code, not by convention).
- Every resolved address (both families) must be public: private,
  loopback, link-local, multicast, unspecified, reserved, CGNAT
  (100.64.0.0/10), ULA (fc00::/7), and the IPv4-mapped IPv6 form are all
  rejected via the ``ipaddress`` module.
- DNS-rebinding mitigation: ``guarded_json_request`` connects to a vetted
  IP captured at validation time — the request URL carries the IP while
  the original ``Host`` header and the httpx ``sni_hostname`` extension
  keep TLS verifying against the hostname. ``verify=True`` (the httpx
  default) is LOAD-BEARING for this posture: never build a client here
  with ``verify=False``, or the pin silently stops proving anything.
- Redirects are never followed; responses are streamed and truncated at
  ``max_bytes``; all network-level failures collapse to the single opaque
  ``unreachable`` reason class so the guard cannot be used as a
  port-scan/TLS oracle. Errors never carry raw resolver/OS/library text.

Everything here is BOUNDED and non-blocking, because both entry points
run on the request event loop:

- resolution is awaited on the loop's own resolver (never the blocking
  ``socket.getaddrinfo``) under ``_DNS_TIMEOUT_S``, so a blackholed NS
  cannot freeze the whole uvicorn worker;
- one exchange carries an OVERALL ``asyncio.timeout(timeout_s)`` on top
  of the per-phase ``httpx.Timeout`` — httpx's read timeout resets on
  every byte, so a drip-feeding endpoint would otherwise stream forever.

Known remaining limitation (plan decision 4): at extraction time the
OpenAI SDK resolves DNS itself, so a rebinding between our probe and the
SDK call is not covered here — the SaaS self-hosted perimeter (spec §10)
is the answer for that window.
"""

import asyncio
import ipaddress
import json
import socket
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

import httpx

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

_CGNAT_V4 = ipaddress.ip_network("100.64.0.0/10")
_ULA_V6 = ipaddress.ip_network("fc00::/7")

_DEFAULT_PORTS = {"https": 443, "http": 80}

#: Ceiling for ONE name resolution. A hostile or blackholed nameserver
#: must not pin the caller (nor, past the deadline, keep us waiting on
#: the executor thread the loop resolver uses).
_DNS_TIMEOUT_S = 5.0


class EndpointUrlError(ValueError):
    """Sanitized endpoint error: ``<reason-class>: <host>`` or bare reason.

    Never carries raw resolver/OS/library error text.
    """


@dataclass(frozen=True)
class VettedUrl:
    """A validated endpoint URL plus the addresses it vetted against."""

    url: str  # normalized: scheme/host lowercase, no trailing /, no query
    host: str
    port: int
    addresses: tuple[str, ...]  # every resolved, vetted IP


def _private_ranges_allowed() -> bool:
    """The escape hatch is honored ONLY in the local environment."""
    return settings.ALLOW_PRIVATE_LLM_ENDPOINTS and settings.supabase_env == "local"


def _is_blocked_v4(ip: ipaddress.IPv4Address) -> bool:
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_unspecified
        or ip.is_reserved
        or ip in _CGNAT_V4
    )


def _is_blocked_address(raw: str) -> bool:
    ip = ipaddress.ip_address(raw)
    if isinstance(ip, ipaddress.IPv4Address):
        return _is_blocked_v4(ip)
    if (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_unspecified
        or ip.is_reserved
        or ip in _ULA_V6
    ):
        return True
    mapped = ip.ipv4_mapped
    return mapped is not None and _is_blocked_v4(mapped)


async def _resolve_addresses(host: str, port: int) -> tuple[str, ...]:
    """Resolve ``host`` to every address, both families. Literal IPs pass through.

    Awaits the LOOP's resolver (never the blocking ``socket.getaddrinfo``)
    under ``_DNS_TIMEOUT_S``: this runs inside request handlers, and a
    synchronous lookup against a hostile nameserver would freeze the whole
    event loop, not just this call.
    """
    try:
        return (str(ipaddress.ip_address(host)),)
    except ValueError:
        pass
    loop = asyncio.get_running_loop()
    try:
        async with asyncio.timeout(_DNS_TIMEOUT_S):
            infos = await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except TimeoutError:
        # BEFORE the OSError arm on purpose: TimeoutError subclasses it.
        # An answer that never comes is the opaque unreachable class.
        raise EndpointUrlError(f"unreachable: {host}") from None
    except OSError:
        # Sanitized: never surface resolver error text.
        raise EndpointUrlError(f"unresolvable: {host}") from None
    addresses: list[str] = []
    for info in infos:
        address = str(info[4][0])
        if address not in addresses:
            addresses.append(address)
    if not addresses:
        raise EndpointUrlError(f"unresolvable: {host}")
    return tuple(addresses)


async def validate_endpoint_url(raw_url: str) -> VettedUrl:
    """Parse, normalize, resolve, and vet a user-supplied endpoint URL.

    Async because resolution is (see :func:`_resolve_addresses`) — every
    caller runs on the request loop.

    Raises :class:`EndpointUrlError` (sanitized) on any rejection.
    """
    parsed = urlsplit(raw_url.strip())
    scheme = parsed.scheme.lower()
    host = parsed.hostname  # already lowercased by urlsplit
    if not host:
        raise EndpointUrlError("missing_host")

    allow_private = _private_ranges_allowed()
    allowed_schemes = {"https", "http"} if allow_private else {"https"}
    if scheme not in allowed_schemes:
        raise EndpointUrlError(f"unsupported_scheme: {host}")
    if parsed.username is not None or parsed.password is not None:
        raise EndpointUrlError(f"userinfo_not_allowed: {host}")
    if parsed.query:
        raise EndpointUrlError(f"query_not_allowed: {host}")
    if parsed.fragment:
        raise EndpointUrlError(f"fragment_not_allowed: {host}")

    try:
        explicit_port = parsed.port
    except ValueError:
        raise EndpointUrlError(f"invalid_port: {host}") from None
    port = explicit_port if explicit_port is not None else _DEFAULT_PORTS[scheme]

    addresses = await _resolve_addresses(host, port)
    if not allow_private and any(_is_blocked_address(a) for a in addresses):
        raise EndpointUrlError(f"private_address: {host}")

    host_display = f"[{host}]" if ":" in host else host
    port_part = f":{explicit_port}" if explicit_port is not None else ""
    path = parsed.path.rstrip("/")
    normalized = f"{scheme}://{host_display}{port_part}{path}"
    return VettedUrl(url=normalized, host=host, port=port, addresses=addresses)


async def guarded_json_request(
    method: str,
    vetted: VettedUrl,
    path: str,
    *,
    headers: dict[str, str] | None = None,
    json_body: dict[str, Any] | None = None,
    timeout_s: float = 15.0,
    max_bytes: int = 262_144,
    transport: httpx.AsyncBaseTransport | None = None,
) -> tuple[int, Any]:
    """Perform a JSON request pinned to a vetted address.

    Returns ``(status_code, parsed_body)``. A 3xx is returned as its
    status, never followed; the parsed body is ``None`` when a non-2xx
    body is not JSON. Raises :class:`EndpointUrlError` for oversized
    responses (``response_too_large``), non-JSON 2xx bodies
    (``invalid_json``), and every network-level failure (the single
    opaque ``unreachable`` class).

    EVERY vetted address is tried in order, and a network-level failure
    moves to the next one: all of them passed the same vetting, and an
    AAAA-first host on a box with no IPv6 egress would otherwise be
    permanently ``unreachable`` (the local-Ollama case: ``localhost``
    resolves ``::1`` first while the server listens on 127.0.0.1). A
    PROTOCOL-level refusal (too large, invalid JSON) is the endpoint's
    own answer, so it surfaces as itself and never fails over.

    ``timeout_s`` bounds the WHOLE exchange, not just each phase.

    ``transport`` is a private test seam (httpx.MockTransport); never
    pass it in production code.
    """
    scheme = urlsplit(vetted.url).scheme
    base_path = urlsplit(vetted.url).path
    request_path = path if path.startswith("/") else f"/{path}"

    host_header = vetted.host
    if vetted.port != _DEFAULT_PORTS.get(scheme):
        host_header = f"{vetted.host}:{vetted.port}"
    request_headers = {**(headers or {}), "Host": host_header}

    client_kwargs: dict[str, Any] = {
        # Explicit per-phase bounds: a bare float sets the same four, but
        # says nothing about the deadline that actually matters (below).
        "timeout": httpx.Timeout(
            connect=timeout_s, read=timeout_s, write=timeout_s, pool=timeout_s
        ),
        "follow_redirects": False,
    }
    if transport is not None:
        client_kwargs["transport"] = transport

    async def attempt(pinned_ip: str) -> tuple[int, Any]:
        ip_host = f"[{pinned_ip}]" if ":" in pinned_ip else pinned_ip
        url = f"{scheme}://{ip_host}:{vetted.port}{base_path}{request_path}"
        body = bytearray()
        # The OVERALL deadline. httpx's read timeout resets on every byte,
        # so a byte-dripping endpoint would otherwise stream for days.
        async with asyncio.timeout(timeout_s):
            # verify=True (the httpx default) is LOAD-BEARING — see module
            # docstring. Never pass verify=False here.
            async with (
                httpx.AsyncClient(**client_kwargs) as client,
                client.stream(
                    method,
                    url,
                    headers=request_headers,
                    json=json_body,
                    extensions={"sni_hostname": vetted.host},
                ) as response,
            ):
                status = response.status_code
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > max_bytes:
                        raise EndpointUrlError(f"response_too_large: {vetted.host}")

        if 200 <= status < 300:
            try:
                parsed_body: Any = json.loads(bytes(body).decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                raise EndpointUrlError(f"invalid_json: {vetted.host}") from None
            return status, parsed_body
        try:
            return status, json.loads(bytes(body).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return status, None

    for pinned_ip in vetted.addresses:
        try:
            return await attempt(pinned_ip)
        except EndpointUrlError:
            raise
        except Exception as exc:
            # ONE opaque class for every network-level failure (connect,
            # TLS, timeout, malformed URL) — no port-scan oracle, no
            # library error text. Deliberately broad: httpx.InvalidURL is
            # not an HTTPError, and an escape would break the contract.
            # The TYPE is logged (never the message) so a real bug here is
            # still findable.
            logger.warning(
                "endpoint_request_failed",
                host=vetted.host,
                error_type=type(exc).__name__,
            )
    raise EndpointUrlError(f"unreachable: {vetted.host}")
