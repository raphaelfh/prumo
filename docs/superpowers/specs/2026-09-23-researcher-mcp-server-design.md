---
status: draft
last_reviewed: 2026-09-23
owner: '@raphaelfh'
---

# Researcher MCP Server — Design Spec

**Date:** 2026-09-23
**Status:** Draft (design approved section by section in chat; written spec
awaiting review)

## 1. Decision summary

- prumo exposes a **remote MCP server** at `/mcp` so researchers can pair
  their preferred AI agent (Claude Desktop/Code, ChatGPT, Cursor, …) with
  their prumo projects.
- It is mounted **inside the existing FastAPI app** (Streamable HTTP,
  official `mcp` Python SDK) on the same Railway service. Tools call the
  existing services and the same role gates as the REST endpoints.
- Auth is a **Personal Access Token (PAT)** the user creates in prumo
  settings and pastes into the agent's config. OAuth is out of scope.
- The agent can:
  - chat with an article's or a project's content (extracted markdown,
    keyword search, short-lived signed PDF URL);
  - review data extractions (final values, decider, evidence);
  - read and carefully edit project description/config;
  - adjust the extraction questionnaire — **always into the template
    draft**; a human publishes it in the UI.
- Every write is recorded in an append-only `agent_actions` table
  (constitution §IX).

## 2. Context

- The `par` plugin (prumo-assistant-for-researcher) ships a local
  `prumo mcp serve` over the researcher's **local** files (Zotero, Markdown
  wiki). It never sees web-app data. This server is the web-app
  counterpart; the two stay independent. `par` may later consume this
  server as a client — not in this spec.
- The backend DB session runs as **service-role (RLS bypassed)**; the API
  layer's `ensure_project_member` / `ensure_project_manager`
  (`backend/app/api/deps/security.py`) are the only guard. Every MCP tool
  must go through them.
- Template structure tables *are* the config draft: the 0048 trigger stamps
  `config_draft_since` on every live-row write; runs render the pinned
  version snapshot; only `template_version_service.republish` (UI
  "Publish") changes what reviewers see. `template_discard_service` throws
  the draft away. The draft editor lock is advisory
  (`template_draft_lock_service`).

## 3. Architecture

```
agent ──HTTP (Bearer prumo_pat_…)──▶ FastAPI /mcp
                                      ├─ app/mcp/auth.py      PAT → user_sub, scopes
                                      ├─ app/mcp/server.py    tool registry, scope filter
                                      └─ app/mcp/tools/*.py   thin adapters
                                            │  ensure_project_member / _manager
                                            ▼
                                      existing services (articles, extraction read,
                                      template_field/section, draft lock, diff read)
```

- `app/mcp/` is a presentation layer, like `app/api/v1/endpoints/`: tools
  must not import `app.models.*` (`check_layered_arch`). New persistence
  (PATs, `agent_actions`) gets its own services.
- The mount is added in `app/main.py`; `/mcp` is excluded from the Supabase
  JWT dependency and handled only by `app/mcp/auth.py`.

## 4. Auth — Personal Access Tokens

### 4.1 Table `personal_access_tokens` (Alembic migration)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `user_id` | uuid fk `auth.users` | owner |
| `name` | text | user label, e.g. "Claude Desktop" |
| `token_prefix` | text | first 12 chars, shown in the UI (`prumo_pat_ab12`) |
| `token_hash` | text unique | SHA-256 of the full secret |
| `scopes` | text | `read` \| `read_write` |
| `expires_at` | timestamptz not null | default now + 90 days; max 365 |
| `last_used_at` | timestamptz null | |
| `revoked_at` | timestamptz null | |
| `created_at` | timestamptz | |

- Secret format: `prumo_pat_` + 32 random bytes (base62). Shown **once** on
  creation; only the hash is stored.
- RLS enabled, no PostgREST grants to `authenticated` (backend-only table,
  per `docs/reference/migrations.md`).

### 4.2 REST endpoints (Supabase JWT only)

- `POST /api/v1/me/tokens` `{name, scopes, expires_in_days}` → `{token, …}`
- `GET /api/v1/me/tokens` → list without secrets
- `DELETE /api/v1/me/tokens/{id}` → sets `revoked_at`
- Every query filters `user_id = current user` in the WHERE clause
  (`check_scope_guards.py`). A PAT presented to these endpoints is rejected
  (they use the JWT dependency only): a PAT cannot mint a PAT.

### 4.3 `/mcp` authentication

- Requires `Authorization: Bearer prumo_pat_…`. Missing, malformed, unknown,
  expired or revoked → HTTP 401.
- `last_used_at` is updated at most once per minute per token.
- The resolved context `{user_sub, token_id, scopes}` is passed to every
  tool.

### 4.4 Permission model

- Effective permission = project role ∩ token scope.
- `read` scope: only read tools are listed in `tools/list`; a direct call to
  a write tool is refused (`SCOPE_INSUFFICIENT`).
- Write tools require `read_write` **and** `ensure_project_manager` — the
  same rule the UI applies to template edits today.

### 4.5 Settings UI

- New "AI agents" tab in user settings: create a token (name, scope,
  expiry), secret shown once with a copy button, list (name, prefix, scope,
  last used, expiry), revoke.
- Copy-ready connection snippets for Claude Code
  (`claude mcp add --transport http prumo <url>/mcp --header "Authorization: Bearer …"`),
  Claude Desktop, ChatGPT and Cursor.
- Copy strings live in `frontend/lib/copy/`.

## 5. Tools

Conventions: explicit IDs; compact JSON; list tools paginate with
`cursor` + `limit` (≤ 50); text tools cap the response at ~40k characters
and return `next_offset`; descriptions tell the LLM when to use the tool and
what it returns.

### 5.1 Read tools (`read` scope, project member)

| Tool | Returns | Built on |
|---|---|---|
| `list_projects()` | projects the user belongs to, with role | membership query |
| `get_project(project_id)` | description, config, counts, active template id | project read |
| `list_articles(project_id, query?, cursor?, limit?)` | id, title, authors, year, status, `has_pdf`, `has_text` | articles read |
| `get_article_text(article_id, offset?)` | extracted markdown slice + `next_offset` | `/articles/{id}/content-markdown` service |
| `get_article_pdf(article_id)` | MCP `resource_link`: signed Storage URL (10 min), filename, size | Supabase Storage signed URL |
| `search_project_text(project_id, query, cursor?)` | hits: article id/title, section, snippet | `article_text_blocks` (Postgres FTS) |
| `get_extractions(project_id, article_id?, stage?, cursor?)` | per field: final value, decider (human/AI), evidence quote + locator, run stage | extraction read/export services |
| `get_template(project_id)` | sections → questions (type, options, instructions), `draft_open`, diff vs published version | template read + `template_diff_read` |

Article-derived content is returned with `"untrusted_content": true`.

### 5.2 Write tools (`read_write` scope + manager)

**`update_project_details(project_id, fields)`**
- Applied directly. `fields` is validated against a whitelist of editable
  project attributes (description and the config keys the project settings
  UI already edits) — never free-form JSON.
- Records before/after in `agent_actions`.

**`edit_template_draft(project_id, ops[])`**
- `ops`: up to 25 of `add_section | update_section | delete_section |
  add_question | update_question | delete_question | move_question`,
  mapped 1:1 onto `template_section_service` / `template_field_service`.
- Steps, in one transaction:
  1. `claim_draft_lock` as the token's user. Held by another manager →
     refuse `DRAFT_LOCK_HELD` with holder name. **Never** `take_over`.
  2. Apply ops in order. Any service refusal (`FIELD_IN_USE`,
     `SECTION_IN_USE`, duplicate name, …) rolls back **all** ops and returns
     the failing op index + code.
  3. Return the resulting draft diff (`template_diff_read`) and a deep link
     to the template editor.
- There is no publish, discard, or delete tool. Publishing is always a human
  action in the UI.

## 6. Audit and traceability

### 6.1 Table `agent_actions` (append-only)

| Column | Notes |
|---|---|
| `id`, `created_at` | |
| `token_id`, `user_id`, `project_id` | |
| `tool` | tool name |
| `input` | jsonb, ops/fields as sent |
| `before`, `after` | jsonb; project fields for `update_project_details`; diff counts + touched ids for `edit_template_draft` |
| `outcome` | `applied` \| `refused:<code>` |

- No UPDATE/DELETE paths; refusals are recorded too.
- Written in the same transaction as an applied write; refusals are written
  in a fresh transaction after rollback.

### 6.2 UI signal

- The template draft chip shows "edited via AI agent · <token name>" when
  the latest draft write for that template came from `agent_actions`, so the
  manager knows what they are publishing.

### 6.3 Reads

- Not persisted. One structured Logfire event per call
  (`mcp.tool_call`: tool, token_id, project_id, latency, response size) —
  never content.

## 7. Limits, errors, prompt injection

- **Rate limits** (existing `slowapi`), keyed by token id: 120 read
  calls/min, 20 write calls/min.
- **Signed PDF URLs**: 10 min TTL, issued only after the membership gate.
- **Errors**: MCP `isError: true` with `{code, message}` using the services'
  existing codes. A non-member gets `NOT_FOUND` (no existence leak).
  Unexpected exceptions are logged to Logfire and surface as
  `INTERNAL_ERROR`; nothing is swallowed.
- **Prompt injection**: article text is untrusted. Containment is by
  privilege, not by prompt: no destructive tool exists, writes need
  `read_write` + manager, template edits stop at the draft, and every write
  is audited. Worst case is a bad draft a human sees in the diff and
  discards.

## 8. Testing

Backend integration (pytest, local Supabase), test-first:

- **PAT**: only hash stored; expired / revoked / malformed / unknown → 401;
  PAT on `/api/v1/me/tokens` → 401; `last_used_at` throttled.
- **BOLA matrix per tool**: non-member → `NOT_FOUND`; member non-manager →
  write refused; `read` token → write tools absent from `tools/list` and
  refused on direct call.
- **Draft semantics**: `edit_template_draft` sets `config_draft_since`;
  active version unchanged; an open run still renders the previous schema;
  lock held by another manager → `DRAFT_LOCK_HELD`, holder unchanged;
  question with answers → `FIELD_IN_USE`; batch with one invalid op → full
  rollback.
- **Audit**: each applied or refused write produces exactly one
  `agent_actions` row with correct before/after.
- **Protocol**: in-memory MCP SDK client against the ASGI app —
  `initialize`, `tools/list`, `tools/call`, pagination, text cap.

Frontend (Vitest + MSW): secret shown once then prefix only; revoke;
snippets per client; "via AI agent" chip.

Gates: `check_scope_guards.py`, OpenAPI response descriptions, `knip` /
`knip --production`, vulture baseline, copy-key check, regenerated
`frontend/types/api/schema.d.ts`.

Manual acceptance before the PR: connect Claude Code via
`claude mcp add --transport http`, read an article, inspect its extractions,
propose two questions, and confirm the draft + diff + chip in the UI.

## 9. Out of scope

- OAuth / dynamic client registration (next increment for claude.ai and
  ChatGPT web connectors).
- PDF upload / article creation.
- Writing extraction values or triggering AI runs.
- Semantic (embedding) search.
- `par` plugin integration.
