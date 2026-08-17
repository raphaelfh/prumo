---
status: approved
last_reviewed: 2026-08-17
owner: '@raphaelfh'
---

# C1b — extraction engine surface (§5, scoped)

Ships the deferred §5 surface on top of the already-shipped backend half
(server-owned model #609, per-run freeze #613, key scope #613, forbid
#616). Scope: server-curated catalogue, per-project `llm_engine` setting,
model picker popover, Fast/Verified selector (Verified visible, disabled).
OUT: alternates, custom endpoints, §5.1 reviewer surfaces, §7 probe,
per-article cost preview (trigger-time UX — C2 territory).

**Checkable goal:** a manager picks an engine in the ⚙ popover → PUT
persists it under `projects.settings.llm_engine` → the next extraction
run freezes THAT engine (provenance records it) → a BYOK-only provider
with no user key renders locked with an "Add your key" CTA → a retired
stored engine blocks new runs with a typed error until re-chosen.

Design anchors (spec §5 + design overview): the ⚙ chip + popover are
**page chrome** (project regime) — engine edits never increment the Draft
chip and never appear in the Publish diff. No temperature/seed controls,
by design. Canonical `provider:model` string is what provenance carries.

## Facts the plan rests on (verified 2026-08-17)

- `projects.settings` JSONB exists (`project.py:69`) → **no migration**.
- `ParserSettingsService` is the exact storage precedent (plain JSONB,
  build-new-dict-and-REASSIGN or the change never persists).
- Resolution points to rewire: `section_extraction_service.py:179`
  (`_freeze_engine` candidate), `model_extraction.py:155/:183`,
  `extraction_tasks.py:88/:175/:283` (key lookup by provider),
  `model_extraction_service.py:110`.
- The C1a-2b freeze already pins per run — C1b only changes the SOURCE
  of the candidate; retries stay stable for free.
- `_get_global_key` covers only `openai`/`llama_cloud` → anthropic is
  BYOK-only; availability is per-user (their stored key).
- `require_project_manager` / `ensure_project_member` are the auth pair;
  B-9f's `draft_holder_name` shows the profile-name-at-read pattern.

## Tasks (each: failing test first → implement → verify)

**T1 — catalogue module** `backend/app/llm/catalog.py`.
`CatalogEntry` (frozen dataclass: provider, model, label, best_for,
context_window, cost_tier `$|$$|$$$`), `CATALOG` tuple (openai:
gpt-4o-mini, gpt-4o, gpt-4.1-mini; anthropic: claude-sonnet-4-5,
claude-haiku-4-5), `find_entry(provider, model)`, `canonical(entry)` →
`"provider:model"`. Curated data, deliberately small; a roster edit is a
one-line diff. *Tests:* uniqueness, find hit/miss, every provider is one
`build_model` accepts.

**T2 — engine setting service** `backend/app/services/llm_engine_service.py`.
Owns `settings["llm_engine"] = {provider, model, mode, updated_by,
updated_at, previous_model}`. Panel (constitution, BLOCKING): the shape
gets ONE typed spine — `LlmEngineStored` in
`backend/app/schemas/llm_engine.py`, written via `.model_dump(mode="json")`
at the single write site (`updated_at` is a datetime; a hand-rolled dict
dies in `json.dumps` at flush), `model_validate`d at exactly the two read
boundaries (`get_for_project`, `resolve_project_engine`) with defaults so
older payloads validate. Never parsed in the endpoint. `get_for_project` → resolved view: stored
value or the env default (`source: "project" | "default"`), plus
`retired: bool` (stored pair no longer in catalogue). `set_for_project`
(validates: entry must be in catalogue); records `previous_model`,
`updated_by`, `updated_at`. Reassign-to-track — and the service writes
ONLY its own `llm_engine` sub-key, never sibling keys (`parsing`).
Panel revision (YAGNI): the request schema types `mode:
Literal["fast"]`, so Pydantic refuses `verified` with a free 422 — no
typed-error class, no branch; the Literal widens compatibly when
Verified ships, and §5's "the enum lands in C1" is satisfied by the
Literal itself. *Tests:* default-when-unset; roundtrip; unknown-model
refused; `verified` → 422 (schema-level); previous_model chains; retired
flag flips when the roster drops the entry (monkeypatched catalogue);
sibling `parsing` key survives an engine write.

**T3 — endpoints** `backend/app/api/v1/endpoints/llm_engine.py`.
Panel (constitution, BLOCKING): the endpoint does auth + error mapping +
envelope, NOTHING else. `LlmEngineService.get_engine_read(project_id,
viewer_id)` owns the whole read model — resolved engine,
`updated_by_name` via a batched profile select (the
`_publisher_names`/B-9f shape in `template_version_read_service.py`),
and per-provider availability via a NEW non-decrypting, non-writing
`APIKeyService.has_key_for_provider` (existence probe only —
`get_key_for_provider` decrypts AND writes `update_last_used`, which a
member GET must never do). BYOK-only-ness becomes a fact on
`CatalogEntry` (`byok_only`) so it lives in ONE place, not a third
implicit branch. Both endpoints carry `@limiter.limit` (constitution
§IV; `parser_settings.py` has drifted — do not copy it). Panel
(security, BLOCKING): the GET's member check is `require_project_scope`
(`security.py:82-106`), the true member-of-path dependency — NEVER
`Depends(ensure_project_member)`, whose bare `user_sub` param would
materialize as a CLIENT-SUPPLIED query parameter (spoofable). PUT stays
`require_project_manager`. PUT body sets `extra="forbid"` (C1a
precedent); the service builds the stored dict from NAMED validated
fields — `updated_by` from the auth dependency, `previous_model` from
the stored value, never client-supplied. Availability response carries
ONLY booleans per provider — no key id, no `last_used_at`, no
validation status. Attribution `updated_by_name` is member-visible by
decision (precedent: `list_run_reviewers` serves full_name to any
member; the raw uuid already leaks via PostgREST member-SELECT; the
popover renders on the managerOnly tab anyway). Typed response models,
ApiResponse envelope. *Tests:*
direct endpoint-coroutine unit tests in the
`test_run_write_endpoints_unit.py:51-63` shape — patch auth gates +
service IN THE NEW ENDPOINT MODULE'S NAMESPACE, `db=AsyncMock()`, call
the coroutine, assert the gate awaited with the path project; the GET's
availability loop and profile-name lines are handler lines and must
EXECUTE (patch `APIKeyService` at module level) or diff-cover fails
exactly there; `@limiter.limit` needs the `getattr(fn, "__wrapped__",
fn)` unwrap trick. Plus integration: outsider 403, member GET 200,
reviewer PUT 403, manager PUT 200.

**T4 — resolution rewiring** (backend). `resolve_project_engine(db,
project_id) -> tuple[LlmTarget, mode]` in the engine service; raises
`EngineRetiredError` when the stored pair left the roster. Wire it into:
`run_from_request` / `extract_section` / `extract_all_sections` candidate
(replacing the `settings.LLM_DEFAULT_MODEL` default), `_freeze_engine`'s
provider (stops assuming `settings.LLM_PROVIDER`), `model_extraction`
endpoint + worker tasks. Panel (security, BLOCKING) — ordering: the
worker freezes (or reads the already-pinned engine) FIRST, and only then
resolves `get_key_for_provider(<PINNED provider>)`. Otherwise a retry
after a manager's provider flip resolves a key for a provider the
frozen engine does not use — spurious MissingLLMKeyError and a
key_scope recorded against the wrong provider. Kickoff endpoints map `EngineRetiredError` → 409 with
`error.code = "LLM_ENGINE_RETIRED"` — Panel (constitution, BLOCKING):
NOT via `HTTPException(409, detail=…)`, whose handler hardcodes
`code: "HTTP_ERROR"`; use an `AppError` subclass (handler maps
`exc.code`) or the `ApiResponse.failure` JSONResponse branch the
sections endpoint already uses for SERVICE_UNAVAILABLE. Tests assert
`error.code`, not just the status. The worker's classify path stays the
last resort. `mode_requested`/`mode_executed` become FIELDS on
`LlmTarget` (default `"fast"`), so the freeze dump/validate contract
stays a single spine and pre-C1b pinned runs still validate. Unset project → env default. Panel (test-coverage, BLOCKING) — the
"untouched tests" claim was FALSE; the real inventory: (a)
`resolve_project_engine` is imported AT MODULE LEVEL in
`section_extraction_service` and in the worker task module, so tests
patch `ses.resolve_project_engine` / the task-module seam; (b) four
files updated, named: `test_run_from_request.py` (5 branch assertions
pin the env default), `test_run_section_extraction_task.py`
(`_FakeSession` lacks `execute` — patch the resolver at the task seam),
`test_worker_eager_mode.py` (`assert_awaited_once_with("openai")`
flips), `test_one_live_run_conflict_mapping.py` (unpatched resolver on
a MagicMock pair could raise EngineRetired → 409 and the 409 test would
pass FOR THE WRONG REASON — patch it explicitly); (c)
`test_run_engine_freeze.py` exact-dict assertions gain the mode fields,
and freeze must tolerate a pre-C1b mode-less pinned snapshot (LlmTarget
defaults cover validate; the equality assertions are updated
deliberately); (d) NEW tests: fresh run on a project WITH `llm_engine`
set freezes the PROJECT pair (asserted on `_engine_of(run)` AND
`build_model` args), and a retry after `set_for_project` changes the
engine keeps attempt 1's pair — without this the #609 regression guard
stops guarding the real path; (e) a worker classify test for
retired-mid-flight (mirror `TestRunSectionExtractionTaskErrorCode`) so
it ships as a friendly code, not EXTRACTION_FAILED; (f) the import-time
default-param trap covers `section_extraction_service.py:249/:452/:846`
too, not just `model_extraction_service.py:110`. *Tests:* project-set engine reaches `build_model`;
retired refused at kickoff (409 with `error.code` asserted) and in the
service; unset falls back; outsider on a retired-engine project gets
403, NOT 409 (auth precedes engine work); validate-on-read stays even
though the write validates (a manager can still write raw JSONB via
PostgREST, bypassing the endpoint — the read-side retired check +
`build_model`'s provider whitelist contain a garbage stored pair).

**T5 — contract + frontend data layer.** `npm run generate:api-types`
(commit diff); `llmEngineService.ts` (get/put via apiClient,
`ErrorResult` — do NOT copy `parserSettingsService.ts`, which throws
`ApiError` in the pre-rules style), key factory entry as
`projectKeys.llmEngine(projectId)`, `useLlmEngine` +
`useSetLlmEngine` (invalidates the family). *Tests:* service body/URL
shape; hook invalidation.

**T6 — ⚙ chip + popover** (page chrome of the Configuration tab, outside
the versioned card). Panel (test-coverage, BLOCKING) — mount point
PINNED: the chip mounts in the page chrome ABOVE `TemplateConfigEditor`
(the `ExtractionInterface` configuration case), NOT inside the editor's
command bar. That is what the design overview draws (project regime vs
versioned card) AND it keeps the chip out of `TemplateConfigEditor.test`
/ `.discardMount.test` render trees, whose MSW gate
(`onUnhandledRequest: 'error'`) would fail on the new GET. Whatever
test renders the chip's new home mocks `useLlmEngine` in the house
style (every data hook mocked). Chip `⚙ <model label> · Fast`; popover: searchable
combobox grouped by provider (shadcn Command), row = label + one-line
best-for, right-aligned context window + cost tier, mono canonical
string; locked rows grayed + lock icon + "Add your key" CTA (deep link to
the existing key-settings surface); group header "each user runs on their
own key" for BYOK-only providers; segmented Fast/Verified with Verified
`disabled` + "soon"; attribution line when `source == "project"`
("Model changed by {name} · {date} · was {model}"). All copy via
`lib/copy`. Manager sees the editable popover; the tab is already
`managerOnly`. Panel revisions: (a) the popover FLAGS a retired stored
engine (amber note + "choose a new model") — the `retired` field must
have a reader, and the manager should learn why runs will block before
hitting the 409 (§5's never-visible-but-fails); (b) on `ErrorResult`
from `useLlmEngine` the chip renders NOTHING and the rest of the tab is
unaffected — covers the deploy-race window where new-FE hits old-BE and
the GET 404s. *Tests:* chip renders resolved engine; groups render;
locked row disabled + CTA; selection fires mutation with canonical pair;
Verified disabled; attribution renders from payload; retired note
renders; error branch hides the chip without blanking the tab.

**T7 — gates + evidence.** Do NOT add a migration — the head pin at
`test_migration_roundtrip.py:1095` fails on any new revision, and no
schema object changes here. Touch `docs/reference/deployment.md`'s
`LLM_DEFAULT_MODEL` row: after C1b the env pair is the FALLBACK for
unset projects (must-match warning stays necessary; rationale updated).
`make quality-scan` read end-to-end;
diff-cover 80 (endpoint-coroutine tests from T3 cover the blind spot);
fitness — Panel (test-coverage, BLOCKING): T4 does NOT fit under
`section_extraction_service.py`'s 1750 cap (+6-10 net lines minimum).
The named payment: extract `_freeze_engine` + `_build_run_provenance`
(~60 lines, `:181-240`) into a dedicated module (e.g.
`app/services/run_engine_freeze.py`) with explicit params — safe
because `test_run_engine_freeze.py` stubs `ses.build_model` /
`ses.extract_structured` / `ses.dump_extraction`, never the moved
methods. Do NOT bump the baseline;
`/design-review` on the config screen after T6. E2E evidence run
includes the two Configuration-tab Playwright flows
(`template-import.ui.e2e.ts`, `hitl-landing-pages.ui.e2e.ts`) — they
drive the real stack, the test account is a manager, no mocks needed.

## Risks the panel should attack

- The per-user availability read on GET does a BYOK lookup — N+1 or
  latency on the catalogue? (One `get_default` per provider, two
  providers — bounded.)
- `EngineRetiredError` surfacing in the WORKER after enqueue-time
  validation passed (roster change mid-flight) — terminal classify path
  must produce a friendly code, not `EXTRACTION_FAILED`.
- `model_extraction_service.py:110` has `model: str =
  settings.LLM_DEFAULT_MODEL` as a *default parameter value* — evaluated
  at import; rewiring must not leave a stale default behind.
- The GET is member-visible but exposes whether OTHER users… no — only
  the CALLER's availability; no cross-user key info may leak.
- Frontend: the chip must not render inside the versioned card or arm
  the Draft chip (engine edits are project regime).
- **Deploy-window skew, stated honestly:** the freeze happens IN THE
  WORKER. A run enqueued while an old worker drains after a new web
  deploy freezes the env default instead of the project engine — for
  that run's whole life (retries stay pinned by design). Bounded by the
  Railway rollout; provenance stays truthful about what ran; accepted,
  no mitigation built.
