---
status: draft
last_reviewed: 2026-09-23
owner: '@raphaelfh'
---

# Researcher MCP Server — Design Spec

**Date:** 2026-09-23
**Status:** Draft, revised after an adversarial code review and a SOTA survey
(MCP spec 2026-07-28, Python SDK v2). Awaiting written-spec review.

## 1. Decision summary

- prumo exposes a **remote MCP server** so researchers can pair
  header-capable AI agents (Claude Code, Cursor, VS Code, Gemini CLI) with
  their prumo projects.
- Mounted **inside the existing FastAPI app** (Streamable HTTP, `mcp` Python
  SDK v2 `MCPServer`, stateless) on the same Railway service. Tools call
  existing services through the same gates as the REST endpoints.
- Auth is **Personal Access Token only** (`Authorization: Bearer
  prumo_pat_…`). No OAuth is planned; web chat clients (claude.ai per-user
  connectors, ChatGPT) require OAuth and are therefore not supported.
- The agent can:
  - chat with an article's or a project's content (extracted markdown,
    keyword search, short-lived signed PDF URL);
  - review data extractions, respecting blind review;
  - read and edit the project's descriptive fields (whitelist);
  - adjust questionnaires with **isolated operations only**: add a question
    or edit a question's wording/instructions. These are invisible to
    reviewers and to AI extraction until a human publishes.
- Every write is recorded in an append-only `agent_actions` table
  (constitution §IX).

## 2. Context and verified premises

- **`par` is separate.** The `par` plugin's local `prumo mcp serve` works on
  local files (Zotero, Markdown wiki) and never sees web-app data. This
  server is the web-app counterpart; the two stay independent.
- **The API layer is the only guard.** The backend DB session is
  service-role (RLS bypassed). Every tool must pass
  `ensure_project_member` / `ensure_project_manager`
  (`app/api/deps/security.py`); article-scoped tools first resolve the
  article's project (`get_article_project_id`, the `_gate_article` pattern in
  `app/api/v1/endpoints/articles.py`).
- **Blind review.** Members may not read peers' in-flight values
  (migration 0025). The backend enforces this with `run_reveals_peers`
  (`app/services/extraction_run_read_service.py`): finalized unblinds
  everyone, consensus unblinds arbitrators, otherwise only callers who may
  see peers.
- **The template "draft" is the live structure tables, and it is only
  partly isolated.** The 0048 trigger stamps `config_draft_since`; runs pin
  a version snapshot; `republish` (UI "Publish") re-pins. Verified leaks:
  - AI extraction sends `snapshot ∩ live` fields
    (`section_extraction_service.py`), so a field deleted in the draft stops
    being extracted immediately.
  - `open_or_resume` materializes instances from **live** entity types
    (`hitl_session_service.py`), so a draft-added section gets instances
    before publish.
  - Proposals are normalized against **live** `allowed_values`
    (`extraction_proposal_service.py`), so changing options affects live
    runs.
  - Discard is partial: sections with instances are kept, and reverted
    options can strand values (`template_discard_service.py` D4/D6).

  Verified isolated: a field **added** live is invisible until publish
  re-pins, and structure plus instructions come from the pinned snapshot.
  §5.2 allows only these operations.
- **Project text fields feed prompts, pinned per run.** `review_context`,
  `eligibility_criteria` etc. reach LLM prompts through
  `run_prompt_context`, which pins them per run (first writer wins). An edit
  affects only runs started afterwards, the same as a UI edit today.
- **Stale docstring.** `template_version_service.py` still says template
  edits go through the Supabase client; typed endpoints
  (`template_structure.py`) replaced that path. A sibling
  `refactor(templates): …` commit corrects the docstring.

## 3. Architecture

```
agent ──HTTP POST (Bearer prumo_pat_…)──▶ FastAPI  Mount("/mcp")
                                           └─ app/api/mcp/
                                              ├─ server.py   MCPServer, tool registry, scope filter
                                              ├─ auth.py     ASGI PAT wrapper → {user_sub, token_id, scopes}
                                              ├─ errors.py   service exception → MCP error code
                                              └─ tools/*.py  thin adapters
                                                   │ ensure_project_member / _manager
                                                   ▼
                                           existing services + new: pat_service,
                                           project_details_service, agent_action_service
```

- **Placement.** `app/api/mcp/` sits inside the api layer, so it inherits
  `check_layered_arch` rules: no `app.models.*` imports in tools. A new
  top-level `app/mcp/` would be unclassified and fail the gate.
- **SDK.** `mcp` SDK v2 (≥ 2.2) is added to `backend/pyproject.toml`.
  Configuration:
  - `mcp.streamable_http_app(streamable_http_path="/",
    stateless_http=True, json_response=True, transport_security=
    TransportSecuritySettings(allowed_hosts=[<API host>],
    allowed_origins=[…]))`. Origin and Host validation is required for
    Streamable HTTP; a wrong Host gets 421.
  - The app `lifespan` in `app/main.py` wraps
    `async with mcp.session_manager.run()`. A mounted sub-app's lifespan
    does not run on its own.
- **`json_response=True`.** Replies are plain JSON, not SSE. In SSE mode the
  existing `TimingMiddleware` / `LoggingMiddleware` measure time to first
  byte (0.8 ms reported against 600 ms real, in the spike), which would make
  MCP latency logs wrong. The cost is no progress notifications, which v1
  tools do not need.
- **Stateless.** MCP spec 2026-07-28 is stateless, which fits Railway
  round-robin. No sessions, no SSE resumability, no server-to-client
  requests (no sampling, no elicitation).
- **Middleware (verified by spike, see §3.1).** The three
  `BaseHTTPMiddleware`s (`app/core/middleware.py`) and CORS pass MCP
  responses through intact in both JSON and SSE modes, and still add
  `X-Trace-Id` / `X-Response-Time`. No exclusion is needed. `/mcp` is
  excluded from the Supabase JWT dependency, the `ApiResponse` envelope and
  the REST error handler.
- **PAT auth is our own pure-ASGI wrapper around the mount, not the SDK's
  `token_verifier`.** The SDK accepts a `token_verifier` only together with
  OAuth `AuthSettings` (`issuer_url` required). Those settings make every
  401 advertise `resource_metadata=<root>/.well-known/oauth-protected-resource/mcp`,
  and when the app is mounted that URL returns 404; the metadata is served
  under `/mcp/.well-known/…` instead. With no OAuth planned, advertising it
  would point clients at a broken OAuth discovery. The wrapper validates the
  PAT and returns `401 WWW-Authenticate: Bearer`. It places
  `{user_sub, token_id, scopes}` in a contextvar that tools read.

### 3.1 Spike evidence (2026-09-23, throwaway, not kept)

Setup: FastAPI 0.136.3, Starlette 1.3.1 (the repo's lock), `mcp` 2.2.0,
uvicorn, the three middlewares and CORS as registered in `app/main.py`,
MCP mounted at `/mcp`.

| Check | SSE mode | JSON mode |
|---|---|---|
| SDK client `initialize` + `tools/list` + `tools/call` | ok | ok |
| 200 KB tool result intact through middlewares | ok | ok |
| Progress notifications delivered | ok (3) | none (by design) |
| `X-Trace-Id` / `X-Response-Time` added | yes | yes |
| `X-Response-Time` accuracy (600 ms tool) | 0.8 ms (wrong) | 602.8 ms |
| Invalid bearer | 401 | 401 |
| Disallowed Host | 421 | 421 |

Claude Code (`claude -p`, HTTP transport with a static `Authorization`
header):

- A `resource_link` is rendered to the model as text:
  `[Resource link: a.pdf] <uri>`. The URL is visible even without a text
  copy.
- Given the link, the agent downloaded the PDF with `curl -sL` (2.2 MB) and
  read it with `Read`, quoting the exact title and the first sentence of the
  abstract.
- Cursor, VS Code and Gemini CLI rendering of `resource_link` was not
  tested. §5.1 keeps the URL in a text block for them.
- **DB sessions.** Tools open their own session via `AsyncSessionLocal`
  (`app/core/deps.py`), one per tool call, not the request-scoped
  `DbSession`.

## 4. Auth — Personal Access Tokens

### 4.1 Table `personal_access_tokens` (Alembic migration)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `user_id` | uuid fk `public.profiles.id` ON DELETE CASCADE | owner |
| `name` | text | user label, e.g. "Claude Code laptop" |
| `token_prefix` | text | first 16 chars, shown in the UI |
| `token_hash` | text unique | SHA-256 of the full secret |
| `scopes` | text | `read` \| `read_write` |
| `expires_at` | timestamptz not null | default now + 90 days; max 365 |
| `last_used_at` | timestamptz null | |
| `revoked_at` | timestamptz null | |
| `created_at` | timestamptz | |

- Secret: `prumo_pat_` + 32 random bytes (base62), shown **once**. Unsalted
  SHA-256 with an indexed equality lookup is adequate for 256-bit random
  secrets.
- At most **10 active tokens per user** (creation beyond that → 409).
- Backend-only table: RLS enabled with a deny-all policy plus
  `REVOKE ALL … FROM authenticated, anon`, following migration 0055
  (`project_llm_endpoints`).

### 4.2 REST endpoints (Supabase JWT only)

- `POST /api/v1/me/tokens` `{name, scopes, expires_in_days}` → secret once.
- `GET /api/v1/me/tokens` → list without secrets.
- `DELETE /api/v1/me/tokens/{id}` → sets `revoked_at`.
- Every query has `user_id = <caller>` in the WHERE clause
  (`check_scope_guards.py`). These endpoints use the JWT dependency only, so
  a PAT cannot mint a PAT. Route prefix is confirmed against existing `me`
  routes at plan time.

### 4.3 `/mcp` authentication

- The ASGI PAT wrapper (§3) resolves `Authorization: Bearer prumo_pat_…` to
  `{user_sub, token_id, scopes}`. Missing, malformed, unknown, expired or
  revoked → HTTP 401 with `WWW-Authenticate: Bearer` and no
  `resource_metadata`.
- `last_used_at` is updated at most once per minute per token.
- **Membership is re-checked on every tool call.** A user removed from a
  project loses access immediately even if the token is still valid.
  Archived projects remain readable: `is_active` is not access control
  (`project_archive.py`).

### 4.4 Permission model

- Effective permission = project role ∩ token scope.
- `read` scope: write tools are absent from `tools/list` (the spec allows
  authorization-dependent listings); direct calls are refused
  `SCOPE_INSUFFICIENT`.
- Write tools require `read_write` **and** `ensure_project_manager`.

### 4.5 Settings UI

- New "AI agents" tab in user settings: create a token (name, scope,
  expiry), secret shown once with copy, list (name, prefix, scope, last
  used, expiry), revoke.
- Copy-ready snippets for Claude Code
  (`claude mcp add --transport http prumo <url>/mcp --header "Authorization: Bearer <token>"`),
  Cursor (`mcp.json` `headers`), VS Code (`.vscode/mcp.json` `headers`)
  and Gemini CLI (`httpUrl` + `headers`).
- States plainly that web chat apps (claude.ai, ChatGPT) are not supported.
- Copy strings live in `frontend/lib/copy/`.

## 5. Tools

Conventions (MCP 2026-07-28 and Anthropic tool-writing guidance):

- Every tool has a `title`, `readOnlyHint` / `destructiveHint` /
  `idempotentHint` annotations and an `outputSchema`.
- It returns `structuredContent` plus a text copy.
- Tools are listed in a deterministic order.
- Explicit IDs everywhere. List tools paginate with `cursor` + `limit`
  (≤ 50).
- Text tools cap a response at ~8k tokens (~30k chars) and return
  `next_offset`, staying under Claude Code's 10k-token warning.
- Descriptions are fixed strings that say when to use the tool and what it
  returns; user data is never interpolated into descriptions.

### 5.1 Read tools (`read` scope, project member)

| Tool | Returns | Built on |
|---|---|---|
| `list_projects()` | projects the user belongs to, with role and `is_active` | membership query |
| `get_project(project_id)` | whitelisted descriptive fields, counts, templates (id, kind, active) | project read |
| `list_articles(project_id, query?, cursor?, limit?)` | id, title, authors, year, status, `has_pdf`, `has_text` | articles read |
| `get_article_text(article_id, offset?)` | markdown slice + `next_offset` | `/articles/{id}/content-markdown` service |
| `get_article_pdf(article_id)` | signed Storage URL (10 min) in a text block **and** as a `resource_link` (`mimeType: application/pdf`, name, size). Its description tells the agent to download the URL to read figures and tables; chat-only clients fall back to `get_article_text` | Supabase Storage |
| `search_project_text(project_id, query, cursor?)` | hits: article id/title, page, block type, snippet | `article_text_blocks` FTS (§5.3) |
| `get_extractions(project_id, template_id, article_id?, cursor?)` | per field: value, decider (human/AI), evidence quote + locator, run stage — blind-review filtered | `extraction_run_read_service` with the caller's id and arbitrator flag |
| `get_template(project_id, template_id)` | sections → questions (type, options, instructions), `draft_open`, draft diff vs published | template read + `template_diff_read` |

- Article-derived text is wrapped in delimiters and flagged
  `"untrusted_content": true`.
- `get_extractions` never bypasses `run_reveals_peers`. Before consensus a
  reviewer sees only their own values; managers see peers only when
  `caller_can_see_peers` says so.
- `template_id` is explicit because QA templates coexist with the single
  active extraction template.

### 5.2 Write tools (`read_write` scope + manager)

**`update_project_details(project_id, fields)`** — `destructiveHint: true`
(overwrites in place).

- New `project_details_service`. `fields` is validated against the same
  11-column whitelist the settings UI writes (`SaveProjectFields` in
  `frontend/services/projectSettingsService.ts`): `name`, `description`,
  `review_type`, `review_title`, `condition_studied`, `review_rationale`,
  `search_strategy`, `eligibility_criteria`, `study_design`,
  `review_keywords`, `review_context`.
- Excluded: PICOT / `picots_config_ai_review` (typed
  `PUT /ai-context` path) and `settings.managers_see_reviewers` (blind
  visibility).
- The response states that prompt-feeding fields affect only runs started
  afterwards (§2).
- Records before/after in `agent_actions`.

**`edit_template_draft(project_id, template_id, ops[])`** —
`destructiveHint: false`.

- Allowed ops (isolated, §2):
  - `add_question(section_id, label, type, options?, instructions?)`
  - `update_question_text(field_id, label?, description?, instructions?)`
- Refused with `OP_NOT_ALLOWED_VIA_AGENT` ("do this in the prumo UI"):
  delete/move question, change a question's type or options, and any
  section operation. These leak into live runs.
- Steps, in one transaction (≤ 25 ops):
  1. `claim_draft_lock` as the token's user. The claim's WHERE is
     project-scoped, which also proves template ownership. Held by another
     manager → `DRAFT_LOCK_HELD` with holder name. **Never** `take_over`.
  2. Apply ops in order via `template_field_service`. Any refusal rolls back
     **all** ops, including the lock claim, and returns the failing op index
     and code.
  3. Return the resulting draft diff (`template_diff_read`) and a deep link
     to the template editor.
- After success the draft lock stays with the user (the same holder as if
  they had edited in the UI).
- No publish, discard, or delete tool exists. Publishing is always a human
  action in the UI.
- **Isolation is enforced by tests** (§8): if a test shows an allowed op
  reaching a live run, the op is removed from v1 rather than documented.

### 5.3 Search index (Alembic migration)

- `article_text_blocks` has no tsvector, `section` or `project_id`. Add a
  GIN expression index `to_tsvector('simple', text)` (the `simple` config
  suits multilingual corpora).
- Scope queries by joining to `article_files.project_id = :gated_project`
  in the WHERE clause.
- Hits report page and block type, not "section".

## 6. Audit and traceability

### 6.1 Table `agent_actions` (append-only)

| Column | Notes |
|---|---|
| `id`, `created_at` | |
| `token_id` | fk ON DELETE SET NULL |
| `user_id`, `project_id` | fk ON DELETE SET NULL (append-only survives deletions) |
| `template_id` | nullable |
| `tool` | tool name |
| `input` | jsonb, ops/fields as sent |
| `before`, `after` | jsonb; project fields, or diff counts + touched ids |
| `outcome` | `applied` \| `refused:<code>` |

- Backend-only (0055 pattern). The service exposes insert only.
- An applied write inserts its row in the same transaction. A refusal rolls
  back, then inserts the refusal row and commits in the same
  `AsyncSessionLocal` session.

### 6.2 UI signal

- The template draft chip shows "includes edits via AI agent · <token name>"
  when an `agent_actions` row for that template has
  `created_at >= config_draft_since`. `config_draft_since` records the
  first draft write only, so "latest writer" cannot be derived.

### 6.3 Reads and observability

- Reads are not persisted.
- One OTel/Logfire span per tool call (`mcp.tool_call`: tool, token_id,
  project_id, latency, response size, outcome), never content, never the
  secret. The `Authorization` header is scrubbed from logs.

## 7. Limits, errors, prompt injection

- **Rate limits.** `slowapi` decorators apply only to FastAPI routes, and
  the existing key is a hash of the bearer. The MCP dispatcher therefore
  calls the limiter explicitly, keyed `pat:<token_id>`: 120 reads/min, 20
  writes/min. A per-IP limit applies to 401 responses (30/min), so random
  invalid tokens cannot bypass throttling.
- **Signed PDF URLs.** 10-minute TTL, issued only after the article gate.

**Error mapping (`app/api/mcp/errors.py`).** Results use `isError: true`
with `{code, message}` and an actionable message. Protocol errors are only
for malformed calls.

| Source | MCP code |
|---|---|
| `ensure_project_member` 403, missing row | `NOT_FOUND` (no existence leak) |
| `ensure_project_manager` 403 (member) | `MANAGER_REQUIRED` |
| scope check | `SCOPE_INSUFFICIENT` |
| `DraftLockHeldError` | `DRAFT_LOCK_HELD` |
| `DuplicateFieldNameError` | `DUPLICATE_NAME` |
| `FieldNotFoundError` / `EntityTypeNotFoundError` | `NOT_FOUND` |
| deadlock / serialization failure (endpoint maps to 409 today) | `RETRY` |
| disallowed op | `OP_NOT_ALLOWED_VIA_AGENT` |
| field outside whitelist | `FIELD_NOT_EDITABLE` |
| rate limit | `RATE_LIMITED` (+ retry-after seconds) |
| anything else | `INTERNAL_ERROR`, logged to Logfire, never swallowed |

**Prompt injection.** The server supplies private data plus untrusted
content, two legs of the "lethal trifecta". Containment is by privilege:

- no destructive tool;
- writes need `read_write` + manager;
- questionnaire writes are limited to ops proven invisible until a human
  publishes;
- project field edits are audited with before/after for manual revert;
- tool descriptions are static.

A user who wants zero write risk issues a `read` token.

## 8. Testing

Backend integration (pytest, local Supabase), test-first:

- **PAT:** only the hash is stored; expired / revoked / malformed / unknown
  → 401 with `WWW-Authenticate`; a PAT on `/api/v1/me/tokens` → 401;
  `last_used_at` throttled; 11th active token → 409.
- **BOLA matrix per tool:**
  - non-member → `NOT_FOUND`;
  - article/template id from another project → `NOT_FOUND`;
  - member non-manager → `MANAGER_REQUIRED` on writes;
  - `read` token → write tools absent from `tools/list` and refused on
    direct call;
  - member removed mid-token → `NOT_FOUND`.
- **Blind review:** reviewer A cannot see reviewer B's values in a run
  before consensus; an arbitrator can at consensus; everyone can at
  finalized.
- **Isolation (gates §5.2):** after `add_question` and
  `update_question_text` on an open run's template:
  - the active version is unchanged;
  - `open_or_resume` creates no new instances;
  - AI section extraction sends the pinned field set and pinned
    instructions;
  - the reviewer form renders the old schema.

  After UI publish, the change appears.
- **Draft semantics:** lock held by another manager → `DRAFT_LOCK_HELD`,
  holder unchanged; a batch with one invalid op → full rollback including
  the lock claim; disallowed op → `OP_NOT_ALLOWED_VIA_AGENT` with no writes.
- **Project details:** whitelist enforced (`FIELD_NOT_EDITABLE` for PICOT
  or settings); before/after recorded.
- **Audit:** each applied or refused write → exactly one `agent_actions`
  row.
- **Search:** results confined to the gated project; uses the GIN index
  (`EXPLAIN`).
- **Protocol:**
  - tool logic through the SDK in-memory `Client`;
  - auth, Host/Origin validation and rate limits over httpx against the
    ASGI app;
  - pagination and the text cap;
  - every tool has `title`, annotations and `outputSchema`, and its
    `structuredContent` validates.

Frontend (Vitest + MSW): secret shown once then prefix only; revoke;
per-client snippets; "includes edits via AI agent" chip.

Gates: `check_layered_arch`, `check_scope_guards.py`, OpenAPI response
descriptions, `knip` / `knip --production`, vulture baseline, copy-key
check, regenerated `frontend/types/api/schema.d.ts`.

Manual acceptance before the PR: connect Claude Code via
`claude mcp add --transport http`, then:

1. read an article;
2. search the project;
3. inspect extractions as a blinded reviewer;
4. add one question and reword another;
5. confirm the draft diff and chip in the UI, and that an open run is
   unchanged until Publish.

## 9. Out of scope

- OAuth of any kind, and therefore claude.ai per-user connectors, ChatGPT,
  the Claude directory and the MCP registry.
- ChatGPT `search`/`fetch` tool shapes.
- Structural questionnaire edits via agent (delete/move, type/options,
  sections).
- PDF upload / article creation.
- Writing extraction values or triggering AI runs.
- Semantic (embedding) search.
- `par` plugin integration.
