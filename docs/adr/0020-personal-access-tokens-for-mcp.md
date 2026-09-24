---
status: accepted
last_reviewed: 2026-09-24
owner: '@raphaelfh'
adr_number: '0020'
---

# Personal access tokens as a second auth carrier for `/mcp`

> **Status:** Accepted · Date: 2026-09-24 · Deciders: @raphaelfh
> **Supersedes:** N/A · **Superseded by:** N/A

## Context and Problem Statement

The researcher MCP server mounts at `/mcp` and is consumed by header-capable
agent clients (CLIs, IDE integrations, scripted researchers) rather than the
browser. Every existing prumo endpoint authenticates with a Supabase JWT, but
a JWT is short-lived and minted through a browser-oriented OAuth/session
flow: it is the wrong shape for a client that runs unattended and cannot
complete an interactive login each time its session expires. `/mcp` needs a
credential a researcher can generate once, paste into a client config, and
have keep working for weeks without a human in the loop for renewal.

This ADR is constitution-facing (§IV Security by Design, §VIII Standardized
API Contract), so the amendment in this same PR (2.3.0) cites it directly.

## Decision Drivers

- Header-capable, unattended agent clients need a long-lived credential.
- The credential must be revocable per-token, not just per-user (a leaked
  token should not require rotating every credential a researcher holds).
- A leaked stored value must not itself be a usable secret.
- `/mcp`'s principal must be exactly as verifiable as a JWT's `sub` — no path
  where a client can assert its own identity.
- Minimal new attack surface: no new redirect flow, no new provider
  integration.

## Considered Options

- OAuth (a `/mcp`-scoped authorization-code flow, provider registration, and
  a token endpoint).
- Personal access tokens (PATs): a caller-named, scoped, expiring bearer
  secret, issued and revoked through `/api/v1/me/tokens`, hashed at rest.
- Reusing the existing Supabase JWT unmodified (just document that MCP
  clients must refresh it themselves).

## Decision Outcome

Chosen option: **personal access tokens**, issued and managed through
`/api/v1/me/tokens` and accepted as a second bearer credential on `/mcp`
only.

OAuth was rejected: prumo has no web chat client to support (the entire
consumer base for `/mcp` is header-capable agents), so an authorization-code
flow would add a redirect endpoint, a consent screen and a provider
registration for zero clients that need it. A PAT reaches the same
long-lived-credential goal with the shape those clients already expect
(paste a bearer token into a config file), and issuance instead of a JWT
refresh loop avoids inventing agent-side session renewal.

Reusing the JWT unmodified was rejected: it is short-lived by design (session
security for the browser), and widening its lifetime for MCP would weaken it
for every other consumer.

### Consequences

- Good — a researcher can issue and revoke a token from `/api/v1/me/tokens`
  without touching their Supabase session; losing a laptop means revoking one
  token, not rotating a password.
- Good — the stored row is a SHA-256 hash: a database leak yields no usable
  credential (see the hashing rationale below).
- Bad — a second auth code path on `/mcp` (`McpPrincipal` resolution) that
  the JWT path does not share, so both need their own tests.
- Neutral — `/mcp` is now the only route accepting two credential shapes; no
  other prumo endpoint does, by design (ADR scope is deliberately narrow to
  `/mcp`).

## Validation

- `backend/tests/integration/test_personal_access_token_rls.py`: the table
  holds no PostgREST-visible grant and the `deny_all` policy is the floor
  even if a grant is restored.
- `backend/tests/integration/test_pat_service.py`: hash-only storage, exact
  expiry arithmetic, the 10-active-token cap (including its concurrent-create
  race), status derivation, and owner-scoped revoke.
- `backend/tests/integration/test_personal_access_tokens_api.py`:
  `test_pat_cannot_call_token_routes` proves a PAT is refused (401) on the
  very routes that mint and revoke PATs — the "a PAT never mints a PAT"
  guarantee below.
- A later task (`/mcp` bearer lookup) adds the principal-resolution and
  rate-limit probes this ADR's items 3 and 4 describe; this task validates
  only the token lifecycle.

## Pros and Cons of the Options

### OAuth

- Good — a standard, well-understood flow; delegable to a third-party IdP.
- Bad — no web chat client exists for prumo to authorize against; the entire
  redirect/consent/provider-registration surface would serve zero consumers.
- Bad — larger implementation and audit surface than a scoped, hashed bearer
  token for a use case that does not need delegation.

### Personal access tokens (chosen)

- Good — matches how header-capable agent clients already expect to
  authenticate (a config-file bearer token).
- Good — caller-scoped (`read` / `read_write`), caller-named, individually
  revocable, capped at 10 active tokens per user.
- Bad — a new table and a new auth code path to maintain.

### Reuse the Supabase JWT

- Good — no new table, no new endpoint.
- Bad — the JWT's short lifetime is a deliberate browser-session control;
  extending it for MCP either weakens that control everywhere or requires
  MCP-specific token minting anyway, which is most of the PAT work without
  the revocability or naming.

## More Information

### Hash, not encrypt

§IV's `PBKDF2-HMAC-SHA256` bullet protects secrets prumo must later
**recover** — a provider API key the backend re-presents to that provider.
A PAT is only ever **verified** (compare a hash to a hash), never recovered,
so a one-way SHA-256 digest is strictly stronger than a reversible
encryption: there is no key whose compromise reconstructs the plaintext.
The secret is CSPRNG-generated with 256 bits of entropy
(`secrets.token_bytes(32)`, base62-encoded), so neither a salt nor a slow KDF
(bcrypt/PBKDF2) adds meaningful resistance to guessing — the search space
already makes brute force infeasible — and a salted or slow hash would also
preclude the indexed equality lookup (`token_hash = :hash`) the bearer path
needs on every `/mcp` request. Salting protects against dictionary/rainbow
attacks on *low-entropy* secrets (passwords); this secret has none of that
weakness.

### Principal carrier

On `/mcp`, `user_sub` for a PAT-authenticated call comes from the verified
token row (`personal_access_tokens.user_id`, resolved from the bearer secret
via `find_active_token`, added with its only caller in a later task) via the
`McpPrincipal` contextvar — never from request input, matching §IV's
existing JWT rule that `user_id` is never accepted from a body, query or path
parameter.

### `/mcp` rate limiting

`@limiter.limit(...)` is a FastAPI route decorator; `/mcp` is mounted as a
raw ASGI application (the MCP SDK's transport), so no FastAPI route exists to
decorate. `/mcp` instead calls the shared limiter's non-decorator API
(`limiter.limiter.hit(...)`) directly inside its ASGI handler, keyed the same
way (`get_remote_address`, informed by the resolved principal) so the same
budget applies without a route to attach a decorator to.

### MCP envelope exception to §VIII

`/mcp` speaks the MCP/JSON-RPC protocol: results carry an `isError` flag, not
prumo's `ApiResponse{ok, data, error, trace_id}` envelope, and errors never
pass through `register_exception_handlers` (`/mcp` is outside the FastAPI
routing tree those handlers attach to). `trace_id` propagation is preserved
through `RequestIdMiddleware`, which runs on every request regardless of
downstream framework, so `/mcp` calls remain traceable in logs even though
their wire format is not `ApiResponse`.

### Migration 0077

`personal_access_tokens` follows the 0072 (`llm_connections`) posture
exactly: RLS enabled, a single `deny_all USING (false)` policy, and every
privilege revoked from `authenticated`/`anon`. The backend's own role bypass
RLS is what the endpoint layer uses; there is no PostgREST read path for a
token row, hashed or not.
