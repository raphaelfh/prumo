---
status: draft
last_reviewed: 2026-09-24
owner: '@raphaelfh'
---

# Researcher MCP Server — Design Spec

**Date:** 2026-09-23 (revised 2026-09-24)
**Status:** Draft. Design approved section by section in chat. Revised after
two review rounds: an adversarial code review, then security, architecture,
tool-design/SOTA and data/testing reviewers. Two spikes resolved the open
unknowns (§3.1). Awaiting written-spec review.

## 1. Decision summary

- prumo exposes a **remote MCP server** so researchers can pair
  header-capable AI agents (Claude Code, Cursor, VS Code, Gemini CLI) with
  their prumo projects.
- Mounted **inside the existing FastAPI app** at `/mcp`: Streamable HTTP,
  `mcp` Python SDK v2 `MCPServer`, stateless, JSON responses. Tools call
  existing services through the same gates as the REST endpoints.
- Auth is **Personal Access Token only** (`Authorization: Bearer
  prumo_pat_…`). No OAuth is planned. Web chat clients (claude.ai per-user
  connectors, ChatGPT) require OAuth and are not supported.
- The agent can:
  - read an article's or a project's content: metadata, outline, text paged
    by page/block with citable locators, keyword search, short-lived signed
    PDF URL;
  - review data extractions, respecting blind review, in a concise matrix
    or detailed per-field form;
  - edit the project's descriptive fields (whitelist). Edits are guarded by
    an optimistic precondition and a human-approval hint;
  - adjust questionnaires with **isolated operations only**: add a question,
    or reword a question's label, description or instructions. These stay
    invisible to reviewers and AI extraction until a human publishes.
- Every applied write, and every refused write, is recorded in an
  append-only `agent_actions` table (constitution §IX).

## 2. Context and verified premises

- **`par` is separate.** The `par` plugin's local `prumo mcp serve` works on
  local files (Zotero, Markdown wiki) and never sees web-app data. The two
  stay independent.
- **The API layer is the only guard.** The backend DB session is
  service-role (RLS bypassed). Tools must pass `ensure_project_member` /
  `ensure_project_manager` (`app/api/deps/security.py`). Article-scoped tools
  resolve the article's project first (`get_article_project_id`, the
  `_gate_article` pattern in `app/api/v1/endpoints/articles.py`).
  `template_field_service._owned_field` already scopes `field_id` to
  `template_id` in its WHERE clause.
- **Blind review.** Members may not read peers' in-flight values (migration
  0025). The backend enforces this with `run_reveals_peers`,
  `caller_can_see_peers` and `is_run_arbitrator`
  (`extraction_run_read_service.py`). AI/system proposals are visible by
  design. `ExtractionRun` is unique per `(article_id, template_id)`.
- **The template "draft" is the live structure tables, and it is only partly
  isolated.** The 0048 trigger stamps `config_draft_since`; runs pin a
  version snapshot; `republish` (UI "Publish") re-pins. Verified leaks:
  - AI extraction sends `snapshot ∩ live` fields
    (`section_extraction_service.py`), so a field deleted in the draft stops
    being extracted immediately.
  - `open_or_resume` materializes instances from **live** entity types
    (`hitl_session_service.py`), so a draft-added section gets instances
    before publish.
  - Proposals are normalized against **live** `allowed_values`
    (`extraction_proposal_service.py`).
  - A live **rename** of a field's `name` reaches the LLM
    (`test_pinned_prompt_structure.py`).
  - A **narrow snapshot** chains to the live tables for the run view and
    the prompts (`snapshot_is_narrow`, `extraction_snapshot.py`).
    "Narrow" means empty, or from the pre-0017 or 0016–0026 eras.
  - Discard is partial (`template_discard_service.py` D4/D6).

  Verified isolated, **for a non-narrow active version only**:
  - a field **added** live is invisible until publish re-pins;
  - label, description and instructions come from the pinned snapshot.

  §5.2 allows only these operations, and only on non-narrow templates.
- **Project text fields feed prompts, pinned per run.** `review_context`,
  `eligibility_criteria` and similar fields reach LLM prompts through
  `run_prompt_context`, which pins them per run (first writer wins). An edit
  affects only runs started afterwards.
- **The project-field whitelist exists only in the frontend today.**
  `SaveProjectFields` (`frontend/services/projectSettingsService.ts`) is a
  TS `Pick<>` used by a grandfathered raw PostgREST update; no backend
  schema enforces it. This spec creates the canonical backend schema (§5.2).
- **Stale docstring.** `template_version_service.py` still says template
  edits go through the Supabase client; typed endpoints
  (`template_structure.py`) replaced that path. A sibling
  `refactor(templates): …` commit corrects it.

## 3. Architecture

```
agent ──HTTP POST (Bearer prumo_pat_…)──▶ FastAPI  Mount("/mcp")
                                           └─ app/api/mcp/
                                              ├─ asgi_auth.py  pure-ASGI PAT wrapper → McpPrincipal contextvar
                                              ├─ server.py     MCPServer, tool registry, scope/role choke point
                                              ├─ session.py    injectable session factory (default AsyncSessionLocal)
                                              ├─ errors.py     service exception → MCP error
                                              └─ tools/*.py    thin adapters
                                                   │
                                                   ▼
                                    existing services + new: pat_service, project_details_service,
                                    agent_action_service, extraction_agent_read_service
```

- **Placement.** `app/api/mcp/` sits in the api layer, so it inherits
  `check_layered_arch`: no `app.models.*` or repositories imports in tools.
  A top-level `app/mcp/` would be unclassified and fail the gate.
- **SDK.** `mcp` SDK v2 (≥ 2.2) is added to `backend/pyproject.toml`.
  - `mcp.streamable_http_app(streamable_http_path="/",
    stateless_http=True, json_response=True, transport_security=
    TransportSecuritySettings(allowed_hosts=[<API host>],
    allowed_origins=[…]))`. A wrong Host gets 421.
  - The app `lifespan` in `app/main.py` wraps
    `async with mcp.session_manager.run()`.
- **JSON responses.** In SSE mode, `TimingMiddleware` / `LoggingMiddleware`
  measure only time to first byte, so MCP latency logs would be wrong. v1
  tools need no progress notifications.
- **Stateless.** MCP 2026-07-28 is stateless, which fits Railway
  round-robin: no sessions, no SSE resumability, no server-to-client
  requests.
- **Middleware.** Verified by spike: the three `BaseHTTPMiddleware`s and
  CORS pass MCP responses through intact. `/mcp` is excluded from the
  Supabase JWT dependency, the `ApiResponse` envelope and the REST error
  handler.
- **PAT auth is a pure-ASGI wrapper around the mount, not the SDK's
  `token_verifier`.**
  - The SDK accepts a `token_verifier` only together with OAuth
    `AuthSettings`, which make every 401 advertise a `resource_metadata` URL.
    When mounted, that URL returns 404.
  - The wrapper validates the PAT, answers `401 WWW-Authenticate: Bearer`,
    and sets an `McpPrincipal{user_sub, token_id, scope}` contextvar.
  - This is a new auth carrier. `structlog.contextvars` is log context only.
- **Scope/role choke point.** Each tool is registered with a declared
  requirement (`read` or `write`). `server.py` enforces it in one place:
  - filters `tools/list` by token scope;
  - refuses `SCOPE_INSUFFICIENT`;
  - for `write` tools, calls `ensure_project_manager` before the adapter
    runs.

  No tool re-implements this check. The rule is added to
  `.claude/rules/backend.md` § Ownership guards.
- **DB sessions.** Tools get their session from `app/api/mcp/session.py`,
  one factory whose default is `AsyncSessionLocal`, one session per tool
  call. Tests bind the factory to the `db_session` SAVEPOINT connection
  (§8). `db_client` overrides only `get_db`, so without this, tools would
  read outside the test's seed data and commit for real.
- **Transactions.** `template_field_service` and `claim_draft_lock` only
  `flush()`. The REST endpoints commit once at the end
  (`template_structure.py`). `edit_template_draft` does the same: claim →
  N ops → one commit. Any error closes the session without committing.

### 3.1 Spike evidence (2026-09-23/24, throwaway, not kept)

Setup:
- FastAPI 0.136.3 and Starlette 1.3.1 (the repo's lock), `mcp` 2.2.0,
  uvicorn;
- the three middlewares and CORS as registered in `app/main.py`;
- MCP mounted at `/mcp`;
- Claude Code 2.1.280 over HTTP with a static `Authorization` header.

| Check | Result |
|---|---|
| SDK client `initialize` / `tools/list` / `tools/call` (SSE and JSON) | ok |
| 200 KB result intact through middlewares | ok |
| `X-Response-Time` for a 600 ms tool | SSE 0.8 ms (wrong), JSON 602.8 ms |
| Invalid bearer / disallowed Host | 401 / 421 |
| Claude Code: `resource_link` | shown as `[Resource link: name] <uri>` |
| Claude Code: result with `content[text]` **and** `structuredContent` | **text block dropped**; `resource_link` and structured JSON shown |
| Claude Code: agent downloads the signed URL (`curl`) and reads the PDF | ok (title and abstract quoted) |

Consequence: everything the model needs goes in `structuredContent` (§5).
Cursor, VS Code and Gemini CLI rendering was not tested; the text copy
covers them.

## 4. Auth — Personal Access Tokens

### 4.1 Table `personal_access_tokens`

New Alembic migration (next free number, name ≤ 32 chars). Backend-only
table following the `_deny_all()` pattern of migration 0072
(`llm_connections`): ENABLE RLS, a `deny_all FOR ALL USING (false)` policy,
and `REVOKE ALL … FROM authenticated, anon`. Columns are text + CHECK, per
house style.

| Column | Type / constraint |
|---|---|
| `id` | uuid pk |
| `user_id` | uuid fk `public.profiles.id` ON DELETE CASCADE |
| `name` | text, `CHECK (char_length(name) BETWEEN 1 AND 80)` |
| `token_prefix` | text: `prumo_pat_` plus the first 6 secret chars, for display |
| `token_hash` | text unique (SHA-256 of the full secret) |
| `scope` | text, `CHECK (scope IN ('read','read_write'))` |
| `expires_at` | timestamptz not null, `CHECK (expires_at > created_at AND expires_at <= created_at + interval '365 days')` |
| `last_used_at` | timestamptz null |
| `revoked_at` | timestamptz null |
| `created_at` | timestamptz not null default now() |

- Partial index `(user_id) WHERE revoked_at IS NULL`.
- Secret: `prumo_pat_` + 32 random bytes (base62), shown **once**. Unsalted
  SHA-256 with an indexed equality lookup is adequate for 256-bit random
  secrets.
- At most **10 active tokens per user**. Creation locks the caller's
  `profiles` row `FOR UPDATE` before counting, so concurrent creates cannot
  both pass; the 11th → 409.
- Ownership lives in exactly one guard, `pat_service.owned_token(user_id,
  token_id)`, listed in `.claude/rules/backend.md`.

### 4.2 REST endpoints (Supabase JWT only)

| Endpoint | Returns |
|---|---|
| `POST /api/v1/me/tokens` `{name, scope, expires_in_days}` | the secret, once |
| `GET /api/v1/me/tokens` | the token list, without secrets |
| `DELETE /api/v1/me/tokens/{id}` | sets `revoked_at` |

- Typed `ApiResponse`, with `responses=` descriptions for 401/404/409 (the
  OpenAPI gate).
- These routes use the JWT dependency only, so a PAT cannot mint a PAT.
- The route prefix is confirmed against existing `me` routes at plan time.

### 4.3 `/mcp` authentication

- The ASGI wrapper resolves the bearer. Missing, malformed, unknown, expired
  or revoked → 401 `WWW-Authenticate: Bearer` (no `resource_metadata`).
- The lookup runs on every request, so a revoked token fails on its next
  call.
- `last_used_at` is updated at most once per minute per token.
- **Membership is re-checked on every tool call.** A removed member loses
  access immediately. Archived projects stay readable: `is_active` is not
  access control.

### 4.4 Permission model

- Effective permission = project role ∩ token scope, enforced only at the
  §3 choke point.
- A `read` token does not see write tools in `tools/list`.

### 4.5 Settings UI

- A new **"Personal access tokens"** `SettingsGroup` inside the existing
  **Integrations** tab (`frontend/components/user/IntegrationsSection.tsx`),
  next to AI connections and Zotero. No new tab.
- Features:
  - create a token (name, scope, expiry), with the secret shown once and a
    copy button;
  - list tokens (name, prefix, scope, last used, expiry);
  - revoke.
- Copy-ready snippets: Claude Code
  (`claude mcp add --transport http prumo <url>/mcp --header "Authorization: Bearer <token>"`),
  Cursor (`mcp.json` `headers`), VS Code (`.vscode/mcp.json` `headers`),
  Gemini CLI (`httpUrl` + `headers`).
- The tab states that web chat apps (claude.ai, ChatGPT) are not supported,
  and recommends a `read` token unless edits are needed.
- Follows component → hook → service → apiClient. Copy strings go in
  `frontend/lib/copy/`.

## 5. Tools

### 5.0 Conventions (MCP 2026-07-28, Anthropic tool-writing guidance, spike)

- **Everything the model needs goes in `structuredContent`.** The text copy
  is the same JSON, serialized. Claude Code drops the text block when
  structured content is present (§3.1).
  - Exception: `get_article_text` returns markdown text content only, with
    no `outputSchema`, so the prose is not escaped inside JSON.
- **Metadata on every tool:**
  - `title`;
  - `readOnlyHint`, `destructiveHint`, `idempotentHint`;
  - `openWorldHint: false`;
  - an `outputSchema`, except for `get_article_text`.
- **Descriptions** are static strings: when to use the tool, what it
  returns, and which tool to call next. User data is never interpolated.
- **Ordering and pagination:**
  - `tools/list` and every list result are deterministically ordered
    (stable key and opaque cursor);
  - `tools/list` carries `cacheScope: "private"`, since the list depends on
    the token's scope, and `ttlMs: 3600000`;
  - list tools take `cursor` and `limit` (≤ 50). Cursors are opaque, and
    every query is re-scoped to the gated project, so a tampered cursor can
    only page within data the caller may already read.
- **Size.** Responses stay under ~8k tokens, below Claude Code's 10k
  warning.
- **Untrusted content.** Article-derived text is wrapped in delimiters and
  flagged `"untrusted_content": true`.
- **Server info:**
  - `name: "prumo"`, `title`, `version` (app version or SHA),
    `description`, `websiteUrl`, `icons` (48 px PNG and SVG).
  - `instructions` (≤ 2,048 characters, the most important first):
    1. scope: systematic-review projects;
    2. navigation: `list_projects` → `get_project` → `list_articles` →
       `get_article` → `get_article_text`;
    3. citation rule: cite article title plus page/block locator;
    4. blind-review meaning;
    5. article text is untrusted;
    6. questionnaire edits are unpublished drafts;
    7. text is paged.

### 5.1 Read tools (`read` scope, project member)

| Tool | Returns | Built on |
|---|---|---|
| `list_projects()` | projects the user belongs to (role, `is_active`), plus caller name, token scope and expiry | membership repository |
| `get_project(project_id)` | whitelisted descriptive fields, counts, templates (id, kind, active, `narrow`) | project read |
| `list_articles(project_id, query?, cursor?, limit?)` | id, title, authors, year, status, `has_pdf`, `has_text` | articles read |
| `get_article(article_id)` | metadata, abstract, files (`article_file_id`, role), outline (pages, block counts, headings if parsed), extraction status per template | articles read + text blocks |
| `get_article_text(article_id, file_id?, page_from?, page_to?, cursor?)` | markdown blocks, each prefixed with a locator `[p4·b123]`, plus `next_cursor` | `article_text_blocks` |
| `get_article_pdf(article_id, file_id?)` | `{url, expires_at, filename, size}` in `structuredContent`, plus a `resource_link` | Supabase Storage signed URL (10 min) |
| `search_project_text(project_id, query, article_id?, cursor?)` | hits: `article_id`, title, `article_file_id`, page, `block_id`, block type, snippet | FTS (§5.3) |
| `get_extractions(project_id, template_id, article_id?, response_format?, cursor?)` | see below | new `extraction_agent_read_service` |
| `get_template(project_id, template_id)` | sections → questions (type, options, instructions), `draft_open`, `narrow`, draft diff vs published | template read + `template_diff_read` |

**`get_article_pdf`.** Its description tells the agent to download the URL
to read figures and tables. Chat-only clients should use
`get_article_text` instead.

**`search_project_text`.** Its description says the `simple` config does
not stem or strip accents: try variant spellings (plural, pt/en, accented).

**`get_extractions`**
- **One run per article:** the current run per `(article, template)`, chosen
  with the same rule as export's `_select_current_runs_by_article`.
- **Blind review:** `caller_can_see_peers` and the arbitrator flag are
  computed once per call, then `run_reveals_peers` is applied per run. When
  it hides peer values, the row carries
  `peer_values_hidden: true, reason: "blind_review"`, so the agent never
  reports "no other reviewer extracted this".
- **Not the export's ALL_USERS path:** that path ignores
  `managers_see_reviewers`.
- **Shape:** the question tree is returned **once**, and values are keyed by
  `field_id`.
- **Pagination:** keyset on `article_id`, limit ≤ 10 articles per page.
- **`response_format`:**
  - `concise` (default at project scope): an article × question matrix of
    short value strings plus flags (`ai_only`, `disagreement`,
    `peer_values_hidden`);
  - `detailed` (default when `article_id` is given): per-field rows with
    value, decider (human/AI), evidence quote and locator, and run stage.
- **Location:** a new module, `extraction_agent_read_service.py`. The run
  read service is near the 800-line ceiling, and export is baselined and
  cannot grow.

### 5.2 Write tools (`read_write` scope + manager, via the §3 choke point)

**`update_project_details(project_id, fields, expected)`**

- Hints: `destructiveHint: true`, `idempotentHint: true`, and
  `_meta["anthropic/requiresUserInteraction"]: true`. Claude Code then asks
  the human before every call; other clients ignore the key.
- **Whitelist.** A new `project_details_service` owns the canonical Pydantic
  schema of the 11 editable columns:
  `name`, `description`, `review_type`, `review_title`, `condition_studied`,
  `review_rationale`, `search_strategy`, `eligibility_criteria`,
  `study_design`, `review_keywords`, `review_context`.
  - Anything else → `FIELD_NOT_EDITABLE`. This includes PICOT /
    `picots_config_ai_review` (typed `PUT /ai-context` path) and
    `settings.managers_see_reviewers` (blind visibility).
  - Follow-up, outside this spec: derive the frontend's `SaveProjectFields`
    from this schema.
- **Precondition.** `expected` carries the prior value of every field being
  changed, as the agent last read it. If any current value differs (for
  example, it was edited in the UI meanwhile) → `STALE_VALUE`, returning the
  current values, and nothing is written.
- **Response.**
  - Before/after values.
  - A note that prompt-feeding fields affect only runs started afterwards.

**`edit_template_draft(project_id, template_id, ops[])`**

- Hints: `destructiveHint: true`, since `update_question` overwrites draft
  wording; `idempotentHint: false`.
- Allowed ops (isolated, §2):
  - `add_question(section_id, label, type, options?, instructions?)` — the
    internal `name` is derived server-side;
  - `update_question(field_id, label?, description?, instructions?)` —
    never changes `name`, `type` or options.
- Refused with `OP_NOT_ALLOWED_VIA_AGENT` ("do this in the prumo UI"):
  delete or move, type or options changes, and any section operation.
- Refused with `NARROW_BASELINE` when the template's active version is
  narrow (§2).
- **Steps**, in one session, ≤ 25 ops:
  1. `claim_draft_lock` as the token's user. Its WHERE clause is
     project-scoped, which also proves template ownership. Held by another
     manager → `DRAFT_LOCK_HELD` with the holder's name. **Never**
     `take_over`.
  2. Apply the ops in order via `template_field_service`. Any refusal rolls
     back **all** ops, including the lock claim, and returns the failing op
     index and code.
  3. Commit once.
  4. Return:
     - `status: "draft_saved_unpublished"`;
     - `visible_to_reviewers_and_ai: false`;
     - the resulting diff (`template_diff_read`);
     - a deep link to the template editor;
     - "a manager must click Publish in prumo".
- **The description** tells the agent never to report a question as live,
  and to call `get_template` after a `RETRY` before resending an
  `add_question`, since it is not idempotent.
- **After success** the draft lock stays with the user, the same holder as a
  UI edit.
- **No publish, discard or delete tools exist.**
- **Isolation is enforced by tests** (§8). If a test shows an allowed op
  reaching a live run, that op is removed from v1.

### 5.3 Search index

New Alembic migration: an expression GIN index
`to_tsvector('simple', text)` on `article_text_blocks`.

- **Migration-only.** `env.py` `include_object` ignores DB-only indexes. A
  generated column would need a model `Computed(...)`.
- **Build mode.** Count production rows at plan time. If the table is large,
  build with `op.get_context().autocommit_block()` and
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS`, since migrations run at
  container boot. Otherwise use a plain index, the house default.
- **Query:**
  1. Match with the exact index expression,
     `to_tsvector('simple', text) @@ websearch_to_tsquery('simple', :q)`
     (never raises on user syntax). `:q` is capped at 200 chars.
  2. Scope through `article_files.project_id = :gated_project` in the WHERE
     clause.
  3. Rank by `(ts_rank, id)` and paginate.
  4. Run `ts_headline` only on the page rows, in an outer query.
- **Why not `pg_trgm`.** It is installed, but ranks worse and needs a
  larger index.

## 6. Audit and traceability

### 6.1 Table `agent_actions` (append-only)

New Alembic migration. Same 0072 backend-only pattern.

| Column | Type / constraint |
|---|---|
| `id` | uuid pk |
| `created_at` | timestamptz |
| `token_id` | fk ON DELETE SET NULL |
| `user_id` | fk `profiles` ON DELETE SET NULL |
| `project_id` | fk ON DELETE CASCADE (project text in before/after goes with the project) |
| `template_id` | nullable, fk ON DELETE SET NULL |
| `tool` | text |
| `input` | jsonb, `CHECK (octet_length(input::text) <= 65536)` |
| `before`, `after` | jsonb |
| `outcome` | text, `CHECK (outcome IN ('applied','refused'))` |
| `error_code` | text null |

- Index `(template_id, created_at) WHERE outcome = 'applied'`.
- **Which calls get a row.** Applied writes, and write refusals from domain
  rules (`STALE_VALUE`, `DRAFT_LOCK_HELD`, `OP_NOT_ALLOWED_VIA_AGENT`,
  `NARROW_BASELINE`, `FIELD_NOT_EDITABLE`, service refusals). Rate-limit,
  auth and scope refusals only produce a log span.
- **When the row is written.**
  - An applied write inserts its row in the same transaction.
  - A refusal rolls back, then inserts the row and commits in the same
    session.
- **Append-only** is enforced by `agent_action_service`, which exposes
  insert only. No DB trigger, which would conflict with the FK cascades.

### 6.2 UI signal

- The draft chip in
  `frontend/components/extraction/template-config/TemplateConfigPublishControls.tsx`
  shows "includes edits via AI agent · <token name>" when a row exists with
  `outcome = 'applied'` for the template and
  `created_at >= config_draft_since`.
- `config_draft_by` (0053) already identifies the draft holder.

### 6.3 Reads and observability

- Reads are not persisted.
- One OTel/Logfire span per tool call (`mcp.tool_call`: tool, token_id,
  project_id, latency, response size, outcome), never content.
- `logfire.instrument_fastapi` does not capture headers (default), so the
  secret stays out of spans; tests assert this.
- Signed URLs are not logged or audited.

## 7. Limits, errors, prompt injection

- **Rate limits.** `slowapi` decorators do not attach to a mounted ASGI app,
  so the dispatcher calls the limiter's non-decorator API explicitly. The
  exact call is chosen at plan time.
  - Keyed `pat:<token_id>`: 120 reads/min, 20 writes/min.
  - A per-IP limit applies to 401s (30/min).
  - If this is a new limiter instance, it gets its own test reset.
- **Signed PDF URLs.** 10-minute TTL, issued only after the article gate.

**Error mapping (`app/api/mcp/errors.py`).** Results are `isError: true`
with `{code, message, retryable, next_step}`. Protocol errors are only for
malformed calls.

| Source | Code | retryable | next_step |
|---|---|---|---|
| non-member 403, missing or foreign row | `NOT_FOUND` | no | "call `list_projects` / `list_articles`" |
| member, not manager | `MANAGER_REQUIRED` | no | "ask a project manager" |
| scope | `SCOPE_INSUFFICIENT` | no | "use a read_write token" |
| `DraftLockHeldError` | `DRAFT_LOCK_HELD` | no | "tell the user who holds the draft; do not retry" |
| narrow active version | `NARROW_BASELINE` | no | "publish once in prumo, then retry" |
| disallowed op | `OP_NOT_ALLOWED_VIA_AGENT` | no | "do this in the prumo UI" |
| field outside whitelist | `FIELD_NOT_EDITABLE` | no | lists the editable fields |
| precondition failed | `STALE_VALUE` | no | "re-read the current values (included) and confirm with the user" |
| `DuplicateFieldNameError` | `DUPLICATE_NAME` | no | "choose another label" |
| deadlock / serialization failure (the 409 mapping in `template_structure.py`) | `RETRY` | yes | "call `get_template` to check state before resending" |
| rate limit | `RATE_LIMITED` | yes | retry-after seconds |
| anything else | `INTERNAL_ERROR` | no | logged to Logfire, never swallowed |

**Prompt injection.** The server supplies private data plus untrusted
content, two legs of the "lethal trifecta". Containment:

- no destructive tools;
- writes need `read_write` + manager;
- questionnaire writes are limited to ops proven invisible until a human
  publishes;
- project edits need a matching `expected` precondition, ask the human in
  Claude Code, and are audited with before/after;
- tool descriptions are static;
- the settings UI recommends `read` tokens.

## 8. Testing

Backend integration (pytest, local Supabase), test-first. Tools use the
injectable session factory bound to `db_session`. Each tool coroutine also
gets a direct unit test, because handler lines driven over ASGITransport do
not register diff coverage.

**PAT**
- Only the hash is stored.
- Expired, revoked, malformed or unknown → 401 `WWW-Authenticate`.
- A PAT on `/api/v1/me/tokens` → 401.
- `last_used_at` is throttled.
- Revoke between two calls → the second call gets 401.
- Two concurrent creates at 9 active tokens → exactly one succeeds
  (`db_session_real`).
- PAT fixtures exist for `SEED.primary`, `SEED.reviewer` and
  `SEED.outsider_profile`.

**RLS probes.** Both new tables: 0 rows for `authenticated`/`anon`, paired
with a positive service-role visibility check (the
`test_llm_connection_rls.py` pattern). `check_rls_coverage` does not match
these table names.

**BOLA matrix per tool**
- non-member → `NOT_FOUND`;
- an article, template, field or section id from another project →
  `NOT_FOUND`;
- member non-manager → `MANAGER_REQUIRED` on writes;
- `read` token → write tools absent from `tools/list` and refused on a
  direct call;
- member removed while the token is live → `NOT_FOUND`.

**Blind review.** Assert parity with `test_run_read_blind_filter.py` for the
three cases (own only / arbitrator at consensus / everyone at finalized),
and that `peer_values_hidden` is set when values are withheld.

**Isolation (gates §5.2).** On an open run's non-narrow template, after
`add_question` and `update_question`:
- the active version is unchanged;
- `open_or_resume` creates no new instances;
- AI section extraction sends the pinned field set and pinned
  label/instructions;
- the run view renders the old schema;
- `name` is unchanged.

After UI publish, the change appears. On a narrow template, both ops →
`NARROW_BASELINE` with no writes.

**Draft semantics**
- Lock held by another manager → `DRAFT_LOCK_HELD`, holder unchanged.
- Two sessions racing `claim_draft_lock` (`db_session_real`) → one wins.
- A batch with one invalid op → full rollback, including the lock claim.
- A disallowed op → no writes.

**Project details**
- Whitelist enforced.
- `STALE_VALUE` when a field changed after the agent read it.
- Before/after recorded.

**Audit**
- Each applied or domain-refused write → exactly one `agent_actions` row
  with the correct `outcome` / `error_code`.
- Auth and rate-limit refusals → none.

**Search**
- Results are confined to the gated project.
- Special characters (`' & | ! :* ( ) <->`), an empty query and a
  stopword-only query → no error.
- The length cap is enforced.
- Index usage is asserted via `pg_indexes` plus a plan under
  `SET LOCAL enable_seqscan = off`.

**`get_extractions`**
- Query count is bounded per page (no N+1).
- Concise and detailed shapes validate against their `outputSchema`s.

**Protocol**
- Tool logic through the SDK in-memory `Client`.
- Auth, Host/Origin validation and rate limits over httpx against the ASGI
  app.
- Every tool has a `title`, the annotations and (except
  `get_article_text`) an `outputSchema`, and its `structuredContent`
  validates.
- `tools/list` is deterministic and filtered by scope.
- No span or log contains the bearer or a signed URL.

**Frontend (Vitest + MSW)**
- The secret is shown once, then only the prefix.
- Revoke works.
- Per-client snippets render.
- The "includes edits via AI agent" chip appears.

**Gates**
- `check_layered_arch` and `check_scope_guards.py` (`owned_token`,
  `owned_template`; no raw `project_members` SQL).
- OpenAPI response descriptions.
- `knip` / `knip --production`.
- vulture: add `"@*.tool"` to `[tool.vulture] ignore_decorators` in the
  same PR.
- mypy ratchet: new files must be clean, with no baseline entries.
- File-size ceiling.
- Copy-key check.
- Regenerated `frontend/types/api/schema.d.ts`.

**Manual acceptance before the PR.** Connect Claude Code via
`claude mcp add --transport http`, then:

1. `list_projects` → `get_article` → read pages 3–4 with locators;
2. search the project;
3. inspect extractions as a blinded reviewer (concise, then detailed);
4. add one question and reword another;
5. confirm the draft diff and chip in the UI, and that an open run is
   unchanged until Publish;
6. edit the project description (Claude Code asks for approval), and see
   `STALE_VALUE` after a concurrent UI edit.

Also: Cursor or Gemini CLI connects to the stateless mount.

## 9. Out of scope

- OAuth of any kind, and so claude.ai per-user connectors, ChatGPT, the
  Claude directory, the MCP registry and ChatGPT `search`/`fetch` shapes.
- MCP resources, prompts and Apps.
- A checksummed PAT format and GitHub secret-scanning registration.
- Structural questionnaire edits via the agent (delete or move,
  type/options, sections).
- `dry_run` for writes (the unpublished draft and `expected` cover it).
- PDF upload / article creation.
- Writing extraction values or triggering AI runs.
- Semantic (embedding) search and accent/stem-aware FTS.
- `par` plugin integration.
