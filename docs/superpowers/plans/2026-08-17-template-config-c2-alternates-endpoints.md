---
status: approved
last_reviewed: 2026-08-17
owner: '@raphaelfh'
---

# Template-config C2 — Alternates + Custom Endpoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

> **Panel-reviewed 2026-08-17:** five adversarial lenses (layering,
> security, migration/deploy-skew, YAGNI, test-coverage) returned 12
> blocking findings; ALL are incorporated below. Do not regress them —
> each is marked `[panel]` at its point of incorporation.

**Goal:** C2 of the template-config spec (§5): manager-curated alternate
engines (storage + management UI, zero runtime effect) and project-scoped
custom OpenAI-compatible endpoints (table + service + SSRF guard +
`build_model` branch + capabilities probe + management UI), plus a local
Ollama evaluation memo. Trigger-time alternate resolution, deviation
provenance, rich availability, and cost preview are **§5.1 — explicitly
out of scope here**.

**Architecture:** Alternates ride the existing `LlmEngineStored` spine
(new tolerant list field; write-gate validation in
`LlmEngineService.set_for_project`; per-alternate `retired` on the read).
Custom endpoints get a new `project_llm_endpoints` table (RLS + deny-all
policy + REVOKE in the same migration — secrets table), a new
`LlmEndpointService`, a greenfield SSRF guard (`app/core/net_guard.py`),
a third `build_model` branch (`openai_compatible` = OpenAIChatModel +
OpenAIProvider(base_url)), and a single credentials resolver
(`app/services/engine_credentials.py`) used by the worker call sites and
the rekey seam — endpoint engines resolve to the endpoint's
Fernet-decrypted shared key (`KeyScope.SHARED_ENDPOINT`), never a silent
cloud fallback; mid-flight endpoint failure classifies to a typed
`LLM_ENDPOINT_UNAVAILABLE` job code.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 async + Alembic + Pydantic v2 +
cryptography.Fernet + httpx; React 19 + TanStack Query + shadcn.

## PR slicing (3 PRs to dev, one promotion at the end)

- **PR-A** — alternates (Tasks A1–A5). Zero runtime effect;
  `test_run_engine_freeze` / kickoff-gate suites stay green as the
  regression net (both exist and cover what we lean on — verified).
- **PR-B** — custom endpoints backend (Tasks B1–B10). Includes the
  runtime path (an endpoint model can be the project default and a real
  run executes against it) because the Ollama evaluation requires it.
- **PR-C** — custom endpoints management UI + picker integration
  (Tasks C1–C4) + the Ollama memo (Tasks O1–O4 run locally after PR-B).
- **e2e:** no new Playwright spec in C2 — an intentional gap; the O2/O3
  manual pass exercises the real path end-to-end as compensating
  evidence. [panel]

## Global Constraints

- English only for code/comments/commits/copy keys.
- Alembic revision id ≤ 32 chars; the `0055` number RENUMBERS if another
  migration lands first on dev (head-chain test will say so). RLS +
  policy + REVOKE **in the same migration**. Never apply app-schema DDL
  via Supabase MCP. No seeding in migrations.
- New migration ⇒ bump the head-pin in
  `backend/tests/integration/test_migration_roundtrip.py` (~1088–1097)
  **in the same PR**, and update the head line in
  `docs/reference/extraction-hitl-architecture.md:137-138`.
- `ck_` constraint names: SHORT explicit names — the naming convention
  wraps explicit names too (pre-expanded `ck_` literals double-wrap +
  truncate).
- Any Pydantic schema/docstring touch on the API surface ⇒
  `npm run generate:api-types` (repo root) and commit the diff.
- Backend gate per task: ruff + pytest + **mypy ratchet** — fix types,
  never `--update`.
- File-size ratchet: `section_extraction_service.py` is AT its 1775
  ceiling (Task B9 must net it smaller), `api_key_service.py` 612/800
  (only the `SHARED_ENDPOINT` enum member goes in — nothing else).
- ASGI blind spot: every new endpoint gets direct endpoint-coroutine
  unit tests (mirror `backend/tests/unit/test_llm_engine_endpoints_unit.py`).
- Frontend: all copy via `frontend/lib/copy/`; typed apiClient only;
  TanStack keys from factories; React Compiler constraints; tooling from
  the **repo root**.
- Every frontend engine mutation sends `mode` explicitly (invariant B2);
  `alternates`/`endpoint_id` are OMITTED when the fetched read did not
  carry them (deploy-window tolerance, see A4). [panel]
- Endpoint API keys NEVER appear in logs, provenance, reads, repr, or
  422 payloads. Errors from probe/guard are sanitized; ALL network-level
  probe failures collapse to ONE opaque `unreachable` reason class (no
  port-scan oracle). [panel]
- Endpoint failure at run time = typed error (`LLM_ENDPOINT_UNAVAILABLE`
  end-to-end: 409 AppError at enqueue, classified job code mid-flight);
  **never a silent cloud fallback, never a generic EXTRACTION_FAILED**.
  [panel]
- Reference pattern for storage/service: `LlmEngineService` /
  `LlmEngineStored` — NOT `ParserSettingsService`.

## Locked design decisions (recon + panel, 2026-08-17)

1. **Table name `project_llm_endpoints`**, revision id
   `0055_project_llm_endpoints`. Note the `check_rls_coverage` fitness
   gate reality [panel]: its TABLE_RE matches only literal
   `CREATE TABLE` text, so an `op.create_table` migration is invisible
   to it — the gate neither protects nor blocks this table by default.
   We still ship a **deny-all policy** (decision 2) whose raw
   `CREATE POLICY` text satisfies POLICY_RE if the table ever becomes
   visible, and the REAL enforcement is the RLS probe test (B1 Step 4).
2. **RLS posture: secrets table.** In migration 0055, via raw
   `op.execute`: `ENABLE ROW LEVEL SECURITY`;
   `CREATE POLICY deny_all ON public.project_llm_endpoints FOR ALL
   USING (false);` (applies to PUBLIC; the backend role is the table
   owner and owners bypass RLS — no FORCE); `REVOKE ALL ... FROM
   authenticated, anon;` (0054 REVOKE pattern; 0020 create+RLS
   structure). Never a policy `TO authenticated`. [panel] Mirror 0054's
   docstring habit: write the who-connects-as-what rationale into
   0055's docstring (backend connects with its own role, not
   `authenticated` — 0054:26-27 states it). No `request.jwt.*` GUC
   readers ⇒ no CI auth-stub mirror needed.
3. **Fernet shared key per endpoint row**: reuse `derive_encryption_key`
   (`core/security.py:368`) with input `f"endpoint:{endpoint_id}"` —
   the `endpoint:` prefix domain-separates from the per-user namespace
   (both are bare uuid strings otherwise) [panel]. The service generates
   `id = uuid4()` before insert. `encrypted_api_key` nullable — keyless
   endpoints (local Ollama) are legal; `build_model` receives the
   literal placeholder `"no-key-required"` for them. Constitution §IV
   says "per-user derived keys" — this per-row variant is a deliberate
   deviation: amend §IV to "per-user or per-row derived keys" (PATCH
   version bump) in PR-B and justify in the PR description. [panel]
   Decrypt failure (`cryptography.fernet.InvalidToken`) maps to the
   typed `EndpointUnavailableError` — never a raw 500. [panel]
4. **SSRF guard `backend/app/core/net_guard.py`** (greenfield).
   `https`-only; resolve every A/AAAA via `getaddrinfo` and reject if
   ANY address is private / loopback / link-local / CGNAT / ULA /
   multicast / unspecified / reserved, **including IPv4-mapped IPv6**
   (`::ffff:10.0.0.5` — check `ipaddress` `.ipv4_mapped` too) and
   `0.0.0.0`; redirects disabled; response streamed + truncated at
   256 KiB; userinfo/query/fragment rejected; sanitized errors.
   **Escape hatch is environment-bound in code, not convention**
   [panel]: `settings.ALLOW_PRIVATE_LLM_ENDPOINTS: bool = False` is
   honored ONLY when `settings.supabase_env == "local"`
   (`config.py:159-163`); a test proves flag=True +
   supabase_env="production" still rejects `http://localhost:11434/v1`.
   **Rebinding mitigation** [panel]: `validate_endpoint_url` returns the
   vetted IPs; `guarded_json_request` PINS the connection to a vetted IP
   (request URL carries the IP, original `Host` header + httpx
   `extensions={"sni_hostname": host}` so TLS still verifies against
   the hostname). `verify=True` is LOAD-BEARING (document in the module
   docstring; a test asserts no client is ever built with
   verify=False). Fallback if sni_hostname proves unworkable in
   implementation: document probe-time rebinding as a known limitation
   explicitly and keep mitigations (2)+(3). Remaining documented
   limitation: the OpenAI SDK at extraction time resolves DNS itself —
   SaaS §10 self-hosted perimeter is the spec's answer.
5. **`build_model` third branch**: `provider == "openai_compatible"`
   requires `base_url`; key optional (placeholder above).
6. **Engine-selection representation (parallel to CATALOG)**:
   `LlmEngineStored.endpoint_id: UUID | None = None` and
   `LlmTarget.endpoint_id: str | None = None` (defaults keep old
   payloads/pins valid). When set, provider is `"openai_compatible"`.
   `find_entry`/retired checks skip endpoint engines; their validity =
   endpoint-exists (project-scoped) + model ∈ `allowed_models` +
   `validation_status == "ok"`.
7. **`KeyScope.SHARED_ENDPOINT = "shared_endpoint"`** (§5.2).
8. **Credentials resolver** `app/services/engine_credentials.py` used by
   the 3 WORKER call sites and the rekey seam ONLY — the
   section-extraction ENDPOINT keeps plain `resolve_project_engine` as
   its enqueue gate (no key decryption on the API path). [panel]
   The resolver fetches endpoints via the project-scoped
   `LlmEndpointService.get(project_id, endpoint_id)` so a cross-project
   endpoint_id in a snapshot resolves to the typed error, never another
   project's key. [panel]
9. **Probe ladder** tool → native → prompted (spec-mandated 3 rungs).
   Probe model = first of `allowed_models`, else first id from the
   `/models` response, else typed validation failure "no model to
   probe". [panel] `models_seen` capped at 50 entries, each ≤200 chars,
   non-strings dropped at the seam. [panel] Stored as typed
   `LlmEndpointCapabilities {output_mode, models_seen}` (no
   `dict[str, Any]` on the read). [panel]
10. **Verified × prompted-only**: `set_for_project` rejects (ValueError
    → 400) `mode="verified"` with an endpoint whose
    `capabilities.output_mode == "prompted"`; the UI warns first.
11. **Alternates tolerant contract**: request field
    `alternates: list[LlmEngineAlternate] | None = None` — `None` keeps,
    `[]` clears; stored entries validate individually (garbage entry
    dropped with a warning).
12. **UI host**: endpoints managed in a dialog from the engine popover
    footer; the picker's endpoint groups derive from the
    `useLlmEndpoints` hook (manager-only surface — the chip renders only
    for managers), NOT from an embedded matrix on the engine read
    [panel]. `LlmEngineRead` gains only the scalar
    `endpoint_label: str | None` for the chip label. Reviewer-visible
    endpoint data arrives with §5.1 where it belongs.
13. **Typed worker failure** [panel]:
    `ExtractionErrorCode.LLM_ENDPOINT_UNAVAILABLE` + a
    `classify_extraction_error` branch mapping
    `EndpointUnavailableError` (ENGINE_RETIRED pattern: 409 AppError at
    enqueue, typed job code mid-flight).
14. **No `kind` column** [panel YAGNI]: every row is `openai_compatible`
    today and `LlmTarget.provider` already discriminates. Deliberate
    deviation from the spec's column list, documented here; a second
    endpoint kind adds the column when it exists.
15. **DELETE returns 200 + `ApiResponse[LlmEndpointDeleteResult]`**
    (house pattern `user_api_keys.py` DeleteAPIKeyResult; a 204 would
    violate the envelope fitness gate). [panel]

---

## PR-A — Alternates

### Task A1: `LlmEngineStored.alternates` + request field (schemas)

**Files:**
- Modify: `backend/app/schemas/llm_engine.py`
- Test: `backend/tests/unit/test_llm_engine_schemas.py` (flat unit/ —
  the subdirs named in an earlier draft do not exist) [panel]

**Interfaces (produces):**
```python
class LlmEngineAlternate(BaseModel):      # stored + request entry
    provider: str
    model: str

class LlmEngineAlternateRead(BaseModel):  # read entry
    provider: str
    model: str
    canonical: str
    retired: bool

# LlmEngineStored gains:
alternates: list[LlmEngineAlternate] = []
# @field_validator("alternates", mode="before") drops (logger.warning)
# any entry that is not a dict or fails validation — per-entry tolerance.

# LlmEngineUpdateRequest gains:
alternates: list[LlmEngineAlternate] | None = None   # None = keep

# LlmEngineRead gains:
alternates: list[LlmEngineAlternateRead] = []
```

- [ ] **Step 1: failing tests** in
  `backend/tests/unit/test_llm_engine_schemas.py`:

```python
def test_stored_alternates_default_empty_for_old_payloads():
    stored = LlmEngineStored.model_validate({"provider": "openai", "model": "gpt-5.6-luna"})
    assert stored.alternates == []

def test_stored_alternates_garbage_entry_degrades_entry_not_payload():
    stored = LlmEngineStored.model_validate({
        "provider": "openai", "model": "gpt-5.6-luna",
        "alternates": [{"provider": "anthropic", "model": "claude-sonnet-5"}, "garbage", 42],
    })
    assert [(a.provider, a.model) for a in stored.alternates] == [("anthropic", "claude-sonnet-5")]

def test_update_request_alternates_default_none_keeps():
    req = LlmEngineUpdateRequest.model_validate(
        {"provider": "openai", "model": "gpt-5.6-luna", "mode": "fast"})
    assert req.alternates is None

def test_update_request_still_forbids_extras():
    with pytest.raises(ValidationError):
        LlmEngineUpdateRequest.model_validate(
            {"provider": "openai", "model": "x", "mode": "fast", "temperature": 1})
```

- [ ] **Step 2:** `cd backend && uv run pytest tests/unit/test_llm_engine_schemas.py -x -q` — FAIL.
- [ ] **Step 3:** implement exactly the Interfaces block; docstrings
  updated (OpenAPI contract).
- [ ] **Step 4:** same command — PASS; whole file green.
- [ ] **Step 5: commit** `feat(llm): alternates ride the LlmEngineStored spine (C2 A1)`.

### Task A2: write-gate + read model in `LlmEngineService`

**Files:**
- Modify: `backend/app/services/llm_engine_service.py`
- Modify: `backend/app/api/v1/endpoints/llm_engine.py` (pass-through)
- Test: `backend/tests/integration/test_llm_engine_service.py` (REAL
  Postgres — JSONB persistence, sibling-key survival, FOR UPDATE lock
  live there; there is no in-memory service suite) [panel] +
  `backend/tests/unit/test_llm_engine_endpoints_unit.py`

**Interfaces:**
- Consumes: A1 schemas.
- Produces: `set_for_project(..., alternates: list[LlmEngineAlternate] | None = None)`;
  `get_engine_read` returns `alternates` with per-entry `retired` via
  `find_entry`.

Validation rules in `set_for_project` (each a test in the integration
file, using its existing engine_setup helpers + SEED fixture):
1. every alternate must `find_entry` (ValueError → endpoint 400) — this
   also means alternates are catalog-only in C2 (endpoint pairs are NOT
   valid alternates; one test documents it);
2. dedupe by (provider, model) preserving order;
3. the primary pair is silently filtered out;
4. `alternates=None` keeps the previously stored list verbatim;
5. `alternates=[]` clears it.

- [ ] **Step 1: failing tests** (integration file; names:
  `test_set_alternates_rejects_unknown_pair`,
  `test_set_alternates_dedupes_and_excludes_primary`,
  `test_set_alternates_none_keeps_previous`,
  `test_set_alternates_empty_clears`,
  `test_engine_read_flags_retired_alternate` — monkeypatch CATALOG for
  the retired case). Endpoint-coroutine unit tests: PUT body with
  alternates reaches the service; ValueError → 400; extend
  `test_put_writes_named_fields...` to pin the new named field.
- [ ] **Step 2: run — FAIL** (integration suite needs local Supabase up).
- [ ] **Step 3: implement.** Only build the alternates list into the
  `LlmEngineStored` before the reassign-dump; don't touch the row-lock
  machinery.
- [ ] **Step 4:** service + endpoint files green; run
  `tests/integration/test_run_engine_freeze.py` +
  `tests/integration/test_llm_engine_kickoff_gate.py` UNTOUCHED and
  green (regression net proving alternates are runtime-inert).
- [ ] **Step 5: commit** `feat(llm): manager-curated alternates write-gate + read (C2 A2)`.

### Task A3: API contract regen

- [ ] `npm run generate:api-types` from repo root; commit the diff:
  `chore(api): regenerate types for engine alternates (C2 A3)`.

### Task A4: popover alternates section (frontend)

**Files:**
- Modify: `frontend/components/extraction/LlmEngineChip.tsx`
- Modify: `frontend/services/llmEngineService.ts`,
  `frontend/hooks/extraction/useLlmEngine.ts`
- Modify: `frontend/lib/copy/llmEngine.ts`
- Test: `frontend/test/LlmEngineChip.test.tsx`,
  **`frontend/test/services/llmEngineService.test.ts`** (line ~93 pins
  the exact PUT body — update it),
  **`frontend/test/hooks/useLlmEngine.test.tsx`** (~108-115 pins
  mutation bodies), and
  **`frontend/test/services/llmEngineService.deployWindow.test.ts`**
  (old-backend contract — extend, don't break) [panel]

**Deploy-window tolerance (BLOCKING panel finding — do not skip):**
1. The service read normalizes: `alternates: data.alternates ?? []`
   (and later `endpoint_label: data.endpoint_label ?? null` in C1) — a
   component test renders the popover from a payload WITHOUT the new
   fields (old backend during the promotion window) and asserts no
   crash.
2. The PUT body OMITS `alternates` when the fetched read did not carry
   the field (`undefined` → omit = server "keep"): an old backend with
   `extra="forbid"` must keep 422-free on plain model/mode changes.
   Implementation: build the body from a helper
   `toUpdateBody(engine, overrides)` that spreads `alternates` only when
   `engine.alternates` came from the wire (track with a
   `hasAlternates = 'alternates' in raw` flag in the service read).

**Mutation invariant:** when the read DID carry alternates, every
mutation site (`handleSelect`, `handleModeChange`, alternate toggles)
sends `{provider, model, mode, alternates}` explicitly.

UI (one new popover section between the mode toggle and the Command
list):
- Header `alternatesTitle` ("Alternate engines") + helper
  `alternatesHelper`: "Reviewers who can't run the default may run
  these instead — labeled as deviations." Empty state `alternatesEmpty`:
  "None — policy locked to the default engine."
- Each alternate: label (catalog match, fallback canonical), amber
  treatment when `retired`, X button (aria `alternatesRemoveAria`).
- "Add alternate" toggles `managingAlternates` state: the SAME catalog
  Command list becomes multi-select (onSelect toggles membership, rows
  render ✓; the current default row disabled with
  `alternatesPrimaryNote`).
- BYOK-only alternate selection shows inline warning
  `alternatesByokWarn`: "BYOK-only — won't unblock reviewers without
  their own key."

- [ ] **Step 1: failing tests** — the five component cases (empty
  state; toggle fires PUT with full body + explicit mode; retired
  amber; BYOK warn; model switch preserves alternates) PLUS the
  tolerance pair (renders without new fields; PUT omits alternates when
  read lacked them) PLUS updated body pins in the three existing files.
- [ ] **Step 2:** `npm run test:run -- frontend/test/LlmEngineChip.test.tsx frontend/test/services/llmEngineService.test.ts frontend/test/hooks/useLlmEngine.test.tsx frontend/test/services/llmEngineService.deployWindow.test.ts` — FAIL.
- [ ] **Step 3: implement** (copy keys first).
- [ ] **Step 4:** those files + `npx tsc -p tsconfig.app.json` — green.
- [ ] **Step 5: commit** `feat(frontend): alternates management in the engine popover (C2 A4)`.

### Task A5: PR-A gate + ship

- [ ] `make lint-backend`; touched backend suites; `npm run test:run`;
  `npx tsc -p tsconfig.app.json` — read outputs.
- [ ] Push `feat/c2-alternates`, `gh pr create --base dev`, arm
  auto-merge (the ONE armed PR), watch the 8 checks.

---

## PR-B — Custom endpoints backend

### Task B1: migration `0055_project_llm_endpoints`

**Files:**
- Create: `backend/alembic/versions/0055_project_llm_endpoints.py`
- Create: `backend/app/models/project_llm_endpoint.py` (+ export in
  `app/models/__init__.py`)
- Modify: `backend/tests/integration/test_migration_roundtrip.py`
  (head-pin ~1088–1097; the history-chain test nearby will also name
  the new head)
- Modify: `docs/reference/extraction-hitl-architecture.md:137-138`
- Test: roundtrip + RLS probe following the
  `backend/tests/integration/test_config_write_rls.py` harness pattern
  (SET ROLE authenticated + `request.jwt.claims` GUC) [panel]

**Model (no `kind` column — decision 14; explicit tz-aware timestamps
[panel]):**

```python
class ProjectLlmEndpoint(Base):
    __tablename__ = "project_llm_endpoints"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)  # service supplies uuid4()
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    label: Mapped[str]
    base_url: Mapped[str]
    encrypted_api_key: Mapped[str | None]
    allowed_models: Mapped[list] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))
    capabilities: Mapped[dict] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))
    validation_status: Mapped[str] = mapped_column(server_default="unverified")
    last_validated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[uuid.UUID]
    created_at / updated_at  # house pattern, DateTime(timezone=True) + server_default
    __table_args__ = (
        UniqueConstraint("project_id", "label", name="uq_llm_endpoint_label"),
        CheckConstraint(
            "validation_status IN ('unverified','ok','failed')", name="llm_ep_vstatus"),
    )
```

Migration: autogenerate `op.create_table`, then hand-add raw
`op.execute` for: ENABLE RLS; `CREATE POLICY deny_all ON
public.project_llm_endpoints FOR ALL USING (false);`; `REVOKE ALL ON
public.project_llm_endpoints FROM authenticated, anon;`. Docstring
carries the who-connects-as-what rationale (0054 habit). Downgrade
drops the table.

- [ ] **Step 1:** read migrations 0020/0049/0054 +
  `docs/reference/migrations.md` + `test_config_write_rls.py`.
- [ ] **Step 2: failing roundtrip** — bump head-pin to
  `0055_project_llm_endpoints`; run
  `uv run pytest tests/integration/test_migration_roundtrip.py -x -q` —
  FAIL (unknown revision).
- [ ] **Step 3:** write model + migration; `uv run alembic upgrade head`.
- [ ] **Step 4:** RLS probe test (authenticated-role SELECT denied —
  permission error, not empty result) green; run
  `python scripts/fitness/check_rls_coverage.py` and assert **exit 0**
  (the real posture enforcement is the probe test — the checker's
  TABLE_RE cannot see `op.create_table`; our raw CREATE POLICY text
  satisfies POLICY_RE if it ever does). [panel]
- [ ] **Step 5:** roundtrip green (upgrade → downgrade -1 → upgrade);
  arch doc head line + `last_reviewed` updated. Commit
  `feat(llm): project_llm_endpoints table + RLS (C2 B1)`.

### Task B2: endpoint schemas

**Files:**
- Create: `backend/app/schemas/llm_endpoint.py`
- Test: `backend/tests/unit/test_llm_endpoint_schemas.py`

**Produces (SecretStr so a 422 echo / repr never leaks key material
[panel]; Update is STANDALONE, not inheriting Create [panel]):**

```python
class LlmEndpointCapabilities(BaseModel):
    output_mode: Literal["tool", "native", "prompted"] | None = None
    models_seen: list[str] = []

class LlmEndpointCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str = Field(min_length=1, max_length=80)
    base_url: str
    api_key: SecretStr | None = None      # None = keyless endpoint
    allowed_models: list[str] = []

    @field_validator("api_key")
    def _reject_empty_key(cls, v):        # "" is a mistake, not keyless
        if v is not None and v.get_secret_value() == "":
            raise ValueError("api_key must be omitted (keyless) or non-empty")
        return v

class LlmEndpointUpdateRequest(BaseModel):
    """PUT is full-replace for label/base_url/allowed_models.
    api_key tri-state: None = keep stored key; "" = clear; str = set."""
    model_config = ConfigDict(extra="forbid")
    label: str = Field(min_length=1, max_length=80)
    base_url: str
    api_key: SecretStr | None = None
    allowed_models: list[str] = []

class LlmEndpointRead(BaseModel):   # NEVER carries key material
    id: UUID
    label: str
    base_url: str                   # manager-only surface
    has_api_key: bool
    allowed_models: list[str]
    capabilities: LlmEndpointCapabilities
    validation_status: Literal["unverified", "ok", "failed"]
    last_validated_at: datetime | None
    created_by_name: str | None

class LlmEndpointDeleteResult(BaseModel):
    deleted: bool
    id: UUID

class LlmEndpointProbeResult(BaseModel):
    validation_status: Literal["ok", "failed"]
    output_mode: Literal["tool", "native", "prompted"] | None
    models_seen: list[str]
    error: str | None        # sanitized: reason class only
```

- [ ] Steps: failing schema tests (extra=forbid; empty-string create
  key rejected; read has no key field; a model_dump of a request never
  contains the secret — SecretStr masks) → implement → green → commit
  `feat(llm): endpoint schemas (C2 B2)`.

### Task B3: SSRF guard `app/core/net_guard.py`

**Files:**
- Create: `backend/app/core/net_guard.py`
- Modify: `backend/app/core/config.py`
  (`ALLOW_PRIVATE_LLM_ENDPOINTS: bool = False`)
- Test: `backend/tests/unit/test_net_guard.py`

**Produces:**

```python
class EndpointUrlError(ValueError):
    """Sanitized: reason class + host only."""

@dataclass(frozen=True)
class VettedUrl:
    url: str          # normalized (scheme lowercase, no trailing /, no query)
    host: str
    port: int
    addresses: tuple[str, ...]   # every resolved, vetted IP

def _private_ranges_allowed() -> bool:
    # True ONLY when the flag is on AND supabase_env == "local"  [panel]
    return settings.ALLOW_PRIVATE_LLM_ENDPOINTS and settings.supabase_env == "local"

def validate_endpoint_url(raw_url: str) -> VettedUrl:
    """https-only (http allowed only under _private_ranges_allowed);
    rejects userinfo/query/fragment; resolves via getaddrinfo and
    rejects if ANY address is private/loopback/link-local/CGNAT/ULA/
    multicast/unspecified/reserved — including the .ipv4_mapped form
    of an IPv6 address."""

async def guarded_json_request(
    method: str, vetted: VettedUrl, path: str, *,
    headers: dict[str, str] | None = None, json_body: dict | None = None,
    timeout_s: float = 15.0, max_bytes: int = 262_144,
) -> tuple[int, Any]:
    """Connects to a PINNED vetted IP (url rewritten to the IP; original
    Host header + extensions={"sni_hostname": vetted.host} keep TLS
    verifying against the hostname — verify=True is LOAD-BEARING for
    the rebinding posture). Redirects disabled; response streamed and
    truncated at max_bytes; JSON parsed. ALL network-level failures
    (DNS, connect, TLS, timeout) raise EndpointUrlError("unreachable")
    — one opaque class, no port-scan oracle. Application-level failures
    (HTTP status, non-JSON) keep distinct classes."""
```

- [ ] **Step 1: failing tests** (monkeypatch `socket.getaddrinfo` — no
  real DNS):

```python
@pytest.mark.parametrize("url", [
    "http://localhost:11434/v1", "https://127.0.0.1/v1",
    "https://10.0.0.5/v1", "https://172.16.0.9/v1", "https://192.168.1.2/v1",
    "https://169.254.169.254/v1", "https://100.64.0.1/v1",
    "https://[fc00::1]/v1", "https://[::1]/v1", "https://[::ffff:10.0.0.5]/v1",
    "https://0.0.0.0/v1",
    "https://user:pw@api.example.com/v1", "https://api.example.com/v1?x=1",
])
def test_guard_rejects(url): ...

def test_guard_rejects_public_name_resolving_private(monkeypatch): ...
def test_local_flag_allows_localhost_http(monkeypatch):
    # flag=True AND supabase_env=local
def test_flag_is_inert_outside_local_env(monkeypatch):
    # flag=True + supabase_env='production' -> localhost still rejected  [panel]
```

  Plus the `guarded_json_request` group via `httpx.MockTransport`
  [panel — diff-cover]:

```python
async def test_request_never_follows_redirect(): ...      # 3xx returned, not followed
async def test_request_truncates_at_max_bytes(): ...      # oversized body -> capped, sanitized error
async def test_request_connects_to_pinned_ip(): ...       # transport saw the IP url + Host header + sni ext
async def test_request_network_failures_are_one_opaque_class(): ...  # connect error vs TLS error -> same "unreachable"
async def test_request_non_json_body_is_sanitized_error(): ...
async def test_no_client_is_built_with_verify_false(): ...  # grep-style/spy assertion on client kwargs
```

- [ ] Steps 2–5: FAIL → implement → green → commit
  `feat(security): SSRF guard for custom LLM endpoints (C2 B3)`.

### Task B4: `LlmEndpointService` (CRUD + Fernet + verify persistence)

**Files:**
- Create: `backend/app/services/llm_endpoint_service.py`
- Modify: `docs/reference/constitution.md` §IV — PATCH amendment
  "per-user or per-row derived keys" [panel]
- Test: `backend/tests/integration/test_llm_endpoint_service.py` (real
  DB — JSONB + FK + unique constraints are the behavior under test)

**Produces:**

```python
class EndpointUnavailableError(AppError):
    # code="LLM_ENDPOINT_UNAVAILABLE", status_code=409

class LlmEndpointService:
    def __init__(self, db: AsyncSession) -> None: ...
    async def list_for_project(self, project_id: UUID) -> list[LlmEndpointRead]
    async def get(self, project_id: UUID, endpoint_id: UUID) -> ProjectLlmEndpoint
        """Service-layer only — endpoints consume LlmEndpointRead.
        Project-scoped fetch: cross-project id -> not-found (BOLA gate)."""
    async def create(self, *, project_id: UUID, created_by: UUID,
                     payload: LlmEndpointCreateRequest) -> LlmEndpointRead
        # validate_endpoint_url first; id = uuid4() BEFORE encrypt;
        # Fernet(derive_encryption_key(f"endpoint:{id}"))
    async def update(self, *, project_id: UUID, endpoint_id: UUID,
                     payload: LlmEndpointUpdateRequest) -> LlmEndpointRead
        # full-replace label/base_url/allowed_models; api_key tri-state;
        # base_url or allowed_models change resets validation_status
    async def delete(self, *, project_id: UUID, endpoint_id: UUID) -> LlmEndpointDeleteResult
        # takes the same projects FOR UPDATE row lock set_for_project
        # takes, then refuses (EndpointUnavailableError 409 message) while
        # the project engine points at it. UX sugar — the real guarantee
        # is the typed run-time error (decision 13).  [panel]
    async def verify(self, *, project_id: UUID, endpoint_id: UUID) -> LlmEndpointProbeResult
        # fetch (BOLA-scoped) -> decrypt -> probe_endpoint (B5) ->
        # persist capabilities/validation_status/last_validated_at ->
        # flush -> return. The ROUTE only calls this.  [panel]
    async def decrypt_key(self, endpoint: ProjectLlmEndpoint) -> str | None
        # cryptography.fernet.InvalidToken -> EndpointUnavailableError
        # (endpoint id + label in the message, NEVER ciphertext)  [panel]
```

- [ ] **Step 1: failing tests** — create roundtrip (ciphertext ≠
  plaintext; decrypt returns it), cross-project get → miss, update
  key-tri-state (None keeps / "" clears / str replaces), base_url
  change resets status, delete blocked while referenced, delete takes
  the project row lock (spy pattern from
  `test_llm_engine_service.py:140-163`), **tampered ciphertext →
  EndpointUnavailableError**, read model dump never contains key
  material.
- [ ] Steps 2–5: FAIL → implement (+ constitution §IV patch) → green →
  commit `feat(llm): LlmEndpointService with Fernet shared keys (C2 B4)`.

### Task B5: capabilities probe

**Files:**
- Create: `backend/app/services/llm_endpoint_probe.py`
- Test: `backend/tests/unit/test_llm_endpoint_probe.py`

**Produces:**

```python
async def probe_endpoint(
    *, vetted: VettedUrl, api_key: str | None, allowed_models: list[str],
) -> LlmEndpointProbeResult:
    """GET /models, then tool -> native -> prompted ladder via
    guarded_json_request. Probe model = allowed_models[0], else first
    /models id, else typed 'no model to probe' failure. Never raises on
    endpoint failure — returns validation_status='failed' + sanitized
    error. models_seen capped (50 entries, <=200 chars, strings only)."""
```

- [ ] **Step 1: failing tests** (mock at the `guarded_json_request`
  seam): ladder short-circuits at first success; all-fail ⇒ failed;
  key never in result/error; endpoint 401 ⇒ failed + sanitized;
  **/models itself failing (guard "unreachable" vs endpoint 5xx —
  both `failed`)**; **empty /models + empty allowed_models ⇒ "no model
  to probe"**; **malformed tool_calls JSON falls through to the next
  rung**; models_seen capping. [panel]
- [ ] Steps 2–5 → commit `feat(llm): endpoint capabilities probe (C2 B5)`.

### Task B6: API endpoints (manager-only) + wiring

**Files:**
- Create: `backend/app/api/v1/endpoints/llm_endpoints.py`
- Modify: the v1 router registration site (mirror `llm_engine`)
- Test: `backend/tests/unit/test_llm_endpoints_unit.py` (direct
  coroutine tests, flat unit/) + one integration auth test (member ≠
  manager 403)

Routes — all `require_project_manager`; the route bodies ONLY call the
service and map errors (no ORM, no DB) [panel]; per-route limiter
explicit [panel]:
- `GET    /projects/{project_id}/llm-endpoints` — `60/minute` —
  `ApiResponse[list[LlmEndpointRead]]`
- `POST   /projects/{project_id}/llm-endpoints` — `20/minute` — 201,
  `ApiResponse[LlmEndpointRead]`
- `PUT    /projects/{project_id}/llm-endpoints/{endpoint_id}` —
  `20/minute` — `ApiResponse[LlmEndpointRead]`
- `DELETE /projects/{project_id}/llm-endpoints/{endpoint_id}` —
  `20/minute` — **200**, `ApiResponse[LlmEndpointDeleteResult]`
  (decision 15)
- `POST   /projects/{project_id}/llm-endpoints/{endpoint_id}/verify` —
  `30/minute` — `ApiResponse[LlmEndpointProbeResult]` (calls
  `service.verify`, commits — house pattern `llm_engine.py:70`)

Error mapping: `EndpointUrlError` → 400 sanitized;
`EndpointUnavailableError` → its own 409 envelope; not-found → 404.

- [ ] Steps: failing coroutine tests (each route: happy + error mapping
  + cross-project 404 + a 422 response body never echoes `api_key`
  material [panel]) → implement → green → commit
  `feat(api): project llm-endpoint CRUD + verify (C2 B6)`.

### Task B7: `build_model` third branch

**Files:**
- Modify: `backend/app/llm/provider.py`
- Test: `backend/tests/unit/llm/test_provider.py`

```python
def build_model(provider, model_name, *, api_key=None, base_url=None) -> Model:
    ...
    if provider == "openai_compatible":
        if not base_url:
            raise ValueError("openai_compatible requires a base_url.")
        return OpenAIChatModel(
            model_name,
            provider=OpenAIProvider(api_key=api_key or "no-key-required", base_url=base_url),
        )
```

- [ ] Steps: failing tests (branch returns OpenAIChatModel with
  base_url on its client; missing base_url raises; existing providers
  unaffected) → implement → green → commit
  `feat(llm): openai_compatible build_model branch (C2 B7)`.

### Task B8: endpoint engines selectable as project default

**Files:**
- Modify: `backend/app/schemas/llm_engine.py` (`endpoint_id` on stored +
  update request; read gains `endpoint_id` + `endpoint_label: str | None`
  — NO embedded endpoints matrix, decision 12)
- Modify: `backend/app/schemas/llm_target.py` (`endpoint_id: str | None = None`)
- Modify: `backend/app/schemas/extraction.py`
  (`ExtractionErrorCode.LLM_ENDPOINT_UNAVAILABLE`) + the
  `classify_extraction_error` branch mapping `EndpointUnavailableError`
  (decision 13) [panel]
- Modify: `backend/app/services/llm_engine_service.py`
- Test: `backend/tests/unit/test_llm_engine_schemas.py`,
  `backend/tests/integration/test_llm_engine_service.py`,
  `backend/tests/integration/test_run_engine_freeze.py` (additions),
  worker classify test file

Rules (each a test):
1. PUT with `endpoint_id` requires `provider == "openai_compatible"`,
   endpoint exists **in this project** (BOLA), `model ∈ allowed_models`,
   `validation_status == "ok"`;
2. Verified × prompted-only endpoint → ValueError (decision 10);
3. `resolve_project_engine`: stored `endpoint_id` ⇒ skip `find_entry`;
   endpoint missing/failed ⇒ `EndpointUnavailableError`; healthy ⇒
   `LlmTarget(provider="openai_compatible", model, endpoint_id=str(id))`;
4. `get_for_project` retired semantics for endpoint engines: endpoint
   gone or model no longer allowed (never `find_entry`); read carries
   `endpoint_label` from the row;
5. Freeze roundtrip: pinned `LlmTarget` with `endpoint_id` survives
   dump/validate; an OLD pinned snapshot validates with
   `endpoint_id is None`;
6. A dangling stored `endpoint_id` (row deleted concurrently) resolves
   to the typed 409, never a 500 [panel];
7. Worker classification: `EndpointUnavailableError` raised mid-flight
   → job status `LLM_ENDPOINT_UNAVAILABLE`, never `EXTRACTION_FAILED`
   [panel].

- [ ] Steps: failing tests per rule → implement → freeze/kickoff suites
  green → commit `feat(llm): endpoint-backed project engines (C2 B8)`.

### Task B9: credentials resolver + call-site switch

**Files:**
- Create: `backend/app/services/engine_credentials.py`
- Modify: `backend/app/services/api_key_service.py` (ONLY the
  `KeyScope.SHARED_ENDPOINT` member)
- Modify: `backend/app/services/section_extraction_service.py`
- Modify: `backend/app/services/model_extraction_service.py`
- Modify: `backend/app/worker/tasks/extraction_tasks.py` (the 3 worker
  resolution sites ~97/197/327). The section-extraction ENDPOINT at
  `section_extraction.py:182` is NOT touched — it stays on
  `resolve_project_engine` as the enqueue gate (no key decryption on
  the API path). [panel]
- Test: `backend/tests/unit/test_engine_credentials.py` + existing
  extraction families stay green

**Produces:**

```python
@dataclass(frozen=True)
class EngineCredentials:
    api_key: str | None
    key_scope: KeyScope | None
    base_url: str | None
    endpoint_id: str | None   # identity the key was resolved FOR
    def __repr__(self) -> str: ...   # never the key  [panel]

async def resolve_engine_credentials(
    db: AsyncSession, *, user_id: UUID | str, project_id: UUID, engine: LlmTarget,
) -> EngineCredentials:
    """Endpoint engine -> LlmEndpointService.get (project-scoped) ->
    decrypt (InvalidToken -> EndpointUnavailableError) ->
    (key, SHARED_ENDPOINT, base_url, endpoint_id). Missing endpoint ->
    EndpointUnavailableError — never a cloud fallback. Catalog engine ->
    the existing APIKeyService.get_key_for_provider path, endpoint_id
    None."""
```

**Rekey correctness (BLOCKING panel finding):** the adopted-pin rekey
trigger must compare **(provider, endpoint_id)**, not provider alone —
two endpoint engines share provider `"openai_compatible"`, and the old
equality check would run endpoint B's pin on endpoint A's key +
base_url. The services track the identity the current credentials were
resolved for and re-resolve when EITHER differs, applying the
resolver's `EngineCredentials` **atomically** (api_key, key_scope,
base_url together — a catalog→endpoint adoption that updated only the
key would crash `build_model` on a missing base_url).

Concretely: both services' constructors replace the `llm_api_key`
param with `llm_credentials: EngineCredentials | None = None`;
`_rekey_for_adopted_provider` becomes `_rekey_for_adopted_engine`,
delegating resolution to `resolve_engine_credentials` (its ~30-line
body moves out — `section_extraction_service.py` nets BELOW 1775).
The rekey seam needs `project_id` — verify the service already carries
it; if not, thread it through the constructor alongside credentials.
Both `build_model` calls pass `base_url=self._credentials.base_url`.

- [ ] **Step 1: failing tests**: endpoint engine resolves
  key+scope+url+id; keyless endpoint → api_key None; deleted endpoint →
  typed error (not fallback); catalog engine passes through; repr never
  contains the key; **adoption test: standalone kickoff keyed for
  endpoint A adopts a pin on endpoint B → the call carries B's
  base_url+key**; **catalog→endpoint adoption populates base_url**.
  [panel]
- [ ] **Steps 2–4:** implement; switch the 3 worker sites + rekey; run
  freeze/kickoff/section-extraction families; assert
  `wc -l backend/app/services/section_extraction_service.py` < 1775.
- [ ] **Step 5: commit** `feat(llm): one engine-credentials resolver, shared_endpoint scope (C2 B9)`.

### Task B10: PR-B contract regen + gate + ship

- [ ] `npm run generate:api-types` + commit diff (frontend deploy-window
  read normalization for `endpoint_label` lands in C1).
- [ ] Full backend gate: `make lint-backend`, mypy ratchet,
  `make test-backend` (never concurrent with quality-scan), fitness
  scripts (incl. `check_rls_coverage.py` exit 0 and
  `check_api_response_envelope.py` clean). Read outputs.
- [ ] Push `feat/c2-endpoints-backend`, PR → dev, arm auto-merge only
  after PR-A lands.

---

## PR-C — Endpoints UI + Ollama memo

### Task C1: frontend service + hooks

**Files:**
- Create: `frontend/services/llmEndpointService.ts` (typed apiClient;
  shapes from `types/api/schema.d.ts`)
- Create: `frontend/hooks/extraction/useLlmEndpoints.ts` (key-factory
  entry; list + create/update/delete/verify mutations; endpoint
  mutations ALSO invalidate the llm-engine key family — the engine read
  carries `endpoint_label`/retired state derived from endpoint rows)
- Modify: `frontend/services/llmEngineService.ts` (read normalization:
  `endpoint_label: data.endpoint_label ?? null`, tolerance per A4)
- Test: `frontend/test/services/llmEndpointService.test.ts`,
  `frontend/test/hooks/useLlmEndpoints.test.tsx`

- [ ] TDD steps per house pattern → commit
  `feat(frontend): llm-endpoint service + hooks (C2 C1)`.

### Task C2: management dialog

**Files:**
- Create: `frontend/components/extraction/LlmEndpointsDialog.tsx`
- Modify: `frontend/components/extraction/LlmEngineChip.tsx` (popover
  footer: "Manage custom endpoints…")
- Modify: `frontend/lib/copy/llmEngine.ts`
- Test: `frontend/test/LlmEndpointsDialog.test.tsx`

Dialog (react-hook-form + Zod, shadcn Dialog):
- list: label, host, validation badge (unverified gray / ok green /
  failed red), models count, Verify + Edit + Delete;
- add/edit form: label, base URL, API key (password input; edit
  placeholder `endpointKeyKeptPlaceholder` "Key stored — leave blank to
  keep"), allowed models (tag input), inline sanitized error on save;
- Verify → probe mutation → badge + `output_mode` chip; prompted-only
  renders `endpointPromptedWarn` (Verified-mode warning);
- delete uses the destructive-action pattern; surfaces the 409
  "engine points here" message.

- [ ] **Step 1: failing tests** — renders list; create fires POST with
  explicit fields; verify updates badge; prompted warn; delete 409
  surfaced; **Zod layer: empty label, >80-char label, non-URL
  base_url rejected client-side; edit-mode blank key sends
  `api_key: null` (keep) vs cleared field sends `""` (clear)** [panel].
- [ ] Steps → commit
  `feat(frontend): custom endpoint management dialog (C2 C2)`.

### Task C3: endpoint models in the picker

**Files:**
- Modify: `frontend/components/extraction/LlmEngineChip.tsx`
- Test: `frontend/test/LlmEngineChip.test.tsx`

Picker endpoint groups derive from `useLlmEndpoints(projectId)`
(decision 12 — no matrix on the engine read): one `CommandGroup` per
endpoint with `validation_status === "ok"` (heading = label + host,
`endpointGroupNote` "Project endpoint — runs on its shared key"); rows
= `allowed_models`; selecting fires PUT
`{provider: "openai_compatible", model, endpoint_id, mode, alternates?}`
(omission rules per A4). Current endpoint-model rows show ✓; chip label
for an endpoint engine renders `<model> · <endpoint_label>` from the
engine read's scalar.

- [ ] TDD steps (component test mocks both hooks; includes: chip label
  uses endpoint_label; selecting endpoint model sends endpoint_id;
  groups absent when no endpoint is `ok`) → commit
  `feat(frontend): endpoint models selectable in the picker (C2 C3)`.

### Task C4: PR-C gate + design review + ship

- [ ] `npm run test:run`, `npx tsc -p tsconfig.app.json`, lint — green.
- [ ] `/design-review` on the Configuration tab (local vite
  127.0.0.1:8080, teste@prumo.local).
- [ ] PR → dev after PR-B lands; arm auto-merge.

---

## Ollama evaluation (local only — NOTHING promotes)

### Task O1: local Ollama + models

- [ ] Ollama 0.32.0 is installed; `qwen3.6:35b-mlx` and `gemma3:1b`
  already pulled. Start `ollama serve`; verify
  `curl http://localhost:11434/v1/models`. Optionally pull ONE mid-size
  second model (e.g. `qwen3:8b`) for a second data point — check the
  live catalog page first.

### Task O2: endpoint through the real mechanism

- [ ] Local backend `.env`: `ALLOW_PRIVATE_LLM_ENDPOINTS=true` (honored
  only because `SUPABASE_ENV=local` — decision 4); start local stack;
  as teste@prumo.local create endpoint `http://localhost:11434/v1`
  (keyless) via the NEW dialog/API; run Verify — record the
  `output_mode` real Ollama earns per model (probe integration
  evidence).
- [ ] Point the seed project's engine at an endpoint model via the
  picker.

### Task O3: real extraction + measurement

- [ ] Run extraction on a fixture article (seed project). Capture:
  field quality vs a `gpt-5.6-luna` run of the same article, latency,
  structured-output parse error rate, Verified-pass behavior where
  output_mode allows. The RUN-LEVEL pin
  (`results.provenance.engine`) must show `openai_compatible` +
  `endpoint_id` and `key_scope: "shared_endpoint"` — and NEVER the key.
  (Per-section snapshots do not carry endpoint_id in C2 — assert at the
  run level only. [panel])

### Task O4: memo

- [ ] Write `docs/superpowers/plans/2026-08-17-ollama-local-eval.md`
  (frontmatter + `.markdownlintignore` entry already added): setup,
  probe results (output_mode per model), quality/latency/error table,
  verdict on documenting self-hosted Ollama as a supported path, and
  the explicit note that the SaaS §10 posture is UNCHANGED — cite the
  `test_flag_is_inert_outside_local_env` gate [panel], not just the
  default-config test. Commit into PR-C.

---

## Promotion (after PR-A/B/C merged to dev)

- [ ] `/preflight` — 4 gates GREEN or HALT.
- [ ] Promotion PR dev→main, `--auto --merge` (merge commit).
- [ ] After merge: `railway deployment list --service web` AND
  `--service worker`; if SKIPPED: `railway up --service X --detach`
  from this worktree on the promoted tree. Judge by API EFFECT
  (authenticated GET llm-engine shows `alternates`/`endpoint_label`),
  never logs (`railway logs --build` replays the PREVIOUS build).
- [ ] **Do not select an endpoint engine for any prod project until
  BOTH web and worker deploys are verified by effect** — an old worker
  fails endpoint pins loudly (`Unsupported LLM provider`), correct but
  noisy. [panel]
- [ ] Rollback note: rolling the backend back after a project stored an
  endpoint engine makes old readers drop `endpoint_id` (extra=ignore)
  and 409 new runs as retired until re-chosen — loud and correct, not
  data corruption. [panel]
- [ ] Vercel: verify a NEW production bundle by lazy-chunk marker, not
  deploy age.
- [ ] Prod verification per ship-spec Phase 7 (health, post-deploy
  smoke, e2e:remote with LOCAL frontend, never a browser on
  *.vercel.app).

## Self-review (writing-plans checklist)

- Spec §5 C2 coverage: alternates storage+UI ✓ (A1–A5); endpoints
  table/service/probe/SSRF/build_model ✓ (B1–B10); management UI ✓
  (C1–C3); Ollama eval ✓ (O1–O4). §5.1/§7 deliberately absent. The
  spec's `openai_compatible` column and the embedded-matrix reading are
  deliberately deviated (decisions 14 and 12) — both documented.
- All 12 panel blockers incorporated: check_rls_coverage reality (B1),
  service-side verify persistence (B4/B6), DELETE envelope (B6/decision
  15), env-bound SSRF flag (B3), probe rebinding + oracle (B3),
  deploy-window tolerance (A4/C1), rekey identity + atomicity (B9),
  typed worker error (B8/decision 13), real test paths (A1/A2/B6),
  guarded_json_request coverage (B3), Fernet InvalidToken (B4/B9),
  false B1 Step 4 rewritten (B1).
- Type consistency: `LlmEngineAlternate` A1→A2/A4;
  `EngineCredentials`/`resolve_engine_credentials` B9 producers =
  consumers; `LlmEndpointRead`/`LlmEndpointCapabilities` identical in
  B2/B4/B6/C1; `VettedUrl` B3→B5.
