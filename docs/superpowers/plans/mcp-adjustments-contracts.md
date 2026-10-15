---
status: draft
last_reviewed: 2026-10-15
owner: '@raphaelfh'
---

# MCP typed contracts for options and values Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** one option shape (`{value, label}`) on every read and write path, a write-time value contract checked against the field the run is pinned to, typed MCP values with labels and units, display names next to ids in MCP results, agent edits on blank templates, QA rules frozen in the template version, seeds that stop feeding the model placeholders, and two schema hardenings (evidence indexes, HITL config foreign keys).

**Architecture:** `app/llm/claim_value.normalize_options` becomes the one read-side reader that turns any stored option shape into `[{value, label}]`; every backend reader delegates to it and `frontend/lib/extraction/options.ts::normalizeOptions` mirrors it on the client. Frozen template-version snapshots are never rewritten; the live rows are converted once by a data migration. A pure module `services/value_contract.py` canonicalizes a value against a field read from the run's pinned version and is wired only into human decision and consensus-override writes. MCP renders values through one envelope peel shared with exports. QA rules (`derived_judgments`, `scope_rules`) are copied into each version snapshot and every per-run consumer reads the pinned copy.

**Tech Stack:** FastAPI, Pydantic v2, SQLAlchemy 2 async, Alembic, Postgres 17, MCP Python SDK, React 19 + TanStack Query + react-hook-form + Zod + Vitest + MSW.

**Scope:** 25 tasks, one PR. A value-envelope CHECK migration and its later VALIDATE are out of this plan (they need a recorded production audit first); this plan ships the read-only audit reporter they depend on. No spec link: the goal, the global constraints and the per-task requirements below are the contract.

## Global Constraints

- **Worktree.** `$WT` = `/Users/raphaelfedericcihaddad/PycharmProjects/prumo/.claude/worktrees/admiring-borg-9059d9` (branch `feat/mcp-adjustments-contracts`). Every command uses `git -C "$WT"` or absolute `$WT/...` paths; never touch the main checkout. Confirm with `git -C "$WT" status` that edits landed there. Never `git stash`.
- **One PR.** The whole plan ships as one PR to `dev` (squash-merged), title `feat(mcp): typed option and value contracts for templates and extractions`. Each task ends in its own conventional commit (the commit title is given in the task). PR body tracker lines, exactly: `Fixes PRU-76, PRU-77, PRU-79, PRU-91, PRU-96, PRU-107` and `Refs PRU-86` (PRU-86 stays open until the value-envelope CHECK work lands later). The PR body also carries the **Deploy skew** note: until a browser reloads, a stale bundle's field save sends `string[]` options and gets the 422 inline error, and its grid shows canonical options as raw objects; the frontend deploys first, then the backend, in the same release window, and the Inspector's existing reload-on-error path recovers. It also notes that the agreement key changes for numbers (a pre-deploy `"22"` and a post-deploy `22` on one coordinate read as a divergence; rare and self-resolving).
- **Test-first.** Each task writes its failing test, runs it red, then implements; no "done" without the green command output read back.
- **Errors.** New REST domain errors subclass `AppError` (`backend/app/core/error_handler.py`) with an UPPER_SNAKE `code` (`VALUE_CONTRACT_VIOLATION`, 422) and go through the global handler; endpoints add no bare `HTTPException` for them. MCP tool errors use the existing `McpToolError` envelope (`code`, `message`, `next_step`, `retryable`, extras), never a docs URL or raw pydantic text; validation messages go through `api/mcp/errors.validation_failure`. A foreign project or resource stays byte-identical to a missing one (`NOT_FOUND`).
- **Layering.** `backend/app/api/**` imports services and support modules only, never `app.models` or `app.repositories` (`scripts/fitness/check_layered_arch.py`). Services own their writes; endpoints commit. One ownership predicate, in the WHERE clause (`scripts/fitness/check_scope_guards.py` stays green).
- **Data path.** No new direct PostgREST read or write. The two known PostgREST reads of `extraction_entity_types` with embedded `extraction_fields(*)` (`frontend/hooks/extraction/useTemplateEntityTypes.ts`, `frontend/services/qaTemplateService.ts`) change their TypeScript types only. `scripts/fitness/check_frontend_data_path.py` baseline does not grow.
- **Snapshots.** Frozen `extraction_template_versions.schema` JSON is never rewritten by code. `normalize_options` (backend) is the one read-side tolerance point for option shapes; the portable import is the other.
- **Migrations.** One task at a time, in this order: Task 2.1b (`0084_canonical_field_options`), Task 2.8a-1 (`0085_freeze_qa_rules`), Task 2.10 (`0086_evidence_idx_hitl_fk`). Current head `0083_mcp_oauth`. Each migration task confirms its number first (`ls "$WT/backend/alembic/versions" | grep '^0' | sort | tail -1` must print the previous one), uses a revision id ≤ 32 characters, sets `down_revision` to the previous head, moves `expected_head` in `backend/tests/integration/test_migration_roundtrip.py::test_alembic_head_is_expected_revision`, and adds a roundtrip test there (`_run_alembic("downgrade", "<parent>", database_url=migration_db_url)` then `"upgrade", "head"`, as `test_migration_0083_mcp_oauth_roundtrip` does). Short CHECK names (the `ck` naming convention expands them). No seed data in migrations; never app-schema DDL through the Supabase MCP. `cd "$WT/backend" && uv run alembic check` = no diff on every model change. After each migration task, run `cd "$WT/backend" && uv run alembic upgrade head` once on the test database.
- **Backend test infra.** `backend/.env` already points `DATABASE_URL` at database `postgres_test_mcp_contracts` on `localhost:55432` (stub + `alembic upgrade head` + seed applied) and `REDIS_URL=redis://localhost:56379/0`. Run `cd "$WT/backend" && uv run pytest <paths> -q`. Every backend task's gate also runs `tests/unit`. Never the shared local Supabase stack; never `make db-fresh`/`make reset-db`; never print `.env`. A task that changes the seed re-seeds that database with `cd "$WT/backend" && uv run python -m app.seed`.
- **Coverage.** CI fails a PR whose diff coverage is under 80% (`PRUMO_DIFF_COVERAGE_MIN`, `.github/workflows/ci.yml` "Diff coverage gate"). Lines reached only through httpx `ASGITransport` fixtures register no coverage, so each changed endpoint body also gets a direct unit test (handler called via `fn.__wrapped__`, as in `backend/tests/unit/test_personal_access_tokens_endpoint_unit.py`) and each service function a direct service-level test on `db_session`. Reproduce: `cd "$WT/backend" && uv run pytest tests/ --cov=app --cov-report=xml -q && uv run diff-cover coverage.xml --compare-branch=origin/dev --fail-under=80`.
- **No app-unused symbol at any task boundary.** Vulture scans `backend/app` only, so a function, constant or property lands in the task that adds its first `backend/app` caller (tests do not count). Each backend task ends with `cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec` green; the baseline never grows, and a deletion that removes a baselined name shrinks `backend/.vulture_baseline` in the same task.
- **Fitness scripts** run from `$WT` with the backend venv first on PATH: `cd "$WT" && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/<script>.py`, and `cd "$WT" && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh` for the whole set.
- **Frontend tooling runs from the repo root** (`$WT`): `npx vitest run <file>`, `npm run test:run`, `npm run typecheck`, `npm run lint`, `npx knip`, `npx knip --production`. Never `cd frontend && npm ...`. If `$WT/node_modules` is missing or a symlink, run `cd "$WT" && npm ci` first.
- **REST contract change** (any edit to a schema class served by `/api/v1`, docstring included) ⇒ `cd "$WT" && npm run generate:api-types` and commit `frontend/types/api/schema.d.ts` + `frontend/types/api/openapi.json` in the same task. The backend task that changes the schema regenerates; a frontend task that then breaks on the new types is the next task in order and the PR is atomic.
- **No dead code.** A replaced path is deleted in the same task; orphans found outside the task go in a sibling `refactor(<area>): ...` commit. `npx knip` and `npx knip --production` stay at 0.
- **Copy** goes through `t(namespace, key)` from `frontend/lib/copy/`; `scripts/fitness/check_copy_keys.py` stays green. Query keys come from factories only (`check_react_query_keys.py`).
- **MCP result rules.** Every tool result stays ≤ 32,000 characters (`app.utils.compact_json.RESULT_CAP`; `test_mcp_result_shape.py` and the per-tool cap tests stay green). Names next to ids (`project_name`, `template_name`) appear once per result, never per row, capped with `app.utils.text_caps.cap_text`, and are listed in `untrusted_fields`. Results that carry authored or article-derived strings keep `untrusted_content: true` with accurate `untrusted_fields` paths.
- **English only** in code, comments, commits, docs and copy keys.
- **Public wording.** This repo is public. Commit messages, the PR title/body and docs describe the intended behavior and the tests only, cite no local-only document, path or key, and name no private project.
- **Gates per task:** backend tasks — `cd "$WT" && make lint-backend` (ruff + format + mypy ratchet), backend pytest on `tests/unit` plus the touched integration suites, the vulture command, `bash scripts/fitness/run_all.sh` (PATH as above), `uv run alembic check` on model or migration tasks; frontend tasks — `npm run test:run`, `npm run lint`, `npm run typecheck`, `npx knip`, `npx knip --production`, `check_copy_keys.py`.

## Task order

| Task | Title | Layer | Touches `backend/alembic/versions/` | Depends on |
|---|---|---|---|---|
| 2.1a-1 | Canonical option type and one option reader | backend | no | — |
| 2.1a-2a | Canonical options on the run view and the MCP template read | backend | no | 2.1a-1 |
| 2.1a-2b | Option rename is a cosmetic diff; legacy baselines compare canonical | backend | no | 2.1a-2a |
| 2.1a-2c | Export descriptors carry option value and label pairs | backend | no | 2.1a-2b |
| 2.1b | Canonical options in data — portable import, seeds, migration 0084 | backend | **yes** (0084) | 2.1a-2c |
| 2.2a-1 | One client-side option reader (`normalizeOptions`) | frontend | no | 2.1b |
| 2.2a-2 | Field types, Zod rule and readers on `{value, label}` | frontend | no | 2.2a-1 |
| 2.2b-1 | Inspector renames an option's label and keeps its code | frontend | no | 2.2a-2 |
| 2.2b-2 | Template tree, field restore writers and the example template | frontend | no | 2.2b-1 |
| 2.3a | Pure write-time value contract | backend | no | 2.1b |
| 2.3b | Enforce the value contract on human decisions and consensus overrides | backend | no | 2.3a |
| 2.3c | Show value-contract refusals in autosave and the consensus override | frontend | no | 2.3b, 2.2b-2 |
| 2.4a | Read-only value-envelope audit reporter | backend | no | — |
| 2.5a | One envelope peel and typed MCP values on detailed rows | backend | no | 2.1b |
| 2.5b | Typed concise cells, evidence truncation, option parity, summaries | backend | no | 2.5a |
| 2.6 | Display names next to ids in MCP results and errors | backend | no | 2.5b |
| 2.7a | Agent template edits on a blank template; specific refusal reasons | backend | no | 2.6 |
| 2.7b | The instruction save takes the template draft lock | backend + frontend | no | 2.7a |
| 2.8a-1 | QA rules frozen into template version snapshots (migration 0085) | backend | **yes** (0085) | 2.1b |
| 2.8a-2 | Run view, finalize gate and AI field filter read pinned QA rules | backend | no | 2.8a-1 |
| 2.8b-1 | Exports apply each article's pinned QA rules | backend | no | 2.8a-2 |
| 2.8b-2 | Re-import refreshes rules into a new version; QA screen reads run rules | backend + frontend | no | 2.8b-1 |
| 2.9a | CHARMS catalogue cleanup that converges on existing databases | backend | no | 2.1b |
| 2.9b | Seeded AI instructions stop asking to retype the review question | backend + frontend | no | 2.9a |
| 2.10 | Evidence FK indexes and HITL config scope FKs (migration 0086) | backend | **yes** (0086) | 2.8a-1 |

- Tasks run in the order of this document; every task ends in its own commit on the one branch.
- Migrations land one at a time in this order: 2.1b (0084), 2.8a-1 (0085), 2.10 (0086). Each confirms the previous head before writing its file.
- Sequential by shared files: 2.1a-1 → 2.1a-2a → 2.1a-2b → 2.1b edit `schemas/template_structure.py`, `llm/claim_value.py` or `template_versioning/_diff.py`; 2.5a → 2.5b → 2.6 edit `schemas/mcp_extractions.py` and `extraction_agent_read_service.py`; 2.6 → 2.7a edit `api/mcp/tools/template_draft.py`; 2.3b → 2.8a-2 edit `extraction_snapshot.py`; 2.2a-1 → 2.3c edit `FieldValueEditor.tsx`; 2.1b → 2.9a → 2.9b edit `seed.py`.
- Disjoint and parallelizable if needed: 2.4a (new files only) with anything.
- Between 2.1a-1 (first API type regeneration) and 2.2b-2, `npm run typecheck` reports errors in the frontend files those frontend tasks own; each frontend task names the remaining ones in its commit body and 2.2b-2 ends with a clean typecheck. The PR is atomic.

## Review Focus

1. **Frozen snapshots keep legacy option shapes** (`["Yes","No"]`, `{"options": [...]}`, mixed lists): every reader — run view, MCP `get_template`, draft diff, Discard, republish, exports — must read them as `{value, label}` without minting a version or reporting a change (tests in 2.1a-2a, 2.1a-2b, 2.1a-2c).
2. **What the reviewer UI sends mid-edit must not be refused:** an "Other" picked before its text is typed (`{"selected": "other", "other_text": ""}`), a cleared field (`{"value": null}`), a numeric string, the double wrap the autosave sends (2.3a's UI-shape vector; 2.3b's end-to-end cases).
3. **System carry-overs are never refused:** QA materialization of human proposals inside the extract→consensus advance, AI landing and approve-and-finalize keep working with an off-contract legacy value (2.3b `test_qa_materialization_carries_off_contract_proposal`, `test_approve_and_finalize_publishes_off_vocabulary_ai_value`).
4. **Names never leak existence:** a foreign project or template answers byte-identically to a missing one, with no `project_name`/`template_name` (2.6 `test_foreign_not_found_is_byte_identical_to_missing`).
5. **No phantom versions:** a template without QA rules, an unchanged re-import, and an option-shape-only difference all publish nothing (2.8a-1, 2.8b-2, 2.1a-2b).

---

### Task 2.1a-1: Canonical option type and one option reader

**Layer:** backend · **Migration:** no · **Commit:** `feat(templates): one {value, label} option shape for template field writes`

**Goal:** a field option is `{value, label}` everywhere a template field is written or returned by the REST field endpoints and the MCP `add_question` op; `app/llm/claim_value.normalize_options` becomes the one reader that turns any stored shape into canonical `[{value, label}]`, and every backend reader of options delegates to it and drops its local tolerance.

**Context:** today `AllowedValues` (`backend/app/schemas/template_structure.py:59`) is `list[str]`, `TemplateFieldRead.allowed_values` (:218) is `list[str] | None`, and `normalize_options` (`backend/app/llm/claim_value.py:22-36`) only unwraps `{"options": [...]}` and passes items through raw. Seeds (`seed_probast_ai.py`) already store `{value, label}` dicts for PROBAST+AI, and legacy rows hold `["Yes", "No"]`. Frozen version snapshots are never rewritten; `normalize_options` is the read-side tolerance point. The value is the stored code; renaming an option changes only its label. `backend/app/schemas/**` is excluded from vulture; `app/api/**` must not import `app.models`.

**Files:**
- Modify: `backend/app/schemas/template_structure.py` (`OptionItem`, `AllowedValues`, `TemplateFieldRead.allowed_values` + before-validator)
- Modify: `backend/app/schemas/template_portable.py` (`PortableField.allowed_values` keeps `AllowedValues`; this task only makes sure it type-checks — the legacy-tolerant import is Task 2.1b)
- Modify: `backend/app/schemas/mcp_template_draft.py` (`OptionInput`, `AddQuestionOp.options`)
- Modify: `backend/app/llm/claim_value.py` (`normalize_options`, `option_label_map`)
- Modify: `backend/app/services/value_semantics.py` (`_option_values` :165-175)
- Modify: `backend/app/services/template_versioning/_diff.py` (`_option_codes` :581-589)
- Modify: `backend/app/llm/schema.py` (`_enum_values` :49-60)
- Modify: `backend/app/api/mcp/tools/templates.py` (`_options` :273-280 — still returns labels in this task; Task 2.1a-2a changes its shape)
- Modify: `backend/app/llm/prompts/entry_identification.py` (`_allowed_value_names` :122-136)
- Modify: `backend/app/services/exports/extraction_snapshot_reader.py` (`_normalize_allowed_values` :124-141; delete the "value == label in prumo" sentence from its docstring)
- Modify: `backend/app/api/mcp/tools/template_draft.py` (`_DESCRIPTION` :100-107: say options are `[{value?, label}]`, a missing value becomes the trimmed label)
- Test: `backend/tests/unit/llm/test_claim_value.py`, new `backend/tests/unit/llm/test_option_readers.py`, `backend/tests/unit/test_template_structure_schemas.py`, `backend/tests/unit/test_mcp_template_draft_ops.py`, `backend/tests/integration/test_template_structure_endpoints.py`, `backend/tests/integration/mcp/test_mcp_edit_template_draft.py`
- Regenerate: `frontend/types/api/schema.d.ts`, `frontend/types/api/openapi.json`

**Interfaces:**
- Produces (schemas, `template_structure.py`):
  ```python
  class OptionItem(BaseModel):
      model_config = ConfigDict(extra="forbid")
      value: str = Field(min_length=1, max_length=100)
      label: str = Field(min_length=1, max_length=100)

  AllowedValues = Annotated[
      list[OptionItem], Field(min_length=1, max_length=100), AfterValidator(_reject_duplicate_option_values)
  ]  # unique by value
  ```
  `TemplateFieldRead.allowed_values: list[OptionItem] | None` with a `field_validator(mode="before")` that returns `None` for `None` and `normalize_options(raw) or None` otherwise (so a legacy `["Yes","No"]` row reads `[{value:"Yes",label:"Yes"},{value:"No",label:"No"}]`). `_reject_duplicate_items` stays for `AllowedUnits`.
- Produces (MCP, `mcp_template_draft.py`): `class OptionInput(BaseModel)`: `extra="forbid"`, `value: str | None = Field(default=None, min_length=1, max_length=100)`, `label: str = Field(min_length=1, max_length=100)`. `AddQuestionOp.options: list[OptionInput] | None` (1..100 items) whose existing field-level `_options_match_type` validator also converts to `list[OptionItem]` (value = `value` or `label.strip()`), raising `ValueError("option values must be unique")` on a duplicate value. Keep it field-level (the module docstring requires `errors()[0]["loc"]` to name the argument), so the duplicate surfaces as the existing audited `INVALID_ARGUMENT` via `validation_failure`. `agent_template_draft_service._add` is unchanged (it passes `op.options` into `TemplateFieldCreateRequest`).
- Produces (reader, `claim_value.py`): `normalize_options(allowed_values: Any) -> list[dict[str, str]]`:
  - `None`, a non-list/non-wrapper → `[]`; `{"options": [...]}` → its list.
  - Item `str` (non-empty after strip) → `{"value": s, "label": s}`.
  - Item `dict` (or any object exposing `value`/`label` attributes, e.g. an `OptionItem`) with a non-empty `value` → `{"value": str(value), "label": str(label) if label else str(value)}`; with only a `label` → `{"value": str(label), "label": str(label)}`.
  - Anything else is skipped; order preserved.
  `option_label_map` becomes `{o["value"]: o["label"] for o in normalize_options(allowed_values)}`.
- Delegates (each keeps its signature and drops its own shape tolerance):
  - `value_semantics._option_values(allowed_values) -> set[str]`: `{o["value"] for o in normalize_options(allowed_values)}`.
  - `_diff._option_codes(allowed_values) -> list[str]`: `[o["value"] for o in normalize_options(allowed_values)]`.
  - `llm/schema._enum_values(field) -> list[Any]`: the values of `normalize_options(getattr(field, "allowed_values", None))`.
  - `templates._options(allowed_values) -> list[str] | None`: the labels of `normalize_options(...)`, `None` when empty.
  - `entry_identification._allowed_value_names(allowed_values) -> list[str]`: the values.
  - `extraction_snapshot_reader._normalize_allowed_values(raw) -> tuple[AllowedValue, ...]`: `AllowedValue(value=o["value"], label=o["label"])` per option.

- [ ] **Step 1: Write the failing tests.**
  - `tests/unit/llm/test_claim_value.py`, new class `TestNormalizeOptions`:
    ```python
    CANONICAL = [{"value": "Y", "label": "Yes"}, {"value": "N", "label": "No"}]

    @pytest.mark.parametrize("raw", [
        ["Y", "N"],                                   # legacy bare strings → value == label
        {"options": ["Y", "N"]},                      # legacy wrapper of strings
        {"options": [{"value": "Y"}, {"value": "N"}]},  # legacy wrapper, label-less dicts
    ])
    def test_legacy_shapes_read_canonical(raw):
        assert normalize_options(raw) == [{"value": "Y", "label": "Y"}, {"value": "N", "label": "N"}]

    def test_canonical_is_unchanged():
        assert normalize_options(CANONICAL) == CANONICAL

    def test_mixed_list_and_label_only():
        assert normalize_options(["Y", {"value": "NI", "label": "No information"}, {"label": "Z"}]) == [
            {"value": "Y", "label": "Y"}, {"value": "NI", "label": "No information"}, {"value": "Z", "label": "Z"}]

    def test_objects_with_attributes_are_read():
        assert normalize_options([OptionItem(value="dev", label="Development")]) == [
            {"value": "dev", "label": "Development"}]

    def test_junk_is_skipped():
        assert normalize_options(None) == [] and normalize_options("x") == []
        assert normalize_options([None, 3, "", {}, {"value": ""}]) == []
    ```
    (`OptionItem` imported from `app.schemas.template_structure`; the existing `TestOptionLabelMap` cases stay and must still pass.)
  - New `tests/unit/llm/test_option_readers.py`: for `LEGACY = ["development_only", "validation_only"]` vs `CANONICAL = [{"value": "development_only", "label": "development_only"}, {"value": "validation_only", "label": "validation_only"}]`, assert `entry_identification._allowed_value_names(LEGACY) == _allowed_value_names(CANONICAL) == ["development_only", "validation_only"]`, and `extraction_snapshot_reader._normalize_allowed_values(LEGACY) == _normalize_allowed_values(CANONICAL)`; also `_allowed_value_names({"options": LEGACY})` returns the same list (the wrapper is now tolerated). Same identity check for `value_semantics._option_values`, `_diff._option_codes` and `llm.schema._enum_values(SimpleNamespace(allowed_values=...))`.
  - `tests/unit/test_template_structure_schemas.py`: update the bare-string cases (~L149, 155, 277, 359) to `[{"value": ..., "label": ...}]`; add: `["Yes"]` → `ValidationError`; duplicate `value` → `ValidationError` "option values must be unique"; `{"value":"y","label":"Yes","extra":1}` → `ValidationError` (forbid); `TemplateFieldRead.model_validate({... "allowed_values": ["Yes","No"] ...})` reads canonical.
  - `tests/unit/test_mcp_template_draft_ops.py` (~L33, 35): `options=[{"label": "Yes"}, {"value": "n", "label": "No"}]` → `op.options == [OptionItem(value="Yes", label="Yes"), OptionItem(value="n", label="No")]`; `[{"label": " Yes "}, {"value": "Yes", "label": "Again"}]` → `ValidationError` whose first error `loc` is `("options",)`; bare `["a"]` → `ValidationError`.
  - `tests/integration/test_template_structure_endpoints.py` (fixtures `db_session`, `db_client`, `auth_as_profile`; setup: `project_id = SEED.secondary_project; await clean_project_clones(db_session, project_id); clone = await clone_charms(db_session, project_id, auth_as_profile); et_id = await first_entity_type_id(db_session, clone.project_template_id)`):
    - `test_select_field_rejects_bare_string_options`: POST `.../fields` with `field_type="select"`, `allowed_values=["Yes"]` → 422, `body["error"]["code"] == "VALIDATION_ERROR"`.
    - `test_select_field_accepts_canonical_options`: same with `[{"value":"y","label":"Yes"}]` → 201, `data["allowed_values"] == [{"value":"y","label":"Yes"}]`.
    - `test_patch_reads_legacy_options_canonical`: create a select field, plant `UPDATE public.extraction_fields SET allowed_values = '["Yes","No"]'::jsonb WHERE id = :id`, PATCH its `label` → 200 with `data["allowed_values"] == [{"value":"Yes","label":"Yes"},{"value":"No","label":"No"}]`.
  - `tests/integration/mcp/test_mcp_edit_template_draft.py`:
    - `test_add_question_mapping` (~L140): send `"options": [{"label": "Yes"}, {"value": "n", "label": "No"}]`; the stored `allowed_values` is `[{"value":"Yes","label":"Yes"},{"value":"n","label":"No"}]`.
    - `test_add_question_duplicate_option_value_is_invalid_argument`: `[{"label":"Yes"},{"value":"Yes","label":"Again"}]` → `error_payload(result)["code"] == "INVALID_ARGUMENT"`, no field written, one refused audit row (`_audit_count(db_session, outcome="refused")` +1).

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/unit/llm/test_claim_value.py tests/unit/llm/test_option_readers.py tests/unit/test_template_structure_schemas.py tests/unit/test_mcp_template_draft_ops.py tests/integration/test_template_structure_endpoints.py tests/integration/mcp/test_mcp_edit_template_draft.py -q` → FAIL.

- [ ] **Step 3: Implement** the schemas, `normalize_options`, `option_label_map` and the six delegates per Interfaces. Update the `normalize_options` docstring: "The one reader of a field's options: any stored shape (bare strings, `{"options": [...]}`, `{value[, label]}` dicts, or `OptionItem`s) → canonical `[{"value", "label"}]`. Frozen snapshots keep their legacy shapes; read them through here." Update `_diff` module docstring L19-22 only where it says options are compared as bare strings (rename detection is Task 2.1a-2b; leave that sentence for it).

- [ ] **Step 4: Fix the remaining unit tests** that build bare-string options for these schemas (`tests/unit/test_template_portable_schema.py:69` → canonical items). Do not change `FieldDescriptor` tests (Task 2.1a-2c).

- [ ] **Step 5: Regenerate API types.** `cd "$WT" && npm run generate:api-types` → `schema.d.ts` gains `OptionItem` and `TemplateFieldCreateRequest/UpdateRequest/Read.allowed_values` become `OptionItem[] | null`. Frontend typecheck errors this causes are fixed by Tasks 2.2a-1…2.2b-2 in this PR; do not touch frontend code here.

- [ ] **Step 6: Run green + gates.**
  ```bash
  cd "$WT/backend" && uv run pytest tests/unit tests/integration/test_template_structure_endpoints.py \
    tests/integration/mcp/test_mcp_edit_template_draft.py tests/integration/mcp/test_mcp_get_template.py \
    tests/integration/test_template_portable_service.py -q
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh
  cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  ```
  Expected: PASS; gates green. If `test_template_portable_service.py` round-trip fails because a live seeded row holds a mixed list (`_PAI_SIGNALING`), that is fixed by Task 2.1b's legacy-tolerant `PortableField`; record it in the commit body and continue.

- [ ] **Step 7: Commit.** `git -C "$WT" add backend frontend/types/api && git -C "$WT" commit -m "feat(templates): one {value, label} option shape for template field writes"`

**Done when:** REST and MCP writes accept only `{value, label}` (MCP value optional), reads return canonical options for legacy rows, every listed reader delegates to `normalize_options`, types regenerated, gates green.

---

### Task 2.1a-2a: Canonical options on the run view and the MCP template read

**Layer:** backend · **Migration:** no · **Commit:** `feat(mcp): get_template and the run view return {value, label} options`

**Goal:** the MCP `get_template` question options and the REST run view's `RunViewField.allowed_values` are canonical `[{value, label}]` for every stored shape (including legacy frozen snapshots); the MCP untrusted-field paths follow the new shape; the unserved `schemas/extraction` field/entity/template schemas are deleted in a sibling commit.

**Context:** `app/llm/claim_value.normalize_options` (Task 2.1a-1) returns canonical `list[dict[str, str]]` for any stored shape and also reads objects exposing `value`/`label`. `OptionItem` (`{value, label}`, `extra="forbid"`) lives in `backend/app/schemas/template_structure.py`. Frozen snapshots in `extraction_template_versions.schema` keep legacy shapes and are never rewritten: reads canonicalize. Every MCP result that carries authored text sets `untrusted_content: true` and lists each authored-string leaf in `untrusted_fields`; `tests/integration/mcp/test_mcp_result_shape.py::test_untrusted_fields_declare_every_untrusted_string` walks `outputSchema` and requires the declared set to equal the untrusted set exactly. `app/api/**` must not import `app.models`.

**Files:**
- Modify: `backend/app/schemas/mcp_templates.py` (`McpOption`, `McpTemplateQuestion.options`, `McpTemplateView.untrusted_fields`)
- Modify: `backend/app/api/mcp/tools/templates.py` (`_options` :273-280 returns `list[McpOption] | None`)
- Modify: `backend/app/schemas/extraction_run.py` (`RunViewField.allowed_values` :215 + before-validator)
- Modify: `backend/app/services/exports/extraction_snapshot_reader.py` only if mypy flags `view.allowed_values` now typed `list[OptionItem] | None` (it already calls `_normalize_allowed_values`, which reads objects through `normalize_options`)
- Test: `backend/tests/integration/mcp/test_mcp_get_template.py`, `backend/tests/unit/test_extraction_run_schemas.py`, `backend/tests/integration/mcp/test_mcp_result_shape.py` (only if a pinned list needs the new paths)
- Sibling refactor commit: `backend/app/schemas/extraction.py` (delete `ExtractionFieldSchema` :326-346, `ExtractionEntityTypeSchema` :349-362, `ExtractionTemplateSchema` :365-376; keep `Framework` :16 — it is imported by `template_portable.py`, `template_catalogue.py`, `hitl_session.py`), `backend/app/schemas/__init__.py` (imports :31-34 and `__all__` :92-94), `backend/tests/unit/test_extraction_schemas.py` (helpers `_field_schema_kw` :372, `_entity_type_kw` :383 and classes `TestExtractionFieldSchema` :394, `TestExtractionEntityTypeSchema` :419, `TestExtractionTemplateSchema` :436-467)
- Regenerate: `frontend/types/api/schema.d.ts`, `frontend/types/api/openapi.json`

**Interfaces:**
- Consumes: `normalize_options(allowed_values: Any) -> list[dict[str, str]]`; `OptionItem`.
- Produces:
  - `class McpOption(BaseModel): value: str; label: str` in `schemas/mcp_templates.py`; `McpTemplateQuestion.options: list[McpOption] | None` (null for non-choice fields and for a choice field with no readable options).
  - `templates._options(allowed_values: object) -> list[McpOption] | None` = `[McpOption(**o) for o in normalize_options(allowed_values)] or None`.
  - `McpTemplateView.untrusted_fields`: replace `"sections[].questions[].options[]"` with `"sections[].questions[].options[].value"` and `"sections[].questions[].options[].label"` (both are authored text); everything else unchanged.
  - `RunViewField.allowed_values: list[OptionItem] | None` with:
    ```python
    @field_validator("allowed_values", mode="before")
    @classmethod
    def _canonical_options(cls, raw: Any) -> list[dict[str, str]] | None:
        if raw is None:
            return None
        return normalize_options(raw) or None
    ```
    (import `normalize_options` from `app.llm.claim_value`; `schemas` and `llm` are both support packages, so the edge is allowed by `check_layered_arch.py`.)

- [ ] **Step 1: Write the failing tests.**
  - `tests/integration/mcp/test_mcp_get_template.py`, new `test_probast_ai_study_type_options_are_value_label` (fixtures `mcp_client`, `pat_primary_read`, `db_session`): clone the PROBAST+AI global into `SEED.primary_project` as in `tests/integration/test_template_portable_service.py:47-55` (`clone_template(db_session, project_id=SEED.primary_project, global_template_id=_PROBAST_AI_TEMPLATE_ID, user_id=SEED.primary_profile, kind=TemplateKind.QUALITY_ASSESSMENT)`; `_PROBAST_AI_TEMPLATE_ID` from `app.seed_probast_ai`), commit, call `get_template` (page until the section holding the "Study type" question is returned), and assert that question's `options` contains `{"value": "development_only", "label": "Development only"}`. Add `test_legacy_options_read_canonical`: `fresh_charms(db_session)` (helpers in `tests/integration/helpers/template_fixtures.py`), plant `UPDATE public.extraction_fields SET allowed_values = '["Yes","No"]'::jsonb WHERE id = :id` on one select field, and assert its `options == [{"value":"Yes","label":"Yes"},{"value":"No","label":"No"}]`; a text field's `options` is `None`.
  - `tests/unit/test_extraction_run_schemas.py` (~L475): `RunViewField.model_validate({... "allowed_values": ["Yes","No"] ...}).allowed_values == [OptionItem(value="Yes", label="Yes"), OptionItem(value="No", label="No")]`; `{"options": [{"value":"NI","label":"No information"}]}` → `[OptionItem(value="NI", label="No information")]`; `None` → `None`; `[]` → `None`.
  - `tests/integration/mcp/test_mcp_result_shape.py`: no new test; it must stay green with the new `untrusted_fields` (it fails red if the paths are not updated, since `McpOption.value`/`.label` are new string leaves).

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/integration/mcp/test_mcp_get_template.py tests/unit/test_extraction_run_schemas.py tests/integration/mcp/test_mcp_result_shape.py -q` → FAIL (options are labels; `allowed_values` raw).

- [ ] **Step 3: Implement** per Interfaces. Run `cd "$WT" && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/check_layered_arch.py` after adding the schema import.

- [ ] **Step 4: Regenerate API types.** `cd "$WT" && npm run generate:api-types` (`RunViewField.allowed_values` becomes `OptionItem[] | null`). Frontend callers are adapted by Tasks 2.2a-1…2.2b-2 in this PR.

- [ ] **Step 5: Run green + gates.**
  ```bash
  cd "$WT/backend" && uv run pytest tests/unit tests/integration/mcp tests/integration/test_run_view_endpoint.py -q
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh
  cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  ```
  Also run `tests/integration/test_build_run_view.py tests/integration/test_run_view_entity_types.py tests/integration/test_run_view_current_values.py`. Expected: PASS; result-size cap tests green.

- [ ] **Step 6: Commit.** `git -C "$WT" add backend frontend/types/api && git -C "$WT" commit -m "feat(mcp): get_template and the run view return {value, label} options"`

- [ ] **Step 7: Sibling refactor — delete the unserved schemas.** Confirm nothing outside the listed files uses them: `grep -rn "ExtractionFieldSchema\|ExtractionEntityTypeSchema\|ExtractionTemplateSchema" "$WT/backend"` → only `schemas/extraction.py`, `schemas/__init__.py`, `tests/unit/test_extraction_schemas.py`. Delete the three classes, their `__init__` imports and `__all__` entries, and their test helpers/classes; keep `Framework`. Then `cd "$WT/backend" && uv run pytest tests/unit -q && cd "$WT" && make lint-backend && npm run generate:api-types && git -C "$WT" status --short frontend/types/api` (expect no diff: the classes were never served). Commit: `git -C "$WT" add backend && git -C "$WT" commit -m "refactor(schemas): delete unserved extraction field, entity type and template schemas"`

**Done when:** `get_template` and the run view serve canonical options for legacy and canonical rows, untrusted paths are exact, the unserved schemas are gone, gates green.

---

### Task 2.1a-2b: Option rename is a cosmetic diff; legacy baselines compare canonical

**Layer:** backend · **Migration:** no · **Commit:** `feat(templates): an option label change is a cosmetic rename in the draft diff`

**Goal:** (1) changing only an option's label (same code) shows in the draft diff as one cosmetic `FIELD_OPTION_RENAMED` change whose row id keeps the option code, with `before`/`after` = old/new label; removing a code stays destructive. (2) A live tree whose options are canonical compares equal to a published baseline that still stores legacy options: Discard writes canonical options back to the live rows, and republish with no edit mints no version.

**Context:** options are `{value, label}`; the value is the stored code and a rename changes only the label, so recorded answers are never orphaned. `app/llm/claim_value.normalize_options(raw) -> list[dict[str, str]]` (Task 2.1a-1) canonicalizes any stored shape. Frozen snapshots are never rewritten by code. Current code: `TemplateChange` (`backend/app/services/template_versioning/_diff.py:185-212`, frozen slots dataclass; docstring L188-190 says `before`/`after` carry the option code), `_normalize_field` (:341-344), `_option_codes` (:581-589), `_diff_options` (:592-639, comment "Renames are undetectable on bare strings" at :627; module docstring :19-22 says no rename detection), `_variant_of` (`_diff_read.py:203-213`), `_row_id` (:221-243), `_option_code` (:246-255, returns `change.before` when set), `ChangeVariant` (`backend/app/domain/template_change.py:64-85`), `TemplateVersionService.republish` (`_publish.py:159`, structural compare `current.schema_ == snapshot` at :255), `_restore._baseline_field_columns` (`_restore.py:128-132`, uses `_normalize_field`). The MCP `draft_diff` (`app/api/mcp/draft_diff.py`) already emits `variant=str(row.variant)`, so it carries the new variant with no code change.

**Files:**
- Modify: `backend/app/domain/template_change.py` (add `FIELD_OPTION_RENAMED = "field_option_renamed"` after `FIELD_OPTION_REMOVED`)
- Modify: `backend/app/services/template_versioning/_diff.py` (`TemplateChange.option_code`, docstring; `_normalize_field`; `_diff_options`; module docstring L19-22)
- Modify: `backend/app/services/template_versioning/_diff_read.py` (`_variant_of`, `_option_code`)
- Modify: `backend/app/services/extraction_snapshot.py` (new `canonical_snapshot`)
- Modify: `backend/app/services/template_versioning/_publish.py` (:255 compare)
- Test: `backend/tests/unit/test_template_diff.py`, `backend/tests/integration/test_template_discard_draft.py`, `backend/tests/integration/test_template_version_republish.py`
- Regenerate: `frontend/types/api/schema.d.ts`, `frontend/types/api/openapi.json` (`ChangeVariant` gains a member; the frontend `VARIANT_COPY` map is completed by Task 2.2b-1 in this PR)

**Interfaces:**
- Produces: `ChangeVariant.FIELD_OPTION_RENAMED`.
- Produces: `TemplateChange.option_code: str | None = None` (declared after `after`); set by `_diff_options` on every option `MODIFIED` change (added, removed, renamed). Docstring: "`option_code` is the option's stored code for an `allowed_values` MODIFIED change; `before`/`after` carry the removed/added code, or the old/new label for a rename."
- Produces: `_option_code(change) -> str | None` returns `change.option_code` for option `MODIFIED` changes (still `None` for every other change, including the options `REORDERED` row).
- Produces: `_variant_of`: an option `MODIFIED` change with both `before` and `after` set → `FIELD_OPTION_RENAMED`; only `after` → `FIELD_OPTION_ADDED`; only `before` → `FIELD_OPTION_REMOVED`.
- Produces: `extraction_snapshot.canonical_snapshot(schema_: dict[str, Any] | None) -> dict[str, Any]` — a deep copy in which every `entity_types[].fields[].allowed_values` that is not `None` is replaced by `normalize_options(...)`; nothing else changes.
- `_normalize_field(raw)`: `data[OPTION_KEY] = None if raw.get(OPTION_KEY) is None else normalize_options(raw.get(OPTION_KEY))`.

- [ ] **Step 1: Write the failing tests.**
  - `tests/unit/test_template_diff.py` (pure; builders `field_node`/`entity_node`/`snapshot` from `tests.unit.helpers.snapshot_builders`, local `_select(field_id, allowed)` ~L388, `_only(diff)` ~L48, `diff_snapshots(base, curr, fields_with_values=NO_VALUES)`):
    ```python
    def test_label_only_change_is_one_cosmetic_rename():
        base = _select(FID, [{"value": "dev", "label": "Development"}, {"value": "val", "label": "Validation"}])
        curr = _select(FID, [{"value": "dev", "label": "Development only"}, {"value": "val", "label": "Validation"}])
        change = _only(diff_snapshots(base, curr, fields_with_values=NO_VALUES))
        assert change.kind is ChangeKind.MODIFIED and change.tier is ChangeTier.COSMETIC
        assert (change.attribute, change.before, change.after, change.option_code) == (
            "allowed_values", "Development", "Development only", "dev")
        assert _variant_of(change) is ChangeVariant.FIELD_OPTION_RENAMED
        assert _row_id(change).endswith(":allowed_values:dev")

    def test_legacy_and_canonical_same_codes_is_no_change():
        assert diff_snapshots(_select(FID, ["Yes", "No"]),
                              _select(FID, [{"value": "Yes", "label": "Yes"}, {"value": "No", "label": "No"}]),
                              fields_with_values=NO_VALUES).changes == ()   # adapt to the result type's empty form
    ```
    Keep `test_removed_option_is_destructive` (~L410) and extend it: `change.option_code == "unclear"` and `_variant_of(change) is ChangeVariant.FIELD_OPTION_REMOVED`; an added option has `option_code` set and variant `FIELD_OPTION_ADDED`. Import `_variant_of`/`_row_id` from `app.services.template_versioning._diff_read`.
  - Shared setup for the two integration tests (plants a legacy baseline directly, so it does not depend on the data migration): `project_id, template_id, _ = await fresh_charms(db_session)` (`tests/integration/helpers/template_fixtures.py`); pick one CHARMS select field (`field_id(db_session, template_id, "<entity type name>", "<field name>")`, any field whose options are `Yes`/`No`); with `ALTER TABLE public.extraction_fields DISABLE TRIGGER trg_extraction_fields_mark_draft` set its live `allowed_values` to `'["Yes","No"]'::jsonb`, then `ENABLE TRIGGER`; `await TemplateVersionService(db_session).republish(project_id=project_id, project_template_id=template_id, user_id=SEED.primary_profile)` so the active snapshot stores the legacy list.
  - `tests/integration/test_template_discard_draft.py`, `test_discard_restores_canonical_options_over_a_legacy_baseline`: after the shared setup, set the live row to `[{"value":"Yes","label":"Yes"},{"value":"No","label":"No"}]` and change that field's label with `set_label(...)` (both with the trigger enabled, so a draft exists); call `discard_draft(...)` exactly as that file does (~L213); assert the live `allowed_values` reads back as the canonical list (today it is written back as `["Yes","No"]`).
  - `tests/integration/test_template_version_republish.py`, `test_republish_ignores_option_shape_only_difference`: after the shared setup, count versions (`SELECT count(*) FROM public.extraction_template_versions WHERE project_template_id = :tid`); with the trigger disabled set the live row to the canonical form of the same options; republish again; the version count is unchanged.

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/unit/test_template_diff.py tests/integration/test_template_discard_draft.py tests/integration/test_template_version_republish.py -q` → FAIL.

- [ ] **Step 3: Implement.**
  - `_diff_options(before, after)`: read `old = normalize_options(before.data[OPTION_KEY])`, `new = normalize_options(after.data[OPTION_KEY])`; codes by order (`[o["value"] for o in ...]`), labels by code. If codes and labels are both equal → `[]`. Removed codes → `MODIFIED`/`DESTRUCTIVE`, `before=code`, `option_code=code`. Added codes → `MODIFIED`/`ADDITIVE`, `after=code`, `option_code=code`. Codes in both whose label differs → `MODIFIED`/`COSMETIC`, `before=old_label`, `after=new_label`, `option_code=code`. The relative-order `REORDERED` check over shared codes is unchanged. Replace the comment at ~:627 with "A rename keeps its code, so the relative order of the shared codes is the reorder signal." `_option_codes` stays only if another caller remains (`grep -n "_option_codes" -r "$WT/backend/app"`); otherwise delete it.
  - Update the `_diff` module docstring (L19-22): options are compared by code; a label change on a kept code is a cosmetic rename.
  - `_variant_of` and `_option_code` per Interfaces.
  - `_publish.py` :255: `if current is not None and canonical_snapshot(current.schema_) == canonical_snapshot(snapshot):`. The new version (when one is minted) still stores `snapshot` as built.

- [ ] **Step 4: Regenerate API types.** `cd "$WT" && npm run generate:api-types` (adds `"field_option_renamed"` to `ChangeVariant`).

- [ ] **Step 5: Run green + gates.**
  ```bash
  cd "$WT/backend" && uv run pytest tests/unit tests/integration/test_template_discard_draft.py \
    tests/integration/test_template_version_republish.py tests/integration/mcp/test_mcp_get_template.py \
    tests/integration/mcp/test_mcp_edit_template_draft.py -q
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh
  cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  ```
  Expected: PASS. `check_file_size.py` stays green (`_diff.py` is ~693 lines against the 800 default).

- [ ] **Step 6: Commit.** `git -C "$WT" add backend frontend/types/api && git -C "$WT" commit -m "feat(templates): an option label change is a cosmetic rename in the draft diff"`

**Done when:** a label-only change is one cosmetic rename row keyed by its code, code removal stays destructive, Discard writes canonical options, an option-shape-only difference mints no version, gates green.

---

### Task 2.1a-2c: Export descriptors carry option value and label pairs

**Layer:** backend · **Migration:** no · **Commit:** `feat(exports): data dictionary lists each option's code and label`

**Goal:** the export pipeline stops flattening options to labels: `FieldDescriptor.allowed_values` holds `(value, label)` pairs from the snapshot reader, the data dictionary passes them through (so a coded option shows its code and its label), and the appraisal verdict-field check reads the labels.

**Context:** options are `{value, label}`; the value is the stored code. `backend/app/services/exports/extraction_snapshot_reader.py` already produces `AllowedValue(value, label)` pairs (`@dataclass AllowedValue` ~L37, `_normalize_allowed_values` delegating to `normalize_options` since Task 2.1a-1). In `backend/app/services/extraction_export_service.py` (2144 lines; file-size baseline cap 2194): `FieldDescriptor` (`@dataclass(frozen=True)` :100-118) has `allowed_values: tuple[str, ...]` (:113); the descriptor build (:850-866) flattens with `tuple(av.label for av in f.allowed_values)` (:860); `_build_appraisal_model._is_verdict` (:647-651) does `labels = [v.strip().lower() for v in field.allowed_values if v.strip()]`; `_build_data_dictionary` (:1842-1872) rebuilds `AllowedValue(value=v, label=v)` (:1864-1866) and its docstring (:1848-1849) says "value == label in prumo". Downstream `exports/extraction/data_dictionary.py` and `dropdown_lists.py` already read `.label` from `FieldDictEntry.allowed_values`.

**Files:**
- Modify: `backend/app/services/extraction_export_service.py` (`FieldDescriptor.allowed_values`, the build at ~:860, `_is_verdict` ~:650, `_build_data_dictionary` ~:1864 and its docstring)
- Modify: any other `backend/app` reader of `FieldDescriptor.allowed_values` — find them with `grep -rn "\.allowed_values" "$WT/backend/app/services/exports" "$WT/backend/app/services/extraction_export_service.py"` and adapt each to `.label` (display) or `.value` (code) by its meaning
- Test: `backend/tests/unit/test_extraction_export_data_dictionary_projection.py` and every test that builds `FieldDescriptor(allowed_values=(...strings...))`: `test_extraction_export_determinism.py`, `test_extraction_xlsx_builder.py`, `test_extraction_export_shape_filter.py`, `test_extraction_appraisal_model_resolution.py`, `test_appraisal_derived_overalls.py`, `test_derived_overall_screen_workbook_parity.py`, and any other hit of `grep -rln "FieldDescriptor(" "$WT/backend/tests"` with a non-empty string tuple

**Interfaces:**
- Consumes: `AllowedValue(value: str, label: str)` from `app.services.exports.extraction_snapshot_reader`.
- Produces: `FieldDescriptor.allowed_values: tuple[AllowedValue, ...]` (ordered value+label pairs). Build site: `allowed_values=tuple(f.allowed_values)`. `_build_data_dictionary`: `allowed_values=field_.allowed_values` (pass-through). `_is_verdict`: `labels = [av.label.strip().lower() for av in field.allowed_values if av.label.strip()]`.

- [ ] **Step 1: Write the failing test.** In `tests/unit/test_extraction_export_data_dictionary_projection.py` (pure; local `_section(label, *fields)` / `_field(label, ...)` ~L30-40, then `_build_data_dictionary((s,))`), add `test_coded_options_keep_value_and_label`: a hand-built PROBAST+AI "Study type" descriptor with `allowed_values=(AllowedValue("development_only", "Development only"), AllowedValue("validation_only", "Validation only"))`; the resulting `FieldDictEntry.allowed_values[0] == AllowedValue(value="development_only", label="Development only")`. Change the file's existing `_field` default to pairs (`(AllowedValue("Cohort","Cohort"), AllowedValue("RCT","RCT"))`). In `tests/unit/test_extraction_appraisal_model_resolution.py`, add: a verdict field with coded options `(AllowedValue("L","Low"), AllowedValue("H","High"), AllowedValue("U","Unclear"))` is still selected as the domain verdict (labels are the risk vocabulary even when codes are not).

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/unit/test_extraction_export_data_dictionary_projection.py tests/unit/test_extraction_appraisal_model_resolution.py -q` → FAIL (pairs rebuilt as value == label; `_is_verdict` calls `.strip()` on a pair).

- [ ] **Step 3: Implement** per Interfaces; delete the "value == label in prumo" sentence from the `_build_data_dictionary` docstring (replace with "`allowed_values` are the snapshot's (value, label) pairs, in option order").

- [ ] **Step 4: Update the other descriptor fixtures** to pairs (`AllowedValue(x, x)` for each former string); no assertion changes beyond the shape.

- [ ] **Step 5: Run green + gates.**
  ```bash
  cd "$WT/backend" && uv run pytest tests/unit tests/integration -q -k "export or appraisal or workbook or xlsx or derived"
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh
  cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  ```
  Expected: PASS; `check_file_size.py` green (the change is line-neutral). No REST schema changed, so no type regeneration.

- [ ] **Step 6: Commit.** `git -C "$WT" add backend && git -C "$WT" commit -m "feat(exports): data dictionary lists each option's code and label"`

**Done when:** descriptors carry pairs end to end, the data dictionary shows code and label, the verdict check reads labels, every export test green.

---

### Task 2.1b: Canonical options in data — portable import, seeds, migration 0084

**Layer:** backend · **Migration:** yes (`0084_canonical_field_options`) · **Commit:** `feat(db): store every live field's options as {value, label}`

**Goal:** every live `extraction_fields.allowed_values` row (global catalogue and project clones) is stored canonical `[{value, label}]`; the seeds write the canonical shape; a portable template file with legacy options (`["a","b"]`, `{"options": [...]}`, mixed lists) still imports and is stored canonical. Frozen version snapshots are not touched, and no template is stamped as having a draft.

**Context:** `app/llm/claim_value.normalize_options(raw) -> list[dict[str, str]]` canonicalizes any stored shape (Task 2.1a-1). `AllowedValues` (`backend/app/schemas/template_structure.py`) is `list[OptionItem]`, 1..100, unique by value. `PortableField` (`backend/app/schemas/template_portable.py:52-75`, `extra="forbid"`, `allowed_values: AllowedValues | None` at :64) is validated on import and also on export (`template_portable_service.py:172`, `PortableField.model_validate(f, from_attributes=True, by_name=True)` over live rows; a `ValidationError` there becomes `TemplateExportInvalidError` at :214-217); import stores `**f.model_dump()` (`_field_row` :252-256). Every DML on `extraction_fields` fires `trg_extraction_fields_mark_draft` (created by `0048_config_draft_marker.py:114-122` as `trg_{table}_mark_draft`), which stamps `config_draft_since`; a backfill must wrap its UPDATE in `DISABLE`/`ENABLE TRIGGER` (precedent: `0051_entity_entry_label.py`, `_TRIGGER` constant). Seeds: `backend/app/seed.py` nested `_f` (:443-470, `allowed: list[str] | None`, `allowed_values=allowed` :466) and module-level `_field` (:1361-1405, `allowed_values=allowed` :1400) build every seeded field; `seed_probast_ai.py` builds through `_field`; `seed.py:1442` compares `allowed is _PROBAST_SIGNALING` by identity, so the constants must stay the same objects (convert inside `_f`/`_field`, never rewrite the constants). `seed.py` is 3243 lines against a file-size baseline cap of 3292 (`scripts/fitness/check_file_size.baseline`): keep the change to a few lines. Seeds run via `cd backend && uv run python -m app.seed`, never in migrations.

**Migration rules (apply exactly):** confirm the number first: `ls "$WT/backend/alembic/versions" | grep '^0' | sort | tail -1` must print `0083_mcp_oauth.py`. File `backend/alembic/versions/0084_canonical_field_options.py`, `revision = "0084_canonical_field_options"` (28 chars ≤ 32), `down_revision = "0083_mcp_oauth"`. Move `expected_head` in `backend/tests/integration/test_migration_roundtrip.py::test_alembic_head_is_expected_revision` (~L1334) to `"0084_canonical_field_options"` and add a roundtrip test there. No seed data and no app imports in the migration (self-contained SQL). After the task: `cd "$WT/backend" && uv run alembic upgrade head` once on the test database.

**Files:**
- Modify: `docs/reference/extraction-hitl-architecture.md` (section 3, the "Migration head:" line ~L138 → `0084_canonical_field_options`; frontmatter `last_reviewed:` → the commit date) — required for every migration touching `extraction_*`
- Create: `backend/alembic/versions/0084_canonical_field_options.py`
- Create: `backend/tests/integration/test_migration_0084_canonical_options.py`
- Modify: `backend/tests/integration/test_migration_roundtrip.py`
- Modify: `backend/app/schemas/template_portable.py` (`PortableField` before-validator on `allowed_values`)
- Modify: `backend/app/seed.py` (`_f`, `_field`: `allowed_values=normalize_options(allowed) or None`)
- Test: `backend/tests/integration/test_template_portable_service.py`, `backend/tests/unit/test_template_portable_schema.py`, `backend/tests/integration/test_seed_convergence.py` (assertions that read seeded option shapes, if any)

**Interfaces:**
- Consumes: `normalize_options`, `OptionItem`, `AllowedValues`.
- Produces: `PortableField` `field_validator("allowed_values", mode="before")` → `None` stays `None`; anything else → `normalize_options(raw)` (then the `AllowedValues` rules apply: 1..100, unique by value).
- Produces (migration module constants, imported by the test): `UPGRADE_SQL: str` (the canonicalizing UPDATE, without the trigger toggles) and `_TRIGGER = "trg_extraction_fields_mark_draft"`. `upgrade()` = `op.execute(f"ALTER TABLE public.extraction_fields DISABLE TRIGGER {_TRIGGER}")`, `op.execute(UPGRADE_SQL)`, `op.execute(f"... ENABLE TRIGGER {_TRIGGER}")`. `downgrade()` = `pass` with a comment: data-only and forward-only; the legacy shapes are still readable, so nothing to undo.
- `UPGRADE_SQL` semantics (one UPDATE, idempotent): for each row whose `allowed_values` is a JSON array, or an object with an array `options`, and that holds any element that is not an object with both a non-empty `value` and a non-empty `label` string: rebuild the array in element order — a non-empty string `s` → `{"value": s, "label": s}`; an object with a non-empty `value` → `{"value": value, "label": coalesce(nullif(label, ''), value)}`; an object with only a non-empty `label` → `{"value": label, "label": label}`; anything else dropped; an empty result → SQL `NULL`. Rows already canonical are not touched (`rowcount` 0 on a second run). Use `jsonb_array_elements(...) WITH ORDINALITY` and `jsonb_agg(... ORDER BY ord)`.

- [ ] **Step 1: Write the failing tests.**
  - New `tests/integration/test_migration_0084_canonical_options.py` (pattern: `test_migration_0068_seeded_entry_nouns.py` — `_mig = load_migration("0084_canonical_field_options.py")` from `tests.integration.helpers.migrations`, statements run inside the savepoint-isolated `db_session`; the UPDATE is table-wide, so assert per row on rows this test creates; wrap it like the migration: `ALTER TABLE public.extraction_fields DISABLE TRIGGER trg_extraction_fields_mark_draft` / `ENABLE`):
    - `test_legacy_rows_become_canonical`: `project_id, template_id, _ = await fresh_charms(db_session)` (`tests/integration/helpers/template_fixtures.py`); plant four fields' `allowed_values` (trigger disabled) as `["Yes","No"]`, `{"options": ["A","B"]}`, `["Y", {"value":"NI","label":"No information"}, {"label":"Z"}]`, and `[{"value":"dev","label":"Development only"}]`; run `_mig.UPGRADE_SQL` (trigger disabled); they read `[{"value":"Yes","label":"Yes"},{"value":"No","label":"No"}]`, `[{"value":"A","label":"A"},{"value":"B","label":"B"}]`, `[{"value":"Y","label":"Y"},{"value":"NI","label":"No information"},{"value":"Z","label":"Z"}]`, and the canonical one unchanged.
    - `test_draft_marker_and_snapshots_untouched`: record `config_draft_since` of every `project_extraction_templates` row and `md5(schema::text)` of every `extraction_template_versions` row before; run the migration's three statements in order; both maps are identical after.
    - `test_is_idempotent`: a second `UPGRADE_SQL` run has `rowcount == 0`.
  - `tests/integration/test_migration_roundtrip.py`: set `expected_head = "0084_canonical_field_options"`; add `test_migration_0084_canonical_options_roundtrip(migration_db_url)`: `_run_alembic("downgrade", "0083_mcp_oauth", database_url=migration_db_url)` succeeds, then `_run_alembic("upgrade", "head", ...)` succeeds and `_run_alembic("current", ...)` contains `0084_canonical_field_options`.
  - `tests/integration/test_template_portable_service.py`, `test_legacy_option_file_is_stored_canonical`: build a portable document whose one select field has `"allowed_values": ["Cohort", "RCT"]` (and one with `{"options": ["X"]}`), import it with the service's import entry point as the existing pure-parse tests (~L260-300) and round-trip tests (~L59) do; the stored rows read `[{"value":"Cohort","label":"Cohort"},{"value":"RCT","label":"RCT"}]` and `[{"value":"X","label":"X"}]`. `tests/unit/test_template_portable_schema.py`: `PortableField(... allowed_values=["a","a"])` → `ValidationError` (duplicate value after canonicalization).
  - Seeds: in `tests/integration/test_seed_convergence.py` add `test_seeded_options_are_canonical`: after `await seed_probast_ai(db_session)` every `extraction_fields.allowed_values` of the PROBAST+AI global template is a list of objects with `value` and `label` (a `jsonb_path_exists` or a Python loop over the rows).

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/integration/test_migration_0084_canonical_options.py tests/integration/test_migration_roundtrip.py tests/integration/test_template_portable_service.py tests/unit/test_template_portable_schema.py tests/integration/test_seed_convergence.py -q` → FAIL.

- [ ] **Step 3: Write the migration** per Interfaces (module docstring: what it converts, that snapshots are untouched, that the draft trigger is disabled so no template is stamped as a draft, that codes are unchanged so the code-based diff stays empty, and that the downgrade is a no-op). Render it offline to check the SQL: `cd "$WT/backend" && uv run alembic upgrade 0083_mcp_oauth:0084_canonical_field_options --sql | head -60`.

- [ ] **Step 4: Portable and seeds.** Add the `PortableField` before-validator. In `seed.py` `_f` and `_field`, `allowed_values=normalize_options(allowed) or None` (import `normalize_options` from `app.llm.claim_value`; leave `_YES_NO*`, `_PROBAST_SIGNALING` and every literal untouched so the `is _PROBAST_SIGNALING` check keeps working). Re-seed the test DB: `cd "$WT/backend" && uv run alembic upgrade head && uv run python -m app.seed`.

- [ ] **Step 5: Run green + gates.**
  ```bash
  cd "$WT/backend" && uv run pytest tests/unit tests/integration/test_migration_0084_canonical_options.py \
    tests/integration/test_migration_roundtrip.py tests/integration/test_template_portable_service.py \
    tests/integration/test_seed_convergence.py tests/integration/mcp -q
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh \
    && bash scripts/fitness/check_migration_split.sh
  cd "$WT/backend" && uv run alembic check && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  ```
  Expected: PASS; `alembic check` no diff; `check_file_size.py` green for `seed.py`. If `test_template_portable_service.py::test_round_trip_is_lossless` compared legacy option shapes, it now reads canonical on both sides.

- [ ] **Step 6: Commit.** `git -C "$WT" add backend docs && (cd "$WT" && bash scripts/docs/check-frontmatter.sh) && git -C "$WT" commit -m "feat(db): store every live field's options as {value, label}"`

**Done when:** live rows are canonical after 0084 with no draft stamped and snapshots byte-identical, seeds and legacy imports store canonical options, head pin + roundtrip pass, gates green.

---

### Task 2.2a-1: One client-side option reader (`normalizeOptions`)

**Layer:** frontend · **Migration:** no · **Commit:** `refactor(extraction): one client-side reader for field options`

**Goal:** one module, `frontend/lib/extraction/options.ts`, turns any stored `allowed_values` shape into `{value, label}[]`, mirroring backend `app/llm/claim_value.normalize_options`. Every private normalizer listed below is deleted and its callers use the shared one. Behavior on screen does not change: a code still renders as its label, a plain string as itself.

**Context:** the backend (earlier tasks in this PR) now serves `allowed_values` as `[{value, label}]` on `TemplateFieldRead`, `RunViewField` and the MCP template; frozen snapshots and the two PostgREST reads (`useTemplateEntityTypes.ts`, `qaTemplateService.ts`) can still carry legacy shapes (`string[]`, `{options: [...]}`). `frontend/types/api/schema.d.ts` already exposes `components['schemas']['OptionItem']` (regenerated by the backend tasks). Frontend tooling runs from the repo root `$WT`; never `cd frontend`.

**Files:**
- Create: `frontend/lib/extraction/options.ts`
- Create: `frontend/lib/extraction/options.test.ts`
- Create: `frontend/test/components/SelectWithOther.test.tsx`
- Modify: `frontend/lib/ai-extraction/suggestionUtils.ts` (delete private `normalizeOptions` L26-37 and `optionLabelMap` L44-56; `resolveOptionLabels` L64-74 builds its map from the shared reader)
- Modify: `frontend/lib/extraction/judgmentFields.ts` (delete private `optionLabels` L32-48)
- Modify: `frontend/components/ui/SelectWithOther.tsx` (delete `SelectOption` L12 and `normalizeOption` L27-34)
- Modify: `frontend/components/ui/MultiSelectWithOther.tsx` (delete `MultiSelectOption` L16 and `normalizeMultiOption` L34-41)
- Modify: `frontend/components/extraction/FieldValueEditor.tsx` (the `as any[]` casts at ~L261 and ~L316, and the inline `option: any` mapping in the plain `<Select>` branch ~L300-303)
- Modify: `frontend/test/lib/judgmentFields.test.ts`
- Modify: `frontend/components/extraction/FieldInput.test.tsx`

**Interfaces:**
- Consumes: `components['schemas']['OptionItem']` from `@/types/api/schema` (`{value: string; label: string}`).
- Produces:
  - `export type OptionItem = components['schemas']['OptionItem'];`
  - `export function normalizeOptions(allowedValues: unknown): OptionItem[]` — accepts `null`/`undefined` (→ `[]`), a bare array, or `{options: [...]}`; each item: a non-empty string `s` → `{value: s, label: s}`; an object with a string/number `value` → `{value: String(value), label: label ? String(label) : String(value)}`; an object with only a `label` → `{value: label, label}`; anything else is skipped. Order is preserved.
  - `export function optionLabelMap(allowedValues: unknown): Map<string, string>` — code → label, built from `normalizeOptions`.
  - `SelectWithOther` and `MultiSelectWithOther` prop `options: OptionItem[]` (callers pass `normalizeOptions(field.allowed_values)`).

- [ ] **Step 1: Write the failing tests.**
  - `frontend/lib/extraction/options.test.ts`:
    ```ts
    import {describe, expect, it} from 'vitest';
    import {normalizeOptions, optionLabelMap} from './options';

    describe('normalizeOptions', () => {
      it('reads every stored shape as {value,label}', () => {
        const canonical = [{value: 'Y', label: 'Yes'}, {value: 'N', label: 'No'}];
        expect(normalizeOptions(canonical)).toEqual(canonical);
        expect(normalizeOptions(['Yes', 'No'])).toEqual([
          {value: 'Yes', label: 'Yes'}, {value: 'No', label: 'No'}]);
        expect(normalizeOptions({options: ['Yes']})).toEqual([{value: 'Yes', label: 'Yes'}]);
        expect(normalizeOptions({options: [{value: 'NI', label: 'No information'}]}))
          .toEqual([{value: 'NI', label: 'No information'}]);
        expect(normalizeOptions([{value: 'Y'}])).toEqual([{value: 'Y', label: 'Y'}]);
        expect(normalizeOptions([{label: 'Only label'}])).toEqual([{value: 'Only label', label: 'Only label'}]);
      });
      it('yields [] for null, junk and empty items', () => {
        expect(normalizeOptions(null)).toEqual([]);
        expect(normalizeOptions('nonsense')).toEqual([]);
        expect(normalizeOptions([null, 3, '', {}])).toEqual([]);
      });
      it('maps codes to labels', () => {
        expect(optionLabelMap([{value: 'NI', label: 'No information'}, 'Y']))
          .toEqual(new Map([['NI', 'No information'], ['Y', 'Y']]));
      });
    });
    ```
  - `frontend/test/components/SelectWithOther.test.tsx` (new; render pattern: `render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>)` as in `FieldInput.test.tsx`): `SelectWithOther` with `options={[{value:'dev', label:'Development only'}]}` and `value="dev"` shows "Development only", not "dev"; `MultiSelectWithOther` with the same options, `value={['dev']}` and `showSelectedLabels` shows "Development only"; choosing the option calls `onChange` with the code `'dev'` (the stored value), not the label.
  - `frontend/test/lib/judgmentFields.test.ts`: add canonical-shape cases next to the bare-string ones: `isJudgmentField({field_type: 'select', allowed_values: [{value:'Low',label:'Low'},{value:'High',label:'High'},{value:'Unclear',label:'Unclear'}]})` → true; `isSignalingSelect({field_type: 'select', allowed_values: ['Y','PY','PN','N',{value:'NI',label:'No information'}]})` → true (classification reads the option **value**, so the `NI` code with a spelled-out label still counts as signaling).
  - `frontend/components/extraction/FieldInput.test.tsx`: a select field with `allowed_values: [{value: 'Y', label: 'Yes'}, {value: 'N', label: 'No'}]` and value `{value: 'Y'}` renders "Yes"; keep the existing `['Yes','No']` case (legacy shape still renders).

- [ ] **Step 2: Run red.** `cd "$WT" && npx vitest run frontend/lib/extraction/options.test.ts frontend/test/components/SelectWithOther.test.tsx frontend/test/lib/judgmentFields.test.ts frontend/components/extraction/FieldInput.test.tsx` → FAIL (`./options` missing; label not resolved for canonical options).

- [ ] **Step 3: Implement `options.ts`** per Interfaces (doc comment: "Mirrors backend `normalize_options` (`backend/app/llm/claim_value.py`): the one client-side reader of option shapes. Frozen snapshots and PostgREST reads may still carry `string[]` or `{options: [...]}`.").

- [ ] **Step 4: Replace the private normalizers.**
  - `suggestionUtils.ts`: delete `normalizeOptions` and `optionLabelMap`; `resolveOptionLabels` calls `optionLabelMap(field.allowedValues)` imported from `@/lib/extraction/options`. `SuggestionFieldContext.allowedValues` stays `unknown`.
  - `judgmentFields.ts`: delete `optionLabels`; `isJudgmentField` and `isSignalingSelect` use `normalizeOptions(field.allowed_values).map((o) => o.value.trim().toLowerCase()).filter(Boolean)`. Keep reading the **value** (the signaling vocabulary keys on codes such as `NI`).
  - `SelectWithOther.tsx` / `MultiSelectWithOther.tsx`: props become `options: OptionItem[]`; delete the local option types and `normalizeOption`/`normalizeMultiOption`; render `option.label`, store `option.value`.
  - `FieldValueEditor.tsx`: `const options = normalizeOptions(field.allowed_values);` for the select branches (both `SelectWithOther` and the plain `<Select>` mapping, which now reads `option.value`/`option.label` with no `any`) and `const mOptions = normalizeOptions(field.allowed_values);` for multiselect. `FieldValueEditorField.allowed_values` stays `unknown`.

- [ ] **Step 5: Run green + gates.** `cd "$WT" && npx vitest run frontend/lib/extraction/options.test.ts frontend/test/components/SelectWithOther.test.tsx frontend/test/lib/judgmentFields.test.ts frontend/components/extraction && npm run test:run && npm run typecheck && npm run lint && npx knip && npx knip --production && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/check_copy_keys.py` → all PASS, knip 0 findings (no orphaned helper or type), `grep -rn "normalizeMultiOption\|function normalizeOption\|function optionLabels" "$WT/frontend"` → no output. If `npm run typecheck` reports errors only in files owned by Tasks 2.2a-2/2.2b-1/2.2b-2 (`types/extraction.ts` users, `templateTree.ts`, `TemplateInspector.tsx`, `sectionRestore.ts`, `runViewAdapters.ts`), note them in the commit body; they are fixed by those tasks. Any other typecheck error is fixed here.

- [ ] **Step 6: Commit.** `git -C "$WT" add frontend && git -C "$WT" commit -m "refactor(extraction): one client-side reader for field options"`

**Done when:** one exported reader exists, every listed private normalizer is gone, labels render from canonical and legacy options, judgment and signaling classification are unchanged, knip is 0.

---

### Task 2.2a-2: Field types, Zod rule and readers on `{value, label}`

**Layer:** frontend · **Migration:** no · **Commit:** `feat(extraction): field types and validation use {value, label} options`

**Goal:** the frontend `ExtractionField.allowed_values` type and its Zod rule take `{value, label}[]` (unique by value, 1..100), matching the backend `AllowedValues`; the run-view adapter and the grid row stop assuming `string[]`.

**Context:** backend REST now validates and returns `allowed_values` as `OptionItem[]` (`components['schemas']['OptionItem']` in `frontend/types/api/schema.d.ts`, regenerated by the backend tasks). `frontend/lib/extraction/options.ts` (Task 2.2a-1) exports `type OptionItem` and `normalizeOptions(allowedValues: unknown): OptionItem[]`, the one client-side reader of any stored shape. `backend/app/schemas/template_structure.py` documents that its constraints mirror the Zod `ExtractionFieldSchema`, and `frontend/test/apiSchemaDrift.test.ts` asserts the create-field constraints against the committed `openapi.json`. Frontend tooling runs from the repo root `$WT`.

**Files:**
- Modify: `frontend/types/extraction.ts` (`ExtractionField.allowed_values` L68; `ExtractionFieldSchema.allowed_values` L158-170)
- Modify: `frontend/hooks/extraction/useInsertTemplateField.ts` (type-only; it sends `allowed_values: null`, L252)
- Modify: `frontend/components/extraction/template-config/TemplateConfigGridPanel.tsx` (type-only; `allowed_values: null` in optimistic rows, L246)
- Modify: `frontend/lib/extraction/runViewAdapters.ts` (L40 `allowed_values: f.allowed_values as string[] | null`)
- Modify: `frontend/hooks/runs/types.ts` (hand-written `RunViewFieldResponse.allowed_values: unknown | null` L134 → `OptionItem[] | null`)
- Modify: `frontend/components/extraction/template-config/TemplateGridFieldRow.tsx` (L339 `(field.allowedValues ?? []).join(', ')`)
- Test: `frontend/test/apiSchemaDrift.test.ts`, `frontend/test/extraction-field-other.test.ts`, `frontend/test/lib/runViewAdapters.test.ts`, `frontend/components/extraction/template-config/TemplateGrid.test.tsx`

**Interfaces:**
- Consumes: `OptionItem`, `normalizeOptions` from `@/lib/extraction/options`.
- Produces: `ExtractionField.allowed_values: OptionItem[] | null`. Zod:
  ```ts
  const OptionItemSchema = z.object({
    value: z.string().min(1).max(100),
    label: z.string().min(1).max(100),
  }).strict();
  // in ExtractionFieldSchema:
  allowed_values: z.array(OptionItemSchema)
    .min(1, 'Must have at least one allowed value')
    .max(100, 'Maximum of 100 allowed values')
    .optional().nullable()
    .refine((values) => !values || new Set(values.map((o) => o.value)).size === values.length,
      {message: 'Allowed values cannot have duplicates'}),
  ```
  `ExtractionFieldInsert`/`ExtractionFieldUpdate` follow through `z.infer`.
- `runViewAdapters.ts` L40: `allowed_values: normalizeOptions(f.allowed_values),` with `[]` mapped to `null` (`const options = normalizeOptions(f.allowed_values); allowed_values: options.length > 0 ? options : null`).
- `TemplateGridFieldRow.tsx` L339 renders labels: `normalizeOptions(field.allowedValues).map((o) => o.label).join(', ')` (`GridField.allowedValues` is retyped by Task 2.2b-2; reading through `normalizeOptions` works for both shapes now).

- [ ] **Step 1: Write the failing tests.**
  - `frontend/test/apiSchemaDrift.test.ts`: add `$ref?: string` to `OpenApiProperty`; add a resolver `refOf(prop)` that follows `items.$ref` / `anyOf[].items.$ref` to `openapi.components.schemas[<name>]`. Assert `shapeOf('allowed_values')` still `toMatchObject({minItems: 1, maxItems: 100})` and the resolved item schema is `OptionItem` with `properties.value.maxLength === 100`, `properties.label.maxLength === 100`, `required` containing both, `additionalProperties === false`. Replace the bare-string Zod cases (~L151-159): `{allowed_values: []}` → rejected; 100 × `{value: \`v${i}\`, label: \`V${i}\`}` → accepted; 101 → rejected; two items with the same `value` → rejected; `['Yes']` → rejected; `{value:'y',label:'Yes',extra:1}` → rejected.
  - `frontend/test/extraction-field-other.test.ts` (L29, L44): fixtures become `[{value:'Registro A',label:'Registro A'},{value:'Registro B',label:'Registro B'}]` and still parse.
  - `frontend/test/lib/runViewAdapters.test.ts`: a run-view field with `allowed_values: ['Yes','No']` adapts to `[{value:'Yes',label:'Yes'},{value:'No',label:'No'}]`; `[{value:'dev',label:'Development only'}]` passes through; `null` stays `null`.
  - `frontend/components/extraction/template-config/TemplateGrid.test.tsx` (fixture ~L33 `allowed_values: ['Cohort','RCT']`): add a canonical fixture `[{value:'coh',label:'Cohort'},{value:'rct',label:'RCT'}]` and assert the options cell (matched by `/gridOptionsCellAria/`, as the "deep-links the Options cell" test ~L639 does) reads "Cohort, RCT", not "[object Object]".

- [ ] **Step 2: Run red.** `cd "$WT" && npx vitest run frontend/test/apiSchemaDrift.test.ts frontend/test/extraction-field-other.test.ts frontend/test/lib/runViewAdapters.test.ts frontend/components/extraction/template-config/TemplateGrid.test.tsx` → FAIL.

- [ ] **Step 3: Implement** per Interfaces.

- [ ] **Step 4: Run green + gates.** `cd "$WT" && npx vitest run frontend/test frontend/components/extraction frontend/lib && npm run typecheck && npm run lint && npx knip && npx knip --production` → PASS / 0 findings. Typecheck errors left only in files owned by Tasks 2.2b-1/2.2b-2 (`TemplateInspector.tsx`, `AllowedValuesList.tsx`, `templateTree.ts`, `sectionRestore.ts`, `TemplateConfigEditor.tsx`, `TemplateConfigDiffSheet.tsx`) are expected and named in the commit body; any other error is fixed here.

- [ ] **Step 5: Commit.** `git -C "$WT" add frontend && git -C "$WT" commit -m "feat(extraction): field types and validation use {value, label} options"`

**Done when:** the Zod rule mirrors the backend option contract (pinned by the drift test), the run-view adapter and grid row render labels from either shape, tests green.

---

### Task 2.2b-1: Inspector renames an option's label and keeps its code; diff shows "Option renamed"

**Layer:** frontend · **Migration:** no · **Commit:** `feat(templates): rename an option in the inspector without orphaning answers`

**Goal:** in the template Inspector a manager can edit an option's label inline; the option keeps its stored `value`, so recorded answers stay attached. A new option gets `value` = its trimmed label. The publish diff sheet shows the backend's new `field_option_renamed` variant as "Option renamed".

**Context:** options are `{value, label}`; the value is the stored code and a rename changes only the label. `frontend/lib/extraction/options.ts` exports `type OptionItem` (= `components['schemas']['OptionItem']`) and `normalizeOptions(allowedValues: unknown): OptionItem[]`. The backend diff emits `ChangeVariant` `"field_option_renamed"` (regenerated into `frontend/types/api/schema.d.ts`; `ChangeVariant` is re-exported from `frontend/services/templateService.ts:59`). Today `frontend/components/extraction/dialogs/AllowedValuesList.tsx` (only importer: the Inspector) takes `values: string[]` and supports add/remove/reorder only (props L41-48; `handleAdd` L122-146 uses `t('extraction','enterValue')` for an empty input, `t('extraction','valueAlreadyAdded')` for a duplicate, `t('extraction','max100Values')` at 100; dnd ids `` `value-${value}` `` L166-167, 220-225). `TemplateInspector.tsx` holds `FieldDraft.allowedValues: string[]` (L142), `draftFromField` (L159), `listsEqual(a: string[], b: string[])` (L171-173, shared with `allowedUnits` L187-188), `handleSave` (L265, L279-280) and the `<AllowedValuesList values=... onChange=... showReorder .../>` usage (L413-419). `TemplateConfigDiffSheet.tsx` has `VARIANT_COPY = {...} satisfies Record<ChangeVariant, CopyKey>` (L57-72; `CopyKey = keyof typeof templateConfig`), so typecheck fails until the new variant has a copy key. New template-config strings go in `frontend/lib/copy/templateConfig.ts` (flat, alphabetical; `extraction.ts` is at its size ratchet). Copy goes through `t(namespace, key)`; `check_copy_keys.py` must stay green.

**Files:**
- Modify: `frontend/components/extraction/dialogs/AllowedValuesList.tsx`
- Modify: `frontend/components/extraction/template-config/TemplateInspector.tsx`
- Modify: `frontend/components/extraction/template-config/TemplateConfigDiffSheet.tsx` (`VARIANT_COPY`)
- Modify: `frontend/lib/copy/templateConfig.ts` (add `changeFieldOptionRenamed: 'Option renamed'` after `changeFieldOptionRemoved`; add `optionLabelEdit: 'Edit option label'` in alphabetical position)
- Create: `frontend/components/extraction/dialogs/AllowedValuesList.test.tsx`
- Test: `frontend/components/extraction/template-config/TemplateInspector.test.tsx`, `frontend/test/TemplateConfigDiffSheet.test.tsx`

**Interfaces:**
- Consumes: `OptionItem`, `normalizeOptions`.
- Produces: `AllowedValuesList` props `{options: OptionItem[]; onChange: (options: OptionItem[]) => void; disabled?: boolean; showReorder?: boolean; autoFocusInput?: boolean}`.
  - Add: `label = input.trim()`; empty → `enterValue`; `label` equal to any existing option's `value` or `label` → `valueAlreadyAdded`; ≥100 → `max100Values`; else append `{value: label, label}`.
  - Inline edit: each row's label is a button (aria-label `t('templateConfig','optionLabelEdit')`) that turns into an input; Enter or blur commits, Escape cancels. On commit: trimmed empty → `enterValue` and the edit stays open; equal to another option's `value` or `label` → `valueAlreadyAdded`; otherwise replace that option's `label` and keep its `value`.
  - Remove and reorder as today; dnd ids keyed by `option.value` (stable across renames).
- `TemplateInspector`: `FieldDraft.allowedValues: OptionItem[]`; `draftFromField` uses `normalizeOptions(field.allowedValues)`; options compared with a dedicated `optionsEqual(a: OptionItem[], b: OptionItem[])` (value and label, in order) while `listsEqual` stays for units; `handleSave` sends `allowed_values: options.length > 0 ? options : null`.
- `VARIANT_COPY`: add `field_option_renamed: 'changeFieldOptionRenamed'`.

- [ ] **Step 1: Write the failing tests.**
  - New `AllowedValuesList.test.tsx` (copy mocked as in the sibling tests: `vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}))`; render inside the providers the Inspector test uses):
    - inline label edit keeps the value: options `[{value:'coh',label:'Cohort'}]`; click the label button, clear, type "Cohort study", Enter → `onChange` called with `[{value:'coh',label:'Cohort study'}]`.
    - a new option gets value = trimmed label: type "  RCT  ", Enter in the add input → `[..., {value:'RCT',label:'RCT'}]`.
    - duplicate shows `valueAlreadyAdded`: adding "Cohort" (an existing label) and renaming to "coh" (an existing value of another option) both show the text `valueAlreadyAdded` and do not call `onChange`.
    - empty label shows `enterValue`: committing an empty inline edit shows `enterValue`, no `onChange`.
    - Escape cancels an inline edit without `onChange`.
  - `TemplateInspector.test.tsx` (fixtures ~L65/260 `allowed_values: ['Cohort','RCT']`, `renderInspector(over)` ~L130-151, `lastUpdates(onSaveField)` ~L214): with `allowed_values: [{value:'coh',label:'Cohort'},{value:'rct',label:'RCT'}]`, rename "Cohort" to "Cohort study" and save → `lastUpdates(onSaveField).allowed_values` equals `[{value:'coh',label:'Cohort study'},{value:'rct',label:'RCT'}]`. Keep the legacy fixture case: a `['Cohort','RCT']` field saves `[{value:'Cohort',label:'Cohort'},{value:'RCT',label:'RCT'}]` after an unrelated edit.
  - `frontend/test/TemplateConfigDiffSheet.test.tsx` (`row(seed)` ~L93-105, `diffOk(rows)` ~L107, `renderSheet()` ~L160-172): a row `{variant: 'field_option_renamed', attribute: 'allowed_values', before: 'Development', after: 'Development only'}` renders the text "Option renamed" (the test's copy is the real copy module; if it mocks `t`, assert the key `changeFieldOptionRenamed`).

- [ ] **Step 2: Run red.** `cd "$WT" && npx vitest run frontend/components/extraction/dialogs/AllowedValuesList.test.tsx frontend/components/extraction/template-config/TemplateInspector.test.tsx frontend/test/TemplateConfigDiffSheet.test.tsx` → FAIL.

- [ ] **Step 3: Implement** per Interfaces. Use the existing `Input` and `IconButton`/button primitives already imported in `AllowedValuesList.tsx`; keep the visual layout of a row (the label text sits where it sits today and becomes editable on click).

- [ ] **Step 4: Run green + gates.** `cd "$WT" && npx vitest run frontend/components/extraction frontend/test/TemplateConfigDiffSheet.test.tsx && npm run typecheck && npm run lint && npx knip && npx knip --production && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/check_copy_keys.py && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/check_diff_attribute_copy.py` → PASS / 0 findings. Typecheck errors left only in `templateTree.ts`, `sectionRestore.ts`, `TemplateConfigEditor.tsx` (Task 2.2b-2) are expected and named in the commit body.

- [ ] **Step 5: Commit.** `git -C "$WT" add frontend && git -C "$WT" commit -m "feat(templates): rename an option in the inspector without orphaning answers"`

**Done when:** an inline rename keeps the code, a new option's code is its trimmed label, duplicates and empties show the existing inline errors, the diff sheet names the rename, gates green.

---

### Task 2.2b-2: Template tree, field restore writers and the example template on `{value, label}`

**Layer:** frontend · **Migration:** no · **Commit:** `feat(templates): grid tree and field restore carry {value, label} options`

**Goal:** the template-config tree types options as `OptionItem[]`; the two writers that re-create a field (`TemplateConfigEditor` undo-restore and section restore) send `{value, label}[]`; the AI-import example template uses the canonical shape (import still accepts legacy); `npm run typecheck` is clean for the whole option change.

**Context:** `frontend/lib/extraction/options.ts` exports `type OptionItem` and `normalizeOptions(allowedValues: unknown): OptionItem[]` (reads legacy `string[]` and `{options: [...]}` too). The backend `POST .../fields` accepts only `{value, label}[]` (bare strings → 422). Field rows read through PostgREST (`hooks/extraction/useTemplateEntityTypes.ts`, cast to `ExtractionField[]`) can still hold legacy shapes on a database the data migration has not reached, so every reader goes through `normalizeOptions`. Current code: `frontend/components/extraction/template-config/templateTree.ts` (`TemplateFieldInput.allowed_values?: string[] | null` L82; `GridField.allowedValues: string[] | null; optionCount: number` L118-119; `toGridField` L230-246; search haystack L389 `(field.allowedValues ?? []).join(' ')`); `sectionRestore.ts` (`CapturedField.allowedValues: string[] | null` L45; `captureSection` L116 `allowedValues: field.allowed_values ?? null`; `ReplayDeps.insertField` payload `allowed_values: string[] | null` L151; `replaySection` L215); `TemplateConfigEditor.tsx` `restoreFieldNow` (L126-160, sends `allowed_values: field.allowedValues` at L148); `frontend/lib/templateImport/exampleTemplate.json` L19 `"allowed_values": ["Cohort", "Case-control", "RCT"]` (imported raw by `lib/templateImport/aiPrompt.ts:13`). Frontend tooling runs from the repo root `$WT`.

**Files:**
- Modify: `frontend/components/extraction/template-config/templateTree.ts`
- Modify: `frontend/components/extraction/template-config/sectionRestore.ts`
- Modify: `frontend/components/extraction/TemplateConfigEditor.tsx` (only if its types do not already flow from `GridField`)
- Modify: `frontend/lib/templateImport/exampleTemplate.json`
- Test: `frontend/components/extraction/template-config/templateTree.test.ts`, `frontend/components/extraction/template-config/sectionRestore.test.ts`, `frontend/components/extraction/template-config/useStructuralUndo.test.tsx`, `frontend/lib/templateImport/aiPrompt.test.ts` (if it pins the example text)

**Interfaces:**
- Consumes: `OptionItem`, `normalizeOptions`.
- Produces: `TemplateFieldInput.allowed_values?: unknown` (the raw row value); `GridField.allowedValues: OptionItem[] | null` built by `toGridField` as `const options = normalizeOptions(input.allowed_values); allowedValues: options.length > 0 ? options : null, optionCount: options.length`; search haystack `['options', (field.allowedValues ?? []).map((o) => o.label).join(' ')]`.
- Produces: `CapturedField.allowedValues: OptionItem[] | null` (`captureSection`: `normalizeOptions(field.allowed_values)`, `[]` → `null`); `ReplayDeps.insertField` payload `allowed_values: OptionItem[] | null`. `restoreFieldNow` sends `allowed_values: field.allowedValues` (now `OptionItem[] | null`).
- `exampleTemplate.json` L19: `"allowed_values": [{"value": "Cohort", "label": "Cohort"}, {"value": "Case-control", "label": "Case-control"}, {"value": "RCT", "label": "RCT"}]`.

- [ ] **Step 1: Write the failing tests.**
  - `templateTree.test.ts`: a field input with `allowed_values: ['Cohort','RCT']` and one with `[{value:'coh',label:'Cohort'}]` both yield `GridField.allowedValues` of `OptionItem[]` and the right `optionCount`; searching "Cohort" matches the canonical field by label.
  - `sectionRestore.test.ts` (fixtures ~L37/75 `allowed_values: null`; the "hands insertField the FULL captured payload" case ~L223-233): add a captured select field with legacy `allowed_values: ['Yes','No']`; `replaySection` calls `insertField` with `allowed_values: [{value:'Yes',label:'Yes'},{value:'No',label:'No'}]`.
  - `useStructuralUndo.test.tsx` (`restoreField` mocks ~L459-517; fixture ~L97): restoring a deleted select field whose `allowedValues` is `[{value:'coh',label:'Cohort'}]` passes exactly that array to the insert payload.
  - Grid-row rendering is pinned by Task 2.2a-2's `TemplateGrid.test.tsx` case; keep it green.

- [ ] **Step 2: Run red.** `cd "$WT" && npx vitest run frontend/components/extraction/template-config/templateTree.test.ts frontend/components/extraction/template-config/sectionRestore.test.ts frontend/components/extraction/template-config/useStructuralUndo.test.tsx` → FAIL.

- [ ] **Step 3: Implement** per Interfaces; update `exampleTemplate.json`.

- [ ] **Step 4: Confirm the API types are current.** `cd "$WT" && npm run generate:api-types && git -C "$WT" status --short frontend/types/api` → no diff (the backend tasks committed them). If there is a diff, commit it in this task.

- [ ] **Step 5: Run green + full frontend gates.** `cd "$WT" && npm run test:run && npm run typecheck && npm run lint && npx knip && npx knip --production && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/check_copy_keys.py && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/check_frontend_data_path.py` → all PASS, typecheck clean (no deferred errors remain from Tasks 2.2a-1…2.2b-1), knip 0.

- [ ] **Step 6: Commit.** `git -C "$WT" add frontend && git -C "$WT" commit -m "feat(templates): grid tree and field restore carry {value, label} options"`

**Done when:** every writer sends `{value, label}[]`, every reader tolerates legacy rows, the example template is canonical, the full frontend suite and typecheck are green.

---

### Task 2.3a: Pure write-time value contract

**Layer:** backend · **Migration:** no · **Commit:** `feat(extraction): pure value contract for reviewer and consensus writes`

**Goal:** a pure, DB-free module `backend/app/services/value_contract.py` turns a raw decision value plus the field it is written to into the one canonical envelope, or refuses it with a typed `AppError` (`VALUE_CONTRACT_VIOLATION`, 422) naming the field and a reason from a closed set. Every shape the reviewer UI sends today is accepted.

**Context:** decision values travel as an envelope `{"value": X}` with optional `unit` and `absent_reason` siblings. The UI wraps once more: `frontend/hooks/runs/useRunValues.ts` `writeValue` sends `{value: normalizedValue}` (plus `absent_reason`), where `normalizedValue` is itself `{value, unit}` for a number with a unit (`useAutoSaveProposals.ts` ~L270-283) — so the wire value is often `{"value": {"value": "22", "unit": "mg"}}`. A cleared field sends `{"value": null}`. `SelectWithOther` emits `{"selected": "other", "other_text": ""}` the moment "Other" is picked (text filled in later), `MultiSelectWithOther` emits `{"selected": [codes], "other_texts": [strings, possibly ""]}` whenever `allow_other` is on and a bare list of codes otherwise; number inputs emit strings (`"22"`). Absent-reason codes are `no_information`, `not_applicable`, `not_evaluated` (`app/services/value_semantics.AbsentReason`); a field opts into each with `allows_no_information` / `allows_not_applicable` / `allows_not_evaluated`. `value_semantics.disposition_to_marker(raw, allowed_values, *, allows_no_information)` rewrites an in-band disposition string that is one of the field's options into `{"value": None, "absent_reason": code}`. Options are canonical `{value, label}` (`RunViewField.allowed_values: list[OptionItem] | None`, Task 2.1a-2a). `AppError(code, message, status_code=400, details=None)` lives in `backend/app/core/error_handler.py`; the global handler renders `{ok: false, error: {code, message, details}}`.

**Vulture note (this task only):** `canonicalize_value` gets its first `backend/app` caller in Task 2.3b, the next task. At this task's boundary the vulture ratchet may report exactly `app/services/value_contract.py: unused function 'canonicalize_value'`; nothing else may be new. Do not add it to the baseline. Task 2.3b's gate must be fully green.

**Files:**
- Create: `backend/app/services/value_contract.py`
- Create: `backend/tests/unit/test_value_contract.py`

**Interfaces:**
- Produces:
  ```python
  ValueContractReason = Literal[
      "MALFORMED_ENVELOPE", "MARKER_NOT_ALLOWED", "NOT_AN_OPTION", "NOT_A_NUMBER",
      "UNIT_NOT_ALLOWED", "NOT_A_DATE", "NOT_A_BOOLEAN", "NOT_TEXT",
  ]

  class ValueContractError(AppError):
      def __init__(self, *, field_id: UUID, reason: ValueContractReason, message: str) -> None:
          super().__init__(code="VALUE_CONTRACT_VIOLATION", message=message, status_code=422,
                           details={"field_id": str(field_id), "reason": reason})

  def canonicalize_value(raw: Any, field: RunViewField) -> dict[str, Any]: ...
  ```
- Rules, in order:
  1. **Envelope.** `raw` must be a dict with a `value` key and no keys besides `value`, `unit`, `absent_reason`; else `MALFORMED_ENVELOPE`. While `raw["value"]` is itself a dict with a `value` key (a double wrap), merge it up: the inner `value`, and the inner `unit`/`absent_reason` when the outer has none. More than one level of nesting after that is `MALFORMED_ENVELOPE`.
  2. **Disposition.** `raw = disposition_to_marker(raw, field.allowed_values, allows_no_information=field.allows_no_information)`.
  3. **Absent marker.** When `absent_reason` is present: it must be one of the three codes, the value must be `None`, and the field's matching `allows_*` flag must be true; else `MARKER_NOT_ALLOWED`. Return `{"value": None, "absent_reason": code}`.
  4. **Cleared.** `value is None` (or `""` on number/date) → return `{"value": None}`.
  5. **By `field.field_type`:**
     - `select`: a string that is one of the option values; or, when `allow_other`, `{"selected": "other", "other_text": <str>}` (an empty `other_text` is accepted: the UI saves while the reviewer types). Else `NOT_AN_OPTION`.
     - `multiselect`: a list of strings (empty strings dropped) that are unique option values; or, when `allow_other`, `{"selected": [option values], "other_texts": [str]}` (empty strings dropped). Else `NOT_AN_OPTION`. Return the cleaned shape.
     - `number`: an `int`/`float` that is finite and not a `bool`, or a string that parses as a finite float; a whole number is stored as `int`, otherwise `float`; else `NOT_A_NUMBER`. `unit` (when present and not `None`) must be in `field.allowed_units` or equal `field.unit`; else `UNIT_NOT_ALLOWED`. An omitted or `None` unit stores no `unit` key (it means `field.unit`).
     - `date`: a `YYYY-MM-DD` string that `date.fromisoformat` accepts; else `NOT_A_DATE`.
     - `boolean`: a `bool`; else `NOT_A_BOOLEAN`.
     - `text`: a `str`; else `NOT_TEXT`.
  6. Return `{"value": <canonical>}` plus `"unit"` when kept.
- `message` is one plain sentence naming the field label and what is accepted, e.g. `"'Study type' accepts one of its options."`; it never echoes the raw value.

- [ ] **Step 1: Write the failing tests** in `tests/unit/test_value_contract.py` (pure; build fields with a helper `def _field(field_type, **over) -> RunViewField` filling `id=uuid4(), name="f", label="F", is_required=False, sort_order=0, field_type=field_type`, then `RunViewField.model_validate({...})`):
  - one case per rule: double wrap `{"value": {"value": "22", "unit": "mg"}}` on a number field with `unit="mg"` → `{"value": 22, "unit": "mg"}`; `{"value": "22"}` → `{"value": 22}`; `{"value": 22.5}` → `{"value": 22.5}`; `{"value": "abc"}` → `NOT_A_NUMBER`; `{"value": float("inf")}` → `NOT_A_NUMBER`; `{"value": True}` on number → `NOT_A_NUMBER`; unit outside `allowed_units=["mg","g"]` → `UNIT_NOT_ALLOWED`; unit equal to `field.unit` → kept; `{"value": None, "absent_reason": "not_applicable"}` on a field with `allows_not_applicable=False` → `MARKER_NOT_ALLOWED`, with it true → the marker; `{"value": None, "absent_reason": "bogus"}` → `MARKER_NOT_ALLOWED`; an in-band `"NA"` that is one of a select's options with `allows_not_applicable=True` → the marker; select `"dev"` in options → `{"value": "dev"}`, `"Development only"` (a label, not a code) → `NOT_AN_OPTION`; select other with `allow_other=False` → `NOT_AN_OPTION`; multiselect duplicates → `NOT_AN_OPTION`; date `"2024-02-30"` → `NOT_A_DATE`; boolean `"true"` → `NOT_A_BOOLEAN`; text `5` → `NOT_TEXT`; `{"value": 1, "extra": 2}` → `MALFORMED_ENVELOPE`; `"bare"` → `MALFORMED_ENVELOPE`.
  - error shape: `exc.code == "VALUE_CONTRACT_VIOLATION"`, `exc.status_code == 422`, `exc.details == {"field_id": str(field.id), "reason": "NOT_AN_OPTION"}`; the raw value does not appear in `exc.message`.
  - `UI_SHAPES` vector (module constant, one comment per entry naming the emitting component), each accepted by `canonicalize_value` for its field: `{"value": "22"}` and `{"value": {"value": "22", "unit": "mg"}}` (number input, `FieldValueEditor`); `{"value": None}` (cleared field); `{"value": "Y"}` (`SelectWithOther` option); `{"value": {"selected": "other", "other_text": ""}}` and `{"value": {"selected": "other", "other_text": "Registry"}}` (`SelectWithOther` "Other"); `{"value": ["A", "B"]}` (`MultiSelectWithOther` without other); `{"value": {"selected": ["A"], "other_texts": [""]}}` and `{"value": {"selected": [], "other_texts": ["x"]}}` (`MultiSelectWithOther` with other); `{"value": True}` (boolean switch); `{"value": "2024-01-31"}` (date input); `{"value": "free text"}` (text input); `{"value": None, "absent_reason": "no_information"}` (`FieldInput` marker button).

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/unit/test_value_contract.py -q` → FAIL (module missing).

- [ ] **Step 3: Implement** `value_contract.py` per Interfaces (module docstring: where it runs — human reviewer decisions and consensus manual overrides — and where it deliberately does not: AI proposal landing, the system carry-overs (QA materialization at the extract→consensus advance, the reopen carry-over) and approve-and-finalize's publish of agreed values).

- [ ] **Step 4: Run green + gates.**
  ```bash
  cd "$WT/backend" && uv run pytest tests/unit -q
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh
  cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  ```
  Expected: tests PASS, lint and fitness green; vulture reports only the one finding named in the Vulture note.

- [ ] **Step 5: Commit.** `git -C "$WT" add backend && git -C "$WT" commit -m "feat(extraction): pure value contract for reviewer and consensus writes"`

**Done when:** every rule has a passing case, every UI shape is accepted, the error carries `field_id` and `reason`, gates green apart from the noted vulture finding.

---

### Task 2.3b: Enforce the value contract on human decisions and consensus overrides

**Layer:** backend · **Migration:** no · **Commit:** `feat(extraction): refuse off-contract reviewer and consensus values with 422`

**Goal:** a reviewer decision that carries a value, and a consensus manual override sent by a person, are canonicalized against the field **as pinned in the run's template version** and refused with 422 `VALUE_CONTRACT_VIOLATION` (no row appended) when they break the contract. AI proposal landing, the system carry-overs — including QA materialization of human proposals inside the extract→consensus advance — and approve-and-finalize's publish of agreed values are not checked (the read-only value-envelope audit covers them). Both service methods enforce by default (fail-safe); each system caller opts out explicitly.

**Context:** `backend/app/services/value_contract.py` (Task 2.3a) exports `canonicalize_value(raw, field: RunViewField) -> dict` and `ValueContractError(AppError)` (code `VALUE_CONTRACT_VIOLATION`, 422, `details {field_id, reason}`); the global AppError handler renders it, so endpoints need no try/except for it. `backend/app/services/extraction_snapshot.py::entity_types_for_version(db, *, version_id, template_id) -> list[RunViewEntityType]` is the one provider of a run's pinned tree (pinned snapshot → live rows when the snapshot is narrow/empty/missing); `live_entity_types(db, *, template_id)` reads the live tree. Current code:
- `ExtractionReviewService.record_decision` (`backend/app/services/extraction_review_service.py:58`; `open_run_for_write(...)` at :81 returns the run, discarded today; the live `ExtractionField` read + `disposition_to_marker` at :156-170 raise `InvalidDecisionError` (plain `Exception`, :35) for a disallowed `no_information` marker; dedupe on `latest.value == value` :173-189; insert :193). Its QA re-entry `materialize_qa_decisions` (:213-320) calls `record_decision(..., decision=EDIT, value=proposal.proposed_value, enforce_marker_optin=False)` at :279 inside `advance_stage`.
- `ExtractionConsensusService.record_consensus` (`extraction_consensus_service.py:48-59`; `open_run_for_write(... CONSENSUS ...)` :60; `manual_override` → `published_value = value or {}` :122-123; no field read).
- Callers: `api/v1/endpoints/extraction_runs.py` `create_decision` (:226-279, `record_decision` :242, `InvalidDecisionError` → 400 :264-274) and `create_consensus` (:311-389, `record_consensus` :332-341); `run_lifecycle_service.approve_and_finalize` (:280-290, `record_consensus(... MANUAL_OVERRIDE, value=envelope ...)`); `entry_hierarchy_service._record_key_decision` (:362-418, `record_decision(decision="edit", value={"value": value})`, `except InvalidDecisionError: return`).
- `app/api/**` must not import `app.models` (`check_layered_arch.py`).

**Files:**
- Modify: `backend/app/services/extraction_snapshot.py` (new `pinned_field`)
- Modify: `backend/app/services/extraction_review_service.py`
- Modify: `backend/app/services/extraction_consensus_service.py`
- Modify: `backend/app/api/v1/endpoints/extraction_runs.py` (`create_consensus` passes `enforce_contract=True`; declare `422` in both decision and consensus routes' `responses=` if the file declares responses — follow `check_response_descriptions.py`)
- Modify: `backend/app/services/run_lifecycle_service.py` (`approve_and_finalize` passes `enforce_contract=False` explicitly, with a one-line comment: agreed values may include accepted AI proposals that were never validated; the read-only audit covers them)
- Modify: `backend/app/services/entry_hierarchy_service.py` (catch `ValueContractError` next to `InvalidDecisionError`, and log it)
- Create: `backend/tests/integration/test_value_contract_services.py` (direct service-level tests: lines reached only through `db_client` record no coverage)
- Create: `backend/tests/integration/test_value_contract_writes.py`
- Test: `backend/tests/integration/test_extraction_review_service.py`, `backend/tests/integration/test_extraction_consensus_service.py`, `backend/tests/integration/test_entry_hierarchy_service.py`, `backend/tests/unit/test_extraction_runs_endpoint_unit.py` (create if absent, pattern `tests/unit/test_personal_access_tokens_endpoint_unit.py`)

**Interfaces:**
- Produces: `async def pinned_field(db: AsyncSession, *, version_id: UUID, template_id: UUID, field_id: UUID) -> RunViewField | None` — a lookup by id in `entity_types_for_version(...)` (which already falls back to live rows only when the pinned snapshot is narrow); `None` when the run's tree does not contain the field. No second fallback.
- `record_decision(..., enforce_contract: bool = True)` replaces the `enforce_marker_optin` flag (its only `False` caller, `materialize_qa_decisions`, now passes `enforce_contract=False`; confirm with `grep -rn "enforce_marker_optin" "$WT/backend/app"` that no other caller exists). Keep the run returned by `open_run_for_write`; for a decision that carries a value (`value is not None`), `field = await pinned_field(self.db, version_id=run.version_id, template_id=run.template_id, field_id=field_id)`; `field is None` → `InvalidDecisionError("field is not part of this run's template version")`. With `enforce_contract=True`: `value = canonicalize_value(value, field)` before the dedupe compare. With `False` (system carry-over): only today's normalization, `value = disposition_to_marker(value, field.allowed_values, allows_no_information=field.allows_no_information)`, no refusal. Delete the live `ExtractionField` read and the old inline marker check.
- `materialize_qa_decisions` (`extraction_review_service.py:279`) passes `enforce_contract=False` (comment: a system carry-over of human proposals, audited by the read-only value-envelope audit, never refused inside `advance_stage`).
- `record_consensus(..., enforce_contract: bool = True)`: for `manual_override` with `enforce_contract=True`, canonicalize `value` against `pinned_field(...)` (same `None` → `InvalidConsensusError` rule) before writing. `create_consensus` relies on the default (pass `True` explicitly for readability); `approve_and_finalize` passes `False`.
- `_record_key_decision`: `except (InvalidDecisionError, ValueContractError) as exc:` log `entry_key_prefill_skipped` with `run_id`, `instance_id`, `field_id` and `reason` (from `exc.details` when present) — never the value — then `return` (the entry is still created; no reviewer decision).

- [ ] **Step 1: Write the failing tests.** New `tests/integration/test_value_contract_writes.py`. Setup helper (pattern `tests/integration/test_entry_group_extraction.py` `_group`/`_pinned_field`/`_pinned_group` ~L70-243 and `_pin_run_to_snapshot` in `tests/integration/test_pinned_prompt_structure.py:76-97`): on the SEED template add a live `select` field with `allowed_values=[{"value":"dev","label":"Development"},{"value":"val","label":"Validation"},{"value":"draft_only","label":"Draft only"}]` and a live `number` field with `unit="mg"`, `allowed_units=["mg","g"]`, `allows_not_applicable=False`; insert an inactive version whose wide (non-narrow) snapshot holds both fields but the select **without** `draft_only`; create a run in EXTRACT on the SEED article/instance (`run_in_extract(db)` from `tests/integration/helpers/engine_setup.py`) and pin it to that version. Calls go through HTTP (`db_client`, authenticated as the run's reviewer the way `tests/integration/test_template_structure_endpoints.py` authenticates) to `POST /api/v1/runs/{run_id}/decisions` and, for consensus, `/consensus` after advancing the run to CONSENSUS as `test_extraction_consensus_service.py` does. Cases:
  - `test_off_vocabulary_select_is_refused_on_decisions`: value `{"value": "nope"}` → 422, `error.code == "VALUE_CONTRACT_VIOLATION"`, `error.details.reason == "NOT_AN_OPTION"`, `error.details.field_id == <select id>`; the `extraction_reviewer_decisions` count for that coordinate is unchanged.
  - `test_off_vocabulary_select_is_refused_on_consensus_override`: `mode="manual_override"`, same value → 422 `NOT_AN_OPTION`; no `extraction_consensus_decisions` / `extraction_published_states` row added.
  - `test_numeric_string_is_stored_as_number`: `{"value": "22"}` on the number field → 201; the stored decision `value == {"value": 22}`.
  - `test_unit_outside_allowed_units_is_refused`: `{"value": {"value": "5", "unit": "kg"}}` → 422 `UNIT_NOT_ALLOWED`.
  - `test_na_marker_refused_when_field_disallows`: `{"value": None, "absent_reason": "not_applicable"}` on the number field → 422 `MARKER_NOT_ALLOWED`.
  - `test_option_only_in_draft_is_refused_and_pinned_option_accepted`: `{"value": "draft_only"}` → 422 `NOT_AN_OPTION`; `{"value": "dev"}` → 201.
  - `test_entry_with_label_as_key_is_created_without_decision` (service level, pattern `tests/integration/test_entry_hierarchy_service.py:493`): an entry whose key field is a select and whose key text is a label that is not an option ("Development") creates the entry; no reviewer decision exists for the key field.
  - `test_approve_and_finalize_publishes_off_vocabulary_ai_value`: land an AI proposal with `{"value": "nope"}` on the select (`land_ai_proposal` as in `test_extraction_review_service.py::_setup_review_run`), accept it (`decision="accept_proposal"`), run `approve_and_finalize` → succeeds (no 422) and the run is finalized.
  - `test_qa_materialization_carries_off_contract_proposal` (service level): a QA run whose human proposal on a select field is an off-vocabulary legacy value (`{"value": "legacy text"}`, planted directly) advances from EXTRACT to CONSENSUS (`materialize_qa_decisions` runs inside `advance_stage`) and the materialized decision holds that value unchanged — no `ValueContractError`.
- Update existing tests that write non-envelope values through `record_decision` (`test_extraction_review_service.py` ~L229 `{"v":"x"}`, ~L365/435 `{"text":"edited"}` on the seed `number` field `sample_size`) to valid envelopes (`{"value": 5}`); the consensus tests that write `{"v": "edited"}` / `{"value": "5", "unit": "mg"}` through `manual_override` on the seed `number` field also move to valid envelopes (enforcement is now the default). A test that asserted `InvalidDecisionError` for a disallowed `no_information` marker now asserts `ValueContractError` with `reason == "MARKER_NOT_ALLOWED"`.
- New `tests/integration/test_value_contract_services.py` (direct service calls on `db_session`, same setup helper): `record_consensus(..., mode="manual_override", value={"value": "nope"})` raises `ValueContractError` (`NOT_AN_OPTION`) and with `enforce_contract=False` stores it; `pinned_field` returns the pinned field (without `draft_only` in its options), returns the live field when the pinned snapshot is narrow (SEED template's empty v1), and returns `None` for a field absent from a non-narrow pinned tree; `record_decision` on that absent field raises `InvalidDecisionError`.
- Endpoint unit test (coverage): call `create_consensus.__wrapped__` (or the plain function) with a mocked service and assert it passes `enforce_contract=True`.

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/integration/test_value_contract_writes.py -q` → FAIL.

- [ ] **Step 3: Implement** per Interfaces.

- [ ] **Step 4: Regenerate API types** only if a route's `responses=` changed: `cd "$WT" && npm run generate:api-types`.

- [ ] **Step 5: Run green + gates.**
  ```bash
  cd "$WT/backend" && uv run pytest tests/unit tests/integration/test_value_contract_writes.py \
    tests/integration/test_extraction_review_service.py tests/integration/test_extraction_consensus_service.py \
    tests/integration/test_entry_hierarchy_service.py tests/integration/test_run_lifecycle_service.py -q
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh
  cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  ```
  Expected: PASS; vulture fully green (the `canonicalize_value` finding from Task 2.3a is gone). If `test_run_lifecycle_service.py` is not the file name, run `ls "$WT/backend/tests/integration" | grep -i lifecycle` and run those.

- [ ] **Step 6: Commit.** `git -C "$WT" add backend frontend/types/api && git -C "$WT" commit -m "feat(extraction): refuse off-contract reviewer and consensus values with 422"`

**Done when:** every acceptance case passes, the contract reads the pinned field, approve-and-finalize, QA materialization and AI landing are never refused, entry creation survives a non-option key (logged), gates green.

---

### Task 2.3c: Show value-contract refusals in autosave and the consensus override

**Layer:** frontend · **Migration:** no · **Commit:** `feat(runs): surface value-contract refusals and keep the reviewer's input`

**Goal:** when the server refuses a value with 422 `VALUE_CONTRACT_VIOLATION`: form autosave lands in its `error` state with the server's message and the input keeps what the reviewer typed; a consensus manual override shows an error toast with the server's message and the override editor stays open, with no unhandled promise rejection. The number unit picker offers only units the server accepts.

**Context:** the backend (Task 2.3b) answers `{ok: false, error: {code: "VALUE_CONTRACT_VIOLATION", message, details: {field_id, reason}}}` with status 422 for a reviewer decision or a consensus manual override that breaks the field's contract. A unit is accepted only when it is in the field's `allowed_units` or equals `field.unit`. `apiClient` throws `ApiError(code, message, status, traceId?, details?)` (`frontend/integrations/api/client.ts:68`). Current code:
- `frontend/hooks/runs/useAutoSaveProposals.ts`: error path ~L333-352 already does `setError(err.message)`, `setSaveState('error')`, `toast.error(t('extraction','errors_autoSaveFailed'))`; its writer is `useRunValues.writeValue` (`frontend/hooks/runs/useRunValues.ts:233-245`), whose `settleFailure` (~L221-231) treats 409/400 specially and maps other statuses to `'failed'`.
- `frontend/hooks/runs/useRunLifecycleScreen.ts`: local `errorMessage(err, fallback)` (L145), `toastFailure` (L209), `resolve` (L261-265: `await run('consensus', ...)`, `await invalidateRun()`, no catch, no toast); `onManualOverride` (~L380-395) calls `resolve`.
- `frontend/components/runs/ConsensusOverrideEditor.tsx` L95: `onClick={() => void onPublish(value, rationale.trim())}` (a rejection is unhandled).
- `frontend/components/runs/RunReviewerComparison.tsx` ~L762-776: `onPublish={async (value, rationale) => { await onManualOverride({...}); close(); }}` (a throw skips `close()`).
- `frontend/components/extraction/FieldValueEditor.tsx` number branch ~L170-190: `relatedUnits` falls back to `getRelatedUnits(field.unit)` (`frontend/lib/unitConversions.ts:122`, only caller) when `allowed_units` is empty.
- Copy goes through `t(namespace, key)`; `check_copy_keys.py` must stay green. Frontend tooling runs from `$WT`.

**Files:**
- Modify: `frontend/hooks/runs/useRunLifecycleScreen.ts` (`resolve`)
- Modify: `frontend/components/runs/ConsensusOverrideEditor.tsx` (L95)
- Modify: `frontend/components/extraction/FieldValueEditor.tsx` (unit options)
- Modify: `frontend/lib/unitConversions.ts` (delete `getRelatedUnits` and anything only it uses; delete its test cases if any — `grep -rn "getRelatedUnits" "$WT/frontend"`)
- Modify: `frontend/lib/copy/consensus.ts` (add `overridePublishFailed: 'Could not publish the consensus value'`)
- Test: `frontend/test/hooks/useRunValues.test.tsx`, `frontend/test/useRunLifecycleScreen.test.tsx`, `frontend/test/RunReviewerComparison.resolve.test.tsx`, `frontend/components/runs/ConsensusOverrideEditor.test.tsx`, `frontend/components/extraction/FieldValueEditor.test.tsx`

**Interfaces:**
- `resolve(body)` becomes:
  ```ts
  const resolve = async (body: Parameters<typeof runLifecycleService.createConsensus>[1]) => {
    if (!runId) return;
    try {
      await run('consensus', () => runLifecycleService.createConsensus(runId, body));
    } catch (err) {
      toast.error(errorMessage(err, t('consensus', 'overridePublishFailed')));
      throw err;
    }
    await invalidateRun();
  };
  ```
  (a plain `async` function outside the component body, so the React Compiler `try`/`throw` restriction does not apply; if the lint/compiler still refuses it, express it as `run(...).catch((err) => { toast.error(...); throw err; })`.)
- `ConsensusOverrideEditor` L95: `onClick={() => { Promise.resolve(onPublish(value, rationale.trim())).catch(() => undefined); }}` — the parent already toasted; the catch only prevents an unhandled rejection, and the editor stays open because `RunReviewerComparison` skips `close()` on a throw.
- `FieldValueEditor` number units: `const unitOptions = field.allowed_units?.length ? field.allowed_units : field.unit ? [field.unit] : [];` and `hasMultipleUnits = unitOptions.length > 1`; no dictionary fallback.

- [ ] **Step 1: Write the failing tests.**
  - `frontend/test/hooks/useRunValues.test.tsx` (MSW: `server.use(http.post('*/api/v1/runs/:run/decisions', () => HttpResponse.json({ok: false, error: {code: 'VALUE_CONTRACT_VIOLATION', message: "'Study type' accepts one of its options.", details: {field_id: 'f1', reason: 'NOT_AN_OPTION'}}}, {status: 422})))`): after an edit and the autosave flush, `saveState === 'error'`, `error === "'Study type' accepts one of its options."`, and the local value for the coordinate is still the typed value (not reverted to the last saved one).
  - `frontend/test/useRunLifecycleScreen.test.tsx` ("in consensus (arbitrator)" describe ~L182; `apiClient` mocked): when `createConsensus` rejects with `new ApiError('VALUE_CONTRACT_VIOLATION', 'Refused by contract', 422)`, `onManualOverride(...)` rejects and `toast.error` was called with `'Refused by contract'`.
  - `frontend/test/RunReviewerComparison.resolve.test.tsx` (pattern "override expands the typed editor and publishes" ~L134): with `onManualOverride` rejecting, clicking publish leaves the editor open (`consensus-override-submit-<coord>` still in the document) and no unhandled rejection is reported (vitest fails the run on one).
  - `frontend/components/runs/ConsensusOverrideEditor.test.tsx`: `onPublish` returning a rejected promise does not throw out of the click handler.
  - `frontend/components/extraction/FieldValueEditor.test.tsx`: a number field with `unit: 'mg'` and no `allowed_units` renders no unit picker (only one option); with `allowed_units: ['mg','g']` it offers exactly `mg` and `g`.

- [ ] **Step 2: Run red.** `cd "$WT" && npx vitest run frontend/test/hooks/useRunValues.test.tsx frontend/test/useRunLifecycleScreen.test.tsx frontend/test/RunReviewerComparison.resolve.test.tsx frontend/components/runs/ConsensusOverrideEditor.test.tsx frontend/components/extraction/FieldValueEditor.test.tsx` → FAIL (no toast on consensus refusal; unhandled rejection; dictionary units offered). If the autosave case already passes, keep it as the pin it is meant to be and say so in the commit body.

- [ ] **Step 3: Implement** per Interfaces.

- [ ] **Step 4: Run green + gates.** `cd "$WT" && npm run test:run && npm run typecheck && npm run lint && npx knip && npx knip --production && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/check_copy_keys.py` → PASS / 0 findings.

- [ ] **Step 5: Commit.** `git -C "$WT" add frontend && git -C "$WT" commit -m "feat(runs): surface value-contract refusals and keep the reviewer's input"`

**Done when:** a 422 leaves autosave in `error` with the server message and the typed value, the override shows the server message and stays open with no unhandled rejection, the unit picker offers only accepted units, gates green.

---

### Task 2.4a: Read-only value-envelope audit reporter

**Layer:** backend · **Migration:** no · **Commit:** `feat(extraction): read-only audit of stored value envelopes`

**Goal:** a read-only reporter, `cd backend && uv run python -m app.services.value_envelope_audit`, counts stored values that do not match the value envelope, per table and violation kind, with sample ids and a last-30-days count. It is the evidence a maintainer records before any database CHECK on these columns is added (that CHECK is out of this plan).

**Context:** the envelope a stored value must match: `NULL`, or a JSON object that has a `value` key, whose keys are only `value`, `unit`, `absent_reason` (plus `verification` on proposal records only), and whose `absent_reason`, when present, is one of `no_information`, `not_applicable`, `not_evaluated`. A legacy double wrap (`{"value": {"value": 22, "unit": "mg"}}`) passes (the outer object is a valid envelope). Columns: `extraction_reviewer_decisions.value` (nullable), `extraction_consensus_decisions.value` (nullable), `extraction_published_states.value` (NOT NULL), `extraction_proposal_records.proposed_value` (NOT NULL); every table has `id` and `created_at` (`app/models/base.py` TimestampMixin; models in `backend/app/models/extraction_workflow.py`). Precedent to follow exactly: `backend/app/services/narrow_snapshot_audit.py` (pure classifier + `async audit_*(db)` + pure `format_findings` + `async _report()` marked `# pragma: no cover` that opens `AsyncSessionLocal` from `app.core.deps` + `if __name__ == "__main__": raise SystemExit(...)`), tested by `tests/unit/test_narrow_snapshot_audit.py` and `tests/integration/test_narrow_snapshot_audit_query.py`. The reporter never writes. Raw SQL uses `text()` with bound parameters, never f-strings with values (table/column names come from a fixed tuple in the module).

**Files:**
- Create: `backend/app/services/value_envelope_audit.py`
- Create: `backend/tests/unit/test_value_envelope_audit_report.py`
- Create: `backend/tests/integration/test_value_envelope_audit.py`

**Interfaces:**
- Produces:
  ```python
  class EnvelopeViolation(StrEnum):
      NOT_OBJECT = "not_object"
      MISSING_VALUE = "missing_value"
      UNKNOWN_KEY = "unknown_key"
      BAD_ABSENT_REASON = "bad_absent_reason"
      VERIFICATION_OUTSIDE_PROPOSAL = "verification_outside_proposal"

  @dataclass(frozen=True, slots=True)
  class TableAudit:
      table: str
      counts: dict[EnvelopeViolation, int]
      sample_ids: dict[EnvelopeViolation, list[UUID]]   # at most 5 per kind
      last_30_days: int

  async def audit_value_envelopes(db: AsyncSession) -> list[TableAudit]: ...
  def format_report(audits: list[TableAudit]) -> str: ...
  ```
  `_TABLES = (("extraction_reviewer_decisions", "value", False), ("extraction_consensus_decisions", "value", False), ("extraction_published_states", "value", False), ("extraction_proposal_records", "proposed_value", True))`. The envelope rule has ONE source: a module-level SQL `CASE` expression `_KIND_SQL` (built per table from the fixed `_TABLES` tuple, with the `verification` branch only for proposal records) that yields the violation kind or `NULL`, in the enum's order (first failing rule wins): not an object → `not_object`; no `value` key → `missing_value`; `verification` outside proposals → `verification_outside_proposal`; any other key outside the allowed set → `unknown_key`; `absent_reason` outside the vocabulary → `bad_absent_reason`. `audit_value_envelopes` runs, per table, one grouped `SELECT kind, count(*), count(*) FILTER (WHERE created_at >= now() - interval '30 days'), (array_agg(id ORDER BY created_at DESC))[1:5] FROM (SELECT id, created_at, <_KIND_SQL> AS kind FROM public.<table> WHERE <col> IS NOT NULL) x WHERE kind IS NOT NULL GROUP BY kind`. No Python re-implementation of the rule. `_report()` prints `format_report(...)` and exits 1 when any count is non-zero, else 0.

- [ ] **Step 1: Write the failing tests.**
  - `tests/unit/test_value_envelope_audit_report.py`: `format_report` of an empty audit says the total is 0; of one finding lists the table, kind, count, sample ids and the 30-day count.
  - `tests/integration/test_value_envelope_audit.py` (`db_session`, savepoint-isolated; build a run, instance and field as `tests/integration/test_extraction_review_service.py::_setup_review_run` does, or with `run_in_extract(db)` from `tests/integration/helpers/engine_setup.py`):
    - `test_kind_rules`: plant one reviewer decision per shape and read its kind back through the audit (the SQL is the only implementation): `{"value": 1}`, `{"value": null, "absent_reason": "no_information"}`, `{"value": 2, "unit": "mg"}` and the double wrap `{"value": {"value": 22, "unit": "mg"}}` are not reported; `"x"` and `[1]` → `not_object`; `{"unit": "mg"}` → `missing_value`; `{"value": 1, "text": "y"}` → `unknown_key`; `{"value": null, "absent_reason": "nope"}` → `bad_absent_reason`; `{"value": 1, "verification": {}}` → `verification_outside_proposal` on a reviewer decision and not reported on a proposal record.
    - `test_clean_estate_reports_zero`: `audit_value_envelopes(db_session)` → every table's counts are empty (if the seeded test database itself holds a violator, stop and report it: that is a finding, not a test to loosen).
    - `test_planted_violators_are_found`: insert directly with `text()` one reviewer decision with `value = '{"text":"x"}'::jsonb` (`UNKNOWN_KEY`), one consensus decision + published state with `'"bare"'::jsonb` (`NOT_OBJECT`), and one proposal record with `'{"value":1,"verification":{}}'::jsonb` (allowed) plus one with `'{"value":null,"absent_reason":"nope"}'::jsonb` (`BAD_ABSENT_REASON`); the audit reports exactly those kinds, their ids among `sample_ids`, and `last_30_days` equal to the planted count; an extra reviewer decision with `created_at = now() - interval '60 days'` counts in `counts` but not in `last_30_days`.

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/unit/test_value_envelope_audit_classifier.py tests/integration/test_value_envelope_audit.py -q` → FAIL (module missing).

- [ ] **Step 3: Implement** per Interfaces (module docstring: what it checks, that it is read-only, the run command, and that its exit code is 1 when anything is found).

- [ ] **Step 4: Run green + gates.**
  ```bash
  cd "$WT/backend" && uv run pytest tests/unit tests/integration/test_value_envelope_audit.py -q \
    && uv run python -m app.services.value_envelope_audit; echo "exit=$?"
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh
  cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  ```
  Expected: tests PASS; the reporter runs against the test database and prints a report (exit 0 on a clean seed); gates green (every public function has an app caller through `_report`). `grep -n "def classify" "$WT/backend/app/services/value_envelope_audit.py"` → no output (one source of the rule).

- [ ] **Step 5: Commit.** `git -C "$WT" add backend && git -C "$WT" commit -m "feat(extraction): read-only audit of stored value envelopes"`

**Done when:** the reporter's one SQL rule classifies every violation kind, reports per table with samples and a 30-day count, never writes, gates green.

---

### Task 2.5a: One envelope peel and typed MCP values on detailed rows

**Layer:** backend · **Migration:** no · **Commit:** `feat(mcp): typed values with labels and units in get_extractions detailed rows`

**Goal:** the export resolver and the MCP renderer share one envelope peel. `get_extractions` in `detailed` format returns each row's value as a typed `McpValue` (`{value, label?, unit?, absent_reason?, other_text?, truncated?}`): `null` stays `null`, `22.0` and `"22"` on a number field read `22`, units come from the envelope or the field, select codes come with their label when it differs, absence markers read `value: null` plus the coded reason and its label, long text is capped with `truncated: true`.

**Context:** stored values are envelopes `{"value": X}` with optional `unit`, `absent_reason` and (proposal records only) `verification` siblings; legacy rows may be double-wrapped (`{"value": {"value": 22, "unit": "mg"}}`). `backend/app/services/exports/value_envelope.py::resolve_value(raw, *, field=None)` (L44-126) peels in this order: `strip_verification` (from `app.services.value_semantics`), marker via `value_absent_reason` → `ABSENT_REASON_LABELS[reason]`, single/double `{"value"}` wrap, `{"value","unit"}`, select-other `{"selected":"other","other_text"}`, multiselect-other `{"selected":[...],"other_texts":[...]}`; `tests/unit/test_value_envelope.py` pins it. `backend/app/services/extraction_agent_read_service.py`: `_short(value, limit)` (L201-211, renders markers as "no information" and everything else as `str(...)`), `_flatten_tree(tree)` (L392-410, rows `(field.id, et.id, field.label, field.field_type)`, drops `allowed_values` and `unit`), `list_agent_extractions` (L481; loads the ACTIVE version tree with live fallback at L511-516 — the same tree `get_template` reads), detailed loop (~L700-724: `McpDetailedRow(..., value=_short(resolved.value, limit=_DETAILED_VALUE_CAP), ...)`), caps `_CONCISE_VALUE_CAP = 80`, `_DETAILED_VALUE_CAP = 1_000` (L78-83). `RunViewField` carries canonical `allowed_values: list[OptionItem] | None` and `unit`. `backend/app/schemas/mcp_extractions.py`: `McpDetailedRow.value: Any` (L36), `McpExtractionsPage.untrusted_fields` default (L67-74) includes `"articles[].rows[].value"`. `tests/integration/mcp/test_mcp_result_shape.py::test_untrusted_fields_declare_every_untrusted_string` requires every string leaf of a tool's `outputSchema` to be either trusted (`_TRUSTED_PATHS`) or declared, and the declared set to equal the untrusted set exactly; `Literal` leaves are skipped. Results stay ≤ 32,000 characters (`app.utils.compact_json.RESULT_CAP`). `backend/app/schemas/**` is excluded from vulture; services are not.

**Files:**
- Modify: `backend/app/services/exports/value_envelope.py` (new `PeeledValue`, `peel_envelope`; `resolve_value` uses it)
- Modify: `backend/app/schemas/mcp_extractions.py` (`McpValue`; `McpDetailedRow.value: McpValue`; untrusted paths for rows)
- Modify: `backend/app/services/extraction_agent_read_service.py` (`_FieldInfo`, `_flatten_tree`, `_mcp_value`, detailed loop)
- Create: `backend/tests/unit/test_mcp_value_render.py`
- Test: `backend/tests/unit/test_value_envelope.py` (must stay green unchanged), `backend/tests/integration/mcp/test_mcp_get_extractions.py`, `backend/tests/integration/mcp/test_mcp_result_shape.py`

**Interfaces:**
- Produces (`value_envelope.py`):
  ```python
  @dataclass(frozen=True, slots=True)
  class PeeledValue:
      value: Any                 # the inner payload after every wrap is removed
      unit: str | None
      absent_reason: str | None  # a closed-vocabulary code, else None

  def peel_envelope(raw: Any) -> PeeledValue: ...
  ```
  Order: `None` → all `None`; `strip_verification`; a marker (`value_absent_reason`) → `PeeledValue(None, None, code)`; while `raw` is a dict whose keys are a subset of `{"value", "unit", "absent_reason"}` and include `"value"`: keep the first non-empty `unit`, re-check the marker, `raw = raw["value"]`. `resolve_value` calls `peel_envelope` and then applies its existing rendering (labels for markers, unit formatting, other/multiselect joins) to the peeled parts; behavior is unchanged (pinned by `test_value_envelope.py`).
- Produces (`schemas/mcp_extractions.py`):
  ```python
  class McpValue(BaseModel):
      model_config = ConfigDict(extra="forbid")
      value: str | int | float | bool | list[str] | None
      label: str | list[str] | None = None
      unit: str | None = None
      absent_reason: Literal["no_information", "not_applicable", "not_evaluated"] | None = None
      other_text: str | None = None
      truncated: Literal[True] | None = None

      @model_serializer(mode="wrap")
      def _omit_absent(self, handler):  # keep "value" always, drop other None keys
          data = handler(self)
          return {k: v for k, v in data.items() if k == "value" or v is not None}
  ```
  `McpDetailedRow.value: McpValue`. In `McpExtractionsPage.untrusted_fields` replace `"articles[].rows[].value"` with `"articles[].rows[].value.value"`, `"articles[].rows[].value.label"`, `"articles[].rows[].value.unit"`, `"articles[].rows[].value.other_text"` (all authored or extracted text; `absent_reason` and `truncated` are `Literal`). Confirm the exact path spelling the walker produces by running `test_mcp_result_shape.py` red first.
- Produces (`extraction_agent_read_service.py`):
  - `@dataclass(frozen=True, slots=True) class _FieldInfo: field_id: UUID; et_id: UUID; label: str; field_type: str; options: dict[str, str]; unit: str | None` — `options` is code → label from `normalize_options(field.allowed_values)`. `_flatten_tree` returns `_FieldInfo`s in both its row list and its per-entity-type map; update the three unpack sites (~L522-526, ~L652, ~L700).
  - `_mcp_value(raw: Any, field: _FieldInfo, *, text_cap: int) -> McpValue`:
    - `peel = peel_envelope(raw)`; marker → `McpValue(value=None, absent_reason=code, label=ABSENT_REASON_LABELS[code])`.
    - `peel.value is None` → `McpValue(value=None)`.
    - number field: a whole float → `int`; a numeric string → number (int when whole); `unit = peel.unit or field.unit`.
    - select: a code `c` → `McpValue(value=c, label=field.options[c])` only when that label exists and differs from `c`; `{"selected":"other","other_text": t}` → `McpValue(value="other", other_text=t)`.
    - multiselect: a list of codes → `value=codes`, `label=[field.options.get(c, c) for c in codes]` only when any differs; `{"selected":[...], "other_texts":[...]}` → codes as above plus `other_text="; ".join(non-empty texts)`.
    - a code missing from `field.options` gets no label.
    - text (and any other string): longer than `text_cap` → first `text_cap` characters and `truncated=True`.
    - anything else → `McpValue(value=str(peel.value))` capped the same way.
  - Detailed rows use `_mcp_value(resolved.value, info, text_cap=_DETAILED_VALUE_CAP)`. The concise cells keep `_short` in this task (Task 2.5b replaces them).

- [ ] **Step 1: Write the failing tests.**
  - New `tests/unit/test_mcp_value_render.py` (pure; build `_FieldInfo` directly):
    - `None` → `{"value": None}` (dump with `model_dump(mode="json")`, which applies the serializer).
    - number: `{"value": 22.0}` → `{"value": 22}`; `{"value": "22"}` → `{"value": 22}`; `{"value": "22.5"}` → `{"value": 22.5}`; `{"value": 5, "unit": "g"}` on a field with `unit="mg"` → `{"value": 5, "unit": "g"}`; `{"value": 5}` → `{"value": 5, "unit": "mg"}`; double wrap `{"value": {"value": 22, "unit": "mg"}}` → `{"value": 22, "unit": "mg"}`.
    - select: `{"value": "dev"}` with options `{"dev": "Development only"}` → `{"value": "dev", "label": "Development only"}`; `{"value": "Yes"}` with `{"Yes": "Yes"}` → `{"value": "Yes"}` (no label); unknown code → no label; other → `{"value": "other", "other_text": "Registry"}`.
    - multiselect list and multiselect-other.
    - the three markers → `{"value": None, "absent_reason": code, "label": ABSENT_REASON_LABELS[code]}`.
    - truncation: a 120-char text with `text_cap=80` → 80 chars and `"truncated": True`.
    - `peel_envelope` direct cases: verification stripped; marker inside a double wrap found.
  - `tests/integration/mcp/test_mcp_get_extractions.py`, new `test_detailed_values_are_typed` (setup like `test_get_extractions_detailed_shape` ~L57, which uses `_built_review_run_template_id`): plant through the review service (or raw insert as that helper does) a null text value, a number `{"value": "22", "unit": "mg"}`, and a select code with a distinct label on the caller's own coordinates; call `get_extractions` with `response_format="detailed"`; the rows read `{"value": null}`, `{"value": 22, "unit": "mg"}`, `{"value": "<code>", "label": "<label>"}`; `"None"` and `"22.0"` appear nowhere in the JSON.
  - `test_mcp_result_shape.py`: unchanged; red until the untrusted paths are updated.

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/unit/test_mcp_value_render.py tests/unit/test_value_envelope.py tests/integration/mcp/test_mcp_get_extractions.py tests/integration/mcp/test_mcp_result_shape.py -q` → FAIL (new names missing).

- [ ] **Step 3: Implement** per Interfaces.

- [ ] **Step 4: Run green + gates.**
  ```bash
  cd "$WT/backend" && uv run pytest tests/unit tests/integration/mcp -q
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh
  cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  ```
  Expected: PASS (cap tests included); vulture green (`peel_envelope` is called by `resolve_value`, `_mcp_value` by the detailed loop). No REST schema changed.

- [ ] **Step 5: Commit.** `git -C "$WT" add backend && git -C "$WT" commit -m "feat(mcp): typed values with labels and units in get_extractions detailed rows"`

**Done when:** exports and MCP share one peel, detailed rows carry typed values with labels and units, untrusted paths are exact, every MCP test and cap test green.

---

### Task 2.5b: Typed concise cells, evidence truncation flag, option parity and summaries without "None"

**Layer:** backend · **Migration:** no · **Commit:** `feat(mcp): typed concise extraction cells and option parity with get_template`

**Goal:** `get_extractions` in `concise` format returns each cell as `values: list[McpValue]` (one per instance, in instance order) plus `values_truncated`, instead of one joined string; evidence quotes say when they were cut (`quote_truncated`); the tool description documents `McpValue`; the option codes `get_extractions` returns are always a subset of the `{value, label}` options `get_template` returns, with the same labels; the AI batch section summary never prints "None".

**Context:** `McpValue` (`backend/app/schemas/mcp_extractions.py`, Task 2.5a: `{value, label?, unit?, absent_reason?, other_text?, truncated?}`, absent keys omitted except `value`) and `_mcp_value(raw, field: _FieldInfo, *, text_cap: int) -> McpValue` (`backend/app/services/extraction_agent_read_service.py`) exist; detailed rows already use them. Concise cells still use `_short` (L201-211) and `join_capped` (`backend/app/utils/text_caps.py:41`, used nowhere else): `cells = [_concise_cell(group) for group in resolved_lists]; value_str = join_capped([_short(c.value, limit=_CONCISE_VALUE_CAP) for c in cells], sep=" | ", cap=_CONCISE_JOIN_CAP)` (~L668-692). `McpConciseCell` (L25): `value: str | None, ai_only: bool, disagreement: bool | None`; `McpEvidence` (L31): `quote: str, locator: str | None`, built in `_evidence_for` (~L365-389) as `ev.text_content[:_EVIDENCE_QUOTE_CAP]` (300). `McpExtractionsPage.untrusted_fields` holds `"articles[].values{}.value"`; `tests/integration/mcp/test_mcp_result_shape.py::test_untrusted_fields_declare_every_untrusted_string` requires the declared set to equal the untrusted string leaves exactly. `get_extractions` description: `backend/app/api/mcp/tools/extractions.py` L31-36. `get_template` question options are `[{value, label}]` (Task 2.1a-2a). Tool-result states `no_run`, `peer_values_hidden` and `blind_review` are unchanged; an empty coordinate is absent from the `values` map. Results stay ≤ 32,000 characters. `backend/app/services/ai_extraction/_batch.py::_summary` (L212-226) renders `f"{field_name}: {str(answer.get('value'))[:50]}"` for the first three answers, so a null or a marker prints "None".

**Files:**
- Modify: `backend/app/schemas/mcp_extractions.py` (`McpConciseCell`, `McpEvidence`, untrusted paths)
- Modify: `backend/app/services/extraction_agent_read_service.py` (concise loop; delete `_short`; `_evidence_for`)
- Modify: `backend/app/utils/text_caps.py` (delete `join_capped`, its only caller is gone) and its tests if any (`grep -rn "join_capped" "$WT/backend"`)
- Modify: `backend/app/api/mcp/tools/extractions.py` (description)
- Modify: `backend/app/services/ai_extraction/_batch.py` (`_summary`)
- Create: `backend/tests/integration/mcp/test_mcp_option_contract.py`
- Create: `backend/tests/unit/test_ai_batch_summary.py`
- Test: `backend/tests/integration/mcp/test_mcp_get_extractions.py`, `backend/tests/integration/mcp/test_mcp_result_shape.py`

**Interfaces:**
- `McpConciseCell`: `values: list[McpValue]`, `values_truncated: bool`, `ai_only: bool`, `disagreement: bool | None` (`value` removed). Build: `values` = `_mcp_value(c.value, info, text_cap=_CONCISE_VALUE_CAP)` per instance cell in instance order; stop adding when the running `len(compact_json(v.model_dump(mode="json")))` total would exceed `_CONCISE_JOIN_CAP` (1,000) and set `values_truncated=True`; else `False`.
- `McpEvidence`: `quote: str`, `quote_truncated: bool`, `locator: str | None`; `quote_truncated = len(ev.text_content) > _EVIDENCE_QUOTE_CAP`.
- `untrusted_fields`: replace `"articles[].values{}.value"` with `"articles[].values{}.values[].value"`, `"articles[].values{}.values[].label"`, `"articles[].values{}.values[].unit"`, `"articles[].values{}.values[].other_text"` (match the walker's spelling; run the shape test red first).
- Description, appended sentence: "Each value is {value, label?, unit?, absent_reason?, other_text?, truncated?}: value is the stored code or number (null when empty or marked absent); label is the option's display text when it differs from the code; absent_reason is no_information, not_applicable or not_evaluated."
- `_summary(entity_type, extracted)`: skip answers whose envelope value is `None` or that carry an `absent_reason` (use `value_semantics.value_absent_reason` and `unwrap_value_envelope`); when nothing is left, return `f"{name}: No data extracted"`; otherwise the first three remaining as today.

- [ ] **Step 1: Write the failing tests.**
  - `tests/integration/mcp/test_mcp_get_extractions.py`: update `test_get_extractions_concise_shape` (~L32) to read `article["values"][<field_id>]["values"]`; add `test_concise_values_are_typed`: the same planted values as the detailed test (null text, `"22"`+`mg`, a coded select) read `[{"value": null}]`, `[{"value": 22, "unit": "mg"}]`, `[{"value": "<code>", "label": "<label>"}]`; `values_truncated` is `false`; `"None"` appears nowhere. Add an evidence case: a 400-char evidence quote reads 300 characters with `quote_truncated: true`. Add `test_concise_values_truncate_on_many_instances`: in a repeating section, record enough instances on one field with ~80-char text values that their compact JSON exceeds 1,000 characters; the cell's `values` stops short of the instance count and `values_truncated` is `true`, and the page stays under the result cap. Keep the size-cap test (~L81) green.
  - New `tests/integration/mcp/test_mcp_option_contract.py` (fixtures `mcp_client`, `pat_primary_rw`, `db_session`; helpers `call_tool`, `structured` from `tests/integration/mcp/tool_calls.py`): for each of the seeded CHARMS (`fresh_charms(db_session)` in `tests/integration/helpers/template_fixtures.py`) and PROBAST+AI (clone with `clone_template(..., global_template_id=_PROBAST_AI_TEMPLATE_ID, kind=TemplateKind.QUALITY_ASSESSMENT)` from `app.seed_probast_ai` and republish, as `fresh_charms` does), open a run on `SEED.primary_article` in EXTRACT and record, as the primary reviewer through `ExtractionReviewService.record_decision`, the first option of every select field and the first two of every multiselect field (singleton sections only; skip repeating sections); then `get_template` (all pages) and `get_extractions` (`detailed`); assert every returned select/multiselect code is among that question's `options[].value`, and every returned `label` equals that option's `label`.
  - New `tests/unit/test_ai_batch_summary.py`: `_summary(SimpleNamespace(label="Participants", name="p"), {"a": {"value": None}, "b": {"value": None, "absent_reason": "no_information"}})` == `"Participants: No data extracted"`; `{"a": {"value": None}, "b": {"value": "x"}}` → `"Participants: b: x"`; no output contains `"None"`.

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/integration/mcp/test_mcp_get_extractions.py tests/integration/mcp/test_mcp_option_contract.py tests/integration/mcp/test_mcp_result_shape.py tests/unit/test_ai_batch_summary.py -q` → FAIL.

- [ ] **Step 3: Implement** per Interfaces; delete `_short` and `join_capped`.

- [ ] **Step 4: Run green + gates.**
  ```bash
  cd "$WT/backend" && uv run pytest tests/unit tests/integration/mcp -q
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh
  cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  ```
  Expected: PASS; cap tests green; vulture green (if `join_capped` was in `backend/.vulture_baseline`, remove its line in this task).

- [ ] **Step 5: Commit.** `git -C "$WT" add backend && git -C "$WT" commit -m "feat(mcp): typed concise extraction cells and option parity with get_template"`

**Done when:** concise and detailed formats both return typed values, the option-parity test passes for CHARMS and PROBAST+AI, evidence truncation is flagged, summaries never say "None", gates green.

---

### Task 2.6: Display names next to ids in MCP results and post-membership errors

**Layer:** backend · **Migration:** no · **Commit:** `feat(mcp): project and template names next to ids in results and errors`

**Goal:** an agent can tell the user which project and template it acted on without another call: write results and the article detail carry `project_name` (and `template_name` where a template is involved), each applied question carries its `section_label`, and refusals raised after membership is established carry the same names. Refusals that could leak existence (`NOT_FOUND`, `SCOPE_INSUFFICIENT`, `RATE_LIMITED`, anything before membership) carry no name, so a foreign resource stays byte-identical to a missing one.

**Context:** names appear once per result, never per row, are capped with `app.utils.text_caps.cap_text(value, cap=TITLE_CAP) -> (str, bool)` (`backend/app/utils/text_caps.py:19`), and are listed in `untrusted_fields` (they are user-entered text). `tests/integration/mcp/test_mcp_result_shape.py::test_untrusted_fields_declare_every_untrusted_string` requires each result's declared `untrusted_fields` to equal its untrusted string leaves exactly. Tool errors use `McpToolError(code, message, *, next_step=None, **extras)` (`backend/app/api/mcp/errors.py:115-129`); extras render through `McpToolErrorPayload` (`extra="allow"`). `app/api/**` must not import `app.models` (`scripts/fitness/check_layered_arch.py`), so a name lookup is a service function. `api/mcp/audit.refuse(db, scope, error)` (`audit.py:42`) rolls the session back first, which expires ORM attributes: read every name into a local before building the error. Current code:
- `api/mcp/server.py::_dispatch` (L249-279): membership → `principal.reaches` → `MANAGER_REQUIRED` (`"Only a project manager can do this."`) for a write by a non-manager.
- `schemas/mcp_project_details.py:11` `UpdateProjectDetailsResult` (`untrusted_fields=["before{}","after{}"]`); `tools/project_details.py` success at L91-96, `STALE_VALUE` refusal at L71-82 (extras `current=..., untrusted_content=True, untrusted_fields=["current{}"]`).
- `schemas/mcp_template_draft.py` `AppliedQuestion` (L64: `op_index, op, field_id, section_id, name, label`) and `EditTemplateDraftResult` (L75); `tools/template_draft.py`: `owned_template(...)` at L130 (`template.name` available), refusals after it (`_parse_ops`: TOO_MANY_OPS/INVALID_ARGUMENT/OP_NOT_ALLOWED_VIA_AGENT; `_assert_baseline` L245-257: NO_PUBLISHED_VERSION/NARROW_BASELINE; `DraftLockHeldError` → DRAFT_LOCK_HELD at L155-166 with `holder_name`, `untrusted_fields=["holder_name"]`; `DraftOpError` → `_op_failure` L260-276; deadlock → RETRY L172-179), `AppliedQuestion` built at L185-192 from `AppliedDraftOp.field` (a `TemplateFieldRead`; `section_id=a.field.entity_type_id`).
- `schemas/mcp_articles.py:68` `McpArticleDetail` (built by `services/article_list_read_service.get_article_detail` :175, which selects `Article`; `Article.project` is a relationship).
- `schemas/mcp_extractions.py` `McpExtractionsPage` (L58); `tools/extractions.py` has `template = await owned_template(...)` (L52) before `list_agent_extractions(...)`.

**Files:**
- Modify: `backend/app/services/project_read_service.py` (new `project_name`)
- Modify: `backend/app/api/mcp/server.py` (`MANAGER_REQUIRED` extras)
- Modify: `backend/app/schemas/mcp_project_details.py`, `backend/app/api/mcp/tools/project_details.py`
- Modify: `backend/app/schemas/mcp_template_draft.py`, `backend/app/api/mcp/tools/template_draft.py`, `backend/app/services/agent_template_draft_service.py` (section label on `AppliedDraftOp`)
- Modify: `backend/app/schemas/mcp_articles.py`, `backend/app/services/article_list_read_service.py`
- Modify: `backend/app/schemas/mcp_extractions.py`, `backend/app/api/mcp/tools/extractions.py`, `backend/app/services/extraction_agent_read_service.py` (`list_agent_extractions(..., template_name: str)`)
- Test: `backend/tests/integration/mcp/test_mcp_update_project_details.py`, `test_mcp_edit_template_draft.py`, `test_mcp_article_tools.py`, `test_mcp_get_extractions.py`, `test_mcp_choke_point.py`, `test_mcp_bola.py`, `test_mcp_result_shape.py`; `backend/tests/integration/test_project_read_service.py` (create if absent) for the service function

**Interfaces:**
- Produces: `async def project_name(db: AsyncSession, project_id: UUID) -> str` in `project_read_service.py` (one `select(Project.name).where(Project.id == project_id)`). Docstring: "Callers MUST have proven membership first (the MCP dispatch choke point does); this is not an ownership guard and must never answer an unauthenticated or non-member request." `app/api/**` cannot read models, so it lives in the service layer; its only callers are the MCP dispatch path and the MCP tools.
- Name extras on errors: `project_name=<capped>` (+ `template_name=<capped>` when a template is named), and `untrusted_content=True` with `untrusted_fields` = the existing list plus `"project_name"` (and `"template_name"`). Applies to: `MANAGER_REQUIRED` (`_dispatch`: `name = await project_name(db, project_id)` after the membership and `reaches` checks); `STALE_VALUE` (and the other refusals in `project_details.py` raised after the tool's own reads); in `template_draft.py` every refusal raised after `owned_template` succeeded — `DRAFT_LOCK_HELD`, `NARROW_BASELINE`, `NO_PUBLISHED_VERSION`, `INVALID_ARGUMENT`, `OP_NOT_ALLOWED_VIA_AGENT`, `TOO_MANY_OPS`, `FIELD_NOT_EDITABLE`, `DUPLICATE_NAME`, `RETRY`. A `NOT_FOUND` stays name-free everywhere. Read the names into locals right after `owned_template` (template name) and `project_name(...)`, before any `refuse`.
- Results: `UpdateProjectDetailsResult.project_name: str`; `EditTemplateDraftResult.project_name: str`, `.template_name: str`; `AppliedQuestion.section_label: str` (the owning entity type's label; `AppliedDraftOp` gains `section_label: str`, filled in `_add`/the update op from the section row the service already loads); `McpArticleDetail.project_name: str`; `McpExtractionsPage.template_name: str`. Each result's `untrusted_fields` adds `"project_name"`, `"template_name"`, `"applied[].section_label"` as applicable.

- [ ] **Step 1: Write the failing tests.**
  - `test_mcp_update_project_details.py`: a successful update's `project_name` equals `SELECT name FROM projects WHERE id = :pid`; the stale-value refusal (~L213) carries the same `project_name`, and its `untrusted_fields` becomes `["current{}", "project_name"]`.
  - `test_mcp_edit_template_draft.py`: success has `project_name` and `template_name` equal to the DB rows and each `applied[].section_label` equals the section's label; `test_draft_lock_held` (~L223) now asserts `payload["untrusted_fields"] == ["holder_name", "project_name", "template_name"]` and the two names; the no-published (~L457) and narrow (~L487) refusals carry both names; a `NOT_FOUND` for a foreign template carries neither.
  - `test_mcp_article_tools.py`: `get_article` detail `project_name` equals the article's project name.
  - `test_mcp_get_extractions.py`: `template_name` equals the template row's name.
  - `test_mcp_choke_point.py` (`test_reviewer_is_manager_required_for_write` ~L103, uses `probe_write`): the payload has `project_name` equal to the project's name.
  - `test_mcp_bola.py`: add `test_foreign_not_found_is_byte_identical_to_missing`: for `edit_template_draft` and `update_project_details`, the full `error_payload(result)` (compact JSON) for a foreign project/template equals the payload for a random uuid.
  - `test_mcp_edit_template_draft.py`, `test_post_membership_refusals_carry_names` parametrized over at least `INVALID_ARGUMENT` (an `add_question` with a bad type) and `FIELD_NOT_EDITABLE`/`OP_NOT_ALLOWED_VIA_AGENT` (whichever the existing tests already trigger — reuse their arguments): each payload carries `project_name` and `template_name` and lists both in `untrusted_fields`. For `update_project_details`, the same for its `FIELD_NOT_EDITABLE` refusal.
  - A name longer than `TITLE_CAP` is capped in one result (plant a long project name inside the test transaction).

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/integration/mcp -q` → FAIL on the new assertions.

- [ ] **Step 3: Implement** per Interfaces. Run `cd "$WT" && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/check_layered_arch.py` after editing `server.py`.

- [ ] **Step 4: Run green + gates.**
  ```bash
  cd "$WT/backend" && uv run pytest tests/unit tests/integration/mcp tests/integration/test_project_read_service.py -q
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh
  cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  ```
  Expected: PASS (cap and shape tests included); `tests/unit/test_mcp_errors.py` code count unchanged (no new code).

- [ ] **Step 5: Commit.** `git -C "$WT" add backend && git -C "$WT" commit -m "feat(mcp): project and template names next to ids in results and errors"`

**Done when:** every listed result and post-membership refusal carries capped, untrusted-declared names, foreign and missing stay byte-identical, gates green.

---

### Task 2.7a: Agent template edits on a blank template; specific refusal reasons

**Layer:** backend · **Migration:** no · **Commit:** `feat(mcp): agent draft edits apply on a blank published template`

**Goal:** the agent's `edit_template_draft` applies on a template whose published version is empty (a blank template a manager is building) as long as no run is pinned to that empty version. It is refused, with a reason and a fix that name the case, when the empty version is pinned by a run (`pinned_empty_version`) or the published snapshot predates the wide snapshot format (`legacy_snapshot`).

**Context:** `backend/app/services/extraction_snapshot.py`: `snapshot_is_narrow(entity_types) -> bool` (L154-191; an EMPTY list counts as narrow on purpose, so run views fall back to live rows) and `baseline_is_restorable(schema_)` (L194-210) — both unchanged. `backend/app/services/agent_template_draft_service.py`: `class NarrowBaselineError(Exception)` (L52-53, no reason) and `assert_isolated_baseline(db, *, template_id)` (L75-87: active version via `ExtractionTemplateVersionRepository(db).get_active(template_id)`, `NoActiveTemplateVersionError` when none, `NarrowBaselineError` when `snapshot_is_narrow(...)`). Do not confuse it with the unrelated `template_versioning/_discard.NarrowBaselineError`. `backend/app/api/mcp/tools/template_draft.py::_assert_baseline` (L245-257) maps it to `McpToolError(McpErrorCode.NARROW_BASELINE, "Publish this template once in prumo, then retry.")`; `McpToolError(code, message, *, next_step=None, **extras)` accepts a per-error `next_step` that overrides the static per-code table in `api/mcp/errors.py` (L74, unchanged: `"publish once in prumo, then retry"`). `NARROW_BASELINE` is in `AUDITED_CODES` (a refusal writes one refused `agent_actions` row). `ExtractionRun` has `version_id` (`backend/app/models/extraction.py` ~L695). Seed facts: `SEED.primary_template`'s active v1 schema is `{"entity_types": []}` and the seed inserts no run (`tests/integration/conftest.py` ~L412-424), so two existing tests that expect a refusal for it will flip and must pin a run or force a legacy snapshot. `app/api/**` must not import `app.models`.

**Files:**
- Modify: `backend/app/services/extraction_snapshot.py` (new `baseline_isolated_for_agent`, next to `baseline_is_restorable`)
- Modify: `backend/app/services/agent_template_draft_service.py` (`NarrowBaselineError.reason`; `assert_isolated_baseline`)
- Modify: `backend/app/api/mcp/tools/template_draft.py` (`_assert_baseline` message and `next_step` per reason)
- Test: `backend/tests/unit/test_extraction_snapshot_baseline.py` (create if absent), `backend/tests/integration/test_agent_template_draft_service.py`, `backend/tests/integration/mcp/test_mcp_edit_template_draft.py`

**Interfaces:**
- Produces: `def baseline_isolated_for_agent(entity_types: list[dict[str, Any]], *, pinned_run_exists: bool) -> bool` — non-narrow → `True`; empty and no run pinned → `True`; anything else → `False`.
- Produces: `NarrowBaselineError(reason: Literal["pinned_empty_version", "legacy_snapshot"])` with `.reason`; message names the reason.
- `assert_isolated_baseline`: `entity_types = (active.schema_ or {}).get("entity_types") or []`; `pinned = (await db.execute(select(exists().where(ExtractionRun.version_id == active.id)))).scalar_one()`; when `not baseline_isolated_for_agent(entity_types, pinned_run_exists=pinned)`: raise `NarrowBaselineError("pinned_empty_version" if not entity_types else "legacy_snapshot")`.
- `_assert_baseline` maps by reason:
  - `pinned_empty_version` → message "The published version of this template is empty and a run is pinned to it." and `next_step="publish the current draft in prumo so runs move to a version with questions, then retry"`.
  - `legacy_snapshot` → message "The published version of this template uses an older format." and `next_step="publish once in prumo to refresh the published version, then retry"`.

- [ ] **Step 1: Write the failing tests.**
  - Unit `test_extraction_snapshot_baseline.py`: `baseline_isolated_for_agent([], pinned_run_exists=False) is True`; `([], pinned_run_exists=True) is False`; a wide entity list (`[{"cardinality": "one", "fields": [{"llm_description": None, "allow_other": False}]}]`) → `True` either way; a legacy list (`[{"fields": []}]`, no `cardinality`) → `False` either way.
  - `tests/integration/test_agent_template_draft_service.py` (helpers `fresh_charms`, `force_narrow_baseline`, `add_section`, `add_field` in `tests/integration/helpers/template_fixtures.py`):
    - `test_blank_template_accepts_agent_add_question`: on `SEED.primary_template` (empty active v1, no run), a manager-added unpublished section (`add_section`); the agent service's `add_question` op applies and the new field appears in the draft diff for that template.
    - `test_run_pinned_to_empty_version_is_refused`: same template plus a run whose `version_id` is the empty active version (create with `run_in_extract`-style helpers from `tests/integration/helpers/engine_setup.py`, or `UPDATE public.extraction_runs SET version_id = :vid` on one); the op raises `NarrowBaselineError` with `reason == "pinned_empty_version"` and zero fields are written.
    - Update `test_baseline_narrow_refused_for_seeded_primary_template` (~L40-45): use `force_narrow_baseline(...)` on a `fresh_charms` template so it still exercises the `legacy_snapshot` refusal (`reason == "legacy_snapshot"`).
  - `tests/integration/mcp/test_mcp_edit_template_draft.py::test_narrow_baseline_refused` (~L487-522): set up a legacy snapshot with `force_narrow_baseline`; assert `payload["code"] == "NARROW_BASELINE"`, the message names the older format, `payload["next_step"]` is the `legacy_snapshot` fix; keep its no-label-change, no-lock-holder and one-refused-audit-row checks. Add a pinned-empty case asserting the `pinned_empty_version` message and `next_step`.

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/unit/test_extraction_snapshot_baseline.py tests/integration/test_agent_template_draft_service.py tests/integration/mcp/test_mcp_edit_template_draft.py -q` → FAIL.

- [ ] **Step 3: Implement** per Interfaces.

- [ ] **Step 4: Run green + gates.**
  ```bash
  cd "$WT/backend" && uv run pytest tests/unit tests/integration/test_agent_template_draft_service.py tests/integration/mcp -q
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh
  cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  ```
  Expected: PASS; `test_mcp_audit.py` and `test_mcp_errors.py` unchanged and green.

- [ ] **Step 5: Commit.** `git -C "$WT" add backend && git -C "$WT" commit -m "feat(mcp): agent draft edits apply on a blank published template"`

**Done when:** a blank, unpinned template accepts agent edits; a pinned empty version and a legacy snapshot are refused with their own message and fix; gates green.

---

### Task 2.7b: The instruction save takes the template draft lock

**Layer:** backend + frontend · **Migration:** no · **Commit:** `feat(templates): saving the AI instruction takes the draft lock`

**Goal:** saving a template's general AI instruction claims the template draft lock like every structural edit does. While another manager holds the lock the save is refused with 409 `DRAFT_LOCK_HELD` and the holder's details; the instruction pane shows an error toast with the server's message, keeps the typed draft, and refreshes the configuration status so the chip shows "Being edited by {who}".

**Context:** `backend/app/services/template_draft_lock_service.py::claim_draft_lock(db, *, project_id: UUID, template_id: UUID, user_id: UUID) -> None` (L81-130; one conditional UPDATE; a missing template raises `ProjectTemplateNotFoundError`; a lock held by someone else raises `DraftLockHeldError(AppError)` with code `DRAFT_LOCK_HELD`, status 409, `details={"holder_id", "holder_name"}`, rendered by the global AppError handler). `backend/app/api/v1/endpoints/template_structure.py` claims it first in each structural endpoint through a private `_claim_lock` helper (L83-101). The instruction endpoint `backend/app/api/v1/endpoints/project_templates.py::update_template_llm_instruction` (L361-391) has `_user_sub: UUID = Depends(require_project_manager)`, no `responses=`, and maps `ProjectTemplateNotFoundError` → 404 around `set_template_instruction(...)`. A 409 declaration to copy: the take-over route in the same file (~L738-745): `responses={status.HTTP_409_CONFLICT: {"model": TemplateDraftLockRefusalResponse, "description": "Refused: draft lock conflict"}}` (`TemplateDraftLockRefusalResponse` already imported ~L60). Frontend: `frontend/components/extraction/TemplateInstructionPane.tsx` `save()` (L57-69; `onError: () => { toast.error(t("extraction", "errors_saveInstruction")); }`; the draft lives in the host and is cleared only on success); `frontend/hooks/extraction/useTemplateInstruction.ts::useUpdateTemplateInstruction` invalidates `templateInstructionKeys.byTemplate` and `templateConfigStatusKeys.byTemplate` (`frontend/lib/query-keys/extraction.ts:66-70`) on success only; `t(ns, key)` has no interpolation; the chip copy `templateConfig.draftHeldBy: 'Being edited by {{who}}'` renders from `configStatus.draft_holder_name`. `apiClient` throws `ApiError(code, message, status, ...)`. Coverage: an endpoint body reached only through `db_client` (httpx ASGITransport) records no coverage, so the endpoint also gets a direct unit test.

**Files:**
- Modify: `backend/app/api/v1/endpoints/project_templates.py`
- Modify: `frontend/components/extraction/TemplateInstructionPane.tsx`
- Modify: `frontend/hooks/extraction/useTemplateInstruction.ts`
- Test: `backend/tests/integration/test_template_draft_lock.py`, `backend/tests/unit/test_project_templates_instruction_endpoint_unit.py` (new; pattern `tests/unit/test_personal_access_tokens_endpoint_unit.py`), `frontend/test/components/TemplateInstructionPane.test.tsx`
- Regenerate: `frontend/types/api/schema.d.ts`, `frontend/types/api/openapi.json` (new declared response)

**Interfaces:**
- Endpoint: rename `_user_sub` → `user_sub`; add the 409 `responses=` declaration; inside the existing `try`: `await claim_draft_lock(db, project_id=project_id, template_id=template_id, user_id=user_sub)` then `set_template_instruction(...)`. `DraftLockHeldError` propagates to the handler (409 envelope with `details.holder_id`/`holder_name`).
- `useUpdateTemplateInstruction`: `onError` invalidates `templateConfigStatusKeys.byTemplate(projectId, templateId)`.
- Pane `onError: (err) => toast.error(\`${t('extraction', 'errors_saveInstruction')}: ${err instanceof Error && err.message ? err.message : ''}\`.replace(/: $/, ''))` — the base copy alone when there is no message; never clears the draft.

- [ ] **Step 1: Write the failing tests.**
  - `tests/integration/test_template_draft_lock.py` (existing helpers `_seed_other_profile` ~L45, `fresh_charms`; add an HTTP auth override like `tests/integration/test_template_structure_endpoints.py::auth_as_profile` — move that fixture to `tests/integration/conftest.py` if both files now need it):
    - `test_instruction_put_refused_while_another_manager_holds_the_lock`: `other` claims the lock via `claim_draft_lock`; PUT `/api/v1/projects/{project_id}/templates/{template_id}/llm-instruction` as `SEED.primary_profile` with `{"llm_template_instruction": "x"}` → 409, `error.code == "DRAFT_LOCK_HELD"`, `error.details.holder_id == str(other)`, `error.details.holder_name == other_name`; the stored instruction is unchanged.
    - `test_instruction_put_by_lock_holder_succeeds`: the primary profile claims the lock, PUT → 200, the instruction is stored.
  - Unit: call `update_template_llm_instruction` directly (or `.__wrapped__` if decorated) with mocked `claim_draft_lock`/`set_template_instruction` and assert the claim runs before the write with `user_id=user_sub`.
  - `frontend/test/components/TemplateInstructionPane.test.tsx` (existing mocks of `@/services/templateInstructionService`, `sonner`, `@/lib/copy` as `t: (_ns, key) => key`; `Host` holds the draft): `updateTemplateInstruction` resolves to a failed result carrying `new ApiError('DRAFT_LOCK_HELD', 'Being edited by Ana', 409)`; after Save, `toast.error` was called with `'errors_saveInstruction: Being edited by Ana'`, the textarea still shows the typed draft, and the query client's `invalidateQueries` was called with `templateConfigStatusKeys.byTemplate('p1','t1')` (spy on the client the test creates).

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/integration/test_template_draft_lock.py tests/unit/test_project_templates_instruction_endpoint_unit.py -q` and `cd "$WT" && npx vitest run frontend/test/components/TemplateInstructionPane.test.tsx` → FAIL.

- [ ] **Step 3: Implement** per Interfaces; `cd "$WT" && npm run generate:api-types`.

- [ ] **Step 4: Run green + gates.**
  ```bash
  cd "$WT/backend" && uv run pytest tests/unit tests/integration/test_template_draft_lock.py tests/integration/test_template_instruction*.py -q
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh
  cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  cd "$WT" && npm run test:run && npm run typecheck && npm run lint && npx knip && npx knip --production
  ```
  Expected: PASS; `check_response_descriptions.py` and `check_api_response_envelope.py` green.

- [ ] **Step 5: Commit.** `git -C "$WT" add backend frontend && git -C "$WT" commit -m "feat(templates): saving the AI instruction takes the draft lock"`

**Done when:** the instruction PUT takes the lock (409 with holder details otherwise), the pane toasts the server message, keeps the draft and refreshes the status chip, types regenerated, gates green.

---

### Task 2.8a-1: QA rules frozen into template version snapshots (migration 0085)

**Layer:** backend · **Migration:** yes (`0085_freeze_qa_rules`) · **Commit:** `feat(templates): freeze QA derivation and scope rules into each template version`

**Goal:** a template version snapshot carries the template's quality-assessment rules — `derived_judgments` and `scope_rules` — when the template declares them, so a later re-import that changes the rules cannot change what runs pinned to older versions compute. Existing versions get the rules their template holds today (no new versions are created). A template without rules gets no new keys and no phantom version.

**Context:** the rules live in `project_extraction_templates.schema` (`ProjectExtractionTemplate.schema_`, `backend/app/models/extraction.py:237`, JSONB): `derived_judgments` (a list) and `scope_rules` (an object), set only for PROBAST+AI today (`backend/app/seed_probast_ai.py:725-728`); readers `derived_judgment_service.derived_spec(template_schema)` and `_scope_rules(template_schema)` (`backend/app/services/derived_judgment_service.py:384, 483`) take a dict shaped like that schema. `backend/app/services/extraction_snapshot.py::build_template_version_snapshot(db, project_template_id)` (L140-151) runs `SNAPSHOT_SQL`, then appends `llm_template_instruction` only when non-empty (the module docstring L1-22 explains the conditional-key precedent: absent ≡ empty, so a legacy template's next republish stays byte-identical). The `_LIVE_INSTRUCTION_SQL` WARNING (L103-108) says the instruction is the ONLY template-level key and that `template_versioning/_clone._refuse_if_instruction_draft_pending` (`_clone.py:176-218`) depends on it; rules are not draft-editable (they change only by re-import from the global catalogue), so that guard needs no extension, but both texts must say so. `TemplateVersionService.republish` short-circuits when the active snapshot equals the fresh one (`_publish.py` ~L255). Migration precedent: `backend/alembic/versions/0026_widen_template_snapshot.py` (one self-contained `op.execute` UPDATE). Data-migration test precedent: `tests/integration/test_migration_0068_seeded_entry_nouns.py` (`load_migration(...)` from `tests.integration.helpers.migrations`, runs the module's `UPGRADE_SQL` inside the savepoint-isolated `db_session`; the statement is table-wide, so assert per row on rows the test creates).

**Migration rules (apply exactly):** confirm the number first: `ls "$WT/backend/alembic/versions" | grep '^0' | sort | tail -1` must print `0084_canonical_field_options.py`. File `backend/alembic/versions/0085_freeze_qa_rules.py`, `revision = "0085_freeze_qa_rules"` (20 chars), `down_revision = "0084_canonical_field_options"`. Move `expected_head` in `backend/tests/integration/test_migration_roundtrip.py::test_alembic_head_is_expected_revision` to `"0085_freeze_qa_rules"` and add a roundtrip test there. Self-contained SQL, no app imports, no seed data. After the task: `cd "$WT/backend" && uv run alembic upgrade head` once on the test database.

**Files:**
- Modify: `docs/reference/extraction-hitl-architecture.md` (section 3, the "Migration head:" line ~L138 → `0085_freeze_qa_rules`; frontmatter `last_reviewed:` → the commit date) — required for every migration touching `extraction_*`
- Create: `backend/alembic/versions/0085_freeze_qa_rules.py`
- Create: `backend/tests/integration/test_migration_0085_freeze_qa_rules.py`
- Modify: `backend/tests/integration/test_migration_roundtrip.py`
- Modify: `backend/app/services/extraction_snapshot.py` (`build_template_version_snapshot`; module docstring; `_LIVE_INSTRUCTION_SQL` WARNING)
- Modify: `backend/app/services/template_versioning/_clone.py` (`_refuse_if_instruction_draft_pending` docstring only)
- Test: `backend/tests/integration/test_template_version_snapshot_shape.py`

**Interfaces:**
- `build_template_version_snapshot`: after the instruction, read `SELECT schema FROM public.project_extraction_templates WHERE id = :tid` once (fold it into the existing `_LIVE_INSTRUCTION_SQL` select if simpler: `SELECT llm_template_instruction, schema ...`); for `key in ("derived_judgments", "scope_rules")`: `value = (schema or {}).get(key)`; when `value` is truthy (a non-empty list/object), `snapshot[key] = value`.
- Migration module constants: `UPGRADE_SQL` — one `UPDATE public.extraction_template_versions v SET schema = v.schema || <object holding each missing key whose template value is non-empty> FROM public.project_extraction_templates t WHERE v.project_template_id = t.id AND (<a key is missing in v and non-empty in t>)`; "non-empty" = `t.schema -> key IS NOT NULL AND t.schema -> key NOT IN ('null'::jsonb, '[]'::jsonb, '{}'::jsonb)`. A version that already has a key keeps its own value. `DOWNGRADE_SQL` — `UPDATE public.extraction_template_versions SET schema = schema - 'derived_judgments' - 'scope_rules' WHERE schema ? 'derived_judgments' OR schema ? 'scope_rules'` (documented in the module docstring: the downgrade strips the keys from every version, including ones published after this revision, which the pre-0085 code never reads; a later re-upgrade backfills those versions from the template's rules at that time, not the rules they were published with — accepted, the downgrade is a dev/rollback path only). No trigger toggle is needed (`extraction_template_versions` carries no draft trigger; confirm with `SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.extraction_template_versions'::regclass AND NOT tgisinternal`).

- [ ] **Step 1: Write the failing tests.**
  - `tests/integration/test_template_version_snapshot_shape.py` (instruction-key precedent ~L118-141: absent when NULL, present after an UPDATE on `SEED.primary_template`, no commit):
    - `test_rules_keys_absent_when_template_declares_none`: `snapshot = await build_template_version_snapshot(db_session, SEED.primary_template)`; neither key in `snapshot`.
    - `test_rules_keys_present_when_declared`: `UPDATE public.project_extraction_templates SET schema = '{"derived_judgments":[{"x":1}],"scope_rules":{"a":1}}'::jsonb WHERE id = :tid`; both keys equal the planted values; with `'{"derived_judgments":[],"scope_rules":{}}'` neither key appears.
    - `test_template_without_rules_gets_no_new_version`: on a `fresh_charms` template (no rules), `republish` twice → the version count is unchanged by the second call.
  - New `tests/integration/test_migration_0085_freeze_qa_rules.py` (`_mig = load_migration("0085_freeze_qa_rules.py")`): plant rules on a `fresh_charms` template and strip them from its active version (`UPDATE ... SET schema = schema - 'derived_judgments' - 'scope_rules'`); run `_mig.UPGRADE_SQL`; the version now holds the template's rules; a second version that already had its own `scope_rules` keeps them; the count of `extraction_template_versions` rows is unchanged; a second run has `rowcount == 0`.
  - `tests/integration/test_migration_roundtrip.py`: `expected_head = "0085_freeze_qa_rules"`; `test_migration_0085_freeze_qa_rules_roundtrip(migration_db_url)`: downgrade to `0084_canonical_field_options`, upgrade to head, `alembic current` shows `0085_freeze_qa_rules`.

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/integration/test_template_version_snapshot_shape.py tests/integration/test_migration_0085_freeze_qa_rules.py tests/integration/test_migration_roundtrip.py -q` → FAIL.

- [ ] **Step 3: Implement** the snapshot change and the migration (`upgrade()` = `op.execute(UPGRADE_SQL)`, `downgrade()` = `op.execute(DOWNGRADE_SQL)`; module docstring: what is copied, that no version is created, that existing keys win). Update the module docstring of `extraction_snapshot.py` (two more conditional keys, same absent ≡ empty rule, backfilled by 0085), the `_LIVE_INSTRUCTION_SQL` WARNING (the instruction is the only DRAFT-EDITABLE template-level key; the rules keys change only by re-import, which refreshes and republishes them) and the `_refuse_if_instruction_draft_pending` docstring (same fact).

- [ ] **Step 4: Run green + gates.**
  ```bash
  cd "$WT/backend" && uv run alembic upgrade head && uv run pytest tests/unit \
    tests/integration/test_template_version_snapshot_shape.py tests/integration/test_migration_0085_freeze_qa_rules.py \
    tests/integration/test_migration_roundtrip.py tests/integration/test_template_version_republish.py -q
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh \
    && bash scripts/fitness/check_migration_split.sh
  cd "$WT/backend" && uv run alembic check && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  ```
  Expected: PASS; `alembic check` no diff.

- [ ] **Step 5: Commit.** `git -C "$WT" add backend docs && (cd "$WT" && bash scripts/docs/check-frontmatter.sh) && git -C "$WT" commit -m "feat(templates): freeze QA derivation and scope rules into each template version"`

**Done when:** new snapshots carry declared rules only, 0085 backfills existing versions without creating any, roundtrip and head pin pass, gates green.

---

### Task 2.8a-2: Run view, finalize gate and AI field filter read the run's pinned QA rules

**Layer:** backend · **Migration:** no · **Commit:** `feat(qa): runs read the QA rules of the version they are pinned to`

**Goal:** everything that evaluates QA rules for one run — the run view's derived judgments (plus a new `scope_rules` field on the run view), the finalize divergence gate, and the AI extraction field filter — reads the rules frozen in the run's pinned template version, never the template's live schema.

**Context:** since Task 2.8a-1 each template version snapshot (`extraction_template_versions.schema`) carries `derived_judgments` and/or `scope_rules` when its template declares them (absent ≡ none). `ExtractionRun.version_id` is non-null (`backend/app/models/extraction.py` ~L695). Rule readers take a dict shaped like a template schema: `derived_judgment_service.derived_spec(template_schema)` and `_scope_rules(template_schema)` (`backend/app/services/derived_judgment_service.py:384, 483`). Live-schema reads to replace:
- `backend/app/services/extraction_run_read_service.py` L425-439: for QA runs, `template = await db.get(ProjectExtractionTemplate, detail.run.template_id)` then `build_derived_judgments_payload(template_schema=template.schema_ ...)`; `RunViewResponse(...)` built ~L459-475.
- `backend/app/schemas/extraction_run.py` `RunViewResponse` (L366-396; `derived_judgments` L385, `general_instructions` L390).
- `backend/app/services/qa_divergence_gate.py::divergence_rationale_failure(db, run)` (L66+; docstring says it reads the live `schema_`; body `template = await db.get(ProjectExtractionTemplate, run.template_id); schema = getattr(template, "schema_", None)`); module docstring L1-18.
- `backend/app/services/llm_field_filter.py`: docstring L7 ("declared data on the template's live `schema`"); `llm_field_filter_of(template: ProjectExtractionTemplate | None) -> LlmFieldFilter` (L46-57, reads `template.schema_`); `build_llm_field_filter(db, run)` (L60-65, `llm_field_filter_of(await db.get(ProjectExtractionTemplate, run.template_id))` then `_warn_orphaned_exclusions` against live fields).
- Callers: `backend/app/services/ai_extraction/landing.py` `_gate()` (~L277-293: re-reads the template with `populate_existing=True` under the run lock and returns `run, llm_field_filter_of(template)`); `backend/app/services/ai_extraction/_pipeline.py` `field_filter(run)` (~L236-242, memoised `build_llm_field_filter(self.db, run)`).
- Precedent reader: `general_instructions_for_version(db, version_id)` in `backend/app/services/extraction_snapshot.py` (L117-137).
A REST schema change ⇒ `npm run generate:api-types` in the same task. `HITLArticleTable.tsx` (a dashboard over the active template) intentionally stays on live rules.

**Files:**
- Modify: `backend/app/services/extraction_snapshot.py` (new `pinned_template_rules`)
- Modify: `backend/app/services/extraction_run_read_service.py`
- Modify: `backend/app/schemas/extraction_run.py` (`RunViewResponse.scope_rules`)
- Modify: `backend/app/services/qa_divergence_gate.py`
- Modify: `backend/app/services/llm_field_filter.py`, `backend/app/services/ai_extraction/landing.py`, `backend/app/services/ai_extraction/_pipeline.py`
- Create: `backend/tests/integration/test_qa_rules_frozen.py`
- Test: `backend/tests/unit/test_qa_divergence_gate.py`, `backend/tests/unit/test_run_view_derived_judgments.py` (keep green; add a pinned-rules case only if they gain a seam), any `llm_field_filter` unit test (`grep -rln "llm_field_filter_of" "$WT/backend/tests"`)
- Regenerate: `frontend/types/api/schema.d.ts`, `frontend/types/api/openapi.json`

**Interfaces:**
- Produces: `async def pinned_template_rules(db: AsyncSession, version_ids: Iterable[UUID]) -> dict[UUID, dict[str, Any]]` — one `SELECT id, schema -> 'derived_judgments', schema -> 'scope_rules' FROM public.extraction_template_versions WHERE id = ANY(:ids)`; each value is `{"derived_judgments": ..., "scope_rules": ...}` holding only the keys present; a version without rules maps to `{}`; an unknown id is absent from the result (callers use `.get(vid, {})`).
- `RunViewResponse.scope_rules: dict[str, Any] | None = Field(default=None, description="Scope rules frozen in the run's pinned template version (QA runs only).")` — the pinned `scope_rules` for QA runs, `None` otherwise. It stays a dict: the rules shape is declared seed data with no Pydantic model today (backend readers go through `derived_judgment_service._scope_rules`, frontend through `lib/qa/studyTypeScope.ts`); modelling it is a separate change. Say so in a one-line comment on the field.
- Run view: `rules = (await pinned_template_rules(db, [detail.run.version_id])).get(detail.run.version_id, {})`; `build_derived_judgments_payload(template_schema=rules, ...)`; `scope_rules=rules.get("scope_rules")` for QA runs.
- Gate: `schema = (await pinned_template_rules(db, [run.version_id])).get(run.version_id, {})`; docstring updated to "Reads the rules frozen in the run's pinned version".
- `llm_field_filter_of(template_schema: dict[str, Any] | None) -> LlmFieldFilter` (takes the rules dict); `build_llm_field_filter(db, run)` reads `pinned_template_rules` for `run.version_id` (and keeps `_warn_orphaned_exclusions`); `landing._gate()` keeps the run lock and passes the pinned rules for the locked run's `version_id` (drop the template re-read if nothing else in `_gate` uses it). Module docstring L7: "declared data frozen in the run's pinned template version".

- [ ] **Step 1: Write the failing tests.** New `tests/integration/test_qa_rules_frozen.py`. Shared setup `_pinned_qa_run(db)`: clone the PROBAST+AI global into `SEED.primary_project` (`clone_template(db, project_id=SEED.primary_project, global_template_id=_PROBAST_AI_TEMPLATE_ID, user_id=SEED.primary_profile, kind=TemplateKind.QUALITY_ASSESSMENT)`; `_PROBAST_AI_TEMPLATE_ID` from `app.seed_probast_ai`); republish so v1 holds the seeded rules (call them RULES_OLD); `run = await run_in_extract_at(db, project_id=SEED.primary_project, article_id=SEED.primary_article, template_id=<clone id>)` (`tests/integration/helpers/engine_setup.py`); then change the clone's LIVE `schema` to RULES_NEW (a modified copy of RULES_OLD) directly (`UPDATE public.project_extraction_templates SET schema = :r2 WHERE id = :tid`) where RULES_NEW changes `scope_rules` (e.g. a study type now excludes a different section) and drops one derived judgment. Cases:
  - `test_run_view_uses_pinned_rules`: the run view response (call the read service the run-view endpoint uses) has `scope_rules == RULES_OLD["scope_rules"]` and derived judgments computed from RULES_OLD (the dropped judgment is still present).
  - `test_finalize_gate_uses_pinned_rules`: `divergence_rationale_failure(db, run)` evaluates RULES_OLD's derived judgments (plant a divergence on the judgment RULES_NEW dropped with no rationale → a failure message; with RULES_NEW it would be `None`).
  - `test_llm_field_filter_uses_pinned_rules`: `build_llm_field_filter(db, run)` excludes exactly what RULES_OLD excludes.
  - `test_landing_gate_uses_pinned_rules`: drive the AI landing gate for that run (`ai_extraction/landing.py` `_gate()`, through the landing object the existing landing tests build — `grep -rln "_gate\|ProposalLanding" "$WT/backend/tests"` for the constructor) after the live schema changed to RULES_NEW; the returned `LlmFieldFilter` equals `llm_field_filter_of(RULES_OLD)`.
  - `test_pinned_template_rules_shape` (service-level): a version without rules maps to `{}`; an unknown id is absent.
- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/integration/test_qa_rules_frozen.py -q` → FAIL (live RULES_NEW read; `scope_rules` missing).

- [ ] **Step 3: Implement** per Interfaces; `cd "$WT" && npm run generate:api-types`.

- [ ] **Step 4: Run green + gates.**
  ```bash
  cd "$WT/backend" && uv run pytest tests/unit tests/integration/test_qa_rules_frozen.py \
    tests/integration/test_build_run_view.py tests/integration -q -k "qa or derived or run_view or field_filter or landing or pipeline"
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh
  cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  ```
  Expected: PASS; no remaining live-schema read in the four consumers (`grep -n "schema_" "$WT/backend/app/services/qa_divergence_gate.py" "$WT/backend/app/services/llm_field_filter.py" "$WT/backend/app/services/extraction_run_read_service.py"` shows none used for rules).

- [ ] **Step 5: Commit.** `git -C "$WT" add backend frontend/types/api && git -C "$WT" commit -m "feat(qa): runs read the QA rules of the version they are pinned to"`

**Done when:** run view (with `scope_rules`), finalize gate and AI field filter all read the pinned rules, the frozen-rules tests pass with live rules changed underneath, types regenerated, gates green.

---

### Task 2.8b-1: Exports apply each article's pinned QA rules

**Layer:** backend · **Migration:** no · **Commit:** `feat(exports): QA scope marking and appraisal use each run's pinned rules`

**Goal:** an export evaluates out-of-scope marking, the appraisal roll-up and derived judgments per article with the rules frozen in that article's run version, so articles reviewed under different template versions are each exported under their own rules.

**Context:** `backend/app/services/extraction_snapshot.py::pinned_template_rules(db, version_ids) -> dict[UUID, dict]` (Task 2.8a-2) returns `{version_id: {"derived_judgments"?: ..., "scope_rules"?: ...}}` (`{}` for a version without rules; unknown ids absent). In `backend/app/services/extraction_export_service.py` (2144 lines; file-size baseline cap 2194 in `scripts/fitness/check_file_size.baseline` — keep the change small; put any helper in `backend/app/services/exports/`): `ArticleDescriptor` (L149-165) already carries `version_id: UUID | None` (its run's pinned version); `mark_out_of_scope_values(template_schema=template.schema_, sections=..., articles=tuple(articles), reviewers=..., value_map=..., is_all_users=...)` (L511-518; defined in `backend/app/services/exports/extraction_scope_marking.py:87`); `self._build_appraisal_model(template_schema=template.schema_, ...)` (L566-575, QA only); `_build_appraisal_model` (L600-610) takes ONE `template_schema` and uses `derived_spec(template_schema)` (~L658) and `out_of_scope_sections(template_schema, ...)` + `compute_derived_judgments(spec, ...)` per article (~L736-745). Per-version grouping precedent in the same file: `_compute_obsolete_fields_per_article` (L878-910) and ~L1675.

**Files:**
- Modify: `backend/app/services/exports/extraction_scope_marking.py` (`mark_out_of_scope_values` takes per-article rules)
- Modify: `backend/app/services/extraction_export_service.py` (load rules once per export; pass per-article rules)
- Test: `backend/tests/integration/test_qa_rules_frozen.py` (export leg), `backend/tests/unit/test_extraction_scope_marking.py` and the appraisal unit tests (`grep -rln "mark_out_of_scope_values\|_build_appraisal_model" "$WT/backend/tests"`) updated for the new parameter

**Interfaces:**
- In the export: `rules_by_version = await pinned_template_rules(self.db, {a.version_id for a in articles if a.version_id})`; `rules_for(article) -> dict = rules_by_version.get(article.version_id, {}) if article.version_id else (template.schema_ or {})` (an article without a run has no values to mark; the live schema is only a harmless default there).
- `mark_out_of_scope_values(*, rules_by_article: Mapping[UUID, Mapping[str, Any]], sections, articles, reviewers, value_map, is_all_users)` — replaces `template_schema`; looks up each article's rules by `article.article_id` (use the descriptor's id attribute as named in `ArticleDescriptor`).
- `_build_appraisal_model(..., rules_by_article: Mapping[UUID, Mapping[str, Any]])` — replaces `template_schema`; per article it computes `derived_spec(rules)` and `out_of_scope_sections(rules, ...)` from that article's rules. The verdict-field selection (`_is_verdict`) is unchanged.

- [ ] **Step 1: Write the failing test.** Add `test_export_uses_pinned_rules` to `tests/integration/test_qa_rules_frozen.py` (reuse its `_pinned_qa_run` setup: PROBAST+AI clone, v1 with rules RULES_OLD, a run on `SEED.primary_article` pinned to v1, live schema changed to RULES_NEW): record a study-type answer that RULES_OLD and RULES_NEW scope differently plus the domain answers needed for one derived judgment; run the export service the way the existing export integration tests do (`grep -rln "ExtractionExportService" "$WT/backend/tests/integration" | head -3` for the call shape); the out-of-scope marking and the appraisal row for that article follow RULES_OLD (a section RULES_NEW would exclude still exports its values; the judgment RULES_NEW dropped is still computed).
- Add `test_export_groups_rules_by_article_version` to the same file: two articles in ONE export call — article A's run pinned to v1 (RULES_OLD) and article B's run pinned to v2 (RULES_NEW; publish v2 after changing the clone's live schema, then open B's run with `run_in_extract_at(..., article_id=<second article>)` — create the second article with the article factory/helper the export integration tests use); give both the same study-type answer that the two rule sets scope differently; assert A's out-of-scope marking and appraisal row follow RULES_OLD and B's follow RULES_NEW in the same workbook model.
- Update the unit tests that pass `template_schema=` to these two functions to pass `rules_by_article={<article id>: <schema>}`.

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/integration/test_qa_rules_frozen.py -q -k export` → FAIL (export reads live RULES_NEW).

- [ ] **Step 3: Implement** per Interfaces.

- [ ] **Step 4: Run green + gates.**
  ```bash
  cd "$WT/backend" && uv run pytest tests/unit tests/integration/test_qa_rules_frozen.py tests/integration -q -k "export or appraisal or scope"
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh
  cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  ```
  Expected: PASS; `check_file_size.py` green.

- [ ] **Step 5: Commit.** `git -C "$WT" add backend && git -C "$WT" commit -m "feat(exports): QA scope marking and appraisal use each run's pinned rules"`

**Done when:** an export marks scope and rolls up appraisal per article from that article's pinned rules, the export leg of the frozen-rules test passes, gates green.

---

### Task 2.8b-2: Re-import refreshes the rules into a new version; the QA screen reads the run's rules

**Layer:** backend + frontend · **Migration:** no · **Commit:** `feat(qa): re-import publishes changed QA rules and the QA screen reads the run's rules`

**Goal:** re-importing a QA template whose catalogue rules changed writes the new rules to the project template and publishes a new version carrying them (new runs use the new rules; runs pinned to older versions keep theirs). If the template has a pending configuration draft, that re-import is refused with the existing pending-draft refusal instead of publishing the draft. The QA screen's out-of-scope badges read the run's pinned `scope_rules`, so they always agree with the finalize gate.

**Context:** each template version snapshot carries `derived_judgments`/`scope_rules` when declared (Task 2.8a-1); `build_template_version_snapshot` reads them from the LIVE `project_extraction_templates.schema` via SQL, so an ORM assignment must be flushed before a republish sees it. Per-run consumers read `pinned_template_rules` (Task 2.8a-2); `RunViewResponse.scope_rules: dict | None` is served by the run view. `backend/app/services/template_versioning/_clone.py::clone_template` (L63-173), for an existing clone: zero-state branch (L123-146: `acquire_publish_locks` → `_refuse_if_instruction_draft_pending` → `rebuild_from_global` → `republish(...)` without `fail_if_pending_draft`); structure-drift branch (L147-162: fast `PendingConfigDraftError()` when `config_draft_since` is set, then `republish(..., fail_if_pending_draft=True)`); then `await structure.reactivate(existing, global_tpl=global_tpl, kind=kind)` (L166) — `TemplateCloneService.reactivate` (`backend/app/services/template_clone_service.py:159-189`) sets `existing.schema_ = dict(global_tpl.schema_ or {})` (L176) AFTER any republish, so today refreshed rules never reach a snapshot in that call, and the aligned path (no drift) publishes nothing. `TemplateVersionService.republish(..., fail_if_pending_draft=True)` raises `PendingConfigDraftError` (`_publish.py:61`) under its locks when a draft is pending, and short-circuits when the snapshot is unchanged. Re-import stays a human UI action. Frontend: `frontend/pages/QualityAssessmentFullScreen.tsx` L210-219 computes `outOfScopeSectionsOnForm(template?.schema, domains, session?.instancesByEntityType, values)` with `template` from the PostgREST select in `frontend/services/qaTemplateService.ts:45-58` (`'id, name, description, framework, version, kind, schema'`); `runDetail` comes from `useRunView(session?.runId)` (L100); `frontend/lib/qa/studyTypeScope.ts::outOfScopeSectionsOnForm(templateSchema: unknown, ...)` reads `templateSchema.scope_rules` (L27, L110); the hand-written run-view response type lives in `frontend/hooks/runs/types.ts` (has `derived_judgments?` ~L225). `components/hitl/HITLArticleTable.tsx` stays on the active template's live rules (a dashboard).

**Files:**
- Modify: `backend/app/services/template_versioning/_clone.py`
- Modify: `frontend/pages/QualityAssessmentFullScreen.tsx`
- Modify: `frontend/hooks/runs/types.ts` (`scope_rules?: Record<string, unknown> | null` on the run-view response type)
- Modify: `frontend/services/qaTemplateService.ts` (drop `schema` from the select if `QualityAssessmentFullScreen` was its only reader — check with `grep -rn "\.schema\b" "$WT/frontend" | grep -i "qa\|template"`; keep it otherwise)
- Test: `backend/tests/integration/test_qa_rules_frozen.py` (re-import legs), `backend/tests/integration/test_template_clone*.py` (whichever covers re-import: `ls "$WT/backend/tests/integration" | grep -i clone`), `frontend/test/QualityAssessmentFullScreen.scope.test.tsx`

**Interfaces:**
- In `clone_template`, for an existing clone, before the branches: `rules_changed = _qa_rules(global_tpl.schema_) != _qa_rules(version.schema_)` where `def _qa_rules(schema: Mapping | None) -> dict` keeps only the non-empty `derived_judgments`/`scope_rules` keys (module-private helper in `_clone.py`).
  - zero-state branch: after the locks and the instruction guard, when `rules_changed`, set `existing.schema_ = dict(global_tpl.schema_ or {})` and `await db.flush()` before `rebuild_from_global`/`republish`.
  - structure-drift branch: `await publisher.acquire_publish_locks(existing.id)` FIRST, then the same assignment + flush, then its `republish(..., fail_if_pending_draft=True)`.
  - aligned path (no drift) with `rules_changed`: `await publisher.acquire_publish_locks(existing.id)` FIRST, then assignment + flush, then `republished = await publisher.republish(project_id=..., project_template_id=existing.id, user_id=user_id, fail_if_pending_draft=True)`; `version_id = republished.version_id`.
  - `reactivate` keeps its own assignment (idempotent).
  - Lock order (why the locks come first): the schema UPDATE row-locks the template, while `republish`, run creation and session open take the advisory publish locks before the template row; assigning first would invert that order and can deadlock a re-import against a run being opened. Write a comment at each assignment saying so, matching the zero-state branch's existing comment (`acquire_publish_locks` is re-entrant within the transaction — `republish` takes it again, as it already does after the zero-state branch). Pin the order in a unit test: `test_reimport_takes_publish_locks_before_writing_rules` patches `TemplateVersionService.acquire_publish_locks` and `AsyncSession.flush` with recording side effects (or a `Mock` manager attached to both) and asserts the lock call precedes the first flush that carries the schema change, for the drift and aligned branches.

- [ ] **Step 1: Write the failing tests.**
  - `tests/integration/test_qa_rules_frozen.py` (reuse `_pinned_qa_run`: PROBAST+AI clone, v1 with RULES_OLD, run on `SEED.primary_article` pinned to v1). Instead of editing the clone's live schema, change the GLOBAL template's schema to RULES_NEW inside the test transaction (`UPDATE public.extraction_templates_global SET schema = :r2 WHERE id = :gid`) and call `clone_template(...)` again (the re-import):
    - `test_reimport_publishes_new_rules_and_old_run_keeps_old_rules`: a new active version v2 exists whose snapshot holds RULES_NEW; the existing run still reads RULES_OLD in its run view (`scope_rules`), finalize gate, LLM field filter and export (reuse the earlier legs' assertions); a new run created after the re-import (delete the first run's coordinate first, as `run_in_extract_at` does) reads RULES_NEW.
    - `test_reimport_with_pending_draft_and_changed_rules_is_refused`: stamp a draft (change a field label on the clone so `config_draft_since` is set), then re-import with RULES_NEW → `PendingConfigDraftError`; no new version, the live schema still RULES_OLD.
    - `test_reimport_with_unchanged_rules_publishes_nothing`: re-import with the global unchanged → version count unchanged.
  - `frontend/test/QualityAssessmentFullScreen.scope.test.tsx` (mocks via `./helpers/runScreenFixtures`: `makeSupabaseClientMock`, `PROBAST_TEMPLATE`; saved answers from `fixture.currentValues`): give the template fixture `schema.scope_rules` = RULES_NEW and the run view fixture `scope_rules` = RULES_OLD, with a study-type answer that RULES_OLD and RULES_NEW scope differently; the out-of-scope badges follow RULES_OLD.

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/integration/test_qa_rules_frozen.py -q -k reimport` and `cd "$WT" && npx vitest run frontend/test/QualityAssessmentFullScreen.scope.test.tsx` → FAIL.

- [ ] **Step 3: Implement** per Interfaces; in `QualityAssessmentFullScreen.tsx` pass `runDetail ? {scope_rules: runDetail.scope_rules ?? null} : null` to `outOfScopeSectionsOnForm`.

- [ ] **Step 4: Run green + gates.**
  ```bash
  cd "$WT/backend" && uv run pytest tests/unit tests/integration/test_qa_rules_frozen.py tests/integration -q -k "clone or reimport or qa or template_version"
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh
  cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  cd "$WT" && npm run test:run && npm run typecheck && npm run lint && npx knip && npx knip --production \
    && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/check_frontend_data_path.py
  ```
  Expected: PASS; the frontend data-path baseline does not grow.

- [ ] **Step 5: Commit.** `git -C "$WT" add backend frontend && git -C "$WT" commit -m "feat(qa): re-import publishes changed QA rules and the QA screen reads the run's rules"`

**Done when:** a re-import with changed rules publishes them in a new version (refused under a pending draft), pinned runs keep their rules in every consumer, the QA screen's badges read the run's rules, gates green.

---

### Task 2.9a: CHARMS catalogue cleanup that converges on existing databases

**Layer:** backend (seed) · **Migration:** no · **Commit:** `fix(seed): drop endocarditis placeholders from CHARMS and relax conditional fields`

**Goal:** the global CHARMS template stops shipping four placeholder participant fields from an endocarditis review (`native_valve_endocarditis`, `valve_affected`, `characteristic_4`, `characteristic_5`) and gains one optional free-text field, `participant_characteristics` ("Participant Characteristics", CHARMS 2.8). Value, confidence-interval and p-value fields that only apply when their "reported?" question is answered yes are seeded optional. Existing databases converge on the next boot; project clones are never touched.

**Context:** `backend/app/seed.py` (3243 lines; file-size baseline cap 3292 in `scripts/fitness/check_file_size.baseline` — the net change must stay under ~45 lines). `seed_charms` (L271) early-returns when the global CHARMS row exists (L274-278), so a change to its field list reaches only fresh databases; `main()` (L3216-3236) runs `seed_charms`, `seed_charms_mm`, `seed_probast`, `seed_quadas2`, `seed_probast_ai`, `backfill_llm_template_instructions`, then commits — the boot runs `python -m app.seed` (`backend/Dockerfile:114`). IDs: `_CHARMS_TEMPLATE_ID = UUID("000c0000-0000-0000-0000-000000000001")` (L118), `_ET_PARTICIPANTS = UUID("000c0003-0000-0000-0000-000000000000")` (L173, entity type name `participants`), `_ET_MODEL_PERF` (L180). The nested `_f(eid, name, label, desc, ftype, sort, *, required=True, allowed=None, unit=None, llm=None, allows_not_applicable=False, allows_not_evaluated=False)` (L443-472) builds each field. Participants block from L520: `age_of_participants` sort 8 (~L592), then the four placeholders at L600-635 (sorts 9-12, text, required by default). Gated groups in `_ET_MODEL_PERF` (L891-1083), all currently required: `calibration_slope_value`/`_ci`, `calibration_in_large_value`/`_ci`, `hosmer_lemeshow_p_value`, `c_statistic_value`/`_ci`, `d_statistic_value`/`_ci`, `log_rank_test_p_value`. Convergence precedent: `backend/app/seed_probast_ai.py` (`take_advisory_xact_lock(session, TID, TID)` from `app.services.advisory_locks`; `_catalogue_is_referenced` L635: a recorded instance on a global entity type means skip loudly instead of deleting). `seed_probast_ai` imports from `app.seed`, so `app.seed` must not import `app.seed_probast_ai` at module level. Seeds run via `cd backend && uv run python -m app.seed`, never in migrations. Docs listing the removed fields: `docs/reference/templates/charms-v1.1-complete.md:53-56`, `docs/reference/templates/charms-v1.1-hierarchy.md:41-44`.

**Files:**
- Modify: `backend/app/seed.py`
- Modify: `docs/reference/templates/charms-v1.1-complete.md`, `docs/reference/templates/charms-v1.1-hierarchy.md` (replace the four rows with the one new field; bump `last_reviewed` in their frontmatter)
- Test: `backend/tests/integration/test_seed_convergence.py` (helpers `clone_charms(db, project_id, user_id)`, `clean_project_clones`, `CHARMS_GLOBAL_ID` from `tests/integration/conftest.py`)

**Interfaces:**
- Produces (module-level in `seed.py`): `_CHARMS_RETIRED_FIELDS = frozenset({"native_valve_endocarditis", "valve_affected", "characteristic_4", "characteristic_5"})`; `_CHARMS_CONDITIONAL_FIELDS = frozenset({...the ten names above...})`; `async def converge_charms_global(session: AsyncSession) -> None`.
- `seed_charms`: the four `_f(...)` calls are replaced by one `_f(_ET_PARTICIPANTS, "participant_characteristics", "Participant Characteristics", "Other participant characteristics the study reports (CHARMS 2.8)", "text", 9, required=False, llm="<one-sentence extraction prompt>")`; `_f` sets `is_required=required and name not in _CHARMS_CONDITIONAL_FIELDS`.
- `converge_charms_global(session)`: take the advisory lock on `_CHARMS_TEMPLATE_ID`; return when the global row is missing; if any `ExtractionInstance` references an entity type of the CHARMS global template, print a skip message and return (same rule as `_catalogue_is_referenced`, written inline for this template id); delete `ExtractionField` rows `WHERE entity_type_id = _ET_PARTICIPANTS AND name IN _CHARMS_RETIRED_FIELDS`; insert `participant_characteristics` when absent (same values as the `seed_charms` call; build it through a small module-level helper both use, so the definition exists once); `UPDATE extraction_fields SET is_required = false` for `name IN _CHARMS_CONDITIONAL_FIELDS` on entity types of the CHARMS global template where it is still true. Idempotent. `main()` calls it right after `seed_charms(session)`.

- [ ] **Step 1: Write the failing tests** in `tests/integration/test_seed_convergence.py` (`db_session`; `await fn(db_session); await db_session.commit()` lands in the savepoint):
  - `test_charms_global_has_no_placeholder_fields`: after `await converge_charms_global(db_session)`, no field of the CHARMS global template has a name in `_CHARMS_RETIRED_FIELDS`, and `participant_characteristics` exists on `_ET_PARTICIPANTS` with `is_required = false`.
  - `test_charms_conditional_fields_are_optional`: each name in `_CHARMS_CONDITIONAL_FIELDS` exists on the global template and `is_required` is false.
  - `test_converge_charms_on_an_old_catalogue_and_clones_untouched`: plant the old state on the global (insert the four retired fields on `_ET_PARTICIPANTS`, delete `participant_characteristics`, set the conditional fields required); clone CHARMS into `SEED.secondary_project` (`clean_project_clones` then `clone_charms`) — the clone has the four fields; run `converge_charms_global`; the global is clean, and the clone's field names and `is_required` flags are unchanged.
  - `test_converge_charms_twice_is_a_no_op`: the second run changes nothing (snapshot the global's `(name, is_required)` set before and after).
  - `test_fresh_clone_is_clean`: after converge, a fresh `clone_charms` has none of the four fields and has `participant_characteristics`.

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/integration/test_seed_convergence.py -q` → FAIL (`converge_charms_global` missing).

- [ ] **Step 3: Implement** per Interfaces; update the two docs.

- [ ] **Step 4: Re-seed and run green + gates.**
  ```bash
  cd "$WT/backend" && uv run python -m app.seed && uv run pytest tests/unit tests/integration/test_seed_convergence.py \
    tests/integration/test_template_portable_service.py tests/integration/mcp/test_mcp_get_template.py -q
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh \
    && git -C "$WT" add docs && bash scripts/docs/check-frontmatter.sh
  cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  ```
  Expected: PASS; `check_file_size.py` green for `seed.py`; frontmatter PASS.

- [ ] **Step 5: Commit.** `git -C "$WT" add backend docs && git -C "$WT" commit -m "fix(seed): drop endocarditis placeholders from CHARMS and relax conditional fields"`

**Done when:** fresh and existing databases have the clean CHARMS catalogue, conditional fields are optional, clones are untouched, converge is idempotent, gates green.

---

### Task 2.9b: Seeded AI instructions stop asking managers to retype the review question

**Layer:** backend (seed) + frontend copy · **Migration:** no · **Commit:** `fix(seed): template AI instructions point to the review question instead of placeholder slots`

**Goal:** the seeded general AI instructions (CHARMS, CHARMS + Multimodal, PROBAST, QUADAS-2, PROBAST+AI) and the editor's suggested default no longer contain `[customize: ...]` slots asking for the population, index, comparator, outcome, timing or setting — the project's review question already reaches the prompt. Databases holding a retired default get the new text; a manager's customized text is never touched. On fresh clones of unedited globals the "N to customize" chip reads 0.

**Context:** `backend/app/seed.py`: `_LLM_TEMPLATE_INSTRUCTIONS: dict[UUID, str]` (L3131-3172; preceded by a comment L3127-3130 saying the `[customize: ...]` slots are deliberate) holds CHARMS and MM (slot "name the target condition, population, and outcome this review focuses on"), PROBAST ("describe the review's intended setting and population ...") and QUADAS-2 ("state the review question — index test, target condition, and intended-use setting — ..."); `backfill_llm_template_instructions(session)` (L3175-3207) merges a PROBAST+AI text (built locally, slot "state the review's Step-1 PICOTS — ...") and writes each with `update(ExtractionTemplateGlobal).where(id == tid, llm_template_instruction.is_(None))`. The project's review question is rendered into prompts by `backend/app/services/project_ai_context.py::build_review_context` (used by `run_prompt_context.py`). That module's docstring (L1-21) wrongly says five seeded templates ship a PICOTS slot and that the column is written "by the settings UI over PostgREST"; the `MAX_REVIEW_CONTEXT_CHARS` comment (L31-37) repeats the PostgREST claim — the writer is `PUT /api/v1/projects/{project_id}/ai-context` (`backend/app/api/v1/endpoints/ai_context.py:56`, manager-only). Frontend: `frontend/lib/copy/extraction.ts:537-538` `instructionSuggestedDefault` ends with `[customize: describe this review's scope]`; slots are counted by `/\[customize:[^\]]*\]/g` in `frontend/components/extraction/TemplateInstructionControl.tsx:14-17` and `TemplateInstructionPane.tsx:13,55`. `seed.py` sits near its file-size cap (3292; keep the net change small). Tests: `backend/tests/integration/test_seed_llm_instructions.py` (`test_backfill_fills_null_instructions`, `test_backfill_never_clobbers_customized_text`), `backend/tests/unit/test_extraction_prompt_input.py`, `backend/tests/unit/test_project_ai_context.py`, `frontend/test/components/TemplateInstructionControl.test.tsx`.

**Files:**
- Modify: `backend/app/seed.py` (`_LLM_TEMPLATE_INSTRUCTIONS`, its comment, the PROBAST+AI text, new `_RETIRED_LLM_TEMPLATE_INSTRUCTIONS`, `backfill_llm_template_instructions`)
- Modify: `backend/app/services/project_ai_context.py` (docstring and comment only)
- Modify: `frontend/lib/copy/extraction.ts` (`instructionSuggestedDefault`)
- Create: `backend/tests/unit/test_seed_instruction_slots.py`
- Test: `backend/tests/integration/test_seed_llm_instructions.py`, `backend/tests/unit/test_extraction_prompt_input.py`, `frontend/test/components/TemplateInstructionControl.test.tsx`

**Interfaces:**
- Each seeded text loses its `[customize: ...]` sentence and ends with one sentence pointing to the review question, e.g. "Judge applicability against the review question set in the project's review question settings." (appraisal templates) / "The review question set in the project's review question settings defines the target condition, population and outcome." (extraction templates). No `[customize:` remains in any seeded text.
- `_RETIRED_LLM_TEMPLATE_INSTRUCTIONS: dict[UUID, frozenset[str]]` — for each template id, the exact previous default text(s), copied verbatim from the current code BEFORE editing (the PROBAST+AI entry is keyed in the function, like its current text, because of the import cycle).
- `backfill_llm_template_instructions`: the WHERE becomes `or_(llm_template_instruction.is_(None), llm_template_instruction.in_(retired_texts_for_that_id))`. Customized text (anything else) is never touched.
- `instructionSuggestedDefault`: `"You are extracting data for a systematic review. Report values exactly as stated in the article, do not infer unreported values, and quote the passage supporting each value."`

- [ ] **Step 1: Write the failing tests.**
  - New `tests/unit/test_seed_instruction_slots.py`: for every text in `_LLM_TEMPLATE_INSTRUCTIONS.values()` and the PROBAST+AI default (expose it as a module-level `_PROBAST_AI_LLM_INSTRUCTION` string in `seed.py` so the test can read it without a DB; the function keys it by `_PROBAST_AI_TEMPLATE_ID` at call time), no `[customize:` slot mentions any of `population`, `index`, `comparator`, `outcome`, `timing`, `setting` (case-insensitive regex over `\[customize:[^\]]*\]`); simplest strong form: `"[customize:" not in text`.
  - `tests/unit/test_extraction_prompt_input.py`: with a project review context whose PICOTS population is "adults with sepsis" and the new CHARMS default as the template instruction, the assembled prompt input contains "adults with sepsis" exactly once (follow the file's existing builder calls).
  - `tests/integration/test_seed_llm_instructions.py`: `test_backfill_replaces_a_retired_default` (set CHARMS's global instruction to its retired text → after backfill it equals the new text); `test_backfill_keeps_customized_text` stays (customized text untouched); `test_backfill_rerun_is_a_no_op` (two runs → same values, second run updates 0 rows).
  - `frontend/test/components/TemplateInstructionControl.test.tsx`: inserting the suggested default yields a chip count of 0 (no "to customize" chip).

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/unit/test_seed_instruction_slots.py tests/unit/test_extraction_prompt_input.py tests/integration/test_seed_llm_instructions.py -q` and `cd "$WT" && npx vitest run frontend/test/components/TemplateInstructionControl.test.tsx` → FAIL.

- [ ] **Step 3: Implement** per Interfaces; replace the L3127-3130 comment with one that says the defaults carry no slots because the review question reaches the prompt from the project's settings, and that a retired default is replaced while customized text is kept. Fix the `project_ai_context.py` docstring (no "five seeded templates ship a slot" claim; the writer is `PUT /ai-context`, manager-only) and the `MAX_REVIEW_CONTEXT_CHARS` comment (the cap lives in the renderer; the API is the column's writer).

- [ ] **Step 4: Re-seed and run green + gates.**
  ```bash
  cd "$WT/backend" && uv run python -m app.seed && uv run pytest tests/unit tests/integration/test_seed_llm_instructions.py -q
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh
  cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  cd "$WT" && npm run test:run && npm run lint && npx knip && npx knip --production \
    && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/check_copy_keys.py
  ```
  Expected: PASS; `check_file_size.py` green for `seed.py`.

- [ ] **Step 5: Commit.** `git -C "$WT" add backend frontend && git -C "$WT" commit -m "fix(seed): template AI instructions point to the review question instead of placeholder slots"`

**Done when:** no seeded or suggested default carries a review-question slot, retired defaults are replaced and customized text kept, the review question appears once in a prompt, docstrings are accurate, gates green.

---

### Task 2.10: Evidence foreign-key indexes and HITL config scope foreign keys (migration 0086)

**Layer:** backend · **Migration:** yes (`0086_evidence_idx_hitl_fk`) · **Commit:** `feat(db): index evidence links and cascade HITL configs with their scope`

**Goal:** evidence rows are indexed on each of their three workflow links (proposal, reviewer decision, consensus decision), and a HITL configuration row is tied to the project or template it configures by a real foreign key with `ON DELETE CASCADE`, so deleting a project or a template leaves no orphan configuration. Orphans that already exist are removed first. The API, `hitl_config_snapshot` and the four RLS policies on `extraction_hitl_configs` are unchanged.

**Context:** `backend/app/models/extraction.py` `ExtractionEvidence` (class ~L565): nullable CASCADE FKs `run_id` (~L596), `proposal_record_id` (~L603), `reviewer_decision_id` (~L608), `consensus_decision_id` (~L613), none with `index=`; `__table_args__` (~L633-647) declares only `idx_extraction_evidence_position_gin`, the `workflow_target_present` CHECK and `{"schema": "public"}`; the database already has a btree `idx_extraction_evidence_run_id` (from the baseline) that the model does not declare. `backend/app/models/extraction_versioning.py` `ExtractionHitlConfig` (~L114, table `extraction_hitl_configs`): `scope_kind` (`PostgreSQLEnumType("hitl_config_scope_kind")`, values `project`/`template`), `scope_id` (uuid, NOT NULL, `index=True`, no FK), `UniqueConstraint("scope_kind", "scope_id", name="uq_extraction_hitl_configs_scope")`; the four RLS policies live in `backend/alembic/versions/baseline_v1.sql` (~L2529-2551) and branch on `scope_kind`/`scope_id`. No model uses `Computed(...)` yet. `backend/app/services/template_delete_service.py:105-107` deletes the template-scoped config by hand ("`scope_id` has no FK") via `HitlConfigRepository(db).delete_by_scope(HitlConfigScopeKind.TEMPLATE, template_id)`; `delete_by_scope` stays (used by `HitlConfigService.clear_for_project`/`clear_for_template`, `hitl_config_service.py:173-181`). Writers that insert HITL rows without new columns: `HitlConfigRepository.upsert`, `tests/integration/test_hitl_configs_lifecycle.py`, `test_hitl_config_service.py`, `test_template_delete_service.py` (raw INSERT), `tests/unit/test_extraction_versioning_models.py` — generated columns keep all of them working. `alembic check` runs in CI after `upgrade head`; `backend/alembic/env.py` `include_object` (L94-148) ignores reflected indexes/FKs with no model counterpart.

**Migration rules (apply exactly):** confirm the number first: `ls "$WT/backend/alembic/versions" | grep '^0' | sort | tail -1` must print `0085_freeze_qa_rules.py`. File `backend/alembic/versions/0086_evidence_idx_hitl_fk.py`, `revision = "0086_evidence_idx_hitl_fk"` (25 chars), `down_revision = "0085_freeze_qa_rules"`. Move `expected_head` in `backend/tests/integration/test_migration_roundtrip.py::test_alembic_head_is_expected_revision` to `"0086_evidence_idx_hitl_fk"` and add a roundtrip test. Short constraint names. No seed data; never DDL through the Supabase MCP. After the task: `cd "$WT/backend" && uv run alembic upgrade head` once on the test database.

**Files:**
- Modify: `docs/reference/extraction-hitl-architecture.md` (section 3, the "Migration head:" line ~L138 → `0086_evidence_idx_hitl_fk`; frontmatter `last_reviewed:` → the commit date) — required for every migration touching `extraction_*`
- Create: `backend/alembic/versions/0086_evidence_idx_hitl_fk.py`
- Create: `backend/tests/integration/test_db_hardening_0086.py`
- Modify: `backend/tests/integration/test_migration_roundtrip.py`
- Modify: `backend/app/models/extraction.py` (`ExtractionEvidence.__table_args__`)
- Modify: `backend/app/models/extraction_versioning.py` (`ExtractionHitlConfig`)
- Modify: `backend/app/services/template_delete_service.py` (delete the redundant call at L105-107 and the imports it leaves unused, L37-38)
- Test: `backend/tests/integration/test_hitl_configs_lifecycle.py`, `backend/tests/integration/test_template_delete_service.py`

**Interfaces / schema:**
- Evidence indexes (btree): `idx_extraction_evidence_proposal_record_id`, `idx_extraction_evidence_reviewer_decision_id`, `idx_extraction_evidence_consensus_decision_id`; the model also declares the existing `Index("idx_extraction_evidence_run_id", "run_id")` (the migration does not create it).
- HITL scope columns: `scope_project_id uuid GENERATED ALWAYS AS (CASE WHEN scope_kind = 'project'::hitl_config_scope_kind THEN scope_id END) STORED` with FK `fk_hitl_configs_scope_project` → `public.projects(id) ON DELETE CASCADE`; `scope_template_id uuid GENERATED ALWAYS AS (CASE WHEN scope_kind = 'template'::hitl_config_scope_kind THEN scope_id END) STORED` with FK `fk_hitl_configs_scope_template` → `public.project_extraction_templates(id) ON DELETE CASCADE`. Model: `mapped_column(PG_UUID(as_uuid=True), Computed("<same expression>", persisted=True), ForeignKey("public.projects.id", ondelete="CASCADE", name="fk_hitl_configs_scope_project"), nullable=True)` and the template twin (import `Computed` from `sqlalchemy`).
- Fallback (decided by the red test only): if Postgres refuses a foreign key on a generated column, use plain nullable `scope_project_id`/`scope_template_id` written by `repositories/hitl_config_repository.py::upsert`, plus CHECK `scope_columns` = exactly one of them non-null and matching `scope_kind`/`scope_id`; then update every listed raw-INSERT test writer too. In that path the migration BACKFILLS existing rows (`UPDATE public.extraction_hitl_configs SET scope_project_id = CASE WHEN scope_kind = 'project' THEN scope_id END, scope_template_id = CASE WHEN scope_kind = 'template' THEN scope_id END`) after the orphan delete and BEFORE adding the CHECK and FKs, and `test_db_hardening_0086.py` gains `test_existing_config_rows_are_backfilled`: in the migration roundtrip scratch database, downgrade to `0085_freeze_qa_rules`, plant one project-scoped and one template-scoped row (real project/template rows created in the test), upgrade to head, assert both scope columns are filled and the CHECK holds.
- Upgrade order: `DELETE FROM public.extraction_hitl_configs h WHERE (h.scope_kind = 'project' AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = h.scope_id)) OR (h.scope_kind = 'template' AND NOT EXISTS (SELECT 1 FROM public.project_extraction_templates t WHERE t.id = h.scope_id))`; create the three evidence indexes; add the two generated columns; add the two FKs. Downgrade: drop the FKs, the two columns and the three new indexes (the deleted orphans are not restored; say so in the docstring).

- [ ] **Step 1: Write the failing tests.**
  - New `tests/integration/test_db_hardening_0086.py`: the three new index names exist in `pg_indexes` for `public.extraction_evidence`; `pg_constraint` holds `fk_hitl_configs_scope_project` and `fk_hitl_configs_scope_template` with `confdeltype = 'c'`; inserting a HITL row for a random (non-existent) project id raises `IntegrityError`.
  - `tests/integration/test_hitl_configs_lifecycle.py`, `test_project_delete_leaves_no_hitl_configs`: on a project created in the test (or `SEED.secondary_project` after `clean_project_clones`, with a CHARMS clone via `clone_charms`), insert one project-scoped and one template-scoped config (ORM `ExtractionHitlConfig(scope_kind=..., scope_id=..., reviewer_count=..., consensus_rule=...)` as the file does), `DELETE FROM public.projects WHERE id = :pid` → 0 config rows for either scope id.
  - Any existing test that inserts a HITL config with a random `scope_id` (`grep -rn "ExtractionHitlConfig(\|extraction_hitl_configs" "$WT/backend/tests/integration"`, e.g. the unique-per-scope case in `test_hitl_configs_lifecycle.py`) now points it at a real project or template, since the FK refuses a dangling scope.
  - `tests/integration/test_template_delete_service.py::test_delete_cascades_structure_versions_and_hitl_config` (~L109) stays green with the redundant call removed (the FK now does it).
  - `tests/integration/test_migration_roundtrip.py`: `expected_head = "0086_evidence_idx_hitl_fk"`; `test_migration_0086_evidence_idx_hitl_fk_roundtrip(migration_db_url, migration_session)`: at head the indexes and FKs exist; downgrade to `0085_freeze_qa_rules` → they are gone and the columns dropped; upgrade → present again (query `pg_indexes`/`pg_constraint`/`information_schema.columns`, `rollback()` after each read as `test_migration_0083_mcp_oauth_roundtrip` does).

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/integration/test_db_hardening_0086.py tests/integration/test_hitl_configs_lifecycle.py tests/integration/test_migration_roundtrip.py -q` → FAIL.

- [ ] **Step 3: Write the migration and the model changes**; render the SQL offline first: `cd "$WT/backend" && uv run alembic upgrade 0085_freeze_qa_rules:0086_evidence_idx_hitl_fk --sql | grep -iE "index|constraint|generated"`. Then `uv run alembic upgrade head && uv run alembic check` → no diff. Remove the redundant `delete_by_scope` call and its now-unused imports in `template_delete_service.py`.

- [ ] **Step 4: Run green + gates.**
  ```bash
  cd "$WT/backend" && uv run pytest tests/unit tests/integration/test_db_hardening_0086.py \
    tests/integration/test_hitl_configs_lifecycle.py tests/integration/test_hitl_config_service.py \
    tests/integration/test_template_delete_service.py tests/integration/test_migration_roundtrip.py -q
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh \
    && bash scripts/fitness/check_migration_split.sh \
    && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/check_rls_coverage.py
  cd "$WT/backend" && uv run alembic check && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  ```
  Expected: PASS; `alembic check` no diff; RLS coverage unchanged; no vulture baseline change (`delete_by_scope` still has callers).

- [ ] **Step 5: Commit.** `git -C "$WT" add backend docs && (cd "$WT" && bash scripts/docs/check-frontmatter.sh) && git -C "$WT" commit -m "feat(db): index evidence links and cascade HITL configs with their scope"`

**Done when:** the three evidence indexes exist, HITL configs cascade with their project or template, orphans are gone, roundtrip and head pin pass, `alembic check` is clean, gates green.

---

## Slice end (after Task 2.10, before the PR opens)

- [ ] **Re-check migration numbers against `origin/dev`.** `git -C "$WT" fetch origin dev` (a single command, so it runs outside the sandbox), then `git -C "$WT" ls-tree -r --name-only origin/dev backend/alembic/versions | grep -E '/008[4-9]_'`. No output → nothing to do. Any output means `dev` took a number: merge `origin/dev` into the branch, then renumber this branch's three migrations in order to the next free numbers, renaming together each file, `revision`, `down_revision` (the first one's = `dev`'s head), the module docstring's revision lines, `expected_head`, the roundtrip tests' names and downgrade targets in `test_migration_roundtrip.py`, and the `load_migration("...")` file names in `test_migration_0084_canonical_options.py` / `test_migration_0085_freeze_qa_rules.py`; re-run `cd "$WT/backend" && uv run alembic upgrade head && uv run pytest tests/integration/test_migration_roundtrip.py tests/integration/test_migration_0084_canonical_options.py tests/integration/test_migration_0085_freeze_qa_rules.py -q` → PASS, and commit `fix(db): renumber the contracts migrations after dev`.
- [ ] **Full gates and diff coverage.**
  ```bash
  cd "$WT/backend" && uv run pytest tests/ --cov=app --cov-report=xml -q \
    && uv run diff-cover coverage.xml --compare-branch=origin/dev --fail-under=80
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh \
    && cd "$WT/backend" && uv run alembic check \
    && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  cd "$WT" && npm run generate:api-types && git -C "$WT" status --short frontend/types/api \
    && npm run test:run && npm run typecheck && npm run lint && npx knip && npx knip --production
  ```
  Expected: full suite PASS; diff coverage ≥ 80% (a file under it gets its missing direct unit or service-level test in a `test(<area>): ...` commit); every gate green; no API type diff.
- [ ] **PR.** One PR to `dev`, title `feat(mcp): typed option and value contracts for templates and extractions`. Body: a behavior summary per area (options, value contract, typed MCP values, names, blank-template edits and the instruction lock, frozen QA rules, seed cleanup, schema hardening) and the tests that pin each; the tracker lines `Fixes PRU-76, PRU-77, PRU-79, PRU-91, PRU-96, PRU-107` and `Refs PRU-86`; a **Deploy skew** section: deploy the frontend first, then the backend, in the same release window — until a browser reloads, a stale bundle's field save sends `string[]` options and gets the 422 inline error and its grid shows canonical options as raw objects; the Inspector's reload-on-error path recovers; a **Data notes** section: migration 0084 rewrites live option shapes only (snapshots untouched, no draft stamped), 0085 copies QA rules into existing versions without creating any, 0086 deletes orphan HITL config rows before adding the foreign keys; and the note that a number's agreement key changes (a pre-deploy `"22"` and a post-deploy `22` on one coordinate read as a divergence; rare and self-resolving). Describe behavior and tests only; cite no local-only document.
- [ ] **After merge and deploy (recorded in the PR):** `make quality-scan` on the merge SHA; read-only MCP calls on a test project: `get_template` for CHARMS and PROBAST+AI returns `{value, label}` options; `get_extractions` returns a typed `null` and `22` (never `"None"` or `"22.0"`) with labels. The maintainer runs `cd backend && uv run python -m app.services.value_envelope_audit` read-only against production and records the counts; the value-envelope CHECK migration ships in a later PR only after that audit.
