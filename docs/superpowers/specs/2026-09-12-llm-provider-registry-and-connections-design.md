---
status: in_progress
last_reviewed: 2026-09-12
owner: '@raphaelfh'
---

# LLM provider registry and connections — design

> Brainstormed and approved 2026-09-12. Evolves the engine surface shipped
> as C1b/C2 (`docs/superpowers/specs/2026-08-05-template-config-ux-redesign-design.md`
> §5) into one provider registry, one connection concept, and a per-user
> engine choice with the project engine as the default.
>
> Amended 2026-09-12 after slice 1 shipped: hosts are user-owned only,
> the project default is a catalogue pair, and the engine picker moves
> from the extraction config bar to a gear on both worklists (§2, §3,
> §5). Slice 2 delivers the amended shape.

## Problem

The engine stack works but its knowledge of *providers* is scattered and
already drifting, and its credential model has two unrelated halves:

- Six places name providers independently: `build_model`, the catalogue,
  `SUPPORTED_PROVIDERS`, the `user_api_keys` CHECK constraint, the key
  metadata dict in `APIKeyService`, and the frontend copy. Two providers
  (gemini, grok) are storable as keys and buildable by nothing.
- Credentials live in two tables with two services, two routers and two
  dialogs: `user_api_keys` (a user's own key for a hosted provider) and
  `project_llm_endpoints` (a manager's custom OpenAI-compatible host with
  an optional shared key). A manager cannot share a hosted-provider key
  with the project; a user cannot bring their own host.
- `user_api_keys` is readable through PostgREST by its owner, so a user's
  ciphertext reaches the browser. `project_llm_endpoints` is deny-all and
  API-only, which is the posture every secret table should have.
- The engine is a project decision only. Users who connect their own
  model (a local Ollama, their own Claude key) still run the manager's
  pick, and the alternates list exists solely to paper over keyless
  reviewers.

## Goals

1. **One registry.** A single typed authority for providers that every
   layer derives from, with a test that fails on drift.
2. **One connection concept.** A connection is a provider, a credential,
   and (when the provider needs one) a host. A hosted-provider key is
   owned at user scope or project scope; a host is always user-owned,
   because it lives on one person's machine or account. Keys and custom
   hosts are the same thing.
3. **Per-user engine choice.** Each member picks how their new runs run,
   from the engines they can actually run; the project engine is the
   default, and a manager may lock the project to it.

## Non-goals

Audit trail and per-user rate limits (roadmap "Provider flexibility",
own spec — the connection table is designed so they attach). Grok.
Private or loopback hosts in SaaS (§10 of the template-config spec
is unchanged: the SSRF guard stays, so a laptop Ollama is reachable only
when prumo runs on that network). Model discovery beyond the `/models`
probe. Temperature and seed. Data migration: no active users exist, so
slice 2 drops the old tables outright.

## Delivery

Two slices, one plan, two PRs to `dev`:

- **Slice 1 — registry.** Pure refactor, no behaviour change beyond
  dropping gemini/grok. Sections 1 and 7.1.
- **Slice 2 — connections + per-user engine.** Sections 2–6, the rest
  of 7.

## 1. Provider registry (slice 1)

`backend/app/llm/registry.py` is the only file that names a provider.

```python
@dataclass(frozen=True)
class ProviderSpec:
    id: str                       # "openai" | "anthropic" | "openai_compatible" | "llama_cloud"
    label: str                    # "OpenAI"
    serves: Literal["llm", "parsing"]
    needs_host: bool              # openai_compatible only
    key_optional: bool            # openai_compatible only (keyless Ollama is legal)
    global_key_setting: str | None  # name of the Settings field, e.g. "OPENAI_API_KEY"
    docs_url: str | None
    scopes: frozenset[Literal["user", "project"]]
```

| id | serves | needs_host | key_optional | global_key_setting | scopes |
|---|---|---|---|---|---|
| openai | llm | no | no | `OPENAI_API_KEY` | user, project |
| anthropic | llm | no | no | `ANTHROPIC_API_KEY` (new, optional) | user, project |
| google | llm | no | no | `GOOGLE_API_KEY` (new, optional) | user, project |
| openai_compatible | llm | yes | yes | none | user |
| llama_cloud | parsing | no | no | `LLAMA_CLOUD_API_KEY` | user, project |

Slice 1 ships without `scopes` and `key_optional` (no consumer yet;
`key_optional` is implied by `needs_host`); slice 2 adds `scopes` with its
consumers.

Rules the registry encodes, not comments elsewhere:

- **Every hosted provider has a global key setting; only a host-bearing
  provider does not** (a host is a per-connection fact; there is no
  operator default host). `byok_only` is not stored anywhere: it is
  computed at read time as "hosted provider whose global setting is empty
  in this deployment", so the same code offers Claude on a deployment
  that sets `ANTHROPIC_API_KEY` and shows it as needing a key on one that
  does not.
- Model construction is a lookup: `build_model(spec, model_name,
  api_key, base_url)` with one shared check for host and key presence,
  then the per-provider pydantic-ai constructor (`OpenAIChatModel`,
  `AnthropicModel` lazily imported, `OpenAIChatModel` with `base_url`).
- The catalogue keeps its shape and its `find_entry` / `canonical_pair`
  contract; `CatalogEntry.byok_only` is removed (derived, see above).

Derived consumers: the key/connection schema validator, the provider
metadata the API returns, `_get_global_key`, the catalogue's provider
ids, and the frontend's provider labels (from the `/providers` read, not
copy keys). The DB CHECK constraint on `provider` still lists ids
literally; a test asserts the literal equals the registry, so adding a
provider is one registry entry plus one migration, and forgetting the
migration fails the test.

Slice 1 migration: delete the legacy gemini/grok rows from
`user_api_keys` (Google returns as the registry provider `google`,
built with pydantic-ai's `GoogleModel`) and align its CHECK with the
registry. Slice 1 also adds the optional `ANTHROPIC_API_KEY` and
`GOOGLE_API_KEY` settings.

## 2. `llm_connections` (slice 2)

One table replaces `user_api_keys` and `project_llm_endpoints`.

| column | notes |
|---|---|
| `id` | UUID, service-supplied before insert (feeds the per-row Fernet key, input `connection:{id}`) |
| `scope` | `'user'` or `'project'` |
| `user_id` | FK profiles CASCADE, nullable |
| `project_id` | FK projects CASCADE, nullable |
| `provider` | CHECK literal = registry ids |
| `label` | text, 1–80 |
| `base_url` | nullable; CHECK: set iff provider needs a host, and only at user scope |
| `encrypted_api_key` | nullable Fernet ciphertext; empty only where the provider allows keyless |
| `allowed_models` | JSONB list, only meaningful for host-bearing providers |
| `capabilities` | JSONB (`output_mode`, `models_seen`) from the probe |
| `validation_status` | `unverified` / `ok` / `failed` |
| `last_validated_at`, `last_used_at` | timestamps |
| `created_by` | FK profiles RESTRICT |

Constraints: CHECK that exactly the owner column matching `scope` is
set; CHECK that a project-scope row's provider is hosted (`scopes` in
the registry; the literal is asserted against it like the provider
CHECK); unique `(scope, user_id, project_id, provider, label)`; a partial
unique on `(user_id, provider)` for user scope on hosted providers (one
key per provider per user — `is_default` and `key_name` are gone).
Access posture: RLS enabled with a `deny_all` policy and every privilege
revoked from `authenticated` and `anon`, exactly as
`project_llm_endpoints` today. The migration creates the table, creates
`user_project_engines` (§3), drops the two old tables, and strips the
`alternates` key from every `projects.settings.llm_engine`. The
frontend's generated Supabase types lose the old table.

## 3. Engine choice and resolution

### 3.1 Stored shapes

`projects.settings.llm_engine` (`LlmEngineStored`) keeps `provider`,
`model`, `mode`, attribution, and renames `endpoint_id` →
`connection_id`. `alternates` is removed. It gains
`user_choice_allowed: bool = True`. The default never carries a
`connection_id`: with no project-scope hosts, a project default is
always a catalogue pair, and the write rejects one that is set.

New table `user_project_engines`, PK `(user_id, project_id)`, both FKs
CASCADE, columns `provider`, `model`, `connection_id` (nullable FK to
`llm_connections` ON DELETE SET NULL), `mode`, `updated_at`. No row
means "follow the project default". A row whose connection was deleted
(`connection_id` nulled) on a host-bearing provider is *retired* under
§3.2 step 2. Same deny-all, API-only posture.

`LlmTarget` (the pinned spine) renames `endpoint_id` → `connection_id`
and gains `deviation: bool = False`. Legacy pinned snapshots carrying
`endpoint_id` or the key scope `shared_endpoint` still validate (read
tolerance only; nothing writes them again).

### 3.2 Resolution

`resolve_engine(db, project_id, user_id) -> LlmTarget` replaces
`resolve_project_engine` at all four call sites (kickoff gate, run
freeze, worker, section service):

1. Read the project engine. If it is retired (catalogue miss) raise the
   existing typed 409 — a manager must re-choose.
2. If `user_choice_allowed` and a `user_project_engines` row exists for
   `(user_id, project_id)`: validate it the same way (catalogue or the
   caller's own connection). Retired → the same typed 409, worded for
   the user ("pick a new model"). Valid → that engine, with
   `deviation = pair != default's pair or connection_id is not None`.
3. Otherwise the project engine. **The lock is enforced here, not in the
   UI**: a stored user row is ignored while locked, and the user-row PUT
   returns 403 while locked.

`deviation` is computed at pin time against the default at that moment
and never recomputed. Kickoffs re-pin on attempt zero as today, so a run
started on user A's engine and continued by user B re-pins to B's; the
per-proposal provenance (migration 0056) records which engine produced
each value. This is accepted: freezing the first kicker's engine is the
silent-pin bug fixed on 2026-08-19.

### 3.3 Credentials

`resolve_engine_credentials` becomes one path:

- `connection_id` set (always a user-scope host) → fetch through the
  **one ownership predicate, in the WHERE clause**: `id = X AND scope =
  'user' AND user_id = caller`. Missing, other owner, or
  undecryptable → the existing typed unavailable 409, never a cloud
  fallback. The user-row and default writes validate through the same
  predicate, and resolution re-runs it, so a connection deleted or
  re-scoped after the pin is a 409 at run time (TOCTOU closed at the
  read). The service is registered with `check_scope_guards`.
- Otherwise, in order: the caller's user-scope connection for the
  provider, the project's project-scope connection for the provider, the
  registry's global setting. First hit wins.

`KeyScope` becomes `user_byok`, `project_shared`, `global_service`;
readers keep accepting `shared_endpoint`. `rekey_for_adopted_engine`
is unchanged except the field name; the re-key identity stays the pair
`(provider, connection_id)`.

## 4. API

Two connection routers replace three routers; every read carries
`has_api_key` and never key material (`SecretStr` inward, as today).

- `GET/POST /me/connections`, `PUT/DELETE /me/connections/{id}`,
  `POST /me/connections/{id}/verify` — user scope, any signed-in user,
  provider must allow user scope.
- Same five verbs under `/projects/{id}/connections` — project scope,
  manager-gated, project-scoped WHERE guard, hosted providers only (a
  host-bearing provider is a 422).
- Verify: the existing transport probe ladder for host-bearing
  connections (stores `models_seen`, pre-fills `allowed_models`); a
  cheap authenticated call for hosted providers.
- `GET /providers` — the registry read: id, label, docs url, needs_host,
  key_optional, scopes, and `global_key_available` for this deployment.
  Slice 2 adds `scopes` to the registry with this read and the CHECK
  above as its consumers.
- `GET /projects/{id}/llm-engine` returns `default` (the project
  engine, with lock and attribution), `effective` (the viewer's row or
  the default), `source: user | project | env_default`, the catalogue,
  and `availability: provider → user | project | global | null` (whose
  credential a row would run on). `PUT .../llm-engine` (manager) writes
  the default and the lock. New `PUT/DELETE /projects/{id}/llm-engine/me`
  writes or clears the viewer's own row (403 while locked).
- Old routes (`user_api_keys`, `llm_endpoints`) are deleted; OpenAPI
  types regenerated.

## 5. Journey

Three surfaces, one owner each, all reading the registry. The rule that
places them: *my credentials* live with me, *my next run* is decided
where runs start, and *the project's* decisions live in project
settings.

- **Me → Settings → Integrations → AI connections.** Every connection I
  own, hosted keys and local or custom hosts alike, in one list. "Add"
  is one form: provider select (user-scope providers), docs link, key
  field, host field only when the provider needs one, verify. Replaces
  the API keys section and the project endpoints dialog.
- **Worklist gear → "Your engine for new runs".** An icon button beside
  the filter and export controls next to the search box, on both
  article tables (data extraction and quality assessment). It opens the
  picker, writing the viewer's own row: rows grouped by provider from
  the catalogue, plus one group per host the viewer owns, models from
  `allowed_models`. Each row carries a scope tag — *your key*, *project
  key*, *prumo* — or *needs a key*, which links to Integrations rather
  than embedding a form. Above the list: *project default: X*. While
  locked, the picker is read-only for everyone but managers, with the
  reason in one line. The gear's tooltip names `effective`. Managers see
  nothing extra here: this surface is the same for every member.
- **Project → Settings → AI engine card.** Next to Review details: the
  project default (catalogue pairs only), mode, the lock toggle, and
  *Shared keys*, the project's hosted-provider keys in one table with
  the same form minus the host field. The AI configuration dialog keeps
  PICOTS and the template instruction and loses its Model tab; the
  engine chip leaves the extraction config bar, and the endpoints
  dialog, engine settings dialog and alternates section are retired.

The run form renders `effective`, never `default`.

## 6. Errors

| case | outcome |
|---|---|
| no credential for the effective engine at kickoff | existing typed 409; message names the provider and the three fixes (own key, project key, ask the operator) |
| pinned connection gone / other owner / undecryptable | existing typed unavailable 409, no cloud fallback |
| user row retired (catalogue miss or own connection gone) | typed 409 "pick a new model", never blocks the manager |
| provider not in registry, host on a host-less provider, missing host | 422 from the schema; CHECK is the backstop |
| private host outside local env | 422 from the SSRF guard, unchanged |
| user-row PUT while locked | 403 |
| default carrying a `connection_id`, or a project connection on a host-bearing provider | 422 |
| probe failure | `failed`, not selectable; probe is a transport smoke test, never a quality gate |

## 7. Testing

1. **Registry drift (slice 1).** Unit: CHECK literal = registry ids;
   every catalogue provider is a registry LLM provider; every hosted
   provider names a real settings field; every provider has label and
   docs. A mutation test removes a provider and expects the drift test
   to fail.
2. **Resolution order.** Integration: user then project then global,
   each with the other two present; lock ignores a stored user row;
   deviation flag set and stable across a later default change.
3. **Ownership.** A user row pinned to another user's connection id
   resolves to the 409, never a key; `check_scope_guards` covers the
   service.
4. **Provenance compatibility.** Legacy snapshots with `endpoint_id` /
   `shared_endpoint` validate.
5. **API.** Ported endpoint and key tests: scope rules (host-bearing
   provider rejected at project scope), secret absent from every response
   and 422 echo, lock 403, default-with-connection 422.
6. **Frontend.** Vitest: the three scope tags, the *needs a key* link,
   read-only picker under lock, the gear mounted on both worklists with
   `effective` in its tooltip, the AI configuration dialog reduced to
   two tabs; the settings E2E flow rewritten against connections.
7. **Gates.** knip (both modes), copy-key ratchet, vulture baseline and
   `alembic check` tightened in the same PR as each deletion;
   fresh-versus-fresh migration proof.

## References

- `docs/superpowers/specs/2026-08-05-template-config-ux-redesign-design.md`
  §5, §5.1, §5.2, §10
- `docs/superpowers/plans/2026-08-17-template-config-c2-alternates-endpoints.md`
- `docs/superpowers/plans/2026-08-17-ollama-local-eval.md`
- Code ground truth: `backend/app/llm/{provider,catalog}.py`,
  `backend/app/services/{engine_credentials,llm_engine_service,
  llm_endpoint_service,api_key_service,run_engine_freeze}.py`,
  `backend/app/schemas/{llm_target,llm_engine,llm_endpoint}.py`,
  `frontend/components/extraction/{LlmEnginePane,LlmEngineSettingsDialog,
  LlmEndpointsDialog,LlmEngineChip,ExtractionInterface,
  ArticleExtractionTable}.tsx`, `frontend/components/hitl/HITLArticleTable.tsx`,
  `frontend/components/project/{AiConfigDialog,settings/ReviewDetailsSection}.tsx`,
  `frontend/components/user/ApiKeysSection.tsx`
