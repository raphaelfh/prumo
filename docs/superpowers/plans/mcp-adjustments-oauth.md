---
status: draft
last_reviewed: 2026-10-15
owner: '@raphaelfh'
---

# MCP OAuth (dark) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** prumo becomes the OAuth 2.1 authorization server for `/mcp` (dynamic client registration, PKCE S256 authorization code with a signed-in consent page, rotating refresh tokens, revocation, RFC 8414 and RFC 9728 discovery), stores each OAuth connection as an agent-credential row that Settings lists and revokes, and ships dark: everything OAuth is off unless `PUBLIC_API_URL` is set, and no deployed environment sets it in this slice.

**Architecture:** The MCP SDK 2.2 `mcp.server.auth` handlers are mounted at the app root behind one fail-closed switch (`settings.oauth_enabled`). A thin adapter (`api/mcp/oauth/provider.py`) delegates every provider call to `services/mcp_oauth_service.py`. One table, `personal_access_tokens`, holds both credential kinds (`kind = 'pat' | 'oauth'`), so every `token_id` consumer (audit rows, the draft label, rate-limit keys) works unchanged; three backend-only tables hold clients, pending requests and tokens, secrets as SHA-256 only. `/mcp` dispatches a bearer by prefix to the PAT or the OAuth resolver, both returning the same `McpPrincipal`. REST keeps accepting Supabase JWTs only.

**Tech Stack:** FastAPI, Starlette, MCP Python SDK 2.2.0 (`mcp.server.auth`), SQLAlchemy 2 async, Alembic, Postgres 17, Redis-backed `limits`, React 19 + react-router + TanStack Query + Vitest + MSW, Vercel headers.

**Scope:** 11 tasks, one PR. No spec link: the goal, the global constraints and the per-task requirements below are the contract.

## Global Constraints

- **Worktree.** `$WT` = `/Users/raphaelfedericcihaddad/PycharmProjects/prumo/.claude/worktrees/mcp-adjustments-oauth-slice-a5c25a` (branch `feat/mcp-adjustments-oauth`). Every command uses `git -C "$WT"` or absolute `$WT/...` paths; never touch the main checkout. Confirm with `git -C "$WT" status` that edits landed there. Never `git stash`.
- **One PR.** The whole slice ships as one PR to `dev` (squash-merged), title `feat(mcp): OAuth for /mcp, off by default`. Each task still ends in its own conventional commit.
- **Test-first.** Each task writes its failing test, runs it red, then implements; no "done" without the green command output read back.
- **Ship dark.** OAuth is on iff `settings.PUBLIC_API_URL` is a non-empty string. This slice changes no deployed environment variable (Railway, Vercel, Supabase) and leaves `MCP_ALLOWED_ORIGINS` at `""`. Out of this slice: a claude.ai entry in the client snippet selector, any change to the `clientsNote` copy, any claude.ai section in `docs/how-to/connect-an-ai-agent.md`, enabling OAuth anywhere.
- **Scopes.** Granting scopes are exactly `["read", "write"]`: PRM `scopes_supported` and DCR `default_scopes`. `offline_access` is accepted as a no-op marker only: it is listed in AS metadata `scopes_supported` and in DCR `valid_scopes` (`["read", "write", "offline_access"]`), a registration or authorize request that includes it is accepted, refresh tokens are issued regardless, and it is never stored in a request's requested scopes or a connection's granted scope nor echoed in a token response. No `ai_run` scope, column, checkbox or copy anywhere in this slice. Granted scope maps to the connection row's `scope`: `read` → `'read'`; `read` + `write` → `'read_write'`.
- **Lifetimes.** Pending authorization request 10 min; authorization code 5 min, single use; access token 1 h; refresh token rotates on every use and lives as long as its connection; connection 90 days. One unrevoked connection per user × client; a new approval revokes the previous one.
- **Secrets.** Access tokens `prumo_oat_` + 43 base62 chars, refresh tokens `prumo_ort_` + 43 base62 chars (one generator: `pat_service.new_secret(prefix)`); authorization codes `secrets.token_urlsafe(32)`. Stored only as `pat_service.hash_secret(...)` (SHA-256 hex). Never log a secret, a code, a hash or a `.env` value.
- **One revocation write.** Every revocation of a credential row (PAT or OAuth connection) goes through `pat_service.revoke_credential(db, token_id)`; no other `UPDATE ... SET revoked_at` exists in `backend/app`.
- **Ownership.** `pat_service.owned_token(db, *, user_id, token_id, kind)` is THE guard for a credential row in its owner, with `kind` in the WHERE clause; no second guard (`scripts/fitness/check_scope_guards.py` stays green). A consent request id is a uuid4 capability: the user binds to it only at decision time, from the JWT `sub`, never from the body.
- **Errors.** New domain exceptions subclass `AppError` (constitution Principle VIII) — `NotFoundError` for missing/expired, `AppError(code=..., status_code=409)` for conflicts — and the global handler maps them; endpoints add no try/except for them.
- **Layering.** `backend/app/api/**` imports services and support modules only, never `app.models` or `app.repositories` (`scripts/fitness/check_layered_arch.py`). The provider adapter calls service functions; services return the SDK's pydantic types (`OAuthClientInformationFull`, `AuthorizationCode`, `RefreshToken`, `AccessToken`, `OAuthToken`).
- **Response shapes.** The OAuth routes (both metadata documents, authorize, token, register, revoke) answer RFC 6749/7591/8414/9728 JSON or redirects, never `ApiResponse`. Everything under `/api/v1` uses `ApiResponse.success(...)` and `AppError`/`HTTPException` through the existing handler.
- **Rate limits** (shared storage through `app.utils.rate_limiter.hit_shared`, 429 + `Retry-After` from `retry_after`, all through ONE wrapper `api/mcp/oauth/asgi.Limited`): register 10/min per IP; authorize 30/min per `client_id`; token 60/min per `client_id`; PRM, AS metadata and revoke 60/min per IP. A request with no `client_id` falls back to its IP as the key. `OPTIONS` preflights are never counted. A body over the SDK's `DEFAULT_MAX_REQUEST_BODY_SIZE` gets 413 before any handler runs. REST: consent GET 60/min, consent POST 20/min, OAuth connections GET 60/min, OAuth connections DELETE 20/min (`@limiter.limit`).
- **CORS.** Exactly five paths bypass the global `CORSMiddleware` so the SDK's credential-less `allow_origins="*"` applies: `/.well-known/oauth-protected-resource/mcp`, `/.well-known/oauth-authorization-server`, `/token`, `/register`, `/revoke`. `/authorize`, `/mcp` and `/api/v1/**` keep the explicit allow-list.
- **Migrations.** Only Task 6.1 touches `backend/alembic/versions/`. Current head `0082_pat_project_scope`; the new file takes the next free number (`ls "$WT/backend/alembic/versions" | grep '^0' | sort | tail -1` — expected `0083`), revision id `0083_mcp_oauth` (≤ 32 chars), and the same task moves `expected_head` in `backend/tests/integration/test_migration_roundtrip.py::test_alembic_head_is_expected_revision` and adds a roundtrip test. Task 6.5b re-checks the number against `origin/dev` before the PR is opened. Short CHECK names (the `ck` convention expands them). No seed data in migrations; never app-schema DDL through the Supabase MCP. `cd "$WT/backend" && uv run alembic check` = no diff on every model change.
- **Backend test infra.** `backend/.env` already points `DATABASE_URL` at database `postgres_test_mcp_oauth` on `localhost:55432` (container `prumo-arch-pg`, stub + `alembic upgrade head` + seed applied) and `REDIS_URL=redis://localhost:56379/0`. Run `cd "$WT/backend" && uv run pytest <paths> -q`. Every backend task's gate also runs `tests/unit`. Never the shared local Supabase stack; never `make db-fresh`/`make reset-db`; never print `.env`. After Task 6.1, run `cd "$WT/backend" && uv run alembic upgrade head` once on that database.
- **Coverage.** CI fails a PR whose diff coverage is under 80% (`PRUMO_DIFF_COVERAGE_MIN`, ci.yml "Diff coverage gate"). Lines reached only through the httpx `ASGITransport` fixtures register no coverage, so every new endpoint coroutine, provider method and ASGI wrapper also gets a direct unit test (`backend/tests/unit/`, endpoint handlers called via `fn.__wrapped__` as in `tests/unit/test_personal_access_tokens_endpoint_unit.py`; ASGI `__call__` driven directly as in `tests/unit/test_mcp_asgi_auth.py`), and every service function a direct service-level test on `db_session`. Reproduce the gate: `cd "$WT/backend" && uv run pytest tests/ --cov=app --cov-report=xml -q && uv run diff-cover coverage.xml --compare-branch=origin/dev --fail-under=80`.
- **No app-unused symbol at any task boundary.** Vulture scans `backend/app` only, so a function, constant or property lands in the task that adds its first `backend/app` caller (tests do not count). Each backend task ends with `cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec` green; the baseline never grows. Provider methods only the SDK calls go in `[tool.vulture] ignore_names` in `backend/pyproject.toml`, under a comment `# OAuth provider protocol: called by mcp.server.auth handlers, never by name`.
- **Fitness scripts** run from `$WT` with the backend venv first on PATH: `cd "$WT" && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/<script>.py` (and `bash scripts/fitness/run_all.sh` for the whole set).
- **Frontend tooling runs from the repo root** (`$WT`): `npx vitest run <file>`, `npm run typecheck`, `npm run lint`, `npx knip`, `npx knip --production`. Never `cd frontend && npm ...`. If `$WT/node_modules` is missing or a symlink, run `cd "$WT" && npm ci` first.
- **REST contract change** (any new route or any edit to a public schema class, docstring included) ⇒ `cd "$WT" && npm run generate:api-types` and commit `frontend/types/api/schema.d.ts` + `frontend/types/api/openapi.json` in the same task.
- **No dead code.** A replaced path is deleted in the same task. `npx knip` and `npx knip --production` stay at 0.
- **Copy** goes through `t(namespace, key)` from `frontend/lib/copy/`; new namespaces are registered in `frontend/lib/copy/index.ts`; `scripts/fitness/check_copy_keys.py` stays green. Query keys come from `frontend/lib/query-keys/me.ts` factories only (`check_react_query_keys.py`). Note: `meKeys.connections()` already means the user's LLM connections; OAuth uses new factory entries.
- **English only** in code, comments, commits, docs and copy keys.
- **Public wording.** This repo is public. Commit messages, the PR title/body and docs describe the intended behavior and the tests only — never an attack path, an exploit sequence or "before" reproduction steps — and cite no local-only document, path or key. Tracker line in the PR body: `Refs PRU-88`. Never `Fixes`/`Closes` PRU-88: it stays open after this slice. Conventional commit titles.
- **Gates per task:** `cd "$WT" && make lint-backend` (ruff + format + mypy ratchet) on backend tasks; backend pytest on `tests/unit` plus the touched integration suites; `bash scripts/fitness/run_all.sh` (PATH as above); `uv run alembic check` on model tasks; frontend `npm run test:run`, `npm run lint`, `npm run typecheck`, knip ×2 on frontend tasks; `bash scripts/docs/check-frontmatter.sh` on docs tasks (it reads tracked files only: `git -C "$WT" add` new docs before running it).

## Task order

| Task | Title | Layer | Touches `backend/alembic/versions/` | Depends on |
|---|---|---|---|---|
| 6.0 | ADR 0022, constitution amendment, ADR 0020 note | docs | no | — |
| 6.1 | OAuth connection storage (migration + models + kind-aware PAT service) | backend | **yes** | — |
| 6.2a | Settings, discovery metadata, rate-limit wrapper, CORS bypass, 401 challenge | backend | no | 6.1 |
| 6.2b | Registration and authorize | backend | no | 6.2a |
| 6.3a | Consent decision service and consent REST API | backend | no | 6.2b |
| 6.2c | Code exchange, refresh rotation, revoke, prune | backend | no | 6.3a |
| 6.3b | OAuth principal at `/mcp` | backend | no | 6.2c |
| 6.4a | Sign-in return path and frame headers | frontend | no | — |
| 6.4b | Consent page | frontend | no | 6.3a, 6.4a |
| 6.5a | Connected apps REST API | backend | no | 6.3b |
| 6.5b | Connected apps in Settings | frontend | no | 6.5a, 6.4b |

- Tasks run in the order of this document (6.3a comes before 6.2c: the consent decision mints the codes the token tests exchange, and it lands with its first app caller, the consent endpoint).
- Disjoint file sets: 6.0 (docs only) and 6.4a (`frontend/components/ProtectedRoute.tsx`, `frontend/pages/Auth.tsx`, `frontend/lib/routes.ts`, `vercel.json`, their tests) share no file with any backend task and can run in parallel with 6.1–6.3b.
- Sequential by shared files: 6.2a → 6.2b → 6.3a → 6.2c → 6.3b → 6.5a all edit `backend/app/services/mcp_oauth_service.py` and/or `backend/tests/integration/mcp/conftest.py`; 6.2a and 6.3b both edit `backend/app/api/mcp/asgi_auth.py`; 6.4b and 6.5b both edit `frontend/lib/query-keys/me.ts` and `frontend/lib/copy/index.ts`.

## Review Focus

1. **A client that omits `token_endpoint_auth_method` and `scope` at registration** registers as a public client (`none`) with `read write`; its authorize request without `scope` reaches consent with "Edit project setup" offered, unchecked (task 6.2b).
2. **Issuer string equality:** the PRM `authorization_servers[0]` equals the AS metadata `issuer` byte for byte, and a `resource` sent with a trailing slash is treated as the MCP URL (tasks 6.2a, 6.2b).
3. **OAuth off:** a `prumo_oat_`-shaped bearer gets the plain `Bearer` 401, and every OAuth path (both metadata documents, authorize, token, register, revoke) answers 404 (tasks 6.2a, 6.2b, 6.3b).
4. **A consent page reloaded or opened in a second tab after approval** shows the already-decided state and never creates a second connection (tasks 6.3a, 6.4b).
5. **The sign-in return path keeps the query string** (`/oauth/consent?request=<id>`), and a hostile `state.from` (`//evil.example`, `https://evil.example`, `/\evil.example`) falls back to `/` (task 6.4a).

---

### Task 6.0: ADR 0022, constitution amendment, ADR 0020 note

**Layer:** docs · **Migration:** no · **Commit:** `docs(adr): OAuth for the MCP server with prumo as authorization server`

**Goal:** record the OAuth decisions before any code lands. No code changes in this task.

**Files:**
- Create: `docs/adr/0022-oauth-for-mcp.md`
- Modify: `docs/reference/constitution.md` (Principle IV bullets, Principle VIII bullet, version line, the 2.4.0 amendment note, frontmatter `last_reviewed`)
- Modify: `docs/adr/0020-personal-access-tokens-for-mcp.md` (amendment note in Decision Outcome, frontmatter `last_reviewed`)
- Modify (only if cspell reports unknown words): `.github/cspell-words.txt`

ADR number 0021 stays reserved for another decision; the frontmatter check allows the gap.

- [ ] **Step 1: Write the failing acceptance probe** (save as `$SCRATCH/adr22_probe.sh`, where `$SCRATCH` is the session scratchpad; it is not committed):

```bash
#!/usr/bin/env bash
set -u
WT="$1"; fail=0
f="$WT/docs/adr/0022-oauth-for-mcp.md"
c="$WT/docs/reference/constitution.md"
test -f "$f" || { echo "missing ADR 0022"; exit 1; }
for needle in "status: accepted" "adr_number: '0022'" "**Amends:** 0020" "## Doc-settled facts" \
              "## Rollout checklist (closed at enablement)" "auth_callback" \
              "scopes_supported" "frame-ancestors" "personal_access_tokens"; do
  grep -qF -- "$needle" "$f" || { echo "ADR 0022 lacks: $needle"; fail=1; }
done
grep -q "Amended by ADR 0022" "$WT/docs/adr/0020-personal-access-tokens-for-mcp.md" || { echo "0020 note missing"; fail=1; }
grep -q '^\*\*Version\*\*: 2.4.0' "$c" || { echo "constitution not 2.4.0"; fail=1; }
grep -q '^> 2.4.0:' "$c" || { echo "2.4.0 amendment note missing"; fail=1; }
grep -q "no migration plan accompanies this MINOR bump" "$c" || { echo "migration-plan statement missing"; fail=1; }
grep -q "prumo-issued OAuth access tokens" "$c" || { echo "Principle IV auth bullet missing"; fail=1; }
exit $fail
```

- [ ] **Step 2: Run red.** `bash "$SCRATCH/adr22_probe.sh" "$WT"` → exit 1, `missing ADR 0022`.

- [ ] **Step 3: Gather the doc-settled facts** (WebFetch; record each source URL and the date you read it):
  1. The claude.ai and claude.com OAuth callback URLs for custom connectors (expected `https://claude.ai/api/mcp/auth_callback` and `https://claude.com/api/mcp/auth_callback`). Source: the Claude Help Center article on building custom connectors with remote MCP servers (`https://support.claude.com/en/articles/11503834-building-custom-connectors-via-remote-mcp-servers`, or the page it now redirects to). If the page lists different URLs, record what it lists and report it — Task 6.2b's `MCP_OAUTH_REDIRECT_URIS` default must equal this list.
  2. The MCP client scope-selection rule: a client uses the `scope` in the `WWW-Authenticate` challenge, else the PRM `scopes_supported`. Source: the authorization page of the current MCP specification (`https://modelcontextprotocol.io/specification/<latest revision>/basic/authorization`, section on scope selection).
  3. The authorization changes in the MCP 2026-07-28 specification revision: read its changelog (`https://modelcontextprotocol.io/specification/2026-07-28/changelog`) and list each auth-related change with its consequence for prumo ("none" is a valid consequence). If that revision is not published under that date, record the latest published revision and its date instead, and say so.

- [ ] **Step 4: Write `docs/adr/0022-oauth-for-mcp.md`** from `docs/adr/0000-template.md` (MADR). Frontmatter:

```yaml
---
status: accepted
last_reviewed: <today>
owner: '@raphaelfh'
adr_number: '0022'
---
```

Title `# OAuth 2.1 for /mcp, with prumo as the authorization server`; status line `> **Status:** Accepted · Date: <today> · Deciders: @raphaelfh`; second line `> **Amends:** 0020 · **Supersedes:** N/A · **Superseded by:** N/A`. Sections, each in plain prose:
  - **Context:** web chat hosts can only add a remote MCP server through OAuth; PATs (ADR 0020) stay for header-capable agents.
  - **Considered options:** (A) Supabase's OAuth 2.1 server — rejected: custom scopes are unsupported (only `openid`, `email`, `profile`, `phone`), and its access tokens are ordinary user JWTs that every REST, PostgREST and Storage path would accept, widening direct data access; (B) prumo as the authorization server on the MCP SDK 2.2 auth routes — chosen; (C) PATs only — rejected, it leaves web chat hosts unsupported.
  - **Decision Outcome**, one subsection each:
    - *Authorization server:* SDK 2.2 routes; S256-only PKCE; RFC 8707 `resource` bound to the MCP URL; dynamic client registration for public clients only (`token_endpoint_auth_method = none`, an omitted method is treated as `none`); revocation; RFC 8414 and RFC 9728 metadata. Supabase remains the login: consent is a signed-in prumo page. Tokens are opaque prumo secrets valid only at `/mcp`, stored as SHA-256.
    - *Scopes and consent:* the 401 challenge carries `resource_metadata` and never a `scope`; `scopes_supported` is `["read","write"]` today; consent shows Read (fixed) and "Edit project setup" (unchecked); a later scope for starting AI runs will be added with its own unchecked box once its server-side gates exist.
    - *Lifetimes:* connection 90 days; one active connection per user × client, re-consent revokes the previous one; access tokens 1 h; refresh tokens rotate on every use, and presenting a rotated one revokes the connection.
    - *Redirect URIs:* the documented claude.ai and claude.com callbacks (exact match) plus loopback `http` URIs on any port (RFC 8252 section 7.3); no user info, no fragment; nothing else.
    - *CORS:* a constitution Principle IV amendment scoped to five credential-less endpoints (PRM, AS metadata, token, register, revoke). Mechanism: those exact paths bypass the app's global `CORSMiddleware` through a path-scoped wrapper, so the SDK's `allow_origins="*"` without credentials applies; `/authorize`, `/mcp` and `/api/v1` keep the explicit allow-list. Consent pages under `/oauth/` send `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'`.
    - *Storage:* each OAuth connection is a `kind = 'oauth'` row in `personal_access_tokens`, so audit rows, the draft label and rate-limit keys keep keying on `token_id`; three backend-only tables (`mcp_oauth_clients`, `mcp_oauth_requests`, `mcp_oauth_tokens`) hold the rest. The legacy table name is kept; a rename is deferred.
    - *Fail closed / shipped dark:* OAuth is on only when `PUBLIC_API_URL` is set; until enablement no deployed environment sets it and `/mcp` behaves exactly as before.
    - *Response shapes:* the OAuth endpoints speak RFC 6749/7591/8414/9728 JSON, not `ApiResponse` (constitution Principle VIII exception).
  - **Consequences:** a CLI client whose PAT stopped working sees a `resource_metadata` challenge once OAuth is on and may offer OAuth instead; registration is unauthenticated, bounded by a per-IP limit and a 24 h prune of unconnected clients; OAuth connections reach every project the user belongs to (the consent page says so; the project role still applies); limits are per `client_id` where hosts share egress IPs.
  - `## Doc-settled facts` — a table `| Fact | Source | Checked |` with the three facts from Step 3.
  - `## Rollout checklist (closed at enablement)` — live-only facts to verify when OAuth is first enabled: the DCR body claude.ai and Claude Desktop actually send (including `token_endpoint_auth_method` and redirect URIs); the scope the host actually requests; whether `/mcp` calls carry an `Origin` header (if so, `MCP_ALLOWED_ORIGINS` is set then); production `PUBLIC_API_URL`.

- [ ] **Step 5: Amend the constitution** (`docs/reference/constitution.md`, Principles IV and VIII; bump `**Version**: 2.3.0` → `2.4.0`, `**Last Amended**` → today, frontmatter `last_reviewed` → today):
  - Principle IV Authentication bullet — append: `` `/mcp`, and only `/mcp`, also accepts prumo-issued OAuth access tokens (ADR 0022); REST, PostgREST and Storage never accept them. ``
  - Principle IV storage bullet — extend the hash sentence to: `Credentials that are only verified, never recovered (personal access tokens, OAuth authorization codes, access and refresh tokens), are stored as a SHA-256 hash instead (ADR 0020, ADR 0022).`
  - Principle IV rate-limiting bullet — replace its second sentence with: `` The `/mcp` ASGI route and the OAuth routes apply the same limiter through its non-decorator API (ADR 0020, ADR 0022). ``
  - Principle IV CORS bullet — append: `Exception (ADR 0022): five credential-less OAuth endpoints (protected-resource metadata, authorization-server metadata, token, register, revoke) answer \`Access-Control-Allow-Origin: *\` without credentials.`
  - Principle VIII — after the `/mcp` exception bullet add: `- Exception: the OAuth endpoints (metadata, authorize, token, register, revoke) speak RFC 6749/7591/8414/9728 JSON, not the envelope (ADR 0022).`
  - Amendment note: directly above the existing `> 2.3.0:` paragraph, add a `> 2.4.0:` paragraph in exactly that paragraph's format (it names the two principles with the same notation the 2.3.0 note uses): Principles IV and VIII materially expanded for OAuth on `/mcp` (ADR 0022) — prumo-issued OAuth access tokens accepted only on that route, codes and tokens hashed at rest, the OAuth routes rate-limited through the non-decorator API, five credential-less endpoints exempt from the explicit CORS list, and an RFC-JSON exception to the envelope for the OAuth routes. End it with the sentence `Neither` + the two principle names + `is NON-NEGOTIABLE, so no migration plan accompanies this MINOR bump.`

- [ ] **Step 6: ADR 0020 note.** Directly under the paragraph that starts "OAuth was rejected:", add `**Amended by ADR 0022 (2026-10):** OAuth is now accepted for /mcp, with prumo as the authorization server; PATs remain the credential for header-capable agents.` Refresh its `last_reviewed`. Its status stays `accepted`. Do not edit anything under `docs/superpowers/specs/archive/`.

- [ ] **Step 7: Run green + docs gates.**

```bash
cd "$WT" && git add docs/adr/0022-oauth-for-mcp.md && bash "$SCRATCH/adr22_probe.sh" "$WT" \
  && bash scripts/docs/check-frontmatter.sh \
  && npx -y markdownlint-cli@0.45.0 --config .github/markdownlint.json docs/adr/0022-oauth-for-mcp.md docs/adr/0020-personal-access-tokens-for-mcp.md docs/reference/constitution.md \
  && npx -y cspell@8.17.5 --config .github/cspell.json docs/adr/0022-oauth-for-mcp.md docs/adr/0020-personal-access-tokens-for-mcp.md docs/reference/constitution.md
```

Expected: probe exit 0; `Frontmatter check passed`; markdownlint and cspell report nothing (add genuine terms such as `PKCE` or `loopback` to `.github/cspell-words.txt`, one per line, if cspell flags them).

- [ ] **Step 8: Commit.** `git -C "$WT" add docs/adr docs/reference/constitution.md .github/cspell-words.txt && git -C "$WT" commit -m "docs(adr): OAuth for the MCP server with prumo as authorization server"`

**Done when:** probe exit 0, frontmatter/markdownlint/cspell green, no file outside `docs/` and `.github/cspell-words.txt` changed.

---

### Task 6.1: OAuth connection storage (migration + models + kind-aware PAT service)

**Layer:** backend · **Migration:** yes (the only one in this slice) · **Wording:** security-sensitive — describe behavior and tests only · **Commit:** `feat(db): storage for OAuth connections to the MCP server`

**Goal:** add `kind` to `personal_access_tokens` and three deny-all OAuth tables; make every PAT path ignore OAuth rows; make `owned_token` kind-aware; give revocation one write path.

**Files:**
- Create: `backend/alembic/versions/0083_mcp_oauth.py` (number confirmed per Global Constraints)
- Create: `backend/app/models/mcp_oauth.py`
- Modify: `backend/app/models/__init__.py` (export `McpOAuthClient`, `McpOAuthRequest`, `McpOAuthToken`)
- Modify: `backend/app/models/personal_access_token.py`
- Modify: `backend/app/services/pat_service.py`
- Modify: `backend/tests/integration/helpers/pat_rows.py`
- Modify: `backend/tests/integration/test_migration_roundtrip.py` (head pin ~L1334 + new roundtrip test)
- Modify: `backend/tests/integration/test_personal_access_token_rls.py`
- Modify: `backend/tests/integration/test_pat_service.py`
- Modify: `.claude/rules/backend.md` (section "Ownership guards": the `pat_service.owned_token` entry) — a write under `.claude/` may need an unsandboxed retry

**Interfaces:**
- Produces (models): `McpOAuthClient(client_id: UUID pk, client_name: str, redirect_uris: list[str], scope: str, created_at, last_used_at)`; `McpOAuthRequest(id: UUID pk, client_id, redirect_uri: str, redirect_uri_provided_explicitly: bool, code_challenge: str, state: str | None, requested_scopes: list[str], resource: str | None, created_at, expires_at, decided_at, user_id: UUID | None, connection_id: UUID | None, code_hash: str | None, code_expires_at, code_used_at)`; `McpOAuthToken(id: UUID pk, connection_id: UUID, kind: Literal["access","refresh"], token_hash: str, resource: str, created_at, expires_at, rotated_at)`. `PersonalAccessToken.kind: Literal["pat","oauth"]`, `.oauth_client_id: UUID | None`, `.token_hash/.token_prefix: str | None`.
- Produces (service, each with an app caller in this task): `owned_token(db, *, user_id: UUID, token_id: UUID, kind: Literal["pat","oauth"]) -> PersonalAccessToken | None`; `revoke_credential(db, token_id: UUID) -> None` (THE revocation write: id-only `UPDATE ... SET revoked_at = now() WHERE id = :id AND revoked_at IS NULL`; callers prove ownership or hold a capability first); `revoke_owned(db, *, user_id, token_id, kind) -> PersonalAccessToken` (guard → `revoke_credential` → refresh; raises `TokenNotFoundError`); `status_expr() -> ColumnElement[str]` (`'active'|'revoked'|'expired'`); `user_locked_out() -> ColumnElement[bool]`; `new_secret(prefix: str) -> str`. `revoke_token` keeps its signature and calls `revoke_owned(..., kind="pat")`.
- Produces (test helpers in `pat_rows.py`): `insert_oauth_client(db, *, client_name="Claude", redirect_uris=("https://claude.ai/api/mcp/auth_callback",), scope="read write", created_at_offset: timedelta = timedelta(0)) -> UUID`; `insert_oauth_request(db, *, client_id: UUID, requested_scopes=("read","write"), expires_in=timedelta(minutes=10), redirect_uri="https://claude.ai/api/mcp/auth_callback", state="st", code_challenge=<S256 of "v"*43>) -> UUID`; `insert_oauth_connection(db, *, user_id: UUID, client_id: UUID, scope="read_write", name="Claude", expires_in=timedelta(days=90)) -> UUID`.

**Schema (the migration and the models agree exactly):**
- `personal_access_tokens`: add `kind text NOT NULL DEFAULT 'pat'` + CHECK `kind_check` (`kind IN ('pat','oauth')`); add `oauth_client_id uuid NULL` FK → `public.mcp_oauth_clients(client_id)` ON DELETE CASCADE (name `personal_access_tokens_oauth_client_id_fkey`); `token_hash`, `token_prefix` become nullable; CHECK `kind_shape_check`: `(kind = 'pat' AND token_hash IS NOT NULL AND token_prefix IS NOT NULL AND oauth_client_id IS NULL) OR (kind = 'oauth' AND oauth_client_id IS NOT NULL AND token_hash IS NULL AND token_prefix IS NULL)`; unique partial index `uq_personal_access_tokens_oauth_user_client` on (`user_id`, `oauth_client_id`) `WHERE kind = 'oauth' AND revoked_at IS NULL` (no `now()` in the predicate: not IMMUTABLE); index `ix_personal_access_tokens_oauth_client` on (`oauth_client_id`) `WHERE oauth_client_id IS NOT NULL`. Unchanged: `scope`, the 365-day CHECK, `project_ids`. An OAuth row's `name` is its client name.
- `mcp_oauth_clients`: `client_id uuid PRIMARY KEY` (the SDK mints `str(uuid4())`), `client_name text NOT NULL` CHECK `client_name_check` (1–80 chars), `redirect_uris text[] NOT NULL` CHECK `redirect_uris_check` (`cardinality BETWEEN 1 AND 5`), `scope text NOT NULL` (the registered scopes, space-separated; the SDK's authorize-time scope check needs it), `created_at timestamptz NOT NULL DEFAULT now()`, `last_used_at timestamptz NULL`.
- `mcp_oauth_requests`: `id uuid PRIMARY KEY`, `client_id uuid NOT NULL` FK → clients ON DELETE CASCADE, `redirect_uri text NOT NULL`, `redirect_uri_provided_explicitly boolean NOT NULL`, `code_challenge text NOT NULL`, `state text NULL`, `requested_scopes text[] NOT NULL`, `resource text NULL`, `created_at timestamptz NOT NULL DEFAULT now()`, `expires_at timestamptz NOT NULL`, `decided_at timestamptz NULL`, `user_id uuid NULL` FK → `public.profiles(id)` ON DELETE CASCADE, `connection_id uuid NULL` FK → `public.personal_access_tokens(id)` ON DELETE CASCADE, `code_hash text NULL UNIQUE`, `code_expires_at timestamptz NULL`, `code_used_at timestamptz NULL`; indexes on `client_id` and `connection_id`. Nothing references `auth.*`.
- `mcp_oauth_tokens`: `id uuid PRIMARY KEY`, `connection_id uuid NOT NULL` FK → `public.personal_access_tokens(id)` ON DELETE CASCADE, `kind text NOT NULL` CHECK `kind_check` (`kind IN ('access','refresh')`), `token_hash text NOT NULL UNIQUE`, `resource text NOT NULL`, `created_at timestamptz NOT NULL DEFAULT now()`, `expires_at timestamptz NOT NULL`, `rotated_at timestamptz NULL`; index on `connection_id`.
- All three new tables: `ENABLE ROW LEVEL SECURITY`, `CREATE POLICY "deny_all" ... FOR ALL USING (false)`, `REVOKE ALL ... FROM "authenticated", "anon"` (the 0078 posture).
- Downgrade: `DELETE FROM public.personal_access_tokens WHERE kind = 'oauth'` first — `agent_actions` rows made through an OAuth connection survive, but their `token_id` is cleared by the existing ON DELETE SET NULL (credential attribution, including the draft label, is lost for those rows; the module docstring says so) — then drop both indexes, both CHECKs (`op.f("ck_personal_access_tokens_kind_check")`, `op.f("ck_personal_access_tokens_kind_shape_check")`), the FK and columns `oauth_client_id`, `kind`; set `token_hash`/`token_prefix` back to NOT NULL; drop `mcp_oauth_tokens`, `mcp_oauth_requests`, `mcp_oauth_clients`.

- [ ] **Step 1: Write the failing tests.**
  - `test_migration_roundtrip.py`: set `expected_head = "0083_mcp_oauth"`; add `test_migration_0083_mcp_oauth_roundtrip` shaped like `test_migration_0082_pat_project_scope_roundtrip` (own `auth.users` + `profiles` row, cleanup in `finally`): at head the three tables and both new columns exist; `pg_constraint` holds `ck_personal_access_tokens_kind_check`, `ck_personal_access_tokens_kind_shape_check`, `ck_mcp_oauth_clients_client_name_check`, `ck_mcp_oauth_clients_redirect_uris_check` and `ck_mcp_oauth_tokens_kind_check`; a PAT insert without `kind` reads back `'pat'`; insert one client (raw SQL), one `kind='oauth'` connection and one `agent_actions` row with `token_id` = that connection (column list as in `tests/integration/test_template_config_status.py::_agent_action`); a second unrevoked oauth row for the same user × client raises with `uq_personal_access_tokens_oauth_user_client` in the message; `_run_alembic("downgrade", "0082_pat_project_scope", ...)` → the tables and columns are gone, the oauth row is deleted, the `agent_actions` row still exists with `token_id IS NULL`, a PAT row inserted before the downgrade survives with its hash; re-upgrade → present again.
  - `test_personal_access_token_rls.py`: parametrize the existing "no privilege" probe (and the `deny_all` floor probe) over `public.mcp_oauth_clients`, `public.mcp_oauth_requests`, `public.mcp_oauth_tokens` in addition to `personal_access_tokens` (move `_TABLE` into a parametrize list; the floor probe re-grants SELECT on the table under test inside its rolled-back transaction).
  - `test_pat_service.py`:
    - `test_oauth_rows_are_not_listed_or_counted`: insert 10 active oauth connections for `SEED.primary_profile` (`insert_oauth_client` + `insert_oauth_connection`, one client each); `list_tokens` returns none of them and `create_token` still succeeds (cap counts PATs only).
    - `test_kind_shape_check_refuses_mixed_rows`: a raw insert of `kind='oauth'` with a `token_hash`, and of `kind='pat'` with an `oauth_client_id`, each raise with `ck_personal_access_tokens_kind_shape_check` in the message.
    - `test_owned_token_is_kind_scoped`: `owned_token(..., kind="pat")` on an oauth row id → `None`; `kind="oauth"` → the row; a foreign user → `None` for both kinds. Update the existing `test_owned_token_is_none_for_foreign_and_missing` call sites to pass `kind="pat"`.
    - `test_revoke_token_ignores_oauth_rows`: `revoke_token(db, user_id=owner, token_id=<oauth row id>)` raises `TokenNotFoundError`.
    - `test_revoke_owned_oauth_is_idempotent`: `revoke_owned(..., kind="oauth")` twice → both return the row with `revoked_at` set, and the second call leaves `revoked_at` unchanged.

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/integration/test_migration_roundtrip.py tests/integration/test_personal_access_token_rls.py tests/integration/test_pat_service.py -q` → FAIL (head pin, missing tables/columns, `owned_token` has no `kind`).

- [ ] **Step 3: Write the migration** (`revision = "0083_mcp_oauth"`, `down_revision = "0082_pat_project_scope"`; module docstring: what each table holds, that all three are backend-only deny-all, that secrets are stored only as SHA-256, and that the downgrade deletes OAuth connections first, which clears `agent_actions.token_id` on their audit rows). Use `op.create_table(...)` with `sa.CheckConstraint(..., name="<short>")`, `op.add_column`, `op.alter_column(..., nullable=True, schema="public")`, `op.create_check_constraint("<short>", ...)`, `op.create_index(..., unique=True, postgresql_where=sa.text("kind = 'oauth' AND revoked_at IS NULL"))`, then the RLS `op.execute` block per new table copied from `0078_personal_access_tokens.py`. Render the SQL offline before relying on names: `cd "$WT/backend" && uv run alembic upgrade 0082_pat_project_scope:0083_mcp_oauth --sql | grep -iE 'constraint|index'` → constraint names are `ck_<table>_<short>` exactly once.

- [ ] **Step 4: Models.** `backend/app/models/mcp_oauth.py` (`Base`, explicit `id` columns, no `updated_at`, `__table_args__` ending in `{"schema": "public"}`, `ForeignKey("public.<table>.<col>", ondelete="CASCADE")`, `ARRAY(Text)` for text arrays, `Literal` typed `Mapped` for `kind` like `PersonalAccessToken.scope`). `PersonalAccessToken`: add `kind` (with `server_default=text("'pat'")`), `oauth_client_id`, make `token_hash`/`token_prefix` `Mapped[str | None]`, add the two CHECKs and two indexes to `__table_args__`. Run `cd "$WT/backend" && uv run alembic upgrade head && uv run alembic check` → no diff (autogenerate does not compare CHECKs or partial-index predicates; the roundtrip test's `pg_constraint` asserts cover them).

- [ ] **Step 5: Service.** In `pat_service.py`:
  - `owned_token(..., kind)` with `PersonalAccessToken.kind == kind` in the WHERE clause; docstring says it is THE guard for both kinds.
  - `revoke_credential(db, token_id)` and `revoke_owned(db, *, user_id, token_id, kind)` per Interfaces; `revoke_token` becomes `_read(await revoke_owned(..., kind="pat"), "revoked")`. The old inline UPDATE in `revoke_token` is deleted.
  - `list_tokens` and the `create_token` cap count add `PersonalAccessToken.kind == "pat"`.
  - Extract `status_expr()` (the `case(...)` in `list_tokens`) and `user_locked_out()` (the `exists()` in `resolve_principal`) as public functions; `list_tokens` and `resolve_principal` call them. Rename `_new_secret()` to `new_secret(prefix: str)`; `create_token` calls `new_secret(PAT_PREFIX)`.
  - `_read` narrows: `assert row.token_prefix is not None` (a PAT row always has one; the CHECK guarantees it) so `PersonalAccessTokenRead.token_prefix` stays `str`. Run mypy (`cd "$WT" && make lint-backend`); fix any other `str | None` ripple where it surfaces (expected none in `template_versioning/_read.py`, which reads `name` only).
  - Test helpers in `pat_rows.py` per Interfaces (raw `text()` inserts; `insert_oauth_request` computes `expires_at = now() + :interval`).

- [ ] **Step 6: Rules text.** In `.claude/rules/backend.md`, section "Ownership guards", change the entry to `` `pat_service.owned_token` (a personal access token or OAuth connection in its owner; `kind` is part of the predicate) ``.

- [ ] **Step 7: Run green + gates.**

```bash
cd "$WT/backend" && uv run pytest tests/unit tests/integration/test_migration_roundtrip.py tests/integration/test_personal_access_token_rls.py \
  tests/integration/test_pat_service.py tests/integration/test_personal_access_tokens_api.py tests/integration/mcp -q
cd "$WT" && make lint-backend \
  && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/check_rls_coverage.py \
  && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/check_scope_guards.py \
  && bash scripts/fitness/check_migration_split.sh \
  && cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
```

Expected: all PASS / green (including `tests/unit/test_personal_access_tokens_endpoint_unit.py` after the `_read`/`revoke_token` refactor); `uv run alembic check` no diff; no API type change (no public schema edited).

- [ ] **Step 8: Commit.** `git -C "$WT" add backend .claude/rules/backend.md && git -C "$WT" commit -m "feat(db): storage for OAuth connections to the MCP server"`

**Done when:** roundtrip passes both directions with every CHECK present, the three tables are deny-all, PAT list/cap/revoke never see OAuth rows, `owned_token` takes `kind`, one revocation write exists, gates green.

---

### Task 6.2a: Settings, discovery metadata, rate-limit wrapper, CORS bypass, 401 challenge

**Layer:** backend · **Migration:** no · **Commit:** `feat(mcp): OAuth discovery metadata and challenge behind PUBLIC_API_URL`

**Goal:** a fail-closed switch, the RFC 9728 protected-resource metadata and the RFC 8414 authorization-server metadata (both rate-limited through the one OAuth rate-limit wrapper), a path-scoped CORS bypass for the credential-less OAuth paths, and an OAuth-aware 401 challenge at `/mcp`. With `PUBLIC_API_URL` unset, nothing observable changes.

**Files:**
- Modify: `backend/app/core/config.py`
- Modify: `backend/.env.example`
- Modify: `backend/app/utils/rate_limiter.py` (add `client_ip`, `too_many`)
- Modify: `backend/app/core/middleware.py` (add `PathScopedCORSMiddleware`)
- Modify: `docs/adr/0022-oauth-for-mcp.md` (one sentence on `offline_access`)
- Create: `backend/app/services/mcp_oauth_service.py` (this task: the scope constants only)
- Create: `backend/app/api/mcp/oauth/__init__.py` (docstring only), `backend/app/api/mcp/oauth/asgi.py`, `backend/app/api/mcp/oauth/routes.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/api/mcp/asgi_auth.py`
- Modify: `backend/tests/integration/mcp/conftest.py`, `backend/tests/integration/mcp/test_mcp_auth.py`
- Create: `backend/tests/integration/mcp/test_mcp_oauth_discovery.py`, `backend/tests/unit/test_mcp_oauth_asgi.py`
- Modify: `backend/tests/unit/test_mcp_asgi_auth.py`, `backend/tests/unit/test_rate_limiter.py`

**Interfaces:**
- Consumes: nothing from earlier tasks (the switch reads settings only).
- Produces: `settings.PUBLIC_API_URL: str | None`; properties `settings.oauth_enabled -> bool`, `settings.public_api_url -> str` (no trailing slash; raises `RuntimeError` when OAuth is off), `settings.mcp_resource_url -> str` (`public_api_url + "/mcp"`). `mcp_oauth_service.OAUTH_SCOPES: tuple[str, ...] = ("read", "write")` (the granting scopes) and `mcp_oauth_service.OFFLINE_ACCESS = "offline_access"` (a no-op marker: accepted, never granted). `rate_limiter.client_ip(scope: Scope) -> str`; `rate_limiter.too_many(limit: RateLimitItem, *keys: str) -> Response | None` (consumes one hit; `None` = allowed; else a 429 JSON `{"error": "too_many_requests"}` with `Retry-After` from `retry_after`). `asgi.py`: `async read_body(receive: Receive, max_size: int = DEFAULT_MAX_REQUEST_BODY_SIZE) -> bytes | None` (`None` once the body exceeds `max_size`; `DEFAULT_MAX_REQUEST_BODY_SIZE` from `mcp.server.transport_security`); `replay(body: bytes, receive: Receive) -> Receive` (yields the buffered body once, then delegates to `receive`); `ip_key(scope: Scope, body: bytes) -> str` (= `client_ip(scope)`); `class Limited(app, *, limit: RateLimitItem, bucket: str, key: Callable[[Scope, bytes], str], reads_body: bool)`. `routes.py`: `PRM_PATH = "/.well-known/oauth-protected-resource/mcp"`, `AS_METADATA_PATH = "/.well-known/oauth-authorization-server"`, `OAUTH_CORS_PATHS: frozenset[str]` (PRM, AS metadata, `/token`, `/register`, `/revoke`), `resource_metadata_url() -> str`, `build_oauth_routes() -> list[Route]`. `core/middleware.PathScopedCORSMiddleware(app, *, bypass_paths: frozenset[str], **cors_options)`. Test fixtures: `oauth_http_client` (app built with `PUBLIC_API_URL = "http://localhost:8000"`, base URL the same), `OAUTH_BASE_URL`, `PRM_URL`, `expected_challenge(mode: str, *, presented: bool) -> str`, parametrized `auth_mode` / `mode_http_client`.

**Rules for this task:** OAuth is on iff `PUBLIC_API_URL` is non-empty after stripping. PRM `scopes_supported` is exactly `["read", "write"]`; AS metadata `scopes_supported` is exactly `["read", "write", "offline_access"]` (`offline_access` is a no-op marker so hosts that ask for refresh tokens by scope can register; refresh tokens are issued regardless). `Limited` is the only rate-limit wrapper for OAuth routes: it passes non-http scopes and `OPTIONS` straight through without counting; with `reads_body=True` it buffers the body, answers 413 JSON `{"error": "request_too_large"}` without calling the wrapped app when `read_body` returns `None`, and replays the body to the wrapped app; it then calls `too_many(limit, bucket, key(scope, body))` and sends that response when set. PRM and AS metadata: 60/min per IP. The SDK's issuer check accepts only `https` or a localhost `http` issuer, so OAuth-on tests use `http://localhost:8000`, never `http://test`. `api/` modules never import `app.models`. Every symbol added here has a `backend/app` caller in this task.

- [ ] **Step 1: Write the failing tests.**
  - `conftest.py`: extract the body of `mcp_http_client` into `@asynccontextmanager async def _serve(app: FastAPI, base_url: str) -> AsyncIterator[AsyncClient]` (same manager-task pattern, same docstring rationale); `mcp_http_client` becomes `async with _serve(create_app(), "http://test") as c: yield c`. Add `OAUTH_BASE_URL = "http://localhost:8000"`, `PRM_URL = OAUTH_BASE_URL + "/.well-known/oauth-protected-resource/mcp"`, fixture `oauth_http_client(monkeypatch)` (`monkeypatch.setattr(settings, "PUBLIC_API_URL", OAUTH_BASE_URL)` before `create_app()`), fixture `auth_mode` with `params=["oauth_off", "oauth_on"]`, fixture `mode_http_client(auth_mode, monkeypatch)` yielding the matching client, and:

```python
def expected_challenge(mode: str, *, presented: bool) -> str:
    if mode == "oauth_off":
        return "Bearer"
    meta = f'resource_metadata="{PRM_URL}"'
    return f'Bearer error="invalid_token", {meta}' if presented else f"Bearer {meta}"
```

  - `test_mcp_auth.py`: switch `test_missing_or_bad_bearer_is_401`, `test_expired_token_is_401` and `test_revoked_token_is_401` to `mode_http_client` + `auth_mode` and assert `r.headers["www-authenticate"] == expected_challenge(auth_mode, presented=...)` (`no-header` → `presented=False`; `malformed`, `well-formed-unknown`, expired and revoked → `presented=True`). Drop the old `"resource_metadata" not in` assert (the off-mode equality to `"Bearer"` covers it). Add `test_mcp401_bucket_counts_failed_lookups_with_oauth_on(oauth_http_client)`: 30 calls with `Bearer bogus` → all 401; the 31st → 429.
  - `test_mcp_oauth_discovery.py`:
    - `test_prm_document`: `GET PRM_PATH` → 200; `resource == OAUTH_BASE_URL + "/mcp"`; `scopes_supported == ["read", "write"]`; `bearer_methods_supported == ["header"]`.
    - `test_as_metadata_document`: `code_challenge_methods_supported == ["S256"]`; `grant_types_supported == ["authorization_code", "refresh_token"]`; `response_types_supported == ["code"]`; `token_endpoint_auth_methods_supported == ["none"]`; `revocation_endpoint_auth_methods_supported == ["none"]`; `scopes_supported == ["read", "write", "offline_access"]`; `authorization_endpoint`, `token_endpoint`, `registration_endpoint`, `revocation_endpoint` equal `OAUTH_BASE_URL` + `/authorize`, `/token`, `/register`, `/revoke`.
    - `test_prm_issuer_matches_as_metadata_issuer`: `prm["authorization_servers"] == [as_meta["issuer"]]` and `as_meta["issuer"].rstrip("/") == OAUTH_BASE_URL`.
    - `test_metadata_is_404_when_oauth_off` (`mcp_http_client`): both paths → 404.
    - `test_metadata_over_ip_limit_is_429` (parametrized over both paths): 60 GETs → 200; the 61st → 429 with an integer `Retry-After` ≥ 1.
    - `test_preflights_are_not_counted`: 70 `OPTIONS` preflights (`Origin: https://unlisted.example`, `Access-Control-Request-Method: GET`) to AS metadata, then one `GET` → 200.
    - `test_preflight_from_unlisted_origin`: the same preflight → AS metadata and PRM answer `access-control-allow-origin: *` and no `access-control-allow-credentials`; `OPTIONS /api/v1/me/tokens` and `OPTIONS /mcp` with the same headers carry no `*` origin.
    - `test_settings_fail_closed` (pure `Settings(...)` construction): `None`, `""`, `"  "` → `oauth_enabled is False`; `"http://localhost:8000/"` → `mcp_resource_url == "http://localhost:8000/mcp"`.
  - `tests/unit/test_mcp_oauth_asgi.py` (no DB, no httpx; drive `__call__` with hand-built scopes and recorded `send`, as `tests/unit/test_mcp_asgi_auth.py` does):
    - `read_body`: two chunks join; a body over `max_size=8` → `None`.
    - `replay`: the first message carries the buffered body with `more_body=False`; the next call delegates to the original `receive`.
    - `Limited` (a fresh, unique bucket name per test): with `parse("2/minute")`, 5 `OPTIONS` → the inner app runs 5 times and nothing answers 429; 2 `GET` → inner runs; the 3rd → 429 with `retry-after` and the inner app not called; `reads_body=True` with a body over the cap → 413 and the inner app not called; `reads_body=True` with a small body → the inner app receives the identical body; a `lifespan` scope passes straight through; `ip_key` returns the scope's client host.
    - `PathScopedCORSMiddleware`: a preflight to a bypass path from an unlisted origin reaches the inner app untouched (no `access-control-allow-origin` added by the middleware); the same preflight to `/api/v1/x` is answered by `CORSMiddleware` without calling the inner app.
  - `tests/unit/test_mcp_asgi_auth.py`: `_challenge(presented=False)` / `_challenge(presented=True)` with OAuth off → `"Bearer"`; with `monkeypatch.setattr(settings, "PUBLIC_API_URL", "http://localhost:8000")` → the two `resource_metadata` forms above.
  - `tests/unit/test_rate_limiter.py`: `too_many` returns `None` while allowed and a 429 with `Retry-After` once exhausted (use a unique bucket name); `client_ip` with and without `scope["client"]`.

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/unit/test_mcp_oauth_asgi.py tests/unit/test_mcp_asgi_auth.py tests/unit/test_rate_limiter.py tests/integration/mcp/test_mcp_oauth_discovery.py tests/integration/mcp/test_mcp_auth.py -q` → FAIL (no settings, no routes, no wrapper, plain challenge in on-mode).

- [ ] **Step 3: Settings and env example.** In `config.py`, next to `PUBLIC_APP_URL`:

```python
    # Public origin of this API (scheme://host[:port]). Setting it turns OAuth for
    # /mcp ON; unset or empty keeps it OFF (fail closed, ADR 0022).
    PUBLIC_API_URL: str | None = None
```

plus the three properties from Interfaces. `backend/.env.example`: add a commented `# PUBLIC_API_URL=http://localhost:8000` with a one-line comment that setting it turns OAuth for `/mcp` on.

- [ ] **Step 4: Rate-limit helpers and the wrapper.** `rate_limiter.py`: `client_ip(scope)` returns `scope["client"][0]` or `"unknown"`; `too_many(limit, *keys)` calls `hit_shared` and on refusal returns `JSONResponse({"error": "too_many_requests"}, status_code=429, headers={"Retry-After": str(retry_after(limit, *keys))})`. `asgi_auth._unauthorized` uses `client_ip(scope)` instead of its inline lookup (one implementation). `asgi.py`: `read_body`, `replay`, `ip_key`, `Limited` per the Rules above.

- [ ] **Step 5: Routes.** `routes.py` (`build_oauth_routes` is called only when `settings.oauth_enabled`):

```python
_PER_IP_60 = parse("60/minute")


def build_oauth_routes() -> list[Route]:
    issuer = AnyHttpUrl(settings.public_api_url)
    validate_issuer_url(issuer)
    scopes = list(OAUTH_SCOPES)
    # offline_access: accepted no-op marker (listed in AS metadata, never granted).
    registration = ClientRegistrationOptions(
        enabled=True, valid_scopes=[*scopes, OFFLINE_ACCESS], default_scopes=scopes
    )
    revocation = RevocationOptions(enabled=True)
    as_metadata = build_metadata(issuer, None, registration, revocation)
    # Public clients only: the SDK hardcodes the client-secret methods.
    as_metadata.token_endpoint_auth_methods_supported = ["none"]
    as_metadata.revocation_endpoint_auth_methods_supported = ["none"]
    prm = ProtectedResourceMetadata(
        resource=AnyHttpUrl(settings.mcp_resource_url),
        authorization_servers=[issuer],
        scopes_supported=scopes,
    )
    return [
        _metadata_route(PRM_PATH, ProtectedResourceMetadataHandler(prm).handle, "oauth-prm"),
        _metadata_route(AS_METADATA_PATH, MetadataHandler(as_metadata).handle, "oauth-as-meta"),
    ]


def _metadata_route(path: str, handler: Callable[[Request], Awaitable[Response]], bucket: str) -> Route:
    endpoint = Limited(
        cors_middleware(handler, ["GET", "OPTIONS"]),
        limit=_PER_IP_60, bucket=bucket, key=ip_key, reads_body=False,
    )
    return Route(path, endpoint=endpoint, methods=["GET", "OPTIONS"])
```

`resource_metadata_url()` returns `settings.public_api_url + PRM_PATH`. Imports come from `mcp.server.auth.routes` (`build_metadata`, `cors_middleware`, `validate_issuer_url`), `mcp.server.auth.handlers.metadata`, `mcp.server.auth.settings`, `mcp.shared.auth`.

- [ ] **Step 6: CORS bypass + mounting.** `core/middleware.py`:

```python
class PathScopedCORSMiddleware:
    """CORSMiddleware for every path except ``bypass_paths``, which reach the app
    untouched so their own route-level CORS answers (ADR 0022). core/ cannot
    import api/, so main.py passes the paths in."""

    def __init__(self, app: ASGIApp, *, bypass_paths: frozenset[str], **cors_options: Any) -> None:
        self.app = app
        self.cors = CORSMiddleware(app, **cors_options)
        self.bypass_paths = bypass_paths

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["path"] in self.bypass_paths:
            await self.app(scope, receive, send)
            return
        await self.cors(scope, receive, send)
```

`main.py::create_app`: replace `app.add_middleware(CORSMiddleware, ...)` with `app.add_middleware(PathScopedCORSMiddleware, bypass_paths=OAUTH_CORS_PATHS, <the same keyword options>)` (delete the now-unused `CORSMiddleware` import); before appending the `/mcp` route: `if settings.oauth_enabled: app.router.routes.extend(build_oauth_routes())`.

- [ ] **Step 7: 401 challenge.** In `asgi_auth.py`, `_unauthorized(scope, receive, send, *, presented: bool)`; the no-bearer branch passes `presented=False`, the `principal is None` branch `presented=True`; the 401 header comes from:

```python
def _challenge(*, presented: bool) -> str:
    if not settings.oauth_enabled:
        return "Bearer"
    meta = f'resource_metadata="{resource_metadata_url()}"'
    return f'Bearer error="invalid_token", {meta}' if presented else f"Bearer {meta}"
```

The `mcp401` bucket logic is unchanged (every failed lookup counts; the 429 keeps `Retry-After: 60`). Never add a `scope` parameter to the challenge. Update the module docstring: the 401 carries `resource_metadata` only when OAuth is on.

- [ ] **Step 8: Run green + gates.**

```bash
cd "$WT/backend" && uv run pytest tests/unit tests/integration/mcp -q
cd "$WT" && make lint-backend \
  && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/check_layered_arch.py \
  && cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
```

Expected: all PASS (existing `/mcp` suites and `tests/unit/test_cors_config.py` unchanged in behavior); lint, layering and vulture green. No REST schema changed, so no type regeneration.

- [ ] **Step 9: ADR sentence + docs gates.** In `docs/adr/0022-oauth-for-mcp.md`, in the *Scopes and consent* part of Decision Outcome, add one sentence: `The authorization-server metadata also lists \`offline_access\` as a no-op marker so hosts that request refresh tokens by scope can register; refresh tokens are always issued, and the protected-resource metadata stays \`["read","write"]\`.` Refresh its `last_reviewed`. Then `cd "$WT" && bash scripts/docs/check-frontmatter.sh && npx -y markdownlint-cli@0.45.0 --config .github/markdownlint.json docs/adr/0022-oauth-for-mcp.md && npx -y cspell@8.17.5 --config .github/cspell.json docs/adr/0022-oauth-for-mcp.md` → all green (add a genuine term to `.github/cspell-words.txt` if cspell flags it).

- [ ] **Step 10: Commit.** `git -C "$WT" add backend docs/adr/0022-oauth-for-mcp.md .github/cspell-words.txt && git -C "$WT" commit -m "feat(mcp): OAuth discovery metadata and challenge behind PUBLIC_API_URL"`

**Done when:** both modes pass the auth suite; metadata documents match exactly; preflights never count; oversized bodies stop at 413; the CORS bypass applies to the listed paths only; OAuth off is byte-identical to before for `/mcp`.

---

### Task 6.2b: Registration and authorize

**Layer:** backend · **Migration:** no · **Wording:** security-sensitive — describe behavior and tests only · **Commit:** `feat(mcp): OAuth client registration and authorization request`

**Goal:** mount the SDK's register and authorize routes; public-client-only dynamic registration with a redirect allowlist; an authorize step that stores a pending request and redirects to the consent page.

**Files:**
- Modify: `backend/app/core/config.py` (add `MCP_OAUTH_REDIRECT_URIS` and its list property), `backend/.env.example`
- Modify: `backend/app/services/mcp_oauth_service.py`
- Create: `backend/app/api/mcp/oauth/provider.py`
- Modify: `backend/app/api/mcp/oauth/asgi.py` (add `client_id_key`, `PublicClientDefault`)
- Modify: `backend/app/api/mcp/oauth/routes.py`
- Modify: `backend/pyproject.toml` (`[tool.vulture] ignore_names` += `get_client`, `register_client`, `authorize`, with the comment from Global Constraints)
- Create: `backend/tests/integration/mcp/oauth_flow.py` (test helpers), `backend/tests/integration/mcp/test_mcp_oauth_flow.py`, `backend/tests/integration/test_mcp_oauth_service.py`, `backend/tests/unit/test_mcp_oauth_provider.py`
- Modify: `backend/tests/unit/test_mcp_oauth_asgi.py`, `backend/tests/integration/mcp/test_mcp_oauth_discovery.py`

**Interfaces:**
- Consumes (6.1): models `McpOAuthClient`, `McpOAuthRequest`. (6.2a): `settings.oauth_enabled/public_api_url/mcp_resource_url`, `OAUTH_SCOPES`, `OFFLINE_ACCESS`, `client_ip`, `asgi.Limited`, `asgi.read_body`, `asgi.replay`, `asgi.ip_key`, `routes.build_oauth_routes`, fixture `oauth_http_client`, `OAUTH_BASE_URL`.
- Produces (settings): `MCP_OAUTH_REDIRECT_URIS: str = "https://claude.ai/api/mcp/auth_callback"` (comma-separated; read `docs/adr/0022-oauth-for-mcp.md` for the recorded callbacks — only the claude.ai callback is confirmed; claude.com stays on the ADR's rollout checklist and is not in the default), `settings.mcp_oauth_redirect_uris_list -> list[str]`; `backend/.env.example` gets the same default.
- Produces (service): `REQUEST_TTL = timedelta(minutes=10)`, `DEFAULT_CLIENT_NAME = "MCP client"`; `redirect_uri_allowed(uri: str) -> bool`; `async register_client(db, info: OAuthClientInformationFull) -> None` (raises `RegistrationError`); `async get_client(db, client_id: str) -> OAuthClientInformationFull | None`; `async create_request(db, *, client: OAuthClientInformationFull, params: AuthorizationParams) -> UUID` (raises `AuthorizeError`).
- Produces (api): `PrumoOAuthProvider` with `get_client`, `register_client`, `authorize` (each opens `mcp_session.session_factory()` — read through the module so tests rebind it — calls the service and commits writes). `asgi.py`: `client_id_key(scope, body) -> str`, `class PublicClientDefault(app)`.
- Produces (tests, `oauth_flow.py`): `CLAUDE_CB = "https://claude.ai/api/mcp/auth_callback"`, `MCP_URL = OAUTH_BASE_URL + "/mcp"`, `pkce_pair() -> tuple[str, str]` (verifier, S256 challenge), `async register(client, *, redirect_uris=(CLAUDE_CB,), **extra) -> Response`, `async registered_client_id(client, **kw) -> str`, `async authorize(client, client_id, *, challenge, redirect_uri=CLAUDE_CB, scope=None, resource=MCP_URL, state="st", method="S256") -> Response` (GET, no redirect following), `consent_request_id(resp) -> UUID`.

**Behavior:**
- **Registration.** `PublicClientDefault` passes `OPTIONS` and non-http scopes through; otherwise it buffers the body with `read_body` (413 JSON when `None`, the wrapped app not called) and, when the body is a JSON object whose `token_endpoint_auth_method` is missing or `null`, sets it to `"none"` and replays the re-encoded body with a corrected `content-length` header in a copied scope; any other body is replayed unchanged. `register_client` refuses with `RegistrationError("invalid_client_metadata", ...)` when the method is not `"none"`, when there is no redirect URI or more than 5, or when any redirect URI fails `redirect_uri_allowed`. `redirect_uri_allowed(uri)`: `parts = urlsplit(uri)`; false when `parts.username`, `parts.password` or `parts.fragment` is set; true when `uri` is exactly in `settings.mcp_oauth_redirect_uris_list`; true when `parts.scheme == "http"` and the host is exactly `localhost`, `127.0.0.1` or `[::1]` (`parts.hostname` `::1`), any port, any path (the SDK later matches the path exactly as registered); false otherwise. `client_name` is stored stripped and capped at 80 chars, `"MCP client"` when empty. `scope` is stored as the SDK left it (the SDK applies `default_scopes` when omitted and refuses scopes outside `valid_scopes`, which include the `offline_access` marker). An `application_type` field (`"web"` or `"native"`, sent by clients following the MCP 2026-07-28 revision) is accepted: the SDK's `OAuthClientMetadata` declares it, so no code is needed and nothing stores it.
- **get_client** returns `None` for a non-uuid id or a missing row; otherwise `OAuthClientInformationFull(client_id=str(id), client_name, redirect_uris=[...], scope, token_endpoint_auth_method="none", grant_types=["authorization_code", "refresh_token"], response_types=["code"], client_id_issued_at=int(created_at.timestamp()))`.
- **create_request.** If `params.resource` is not `None` and `params.resource.rstrip("/") != settings.mcp_resource_url` → `AuthorizeError("invalid_target", "resource must be this server's MCP endpoint")`. Requested scopes = `params.scopes` or the client's registered `scope.split()`, with `offline_access` removed (a no-op marker: never stored, so never granted). Insert with `expires_at = now() + REQUEST_TTL`, `resource = settings.mcp_resource_url` when one was sent else `NULL`. The provider returns `f"{settings.PUBLIC_APP_URL.rstrip('/')}/oauth/consent?request={request_id}"`. S256-only, unknown client and unregistered redirect URI are enforced by the SDK handler (400 JSON, no `Location`, for the last two).
- **client_id_key** reads `client_id` from the query string, else from an `application/x-www-form-urlencoded` body, else returns `"ip:" + client_ip(scope)`.
- **Routes.** `build_oauth_routes()` keeps its two metadata routes and adds, from `create_auth_routes(cast("OAuthAuthorizationServerProvider[Any, Any, Any]", PrumoOAuthProvider()), issuer, client_registration_options=registration, revocation_options=revocation)` (index the result by path; take each route's `.endpoint`), only these two now: `/authorize` → `Limited(endpoint, limit=parse("30/minute"), bucket="oauth-authorize", key=client_id_key, reads_body=True)` with `methods=["GET", "POST"]`; `/register` → `Limited(PublicClientDefault(endpoint), limit=parse("10/minute"), bucket="oauth-register", key=ip_key, reads_body=False)` with `methods=["POST", "OPTIONS"]`. The SDK's own AS-metadata route is never mounted (ours replaces it); `/token` and `/revoke` are mounted by the task that implements their provider methods. The `cast` is needed because the provider only implements `get_client`, `register_client` and `authorize` so far (no stub methods); the task that adds the token methods removes it. `make lint-backend` (mypy) must be green with the cast in place.

- [ ] **Step 1: Write the failing tests.**
  - `test_mcp_oauth_flow.py` (`oauth_http_client` + `db_session`):
    - register: Claude callback → 201, body `token_endpoint_auth_method == "none"`, no `client_secret`, stored `scope == "read write"`; loopback `http://127.0.0.1:53682/callback`, `http://localhost:1/cb`, `http://[::1]:8080/cb` → 201 each; a body carrying `application_type: "web"` → 201; `scope="read write offline_access"` → 201; `token_endpoint_auth_method="client_secret_post"` → 400 `invalid_client_metadata` and no row; `scope="read ai_run"` → 400 `invalid_client_metadata`; six redirect URIs → 400; a 200-char name stored as 80 chars; no name → `"MCP client"`.
    - authorize: S256 → 302, `Location` starts with `settings.PUBLIC_APP_URL.rstrip("/") + "/oauth/consent?request="`, and the stored request has `requested_scopes == ["read", "write"]` and `resource == MCP_URL`; a client registered without `scope` and an authorize without `scope` → stored `requested_scopes == ["read", "write"]`; `method="plain"` and a missing `code_challenge` → no consent `Location`; `resource="https://other.example/mcp"` → redirect to `CLAUDE_CB` with `error=invalid_target` and no request row; `resource=MCP_URL + "/"` → consent; an unknown `client_id` and an unregistered `redirect_uri` → 400 with no `location` header; a client registered with `scope="read"` asking `scope="read write"` → no consent `Location` (`error=invalid_scope`); a client registered with `read write offline_access` authorizing with `scope="read write offline_access"` → consent, and the stored `requested_scopes == ["read", "write"]`.
    - limits: 10 registrations from one IP → 201; the 11th → 429 with `Retry-After`; 30 authorize calls for one `client_id` → 302; the 31st → 429 with `Retry-After`; another `client_id` still gets 302; 31 authorize calls with no `client_id` → the 31st answers 429 (IP-keyed fallback).
  - `test_mcp_oauth_service.py` (direct service calls on `db_session`, no HTTP):
    - `redirect_uri_allowed`, parametrized: allowed — the claude.ai callback exactly, `http://127.0.0.1:1/cb`, `http://localhost:65535/x`, `http://[::1]:8080/cb`; refused — `https://claude.com/api/mcp/auth_callback` (not in the default list), `https://evil.example/cb`, `http://localhost.evil.example/cb`, `http://127.0.0.1.nip.io/cb`, `http://localhost@evil.example/cb`, `http://claude.ai@127.0.0.1/cb`, `https://localhost/cb`, `http://localhost:1/cb#frag`, `https://claude.ai/api/mcp/auth_callback?x=1`.
    - `register_client` stores name/scope/redirects; refuses a non-`none` method, zero and six redirect URIs, and a refused redirect URI, each with `RegistrationError` code `invalid_client_metadata`.
    - `get_client`: `"not-a-uuid"` → `None`; a random uuid → `None`; a stored client → the full `OAuthClientInformationFull` with `token_endpoint_auth_method == "none"`.
    - `create_request`: stores the request with `expires_at` ≈ now + 10 min; `scopes=["read", "write", "offline_access"]` stores `["read", "write"]`; a foreign `resource` raises `AuthorizeError` with `error == "invalid_target"`; a trailing-slash `resource` is accepted; `scopes=None` takes the client's registered scopes.
  - `tests/unit/test_mcp_oauth_provider.py`: monkeypatch `mcp_session.session_factory` with a factory yielding an `AsyncMock` session, and the service functions with `AsyncMock`s; `get_client` returns the service result without committing; `register_client` calls the service then commits once; `authorize` commits once and returns `settings.PUBLIC_APP_URL.rstrip("/") + "/oauth/consent?request=<id>"`.
  - `tests/unit/test_mcp_oauth_asgi.py`: `client_id_key` from a query string, from a form body, and the `"ip:<host>"` fallback for neither; `PublicClientDefault` — a missing method becomes `"none"`, an explicit `null` becomes `"none"`, an explicit `"client_secret_post"` is kept, a non-JSON body passes through unchanged, the replayed scope's `content-length` equals the new body length, an oversized body → 413 without calling the wrapped app.
  - `test_mcp_oauth_discovery.py`: OAuth off (`mcp_http_client`) → `/authorize` and `/register` both 404; OAuth on → `OPTIONS /register` from `https://unlisted.example` answers `access-control-allow-origin: *`.

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/unit/test_mcp_oauth_asgi.py tests/unit/test_mcp_oauth_provider.py tests/integration/test_mcp_oauth_service.py tests/integration/mcp/test_mcp_oauth_flow.py tests/integration/mcp/test_mcp_oauth_discovery.py -q` → FAIL (routes and service absent).

- [ ] **Step 3: Implement** the settings, service functions, `provider.py`, the `asgi.py` additions and the route wiring per Behavior. The provider imports only `app.services.mcp_oauth_service`, `app.api.mcp.session`, `app.core.config` and SDK modules — never `app.models`.

- [ ] **Step 4: Run green + gates.**

```bash
cd "$WT/backend" && uv run pytest tests/unit tests/integration/test_mcp_oauth_service.py tests/integration/mcp -q
cd "$WT" && make lint-backend \
  && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/check_layered_arch.py \
  && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/check_scope_guards.py \
  && cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
```

Expected: PASS; `make lint-backend` (mypy) green with the `cast` at the `create_auth_routes` call; layering, scope guards and vulture green.

- [ ] **Step 5: Commit.** `git -C "$WT" add backend && git -C "$WT" commit -m "feat(mcp): OAuth client registration and authorization request"`

**Done when:** every registration and authorize case passes over HTTP and at the service level, the redirect rule refuses lookalikes and user info, and limits answer 429 with `Retry-After`.

---

### Task 6.3a: Consent decision service and consent REST API

**Layer:** backend · **Migration:** no · **Wording:** security-sensitive — describe behavior and tests only · **Commit:** `feat(api): consent endpoints for OAuth connections`

**Goal:** the signed-in consent page reads a pending request and records the user's decision through two JWT routes under `/api/v1/oauth`; approval creates the connection and mints the single-use authorization code. The decision service lands here, with its first app caller.

**Files:**
- Create: `backend/app/schemas/mcp_oauth.py`
- Create: `backend/app/api/v1/endpoints/oauth_consent.py`
- Modify: `backend/app/api/v1/router.py` (`api_router.include_router(oauth_consent.router, prefix="/oauth", tags=["oauth-consent"])`, following the existing include lines)
- Modify: `backend/app/services/mcp_oauth_service.py` (add the decision and read functions and their errors)
- Modify: `backend/tests/integration/mcp/oauth_flow.py` (add `approve`)
- Create: `backend/tests/integration/test_oauth_consent_api.py`, `backend/tests/unit/test_oauth_consent_endpoint_unit.py`
- Modify: `backend/tests/integration/test_mcp_oauth_service.py`
- Modify (generated): `frontend/types/api/schema.d.ts`, `frontend/types/api/openapi.json`

**Interfaces:**
- Consumes (6.1): `pat_service.revoke_credential(db, token_id)`, `pat_service.hash_secret`, models `McpOAuthRequest`, `McpOAuthClient`, `PersonalAccessToken`; test helpers `insert_oauth_client`, `insert_oauth_request`, `insert_oauth_connection`. (6.2b): `create_request`, `oauth_flow.register/registered_client_id/authorize/consent_request_id/pkce_pair/CLAUDE_CB`. (6.2a): `settings.oauth_enabled`.
- Produces (schemas, all public, docstrings published): `OAuthConsentRequestRead {client_name: str, redirect_host: str, requested_scopes: list[str], offers_write: bool, expires_at: datetime}`; `OAuthConsentDecisionRequest {approve: bool, write: bool}` with `model_config = ConfigDict(extra="forbid")`; `OAuthConsentDecisionRead {redirect_url: str}`; `OAuthConsentRefusalCode(StrEnum)` with `REQUEST_ALREADY_DECIDED`; `OAuthConsentRefusalError` / `OAuthConsentRefusalResponse` mirroring `PersonalAccessTokenRefusalError` / `PersonalAccessTokenRefusalResponse` in `app/schemas/personal_access_token.py`.
- Produces (service): `CODE_TTL = timedelta(minutes=5)`, `CONNECTION_TTL = timedelta(days=90)`; `class ConsentRequestNotFoundError(NotFoundError)` (`super().__init__("OAuth request", message="This request expired or does not exist.")`); `class ConsentRequestDecidedError(AppError)` (code `OAuthConsentRefusalCode.REQUEST_ALREADY_DECIDED`, message `"This request was already answered."`, status 409); `async get_consent_request(db, *, request_id: UUID) -> OAuthConsentRequestRead`; `async decide_request(db, *, request_id: UUID, user_id: UUID, approve: bool, write: bool) -> str` (the redirect URL; never commits). Both raise the two errors above, with the same precedence: decided is checked before expiry.
- Produces (REST): `GET /api/v1/oauth/requests/{request_id}` → `ApiResponse[OAuthConsentRequestRead]`; `POST /api/v1/oauth/requests/{request_id}/decision` body `OAuthConsentDecisionRequest` → `ApiResponse[OAuthConsentDecisionRead]`. Errors: 404 `NOT_FOUND` (unknown, expired, or OAuth off), 409 `REQUEST_ALREADY_DECIDED`, 422 `VALIDATION_ERROR`, 401 without a JWT, 429 over the limit.
- Produces (tests, `oauth_flow.py`): `async approve(db, request_id, user_id, *, write: bool) -> str` (calls `decide_request`, flushes, returns the `code` query value of the redirect).

**Behavior:**
- **decide_request**, in the caller's transaction, in order:
  1. Lock ONLY the request row: `select(McpOAuthRequest).where(McpOAuthRequest.id == request_id).with_for_update()`, with no join (a `FOR UPDATE` over a join locks every joined row, which would serialize two approvals for the same client on the client row and hide the unique-index conflict). Missing → `ConsentRequestNotFoundError`; `decided_at` set → `ConsentRequestDecidedError`; `expires_at <= now()` → `ConsentRequestNotFoundError`. Read the client name with a separate, unlocked `select(McpOAuthClient.client_name)`.
  2. Deny: set `decided_at = now()`; return `construct_redirect_uri(redirect_uri, error="access_denied", state=state)` (`mcp.server.auth.provider.construct_redirect_uri`).
  3. Approve: select the id of the unrevoked `kind='oauth'` row for this user × client (at most one exists, by the partial unique index; active or already expired) and, when found, `await revoke_credential(db, that_id)`.
  4. Insert the connection: `kind='oauth'`, `name=client_name`, `scope='read_write'` iff `write` and `"write"` ∈ requested scopes else `'read'`, `expires_at = now() + CONNECTION_TTL`, `project_ids=NULL`, `user_id`, `oauth_client_id`. An `IntegrityError` for which `core.integrity.violates_constraint(exc, "uq_personal_access_tokens_oauth_user_client")` is true → `ConsentRequestDecidedError` (a concurrent approval for the same user × client won).
  5. `code = secrets.token_urlsafe(32)`; set `decided_at`, `user_id`, `connection_id`, `code_hash = hash_secret(code)`, `code_expires_at = now() + CODE_TTL`; return `construct_redirect_uri(redirect_uri, code=code, state=state)`.
- **get_consent_request**: the same lookup without a lock; `redirect_host` = `urlsplit(redirect_uri).netloc` (host and port, shown in full); `offers_write` = `"write" in requested_scopes`.
- **Endpoints:** the GET declares `dependencies=[Depends(get_current_user_sub)]` in its decorator (it reads no user); the POST takes `user_id: UUID = Depends(get_current_user_sub)` — the user binds to the request only here, from the JWT. Both start with `if not settings.oauth_enabled: raise ConsentRequestNotFoundError()` (checked per request, so the routes are always mounted and the OpenAPI schema does not depend on the environment). No try/except: the global handler maps both errors. The POST commits once after `decide_request` returns. `@limiter.limit("60/minute")` on the GET, `@limiter.limit("20/minute")` on the POST; each takes `request: Request`. Declare `responses=` for 401/404/409/422/429 with descriptions (`check_response_descriptions.py`).
- A POST with `write=true` on a request that did not ask for `write` grants `read`.

- [ ] **Step 1: Write the failing tests.**
  - `test_oauth_consent_api.py` (a fixture `oauth_on(monkeypatch)` sets `settings.PUBLIC_API_URL = "http://localhost:8000"`; requests run through `client_as(str(<profile>), db_session)` from `tests.integration.helpers.engine_setup`):
    - GET a pending `read write` request → 200 with `client_name == "Claude"`, `redirect_host == "claude.ai"`, `requested_scopes == ["read", "write"]`, `offers_write is True`; a `read`-only request → `offers_write is False`.
    - GET unknown id → 404 envelope (`ok is False`, `error.code == "NOT_FOUND"`); expired (`expires_in=-timedelta(minutes=1)`) → 404; `/requests/not-a-uuid` → 422 with `error.code == "VALIDATION_ERROR"`; OAuth off (no `oauth_on`) → 404 for GET and POST.
    - JWT required: a client built from `create_app()` with only `get_db` overridden gets 401 on GET and POST.
    - Scope matrix, parametrized `(requested, write, expected)`: `(("read","write"), True, "read_write")`, `(("read","write"), False, "read")`, `(("read",), True, "read")`, `(("read",), False, "read")`; the response `redirect_url` carries `code` and `state`; one case runs as `SEED.reviewer_profile` and asserts the connection's `user_id` is that profile.
    - Previous connection revoked: an existing unrevoked connection for the same user × client has `revoked_at` after approval, and exactly one unrevoked row remains; a previous connection that expired without a revoke (`created_at` 100 days ago, `expires_at` 10 days ago) is revoked too and the approval succeeds.
    - Decided: after approve, GET → 409 `REQUEST_ALREADY_DECIDED` and POST → 409; decided and then pushed past `expires_at` → 409 on GET and POST; POST on an expired undecided request → 404.
    - Deny: POST `{approve: false, write: false}` → `redirect_url` has `error=access_denied` and `state`; the row has `decided_at`, NULL `connection_id` and NULL `code_hash`; later GET and POST → 409.
    - Extra body field (`{"approve": true, "write": false, "extra": 1}`) → 422.
    - `test_consent_routes_rate_limited` (`oauth_on`): 60 GETs on a random uuid → 404 each; the 61st → 429; 20 POSTs on a random uuid → 404 each; the 21st → 429.
  - `test_mcp_oauth_service.py` (direct calls on `db_session`): `decide_request` approve with `write=True` → redirect starts with the request's `redirect_uri`, carries `code` and `state=st`; the connection has `kind='oauth'`, `scope='read_write'`, `name` = client name, `expires_at` within a minute of `now() + 90 days`; the request has `decided_at`, `connection_id`, and a `code_hash` that is not the code. Deny → `error=access_denied`, no connection, NULL `code_hash`. A decided request → `ConsentRequestDecidedError`; an expired one → `ConsentRequestNotFoundError`; a decided and expired one → `ConsentRequestDecidedError`. `get_consent_request` returns the view; same three errors.
  - Concurrent approvals in `test_mcp_oauth_service.py` (`_engine`, two real sessions, committed setup, cleanup in `finally` by deleting the client, which cascades): one client, two pending requests for `SEED.primary_profile`; session A runs `decide_request` on request 1 without committing; `asyncio.create_task` runs it on request 2 in session B; after `asyncio.sleep(0.2)` the task is not done (it waits on the unique index, not on any row lock); commit A; the task raises `ConsentRequestDecidedError`; exactly one unrevoked oauth row exists for that user × client.
  - `tests/unit/test_oauth_consent_endpoint_unit.py` (handlers via `oauth_consent.<name>.__wrapped__`, collaborators monkeypatched on the endpoint module, a fake `db` with `commit = AsyncMock()`, a `SimpleNamespace` request with and without `state.trace_id`, as in `tests/unit/test_personal_access_tokens_endpoint_unit.py`): OAuth off → both handlers raise `ConsentRequestNotFoundError` and never call the service; GET returns `ApiResponse` with the service's view and the trace id (and `None` without one); POST passes the `user_id` argument and the body flags to `decide_request`, commits once and returns the redirect; POST when `decide_request` raises `ConsentRequestDecidedError` re-raises it and does not commit.

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/unit/test_oauth_consent_endpoint_unit.py tests/integration/test_oauth_consent_api.py tests/integration/test_mcp_oauth_service.py -q` → FAIL.

- [ ] **Step 3: Implement** the schemas, the service functions and errors, the endpoint module, the router include and `oauth_flow.approve` per Behavior.

- [ ] **Step 4: Run green + contract + gates.**

```bash
cd "$WT/backend" && uv run pytest tests/unit tests/integration/test_oauth_consent_api.py tests/integration/test_mcp_oauth_service.py tests/integration/mcp -q
cd "$WT" && npm run generate:api-types && make lint-backend \
  && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/check_api_response_envelope.py \
  && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/check_response_descriptions.py \
  && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/check_layered_arch.py \
  && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/check_scope_guards.py \
  && npx vitest run frontend/test/apiSchemaDrift.test.ts \
  && cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
```

Expected: PASS; the regenerated types include the three schemas; a second `npm run generate:api-types` leaves no diff; vulture green (`decide_request` and `get_consent_request` have the endpoint as caller).

- [ ] **Step 5: Commit.** `git -C "$WT" add backend frontend/types/api && git -C "$WT" commit -m "feat(api): consent endpoints for OAuth connections"`

**Done when:** the full matrix passes, the concurrent approval yields one connection and a 409-class error, the handlers are covered directly, and the API types are regenerated.

---

### Task 6.2c: Code exchange, refresh rotation, revoke, prune

**Layer:** backend · **Migration:** no · **Wording:** security-sensitive — describe behavior and tests only · **Commit:** `feat(mcp): OAuth token exchange, refresh rotation, revocation and pruning`

**Goal:** mount `/token` and `/revoke` and complete the provider: single-use codes, opaque access and refresh tokens with rotation and reuse detection, revocation, inline pruning, and the token/revoke limits.

**Files:**
- Modify: `backend/app/services/mcp_oauth_service.py`
- Modify: `backend/app/api/mcp/oauth/provider.py`
- Modify: `backend/app/api/mcp/oauth/routes.py` (mount `/token`, `/revoke`; remove the `cast` around `PrumoOAuthProvider()`)
- Modify: `backend/pyproject.toml` (`ignore_names` += `load_authorization_code`, `exchange_authorization_code`, `load_refresh_token`, `exchange_refresh_token`, `load_access_token`, `revoke_token`)
- Modify: `backend/tests/integration/mcp/oauth_flow.py`, `backend/tests/integration/mcp/test_mcp_oauth_flow.py`, `backend/tests/integration/mcp/test_mcp_oauth_discovery.py`, `backend/tests/integration/test_mcp_oauth_service.py`, `backend/tests/unit/test_mcp_oauth_provider.py`
- Create: `backend/tests/unit/test_mcp_oauth_service_unit.py`

**Interfaces:**
- Consumes (6.1): `pat_service.hash_secret`, `pat_service.new_secret(prefix)`, `pat_service.active_clause()`, `pat_service.revoke_credential(db, token_id)`, models `McpOAuthToken`, `McpOAuthRequest`, `McpOAuthClient`, `PersonalAccessToken`; test helpers `insert_oauth_client(..., created_at_offset=...)`, `insert_oauth_request(..., expires_in=...)`, `insert_oauth_connection`. (6.3a): `decide_request`, `oauth_flow.approve`. (6.2b): `PrumoOAuthProvider` (`register_client` gains the prune call), `asgi.Limited`, `asgi.ip_key`, `asgi.client_id_key`, `oauth_flow.register/registered_client_id/authorize/consent_request_id/pkce_pair/CLAUDE_CB/MCP_URL`. (6.2a): `settings.mcp_resource_url`, `OFFLINE_ACCESS`, fixtures `oauth_http_client`, `mcp_http_client`.
- Produces (service): `ACCESS_PREFIX = "prumo_oat_"`, `REFRESH_PREFIX = "prumo_ort_"`, `ACCESS_TTL = timedelta(hours=1)`; `granted_scopes(scope: str) -> list[str]` (`'read'` → `["read"]`, `'read_write'` → `["read", "write"]`); `async load_code(db, *, client_id: str, code: str) -> AuthorizationCode | None`; `async exchange_code(db, *, client_id: str, code: str) -> OAuthToken` (raises `TokenError`); `async load_refresh(db, *, client_id: str, token: str) -> RefreshToken | None`; `async rotate_refresh(db, *, client_id: str, token: str) -> OAuthToken` (raises `TokenError`); `async _active_access_row(db, secret: str, *extra: ColumnElement[bool]) -> tuple[McpOAuthToken, PersonalAccessToken] | None` (private); `async load_access(db, token: str) -> AccessToken | None`; `async revoke_connection_by_token(db, token: str) -> None`; `async prune(db) -> None`.
- Produces (tests, `oauth_flow.py`): `async exchange(client, client_id, code, verifier, redirect_uri=CLAUDE_CB) -> Response`; `async refresh(client, client_id, refresh_token, scope=None) -> Response`; `async revoke(client, client_id, token) -> Response`; `@dataclass OAuthTokens(client_id: str, access: str, refresh: str, connection_id: UUID)`; `async connect(client, db, user_id, *, write: bool = True) -> OAuthTokens` (register → authorize → `approve` → exchange; `connection_id` read from the decided request).

**Behavior:**
- **load_code:** by `code_hash = hash_secret(code)` and `client_id`; `None` when missing; otherwise an `AuthorizationCode` with `scopes = granted_scopes(connection.scope)`, `expires_at = code_expires_at.timestamp()`, the stored `code_challenge`, `redirect_uri`, `redirect_uri_provided_explicitly`, `resource`, `subject = str(user_id)`. No reuse check here: the SDK then checks expiry, client, redirect URI and the PKCE verifier, and reuse is detected only in `exchange_code`.
- **exchange_code:** lock the request row `FOR UPDATE` by `code_hash` (no join); if `code_used_at` is set → `await revoke_credential(db, connection_id)` and raise `TokenError("invalid_grant")` (reuse detection lives only here and in `rotate_refresh`, under the row lock); if the connection fails `active_clause()` or `code_expires_at <= now()` → `TokenError("invalid_grant")`; set `code_used_at = now()`; insert an access row (`expires_at = now() + ACCESS_TTL`) and a refresh row (`expires_at` = the connection's `expires_at`), both with `resource = request.resource or settings.mcp_resource_url`, secrets from `new_secret(ACCESS_PREFIX)` / `new_secret(REFRESH_PREFIX)` stored as hashes; set the client's `last_used_at = now()`; return `OAuthToken(access_token=..., token_type="Bearer", expires_in=3600, refresh_token=..., scope=" ".join(granted_scopes(connection.scope)))`. A code presented again after its 5-minute expiry is refused by the SDK's expiry check (`invalid_grant`) before `exchange_code` runs.
- **load_refresh:** by hash with `kind='refresh'` and the connection's `oauth_client_id == client_id`; `None` when missing or when the connection is not active; else `RefreshToken(token, client_id, scopes=[*granted_scopes(...), OFFLINE_ACCESS], expires_at=int(...), resource, subject)` — the `offline_access` marker is listed so a refresh that repeats it passes the SDK's subset check; the response scope stays the granted string. The SDK refuses a requested scope outside those scopes (`invalid_scope`), so a refresh never widens.
- **rotate_refresh:** lock the refresh row `FOR UPDATE`; `rotated_at` already set (a replay, or a concurrent use) → `await revoke_credential(db, connection_id)` and `TokenError("invalid_grant")`; connection not active → `TokenError("invalid_grant")`; set `rotated_at = now()`, mint a new pair exactly as `exchange_code` does, return its `OAuthToken` (scope = the connection's granted string).
- **One active-access-token lookup.** `_active_access_row(db, secret, *extra)` is THE lookup of a live access token: one query joining `McpOAuthToken` to its connection row with `McpOAuthToken.token_hash == hash_secret(secret)`, `McpOAuthToken.kind == "access"`, `McpOAuthToken.expires_at > now()`, `PersonalAccessToken.kind == "oauth"`, `active_clause()`, plus any `extra` predicates; returns `(token_row, connection_row)` or `None`. No other function in `mcp_oauth_service.py` re-types these predicates (the `/mcp` principal resolver added later builds on it).
- **load_access:** `_active_access_row(db, token)` → `AccessToken(token, client_id=str(connection.oauth_client_id), scopes=granted_scopes(connection.scope), expires_at=int(...), resource)`, or `None`.
- **revoke_connection_by_token:** find the token row by hash (either kind) and `await revoke_credential(db, row.connection_id)`. Revoking either token revokes the connection.
- **prune** (called by `PrumoOAuthProvider.register_client` after the insert, same transaction): delete clients older than 24 h with no `personal_access_tokens` row referencing them; requests that are undecided and past `expires_at`, or decided more than 24 h ago; tokens past `expires_at` or rotated more than 1 h ago.
- **Provider:** each method opens `mcp_session.session_factory()`, calls the service, commits writes. When `exchange_code` or `rotate_refresh` raises `TokenError`, the provider commits first (the reuse revocation must persist) and re-raises. `revoke_token(token)` calls `revoke_connection_by_token(db, token.token)` and commits.
- **Routes:** call `create_auth_routes(PrumoOAuthProvider(), ...)` without the `cast` (the provider now implements the whole protocol), and add `/token` → `Limited(endpoint, limit=parse("60/minute"), bucket="oauth-token", key=client_id_key, reads_body=True)` with `methods=["POST", "OPTIONS"]`, and `/revoke` → `Limited(endpoint, limit=parse("60/minute"), bucket="oauth-revoke", key=ip_key, reads_body=False)` with `methods=["POST", "OPTIONS"]`, taking each `.endpoint` from the same `create_auth_routes(...)` result the authorize and register routes use.

- [ ] **Step 1: Write the failing tests.**
  - `test_mcp_oauth_flow.py` (HTTP, `oauth_http_client`):
    - token: `exchange` after approve with `write=True` → 200, `access_token` starts with `prumo_oat_`, `refresh_token` with `prumo_ort_`, `token_type == "Bearer"`, `expires_in == 3600`, `scope == "read write"`; with `write=False` → `scope == "read"`; a flow whose client registered and authorized with `read write offline_access` → `scope == "read write"` (no `offline_access`) and a `refresh_token` is present; no stored `token_hash` equals a returned secret. Wrong verifier → 400 `invalid_grant`; expired code (`UPDATE mcp_oauth_requests SET code_expires_at = now() - interval '1 minute'`) → 400 `invalid_grant`; a different `redirect_uri` → 400; another client's `client_id` → 400; reused code → 400 `invalid_grant`, the connection now has `revoked_at`, and a refresh with the first pair's refresh token → 400 `invalid_grant`.
    - refresh: rotation returns a new pair and stamps the old refresh row's `rotated_at`; presenting the rotated token again → 400 `invalid_grant` and the connection is revoked, so the new refresh token also gets `invalid_grant`; a read connection refreshing with `scope="read write"` → 400 `invalid_scope`; a `read_write` connection refreshing with `scope="read write offline_access"` → 200 with `scope == "read write"`; after the connection expires (`UPDATE personal_access_tokens SET created_at = now() - interval '100 days', expires_at = now() - interval '1 day'`) → `invalid_grant`; after revocation → `invalid_grant`.
    - revoke: `revoke` with the access token → 200 and the connection has `revoked_at`; with the refresh token → same; then a refresh → `invalid_grant`.
    - limits: 60 token calls for one `client_id` → not 429; the 61st → 429 with `Retry-After`; 60 revoke calls from one IP → not 429; the 61st → 429.
    - prune: a client inserted with `created_at_offset=-timedelta(hours=25)` and no connection is gone after one `register`; the same age with a connection survives; a request inserted with `expires_in=-timedelta(minutes=1)` is gone; a request approved just now survives a `register` and its code still exchanges; an access row with `expires_at` in the past is gone.
  - `test_mcp_oauth_discovery.py`: OAuth off → `/token` and `/revoke` 404; OAuth on → `OPTIONS /token` and `OPTIONS /revoke` from `https://unlisted.example` answer `access-control-allow-origin: *`.
  - `test_mcp_oauth_service.py` (direct calls on `db_session`, codes from `oauth_flow.approve`): `load_code` returns the code's challenge, scopes and redirect, and `None` for an unknown code or another client; `exchange_code` returns the pair and stamps `code_used_at`; a second `exchange_code` raises `TokenError` `invalid_grant` and leaves the connection revoked; `exchange_code` on a revoked connection raises `invalid_grant`; `load_refresh` → `None` for unknown token and for a revoked connection; `rotate_refresh` returns a new pair; a second `rotate_refresh` with the same token raises `invalid_grant` and revokes; `load_access` returns the token and `None` once expired or once its connection is revoked; `_active_access_row` with an extra predicate that is false → `None`; `revoke_connection_by_token` with either kind revokes; `prune` deletes exactly the rows described in Behavior.
  - `tests/unit/test_mcp_oauth_service_unit.py`: `granted_scopes("read") == ["read"]`, `granted_scopes("read_write") == ["read", "write"]`.
  - `tests/unit/test_mcp_oauth_provider.py`: each new provider method delegates to its service function and commits on success; when `exchange_code` / `rotate_refresh` raises `TokenError`, the provider commits once and re-raises the same error; `register_client` calls `prune` after the insert and commits once; `revoke_token` passes `token.token`.

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/unit/test_mcp_oauth_service_unit.py tests/unit/test_mcp_oauth_provider.py tests/integration/test_mcp_oauth_service.py tests/integration/mcp/test_mcp_oauth_flow.py tests/integration/mcp/test_mcp_oauth_discovery.py -q` → FAIL.

- [ ] **Step 3: Implement** per Behavior.

- [ ] **Step 4: Run green + gates.**

```bash
cd "$WT/backend" && uv run pytest tests/unit tests/integration/test_mcp_oauth_service.py tests/integration/test_pat_service.py tests/integration/mcp -q
cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh \
  && cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
```

Expected: PASS; `make lint-backend` (mypy) green with no `cast` left at the `create_auth_routes` call; fitness and vulture green.

- [ ] **Step 5: Commit.** `git -C "$WT" add backend && git -C "$WT" commit -m "feat(mcp): OAuth token exchange, refresh rotation, revocation and pruning"`

**Done when:** codes are single-use and bound, refresh rotates with reuse detection in one place per grant, revoke ends the connection, pruning keeps live codes, and every provider method and service function has a direct test.

---

### Task 6.3b: OAuth principal at `/mcp`

**Layer:** backend · **Migration:** no · **Wording:** security-sensitive — describe behavior and tests only · **Commit:** `feat(mcp): accept OAuth access tokens at /mcp`

**Goal:** `/mcp` accepts a `prumo_oat_` access token when OAuth is on and resolves it to the same `McpPrincipal` shape as a PAT, so nothing below the auth layer changes. REST keeps refusing non-JWT bearers with no code change.

**Files:**
- Modify: `backend/app/services/mcp_oauth_service.py` (add `resolve_principal`)
- Modify: `backend/app/api/mcp/asgi_auth.py` (dispatch by prefix)
- Modify: `backend/app/schemas/mcp_auth.py` (docstring: a PAT or an OAuth connection; `token_id` is the credential row id)
- Modify: `backend/tests/integration/helpers/pat_rows.py` (add `insert_oauth_access_token`)
- Modify: `backend/tests/integration/mcp/conftest.py` (add `seed_oauth_principal`)
- Modify: `backend/tests/integration/mcp/test_mcp_choke_point.py` (module-level fixture overrides)
- Modify: `backend/tests/integration/mcp/test_mcp_auth.py` (OAuth-off case for a `prumo_oat_` bearer)
- Modify: `backend/tests/integration/test_template_config_status.py` (draft label from an OAuth connection)
- Modify: `backend/tests/integration/test_mcp_oauth_service.py`, `backend/tests/unit/test_mcp_asgi_auth.py`
- Create: `backend/tests/integration/mcp/test_mcp_oauth_principal.py`
- If the published schema text changed: regenerate `frontend/types/api/*` (`McpPrincipal` is internal, so expected no diff)

**Interfaces:**
- Consumes (6.2c): the private `mcp_oauth_service._active_access_row(db, secret, *extra) -> tuple[McpOAuthToken, PersonalAccessToken] | None` (THE live-access-token lookup: hash, `kind='access'`, `expires_at > now()`, oauth connection passing `active_clause()`, plus `extra` predicates). (6.1): `pat_service.user_locked_out()`, `pat_service.touch_last_used`, models; test helpers `insert_oauth_client`, `insert_oauth_connection`. (6.2c): `ACCESS_PREFIX`, `oauth_flow.connect/refresh/revoke/OAuthTokens`. (6.2a): `settings.oauth_enabled`, `settings.mcp_resource_url`, fixtures `oauth_http_client`, `mcp_http_client`, `expected_challenge`. Existing: `rpc(client, method, params, headers)` in `tests/integration/mcp/rpc.py`; `SeededPat(secret, principal)` in `tests/integration/mcp/conftest.py`.
- Produces: `async mcp_oauth_service.resolve_principal(db, secret: str) -> McpPrincipal | None`; `asgi_auth._resolve(db, secret) -> McpPrincipal | None`; test helpers `async insert_oauth_access_token(db, *, connection_id: UUID, secret: str, resource: str, expires_in: timedelta = timedelta(hours=1)) -> UUID` and `async seed_oauth_principal(db, monkeypatch, user_id: UUID, scope: Literal["read", "read_write"]) -> SeededPat`.

**Behavior:**
- `resolve_principal(db, secret)` builds on the one lookup and never re-types its predicates: `None` unless `secret` starts with `ACCESS_PREFIX`; otherwise `row = await _active_access_row(db, secret, McpOAuthToken.resource == settings.mcp_resource_url, ~user_locked_out())` (one query: the shared hash/kind/expiry/active-connection predicates plus the resource check and the locked-out check); `None` when it returns `None`; else, with `connection` = the connection row, it returns `McpPrincipal(user_sub=connection.user_id, token_id=connection.id, scope=connection.scope, token_expires_at=connection.expires_at, project_ids=None if connection.project_ids is None else frozenset(connection.project_ids))` — `token_id` is the connection id, so `agent_actions.token_id`, the draft label and rate-limit keys work unchanged.
- `asgi_auth._serve`: the lookup becomes `await _resolve(db, secret)`:

```python
async def _resolve(db: AsyncSession, secret: str) -> McpPrincipal | None:
    if settings.oauth_enabled and secret.startswith(ACCESS_PREFIX):
        return await mcp_oauth_service.resolve_principal(db, secret)
    return await resolve_principal(db, secret)
```

  Everything else (`touch_last_used`, the 503 mapping, the in-flight cap, the `mcp401` bucket, the OAuth-aware 401 challenge) is unchanged. With OAuth off, a `prumo_oat_` bearer reaches the PAT resolver, which returns `None` → plain `Bearer` 401.
- REST: no code change. An opaque token fails `verify_supabase_jwt`; the test proves it.
- States the host sees: valid → 200; access token expired → 401 `invalid_token` (the host refreshes); connection revoked or expired → 401 (the host asks the user to reconnect); scope too narrow → write tools hidden, and a direct call answers `SCOPE_INSUFFICIENT`.

- [ ] **Step 1: Write the failing tests.**
  - `test_mcp_oauth_principal.py` (`oauth_http_client`, `db_session`, `oauth_flow.connect`):
    - `test_read_connection_hides_write_tools`: `connect(..., write=False)` as `SEED.primary_profile`; `tools/list` over `/mcp` with `Authorization: Bearer <access>` → 200; `update_project_details` absent, `list_projects` present.
    - `test_read_write_manager_applies_update_project_details`: `connect(..., write=True)`; `tools/call` `update_project_details` with `{"project_id": str(SEED.primary_project), "fields": {"description": "New"}, "expected": {"description": <current>}}` (read the current value first, as `test_mcp_update_project_details.py` does) → applied; the newest `agent_actions` row for that tool has `token_id == tokens.connection_id`.
    - `test_after_revoke_401`: `revoke(...)` the access token → the next `/mcp` call → 401 with `expected_challenge("oauth_on", presented=True)`.
    - `test_expired_access_token_401_then_refresh_works`: push the access row's `expires_at` into the past → 401; `refresh(...)` → 200; the new access token → 200.
    - `test_resource_mismatch_is_401`: `UPDATE mcp_oauth_tokens SET resource = 'https://other.example/mcp'` for that access row → 401.
    - `test_expired_connection_is_401` and `test_banned_user_is_401` (set `auth.users.banned_until` in the future for a throwaway user, as `test_pat_service.py::test_resolve_principal_refuses_banned_or_deleted_user` does).
    - `test_last_used_stamps_the_connection`: after one call, the connection row's `last_used_at = now()`.
    - `test_oauth_token_on_rest_is_401`: `GET /api/v1/me/tokens` on `oauth_http_client` (no dependency overrides) with the access token → 401.
    - `test_failed_oauth_lookups_count_in_mcp401_bucket`: 30 calls with `Bearer prumo_oat_` + 43 × `"a"` → 401; the 31st → 429.
    - `test_ai_run_scope_never_reachable`: a client registered with `read write` that authorizes with `scope="ai_run"` gets no consent `Location`. (The registration-side refusal is pinned where registration is tested; it is not repeated here.)
  - `test_mcp_oauth_service.py` (direct): `resolve_principal` returns the principal for a valid token (`token_id` = connection id, `scope` from the row), and `None` for a PAT-prefixed secret, an unknown token, an expired access row, a resource mismatch, a revoked connection, an expired connection and a banned user.
  - `tests/unit/test_mcp_asgi_auth.py`: `_resolve` with OAuth on and a `prumo_oat_` secret calls the OAuth resolver only; with OAuth off and the same secret calls the PAT resolver only; with a `prumo_pat_` secret calls the PAT resolver only (both resolvers monkeypatched as `AsyncMock`).
  - `test_mcp_auth.py`: `test_oat_bearer_with_oauth_off_is_plain_401` (`mcp_http_client`, `Bearer prumo_oat_` + 43 × `"a"`) → 401 with `www-authenticate == "Bearer"`.
  - `test_mcp_choke_point.py`: add at module top two overriding fixtures, so every existing test there runs with both principal kinds:

```python
@pytest_asyncio.fixture(params=["pat", "oauth"])
async def pat_primary_rw(request, pat_primary_rw, db_session, monkeypatch):
    if request.param == "pat":
        return pat_primary_rw
    return await seed_oauth_principal(db_session, monkeypatch, SEED.primary_profile, "read_write")
```

  and the same for `pat_primary_read` with `"read"`.
  - `test_template_config_status.py`: `test_agent_edit_by_oauth_connection_shows_client_name` — the existing `_agent_action` helper with the id from `insert_oauth_connection(db, user_id=SEED.primary_profile, client_id=await insert_oauth_client(db, client_name="Claude"), name="Claude")` → `status.agent_edit_token_name == "Claude"`.

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/unit/test_mcp_asgi_auth.py tests/integration/mcp/test_mcp_oauth_principal.py tests/integration/mcp/test_mcp_choke_point.py tests/integration/test_mcp_oauth_service.py -q` → FAIL (every OAuth bearer is 401; `seed_oauth_principal` and `_resolve` missing).

- [ ] **Step 3: Implement** `resolve_principal`, `_resolve`, the helpers (`insert_oauth_access_token` stores `hash_secret(secret)` with `kind='access'`; `seed_oauth_principal` sets `settings.PUBLIC_API_URL = "http://localhost:8000"` through `monkeypatch`, inserts client + connection + access token with `secret = "prumo_oat_" + 43 random base62 chars` and `resource = settings.mcp_resource_url`, resolves it with `mcp_oauth_service.resolve_principal`, and returns `SeededPat(secret, principal)`), and the docstring update.

- [ ] **Step 4: Run green + gates.**

```bash
cd "$WT/backend" && uv run pytest tests/unit tests/integration/mcp tests/integration/test_template_config_status.py tests/integration/test_pat_service.py tests/integration/test_mcp_oauth_service.py -q
cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh \
  && cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
```

Expected: PASS (the choke-point suite runs twice per test); gates green.

- [ ] **Step 5: Commit.** `git -C "$WT" add backend && git -C "$WT" commit -m "feat(mcp): accept OAuth access tokens at /mcp"`

**Done when:** an OAuth access token behaves exactly like a PAT of the same scope at `/mcp`, every refusal is a 401 that counts against the per-IP bucket, and REST rejects it.

---

### Task 6.4a: Sign-in return path and frame headers

**Layer:** frontend · **Migration:** no · **Wording:** security-sensitive — describe behavior and tests only · **Commit:** `feat(auth): return to the requested page after sign-in`

**Goal:** a signed-out visit to a protected page (the consent page in particular, with its `?request=` query) comes back to that page after sign-in; only same-origin relative paths are honored; pages under `/oauth/` cannot be framed. Independent of every backend task.

**Files:**
- Modify: `frontend/lib/routes.ts` (add `safeReturnPath`)
- Modify: `frontend/components/ProtectedRoute.tsx`
- Modify: `frontend/pages/Auth.tsx` (`LoginForm` and `RegisterForm`)
- Modify: `vercel.json`
- Create: `frontend/test/components/ProtectedRoute.test.tsx`, `frontend/test/vercelHeaders.test.ts`

**Interfaces:**
- Produces: `safeReturnPath(from: unknown): string` in `frontend/lib/routes.ts`; `ProtectedRoute` navigates to `/auth` with router state `{from: string}` (pathname + search + hash).

**Behavior:**

```ts
/** A same-origin relative path to return to after sign-in; "/" for anything else. */
export function safeReturnPath(from: unknown): string {
  if (typeof from !== 'string' || !from.startsWith('/') || from.startsWith('//')) return '/';
  const url = new URL(from, window.location.origin);
  return url.origin === window.location.origin ? `${url.pathname}${url.search}${url.hash}` : '/';
}
```

- `ProtectedRoute`: call `useLocation()` at the top (before the early returns, rules of hooks) and redirect with the full location as state:

```tsx
const location = useLocation();
// ...after the loading branch:
if (!user) {
  return <Navigate to="/auth" replace state={{from: `${location.pathname}${location.search}${location.hash}`}} />;
}
```

- `Auth.tsx`: `LoginForm` and `RegisterForm` read `useLocation().state` and, where they now call `navigate("/")` (sign-in success; sign-up with `sessionReady`), call `navigate(safeReturnPath((location.state as {from?: unknown} | null)?.from))`. Email-confirmation sign-up keeps its current behavior (no return path through the confirmation email; the consent request expires anyway).
- `vercel.json` `headers` gains `{"source": "/oauth/(.*)", "headers": [{"key": "X-Frame-Options", "value": "DENY"}, {"key": "Content-Security-Policy", "value": "frame-ancestors 'none'"}]}`; the `/assets/(.*)` entry and the rewrites stay unchanged.
- No `try/finally` and no `throw` inside `try` in these components (React Compiler).

- [ ] **Step 1: Write the failing tests.**
  - `ProtectedRoute.test.tsx`: mock `@/contexts/AuthContext` with a mutable `user` (starts `null`) and `@/services/authService` so `signInWithPassword` sets `user = {id: 'u1'}` and resolves `{ok: true, data: ...}`. Render a `MemoryRouter` (`initialEntries={['/oauth/consent?request=abc']}`) with routes `/oauth/consent` → `<ProtectedRoute><LocationProbe/></ProtectedRoute>` (`LocationProbe` renders `pathname + search`), `/auth` → `<Auth/>`, `/` → `<div>home</div>`. Fill `#login-email` / `#login-password` (labels `t('auth', 'email')`, `t('auth', 'password')`), submit → the probe shows `/oauth/consent?request=abc`. Parametrized hostile `state.from` (`'//evil.example/x'`, `'https://evil.example/x'`, `'/\\evil.example'`, `42`, `undefined`) with `initialEntries={[{pathname: '/auth', state: {from}}]}` → after submit, `home`. A sign-up with `sessionReady: true` and `state.from = '/settings'` lands on `/settings`. Direct unit cases for `safeReturnPath` (`'/a?b=1#c'` kept; the hostile values → `'/'`).
  - `vercelHeaders.test.ts`: read `vercel.json` with `fs.readFileSync(path.resolve(__dirname, '../../vercel.json'), 'utf8')`; assert one `headers` entry with `source === '/oauth/(.*)'` carrying both headers with the exact values above.

- [ ] **Step 2: Run red.** `cd "$WT" && npx vitest run frontend/test/components/ProtectedRoute.test.tsx frontend/test/vercelHeaders.test.ts` → FAIL.

- [ ] **Step 3: Implement** per Behavior.

- [ ] **Step 4: Run green + gates.** `cd "$WT" && npx vitest run frontend/test/components/ProtectedRoute.test.tsx frontend/test/vercelHeaders.test.ts frontend/test/appShell.routes.test.tsx && npm run typecheck && npm run lint && npx knip && npx knip --production` → all green / 0 findings.

- [ ] **Step 5: Commit.** `git -C "$WT" add frontend vercel.json && git -C "$WT" commit -m "feat(auth): return to the requested page after sign-in"`

**Done when:** the return path survives sign-in with its query string, hostile values fall back to `/`, and `/oauth/*` sends both frame headers.

---

### Task 6.4b: Consent page

**Layer:** frontend · **Migration:** no · **Wording:** security-sensitive — describe behavior and tests only · **Commit:** `feat(oauth): consent page for connecting an app`

**Goal:** `/oauth/consent?request=<id>` shows who is asking and what they get, lets the user allow (with an unchecked "Edit project setup" box when offered) or deny, and sends the browser back to the client.

**Files:**
- Create: `frontend/pages/OAuthConsent.tsx`
- Create: `frontend/services/oauthConsentService.ts`
- Create: `frontend/hooks/user/useOAuthConsent.ts`
- Create: `frontend/lib/copy/oauthConsent.ts`
- Create: `frontend/lib/navigation.ts` (`leaveApp`)
- Modify: `frontend/App.tsx` (lazy route), `frontend/lib/copy/index.ts` (register `oauthConsent`), `frontend/lib/query-keys/me.ts` (add `oauthRequest`)
- Create: `frontend/test/pages/OAuthConsent.test.tsx`, `frontend/test/services/oauthConsentService.test.ts`
- Modify: `frontend/test/appShell.routes.test.tsx` (route registration case)

**Interfaces:**
- Consumes: regenerated types (Task 6.3a) `components['schemas']['OAuthConsentRequestRead']`, `['OAuthConsentDecisionRequest']`, `['OAuthConsentDecisionRead']`; REST `GET /api/v1/oauth/requests/{id}` and `POST /api/v1/oauth/requests/{id}/decision` (404 `NOT_FOUND`, 409 `REQUEST_ALREADY_DECIDED`, 429); `ProtectedRoute` with return path (Task 6.4a).
- Produces: `fetchConsentRequest(id: string): Promise<ErrorResult<OAuthConsentRequestRead>>`, `decideConsentRequest(id: string, body: OAuthConsentDecisionRequest): Promise<ErrorResult<OAuthConsentDecisionRead>>`, `isRequestGoneError(e: Error)` (ApiError, status 404), `isAlreadyDecidedError(e: Error)` (code `REQUEST_ALREADY_DECIDED`), `isRateLimitedError(e: Error)` (status 429); hooks `useConsentRequest(requestId: string | null)` (`useQuery`, key `meKeys.oauthRequest(requestId ?? '')`, `enabled: requestId !== null`, `retry: false`) and `useDecideConsent(requestId: string)` (`useMutation`, no cache invalidation: the page leaves the app on success); `meKeys.oauthRequest: (id: string) => [...meKeys.all, 'oauth-request', id] as const`; `leaveApp(url: string): void` (`window.location.assign(url)`).

**Behavior:**
- Route `<Route path="/oauth/consent" element={<ProtectedRoute><OAuthConsent/></ProtectedRoute>}/>` beside the run routes, outside `AppShell` (a standalone page), with `const OAuthConsent = lazy(() => import('./pages/OAuthConsent'))`.
- `requestId` = `useSearchParams().get('request')`, accepted only when `z.string().uuid()` parses it; otherwise the page shows the expired state and sends no request.
- Ready view: page title; the client name; "Returns you to" + the full `redirect_host`; the line "Access to every prumo project you belong to; your project role still applies."; a fixed "Read your projects" item; when `offers_write`, a checkbox "Edit project setup", unchecked by default, with the hint "Manager-only; nothing goes live until a manager publishes."; buttons Allow and Deny. When `offers_write` is false there is no checkbox and the POST always sends `write: false`. One `useState(false)` for the checkbox; no form library (one box, two buttons).
- Allow → `{approve: true, write: <box>}`; Deny → `{approve: false, write: false}`; on success call `leaveApp(redirect_url)` and show the "Returning to the app…" state.
- States: loading; expired (GET 404, missing or malformed `?request=`, or POST 404) → "This request expired. Start again from Claude."; already decided (409 on GET or POST); read-only request (no box); submitting (buttons disabled, spinner); error with Retry (GET failure → refetch; POST failure → resubmit the same body), with "Too many attempts. Wait a minute and try again." for a 429; returning.
- Copy keys in `oauthConsent.ts`: `pageTitle`, `loading`, `clientLabel`, `returnsTo`, `accessAll`, `readItem`, `editLabel`, `editHint`, `allow`, `deny`, `submitting`, `returning`, `expiredTitle`, `expiredBody`, `decidedTitle`, `decidedBody`, `loadError`, `submitError`, `rateLimited`, `retry`. Visual language: a centered single card in the style of `pages/Auth.tsx` (`frontend-ux` skill for spacing and states).
- No `try/finally` and no `throw` inside `try` in the page or hooks (React Compiler); services return `ErrorResult` and never toast.

- [ ] **Step 1: Write the failing tests.**
  - `oauthConsentService.test.ts` (mock `apiClient` as `frontend/test/services/personalAccessTokenService.test.ts` does): GET path `/api/v1/oauth/requests/<id>`; POST path `/api/v1/oauth/requests/<id>/decision` with `{method: 'POST', body: {approve: true, write: false}}`; the three predicates on matching and non-matching `ApiError`s.
  - `OAuthConsent.test.tsx` (MSW via `server.use(http.get('*/api/v1/oauth/requests/:id', ...))`, following the auth stub of an existing MSW test such as `frontend/test/components/AiEngineSection.test.tsx`; `vi.mock('@/lib/navigation')` to spy on `leaveApp`; render in a `MemoryRouter` at `/oauth/consent?request=<uuid>` with a fresh `QueryClient`): loading text first; ready with the box unchecked; Allow with the box ticked posts `{approve: true, write: true}` and calls `leaveApp` with the returned URL; Allow unticked posts `write: false`; Deny posts `{approve: false, write: false}` and calls `leaveApp` with the `error=access_denied` URL; a read-only request renders no checkbox; GET 404 → expired copy; GET 409 → decided copy; no `?request=` and `?request=abc` → expired copy and no request sent (a handler counter stays at 0); POST 404 → expired copy; POST 409 → decided copy; POST 429 → rate-limited copy, and Retry resubmits; GET 500 → load error, and Retry refetches; while the POST is pending both buttons are disabled.
  - `appShell.routes.test.tsx`: mock `@/pages/OAuthConsent` (`default: () => <div>consent page</div>`) next to the existing page mocks; a case `renders the consent page outside the app shell` → `renderAt('/oauth/consent?request=11111111-1111-4111-8111-111111111111')` finds `consent page` and `queryByTestId('app-shell')` is `null` (same shape as `does not wrap the full-screen run routes`).

- [ ] **Step 2: Run red.** `cd "$WT" && npx vitest run frontend/test/pages/OAuthConsent.test.tsx frontend/test/services/oauthConsentService.test.ts frontend/test/appShell.routes.test.tsx` → FAIL.

- [ ] **Step 3: Implement** per Behavior.

- [ ] **Step 4: Run green + gates.** `cd "$WT" && npx vitest run frontend/test/pages/OAuthConsent.test.tsx frontend/test/services/oauthConsentService.test.ts frontend/test/appShell.routes.test.tsx && npm run typecheck && npm run lint && npx knip && npx knip --production && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/check_copy_keys.py && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/check_react_query_keys.py && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/check_frontend_data_path.py` → green / 0 findings. Then render the page (`design-review` skill) at desktop and narrow widths in the loading, ready and expired states.

- [ ] **Step 5: Commit.** `git -C "$WT" add frontend && git -C "$WT" commit -m "feat(oauth): consent page for connecting an app"`

**Done when:** every state renders, the route is registered outside the app shell, the POST carries exactly the user's choice, and leaving the app goes only to the server-built redirect URL.

---

### Task 6.5a: Connected apps REST API

**Layer:** backend · **Migration:** no · **Commit:** `feat(api): list and revoke OAuth connections`

**Goal:** a user lists their OAuth connections and revokes one; revocation is idempotent and immediately ends `/mcp` access and refresh.

**Files:**
- Modify: `backend/app/schemas/mcp_oauth.py` (add `OAuthConnectionRead`)
- Modify: `backend/app/services/mcp_oauth_service.py` (add `list_connections`, `revoke_connection`)
- Modify: `backend/app/api/v1/endpoints/personal_access_tokens.py` (two routes; module docstring mentions connections)
- Modify: `backend/tests/integration/test_personal_access_tokens_api.py`, `backend/tests/integration/test_mcp_oauth_service.py`, `backend/tests/integration/mcp/test_mcp_oauth_principal.py`, `backend/tests/unit/test_personal_access_tokens_endpoint_unit.py`
- Modify (generated): `frontend/types/api/schema.d.ts`, `frontend/types/api/openapi.json`

**Interfaces:**
- Consumes (6.1): `pat_service.revoke_owned(db, *, user_id, token_id, kind)` (THE ownership guard `owned_token` with `kind` in the WHERE clause, then the one revocation write `revoke_credential`; raises `TokenNotFoundError`), `pat_service.status_expr()`, `pat_service.active_clause()`; test helpers `insert_oauth_client`, `insert_oauth_connection`. (6.2c/6.3b) `oauth_flow.connect/refresh`, fixture `oauth_http_client`.
- Produces: `OAuthConnectionRead {id: UUID, client_name: str, scope: TokenScope, status: TokenStatus, created_at: datetime, last_used_at: datetime | None, expires_at: datetime}` (reuse `TokenScope`/`TokenStatus` from `app/schemas/personal_access_token.py`); `async list_connections(db, *, user_id: UUID) -> list[OAuthConnectionRead]` (`kind == 'oauth'`, active first then newest, limit 50, `client_name` = the row `name`); `async revoke_connection(db, *, user_id: UUID, connection_id: UUID) -> OAuthConnectionRead` (calls `revoke_owned(..., kind="oauth")`); REST `GET /api/v1/me/oauth-connections` → `ApiResponse[list[OAuthConnectionRead]]` (`list_my_connections`, `@limiter.limit("60/minute")`), `DELETE /api/v1/me/oauth-connections/{connection_id}` → `ApiResponse[OAuthConnectionRead]` (`revoke_my_connection`, `@limiter.limit("20/minute")`, 404 "Connection not found" for missing and foreign alike).

**Behavior:** the paths are `/oauth-connections` on the existing `/me` router in `personal_access_tokens.py` (never `/me/connections`: that path belongs to the LLM-connections router in `endpoints/user_connections.py`). The routes do not branch on `settings.oauth_enabled` (while OAuth is dark no connection rows exist, so the list is empty; a user can still revoke a leftover row). DELETE answers 200 with the envelope, also on a repeat. No second ownership predicate: the list filters `user_id` only, and the revoke goes through `revoke_owned`. The DELETE handler maps the existing `TokenNotFoundError` to `HTTPException(404, "Connection not found")` exactly as its sibling `revoke_my_token` does, and commits after the revoke.

- [ ] **Step 1: Write the failing tests.**
  - `test_personal_access_tokens_api.py`: GET `/api/v1/me/oauth-connections` as the owner lists their connection (fields as in `OAuthConnectionRead`, `status == "active"`) and not another user's; the PAT list `/api/v1/me/tokens` excludes oauth rows and the connections list excludes PATs; DELETE another user's connection id → 404; DELETE a PAT id through `/oauth-connections/{id}` → 404; `GET /api/v1/me/connections` still answers the LLM-connections list (unchanged shape); DELETE twice → 200 both times with `status == "revoked"`; an expired connection lists as `"expired"`. `test_connection_routes_rate_limited`: 60 GETs → 200; the 61st → 429; 20 DELETEs of a random uuid → 404; the 21st → 429.
  - `test_mcp_oauth_service.py` (direct): `list_connections` returns only the caller's oauth rows with statuses; `revoke_connection` revokes an owned row, is idempotent, and raises `TokenNotFoundError` for a foreign row and for a PAT id.
  - `tests/unit/test_personal_access_tokens_endpoint_unit.py`: `_list_connections = pat_endpoints.list_my_connections.__wrapped__` and `_revoke_connection = pat_endpoints.revoke_my_connection.__wrapped__` with the service monkeypatched on the endpoint module: list returns the envelope with the trace id (and `None` without one) and never commits; revoke commits once and returns the row; revoke maps `TokenNotFoundError` to `HTTPException` 404 and does not commit.
  - `test_mcp_oauth_principal.py`: `test_revoke_connection_ends_mcp_and_refresh` — `connect(...)`, then `revoke_connection(db_session, user_id=SEED.primary_profile, connection_id=tokens.connection_id)` (the service the DELETE route calls) → `/mcp` with the access token → 401; `refresh(...)` → 400 `invalid_grant`.

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/unit/test_personal_access_tokens_endpoint_unit.py tests/integration/test_personal_access_tokens_api.py tests/integration/test_mcp_oauth_service.py tests/integration/mcp/test_mcp_oauth_principal.py -q` → FAIL (404 route, missing service).

- [ ] **Step 3: Implement** per Interfaces and Behavior; the endpoint shape copies `list_my_tokens` / `revoke_my_token` (declare 401/404 `responses`).

- [ ] **Step 4: Run green + contract + gates.**

```bash
cd "$WT/backend" && uv run pytest tests/unit tests/integration/test_personal_access_tokens_api.py tests/integration/test_mcp_oauth_service.py tests/integration/mcp -q
cd "$WT" && npm run generate:api-types && make lint-backend \
  && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/check_api_response_envelope.py \
  && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/check_response_descriptions.py \
  && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/check_scope_guards.py \
  && npx vitest run frontend/test/apiSchemaDrift.test.ts \
  && cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
```

Expected: PASS; a second `npm run generate:api-types` leaves no diff; vulture green.

- [ ] **Step 5: Commit.** `git -C "$WT" add backend frontend/types/api && git -C "$WT" commit -m "feat(api): list and revoke OAuth connections"`

**Done when:** owner-only listing, kind-scoped idempotent revoke, both limits pinned, handlers covered directly, and revocation ends `/mcp` access and refresh.

---

### Task 6.5b: Connected apps in Settings, then the slice-end checks

**Layer:** frontend (+ slice-end verification) · **Migration:** no (re-checks the number) · **Commit:** `feat(settings): list and revoke connected apps`

**Goal:** Settings → Integrations shows a "Connected apps" group listing the user's OAuth connections with scope and status badges and a confirmed revoke; then the whole branch passes the slice-end gates, including the migration-number re-check and diff coverage.

**Files:**
- Create: `frontend/components/user/ConnectedAppsGroup.tsx`
- Create: `frontend/services/oauthConnectionsService.ts`
- Create: `frontend/hooks/user/useOAuthConnections.ts`
- Create: `frontend/lib/copy/connectedApps.ts`
- Modify: `frontend/lib/copy/index.ts` (register `connectedApps`), `frontend/lib/query-keys/me.ts` (add `oauthConnections`), `frontend/components/user/IntegrationsSection.tsx` (render the group after `PersonalAccessTokensGroup`; docstring says five groups)
- Create: `frontend/test/components/ConnectedAppsGroup.test.tsx`, `frontend/test/services/oauthConnectionsService.test.ts`, `frontend/test/hooks/useOAuthConnections.test.tsx`
- Modify: `frontend/test/components/IntegrationsSection.test.tsx` (group and heading counts 4 → 5)
- Only if the migration number moved (Step 6): `backend/alembic/versions/0083_mcp_oauth.py` (rename), `backend/tests/integration/test_migration_roundtrip.py`

**Interfaces:**
- Consumes: regenerated `components['schemas']['OAuthConnectionRead']` (Task 6.5a); `GET /api/v1/me/oauth-connections`, `DELETE /api/v1/me/oauth-connections/{id}` (not `/api/v1/me/connections`, which is the LLM-connections list).
- Produces: `fetchMyConnections(): Promise<ErrorResult<OAuthConnectionRead[]>>`, `revokeMyConnection(id: string): Promise<ErrorResult<void>>`; hooks `useMyOAuthConnections()` (key `meKeys.oauthConnections()`) and `useRevokeOAuthConnection()` (invalidates `meKeys.oauthConnections()` on success); `meKeys.oauthConnections: () => [...meKeys.all, 'oauth-connections'] as const` (distinct from the existing `meKeys.connections()`, which is the LLM connections list).

**Behavior:** the group renders one `SettingsGroup` as its root, like `PersonalAccessTokensGroup`. States: loading (skeleton rows); empty ("No apps connected"); list rows with the client name, a "Read" badge plus an "Edits" badge when `scope === 'read_write'`, a "Revoked" or "Expired" badge by `status`, and last-used text; a revoke `IconButton` on active rows opening an `AlertDialog` confirm; pending (confirm button disabled with a spinner); revoke failed → `toast.error` and the row stays; error with Retry (refetch). Copy keys in `connectedApps.ts`: `groupTitle`, `groupHint`, `listLoading`, `listEmpty`, `listLoadError`, `retry`, `badgeRead`, `badgeEdits`, `badgeRevoked`, `badgeExpired`, `lastUsed`, `neverUsed`, `revokeLabel`, `revokeTitle`, `revokeBody`, `revokeConfirm`, `revokeCancel`, `revokeFailed`, `revoked`. No entry point to create a connection here (connections are created from the client).

- [ ] **Step 1: Write the failing tests.**
  - `oauthConnectionsService.test.ts` (mock `apiClient` like `personalAccessTokenService.test.ts`): GET `/api/v1/me/oauth-connections`; DELETE `/api/v1/me/oauth-connections/<id>` with `{method: 'DELETE'}`; `{ok: false}` on an `ApiError`.
  - `useOAuthConnections.test.tsx` (pattern: `frontend/test/hooks/usePersonalAccessTokens.test.tsx`, services mocked, a real `QueryClient` with `vi.spyOn(client, 'invalidateQueries')`): `useRevokeOAuthConnection` invalidates exactly `{queryKey: meKeys.oauthConnections()}` on success; a service `{ok: false, error}` rejects the mutation with that error and does not invalidate; `useMyOAuthConnections` uses `meKeys.oauthConnections()` and surfaces a service error as the query error; `meKeys.oauthConnections()` equals `['me', 'oauth-connections']` and differs from `meKeys.connections()`.
  - `ConnectedAppsGroup.test.tsx` (pattern: `PersonalAccessTokensGroup.test.tsx`): loading; empty copy; a `read` row shows only "Read"; a `read_write` row shows "Read" and "Edits"; revoked and expired badges; the revoke confirm calls the mutation with the row id; a failing revoke shows the `revokeFailed` toast and the row stays; a load error shows Retry, which refetches.
  - `IntegrationsSection.test.tsx`: 5 groups and 5 level-2 headings.

- [ ] **Step 2: Run red.** `cd "$WT" && npx vitest run frontend/test/components/ConnectedAppsGroup.test.tsx frontend/test/services/oauthConnectionsService.test.ts frontend/test/hooks/useOAuthConnections.test.tsx frontend/test/components/IntegrationsSection.test.tsx` → FAIL.

- [ ] **Step 3: Implement** per Behavior.

- [ ] **Step 4: Run green + frontend gates.** `cd "$WT" && npm run test:run && npm run typecheck && npm run lint && npx knip && npx knip --production && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/check_copy_keys.py && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/check_react_query_keys.py && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/check_frontend_data_path.py` → green / 0 findings. Then render Settings → Integrations (`design-review` skill) with the empty state and a two-row list.

- [ ] **Step 5: Commit.** `git -C "$WT" add frontend && git -C "$WT" commit -m "feat(settings): list and revoke connected apps"`

- [ ] **Step 6: Re-check the migration number against `origin/dev`.** `git -C "$WT" fetch origin dev` (a single command, so it runs outside the sandbox), then `git -C "$WT" ls-tree -r --name-only origin/dev backend/alembic/versions | grep -E '/0083_'`. No output → nothing to do. Any output means `dev` took 0083: merge `origin/dev` into the branch, then rename together the file (`<next free>_mcp_oauth.py`), `revision`, `down_revision` (= `dev`'s head), the module docstring's revision lines, `expected_head` and the roundtrip test's name and its downgrade target in `test_migration_roundtrip.py`; re-run `cd "$WT/backend" && uv run alembic upgrade head && uv run pytest tests/integration/test_migration_roundtrip.py -q` → PASS, and commit `fix(db): renumber the OAuth migration after dev`.

- [ ] **Step 7: Slice-end backend gates and diff coverage.**

```bash
cd "$WT/backend" && uv run pytest tests/ --cov=app --cov-report=xml -q \
  && uv run diff-cover coverage.xml --compare-branch=origin/dev --fail-under=80
cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh \
  && cd "$WT/backend" && uv run alembic check \
  && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
```

Expected: full suite PASS; diff coverage ≥ 80%; all gates green. A file under 80% gets its missing direct test (unit for handlers/wrappers/provider, service-level for services) in a `test(mcp): ...` commit before the PR opens.

**Done when:** every connected-apps state renders, the revoke invalidates the connections key (pinned by the hook test), the migration number is current against `dev`, and the full suite, diff coverage and every gate are green.

---

## Slice end

- After merge: `make quality-scan` on the merge SHA; record the result in the PR.
- OAuth stays off in every deployed environment; enablement, the claude.ai entry point, the `clientsNote` rewrite, the how-to section and the ADR 0022 rollout checklist belong to a later slice. PRU-88 stays open (`Refs PRU-88` in the PR body).
