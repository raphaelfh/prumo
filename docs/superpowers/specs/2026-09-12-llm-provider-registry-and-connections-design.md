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
- **Slice 2 — connections + per-user engine.** Sections 1.1 and 2–6,
  the rest of 7. One PR carrying backend and frontend together: the old
  routes and tables are deleted, so a backend-only PR would break the
  deployed frontend. Shipped to production in the same `/ship-spec
  --to-prod` run. The plan splits the larger sections into implementer
  briefs: §4 into two tasks (one per router), §5 into three (one per
  surface), and §2 + §3.1 into a migration task and an `endpoint_id` →
  `connection_id` rename task.

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

Slice 1 shipped without `scopes` and `key_optional` (no consumer yet;
`key_optional` is implied by `needs_host`), and with a `description`
field the tree already renders (`ProviderSpec.description` in
`backend/app/llm/registry.py`). Slice 2 adds **both** `scopes` and
`key_optional` to `ProviderSpec`, with their consumers: the `/providers`
read (§4), the project-scope CHECK on `llm_connections` (§2) and the
connection schema validator. `description` stays.

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

### 1.1 Catalogue as data (slice 2)

The catalogue leaves Python. `backend/app/llm/models/<provider>.yaml`,
one file per LLM provider in the registry, holds that provider's
selectable models:

```yaml
# backend/app/llm/models/google.yaml
- model: gemini-3.8-flash
  label: Gemini 3.8 Flash
  best_for: Long documents at low cost
  context_window: 1000000
  cost_tier: "$"
- model: gemini-3.1-pro-preview
  label: Gemini 3.1 Pro (preview)
  best_for: Hardest extractions
  context_window: 1000000
  cost_tier: "$$$"
  deprecated: true      # hidden from the picker; pinned runs still resolve
```

`catalog.py` keeps `CatalogEntry`, `CATALOG`, `find_entry` and
`canonical_pair`; it builds `CATALOG` at import by loading every file
through a Pydantic row model (`extra="forbid"`, `deprecated: bool =
False`), ordered by provider as the registry lists them and by file
order within a provider. A deprecated row is still found by
`find_entry`, so existing pins and the retirement check keep working,
but the picker omits it. Updating models is a data change: edit the
file, no Python. `pyyaml` becomes a declared dependency (it is already
locked transitively). Tests: every file name is a registry LLM provider
and every LLM provider has a file; a malformed row fails import; a
deprecated row resolves but is absent from the `/llm-engine` catalogue.

### 1.2 Slice-1 residue retired in slice 2

Slice 1 left stand-ins that only made sense while `user_api_keys`
existed. Slice 2 retires each one in the same PR:

- `registry.storable_providers()` (`backend/app/llm/registry.py`) is
  replaced by `scopes`: "storable at user scope" is `"user" in
  spec.scopes`, "storable at project scope" is `"project" in
  spec.scopes`. Its consumers (`backend/app/schemas/user_api_key.py`,
  `backend/app/services/api_key_service.py`, and the unit tests
  `backend/tests/unit/test_api_key_service.py`,
  `backend/tests/unit/test_user_api_key_schemas.py`,
  `backend/tests/unit/llm/test_registry.py::test_storable_providers_are_the_hosted_ones`)
  are deleted or ported to `scopes`.
- `registry.is_byok_only()` and the `byok_only` field on the catalogue
  read model (`backend/app/schemas/llm_engine.py`, written by
  `backend/app/services/llm_engine_service.py`) are removed: §4's
  `availability` map supersedes them. The tests
  `backend/tests/unit/llm/test_registry.py::test_byok_only_is_computed_from_the_deployment`,
  `::test_host_bearing_provider_is_never_byok_only` and
  `backend/tests/integration/test_llm_engine_endpoint.py::test_byok_only_reflects_the_deployment_global_key`
  go with them, as do the doc references in `backend/app/llm/catalog.py`
  and `backend/app/core/config.py`. `global_key_for()` stays: it is what
  `availability` reads for the `global` tier.
- `registry.provider_ids()` is baselined in `backend/.vulture_baseline`
  with a comment naming `app/models/user_api_key.py` as its only
  (vulture-invisible) consumer. That model is deleted; the row is
  re-evaluated: kept only if `app/models/llm_connection.py` becomes its
  consumer under the same exclusion, otherwise removed with the function
  (see §7.8).
- The `registry.py` module docstring names `user_api_keys.provider` as
  the home of the CHECK literal; it is rewritten for
  `llm_connections.provider` and the `scopes` CHECK.
- `KeyScope.SHARED_ENDPOINT` (`backend/app/services/api_key_service.py`)
  and its writer in `backend/app/services/engine_credentials.py`: read
  tolerance only (§3.3); nothing writes it again.
- The slice-1 migration `0071_registry_providers` narrowed the
  `user_api_keys` CHECK; its live-DB assertions in
  `backend/tests/integration/test_migration_roundtrip.py` retire with the
  table (§7.8).

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

What the migration drops, in full (a `DROP TABLE` takes the table's
own objects with it; the trigger *function* is a separate object and
must be dropped explicitly):

- `public.user_api_keys` (`backend/alembic/versions/baseline_v1.sql`):
  the table with its PK, `user_api_keys_user_id_fkey`, the two CHECKs
  (`user_api_keys_provider_check`, narrowed by `0071_registry_providers`,
  and `user_api_keys_validation_status_check`), the indexes
  `idx_user_api_keys_provider` and `idx_user_api_keys_user_id`, the
  triggers `trg_ensure_single_default_api_key` and
  `trg_user_api_keys_updated_at`, the four owner RLS policies
  `user_api_keys_{select,insert,update,delete}`, and the `GRANT ALL`
  to `authenticated` and `service_role`.
- `DROP FUNCTION public.ensure_single_default_api_key()` explicitly:
  the trigger falls with the table, the function does not, and its own
  grants to `authenticated` / `service_role` fall with the function.
  `update_updated_at_column()` is shared by other tables and stays.
- `public.project_llm_endpoints`
  (`backend/alembic/versions/0055_project_llm_endpoints.py`): the table
  with its CHECKs, `ix_public_project_llm_endpoints_project_id`, the
  `deny_all` policy and the REVOKE-from-`authenticated`/`anon` posture,
  which `llm_connections` re-creates for itself.
- The models `backend/app/models/{user_api_key,project_llm_endpoint}.py`
  and the repository `backend/app/repositories/user_api_key_repository.py`
  go in the same PR, so `alembic check` stays green.
- Seed: `backend/app/seed.py` and `backend/app/seed_probast_ai*.py`
  write no rows to either table, so there is no seed to retire.
- `alternates`: a data update strips the key from every
  `projects.settings -> 'llm_engine'` that carries it; the writers
  (`backend/app/services/llm_engine_service.py`,
  `frontend/lib/llmEngineUpdateBody.ts`) stop producing it in the same PR
  (§3.1). The migration is self-guarding SQL: it is a no-op on a row
  without the key.

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
`resolve_project_engine` (`backend/app/services/llm_engine_service.py`)
at every call site in the tree:

- the kickoff gate, `backend/app/api/v1/endpoints/section_extraction.py`
  (the fail-fast resolve before the queue check);
- the section service, `backend/app/services/section_extraction_service.py`
  (`run_from_request`'s "candidate is the project's resolved engine"
  fallback);
- `resolve_engine_for_run` in `backend/app/services/run_engine_freeze.py`,
  whose project-resolve fallback is the **live worker path**
  (`run_section_extraction_task` in
  `backend/app/worker/tasks/extraction_tasks.py` calls it with `repin`).
  `resolve_engine_for_run` gains a keyword `user_id` and threads it to
  `resolve_engine`; the worker passes the `user_id` it already receives as a
  task argument. `freeze_run_engine` is unchanged in signature (it pins the
  candidate it is handed), but the candidate it pins now carries
  `deviation` (§3.1).
- The dead worker entry in `backend/app/worker/tasks/extraction_tasks.py`
  (`extract_section_task`, marked `DEAD ENTRY POINT`, the only other
  `resolve_project_engine` caller) is **deleted** in slice 2: the file is
  touched, and no dead code ships.

The order:

1. Read the project engine. If it is retired (catalogue miss) raise the
   existing typed 409 — a manager must re-choose.
2. If the caller may choose (`user_choice_allowed`, or the caller is a
   manager of the project) and a `user_project_engines` row exists for
   `(user_id, project_id)`: validate it the same way (catalogue or the
   caller's own connection). Retired → the same typed 409, worded for
   the user ("pick a new model"). Valid → that engine, with
   `deviation = pair != default's pair or connection_id is not None`.
3. Otherwise the project engine. **The lock is enforced here, not in the
   UI**: a member's stored row is ignored while locked, and the
   user-row PUT returns 403 to a member while locked. Managers are never
   bound by the lock.

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
  read). There is nothing to register: `scripts/fitness/check_scope_guards.py`
  scans `backend/app` unconditionally against a shrink-only baseline, so
  the new service writes its ownership predicate once, in the WHERE
  clause, and adds no baseline entry.
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
- `GET /me/providers` — the registry read, living in the user-scope
  connections router (`backend/app/api/v1/endpoints/user_connections.py`,
  mounted at prefix `/me`, the same prefix as `/me/connections`). It
  replaces `GET /user-api-keys/providers`
  (`backend/app/api/v1/endpoints/user_api_keys.py`), and the frontend
  service moves its path accordingly. Fields per provider: `id`, `label`,
  `description`, `docs_url`, `needs_host`, `key_optional`, `scopes`, and
  `global_key_available` for this deployment (`global_key_for(id)` is
  not None). Slice 2 adds `scopes` and `key_optional` to the registry
  with this read and the CHECK above as their consumers.
- The catalogue entries `/llm-engine` returns lose `byok_only`
  (`LlmEngineCatalogEntryRead` in `backend/app/schemas/llm_engine.py`, computed
  today by `registry.is_byok_only`): `availability` below carries the
  same fact per provider, and the picker reads that instead.
- `GET /projects/{id}/llm-engine` returns `default` (the project
  engine, with lock and attribution), `effective` (the viewer's row or
  the default), `source: user | project | env_default`, the catalogue,
  and `availability: provider → user | project | global | null` (whose
  credential a row would run on). `PUT .../llm-engine` (manager) writes
  the default and the lock. New `PUT/DELETE /projects/{id}/llm-engine/me`
  writes or clears the viewer's own row (403 while locked for a
  non-manager; 422 when `availability` for the row's provider is null
  for the caller — the UI's *needs a key* rule, enforced server-side).
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
- **Worklist gear → "Your engine for new runs".** An icon button in the
  `toolbarActions` group both article tables already expose — the
  trailing toolbar group beside the list count, where the filter and
  export controls sit (`frontend/components/extraction/ArticleExtractionTable.tsx`
  and `frontend/components/hitl/HITLArticleTable.tsx`, same prop name and
  placement on both). No new slot is added. It opens the
  picker, writing the viewer's own row: rows grouped by provider from
  the catalogue, plus one group per host the viewer owns, models from
  `allowed_models`. Each row carries a scope tag — *your key*, *project
  key*, *prumo* — or *needs a key*, in which case the row is not
  selectable and links to Integrations rather than embedding a form:
  nothing is stored until a credential exists, so a pick can never lead
  to a guaranteed 409 at kickoff. Under the picker, a mode toggle
  (fast / verified) stored on the user row. Above the list: *project
  default: X*. The lock binds members, not managers: while locked, the
  picker is read-only for non-managers with the reason in one line, and
  a manager may still pick their own engine. One row per (user,
  project): the gear on the extraction and the QA worklist edit the same
  choice. The gear's tooltip names `effective`. Managers see nothing
  extra here: this surface is the same for every member.
- **Project → Settings → AI engine card.** Next to Review details: the
  project default (catalogue pairs only), mode, the lock toggle, and
  *Shared keys*, the project's hosted-provider keys in one table with
  the same form minus the host field. The AI configuration dialog keeps
  PICOTS and the template instruction and loses its Model tab; the
  engine chip leaves the extraction config bar, and the endpoints
  dialog, engine settings dialog and alternates section are retired.

The run form renders `effective`, never `default`.

### 5.1 Removal sites

Everything the three surfaces replace, by file, so nothing is left
mounted:

- `LlmEngineChip` has two mounts in
  `frontend/components/extraction/ExtractionInterface.tsx`: the
  no-template branch (`{!activeTemplate && <LlmEngineChip …/>}`) and the
  `engineSlot` of `TemplateConfigEditor` in the config bar. Both go, then
  `LlmEngineChip.tsx` itself, and `TemplateConfigEditor`'s `engineSlot`
  prop if nothing else fills it.
- `LlmEnginePane` is mounted once, in the Model tab of
  `frontend/components/project/AiConfigDialog.tsx`. The tab, the pane
  and `LlmEngineSettingsDialog.tsx` / `LlmEndpointsDialog.tsx` go with
  it. The exported `AiConfigTab` type narrows from `'model' | 'picots' |
  'instruction'` to `'picots' | 'instruction'`; `initialTab` already
  defaults to `'picots'`, so no caller changes. The copy key
  `llmEngine.modelTabLabel` is deleted.
- `frontend/components/user/ApiKeysSection.tsx` (mounted by
  `IntegrationsSection.tsx`) is replaced by the AI connections list;
  `frontend/services/apiKeysService.ts` becomes the connections service.
- The settings E2E `frontend/e2e/flows/settings-api-keys.e2e.ts` is
  rewritten against connections (§7.6).

### 5.2 Copy

The new surfaces' copy lives in one new namespace,
`frontend/lib/copy/llmConnections.ts` (registered in
`frontend/lib/copy/index.ts`): the connections list and form, the gear
picker (scope tags, *needs a key*, lock reason, mode toggle), and the AI
engine card. The retiring keys are removed in the same PR so the
copy-key ratchet (`scripts/fitness/check_copy_keys.py`) shrinks rather
than fails: the `apiKeys*` / `integrationsApiKeys*` keys in
`frontend/lib/copy/user.ts`, and the `alternates*`, `endpoint*`,
`manageEndpoints` and `modelTabLabel` keys in
`frontend/lib/copy/llmEngine.ts`. What `llmEngine.ts` keeps is what the
run form's `effective` rendering and the typed 409s still reference.

### 5.3 Surface states

Each surface names every non-error state, following the convention the
retiring endpoints dialog used (`endpointsLoading`, `endpointsEmpty`,
`endpointsLoadError`). Errors are §6; "unauthorized" below means the
viewer's role, not a 401 (the app shell handles an expired session).

**Integrations → AI connections** (`GET /me/connections`,
`GET /me/providers`):

| state | rendering |
|---|---|
| loading | skeleton rows in the list; the Add button disabled until `/me/providers` resolves |
| empty | one-line empty state with the Add action inline ("No AI connections yet") |
| error | inline load-error line with a retry; the form stays usable |
| not-found | n/a (the list is the viewer's own; a deleted row disappears on refetch) |
| unauthorized | n/a (any signed-in user; the provider select offers only `scopes ∋ user`) |

**Worklist gear picker** (`GET /projects/{id}/llm-engine`):

| state | rendering |
|---|---|
| loading | gear rendered, tooltip "Loading…", popover shows skeleton groups |
| empty | catalogue never empty; a viewer with no host connection sees no host group and a link to Integrations |
| error | popover shows the load-error line with a retry; gear stays mounted |
| not-found | project 404 → the worklist's own not-found handles it; the gear is not rendered |
| unauthorized | non-member: gear hidden; member under lock: picker read-only with the one-line reason (§5); manager: editable |

**Project Settings → AI engine card + Shared keys**
(`GET /projects/{id}/llm-engine`, `GET /projects/{id}/connections`):

| state | rendering |
|---|---|
| loading | card skeleton; the shared-keys table shows skeleton rows |
| empty | shared keys: one-line empty state with the Add action ("No shared keys yet"); default: always set (env default) |
| error | inline load-error with a retry per block (card and table load independently) |
| not-found | project 404 → settings page not-found, card not rendered |
| unauthorized | non-manager: card read-only (default, mode, lock shown; no controls), shared-keys table hidden — the API is manager-gated either way |

## 6. Errors

| case | outcome |
|---|---|
| no credential for the effective engine at kickoff | existing typed 409; message names the provider and the three fixes (own key, project key, ask the operator) |
| pinned connection gone / other owner / undecryptable | existing typed unavailable 409, no cloud fallback |
| user row retired (catalogue miss or own connection gone) | typed 409 "pick a new model", never blocks the manager |
| provider not in registry, host on a host-less provider, missing host | 422 from the schema; CHECK is the backstop |
| private host outside local env | 422 from the SSRF guard, unchanged |
| user-row PUT while locked, by a non-manager | 403 |
| user-row PUT for a provider the caller has no credential for | 422 |
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
   resolves to the 409, never a key; `scripts/fitness/check_scope_guards.py`
   (which scans all of `backend/app`) reports no new duplicate predicate
   for the connection service, and its baseline shrinks (§7.8).
4. **Provenance compatibility.** Legacy snapshots with `endpoint_id` /
   `shared_endpoint` validate.
5. **API.** Ported endpoint and key tests: scope rules (host-bearing
   provider rejected at project scope), secret absent from every response
   and 422 echo, lock 403, default-with-connection 422. Plus:
   - `GET /me/providers` payload: every registry provider is present
     with exactly the §4 fields (`id`, `label`, `description`,
     `docs_url`, `needs_host`, `key_optional`, `scopes`,
     `global_key_available`); `global_key_available` flips with the
     deployment setting (monkeypatch, as
     `test_llm_engine_endpoint.py` does for `byok_only` today);
     `openai_compatible` reports `scopes == ["user"]` and
     `key_optional is True`.
   - `availability` map on `GET /projects/{id}/llm-engine`: for one
     provider, `user` with a user-scope connection present (even when a
     project key and a global key also exist), `project` with only a
     project key, `global` with only the setting, `null` with none;
     another viewer of the same project without the user key sees
     `project`, so the map is per caller. No `byok_only` field remains
     in the catalogue entries.
   - Migration strips `alternates`: the roundtrip suite
     (`backend/tests/integration/test_migration_roundtrip.py`) seeds a
     project whose `settings.llm_engine` carries `alternates` and one
     without, upgrades, and asserts the key is gone from the first and
     the second row is byte-identical; downgrade does not resurrect it
     (data loss accepted, §Non-goals).
6. **Frontend.** Vitest: the three scope tags, the *needs a key* row
   (unselectable, links out), the mode toggle, read-only picker under
   lock for a member and editable for a manager, the gear mounted on both worklists with
   `effective` in its tooltip, the AI configuration dialog reduced to
   two tabs; the settings E2E flow rewritten against connections.
7. **Catalogue files.** See §1.1: file-set equals registry LLM
   providers; malformed row fails import; deprecated row resolves but is
   not offered.
8. **Gates.** knip (both modes), copy-key ratchet, vulture baseline and
   `alembic check` tightened in the same PR as each deletion;
   fresh-versus-fresh migration proof. Concretely:
   - `scripts/fitness/check_scope_guards.baseline` shrinks by the five
     grandfathered rows for the dropped tables: the
     `ProjectLlmEndpoint{id,project_id}` rows for
     `llm_endpoint_service.py::get` and
     `llm_engine_service.py::_endpoint_row`, and the four
     `UserAPIKey{id,user_id}` rows for
     `user_api_key_repository.py::{deactivate,get_by_id_and_user,hard_delete,update_key_name}`.
     The gate only reports `findings - baseline`, so a stale row is
     silent, which is exactly why the shrink is a PR obligation and not
     something CI catches.
   - `backend/tests/integration/test_migration_roundtrip.py`: bump
     `expected_head` from `"0071_registry_providers"` to the slice-2
     revision, and retire the 0071 block's live-DB assertions on
     `user_api_keys_provider_check` (the table no longer exists at head);
     the registry-equals-CHECK assertion moves to
     `llm_connections_provider_check` and gains one for the `scopes`
     CHECK.
   - `backend/.vulture_baseline`: the `app/llm/registry.py:function:provider_ids`
     row is re-evaluated per §1.2 (kept with a rewritten justification
     naming `app/models/llm_connection.py`, or removed with the
     function).
   - The `backend/app/llm/registry.py` module docstring is rewritten for
     `llm_connections` (§1.2); the copy-key ratchet sees only removals
     (§5.2).

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
