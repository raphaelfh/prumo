---
status: accepted
last_reviewed: 2026-10-15
owner: '@raphaelfh'
adr_number: '0022'
---

# OAuth 2.1 for /mcp, with prumo as the authorization server

> **Status:** Accepted · Date: 2026-10-15 · Deciders: @raphaelfh
> **Amends:** 0020 · **Supersedes:** N/A · **Superseded by:** N/A

## Context and Problem Statement

ADR 0020 gave `/mcp` a second bearer credential, the personal access token
(PAT), because every known consumer was an agent that can send a header. Web
chat hosts cannot: they add a remote MCP server only through an OAuth
authorization-code flow, discovered from the server's own metadata. Without
OAuth, a researcher cannot connect prumo to such a host at all.

PATs stay for header-capable agents. This decision adds a second way in for
the hosts that cannot use them, without widening what any credential can
reach.

## Decision Drivers

- Web chat hosts must be able to connect with no manual token handling.
- An OAuth credential must open `/mcp` and nothing else: no REST, PostgREST
  or Storage path may accept it.
- Scopes must be expressible (read versus edit project setup).
- Ship dark: merging the code must change no deployed behavior.

## Considered Options

- **A. Supabase's OAuth 2.1 server.** Rejected. Custom scopes are unsupported
  (only `openid`, `email`, `profile` and `phone`), and its access tokens are
  ordinary user JWTs that every REST, PostgREST and Storage path would
  accept, widening direct data access well beyond `/mcp`.
- **B. prumo as the authorization server**, on the MCP SDK 2.2 auth routes.
  Chosen.
- **C. PATs only.** Rejected: it leaves web chat hosts unsupported.

## Decision Outcome

Chosen option: **B**, because it is the only option that keeps the credential
confined to `/mcp` and carries prumo's own scopes.

### Authorization server

The SDK 2.2 routes provide the endpoints. PKCE is S256-only. The RFC 8707
`resource` parameter is bound to the MCP URL. Dynamic client registration
accepts public clients only (`token_endpoint_auth_method = none`; an omitted
method is treated as `none`). Revocation is supported, and discovery is served
as RFC 8414 authorization-server metadata and RFC 9728 protected-resource
metadata. Supabase remains the login: consent is a signed-in prumo page.
Tokens are opaque prumo secrets valid only at `/mcp`, stored as SHA-256.

### Scopes and consent

The 401 challenge carries `resource_metadata` and never a `scope`, so clients
fall back to `scopes_supported`, which is `["read", "write"]` today. The
authorization-server metadata also lists `offline_access` as a no-op marker so
hosts that request refresh tokens by scope can register; refresh tokens are
always issued, and the protected-resource metadata stays `["read","write"]`. The
consent page shows Read (fixed) and "Edit project setup" (unchecked). A later
scope for starting AI runs will be added with its own unchecked box once its
server-side gates exist.

### Lifetimes

A connection lives 90 days. There is one active connection per user and
client; a new approval revokes the previous one. Access tokens last 1 hour.
Refresh tokens rotate on every use, and presenting a rotated one revokes the
connection.

### Redirect URIs

The documented hosted-app callback (exact match) plus loopback `http` URIs on
any port (RFC 8252 section 7.3). No user info, no fragment, nothing else. The
callback list is a setting whose default equals the table of doc-settled facts
below.

### CORS

Principle IV is amended for five credential-less endpoints: protected-resource
metadata, authorization-server metadata, token, register and revoke. Those
exact paths bypass the app's global `CORSMiddleware` through a path-scoped
wrapper, so the SDK's `allow_origins="*"` without credentials applies.
`/authorize`, `/mcp` and `/api/v1` keep the explicit allow-list. Consent pages
under `/oauth/` send `X-Frame-Options: DENY` and
`Content-Security-Policy: frame-ancestors 'none'`.

### Storage

Each OAuth connection is a `kind = 'oauth'` row in `personal_access_tokens`,
so audit rows, the draft label and rate-limit keys keep keying on `token_id`.
Three backend-only tables (`mcp_oauth_clients`, `mcp_oauth_requests`,
`mcp_oauth_tokens`) hold the rest. The legacy table name is kept; a rename is
deferred.

### Fail closed and shipped dark

OAuth is on only when `PUBLIC_API_URL` is set. Until enablement no deployed
environment sets it, and `/mcp` behaves exactly as before.

### Response shapes

The OAuth endpoints speak RFC 6749, 7591, 8414 and 9728 JSON, not
`ApiResponse` (constitution Principle VIII exception).

### Consequences

- A CLI client whose PAT stopped working sees a `resource_metadata` challenge
  once OAuth is on and may offer OAuth instead.
- Registration is unauthenticated, bounded by a per-IP limit and a 24 hour
  prune of unconnected clients.
- OAuth connections reach every project the user belongs to (the consent page
  says so; the project role still applies).
- Limits are per `client_id`, because hosts share egress IPs.

## Doc-settled facts

Read from public documentation; none depends on a live system.

| Fact | Source | Checked |
|---|---|---|
| The hosted Claude apps (web, Desktop, mobile, Cowork) send the fixed redirect URI `https://claude.ai/api/mcp/auth_callback`. A `https://claude.com/api/mcp/auth_callback` callback is not listed on the page; it is unconfirmed and moves to the rollout checklist, so the default allow-list holds the `claude.ai` URI only. | <https://claude.com/docs/connectors/building/authentication> (Callback URLs) | 2026-10-15 |
| Claude Code uses a loopback redirect on an ephemeral port (`http://localhost:<port>/callback`) and declares `http://localhost/callback` and `http://127.0.0.1/callback` in its client metadata document, so both hosts must match with the port ignored. | same page (Callback URLs) | 2026-10-15 |
| Claude uses DCR unless the authorization server metadata advertises both `client_id_metadata_document_supported: true` and `none` in `token_endpoint_auth_methods_supported`; DCR registers it as a public client; it sends PKCE S256 on every request; it uses only the first `authorization_servers` entry; and it appends `offline_access` only when `scopes_supported` lists it. | same page (DCR and CIMD details, PKCE and requested scopes, Serve discovery metadata) | 2026-10-15 |
| Scope selection: a client uses the `scope` parameter of the `WWW-Authenticate` challenge if present, otherwise all of `scopes_supported` from the protected-resource metadata. Hence the challenge omits `scope` and `scopes_supported` is the single source. | <https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization> (Scope Selection Strategy) | 2026-10-15 |
| MCP 2026-07-28 (latest published revision, changelog against 2025-11-25): authorization servers SHOULD send the RFC 9207 `iss` parameter in authorization responses and clients MUST validate a present `iss`; clients MUST specify an `application_type` at registration; clients key persisted credentials by issuer; DCR (RFC 7591) is deprecated in favor of Client ID Metadata Documents but stays available for compatibility. Consequence for prumo: none that blocks. DCR stays the registration path; registration must accept and ignore an `application_type` field, and `iss` is optional for the server. CIMD support is a possible later change. | <https://modelcontextprotocol.io/specification/2026-07-28/changelog> | 2026-10-15 |

## Rollout checklist (closed at enablement)

Live-only facts to verify when OAuth is first enabled:

- The DCR body that claude.ai and Claude Desktop actually send, including
  `token_endpoint_auth_method`, `application_type` and the redirect URIs.
- Whether the `https://claude.com/api/mcp/auth_callback` callback is used by
  any host; add it to the redirect allow-list only if observed.
- The scope the host actually requests.
- Whether `/mcp` calls carry an `Origin` header. If they do, set
  `MCP_ALLOWED_ORIGINS` at that point.
- Whether the host sends `offline_access` and how it behaves without a
  refresh token when `scopes_supported` omits it.
- The production value of `PUBLIC_API_URL`.
- Before enabling, that the server sees real client IPs behind the hosting
  proxy (forwarded-IP trust is configured). Otherwise every request carries
  the proxy's address and the per-IP OAuth limits act as one global limit.

## Validation

Backend tests cover each endpoint, the rate limits, the CORS bypass, the
OAuth-off behavior (every OAuth path answers 404 and an OAuth-shaped bearer
gets the plain `Bearer` challenge) and the principal resolution at `/mcp`.
The rollout checklist above is closed during the first enablement.

## More Information

- ADR 0020, personal access tokens for `/mcp`.
- Constitution Principles IV and VIII, version 2.4.0.
