---
status: draft
last_reviewed: 2026-10-18
owner: '@raphaelfh'
---

# MCP project configuration by an agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** with a `read_write` token and a blank template a manager created, an agent takes a project to a publish-ready draft: it checks setup readiness, writes a typed and versioned review question, builds the questionnaire with structural draft ops, reviews the exact draft and its changeset, and hands off to Publish in prumo. No publish, clone or import tool exists.

**Architecture:** templates gain a stable `instrument` code; the project protocol (PICOTS, eligibility, study design, review type) gets one revision counter bumped inside the existing row locks and guarded by compare-and-swap; the AI review question renders eligibility and study design after PICOTS and runs pin the revision they used, so a later edit shows as drift. New MCP tools (`get_review_question`, `set_review_question`, `list_template_catalogue`, `get_setup_readiness`) and a richer `get_template` (published, draft and changes views) sit on existing services; a pure `template_lint` service feeds readiness and the draft tools; `edit_template_draft` gains delete, move, reorder, option, section and instruction ops that dispatch to the existing template services. Search gains article grouping, reference exclusion and block-type filters.

**Tech Stack:** FastAPI, Pydantic v2, SQLAlchemy 2 async, Alembic, Postgres 17, MCP Python SDK, React 19 + TanStack Query + react-hook-form + Zod + Vitest + MSW.

**Scope:** 20 tasks, one PR. No spec link: the goal, the global constraints and the per-task requirements below are the contract.

## Global Constraints

- **Worktree.** `$WT` = `/Users/raphaelfedericcihaddad/PycharmProjects/prumo/.claude/worktrees/mcp-adjustments-config-agent-s4-d22977` (branch `feat/mcp-adjustments-config-agent`, cut from `origin/dev` at `f20aacf0`). Every command uses `git -C "$WT"` or absolute `$WT/...` paths; never touch the main checkout. Confirm with `git -C "$WT" status` that edits landed there. Never `git stash`. One implementer at a time: tasks run strictly in document order.
- **One PR.** The plan ships as one PR to `dev` (squash-merged), title `feat(mcp): configure a project's review question and questionnaire through MCP`. Each task ends in its own conventional commit (title given in the task). PR body tracker line, exactly: `Fixes PRU-83, PRU-97, PRU-98, PRU-99`. The body also carries the **Prompt change** note (projects that already filled eligibility or study design get a longer review question on new runs; runs that already made their first AI call keep theirs), the **Fingerprint** note (every draft fingerprint changes once because diff rows gain `affects_ai`; a Publish sheet open during deploy re-acknowledges through the existing drift path) and the **Deploy skew** note (a PICOTS save from a stale bundle carries no `expected_revision` and is accepted; last writer wins until reload).
- **Test-first.** Each task writes its failing test, runs it red and reads the failure, then implements; no "done" without the green command output read back.
- **Errors.** New REST domain errors subclass `AppError` (`backend/app/core/error_handler.py`) with an UPPER_SNAKE `code` and go through the global handler; endpoints add no bare `HTTPException` for them and declare the new status in `responses=` (`scripts/fitness/check_response_descriptions.py`). MCP tool errors use the existing `McpToolError` envelope (`code`, `message`, `next_step`, `retryable`, extras), never a docs URL or raw pydantic text; caller validation failures go through `app/api/mcp/errors.validation_failure`. A foreign project or resource is byte-identical to a missing one (`NOT_FOUND`).
- **Audit (MCP writes).** Audit goes through `app/api/mcp/audit.py` (`record_applied_write`, `refuse`). The applied row rides the write transaction, so a refusal rolls back the whole call. Codes in `AUDITED_CODES` (`app/api/mcp/errors.py`) write one refused `agent_actions` row; `NOT_FOUND`, `SCOPE_INSUFFICIENT`, `RATE_LIMITED` and role refusals log a span only. `AuditScope.template_id` is set only for template writes. A new error code updates `_SPECS`, `AUDITED_CODES` (when audited), `tests/unit/test_mcp_errors.py` and the matrix in `tests/integration/mcp/test_mcp_audit.py` in the same task.
- **New MCP tool checklist** (every task that registers a tool does all of these in the same task):
  - register with `app.api.mcp.server.agent_tool` (never `mcp.add_tool`); add the module to the import line in `backend/app/api/mcp/tools/__init__.py`;
  - annotation policy: reads are `requires="read", destructive=False` (idempotent default True); configuration writes are `requires="write", destructive=False` with an accurate `idempotent`; `tests/integration/mcp/test_mcp_choke_point.py::test_annotation_policy_is_pinned` stays green and `_HINT_ALLOWLIST` stays empty; no tool name contains `publish`, `clone` or `import`;
  - a static `description` with no reference to internal spec sections (`test_no_tool_listing_cites_internal_spec_sections`);
  - the result model declares `outputSchema` (return a pydantic model); add the tool to `_TRUSTED_PATHS` in `tests/integration/mcp/test_mcp_result_shape.py` and, when the result carries authored or article-derived strings, set `untrusted_content: Literal[True] = True` and an exact `untrusted_fields` default. The walker writes list items as `[]` and map values as `{}`, skips `const`/`enum`/`Literal` leaves and `uuid`/`date-time` formats, and demands exact set equality between declared and found untrusted paths;
  - add a call to the `calls` dict in `test_read_results_carry_raw_text_and_the_untrusted_flag` when the tool is a read; add the tool to `_coordinate_cases` in `tests/integration/mcp/test_mcp_bola.py` (`test_restriction_table_covers_every_coordinate_tool` fails otherwise) and an outsider `NOT_FOUND` case to `BOLA_CASES` (plus reviewer `MANAGER_REQUIRED` and read-token `SCOPE_INSUFFICIENT` cases for a manager write);
  - names next to ids: `project_name` (and `template_name` for a template result) appear once per result, never per row, capped with `app.utils.text_caps.cap_text`, read through `app.services.project_read_service.project_name`, and listed in `untrusted_fields`;
  - each result is at most 32,000 characters (`app.utils.compact_json.RESULT_CAP`); size is measured with `len(compact_json(model.model_dump(mode="json")))`.
- **Layering.** `backend/app/api/**` imports services and support modules only, never `app.models` or `app.repositories` (`scripts/fitness/check_layered_arch.py`). Services own their writes; endpoints and MCP tools commit. One ownership predicate, in the WHERE clause (`scripts/fitness/check_scope_guards.py` stays green).
- **Data path.** No new direct PostgREST read or write; frontend data goes through `apiClient` → service (`ErrorResult<T>` via `toResult`) → TanStack hook with factory keys. `scripts/fitness/check_frontend_data_path.py` baseline does not grow.
- **Migrations.** Two, in order: Task 3.1a (`0087_template_instrument`), then Task 3.2a-1 (`0088_protocol_revision`). Each migration task first confirms the head: `ls "$WT/backend/alembic/versions" | grep '^0' | sort | tail -1` must print the previous file (`0086_evidence_idx_hitl_fk.py` for 3.1a, `0087_template_instrument.py` for 3.2a-1). Revision id ≤ 32 characters, `down_revision` = previous head; move `expected_head` in `backend/tests/integration/test_migration_roundtrip.py::test_alembic_head_is_expected_revision` (line ~1334) and add a roundtrip test there modelled on `test_migration_0086_evidence_idx_hitl_fk_roundtrip` (~line 2127): at head the object exists; `_run_alembic("downgrade", "<parent>", database_url=migration_db_url)` removes it; `"upgrade", "head"` restores it; `rollback()` after each read. Short CHECK names (the `ck` naming convention expands them); the model declares the same CHECK so `alembic check` stays clean. Additive only, no seed data, never app-schema DDL through the Supabase MCP. After the task: `cd "$WT/backend" && uv run alembic upgrade head && uv run alembic check` (no diff). Run `bash scripts/fitness/check_migration_split.sh` and `check_rls_coverage.py` on migration tasks; no grant or policy changes.
- **Backend test infra.** `backend/.env` points `DATABASE_URL` at database `postgres_test_mcp_config_agent` on `localhost:55432` (stub + `alembic upgrade head` + seed applied) and `REDIS_URL=redis://localhost:56379/0`. Run `cd "$WT/backend" && uv run pytest <paths> -q`. Never the shared local Supabase stack; never `make db-fresh`/`make reset-db`; never print `.env`. A task that changes the seed re-seeds that database with `cd "$WT/backend" && uv run python -m app.seed`. **Every backend task's gate runs the full backend suite** (`uv run pytest tests -q`), not only the touched files.
- **No LLM in CI.** CI has no provider key. A test that reaches a model call uses the recorded fake (`tests/fakes/recorded_llm.RecordedLlm` with `tests/integration/helpers/engine_setup`, as `tests/integration/test_review_context_end_to_end.py` does) or monkeypatches the credential seam; no test reads a real key.
- **Coverage.** CI fails a PR whose diff coverage is under 80%. Lines reached only through httpx `ASGITransport` fixtures register no coverage, so each changed REST endpoint body also gets a direct unit test (handler called via `fn.__wrapped__`, as in `backend/tests/unit/test_ai_context_endpoints_unit.py`) and each service function a direct service-level test on `db_session`. MCP tools are covered by the in-process MCP client fixtures (`mcp_client`). Reproduce: `cd "$WT/backend" && uv run pytest tests/ --cov=app --cov-report=xml -q && uv run diff-cover coverage.xml --compare-branch=origin/dev --fail-under=80`.
- **No app-unused symbol at any task boundary.** Vulture scans `backend/app` only, so a function, constant or property lands in the task that adds its first `backend/app` caller (tests do not count). Each backend task ends with `cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec` green; the baseline never grows, and a deletion that removes a baselined name shrinks `backend/.vulture_baseline` in the same task.
- **File size.** `scripts/fitness/check_file_size.py` caps `backend/app` and `frontend` files at 800 lines; `scripts/fitness/check_file_size.baseline` freezes `backend/app/seed.py` at 3,250 (may shrink, never grow). `backend/app/services/extraction_agent_read_service.py` is at 792. Check `wc -l` of every file a task grows before committing; split into a module or package rather than exceed.
- **Fitness scripts** run from `$WT` with the backend venv first on PATH: `cd "$WT" && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/<script>.py`, and `cd "$WT" && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh` for the whole set.
- **Frontend tooling runs from the repo root** (`$WT`): `npx vitest run <file>`, `npm run test:run`, `npm run typecheck`, `npm run lint`, `npx knip`, `npx knip --production`. Never `cd frontend && npm ...`. If `$WT/node_modules` is missing or a symlink, run `cd "$WT" && npm ci` first. React Compiler rules: no `try/finally` and no `throw` inside `try` in a component or hook body; `useWatch`, never `form.watch()`.
- **REST contract change** (any edit to a schema class served by `/api/v1`, docstring included) ⇒ `cd "$WT" && npm run generate:api-types` and commit `frontend/types/api/schema.d.ts` + `frontend/types/api/openapi.json` in the same task, fixing any frontend typecheck break in that task. `npm run typecheck` is green at every task boundary.
- **No dead code.** A replaced path is deleted in the same task; orphans found outside the task go in a sibling `refactor(<area>): ...` commit. `npx knip` and `npx knip --production` stay at 0.
- **Copy** goes through `t(namespace, key)` from `frontend/lib/copy/`; `scripts/fitness/check_copy_keys.py` stays green. Query keys come from factories only (`check_react_query_keys.py`).
- **English only** in code, comments, commits, docs and copy keys.
- **Public wording.** This repo is public. Commit messages, the PR title/body and docs describe the intended behavior and the tests only, cite no local-only document, path or key, name no private project and carry no attack recipe.
- **Gates per task:** backend tasks — `cd "$WT" && make lint-backend` (ruff + format + mypy ratchet), `cd "$WT/backend" && uv run pytest tests -q`, the vulture command, `PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh`, `uv run alembic check` on model or migration tasks; frontend tasks — `npm run test:run`, `npm run lint`, `npm run typecheck`, `npx knip`, `npx knip --production`, `check_copy_keys.py`. Tasks that touch both run both sets.

## Task order

| Task | Title | Layer | Migration | Depends on |
|---|---|---|---|---|
| 3.1a | Stable instrument code on templates (migration 0087) | backend | **0087** | — |
| 3.1b | Instrument code in the portable format and the template reads | backend | no | 3.1a |
| 3.2a-1 | Protocol revision counter bumped by every protocol writer (migration 0088) | backend | **0088** | 3.1a |
| 3.2a-2 | Typed protocol shapes and revision compare-and-swap on the review question | backend + frontend types | no | 3.2a-1 |
| 3.2b | Eligibility and study design feed the AI review question; ADR 0023 | backend + frontend copy | no | 3.2a-2 |
| 3.3a-1 | Rename the review context to the review question (byte-identical prompts) | backend | no | 3.2b |
| 3.3a-2 | Runs pin the protocol revision; drift on the run view, MCP and the run screen | both | no | 3.3a-1 |
| 3.3b | Settings UI: protocol conflict banner and known-key saves | frontend | no | 3.2a-2 |
| 3.4a | `get_review_question` / `set_review_question` | backend | no | 3.3a-1, 3.2b |
| 3.4b | `list_template_catalogue` and a richer published `get_template` | backend | no | 3.1b |
| 3.5a | The `affects_ai` flag on draft changes | both | no | 3.4b |
| 3.5b | Template lint and the `get_template` draft and changes views | backend | no | 3.5a |
| 3.6a | `get_setup_readiness`: protocol, template and lint items | backend | no | 3.5b, 3.2a-1, 3.2b |
| 3.6b | `get_setup_readiness`: engine, reviewers, parser and article text items | backend | no | 3.6a |
| 3.7a-1 | Draft ops: delete, move and reorder questions; fingerprint guard | backend | no | 3.5b |
| 3.7a-2 | Draft ops: richer add/update question and `set_options` | backend | no | 3.7a-1 |
| 3.7b | Draft ops: sections and the template instruction | backend | no | 3.7a-2 |
| 3.8a | Search by article, reference exclusion and block-type filters | backend | no | — |
| 3.8b | Search syntax descriptions, page-range note and outline filter | backend | no | 3.8a |
| 3.9 | Docs, INSTRUCTIONS and the configuration scenario | backend + docs | no | all |

- Sequential by shared files: 3.3a-1 → 3.3a-2 → 3.4a edit `services/project_ai_context.py` / `services/run_prompt_context.py`; 3.1b → 3.4b → 3.5a → 3.5b → 3.7a-1 edit `api/mcp/tools/templates.py`, `schemas/mcp_templates.py` or `api/mcp/draft_diff.py`; 3.7a-1 → 3.7a-2 → 3.7b edit `api/mcp/tools/template_draft.py` and `services/agent_template_draft_service.py`; 3.6a → 3.6b edit `services/project_setup_readiness.py`.

## Review Focus

1. **No phantom revision bumps and no lost writes:** a same-value or description-only write never bumps `protocol_revision`; both writers bump inside the row lock they already hold (3.2a-1); a stale `expected_revision` writes nothing (3.2a-2, 3.4a).
2. **Prompt bytes:** an empty eligibility/study design leaves every existing prompt fixture byte-identical (3.2b); the rename is byte-identical (3.3a-1); a seeded clone whose name equals its instrument label keeps a byte-identical QA prompt (3.1a).
3. **Manager-only draft state:** draft and changes views, draft readiness items and every draft op refuse reviewers and read tokens; the published view leaks no draft data (3.5b, 3.6a, 3.7a-1).
4. **Atomic batches:** a failing op rolls back every earlier op in its call and writes one refused row; a destructive op without the current fingerprint never applies (3.7a-1…3.7b).
5. **Exact untrusted flags:** every new string leaf is either a server string in `_TRUSTED_PATHS` or listed in `untrusted_fields` (every MCP task).

---

### Task 3.1a: Stable instrument code on templates (migration 0087)

**Layer:** backend · **Migration:** yes (`0087_template_instrument`) · **Commit:** `feat(templates): stable instrument code on global and project templates`

**Goal:** every global and project template carries an `instrument` code (`charms`, `charms_mm`, `probast`, `probast_ai`, `quadas2`, `custom`); seeds set it on globals and converge it onto clones; a clone copies it; the QA prompt names the instrument from the code, not from a template name a manager can edit.

**Context:** `backend/app/models/extraction.py`: `ExtractionTemplateGlobal` (class ~L142, `__table_args__` ~L180 with a `CheckConstraint` at ~L186) and `ProjectExtractionTemplate` (class ~L197, `__table_args__` ~L287, `CheckConstraint` ~L291). `project_extraction_templates` writes are already revoked from `authenticated` (migration 0057); `extraction_templates_global` writes are service-role only (baseline policies): no grant or policy change. `backend/app/services/ai_extraction/service.py:55` `_qa_framework_label(template)` returns the template's name, falling back to `framework` (every QA template is `framework='CUSTOM'`), and is called at ~L304. `backend/app/services/template_clone_service.py:95` `TemplateCloneService.create_from_global`. `backend/app/services/template_create_service.create_blank_template` relies on column defaults. Seeds: `backend/app/seed.py` globals `seed_charms` (~L316, `ExtractionTemplateGlobal(id=_CHARMS_TEMPLATE_ID, name="CHARMS"…)` ~L329), `seed_probast` (~L1537, `_PROBAST_TEMPLATE_ID`, "PROBAST" ~L1550), `seed_quadas2` (~L1842, `_QUADAS2_TEMPLATE_ID`, "QUADAS-2" ~L1855), `seed_charms_mm` (~L2084, `_MM_TEMPLATE_ID`, "CHARMS + Multimodal (ML prediction)" ~L2105); `main()` ~L3222 calls them then `seed_probast_ai` (function-local import from `app.seed_probast_ai`, whose converge sets `template.name = "PROBAST+AI"` ~L720). `seed.py` is frozen at 3,250 lines by `scripts/fitness/check_file_size.baseline`: it must not grow.

**Files:**
- Create: `backend/alembic/versions/0087_template_instrument.py`
- Modify: `backend/tests/integration/test_migration_roundtrip.py` (head pin + roundtrip)
- Modify: `backend/app/models/extraction.py` (both template models)
- Modify: `backend/app/schemas/extraction.py` (`InstrumentCode`, `INSTRUMENT_LABELS`)
- Modify: `backend/app/services/ai_extraction/service.py` (`_qa_framework_label` → `instrument_label`)
- Modify: `backend/app/services/template_clone_service.py` (`create_from_global` copies the code)
- Create: `backend/app/seed_instrument.py`; Modify: `backend/app/seed.py` (`main()` calls it; no net growth), `backend/app/seed_probast_ai.py` (sets `probast_ai` in its converge)
- Modify: `scripts/fitness/check_layered_arch.py` (add `"seed_instrument"` to `ENTRYPOINTS`: every top-level `app` module must be classified, and an unclassified one makes the scan exit 2)
- Modify: `docs/reference/extraction-hitl-architecture.md` (the "Migration head:" line ~L138 → `0087_template_instrument`; frontmatter `last_reviewed:` → commit date)
- Test: new `backend/tests/integration/test_instrument_label.py`, `backend/tests/integration/test_qa_seed.py`, `backend/tests/integration/test_seed_convergence.py`

**Interfaces / schema:**
- Migration: `revision = "0087_template_instrument"`, `down_revision = "0086_evidence_idx_hitl_fk"`. On `public.extraction_templates_global` and `public.project_extraction_templates`: `instrument text NOT NULL DEFAULT 'custom'` with CHECK `instrument` = `instrument IN ('charms','charms_mm','probast','probast_ai','quadas2','custom')`. Downgrade drops both columns. No data written.
- Models: `instrument: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'custom'"))` plus `CheckConstraint("instrument IN (...)", name="instrument")` in each `__table_args__` (tuple still ends with `{"schema": "public"}`).
- `schemas/extraction.py`:
  ```python
  InstrumentCode = Literal["charms", "charms_mm", "probast", "probast_ai", "quadas2", "custom"]
  INSTRUMENT_LABELS: dict[str, str] = {
      "charms": "CHARMS",
      "charms_mm": "CHARMS + Multimodal (ML prediction)",
      "probast": "PROBAST",
      "probast_ai": "PROBAST+AI",
      "quadas2": "QUADAS-2",
  }  # "custom" has no fixed label: the template's own name
  ```
- `ai_extraction/service.py`: `def instrument_label(template: Any | None) -> str | None`: `None` → `None`; `INSTRUMENT_LABELS.get(template.instrument)` when set; otherwise (`custom`) the stripped template name, falling back to `framework` as today. No `getattr` branch for a missing attribute: the column is NOT NULL and CHECK-constrained. Replace the one call site and delete `_qa_framework_label`.
- `seed_instrument.py`: `GLOBAL_INSTRUMENTS: dict[UUID, str]` mapping `_CHARMS_TEMPLATE_ID → "charms"`, `_MM_TEMPLATE_ID → "charms_mm"`, `_PROBAST_TEMPLATE_ID → "probast"`, `_QUADAS2_TEMPLATE_ID → "quadas2"` (imported from `app.seed`), and `async def converge_instrument_codes(session: AsyncSession) -> None`: sets each listed global's `instrument` (UPDATE by id), then one statement copies the global's code to every clone: `UPDATE public.project_extraction_templates t SET instrument = g.instrument FROM public.extraction_templates_global g WHERE t.global_template_id = g.id AND t.instrument IS DISTINCT FROM g.instrument` (bound `text()`, idempotent).
- `seed.py` `main()`: add `from app.seed_instrument import converge_instrument_codes` to the existing function-local import block and `await converge_instrument_codes(session)` after `await seed_probast_ai(session)`. Offset the two added lines by tightening the existing comment above the function-local import (or another comment) so `wc -l backend/app/seed.py` stays ≤ 3,250.
- `seed_probast_ai.py`: in the converge block (~L720) add `template.instrument = "probast_ai"`.
- `check_layered_arch.py`: `ENTRYPOINTS` gains `"seed_instrument"` (exact names only; it is a composition root like the other seed modules).
- `create_from_global`: copy `instrument=global_template.instrument` onto the new `ProjectExtractionTemplate`.

- [ ] **Step 1: Write the failing tests.**
  - New `tests/integration/test_instrument_label.py`:
    - `@pytest.mark.parametrize("code,label", list(INSTRUMENT_LABELS.items()))` `test_known_code_yields_fixed_label`: `instrument_label(SimpleNamespace(instrument=code, name="My RoB form", framework="CUSTOM")) == label` (so a `probast_ai` template named "My RoB form" yields "PROBAST+AI").
    - `test_custom_yields_own_name`: `instrument_label(SimpleNamespace(instrument="custom", name=" Mine ", framework="CUSTOM")) == "Mine"`; `instrument_label(None) is None`; an empty name falls back to `"CUSTOM"`.
    - `test_seeded_clone_label_equals_name` (DB, `db_session`): for each seeded global whose `name` equals its label, `instrument_label(global_row) == global_row.name` (byte-identical QA prompt label).
    - `test_blank_template_reads_custom` (DB): a template made with `create_blank_template` for `SEED.primary_project` reads `instrument == "custom"`.
  - `tests/integration/test_qa_seed.py`: every seeded global has its code (`charms`, `charms_mm`, `probast`, `quadas2`, `probast_ai` by id).
  - `tests/integration/test_seed_convergence.py`: a clone created through `TemplateCloneService.create_from_global` inherits the code; a pre-existing clone whose `instrument` is set back to `custom` (`UPDATE ... SET instrument = 'custom'`) converges after `converge_instrument_codes(session)`. Running `converge_instrument_codes` twice is a no-op, and it leaves every clone's `config_draft_since` unchanged (the draft-marker triggers live on `extraction_entity_types`/`extraction_fields`, not on the template table; the test pins that).
  - `tests/integration/test_migration_roundtrip.py`: `expected_head = "0087_template_instrument"`; `test_migration_0087_template_instrument_roundtrip`: column present on both tables at head; gone after downgrade to `0086_evidence_idx_hitl_fk`; back after upgrade (query `information_schema.columns`). Also assert the CHECK constraints by name in `pg_constraint` (`conname` = `ck_extraction_templates_global_instrument` and `ck_project_extraction_templates_instrument`) at head, absent after downgrade and back after upgrade — `alembic check` does not compare CHECK constraints, so a mis-named or missing one passes it.

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/integration/test_instrument_label.py tests/integration/test_qa_seed.py tests/integration/test_seed_convergence.py tests/integration/test_migration_roundtrip.py -q` → FAIL.

- [ ] **Step 3: Implement** the migration, models, schema map, `instrument_label`, clone copy and seeds per Interfaces. Render the SQL first: `cd "$WT/backend" && uv run alembic upgrade 0086_evidence_idx_hitl_fk:0087_template_instrument --sql | grep -i instrument`. Then `uv run alembic upgrade head && uv run alembic check` and `uv run python -m app.seed`.

- [ ] **Step 4: Run green + gates.**
  ```bash
  cd "$WT/backend" && uv run pytest tests -q
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh \
    && bash scripts/fitness/check_migration_split.sh \
    && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/check_rls_coverage.py
  wc -l "$WT/backend/app/seed.py"   # ≤ 3250
  cd "$WT/backend" && uv run alembic check && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  ```
  Expected: PASS; `check_file_size` green; `check_layered_arch.py` exits 0 (not 2) with `app.seed_instrument` classified; no RLS change.

- [ ] **Step 5: Commit.** `git -C "$WT" add backend docs scripts/fitness/check_layered_arch.py && (cd "$WT" && bash scripts/docs/check-frontmatter.sh) && git -C "$WT" commit -m "feat(templates): stable instrument code on global and project templates"`

**Done when:** both tables carry a checked `instrument` code, seeds and clones set it, the QA prompt label comes from the code, `seed.py` did not grow, roundtrip and head pin pass, gates green.

---

### Task 3.1b: Instrument code in the portable format and the template reads

**Layer:** backend · **Migration:** no · **Commit:** `feat(templates): expose the instrument code in reads and the portable format`

**Goal:** the template catalogue, project template reads, MCP `get_project` template summaries and MCP `get_template` all carry `instrument`; the portable template file exports the code and imports a missing or unknown code as `custom`.

**Context:** after Task 3.1a both template models have `instrument` (default `custom`) and `backend/app/schemas/extraction.py` has `InstrumentCode` and `INSTRUMENT_LABELS`. `backend/app/schemas/template_portable.py:135` `PortableTemplate` (`extra="forbid"`; fields `prumo_template`, `kind`, `name`, `description`, `framework`, `version`, `llm_template_instruction`, `sections`); export/import in `backend/app/services/template_portable_service.py`. `backend/app/schemas/template_catalogue.py`: `GlobalTemplateSummaryRead` (L15-27, `from_attributes`), `ProjectTemplateRead` (L29+). `backend/app/schemas/mcp_projects.py:46` `McpTemplateSummary` built by `backend/app/services/project_read_service.template_summaries` (~L105). `backend/app/schemas/mcp_templates.py:55` `McpTemplateView`, built in `backend/app/api/mcp/tools/templates.py` `get_template` (envelope ~L135). The result-shape walker skips `Literal` leaves, so `instrument: InstrumentCode` adds no trusted or untrusted path.

**Files:**
- Modify: `backend/app/schemas/template_portable.py` (`PortableTemplate.instrument`)
- Modify: `backend/app/services/template_portable_service.py` (export writes, import reads)
- Modify: `backend/app/schemas/template_catalogue.py` (`GlobalTemplateSummaryRead.instrument`, `ProjectTemplateRead.instrument`)
- Modify: `backend/app/schemas/mcp_projects.py` (`McpTemplateSummary.instrument`), `backend/app/services/project_read_service.py` (`template_summaries`)
- Modify: `backend/app/schemas/mcp_templates.py` (`McpTemplateView.instrument`), `backend/app/api/mcp/tools/templates.py` (set it)
- Regenerate: `frontend/types/api/schema.d.ts`, `frontend/types/api/openapi.json`; update `frontend/lib/templateImport/exampleTemplate.json` (pinned by `backend/tests/unit/test_template_portable_example_drift.py`) only if that drift test requires it
- Test: new `backend/tests/unit/test_template_portable_instrument.py`, `backend/tests/integration/test_template_catalogue_read.py`, `backend/tests/integration/mcp/test_mcp_get_template.py`, `backend/tests/integration/mcp/test_mcp_project_tools.py`

**Interfaces:**
- `PortableTemplate.instrument: InstrumentCode = "custom"` with `field_validator("instrument", mode="before")`: `None`, a non-string or a value outside `InstrumentCode` → `"custom"` (an unknown code never refuses the file). Export (`template_portable_service`) writes the template's code; because export uses `exclude_defaults`, a `custom` template omits the key, which reads back as `custom`. Import sets `instrument` on the new project template from the parsed document.
- `GlobalTemplateSummaryRead.instrument: InstrumentCode`, `ProjectTemplateRead.instrument: InstrumentCode` (both `from_attributes`, read from the column).
- `McpTemplateSummary.instrument: InstrumentCode`; `template_summaries` selects it.
- `McpTemplateView.instrument: InstrumentCode`, set from the owned template row in `get_template`.

- [ ] **Step 1: Write the failing tests.**
  - New `tests/unit/test_template_portable_instrument.py`: a document with `"instrument": "probast_ai"` round-trips (`PortableTemplate.model_validate(doc).model_dump(mode="json", exclude_defaults=True)["instrument"] == "probast_ai"`); missing → `custom`; `"bogus"` → `custom`; `None` → `custom`.
  - `tests/integration/test_template_catalogue_read.py`: the extraction catalogue lists CHARMS with `instrument == "charms"`; a project template read carries its clone's code.
  - `tests/integration/test_template_portable_service.py`: exporting a `charms` clone writes `"instrument": "charms"`; importing that file creates a template whose `instrument == "charms"`; importing a file without the key creates `custom`.
  - `tests/integration/mcp/test_mcp_get_template.py`: `get_template` on `SEED.primary_template` returns `instrument` equal to the row's code.
  - `tests/integration/mcp/test_mcp_project_tools.py`: every `get_project` `templates[]` row has `instrument`.

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/unit/test_template_portable_instrument.py tests/integration/test_template_catalogue_read.py tests/integration/test_template_portable_service.py tests/integration/mcp/test_mcp_get_template.py tests/integration/mcp/test_mcp_project_tools.py -q` → FAIL.

- [ ] **Step 3: Implement** per Interfaces.

- [ ] **Step 4: Regenerate API types.** `cd "$WT" && npm run generate:api-types`; then `npm run typecheck` (fix any break the new required fields cause in frontend fixtures in this task).

- [ ] **Step 5: Run green + gates.**
  ```bash
  cd "$WT/backend" && uv run pytest tests -q
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh
  cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  cd "$WT" && npm run typecheck && npm run test:run && npx knip && npx knip --production
  ```
  Expected: PASS, including `test_mcp_result_shape.py` (no new string path) and `test_template_portable_example_drift.py`.

- [ ] **Step 6: Commit.** `git -C "$WT" add backend frontend && git -C "$WT" commit -m "feat(templates): expose the instrument code in reads and the portable format"`

**Done when:** the four reads and the portable format carry the code, unknown codes import as `custom`, types regenerated, gates green.

---

### Task 3.2a-1: Protocol revision counter bumped by every protocol writer (migration 0088)

**Layer:** backend · **Migration:** yes (`0088_protocol_revision`) · **Commit:** `feat(projects): protocol revision counter bumped by protocol writes`

**Goal:** `projects.protocol_revision` counts changes to the review protocol. One rule bumps it, called inside the row lock each writer already holds: the details write when eligibility, study design or review type changes, and the AI-context write when PICOTS or the "send to AI" switch changes. A no-op write never bumps.

**Context:** `backend/app/models/project.py:52` `Project`. `backend/app/services/project_details_service.py:55` `update_details` locks the row (`select(Project)...with_for_update()`), computes `changes = fields.model_dump(mode="json", exclude_unset=True)` and `before = _values(project, changes)`, then assigns each key. `backend/app/services/project_ai_context.py:226` `set_ai_context(db, project_id, *, picots, picots_enabled)` locks through `ProjectRepository.lock_for_update`, writes the switch through `ProjectRepository.update_settings_key(project_id, "ai_context", ...)` (which re-reads the locked row with `populate_existing`, so it runs first), then assigns `project.picots_config_ai_review`. `_picots_enabled(settings)` reads the switch (absent = ON). `projects.settings` has a single-writer rule (`tests/fitness/test_project_settings_single_writer.py`): never write `settings` outside `update_settings_key`.

**Files:**
- Create: `backend/alembic/versions/0088_protocol_revision.py`
- Modify: `backend/tests/integration/test_migration_roundtrip.py` (head pin + roundtrip)
- Modify: `backend/app/models/project.py` (`protocol_revision`)
- Create: `backend/app/services/project_protocol.py`
- Modify: `backend/app/services/project_details_service.py`, `backend/app/services/project_ai_context.py`
- Modify: `docs/reference/extraction-hitl-architecture.md` (the "Migration head:" line → `0088_protocol_revision`, so the doc matches the PR's head at merge; frontmatter `last_reviewed:` → commit date)
- Test: new `backend/tests/integration/test_project_protocol_revision.py`

**Interfaces / schema:**
- Migration: `revision = "0088_protocol_revision"`, `down_revision = "0087_template_instrument"`; `ALTER TABLE public.projects ADD COLUMN protocol_revision integer NOT NULL DEFAULT 1` with CHECK `protocol_revision` = `protocol_revision >= 1`. Downgrade drops it.
- Model: `protocol_revision: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))` and `CheckConstraint("protocol_revision >= 1", name="protocol_revision")` in `Project.__table_args__` (add a tuple ending with `{"schema": "public"}` if the model has a dict today).
- `services/project_protocol.py`:
  ```python
  PROTOCOL_DETAIL_KEYS: frozenset[str] = frozenset({"eligibility_criteria", "study_design", "review_type"})

  def bump_protocol_revision(project: Project) -> None:
      """Add one to the protocol revision. Call only inside the row lock, and only when a protocol value changed."""
      project.protocol_revision += 1  # NOT NULL DEFAULT 1, CHECK >= 1
  ```
- `update_details`: after the contested check, compute `changed = {k for k, v in changes.items() if before[k] != v}`; if `changed & PROTOCOL_DETAIL_KEYS`, call `bump_protocol_revision(project)` before the flush.
- `set_ai_context`: record `old_enabled = _picots_enabled(project.settings)` and `old_picots = project.picots_config_ai_review` right after the lock; after both writes, bump once when `picots_enabled is not None and picots_enabled != old_enabled` or `picots is not None and picots != old_picots`. The bump assignment happens after `update_settings_key` (its `populate_existing` re-read would discard an earlier unflushed assignment), then `await db.flush()`.

- [ ] **Step 1: Write the failing tests.** New `tests/integration/test_project_protocol_revision.py` (fixtures `db_session`; project `SEED.primary_project`; read the counter with `SELECT protocol_revision FROM public.projects WHERE id = :pid`):
  - `test_details_eligibility_bumps_once`: `update_details(fields={"eligibility_criteria": {...new...}}, expected={current})` → +1.
  - `test_details_review_type_bumps_once` → +1.
  - `test_details_description_only_does_not_bump` → +0.
  - `test_details_same_value_does_not_bump` (eligibility set to its current value) → +0.
  - `test_ai_context_picots_bumps_once`: `set_ai_context(picots=<changed>, picots_enabled=None)` → +1.
  - `test_ai_context_toggle_bumps_once`: flip the switch → +1; set it to its current value → +0.
  - `test_ai_context_both_halves_bump_once`: change picots and the switch in one call → +1.
  - Roundtrip: `expected_head = "0088_protocol_revision"`; `test_migration_0088_protocol_revision_roundtrip` (column present / gone after downgrade to `0087_template_instrument` / back), with the CHECK `ck_projects_protocol_revision` asserted in `pg_constraint` at each step.

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/integration/test_project_protocol_revision.py tests/integration/test_migration_roundtrip.py -q` → FAIL.

- [ ] **Step 3: Implement** per Interfaces; `cd "$WT/backend" && uv run alembic upgrade head && uv run alembic check`.

- [ ] **Step 4: Run green + gates.**
  ```bash
  cd "$WT/backend" && uv run pytest tests -q
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh \
    && bash scripts/fitness/check_migration_split.sh \
    && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/check_rls_coverage.py
  cd "$WT/backend" && uv run alembic check && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  ```
  Expected: PASS, including `tests/fitness/test_project_settings_single_writer.py`.

- [ ] **Step 5: Commit.** `git -C "$WT" add backend docs && (cd "$WT" && bash scripts/docs/check-frontmatter.sh) && git -C "$WT" commit -m "feat(projects): protocol revision counter bumped by protocol writes"`

**Done when:** each protocol writer bumps exactly once per real change and never on a no-op, roundtrip and head pin pass, gates green.

---

### Task 3.2a-2: Typed protocol shapes and revision compare-and-swap on the review question

**Layer:** backend + frontend types · **Migration:** no · **Commit:** `feat(projects): typed protocol shapes and revision check on the review question`

**Goal:** eligibility and study design have bounded, typed write shapes; PICOTS writes are bounded too while legacy over-bound rows still read; a review-question save can carry `expected_revision` and gets 409 `STALE_VALUE` when the protocol moved; slot-level updates replace only the named slots; the revision is visible on the AI-context read and on MCP `get_project`.

**Context:** after Task 3.2a-1, `projects.protocol_revision` exists and `bump_protocol_revision` is wired. `backend/app/schemas/project_ai_context.py`: `PicotsSlot` (L18, also the read model), `PicotsSlots` (L26, six keys `population`, `index_models`, `comparator_models`, `outcomes`, `timing`, `setting_and_intended_use`), `ProjectAiContextRead` (L37), `ProjectAiContextUpdate` (L50, `picots: PicotsSlots | None`, `picots_enabled`). `backend/app/api/v1/endpoints/ai_context.py`: `GET` (L39) builds the read model (~L52), `PUT` (L56). `backend/app/schemas/project_details.py`: `ProjectDetailsFields` (L23; `eligibility_criteria: dict[str, Any] | None`, `study_design: dict[str, Any] | None`), `ProjectDetailsUpdate` (L49; `expected: ProjectDetailsFields`). `backend/app/services/project_details_service.update_details` compares `expected.model_dump(mode="json", exclude_unset=True)` with stored values. MCP `backend/app/api/mcp/tools/project_details.py`: `_Details` advertises `inline_json_schema(ProjectDetailsFields)` (~L43), `_parse` (L113) validates both `fields` and `expected` through `_validated` → `ProjectDetailsFields`. `backend/app/schemas/mcp_projects.py:55` `McpProjectOverview`, built in `project_read_service.get_project_overview` (~L70). The frontend sends partial shapes such as `{inclusion: []}` today (`frontend/test/services/projectSettingsService.test.ts:59`). `ProjectDetailsRefusalCode.STALE_VALUE` already exists.

**Files:**
- Create: `backend/app/schemas/project_protocol.py`
- Modify: `backend/app/schemas/project_ai_context.py`, `backend/app/schemas/project_details.py`
- Modify: `backend/app/services/project_ai_context.py` (`set_ai_context`, `get_ai_context`, `StaleProtocolRevisionError`)
- Modify: `backend/app/services/project_details_service.py` (`expected` type)
- Modify: `backend/app/api/v1/endpoints/ai_context.py` (`expected_revision`, 409)
- Modify: `backend/app/api/mcp/tools/project_details.py` (`_parse`, advertised `expected` schema)
- Modify: `backend/app/schemas/mcp_projects.py` (`McpProjectOverview.protocol_revision`), `backend/app/services/project_read_service.py`
- Regenerate: `frontend/types/api/schema.d.ts`, `frontend/types/api/openapi.json`
- Test: new `backend/tests/unit/test_project_details_schema.py` cases (file exists), `backend/tests/integration/test_ai_context_endpoints.py`, `backend/tests/unit/test_ai_context_endpoints_unit.py`, `backend/tests/integration/test_project_details_api.py`, `backend/tests/integration/mcp/test_mcp_update_project_details.py`, `backend/tests/integration/mcp/test_mcp_project_tools.py`

**Interfaces:**
- `schemas/project_protocol.py` (all `ConfigDict(extra="forbid")`; every field has a default so partial shapes validate):
  ```python
  _Criterion = Annotated[str, StringConstraints(min_length=1, max_length=500)]
  class EligibilityCriteria(BaseModel):
      inclusion: list[_Criterion] = Field(default_factory=list, max_length=50)
      exclusion: list[_Criterion] = Field(default_factory=list, max_length=50)
      notes: str = Field(default="", max_length=2000)
  class StudyDesign(BaseModel):
      types: list[Annotated[str, StringConstraints(max_length=100)]] = Field(default_factory=list, max_length=30)
      notes: str = Field(default="", max_length=2000)
  class PicotsSlotWrite(BaseModel):
      description: str = Field(default="", max_length=2000)
      inclusion: list[Annotated[str, StringConstraints(max_length=500)]] = Field(default_factory=list, max_length=50)
      exclusion: list[Annotated[str, StringConstraints(max_length=500)]] = Field(default_factory=list, max_length=50)
  class PicotsSlotsWrite(BaseModel):  # the six PicotsSlots keys, each PicotsSlotWrite (default_factory)
      ...
  PicotsSlotKey = Literal["population", "index_models", "comparator_models", "outcomes", "timing", "setting_and_intended_use"]
  ```
  (Notes default `""`; the schema module's docstring says notes never reach prompts.)
- `ProjectAiContextUpdate`: `model_config = ConfigDict(extra="forbid")`; `picots: PicotsSlotsWrite | None = None`; `picots_enabled: bool | None = None`; `expected_revision: int | None = Field(default=None, ge=1)`. `PicotsSlot`/`PicotsSlots` stay unbounded (read model). `ProjectAiContextRead` gains `revision: int`.
- `ProjectDetailsFields.eligibility_criteria: EligibilityCriteria | None`, `study_design: StudyDesign | None` (the not-null validator still applies). New `ProjectDetailsExpected(BaseModel)`: `extra="forbid"`, the same 11 keys with loose types (`dict[str, Any] | None` for the two JSON columns, the others as in `ProjectDetailsFields` but without bounds) so a legacy-shaped stored row can be echoed. `ProjectDetailsUpdate.expected: ProjectDetailsExpected`; `update_details(..., expected: ProjectDetailsExpected)`; the canonical-JSON compare is unchanged.
- `project_ai_context.py`:
  ```python
  class StaleProtocolRevisionError(AppError):
      def __init__(self, *, current_revision: int, current: dict[str, Any]) -> None:
          super().__init__(code="STALE_VALUE", message="The review question changed since you read it.",
                           status_code=409, details={"current_revision": current_revision, "current": current})

  async def set_ai_context(db, project_id, *, picots: dict[str, Any] | None, picots_enabled: bool | None,
                           expected_revision: int | None = None,
                           slot_updates: dict[str, dict[str, Any]] | None = None) -> dict[str, Any]
  ```
  Under the lock, before any write: if `expected_revision is not None and expected_revision != project.protocol_revision`, raise `StaleProtocolRevisionError(current_revision=project.protocol_revision, current=await get_ai_context(...))` (build `current` from the locked row, nothing written). `slot_updates` replaces only the named slot keys of the stored PICOTS (merged into a new dict; plain JSONB tracks reassignment only). `picots` and `slot_updates` are mutually exclusive (`ValueError` if both). The bump rule from Task 3.2a-1 applies to the merged result. `get_ai_context` adds `"revision": project.protocol_revision`.
- Endpoint `PUT /{project_id}/ai-context`: passes `body.expected_revision`; `responses={409: {"description": "The review question changed since it was read (STALE_VALUE)."}}`. Omitted `expected_revision` keeps saving (deploy skew).
- MCP `_parse`: validate `expected` with `ProjectDetailsExpected` (`validation_failure(exc, prefix="expected")`), `fields` with `ProjectDetailsFields`; the `expected` argument advertises `inline_json_schema(ProjectDetailsExpected)` (a second `Annotated` alias next to `_Details`).
- `McpProjectOverview.protocol_revision: int`, read from the project row.

- [ ] **Step 1: Write the failing tests.**
  - `tests/unit/test_project_details_schema.py`: `EligibilityCriteria.model_validate({"inclusion": []})` ok; unknown key refused; 51 items refused; a 501-char item refused; `StudyDesign` 31 types refused; `ProjectDetailsFields(eligibility_criteria={"inclusion": ["x"], "extra": 1})` refused; `ProjectDetailsExpected(eligibility_criteria={"legacy": True})` accepted; `PicotsSlotsWrite` refuses an unknown slot key and a 2,001-char description.
  - `tests/integration/test_ai_context_endpoints.py`: stale `expected_revision` → 409, `body["error"]["code"] == "STALE_VALUE"`, `error.details.current_revision` equals the stored revision, row unchanged; omitted `expected_revision` still saves; matching one saves and the response `revision` is +1; a stored slot planted with 60 inclusion items (`UPDATE public.projects SET picots_config_ai_review = ...`) still reads (`GET` 200).
  - `tests/unit/test_ai_context_endpoints_unit.py`: the handler (`update_ai_context.__wrapped__`) forwards `expected_revision`.
  - `tests/integration/test_project_details_api.py`: a malformed `eligibility_criteria` in `fields` → 422; a legacy stored row (planted `{"legacy": "x"}`) echoed in `expected` is replaced (200).
  - New service test in `tests/integration/test_project_protocol_revision.py`: `slot_updates={"population": {...}}` replaces only `population`; `picots` + `slot_updates` together raise `ValueError`.
  - `tests/integration/mcp/test_mcp_update_project_details.py`: a legacy-shaped `eligibility_criteria` echoed in `expected` applies; a malformed one in `fields` gives one audited `INVALID_ARGUMENT` whose `field` starts with `eligibility_criteria`.
  - `tests/integration/mcp/test_mcp_project_tools.py`: `get_project` returns `protocol_revision`.

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/unit/test_project_details_schema.py tests/unit/test_ai_context_endpoints_unit.py tests/integration/test_ai_context_endpoints.py tests/integration/test_project_details_api.py tests/integration/test_project_protocol_revision.py tests/integration/mcp/test_mcp_update_project_details.py tests/integration/mcp/test_mcp_project_tools.py -q` → FAIL.

- [ ] **Step 3: Implement** per Interfaces.

- [ ] **Step 4: Regenerate API types and fix the frontend compile.** `cd "$WT" && npm run generate:api-types`. `ProjectAiContextRead.revision` becomes required in generated types; fix only the typecheck breaks in this task (test fixtures, `frontend/services/aiContextService.ts` types); behavior changes in the UI are Task 3.3b.

- [ ] **Step 5: Run green + gates.**
  ```bash
  cd "$WT/backend" && uv run pytest tests -q
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh
  cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  cd "$WT" && npm run typecheck && npm run test:run && npm run lint && npx knip && npx knip --production
  ```
  Expected: PASS, including `check_response_descriptions.py` and `check_api_response_envelope.py`.

- [ ] **Step 6: Commit.** `git -C "$WT" add backend frontend && git -C "$WT" commit -m "feat(projects): typed protocol shapes and revision check on the review question"`

**Done when:** typed bounded writes, loose `expected`, 409 on a stale revision with nothing written, slot updates, revision on both reads, types regenerated, gates green.

---

### Task 3.2b: Eligibility and study design feed the AI review question; ADR 0023

**Layer:** backend + frontend copy · **Migration:** no · **Commit:** `feat(ai): eligibility and study design join the AI review question`

**Goal:** the review question every AI call is prefixed with renders, after the unchanged PICOTS lines, the project's eligibility (include/exclude) and eligible study designs when they are non-empty; notes never render; one cap and the one "send to AI" switch govern the whole block; the editor preview stays byte-identical to the prompt block; the decision is recorded as ADR 0023.

**Context:** `backend/app/services/project_ai_context.py`: `render_picots_block(picots, review_type)` (L131) caps at `MAX_REVIEW_CONTEXT_CHARS = 4000` (L34) with `…`; `build_review_context(db, project_id)` (L170) returns `None` when the switch is off; `get_ai_context` (L209) builds `preview` with `render_picots_block`. `backend/app/services/run_prompt_context.py:58` `resolve_run_prompt_context` pins `ReviewContextPin(text=await build_review_context(...))` (renamed in Task 3.3a-1, not here). Stored eligibility/study design may be legacy-shaped dicts (no data migration), so the renderer reads tolerantly. `frontend/lib/copy/aiContext.ts`: `sectionDesc` (L12), `previewHint` (L28, promises "the exact text prefixed to every AI call"). ADRs are MADR files under `docs/adr/` with frontmatter `status`, `last_reviewed`, `owner`, `adr_number` (see `docs/adr/0022-oauth-for-mcp.md`); next number is 0023.

**Files:**
- Modify: `backend/app/services/project_ai_context.py` (`render_review_question`, `ReviewQuestion`, `build_review_context` return type, preview)
- Modify: `backend/app/services/run_prompt_context.py` (read `.text` from the new return)
- Create: `docs/adr/0023-review-protocol.md`
- Modify: `frontend/lib/copy/aiContext.ts` (`sectionDesc`, `previewHint`)
- Test: `backend/tests/unit/test_project_ai_context.py`, `backend/tests/integration/test_ai_context_endpoints.py`, `backend/tests/integration/test_review_context_end_to_end.py`

**Interfaces:**
- `def render_review_question(picots: Any, review_type: str | None, eligibility: Any, study_design: Any) -> str | None`:
  - the PICOTS lines first, exactly as `render_picots_block` renders them today;
  - then, only when non-empty: `Eligibility:` followed by `  Include: a; b` and/or `  Exclude: c` (each line only when its list is non-empty), then `Eligible study designs: x; y`;
  - list items are read tolerantly (non-list or non-string items skipped, stripped, empty dropped); `notes` are never rendered;
  - `None` when nothing renders; one `MAX_REVIEW_CONTEXT_CHARS` cap over the whole block (truncate to cap−1 and append `…`).
  `render_picots_block` is deleted (its body becomes the PICOTS half; no second caller remains).
- `@dataclass(frozen=True, slots=True) class ReviewQuestion: text: str | None; revision: int`.
- `build_review_context(db, project_id) -> ReviewQuestion | None` (renamed in Task 3.3a-1): one project fetch; `None` when the project is missing; `ReviewQuestion(text=None, revision=...)` when the switch is off; otherwise the rendered text and `project.protocol_revision`.
- `get_ai_context`'s `preview` = `render_review_question(...)` over the same row when enabled (byte-identical to `build_review_context(...).text`).
- `resolve_run_prompt_context`: pins `text=(rq.text if rq else None)`; behavior otherwise unchanged in this task.
- ADR 0023 (`status: accepted`, `adr_number: '0023'`, `owner: '@raphaelfh'`, `last_reviewed:` commit date), MADR sections Context / Decision / Consequences: PICOTS slot criteria are per element; project eligibility covers cross-cutting criteria (language, publication type, dates); eligibility include/exclude and study-design types feed prompts after PICOTS under one cap and one switch; notes do not; `review_keywords`, `search_strategy`, `condition_studied`, `review_rationale` and the free-text `review_context` column do not feed prompts; runs keep the question they pinned.
- Copy: `sectionDesc` mentions that eligibility and study design from the project details are sent too; `previewHint` stays a promise of exactness and names both sources.

- [ ] **Step 1: Write the failing tests.**
  - `tests/unit/test_project_ai_context.py`: for every existing PICOTS fixture, `render_review_question(p, rt, None, None) == <its previous render_picots_block expectation>` and `render_review_question(p, rt, {"inclusion": [], "exclusion": []}, {"types": []})` too (byte-identical); fixed order (PICOTS, Eligibility, designs); `notes` never appear; a legacy dict (`{"legacy": 1}`) and non-string items are ignored; over-cap input ends with `…` and has length `MAX_REVIEW_CONTEXT_CHARS`; eligibility alone (empty PICOTS) renders only the eligibility lines.
  - `tests/integration/test_ai_context_endpoints.py`: with eligibility set on the project, `GET /ai-context` `preview` contains `Eligibility:` and `  Include:`; with the switch off, `preview` is `null`.
  - `tests/integration/test_review_context_end_to_end.py` (recorded LLM fake, as the file already does): a new run's prompt contains the eligibility lines; a run pinned before the eligibility edit keeps its pinned text without them.

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/unit/test_project_ai_context.py tests/integration/test_ai_context_endpoints.py tests/integration/test_review_context_end_to_end.py -q` → FAIL.

- [ ] **Step 3: Implement** the renderer, `ReviewQuestion`, the builder, the preview and the pin read; write ADR 0023 and the copy.

- [ ] **Step 4: Run green + gates.**
  ```bash
  cd "$WT/backend" && uv run pytest tests -q
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh
  cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  cd "$WT" && npm run test:run && npm run lint && npx knip && npx knip --production \
    && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/check_copy_keys.py \
    && bash scripts/docs/check-frontmatter.sh
  ```
  Expected: PASS; every prompt fixture without eligibility unchanged.

- [ ] **Step 5: Commit.** `git -C "$WT" add backend docs frontend && git -C "$WT" commit -m "feat(ai): eligibility and study design join the AI review question"`

**Done when:** the renderer adds eligibility and designs after PICOTS with byte-identical output otherwise, preview equals the prompt block, ADR 0023 accepted, gates green.

---

### Task 3.3a-1: Rename the review context to the review question (byte-identical prompts)

**Layer:** backend · **Migration:** no · **Commit:** `refactor(extraction): name the project review question consistently`

**Goal:** one name for one concept: code that reads or passes the project's review question says "review question". Prompt text, the stored JSONB key and run behavior are unchanged.

**Context:** after Task 3.2b, `build_review_context` returns `ReviewQuestion | None`. Names to rename and where they live:
- `backend/app/services/run_prompt_context.py`: `read_pinned_review_context` (L44), `ReviewContextPin` import, `RunPromptContext(review_context=...)`.
- `backend/app/services/project_ai_context.py`: `build_review_context` (L170; also named in the module docstring ~L11).
- `backend/app/schemas/run_prompt_context.py`: `ReviewContextPin` (L15), `RunPromptContext.review_context` (L35).
- `backend/app/llm/prompts/__init__.py:28` `render_review_context_section`, imported by `quality_assessment.py`, `section_extraction.py`, `entry_identification.py`; `review_context` parameters in `app/llm/prompts/{__init__,section,section_extraction,quality_assessment,entry_identification}.py`.
- `backend/app/services/ai_extraction/_sections.py:255` and `_model_calls.py:97` (`review_context=context.review_context`).
- `backend/app/services/extraction_run_read_service.py:76,451` (`read_pinned_review_context`).
- `backend/app/schemas/project_ai_context.py:9` docstring mention.
- Tests: `backend/tests/unit/llm/test_review_context_prompt.py`, `backend/tests/unit/test_extraction_prompt_input.py`, `backend/tests/integration/test_project_read_service.py`, `backend/tests/integration/test_run_review_context_pin.py`, `backend/tests/integration/test_review_context_end_to_end.py`.
Kept, because they are storage names: the `freeze_provenance_key` Literal `"review_context"` (`backend/app/repositories/extraction_run_repository.py:223`), `_PIN_KEY = "review_context"` in `run_prompt_context.py:41`, the `projects.review_context` column and its `ProjectDetails*`/MCP `details.review_context` fields (a different, free-text column). `RunViewResponse.review_context` (`schemas/extraction_run.py:415`) is replaced in Task 3.3a-2, not here.

**Files:** every file listed in Context except the kept ones.

**Renames (exact):**
- `read_pinned_review_context` → `read_pinned_review_question`
- `build_review_context` → `build_review_question`
- `ReviewContextPin` → `ReviewQuestionPin` (fields unchanged in this task: `text`)
- `RunPromptContext.review_context` → `review_question`
- `render_review_context_section` → `render_review_question_section`
- every `review_context` parameter/keyword in the prompt modules and `ai_extraction/_sections.py`, `_model_calls.py` → `review_question`
- test names and helpers that embed the old names follow; rename `tests/unit/llm/test_review_context_prompt.py` → `tests/unit/llm/test_review_question_prompt.py` (`git mv`). `test_run_review_context_pin.py` is renamed in Task 3.3a-2.

- [ ] **Step 1: Pin the prompt bytes first (red-proof of a no-op).** Run `cd "$WT/backend" && uv run pytest tests/unit/llm tests/unit/test_extraction_prompt_input.py tests/integration/test_review_context_end_to_end.py -q` → PASS on the pre-rename tree; record the pass count. Then rename the test-side references first (imports of the new names) and run the same command → FAIL with `ImportError` (red).

- [ ] **Step 2: Rename** the production names per the list (`grep -rn "review_context\|ReviewContextPin\|render_review_context_section" "$WT/backend/app"` afterwards must show only the kept storage names, the `projects.review_context` column/details fields and `RunViewResponse.review_context`).

- [ ] **Step 3: Run green + gates.**
  ```bash
  cd "$WT/backend" && uv run pytest tests/unit/llm tests/unit/test_extraction_prompt_input.py -q   # same count, unchanged fixtures
  cd "$WT/backend" && uv run pytest tests -q
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh
  cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  ```
  Expected: PASS with no prompt fixture edited (only imports and names in tests); vulture baseline entries naming an old symbol are renamed, never added.

- [ ] **Step 4: Commit.** `git -C "$WT" add backend && git -C "$WT" commit -m "refactor(extraction): name the project review question consistently"`

**Done when:** only storage names keep `review_context`, prompt fixtures untouched and green, gates green.

---

### Task 3.3a-2: Runs pin the protocol revision; drift on the run view, MCP and the run screen

**Layer:** both · **Migration:** no · **Commit:** `feat(runs): show when a run's review question differs from the current protocol`

**Goal:** a run's review-question pin records the protocol revision it was built from; the run view and MCP `get_extractions` report drift when the project's protocol has moved since; the run screen shows a quiet chip explaining it. Legacy pins (text only) still read and never show drift.

**Context:** after Task 3.3a-1: `backend/app/schemas/run_prompt_context.py` `ReviewQuestionPin{text}`; `backend/app/services/run_prompt_context.py` `read_pinned_review_question(results)`, `resolve_run_prompt_context` pins `ReviewQuestionPin(text=rq.text).model_dump()` through `ExtractionRunRepository.freeze_provenance_key(run.id, _PIN_KEY, ...)` (first writer wins, key `"review_context"` kept). `build_review_question` returns `ReviewQuestion(text, revision)`. Run view: `backend/app/services/extraction_run_read_service.py` `build_run_view` (~L451 reads the pin, ~L480 sets `review_context=`), `RunViewResponse.review_context` (`backend/app/schemas/extraction_run.py:415`). MCP: `backend/app/services/extraction_agent_read_service.py` (792 lines; ceiling 800) `list_agent_extractions` builds `McpRunRef` (`backend/app/schemas/mcp_extractions.py:22`). Frontend: `frontend/hooks/runs/types.ts` (hand-written run view types; no review-question field today), `frontend/components/runs/RunScreenShell.tsx` (292 lines), copy `frontend/lib/copy/runs.ts`, test `frontend/test/RunScreenShell.test.tsx`. Existing tests asserting the old pin shape: `backend/tests/integration/test_review_context_end_to_end.py:90,122` (`{"text": ...}`), `backend/tests/integration/test_run_review_context_pin.py`.

**Files:**
- Modify: `backend/app/schemas/run_prompt_context.py` (`ReviewQuestionPin.revision`)
- Modify: `backend/app/services/run_prompt_context.py` (pin revision; `review_question_drift` helper)
- Modify: `backend/app/schemas/extraction_run.py` (`RunViewResponse`), `backend/app/services/extraction_run_read_service.py`
- Modify: `backend/app/schemas/mcp_extractions.py` (`McpRunRef.review_question_drift`), `backend/app/services/extraction_agent_read_service.py` (≤ +8 lines)
- Modify: `frontend/hooks/runs/types.ts`, `frontend/components/runs/RunScreenShell.tsx`, `frontend/lib/copy/runs.ts`
- Regenerate: `frontend/types/api/schema.d.ts`, `frontend/types/api/openapi.json`
- Test: `git mv backend/tests/integration/test_run_review_context_pin.py backend/tests/integration/test_run_review_question_pin.py`; `backend/tests/integration/test_review_context_end_to_end.py`; `backend/tests/integration/mcp/test_mcp_get_extractions.py`; `frontend/test/RunScreenShell.test.tsx`

**Interfaces:**
- `ReviewQuestionPin`: `text: str | None = None`, `revision: int | None = None` (a legacy `{"text": ...}` pin validates with `revision=None`).
- `resolve_run_prompt_context`: pins `ReviewQuestionPin(text=rq.text if rq else None, revision=rq.revision if rq else None).model_dump()`.
- `def review_question_drift(pin: ReviewQuestionPin | None, current_revision: int | None) -> bool | None` in `run_prompt_context.py`: `None` when `pin is None`; `False` when `pin.revision is None` (legacy) or `current_revision is None`; else `pin.revision != current_revision`.
- `RunViewResponse`: delete `review_context`; add `review_question: str | None = None`, `review_question_revision: int | None = None`, `review_question_drift: bool = False` (the run view coerces `None` → `False`). `build_run_view` reads the project's `protocol_revision` once (the run's own `project_id`).
- `McpRunRef.review_question_drift: bool | None` (`None` when nothing is pinned). `list_agent_extractions` reads the project's `protocol_revision` once per call and calls the helper per run; the file grows by at most 8 lines (`wc -l` ≤ 800).
- Frontend `hooks/runs/types.ts` run-view type gains `review_question_drift: boolean` and `review_question_revision: number | null` (and `review_question: string | null`); `RunScreenShell` renders, only when `review_question_drift` is true, a muted chip `t('runs', 'reviewQuestionChanged')` with a tooltip `t('runs', 'reviewQuestionChangedTooltip')` interpolating the pinned revision N and the current revision M (pass M from the run view: add `project_protocol_revision: int | None` to `RunViewResponse` and the TS type for this). Loading and error states are the screen's own; no chip.
- Copy (`runs.ts`): `reviewQuestionChanged: 'Review question changed'`, `reviewQuestionChangedTooltip: 'This run keeps the review question from its first AI call (revision {{pinned}}). New runs use revision {{current}}.'` (use the interpolation helper the runs namespace already uses).

- [ ] **Step 1: Write the failing tests.**
  - `tests/integration/test_run_review_question_pin.py` (after `git mv`): a run pinned at revision 1 shows `review_question_drift is True` and `project_protocol_revision == 2` on the run view after a PICOTS save (`set_ai_context` with a changed slot); a run created after that save pins revision 2 with no drift; a legacy pin planted as `{"text": "x"}` reads with `review_question == "x"`, `review_question_revision is None` and no drift.
  - `tests/integration/test_review_context_end_to_end.py:90,122`: expect `{"text": ..., "revision": N}` (N = the project's revision at pin time).
  - `tests/integration/mcp/test_mcp_get_extractions.py`: `articles[].run.review_question_drift` is `None` for an unpinned run, `False` right after the pin, `True` after a protocol change.
  - `frontend/test/RunScreenShell.test.tsx`: no chip when `review_question_drift` is false; the chip and its tooltip text (N and M) when true.

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/integration/test_run_review_question_pin.py tests/integration/test_review_context_end_to_end.py tests/integration/mcp/test_mcp_get_extractions.py -q` and `cd "$WT" && npx vitest run frontend/test/RunScreenShell.test.tsx` → FAIL.

- [ ] **Step 3: Implement** per Interfaces; regenerate types with `cd "$WT" && npm run generate:api-types`.

- [ ] **Step 4: Run green + gates.**
  ```bash
  cd "$WT/backend" && uv run pytest tests -q
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh
  cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  wc -l "$WT/backend/app/services/extraction_agent_read_service.py"   # ≤ 800
  cd "$WT" && npm run test:run && npm run typecheck && npm run lint && npx knip && npx knip --production \
    && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/check_copy_keys.py
  ```
  Expected: PASS; `test_mcp_result_shape.py` unchanged (a bool adds no path).

- [ ] **Step 5: Design check.** Render the run screen with a drifted run at desktop and narrow widths (the `design-review` skill); the chip is muted, non-blocking and does not wrap the header.

- [ ] **Step 6: Commit.** `git -C "$WT" add backend frontend && git -C "$WT" commit -m "feat(runs): show when a run's review question differs from the current protocol"`

**Done when:** pins carry the revision, drift reads correctly on the run view and MCP (legacy pins never drift), the chip shows only on drift, gates green.

---

### Task 3.3b: Settings UI: protocol conflict banner and known-key saves

**Layer:** frontend · **Migration:** no · **Commit:** `feat(settings): review question conflict banner and safe protocol saves`

**Goal:** the PICOTS editor sends the revision it loaded and, when another manager or an agent saved first, shows a banner with Reload instead of overwriting; the advanced settings save never sends unknown eligibility/study-design keys while still echoing the raw stored value as `expected`; inclusion, exclusion and study types say they are sent to the AI.

**Context:** after Task 3.2a-2 the AI-context read carries `revision`, `PUT /ai-context` accepts `expected_revision` and answers 409 `STALE_VALUE` (`error.details.current_revision`), and details writes refuse unknown eligibility/study-design keys with 422. Files: `frontend/components/project/PicotsPane.tsx` (276 lines), `frontend/hooks/project/useAiContext.ts` (`useAiContext`, `useSetAiContext` L34), `frontend/services/aiContextService.ts`, `frontend/services/projectSettingsService.ts` (`toDetailsFields`), `frontend/hooks/useProjectSettings.ts` (L106 builds `expected` through `toDetailsFields`; it already invalidates `projectKeys.aiContext(projectId)` after a details save, pinned in `frontend/test/hooks/useProjectSettings.test.tsx`), `frontend/components/project/settings/AdvancedSettingsSection.tsx` (L30, L53-62 `ensureEligibility`/`ensureStudyDesign`; study-types row hint `advancedCardStudyTypesDesc` at L192, copy `frontend/lib/copy/project.ts:120`), `frontend/types/project.ts` (hand-written `EligibilityCriteria` L134, `StudyDesign` L141). `apiClient` throws `ApiError` (`code`, `status`); services return `ErrorResult<T>`; `SettingsRow` takes a single `hint`.

**Files:**
- Modify: `frontend/services/aiContextService.ts`, `frontend/hooks/project/useAiContext.ts`, `frontend/components/project/PicotsPane.tsx`
- Modify: `frontend/services/projectSettingsService.ts`, `frontend/hooks/useProjectSettings.ts`
- Modify: `frontend/components/project/settings/AdvancedSettingsSection.tsx`, `frontend/types/project.ts` (drop the two hand-written interfaces; import the generated `components['schemas']['EligibilityCriteria']` / `['StudyDesign']`)
- Modify: `frontend/lib/copy/aiContext.ts`, `frontend/lib/copy/project.ts`
- Test: new `frontend/test/components/PicotsPane.test.tsx`; `frontend/test/services/projectSettingsService.test.ts`; `frontend/test/hooks/useProjectSettings.test.tsx`; `frontend/test/components/AdvancedSettingsSection.test.tsx`

**Interfaces:**
- `aiContextService.setAiContext(projectId, body)` accepts `expected_revision?: number`; on failure it returns `{ ok: false, error }` with the `ApiError` (`code === 'STALE_VALUE'`, `status === 409`) preserved.
- `useSetAiContext` passes `expected_revision` through; the mutation does not invalidate on a 409.
- `PicotsPane` / `PicotsForm`: the form sends the revision **it was seeded with**, never the live query value. Today `PicotsPane` passes the live `data` as `initial` and keys the form by `formSeq`, so a background refetch (a details save invalidates `projectKeys.aiContext`; `refetchOnReconnect` is on) moves `data.revision` under unsaved edits. Fix: `PicotsForm` captures its seed once at mount, `const [seed] = useState(() => initial)`, and uses `seed.revision` as `expected_revision` and `seed.picots`/`seed.picots_enabled` for its dirty baseline; the form remounts (new seed) only through the existing `formSeq` reset (Cancel, after a successful save, Reload). Never re-key by `data.revision`: that would silently wipe unsaved edits on a refetch.
  On a `STALE_VALUE` result `PicotsPane` sets a local `conflict` state; renders an inline banner (`t('aiContext', 'conflictBanner')`) with a Reload button (`t('aiContext', 'conflictReload')`); Save is disabled while `conflict`. Reload awaits `refetch()` of the `projectKeys.aiContext(projectId)` query (from `useAiContext`), then bumps `formSeq` (re-seeding from the fresh data) and clears `conflict` (use `.then(...)`, no `try/finally` in the component). Other errors keep the existing toast.
- `toDetailsFields` strips unknown keys of `eligibility_criteria` (keeps `inclusion`, `exclusion`, `notes`) and `study_design` (keeps `types`, `notes`) — `fields` only. `useProjectSettings` builds `expected` as the raw `pick(snapshot, keys)` (no `toDetailsFields`), so the server's canonical-JSON compare matches a legacy row. `ensureEligibility`/`ensureStudyDesign` and the "keeps well-shaped values" test keep accepting a partial `{inclusion: []}`.
- A details save answered 422 shows the existing error toast and keeps the form's edits.
- `AdvancedSettingsSection`: inclusion and exclusion rows take hint `t('project', 'advancedSentToAiHint')`; the study-types row's hint becomes `` `${t('project', 'advancedCardStudyTypesDesc')} ${t('project', 'advancedSentToAiHint')}` `` (appended, not replaced).
- Copy: `aiContext.conflictBanner: 'The review question changed since you opened it — another manager or an agent saved it. Reload to see it; your unsaved edits will be lost.'`, `aiContext.conflictReload: 'Reload'`, `project.advancedSentToAiHint: 'Sent to the AI with the review question.'`.

**PicotsPane states (all must hold):** loading → existing skeletons; load error → existing message, Save unreachable; saving → pending button; saved → toast; generic save error → toast; conflict → banner, Save disabled until Reload; non-manager → `PicotsPreview`.

- [ ] **Step 1: Write the failing tests.**
  - New `frontend/test/components/PicotsPane.test.tsx` (MSW):
    - the PUT handler answers 409 `{ok:false, error:{code:'STALE_VALUE', message:'…', details:{current_revision: 3}}}` → the banner text appears, Save is disabled; the PUT body carried `expected_revision` equal to the loaded `revision`; clicking Reload refetches (GET called twice) and the form shows the fresh slot text with Save enabled.
    - `sends the seeded revision after a background refetch`: GET returns revision 3; the user edits a slot; the GET handler switches to revision 4 with different slot text and the test calls `queryClient.invalidateQueries({queryKey: projectKeys.aiContext(pid)})` and waits until the cache holds revision 4; the user's edit is still in the field; Save → the PUT body has `expected_revision: 3` (not 4); the PUT handler answers 409 `STALE_VALUE` whenever `expected_revision !== 4` → the conflict banner shows and nothing is overwritten.
    - a non-409 failure (500) shows the existing save-error toast and no banner; after a 409 the GET handler is called no extra time until Reload (the mutation does not invalidate on a 409).
  - `frontend/test/services/projectSettingsService.test.ts`: `toDetailsFields` drops `eligibility_criteria.extra` and `study_design.legacy`; the existing "keeps well-shaped values" case still passes `{inclusion: []}`.
  - `frontend/test/hooks/useProjectSettings.test.tsx`: a legacy eligibility row with an extra key saves without a 409 — the PATCH body's `fields` carries no unknown key and `expected` carries the raw snapshot including it; a details save still invalidates the ai-context key; a PATCH answered 422 shows the error toast.
  - `frontend/test/components/AdvancedSettingsSection.test.tsx`: the hint renders under inclusion and exclusion; the study-types row shows its existing text followed by the hint.

- [ ] **Step 2: Run red.** `cd "$WT" && npx vitest run frontend/test/components/PicotsPane.test.tsx frontend/test/services/projectSettingsService.test.ts frontend/test/hooks/useProjectSettings.test.tsx frontend/test/components/AdvancedSettingsSection.test.tsx` → FAIL.

- [ ] **Step 3: Implement** per Interfaces.

- [ ] **Step 4: Run green + gates.**
  ```bash
  cd "$WT" && npm run test:run && npm run typecheck && npm run lint && npx knip && npx knip --production \
    && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/check_copy_keys.py \
    && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/check_react_query_keys.py \
    && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/check_frontend_data_path.py
  ```
  Expected: PASS; knip reports nothing for the removed hand-written types.

- [ ] **Step 5: Design check.** Render the conflict banner in PicotsPane at desktop and narrow widths (`design-review` skill); the banner sits above the form, uses existing alert styling, and Reload is keyboard-focusable.

- [ ] **Step 6: Commit.** `git -C "$WT" add frontend && git -C "$WT" commit -m "feat(settings): review question conflict banner and safe protocol saves"`

**Done when:** the form sends the revision it was seeded with even after a background refetch, a stale save shows the banner and never overwrites, saves strip unknown keys from `fields` only, hints render, gates green.

---

### Task 3.4a: `get_review_question` / `set_review_question`

**Layer:** backend · **Migration:** no · **Commit:** `feat(mcp): read and write the review question with a revision check`

**Goal:** an agent reads the project's review question (slots with their labels, eligibility, study design, the exact preview the AI gets, and the revision) and, as a manager with a `read_write` token, replaces named PICOTS slots or flips the "send to AI" switch, guarded by `expected_revision`. Every write writes one applied or refused audit row.

**Context:** after Tasks 3.2a-2 and 3.3a-1: `backend/app/services/project_ai_context.py` has `get_ai_context(db, project_id)` (read model with `picots`, `labels`, `review_type`, `picots_enabled`, `preview`, `revision`), `set_ai_context(db, project_id, *, picots, picots_enabled, expected_revision=None, slot_updates=None)` raising `StaleProtocolRevisionError` (`details={current_revision, current}`) and `ProjectNotFoundError`, `labels_for(review_type)`, `build_review_question(db, project_id) -> ReviewQuestion | None`. `backend/app/schemas/project_protocol.py` has `PicotsSlotWrite`, `PicotsSlotKey`, `EligibilityCriteria`, `StudyDesign`. The choke point (`backend/app/api/mcp/server.py::_dispatch`) already answers `SCOPE_INSUFFICIENT` (read token on a write tool, and hides write tools from `tools/list`), `NOT_FOUND` (non-member/foreign) and `MANAGER_REQUIRED` (a member who is not a manager calling a write tool), without audit rows. The audited write pattern to copy is `backend/app/api/mcp/tools/project_details.py` (`AuditScope`, `_apply` with `record_applied_write` + `db.commit()` inside the try, `refuse(db, scope, with_names(error, project_name=name))`, deadlock → `RETRY`, `reject_nul`, `validation_failure`, arguments advertised with `WithJsonSchema(inline_json_schema(...))` and validated in the tool so malformed input is an audited `INVALID_ARGUMENT`).

**Files:**
- Create: `backend/app/schemas/mcp_review_question.py`, `backend/app/api/mcp/tools/review_question.py`
- Modify: `backend/app/api/mcp/tools/__init__.py` (import line)
- Modify: `backend/app/services/project_ai_context.py` (`get_review_question_view`, the one read used by the tool)
- Test: new `backend/tests/integration/mcp/test_mcp_review_question.py`; `backend/tests/integration/mcp/test_mcp_result_shape.py`; `backend/tests/integration/mcp/test_mcp_bola.py`; `backend/tests/integration/mcp/test_mcp_audit.py`; `backend/tests/integration/mcp/test_mcp_choke_point.py` (annotation test unchanged, must stay green)

**Interfaces:**
- `schemas/mcp_review_question.py`:
  ```python
  class McpReviewSlot(BaseModel):
      label: str; description: str; inclusion: list[str]; exclusion: list[str]
  class McpEligibility(BaseModel):
      inclusion: list[str]; exclusion: list[str]; notes: str
  class McpStudyDesign(BaseModel):
      types: list[str]; notes: str
  class McpReviewQuestion(BaseModel):
      project_id: UUID; project_name: str; revision: int; review_type: str | None
      picots_enabled: bool; slots: dict[str, McpReviewSlot]
      eligibility: McpEligibility; study_design: McpStudyDesign
      preview: str | None; note: str | None
      untrusted_content: Literal[True] = True
      untrusted_fields: list[str] = ["project_name", "slots{}.description", "slots{}.inclusion[]",
          "slots{}.exclusion[]", "eligibility.inclusion[]", "eligibility.exclusion[]", "eligibility.notes",
          "study_design.types[]", "study_design.notes", "preview"]
  ```
  `_TRUSTED_PATHS["get_review_question"] = _TRUSTED_PATHS["set_review_question"] = {"review_type", "slots{}.label", "note"}`.
- `project_ai_context.get_review_question_view(db, project_id) -> McpReviewQuestion` (typed, like `build_setup_readiness`; services may import `app.schemas`): one `get_ai_context(...)` read — its `preview` is already `render_review_question` over the same row, byte-identical to `build_review_question(...).text` (Task 3.2b pins that), so no second project fetch — plus `eligibility` and `study_design` from that same row through the one tolerant list reader the renderer uses (the module's `_texts`-style reader from Task 3.2b; non-list → `[]`, non-string items dropped, missing notes → `""`), never a second copy. Each slot carries its label from `labels_for(review_type)`; `project_name` comes from `project_read_service.project_name`, capped. The tool sets only `note`.
- `get_review_question(project_id: UUID) -> McpReviewQuestion`: `@agent_tool(requires="read", project_arg="project_id", title="Get review question", destructive=False, description=...)`. Returns `get_review_question_view(...)` with `note = "No review question yet"` when every slot, eligibility and design list is empty; else `None`.
- `set_review_question(project_id: UUID, expected_revision: int, slots: <dict advertised as dict[PicotsSlotKey, PicotsSlotWrite]> | None = None, picots_enabled: bool | None = None) -> McpReviewQuestion`: `@agent_tool(requires="write", project_arg="project_id", title="Set review question", destructive=False, idempotent=True, description=...)`. In the audited try: `reject_nul`; at least one of `slots`/`picots_enabled` (else audited `INVALID_ARGUMENT` "name at least one of slots or picots_enabled", `field="slots"`); validate each slot key against `PicotsSlotKey` and value with `PicotsSlotWrite` (`validation_failure(exc, prefix=f"slots.{key}")`; unknown key → `INVALID_ARGUMENT` with `field="slots.<key>"`); call `set_ai_context(db, project_id, picots=None, picots_enabled=picots_enabled, expected_revision=expected_revision, slot_updates={k: v.model_dump() ...})`; `record_applied_write(before={"revision": r0, "slots": <named slots before>}, after={"revision": r1, "slots": <named slots after>, "picots_enabled": ...})`; commit. `StaleProtocolRevisionError` → `McpToolError(STALE_VALUE, "The review question changed since it was read.", current_revision=..., current=<capped read model dict>, untrusted_content=True, untrusted_fields=["current"])`. Deadlock → `RETRY`. `AuditScope(tool="set_review_question", project_id=..., template_id=None, input={...})`. The result is the fresh `get_review_question_view(...)` with `note = "Runs that already made their first AI call keep the review question they started with."`
- Descriptions (static): the read says it returns the exact text the AI receives and the revision to pass to `set_review_question`; the write says slots are replaced whole per named key, `expected_revision` is required, and eligibility and study design are edited with `update_project_details`, which bumps the same revision.

**Tool states:** `get_review_question` success → read model; empty → empty slots, `preview=null`, note; refusals `NOT_FOUND`, `RATE_LIMITED`. `set_review_question` applied → read model + note; refusals `STALE_VALUE`, `INVALID_ARGUMENT`, `SCOPE_INSUFFICIENT`, `MANAGER_REQUIRED`, `NOT_FOUND`, `RATE_LIMITED`, `RETRY`.

- [ ] **Step 1: Write the failing tests.** New `tests/integration/mcp/test_mcp_review_question.py` (fixtures `mcp_client`, `pat_primary_rw`, `pat_primary_read`, `pat_reviewer_rw`, `db_session`; project `SEED.primary_project`; call helpers `call_tool`, `error_payload`, `structured` from `tests/integration/mcp/tool_calls.py`; an `_audit_count(db, *, outcome)` helper like the one in `test_mcp_edit_template_draft.py`):
  - `test_round_trip_changes_preview_and_revision`: read → `set_review_question(expected_revision=r, slots={"population": {"description": "Adults", "inclusion": ["ICU"], "exclusion": []}})` → result `revision == r + 1`, `preview` contains "Adults", one applied `agent_actions` row with `template_id IS NULL`.
  - `test_stale_revision_is_refused`: `expected_revision=r - 1` (after one write) → `STALE_VALUE`, `current_revision == r`, row unchanged, one refused row.
  - `test_partial_slots_leave_others_alone`: writing `population` keeps a pre-set `outcomes` slot.
  - `test_nothing_to_change_is_invalid_argument` and `test_unknown_slot_is_invalid_argument` (each one refused row).
  - `test_read_token_cannot_see_or_call_write` (absent from `tools/list`; call → `SCOPE_INSUFFICIENT`); `test_reviewer_is_manager_required`.
  - `test_empty_project_reads_note`: a project with empty PICOTS/eligibility/design → `preview is None`, `note == "No review question yet"`.
  - `test_results_carry_project_name`.
  - `test_mcp_result_shape.py`: add both `_TRUSTED_PATHS` keys and a `get_review_question` call to `calls`.
  - `test_mcp_bola.py`: `_coordinate_cases` gains both tools (`set_review_question` with `{"project_id": b, "expected_revision": 1, "picots_enabled": True}`); `BOLA_CASES` gains outsider `NOT_FOUND` for both, reviewer `MANAGER_REQUIRED` and read-token `SCOPE_INSUFFICIENT` for the write.
  - `test_mcp_audit.py`: the matrix gains a `set_review_question` applied case and a `STALE_VALUE` refused case.

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/integration/mcp/test_mcp_review_question.py tests/integration/mcp/test_mcp_result_shape.py tests/integration/mcp/test_mcp_bola.py tests/integration/mcp/test_mcp_audit.py -q` → FAIL.

- [ ] **Step 3: Implement** per Interfaces.

- [ ] **Step 4: Run green + gates.**
  ```bash
  cd "$WT/backend" && uv run pytest tests -q
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh
  cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  ```
  Expected: PASS, including `test_annotation_policy_is_pinned` and `check_layered_arch.py`.

- [ ] **Step 5: Commit.** `git -C "$WT" add backend && git -C "$WT" commit -m "feat(mcp): read and write the review question with a revision check"`

**Done when:** both tools work per the states table, the write is CAS-guarded and audited, result shape/BOLA/audit tests updated, gates green.

---

### Task 3.4b: `list_template_catalogue` and a richer published `get_template`

**Layer:** backend · **Migration:** no · **Commit:** `feat(mcp): template catalogue and a richer questionnaire read`

**Goal:** an agent lists the global templates it could ask a manager to import (with instrument and whether the project already has each one) and reads the published questionnaire with its instruction, section descriptions and entry labels, units and the question flags that matter. Import stays human-only.

**Context:** `backend/app/services/template_catalogue_service.py:25` `list_global_templates(db, *, kind)` returns `GlobalTemplateSummaryRead` rows (`id`, `name`, `description`, `framework`, `version`, `kind`, `entity_types_count`, and `instrument` after Task 3.1b); nothing records whether a project already imported a global (`project_extraction_templates.global_template_id` does). `backend/app/api/mcp/tools/template_draft.py` builds `editor_url` from `settings.PUBLIC_APP_URL` and `_EDITOR_TAB = {"extraction": "tab=extraction&extractionTab=configuration", "quality_assessment": "tab=quality&qaTab=configuration"}`. `backend/app/api/mcp/tools/templates.py` `get_template` (envelope ~L135; `_section` ~L247, `_question` ~L261, `_options` ~L274, `_page_sections` ~L184 charges section headers and questions against the cap). `backend/app/schemas/mcp_templates.py`: `McpTemplateQuestion` (`field_id`, `name`, `label`, `description`, `type`, `options`, `instructions`, `required`), `McpTemplateSection` (`section_id`, `name`, `label`, `parent_section_id`, `cardinality`, `continued`, `questions`), `McpTemplateView` (`template_id`, `name`, `kind`, `instrument`, `published_version`, `narrow`, `draft_open`, `sections`, `draft_diff`, `next_cursor`, `untrusted_fields` with `"name"` at L67). `RunViewEntityType` carries `description`, `entry_label`, `is_required`; `RunViewField` carries `unit`, `allowed_units` (`Any`), `is_required`, `is_entity_key`, `allows_not_applicable`, `allows_not_evaluated`, `allows_no_information`, `allow_other`. `get_active_version_tree(...)` returns `.version_id` and `.entity_types`; `backend/app/services/extraction_snapshot.general_instructions_for_version(db, version_id)` returns the version's instruction; `backend/app/services/template_instruction_service.get_template_instruction` computes `default_instruction` from the global's `llm_template_instruction`. `backend/tests/integration/mcp/test_mcp_option_contract.py` pins option parity between `get_template` and `get_extractions` and must stay green.

**Files:**
- Create: `backend/app/utils/app_urls.py` (`editor_url(project_id, kind)`; a support module so both MCP tools and services may import it — `app/api` is a layer services must not import, `scripts/fitness/check_layered_arch.py`); Modify: `backend/app/api/mcp/tools/template_draft.py` (use it; delete `_EDITOR_TAB` and the local URL builder)
- Create: `backend/app/api/mcp/tools/catalogue.py`, `backend/app/schemas/mcp_catalogue.py`; Modify: `backend/app/api/mcp/tools/__init__.py`
- Modify: `backend/app/services/template_catalogue_service.py` (`list_catalogue_for_project`)
- Modify: `backend/app/schemas/mcp_templates.py`, `backend/app/api/mcp/tools/templates.py`
- Modify: `backend/app/services/template_instruction_service.py` only if a public read of the default instruction by template is needed (prefer calling `get_template_instruction`)
- Test: new `backend/tests/integration/mcp/test_mcp_template_catalogue.py`; `backend/tests/integration/mcp/test_mcp_get_template.py`; `backend/tests/unit/test_mcp_get_template_paging.py`; `backend/tests/integration/mcp/test_mcp_result_shape.py`; `backend/tests/integration/mcp/test_mcp_bola.py`

**Interfaces:**
- `app_urls.editor_url(project_id: UUID, kind: str) -> str` = `f"{settings.PUBLIC_APP_URL.rstrip('/')}/projects/{project_id}?{tab}"` with the two-kind tab map (moved from `template_draft.py`); imports only `app.core.config.settings` (support → support).
- `template_catalogue_service.list_catalogue_for_project(db, *, project_id, kind) -> list[tuple[GlobalTemplateSummaryRead, bool]]`: `list_global_templates(db, kind=kind)` plus ONE query `select(ProjectExtractionTemplate.global_template_id).where(ProjectExtractionTemplate.project_id == project_id, ProjectExtractionTemplate.global_template_id.is_not(None))` → the bool per row.
- `schemas/mcp_catalogue.py`: `McpCatalogueRow{global_template_id: UUID, name: str, description: str | None, instrument: InstrumentCode, entity_types_count: int, already_in_project: bool}`; `McpTemplateCatalogue{project_id: UUID, project_name: str, kind: Literal["extraction","quality_assessment"], rows: list[McpCatalogueRow], note: str | None, next_step: str, untrusted_content: Literal[True] = True, untrusted_fields = ["project_name", "rows[].name", "rows[].description"]}`. `_TRUSTED_PATHS["list_template_catalogue"] = {"next_step", "note"}`.
- `list_template_catalogue(project_id: UUID, kind: Literal["extraction", "quality_assessment"]) -> McpTemplateCatalogue` (read, member). `note = "No global templates of this kind."` when empty. `next_step` = "A manager imports a template in prumo at <editor_url(project_id, kind)>. Importing publishes version 1 and, for extraction, replaces the active template." Description says there is no clone or import tool.
- `McpTemplateView`: `name` → `template_name`; add `project_name: str`, `instruction: str | None`, `instruction_is_default: bool`. `instruction` = `general_instructions_for_version(db, active.version_id)` (None when there is no active version); `instruction_is_default` = the template has a global and `instruction == default_instruction` (from `get_template_instruction`). `untrusted_fields`: replace `"name"` with `"template_name"`; add `"project_name"`, `"instruction"`, `"sections[].description"`, `"sections[].entry_label"`, `"sections[].questions[].unit"`, `"sections[].questions[].allowed_units[]"`.
- `McpTemplateSection` gains `description: str | None`, `entry_label: str | None`, `required: bool`.
- `McpTemplateQuestion` gains `unit: str | None`, `allowed_units: list[str] | None` (strings only; non-list → None), `flags: list[str]` = the true ones, in this order, among `required` (`is_required`), `entity_key` (`is_entity_key`), `allows_not_applicable`, `allows_not_evaluated`, `allows_no_information`, `allow_other`; delete `required`. `_TRUSTED_PATHS["get_template"]` gains `"sections[].questions[].flags[]"`.
- `_page_sections`/`_section_header_cost` charge the new bytes (they measure the built models, so building the new fields is enough; verify the size-cap test).
- The `get_template` description explains `narrow`, `instrument` and that `flags` lists only true flags.

- [ ] **Step 1: Write the failing tests.**
  - New `tests/integration/mcp/test_mcp_template_catalogue.py`: `kind="extraction"` lists CHARMS (`charms`) and CHARMS + Multimodal (`charms_mm`); `kind="quality_assessment"` lists PROBAST, QUADAS-2 and PROBAST+AI with codes; after a REST clone of CHARMS into the project (`clone_charms` helper), that row's `already_in_project is True`; the result carries `project_name`; `kind="bogus"` → `INVALID_ARGUMENT`; `tools/list` has no tool named with publish, clone or import (already asserted by the choke-point test — keep green).
  - `tests/integration/mcp/test_mcp_get_template.py`: on a seeded clone, `instruction_is_default is True` and `instruction` equals the global's; after `set_template_instruction` + publish of an edited instruction, `instruction_is_default is False`; a question with `is_required` and `is_entity_key` has `flags == ["required", "entity_key", "allows_no_information"]` (adjust to the field's real flags) and no `required` key; the result has `project_name` and `template_name` and no `name`; the existing size-cap test still holds.
  - `tests/unit/test_mcp_get_template_paging.py`: update builders for the renamed/added fields.
  - `test_mcp_result_shape.py`: `list_template_catalogue` key + call; `get_template` trusted gains `sections[].questions[].flags[]`.
  - `test_mcp_bola.py`: `_coordinate_cases` + outsider `NOT_FOUND` case for `list_template_catalogue`.

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/integration/mcp/test_mcp_template_catalogue.py tests/integration/mcp/test_mcp_get_template.py tests/unit/test_mcp_get_template_paging.py tests/integration/mcp/test_mcp_result_shape.py tests/integration/mcp/test_mcp_bola.py -q` → FAIL.

- [ ] **Step 3: Implement** per Interfaces.

- [ ] **Step 4: Run green + gates.**
  ```bash
  cd "$WT/backend" && uv run pytest tests -q
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh
  cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  wc -l "$WT/backend/app/api/mcp/tools/templates.py"   # ≤ 800
  ```
  Expected: PASS, including `test_mcp_option_contract.py` and `test_mcp_edit_template_draft.py` (editor URL unchanged).

- [ ] **Step 5: Commit.** `git -C "$WT" add backend && git -C "$WT" commit -m "feat(mcp): template catalogue and a richer questionnaire read"`

**Done when:** the catalogue tool lists globals with `instrument` and `already_in_project`, `get_template` carries the new fields with `project_name`/`template_name`, result-shape and BOLA updated, gates green.

---

### Task 3.5a: The `affects_ai` flag on draft changes

**Layer:** both · **Migration:** no · **Commit:** `feat(templates): flag draft changes that alter the AI input`

**Goal:** every draft diff row says whether it changes what the AI receives (`affects_ai`), on REST and in the Publish sheet as an "AI input" badge, so a manager (and later an agent) sees which edits change extraction prompts or the AI output schema.

**Context:** `backend/app/services/template_versioning/_diff.py`: `ChangeKind` (L58), `ATTRIBUTE_TIERS` (L141, includes `cardinality`); option reorders are `REORDERED` rows with `attribute="allowed_values"`; instruction rows are `ADDED`/`REMOVED`/`MODIFIED` with `attribute="llm_template_instruction"` (from `_diff_instruction`). `backend/app/services/template_versioning/_diff_read.py:172` `_to_row(change, *, affects_recorded_data)` builds `TemplateChangeRowRead` (`backend/app/schemas/hitl_session.py:582`); rows with `attribute=None` are section/field add, remove, move and reorder. The attributes that reach the AI on dev: `llm/schema.py` (field label, description, `llm_description`, options, required, type, name), the prompts (template instruction, labels), entity identification (`is_entity_key`, `entry_label`, `cardinality`: `llm/prompts/entry_identification.py`, `ai_extraction/_sections.py`). The `allows_*` flags are read only when AI values land (`ai_extraction/landing.py`, `_candidates.py`) and are excluded. The diff `fingerprint` hashes `model_dump` of the rows, so the new field changes every fingerprint once (the Publish sheet's existing drift path re-acknowledges). Frontend: `frontend/components/extraction/template-config/TemplateConfigDiffSheet.tsx` (504 lines; `ATTRIBUTE_COPY` L80, attribute label lookup ~L203), tests `frontend/test/TemplateConfigDiffSheet.test.tsx`, copy `frontend/lib/copy/templateConfig.ts`.

**Files:**
- Modify: `backend/app/services/template_versioning/_diff.py` (`AI_INPUT_ATTRIBUTES`), `backend/app/services/template_versioning/_diff_read.py` (`_to_row`), `backend/app/schemas/hitl_session.py` (`TemplateChangeRowRead.affects_ai`)
- Modify: `frontend/components/extraction/template-config/TemplateConfigDiffSheet.tsx`, `frontend/lib/copy/templateConfig.ts`
- Regenerate: `frontend/types/api/schema.d.ts`, `frontend/types/api/openapi.json`
- Test: `backend/tests/unit/test_template_diff_read.py`; `backend/tests/unit/test_template_diff_fingerprint.py` (only if it pins literal fingerprint strings); `frontend/test/TemplateConfigDiffSheet.test.tsx`

**Interfaces:**
- `_diff.py`: `AI_INPUT_ATTRIBUTES: frozenset[str] = frozenset({"label", "description", "llm_description", "llm_template_instruction", "allowed_values", "is_required", "field_type", "name", "is_entity_key", "entry_label", "cardinality"})` next to `ATTRIBUTE_TIERS`, commented: prompt and AI output-schema inputs only; flags read only when AI values land (`allows_*`) are excluded.
- `TemplateChangeRowRead.affects_ai: bool` (docstring: true when the change alters the prompt or the AI output schema; every add, remove, move and reorder of a node is true).
- `_to_row` sets `affects_ai = change.attribute is None or change.attribute in AI_INPUT_ATTRIBUTES` (any `kind`).
- Frontend: a row with `affects_ai` renders a small badge `t('templateConfig', 'diffAffectsAiBadge')` (copy `'AI input'`) next to its attribute label, using the sheet's existing badge component and classes. No new attribute key is emitted, so `check_diff_attribute_copy.py` is unaffected.

- [ ] **Step 1: Write the failing tests.**
  - `tests/unit/test_template_diff_read.py`: `affects_ai` true for each member of `AI_INPUT_ATTRIBUTES` (parametrized, including `cardinality`), false for `unit`, `allowed_units`, `other_label`, `allows_not_applicable`, `allows_not_evaluated`, `allows_no_information`; true for an added field, a removed section, a moved field and a field reorder (all `attribute=None`); true for an option reorder (`REORDERED`, `allowed_values`) and for an instruction set from empty (`ADDED`, `llm_template_instruction`). Build `TemplateChange` objects the way the file's existing cases do.
  - `frontend/test/TemplateConfigDiffSheet.test.tsx`: a row with `affects_ai: true` shows "AI input"; a row with `affects_ai: false` does not.

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/unit/test_template_diff_read.py -q` and `cd "$WT" && npx vitest run frontend/test/TemplateConfigDiffSheet.test.tsx` → FAIL.

- [ ] **Step 3: Implement** per Interfaces; `cd "$WT" && npm run generate:api-types`; fix test fixtures (backend and frontend) that build `TemplateChangeRowRead` rows without `affects_ai`.

- [ ] **Step 4: Run green + gates.**
  ```bash
  cd "$WT/backend" && uv run pytest tests -q
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh
  cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  cd "$WT" && npm run test:run && npm run typecheck && npm run lint && npx knip && npx knip --production \
    && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/check_copy_keys.py \
    && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/check_diff_attribute_copy.py
  ```
  Expected: PASS (fingerprint tests compare computed values, so they move together; a test pinning a literal fingerprint string is updated to the new value).

- [ ] **Step 5: Design check.** Render the Publish diff sheet with mixed rows at desktop and narrow widths (`design-review` skill); the badge does not push a row onto a second line at 375 px.

- [ ] **Step 6: Commit.** `git -C "$WT" add backend frontend && git -C "$WT" commit -m "feat(templates): flag draft changes that alter the AI input"`

**Done when:** every REST diff row carries `affects_ai` per the rule, the sheet badges it, types regenerated, gates green.

---

### Task 3.5b: Template lint and the `get_template` draft and changes views

**Layer:** backend · **Migration:** no · **Commit:** `feat(mcp): draft and changes views of a questionnaire with lint`

**Goal:** a pure lint service finds questionnaire problems that block or weaken AI extraction; a manager's agent reads the exact unpublished draft (`view="draft"`, with fingerprint and lint) and every change Publish would apply (`view="changes"`, paged, with `affects_recorded_data` and `affects_ai`); the published view's capped diff carries the fingerprint and row ids. Reviewers get `MANAGER_REQUIRED` for both new views. (The lint service lands here because the draft view is its first app caller.)

**Context:** after Tasks 3.4b and 3.5a. Lint inputs: `backend/app/schemas/extraction_run.py` `RunViewEntityType` (`label`, `entry_label`, `parent_entity_type_id`, `cardinality` `"one"|"many"`, `fields`) and `RunViewField` (`label`, `field_type`, `allowed_values: list[OptionItem] | None`, `llm_description`, `description`, `is_entity_key`). `backend/app/services/entity_key.py:65` `MissingEntityKeyError` is raised for a `many` section with no `is_entity_key` field. `backend/app/llm/schema.py:55` `_description(field)` falls back from `llm_description` to `description`. The frontend customize-slot pattern `/\[customize:[^\]]*\]/g` is defined twice: `frontend/components/extraction/TemplateInstructionControl.tsx:14` and `frontend/components/extraction/TemplateInstructionPane.tsx:13`. `backend/tests/unit/test_template_versioning_boundary.py` forbids importing `template_versioning` underscore modules outside that package.
Views: `backend/app/api/mcp/tools/templates.py` `get_template(db, project_id, template_id, cursor=None)` pages sections with `_page_sections(tree, start, budget)` over a cursor `(section position, question position)` (`decode_cursor(cursor, arity=2)`, `_validated_start`), builds the page-1 `draft_diff` with `capped_diff(get_template_config_diff(...))` for managers only (`is_project_manager`), and measures the envelope with `_json_len` before paging. `backend/app/api/mcp/draft_diff.py` `capped_diff` (row cap 40) builds `McpDraftDiff{status, counts, changes: list[McpDraftChange{tier, variant, label_path, attribute, before, after}], changes_truncated}`; `McpDraftDiff` is also `edit_template_draft`'s `diff` (`backend/app/schemas/mcp_template_draft.py`). `get_template_config_diff` returns `TemplateConfigDiffRead{status, changes: buckets additive/cosmetic/semantic/destructive of TemplateChangeRowRead (id, variant, tier, label_path, attribute, before, after, affects_recorded_data, affects_ai), fingerprint}`; only status `available` carries rows; `initial_version` and `baseline_too_old` carry none and `fingerprint=None`. `backend/app/services/extraction_snapshot.live_entity_types(db, *, template_id)` returns the live (draft) tree; the live instruction is the owned template row's `llm_template_instruction`. `encode_cursor`/`decode_cursor` (`backend/app/utils/opaque_cursor.py`) take `str | int` items. `templates.py` must stay ≤ 800 lines.

**Files:**
- Create: `backend/app/schemas/template_lint.py`, `backend/app/services/template_lint.py`
- Modify: `backend/app/api/mcp/tools/templates.py` (`view` argument, dispatch)
- Create: `backend/app/api/mcp/template_changes.py` (changes paging; keeps `templates.py` small)
- Modify: `backend/app/api/mcp/draft_diff.py` (fingerprint + row id)
- Modify: `backend/app/schemas/mcp_templates.py`, `backend/app/schemas/mcp_template_draft.py` (`untrusted_fields` for the shared diff)
- Test: new `backend/tests/unit/test_template_lint.py`; `backend/tests/integration/mcp/test_mcp_get_template.py`; `backend/tests/unit/test_mcp_get_template_paging.py`; `backend/tests/integration/mcp/test_mcp_result_shape.py`; `backend/tests/integration/mcp/test_mcp_edit_template_draft.py`

**Interfaces (lint):**
- `schemas/template_lint.py`:
  ```python
  LintCode = Literal["SELECT_WITHOUT_OPTIONS", "REPEATING_SECTION_WITHOUT_ENTITY_KEY",
      "REPEATING_SECTION_WITHOUT_ENTRY_LABEL", "EMPTY_SECTION", "QUESTION_WITHOUT_AI_GUIDANCE",
      "UNRESOLVED_CUSTOMIZE_SLOT"]
  class LintFinding(BaseModel):
      code: LintCode; status: Literal["block", "warn"]
      section_label: str | None = None
      question_labels: list[str] = Field(default_factory=list, max_length=5)
      count: int
  ```
- `services/template_lint.py` (no DB access, no `template_versioning` import): `CUSTOMIZE_SLOT = re.compile(r"\[customize:[^\]]*\]")`; `def lint_tree(entity_types: list[RunViewEntityType], instruction: str | None) -> list[LintFinding]`, one finding per code that fires, in this order:

  | Code | Status | Fires on |
  |---|---|---|
  | `SELECT_WITHOUT_OPTIONS` | block | a `select`/`multiselect` field with no options |
  | `REPEATING_SECTION_WITHOUT_ENTITY_KEY` | block | a `many` section with no `is_entity_key` field |
  | `REPEATING_SECTION_WITHOUT_ENTRY_LABEL` | warn | a `many` section with a blank `entry_label` |
  | `EMPTY_SECTION` | warn | a section with no fields and no child section |
  | `QUESTION_WITHOUT_AI_GUIDANCE` | warn | a field whose `llm_description` and `description` are both blank |
  | `UNRESOLVED_CUSTOMIZE_SLOT` | warn | the instruction or a field's `llm_description` matches `CUSTOMIZE_SLOT` |

  `count` = offending nodes (the instruction counts as one); `section_label` = the first offending section (section rules) or the first offending question's section (question rules); `question_labels` = up to 5 offending question labels (empty for section rules).

**Interfaces (views):**
- `get_template(..., view: Literal["published", "draft", "changes"] = "published", cursor: str | None = None)`. Draft and changes: non-manager → `McpToolError(MANAGER_REQUIRED, "Only a project manager can read the draft.")` (read tool: no audit row).
- `McpDraftChange` gains `id: str` (the row's `TemplateChangeRowRead.id`); `McpDraftDiff` gains `fingerprint: str | None`; `capped_diff` fills both. The description tells the agent to page every row with `view="changes"`.
- `McpTemplateView` gains: `view: Literal["published", "draft", "changes"]` (set per call), and optional (default `None`) `fingerprint: str | None`, `status: str | None`, `counts: dict[str, int] | None`, `changes: list[McpTemplateChangeRow] | None`, `lint: list[LintFinding] | None`, `note: str | None`. `McpTemplateChangeRow{id: str, tier: str, variant: str, label_path: list[str], attribute: str | None, before: str | None, after: str | None, affects_recorded_data: bool, affects_ai: bool}`; `before`/`after` capped at 200 characters with `cap_text`, booleans rendered as `"true"`/`"false"` as `draft_diff` does.
- **draft:** `tree = await live_entity_types(db, template_id=...)`, paged with the same `_page_sections` budget and cursor; `instruction` = the live `llm_template_instruction`, `instruction_is_default` against the global default; page 1 (no cursor) carries `draft_open`, `fingerprint` (from `get_template_config_diff`) and `lint = lint_tree(tree, instruction)`. No draft open → `draft_open=False`, `note="No draft is open; this is the published questionnaire."`. `draft_diff` is `None` in this view.
- **changes:** `template_changes.page_changes(diff, cursor, budget) -> tuple[list[McpTemplateChangeRow], str | None]`: rows flattened destructive, semantic, additive, cosmetic; each page fits the cap (measure with `compact_json`, reserve for the envelope and cursor as `get_template` does). Cursor `encode_cursor([diff.fingerprint[:12], offset])`; on a later page a different prefix (or a malformed cursor) → `INVALID_ARGUMENT` "the draft changed; restart without cursor" (`field="cursor"`). Every page carries `fingerprint`, `status` and `counts`; `sections=[]`. No draft → `changes=[]` with the fingerprint; `initial_version`/`baseline_too_old` → `changes=[]`, `fingerprint=None`, `note` naming the status.
- `McpTemplateView.untrusted_fields` gains `"changes[].label_path[]"`, `"changes[].before"`, `"changes[].after"`, `"changes[].id"`, `"lint[].section_label"`, `"lint[].question_labels[]"`, `"draft_diff.changes[].id"` (row ids embed option values). `_TRUSTED_PATHS["get_template"]` gains `"draft_diff.fingerprint"`, `"fingerprint"`, `"status"`, `"changes[].tier"`, `"changes[].variant"`, `"changes[].attribute"`, `"note"` (`lint[].code`, `lint[].status` and `view` are Literals and skipped). Shared diff: `EditTemplateDraftResult.untrusted_fields` gains `"diff.changes[].id"`; `_TRUSTED_PATHS["edit_template_draft"]` gains `"diff.fingerprint"`.
- The description documents the three views, that draft and changes are manager-only, and that `fingerprint` equals the one Publish checks.

- [ ] **Step 1: Write the failing tests.**
  - New `tests/unit/test_template_lint.py`: one case per rule built from `RunViewEntityType`/`RunViewField` literals (code, status, count, labels); a clean tree returns `[]`; aggregation (3 selects without options → one finding, `count == 3`); 7 offending questions → `len(question_labels) == 5`; the seeded CHARMS tree (integration-marked case reading `live_entity_types` for a CHARMS clone) has no `block` finding; `test_customize_slot_parity`: read both frontend files (`Path(__file__).resolve().parents[3] / "frontend/components/extraction/..."`), extract the `/\[customize:[^\]]*\]/g` literal from each with a regex, assert they are equal and that `CUSTOMIZE_SLOT.pattern` equals the literal's body.
  - `tests/integration/mcp/test_mcp_get_template.py` (manager `pat_primary_rw`, reviewer `pat_reviewer_rw`, `SEED.primary_template`):
    - `test_draft_view_shows_unpublished_question`: after `edit_template_draft` `add_question` into a labelled section, `view="draft"` lists it under that section; `view="published"` does not.
    - `test_draft_view_carries_lint`: a question added without instructions yields a `QUESTION_WITHOUT_AI_GUIDANCE` lint item on page 1.
    - `test_changes_view_pages_every_row`: a draft with more than 40 rows (45 `add_question` ops over two calls) → following `next_cursor` returns every row id exactly once; each page `len(compact_json(structured_content)) <= 32000`.
    - `test_mcp_fingerprint_equals_rest`: `view="changes"` `fingerprint` equals REST `GET /api/v1/projects/{pid}/templates/{tid}/config-diff` `data.fingerprint` (REST client fixtures `db_client` + `auth_as_profile`).
    - `test_reviewer_gets_manager_required` for `draft` and `changes`.
    - `test_edit_between_pages_invalidates_cursor`: page 1's cursor, one more op, page 2 → `INVALID_ARGUMENT`.
    - `test_no_draft_states`: `view="draft"` → `draft_open is False` + note; `view="changes"` → `changes == []` with a fingerprint.
    - `test_changes_view_without_comparable_baseline`: parametrized over `initial_version` and `baseline_too_old` (monkeypatch `get_template_config_diff` as imported by the changes module to return a `TemplateConfigDiffRead` with that status) → `changes == []`, `fingerprint is None`, `note` names the status.
    - `test_malformed_changes_cursor_is_invalid_argument`: `view="changes", cursor="not-a-cursor"` → `INVALID_ARGUMENT` with `field == "cursor"`.
    - `test_published_draft_diff_carries_fingerprint_and_ids`.
  - `test_mcp_result_shape.py`, `test_mcp_edit_template_draft.py` and `tests/unit/test_mcp_get_template_paging.py` updated for the new fields and paths.

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/unit/test_template_lint.py tests/integration/mcp/test_mcp_get_template.py tests/unit/test_mcp_get_template_paging.py tests/integration/mcp/test_mcp_result_shape.py tests/integration/mcp/test_mcp_edit_template_draft.py -q` → FAIL.

- [ ] **Step 3: Implement** the lint service and the views per Interfaces.

- [ ] **Step 4: Run green + gates.**
  ```bash
  cd "$WT/backend" && uv run pytest tests -q
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh
  cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  wc -l "$WT/backend/app/api/mcp/tools/templates.py"   # ≤ 800
  ```
  Expected: PASS, including `test_template_versioning_boundary.py`.

- [ ] **Step 5: Commit.** `git -C "$WT" add backend && git -C "$WT" commit -m "feat(mcp): draft and changes views of a questionnaire with lint"`

**Done when:** six lint rules and the parity test pass, draft and changes views page correctly for managers only, the fingerprint matches REST and invalidates stale cursors, the shared diff carries fingerprint and ids, gates green.

---

### Task 3.6a: `get_setup_readiness`: protocol, template and lint items

**Layer:** backend · **Migration:** no · **Commit:** `feat(mcp): setup readiness for the review question and templates`

**Goal:** one read tells an agent what stands between the project and a useful AI run: review-question gaps, template state and lint findings, each with a status, an optional subject, a message and a next step. Managers also see draft items; others get `draft_detail_hidden=true`.

**Context:** after Tasks 3.2b and 3.5b: `backend/app/services/project_ai_context.build_review_question(db, project_id)` returns `ReviewQuestion(text, revision) | None` (`text` None when the switch is off or nothing renders); the switch is `settings.ai_context.picots` (absent = ON; read with the module's `_picots_enabled`); `projects.review_type` may be null; `projects.protocol_revision` exists. Templates: `backend/app/services/project_read_service.template_summaries(db, project_id=...)` → `McpTemplateSummary{template_id, name, kind, is_active, published_version, narrow, instrument}`; the owned row's `config_draft_since` marks an open draft (`backend/app/services/project_template_active_service.owned_template`); `get_active_version_tree` (published tree, raises `NoActiveTemplateVersionError`), `live_entity_types` (draft tree), `general_instructions_for_version`; `backend/app/services/template_lint.lint_tree`; `backend/app/schemas/template_lint.LintFinding`. `backend/app/api/deps/security.is_project_manager` (called by the tool, which passes `is_manager` in; the service never imports `app.api`). `backend/app/utils/app_urls.editor_url(project_id, kind)` (support module, importable from services). Readiness reads no extraction values.

**Files:**
- Create: `backend/app/services/project_setup_readiness.py`, `backend/app/schemas/mcp_readiness.py`, `backend/app/api/mcp/tools/readiness.py`
- Modify: `backend/app/api/mcp/tools/__init__.py`
- Test: new `backend/tests/integration/mcp/test_mcp_setup_readiness.py`; `backend/tests/integration/mcp/test_mcp_result_shape.py`; `backend/tests/integration/mcp/test_mcp_bola.py`

**Interfaces:**
- `schemas/mcp_readiness.py`:
  ```python
  ReadinessCode = Literal["REVIEW_QUESTION_EMPTY", "REVIEW_QUESTION_DISABLED", "REVIEW_TYPE_MISSING",
      "NO_ACTIVE_EXTRACTION_TEMPLATE", "TEMPLATE_NOT_PUBLISHED", "TEMPLATE_NARROW_BASELINE",
      "DRAFT_PENDING_PUBLISH", <the six LintCode values>]   # 3.6b appends five engine/project codes
  class McpReadinessSubject(BaseModel):
      kind: Literal["project", "template"]; id: UUID; name: str
  class McpReadinessItem(BaseModel):
      code: ReadinessCode; status: Literal["block", "warn"]
      subject: McpReadinessSubject | None = None
      tree: Literal["published", "draft"] | None = None
      message: str; next_step: str
  class McpReadinessSummary(BaseModel):
      block: int; warn: int; ok: bool
  class McpSetupReadiness(BaseModel):
      project_id: UUID; project_name: str; protocol_revision: int
      summary: McpReadinessSummary; items: list[McpReadinessItem]; draft_detail_hidden: bool
      untrusted_content: Literal[True] = True
      untrusted_fields: list[str] = ["project_name", "items[].subject.name", "items[].message"]
  ```
  `_TRUSTED_PATHS["get_setup_readiness"] = {"items[].next_step"}`. `summary.ok` = no block items.
- `project_setup_readiness.build_setup_readiness(db, *, project_id: UUID, user_id: UUID, is_manager: bool) -> McpSetupReadiness` (minus `project_name`, which the tool adds; or pass it in). Items in this order:
  - `REVIEW_QUESTION_DISABLED` (warn) when the switch is off; else `REVIEW_QUESTION_EMPTY` (warn) when `build_review_question(...).text is None`. next_step `"call set_review_question"`.
  - `REVIEW_TYPE_MISSING` (warn) when `projects.review_type` is null or blank, next_step `"call update_project_details with review_type"`.
  - `NO_ACTIVE_EXTRACTION_TEMPLATE` (block) when no active `extraction` template; next_step = `editor_url(project_id, "extraction")`.
  - Per active template (extraction and quality_assessment), subject `{kind:"template", id, name}`: `TEMPLATE_NOT_PUBLISHED` (block, `published_version is None`); `TEMPLATE_NARROW_BASELINE` (warn, `narrow is True`); `DRAFT_PENDING_PUBLISH` (warn, managers only, `config_draft_since is not None`, next_step `"a manager publishes in prumo at <editor_url>"`).
  - Lint per active template: the published tree (with its version instruction) for everyone, tagged `tree="published"`; for managers also the draft tree (live instruction), tagged `tree="draft"`. Each `LintFinding` becomes one item with the finding's `code`/`status`; `message` names the section and up to 5 question labels ("… and N more" when `count` exceeds the examples) — capped examples live in `message`; next_step `"edit_template_draft"` for draft findings, the editor URL for published ones.
  - `draft_detail_hidden = not is_manager`.
- `get_setup_readiness(project_id: UUID) -> McpSetupReadiness`: `@agent_tool(requires="read", project_arg="project_id", title="Get setup readiness", destructive=False, description=...)`; computes `is_manager` via `is_project_manager(db, project_id, current_principal().user_sub)`. Description: call it first when configuring a project; items name the tool or prumo page that fixes them; no publish tool exists.
- Message strings embed template and question labels (hence untrusted); keep each `message` ≤ 500 characters (`cap_text`).

- [ ] **Step 1: Write the failing tests.** New `tests/integration/mcp/test_mcp_setup_readiness.py`:
  - `test_protocol_and_lint_items`: on a fixture project with `review_type` set, empty PICOTS, an active published extraction template whose live tree has a select without options and a repeating section without an entity key (both inserted directly with `text()` INSERTs into `extraction_fields`/`extraction_entity_types`, since `add_question` refuses a select without options), every question carrying `llm_description`, and the repeating section carrying an `entry_label`: a manager's codes among block and warn are exactly `{"REVIEW_QUESTION_EMPTY", "SELECT_WITHOUT_OPTIONS", "REPEATING_SECTION_WITHOUT_ENTITY_KEY", "DRAFT_PENDING_PUBLISH"}` (the live-table triggers `trg_extraction_fields_mark_draft` / `trg_extraction_entity_types_mark_draft` stamp `config_draft_since` on the direct insert, so the draft is open); the two lint items carry `tree="draft"` (the published tree is the clean clone).
  - `test_reviewer_sees_no_draft_items`: same fixture via `pat_reviewer_rw` → no item with `tree="draft"`, no `DRAFT_PENDING_PUBLISH`, `draft_detail_hidden is True`.
  - `test_disabled_switch_reports_disabled_only`.
  - `test_no_active_extraction_template_blocks` (deactivate the template in the fixture).
  - `test_review_type_missing_warns`: the same fixture with `review_type` set to NULL (`UPDATE public.projects SET review_type = NULL WHERE id = :pid`) → a `REVIEW_TYPE_MISSING` item with status `warn`.
  - `test_unpublished_template_blocks`: the active extraction template's versions deactivated (`UPDATE public.extraction_template_versions SET is_active = false WHERE project_template_id = :tid`) → `TEMPLATE_NOT_PUBLISHED` (block) whose `subject` is `{kind: "template", id: <tid>, name: <template name>}`, and no published-tree lint item for it.
  - `test_narrow_baseline_warns`: `force_narrow_baseline(db_session, template_id, <section id>)` (`tests/integration/helpers/template_fixtures.py`) → `TEMPLATE_NARROW_BASELINE` (warn) with that template as subject.
  - `test_quality_assessment_template_items`: add an active, published `quality_assessment` template (clone PROBAST through `TemplateCloneService.create_from_global`) whose live tree gets a select without options (direct `text()` INSERT as above) → a manager sees a `SELECT_WITHOUT_OPTIONS` item with `tree="draft"` and a `DRAFT_PENDING_PUBLISH` item whose `subject.id` is the QA template; with its versions deactivated it also gets `TEMPLATE_NOT_PUBLISHED` — per-template items run for QA templates, not only extraction.
  - `test_result_within_cap_on_200_questions`: a template with 200 questions lacking guidance → `len(compact_json(...)) <= 32000` and one aggregated `QUESTION_WITHOUT_AI_GUIDANCE` item.
  - `test_mcp_result_shape.py`: key + call; `test_mcp_bola.py`: `_coordinate_cases` + outsider `NOT_FOUND`.

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/integration/mcp/test_mcp_setup_readiness.py tests/integration/mcp/test_mcp_result_shape.py tests/integration/mcp/test_mcp_bola.py -q` → FAIL.

- [ ] **Step 3: Implement** per Interfaces; add a service-level test in the same file calling `build_setup_readiness` directly for coverage.

- [ ] **Step 4: Run green + gates.**
  ```bash
  cd "$WT/backend" && uv run pytest tests -q
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh
  cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  ```
  Expected: PASS, including `check_layered_arch.py` (the tool imports services and support only; the service imports no `app.api` module — `grep -n "from app.api" "$WT/backend/app/services/project_setup_readiness.py"` prints nothing).

- [ ] **Step 5: Commit.** `git -C "$WT" add backend && git -C "$WT" commit -m "feat(mcp): setup readiness for the review question and templates"`

**Done when:** protocol, template and lint items appear per the rules, reviewers see no draft items, the result stays capped, gates green.

---

### Task 3.6b: `get_setup_readiness`: engine, reviewers, parser and article text items

**Layer:** backend · **Migration:** no · **Commit:** `feat(mcp): setup readiness for the AI engine, reviewers and article text`

**Goal:** readiness also reports a retired AI engine or a missing credential for the caller, too few reviewer-capable members for the HITL setting, a missing LlamaParse key when the project asks for LlamaParse, and articles without parsed text.

**Context:** after Task 3.6a, `backend/app/services/project_setup_readiness.build_setup_readiness` and `backend/app/schemas/mcp_readiness.ReadinessCode` exist. Sources: `backend/app/services/engine_credentials.py:139` `assert_engine_ready(db, *, project_id, user_id)` (read-only kickoff precheck) raises `EngineRetiredError` (`backend/app/services/llm_engine_service.py`), `MissingCredentialError` or `ConnectionUnavailableError` (`backend/app/services/llm_connection_service.py:96,85`; a revoked BYOK connection surfaces as one of these). `backend/app/services/hitl_config_service.HitlConfigService(db).get_for_project(project_id)` returns a dict with `reviewer_count`. Reviewer-capable members = project members for whom the SQL function `public.is_project_reviewer(project_id, user_id)` is true (the predicate `backend/app/api/deps/security.py:109` runs). `backend/app/repositories/project_repository.ProjectMemberRepository` (L63) is the ORM home for membership reads; `scripts/fitness/check_scope_guards.py` fails on any string literal under `backend/app` holding `project_members` with FROM/JOIN (no module is exempt), and `.claude/rules/backend.md` forbids hand-rolled membership SQL. `backend/app/services/parser_settings_service.ParserSettingsService(db).get_for_project(project_id)` returns `"auto"|"llamaparse"|"docling"`. Credential presence: `llm_connection_service.availability_map(session, *, project_id, user_id, providers)` (L486) selects only `scope, provider, base_url` and returns `"user"|"project"|"global"|None` per provider — no decryption, no write; `assert_engine_ready` already uses it. Do **not** use `resolve_provider_key`: it decrypts the key and writes `last_used_at`. Article counts: `project_read_service.get_project_overview` computes `articles` and `articles_with_text` (an article with a parsed file); reuse that query shape (move it to a small shared helper in `project_read_service` if needed rather than copy it).

**Files:**
- Modify: `backend/app/services/project_setup_readiness.py`, `backend/app/schemas/mcp_readiness.py`, `backend/app/utils/app_urls.py` (`settings_url`)
- Modify: `backend/app/services/project_read_service.py` (only to share the article-count query)
- Modify: `backend/app/repositories/project_repository.py` (`ProjectMemberRepository.count_reviewer_capable`)
- Test: `backend/tests/integration/mcp/test_mcp_setup_readiness.py`; new `backend/tests/integration/test_project_member_repository.py` (`test_count_reviewer_capable`)

**Interfaces:**
- `ReadinessCode` gains `ENGINE_RETIRED`, `ENGINE_NO_CREDENTIAL`, `HITL_REVIEWERS_SHORT`, `ARTICLES_WITHOUT_TEXT`, `PARSER_KEY_MISSING`.
- Items (after the template/lint items, subject `{kind:"project", id, name}` where useful):
  - `ENGINE_RETIRED` (block): `assert_engine_ready(db, project_id=..., user_id=caller)` raised `EngineRetiredError`; next_step = the project settings URL `f"{settings.PUBLIC_APP_URL.rstrip('/')}/projects/{project_id}?tab=settings"` (`frontend/pages/ProjectView.tsx` routes `tab=settings` to `ProjectSettings`); add it to the support module `backend/app/utils/app_urls.py` as `settings_url(project_id)` (never under `app/api`: services may not import the api layer).
  - `ENGINE_NO_CREDENTIAL` (block): it raised `MissingCredentialError` or `ConnectionUnavailableError`; caught, never re-raised; same next_step.
  - `HITL_REVIEWERS_SHORT` (warn): `reviewer_count` > `await ProjectMemberRepository(db).count_reviewer_capable(project_id)`. New repository method, ORM only, no SQL string literal:
    ```python
    async def count_reviewer_capable(self, project_id: UUID) -> int:
        """Members the same SQL predicate the RLS policies use counts as reviewers."""
        stmt = select(func.count()).select_from(ProjectMember).where(
            ProjectMember.project_id == project_id,
            func.public.is_project_reviewer(ProjectMember.project_id, ProjectMember.user_id),
        )
        return int((await self.db.execute(stmt)).scalar_one())
    ```
    (`func.public.is_project_reviewer` renders the schema-qualified function; add `func` to the `sqlalchemy` import in the same edit.)
  - `ARTICLES_WITHOUT_TEXT` (warn): `articles_with_text < articles`; message gives both counts.
  - `PARSER_KEY_MISSING` (warn): parser setting is `llamaparse` and `(await availability_map(db, project_id=project_id, user_id=caller, providers=["llama_cloud"]))["llama_cloud"] is None` — a pure existence read of the stored-credential rows (plus the deployment's global setting).
  - None of these reads extraction values, decrypts a key or writes a row (`get_setup_readiness` is a read tool: `readOnlyHint` true).

- [ ] **Step 1: Write the failing tests.** In `tests/integration/mcp/test_mcp_setup_readiness.py`:
  - Extend `test_protocol_and_lint_items`'s fixture with the remaining preconditions so its exact-set assertion still holds: an engine credential for the caller (via `tests/integration/helpers/engine_setup`), `reviewer_count` met by reviewer-capable members, every article with a parsed file (or no articles), parser not `llamaparse`.
  - `test_revoked_byok_reports_no_credential`: revoke the caller's BYOK connection (set its `revoked_at` or delete it as the existing connection tests do) → `ENGINE_NO_CREDENTIAL`.
  - `test_retired_engine_reports_retired`: point the project at a retired engine (as the existing engine-retirement tests do) → `ENGINE_RETIRED`.
  - `test_reviewers_short`: `reviewer_count = 3` with fewer reviewer-capable members → `HITL_REVIEWERS_SHORT`.
  - `test_articles_without_text` and `test_parser_key_missing` (parser `llamaparse`, no `llama_cloud` connection, `llm_connection_service.global_key_for` monkeypatched to return `None` for `llama_cloud` → `PARSER_KEY_MISSING`).
  - `test_parser_key_check_never_decrypts_or_writes`: parser `llamaparse` and a project-scope `llama_cloud` connection row planted with an encrypted key and `last_used_at = NULL`; monkeypatch `LlmConnectionService.decrypt_key` to raise `AssertionError("readiness must not decrypt")`; call `build_setup_readiness` as a manager → no `PARSER_KEY_MISSING`, no exception, and afterwards `SELECT last_used_at FROM public.llm_connections WHERE id = :cid` is still `NULL` and `db_session.dirty`/`db_session.new` are empty (no pending write).
  - `test_count_reviewer_capable` (in `tests/integration/test_project_member_repository.py`, `db_session`): on `SEED.primary_project` the count equals the number of members for whom `SELECT public.is_project_reviewer(:pid, :uid)` is true, computed in the test member by member; adding a manager-only member changes it as that predicate says; a member of another project is not counted.
  - `test_fully_configured_seed_is_clear`: a fully configured fixture returns no block or warn item.
  - A service-level test calls `build_setup_readiness` with `assert_engine_ready` monkeypatched to raise each error type.

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/integration/mcp/test_mcp_setup_readiness.py tests/integration/test_project_member_repository.py -q` → FAIL.

- [ ] **Step 3: Implement** per Interfaces.

- [ ] **Step 4: Run green + gates.**
  ```bash
  cd "$WT/backend" && uv run pytest tests -q
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh
  cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  ```
  Expected: PASS; `check_scope_guards.py` green (no `project_members` string literal anywhere: `grep -rn "project_members" "$WT/backend/app/services/project_setup_readiness.py"` prints nothing).

- [ ] **Step 5: Commit.** `git -C "$WT" add backend && git -C "$WT" commit -m "feat(mcp): setup readiness for the AI engine, reviewers and article text"`

**Done when:** the five codes fire on their conditions, a fully configured project is clear, a test pins that readiness never decrypts a key nor writes `last_used_at`, the reviewer count goes through the repository with no raw membership SQL, gates green.

---
### Task 3.7a-1: Draft ops: delete, move and reorder questions; fingerprint guard

**Layer:** backend · **Migration:** no · **Commit:** `feat(mcp): delete, move and reorder questions in a template draft`

**Goal:** `edit_template_draft` can delete a question, move it to another section at a 0-based position and reorder a section's questions. A batch with a destructive or moving op must carry the draft fingerprint the agent last read; recorded data blocks a delete (`IN_USE`); structural conflicts get `STRUCTURE_CONFLICT` with a rule. The reply's `applied` entries become a discriminated union per op.

**Context:** `backend/app/api/mcp/tools/template_draft.py` (321 lines): `_OPS = {"add_question": AddQuestionOp, "update_question": UpdateQuestionOp}`, `_ALLOWED_OPS = sorted(_OPS)`, `_LOCKED_UPDATE_KEYS` (~L87), `_parse_ops` (unknown op → `OP_NOT_ALLOWED_VIA_AGENT` with `op_index`, `allowed_ops`), `_apply` (parse → `claim_draft_lock` → `_assert_baseline` → `apply_draft_ops` → `get_template_config_diff` → `record_applied_write(before={"ops": [...]}, after={"ops": [_applied_json(a) ...]})` → commit, all inside one try so any refusal rolls back the whole batch), `_op_failure` maps `DraftOpError.cause` (`_ROW_GUARDS` → `NOT_FOUND` with `op_index`, `DuplicateFieldNameError` → `DUPLICATE_NAME`, `ValidationError` → `validation_failure`, deadlock → `RETRY`, else `None` = unmapped → INTERNAL_ERROR), `_applied_json(a)` reads `a.field`. The result is built from `AppliedQuestion` rows (`backend/app/schemas/mcp_template_draft.py`). `backend/app/services/agent_template_draft_service.py` (185 lines): `_OP_ERRORS` tuple, `AppliedDraftOp` dataclass (`op_index`, `op`, `field`, `section_label`, `before`), `_add`, `_update`, `apply_draft_ops`. `backend/app/services/template_field_service.py`: `delete_field(db, *, project_id, template_id, field_id)` (L280; recorded-work FKs → `FieldInUseError`), `move_field(..., field_id, payload: TemplateFieldMoveRequest{entity_type_id, sort_order})` (L310; raw `sort_order`, no renumber; `CrossTemplateMoveError`), `reorder_fields(..., payload: TemplateFieldReorderRequest{updates: [{id, sort_order}]})` (L349; no per-section check; `DuplicateReorderIdsError`), `owned_field`. `backend/app/services/template_section_service.owned_section`. `backend/app/api/mcp/errors.py`: `McpErrorCode` (15 members), `_SPECS`, `AUDITED_CODES`. `backend/tests/unit/test_mcp_errors.py:42` asserts `len(McpErrorCode) == 15` and no member set. Fingerprint = `get_template_config_diff(...).fingerprint`.

**Files:**
- Modify: `backend/app/schemas/mcp_template_draft.py` (three ops, `AppliedOp` union)
- Modify: `backend/app/services/agent_template_draft_service.py` (dispatch, `AppliedDraftOp`)
- Modify: `backend/app/api/mcp/tools/template_draft.py` (`_OPS`, `expected_fingerprint`, error mapping, result)
- Modify: `backend/app/api/mcp/errors.py` (`IN_USE`, `STRUCTURE_CONFLICT`)
- Test: `backend/tests/unit/test_mcp_errors.py`; `backend/tests/unit/test_mcp_template_draft_ops.py`; `backend/tests/integration/mcp/test_mcp_edit_template_draft.py`; `backend/tests/integration/mcp/test_mcp_audit.py`; `backend/tests/integration/mcp/test_mcp_choke_point.py` (per-op choke-point cases); `backend/tests/integration/mcp/test_mcp_result_shape.py`

**Interfaces:**
- Ops (`extra="forbid"`, field-level validators):
  ```python
  class DeleteQuestionOp(BaseModel): op: Literal["delete_question"]; field_id: UUID
  class MoveQuestionOp(BaseModel): op: Literal["move_question"]; field_id: UUID; section_id: UUID; position: int = Field(ge=0)
  class ReorderQuestionsOp(BaseModel): op: Literal["reorder_questions"]; section_id: UUID; field_ids: list[UUID] = Field(min_length=1, max_length=500)
  DraftOp = AddQuestionOp | UpdateQuestionOp | DeleteQuestionOp | MoveQuestionOp | ReorderQuestionsOp
  ```
- Applied union (discriminated on `op`):
  ```python
  class AppliedQuestionOp(BaseModel):  # add_question, update_question, move_question
      op_index: int; op: Literal["add_question", "update_question", "move_question"]
      field_id: UUID; section_id: UUID; section_label: str; name: str; label: str
  class AppliedDeleteOp(BaseModel):
      op_index: int; op: Literal["delete_question"]; field_id: UUID
  class AppliedReorderOp(BaseModel):
      op_index: int; op: Literal["reorder_questions"]; section_id: UUID; section_label: str; field_ids: list[UUID]
  AppliedOp = Annotated[AppliedQuestionOp | AppliedDeleteOp | AppliedReorderOp, Field(discriminator="op")]
  ```
  `EditTemplateDraftResult.applied: list[AppliedOp]`; `untrusted_fields` keeps `applied[].section_label`, `applied[].name`, `applied[].label`. Delete `AppliedQuestion`.
- Service: `AppliedDraftOp` becomes `op_index`, `op`, `field: TemplateFieldRead | None`, `section_id: UUID | None`, `section_label: str | None`, `field_ids: list[UUID] | None`, `before: dict | None`, `after: dict | None`. New handlers:
  - `_delete`: `owned_field` → `before` = the field's label/name/type/section → `delete_field`.
  - `_move`: `owned_field`, `owned_section(section_id)`; `move_field(payload=TemplateFieldMoveRequest(entity_type_id=section_id, sort_order=position))`; then renumber the destination: its field ids ordered by `sort_order` (excluding the moved one), insert the moved id at `min(position, len)`, `reorder_fields(updates=[{id, sort_order: i}])`.
  - `_reorder`: `owned_section`; the section's current field ids must equal `set(op.field_ids)` with no duplicates and the same length, else raise `ReorderMismatchError` (new, in this service); `reorder_fields(updates=[{id, sort_order: i} for i, id in enumerate(op.field_ids)])`.
  - `_OP_ERRORS` gains `FieldInUseError`, `CrossTemplateMoveError`, `ReorderMismatchError`. `DuplicateReorderIdsError` is not mapped: the `_reorder` pre-check refuses duplicate ids as `ReorderMismatchError` → `INVALID_ARGUMENT` before `reorder_fields` runs, so it is unreachable (one code for one condition).
- Errors: `McpErrorCode.IN_USE = "IN_USE"` (`_CodeSpec(False, "the question or section holds recorded data; tell the user, it can only change in prumo after that data is handled")`), `McpErrorCode.STRUCTURE_CONFLICT = "STRUCTURE_CONFLICT"` (`_CodeSpec(False, "read get_template(view='draft'), fix the structure named by rule, and resend")`); both in `AUDITED_CODES`. `_op_failure` maps `FieldInUseError` → `IN_USE` (`op_index`); `CrossTemplateMoveError` → `STRUCTURE_CONFLICT` `rule="cross_template_move"` (shadowed by `owned_section` on natural input; the audit-matrix driver reaches it by monkeypatching `move_field` to raise, as the existing drivers do); `ReorderMismatchError` → `INVALID_ARGUMENT` "field_ids must name exactly this section's questions" (`field="field_ids"`, `op_index`).
- `edit_template_draft(..., ops, expected_fingerprint: str | None = None)`: after `_parse_ops`, if any op is `delete_question` or `move_question` (and, from Task 3.7b, `delete_section`): `expected_fingerprint` missing → audited `INVALID_ARGUMENT` (`field="expected_fingerprint"`, message "required when a batch deletes or moves"); after `claim_draft_lock` and `_assert_baseline`, compare once with `get_template_config_diff(...).fingerprint` before any op; mismatch → audited `STALE_VALUE` with `current_fingerprint`. `_OPS` gains the three ops; `_ALLOWED_OPS` is then the 5 names sorted. `_applied_json` writes each op kind's before/after (`op_index`, `op`, ids, and the handler's `before`/`after`) into the one applied row.
- The description gains one line per new op and says `expected_fingerprint` (from `get_template` view `draft` or `changes`) is required for delete and move; publish stays human-only.

- [ ] **Step 1: Write the failing tests.**
  - `tests/unit/test_mcp_errors.py`: `len(McpErrorCode) == 17` and `{c.value for c in McpErrorCode} == {<the 17 names>}` (member-set pin); `IN_USE` and `STRUCTURE_CONFLICT` are not retryable and in `AUDITED_CODES`.
  - `tests/unit/test_mcp_template_draft_ops.py`: each new op validates; `position=-1` refused with `loc ("position",)`; empty `field_ids` refused.
  - `tests/integration/mcp/test_mcp_edit_template_draft.py`:
    - `test_delete_question_applies_with_fingerprint` (fingerprint from `get_template(view="changes")`); `test_delete_without_fingerprint_is_invalid_argument`; `test_stale_fingerprint_is_stale_value` (one refused row, no change, `current_fingerprint` present).
    - `test_delete_question_with_recorded_values_is_in_use`: a field with a proposal record (create one the way the field-in-use REST test in `tests/integration/test_template_structure_endpoints.py` does) → `IN_USE`, one refused row, field still present.
    - `test_move_question_renumbers_destination`: move into position 0 of another section → its questions' `sort_order` are `0..n` with the moved one first.
    - `test_reorder_questions_sets_order`, `test_reorder_with_wrong_ids_is_invalid_argument` and `test_reorder_with_duplicate_ids_is_invalid_argument` (the section's ids with one repeated → `INVALID_ARGUMENT`, `field == "field_ids"`, one refused row).
    - `test_failing_op_rolls_back_batch`: ops 1–2 valid, op 3 deletes a missing field → `NOT_FOUND` with `op_index == 2`, no row from ops 1–2.
    - `test_unknown_op_lists_allowed_ops`: `op="publish"` → `OP_NOT_ALLOWED_VIA_AGENT` with `allowed_ops == ["add_question", "delete_question", "move_question", "reorder_questions", "update_question"]`.
    - `test_one_applied_row_covers_each_op`: one batch with add, update, move, reorder → one applied row whose `after.ops[*].op` lists each.
  - `tests/integration/mcp/test_mcp_choke_point.py`: a per-op table `_DRAFT_OP_CASES: dict[str, Callable[[SeedIds], dict]]` mapping every op name to a minimal valid `edit_template_draft` argument dict on `SEED.primary_template` (ops that delete or move also carry an `expected_fingerprint` string, so the lock refusal is what surfaces); `test_draft_op_cases_cover_every_allowed_op` asserts `set(_DRAFT_OP_CASES) == set(template_draft._ALLOWED_OPS)` (so a later task that adds an op without a case fails); `test_draft_op_choke_point` parametrized over every op × three callers: a read token (`pat_primary_read`) → `SCOPE_INSUFFICIENT`, a reviewer (`pat_reviewer_rw`) → `MANAGER_REQUIRED`, and a manager while another manager holds the draft lock (claimed the way `test_mcp_edit_template_draft.py::test_draft_lock_held` does) → `DRAFT_LOCK_HELD`; every case leaves the template unchanged. In this task the table holds `add_question`, `update_question`, `delete_question`, `move_question`, `reorder_questions`.
  - `tests/integration/mcp/test_mcp_audit.py`: matrix drivers for `IN_USE` and `STRUCTURE_CONFLICT` (required in this task: `test_audit_row_matrix` runs once per `McpErrorCode`); the `STRUCTURE_CONFLICT` driver monkeypatches `template_field_service.move_field` to raise `CrossTemplateMoveError`, as the `DUPLICATE_NAME` driver patches `create_field`, and asserts `rule == "cross_template_move"`.

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/unit/test_mcp_errors.py tests/unit/test_mcp_template_draft_ops.py tests/integration/mcp/test_mcp_edit_template_draft.py tests/integration/mcp/test_mcp_choke_point.py tests/integration/mcp/test_mcp_audit.py -q` → FAIL.

- [ ] **Step 3: Implement** per Interfaces.

- [ ] **Step 4: Run green + gates.**
  ```bash
  cd "$WT/backend" && uv run pytest tests -q
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh
  cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  wc -l "$WT/backend/app/api/mcp/tools/template_draft.py" "$WT/backend/app/services/agent_template_draft_service.py"   # each ≤ 800
  ```
  Expected: PASS, including `test_mcp_result_shape.py` (union members merge into the same `applied[]` paths).

- [ ] **Step 5: Commit.** `git -C "$WT" add backend && git -C "$WT" commit -m "feat(mcp): delete, move and reorder questions in a template draft"`

**Done when:** the three ops apply atomically, destructive and moving batches need the current fingerprint, `IN_USE`/`STRUCTURE_CONFLICT` are audited and pinned, `allowed_ops` lists 5, gates green.

---

### Task 3.7a-2: Draft ops: richer add/update question and `set_options`

**Layer:** backend · **Migration:** no · **Commit:** `feat(mcp): question flags, units and option editing in a template draft`

**Goal:** an agent can set a question's required flag, unit and allowed units, the not-applicable / not-evaluated / no-information / other flags and the entity key, and replace a select's options with `set_options` (kept codes stay, new options derive their code from the label, collisions refused). `name` and `type` stay human-only, and `options` on `update_question` points to `set_options`.

**Context:** after Task 3.7a-1: `backend/app/schemas/mcp_template_draft.py` has `OptionInput` (`value?`, `label`, `to_option_item()` → value or trimmed label), `AddQuestionOp` (`section_id`, `label`, `type`, `options`, `instructions`; duplicate derived values → `ValueError("option values must be unique")` → audited `INVALID_ARGUMENT`), `UpdateQuestionOp` (`field_id`, `label`, `description`, `instructions`), the delete/move/reorder ops and the `AppliedOp` union. `backend/app/services/agent_template_draft_service.py`: `_add` builds `TemplateFieldCreateRequest` (fields include `is_required`, `unit`, `allowed_units`, `allowed_values`, `allow_other`, `allows_not_applicable`, `allows_not_evaluated`, `allows_no_information`, `is_entity_key`), `_update` maps op keys through `_UPDATE_COLUMN = {"label": "label", "description": "description", "instructions": "llm_description"}` into `TemplateFieldUpdateRequest` (same optional columns). `backend/app/services/template_field_service.update_field` raises `DuplicateEntityKeyError` (another entity key in the section). `backend/app/schemas/template_structure.py:73` `_reject_duplicate_option_values` is a `ValueError` → 422 on REST; nothing raises `option_value_conflict` today. `backend/app/api/mcp/tools/template_draft.py`: `_LOCKED_UPDATE_KEYS = frozenset({"type", "options"})`, `_LOCKED_KEY_MESSAGE`, `_LOCKED_KEY_NEXT_STEP`, `_EDITABLE_UPDATE_FIELDS`; `_op_failure` maps causes; `McpErrorCode.STRUCTURE_CONFLICT` exists (audited).

**Files:**
- Modify: `backend/app/schemas/mcp_template_draft.py` (`AddQuestionOp`, `UpdateQuestionOp`, `SetOptionsOp`, `AppliedQuestionOp.op` literal)
- Modify: `backend/app/services/agent_template_draft_service.py` (`_add`, `_update`, `_set_options`, `OptionValueConflictError`)
- Modify: `backend/app/api/mcp/tools/template_draft.py` (`_OPS`, locked keys, messages, mapping, description)
- Test: `backend/tests/unit/test_mcp_template_draft_ops.py`; `backend/tests/integration/mcp/test_mcp_edit_template_draft.py`; `backend/tests/integration/mcp/test_mcp_audit.py`; `backend/tests/integration/mcp/test_mcp_choke_point.py`

**Interfaces:**
- `AddQuestionOp` gains `required: bool = False`, `unit: str | None = Field(default=None, max_length=50)`, `allowed_units: list[Annotated[str, StringConstraints(min_length=1, max_length=50)]] | None = Field(default=None, max_length=50)`, `allows_not_applicable: bool = False`, `allows_not_evaluated: bool = False`, `allows_no_information: bool = True`, `allow_other: bool = False`.
- `UpdateQuestionOp` gains optional `required`, `unit`, `allowed_units`, `allows_not_applicable`, `allows_not_evaluated`, `allows_no_information`, `is_entity_key`, `allow_other` (each sent key only). `_UPDATE_COLUMN` gains `required → is_required` and identity mappings for the rest.
- `class SetOptionsOp(BaseModel): op: Literal["set_options"]; field_id: UUID; options: list[OptionInput] = Field(min_length=1, max_length=100)`.
- `DraftOp` gains `SetOptionsOp`; `AppliedQuestionOp.op` gains `"set_options"`.
- `class OptionValueConflictError(Exception)` in the service. `_set_options`: `owned_field`; a non-select/multiselect field → `ValueError`-backed `INVALID_ARGUMENT` ("set_options applies to select and multiselect questions", `field="options"`); `final = [o.to_option_item() for o in op.options]` (a sent value is kept as the code; a missing one derives from the trimmed label); duplicate codes in `final` → `OptionValueConflictError` (checked before calling `update_field`); `before = {"options": <current canonical options>}`; `update_field(payload=TemplateFieldUpdateRequest(allowed_values=final))`. Removing a code is allowed in the draft (Publish asks for the destructive acknowledgement).
- `_op_failure`: `DuplicateEntityKeyError` → `STRUCTURE_CONFLICT` `rule="duplicate_entity_key"`; `OptionValueConflictError` → `STRUCTURE_CONFLICT` `rule="option_value_conflict"`. `add_question` duplicates stay `INVALID_ARGUMENT` (schema validator).
- `_LOCKED_UPDATE_KEYS = frozenset({"type", "name", "options"})`. For `type`/`name`: message "A question's type or name can only be changed in the prumo UI."; for `options`: message "Change options with set_options." and `next_step` "resend the options change as a set_options op"; both with `field=<key>`, `op_index`, `allowed_ops`, `editable_fields`. `_ALLOWED_OPS` is now 6 names.

- [ ] **Step 1: Write the failing tests.**
  - `tests/unit/test_mcp_template_draft_ops.py`: `SetOptionsOp` validates; `allowed_units` item over 50 characters refused; `UpdateQuestionOp(name=...)` is refused by the schema (the tool refuses earlier by key — see below).
  - `tests/integration/mcp/test_mcp_edit_template_draft.py`:
    - `test_add_question_with_flags_and_units`: stored `is_required`, `unit`, `allowed_units`, `allows_not_applicable` match.
    - `test_update_question_sets_entity_key_and_flags`; `test_second_entity_key_is_structure_conflict` (`rule == "duplicate_entity_key"`, one refused row).
    - `test_set_options_keeps_codes_and_derives_new`: `[{value: "y", label: "Yes!"}, {label: " Maybe "}]` → stored `[{value:"y",label:"Yes!"},{value:"Maybe",label:" Maybe "}]`.
    - `test_set_options_collision_is_structure_conflict`: `[{value:"a",label:"A"},{label:"a"}]` → `STRUCTURE_CONFLICT`, `rule == "option_value_conflict"`, one refused row, options unchanged.
    - `test_add_question_duplicate_options_stays_invalid_argument`.
    - `test_set_options_removing_value_with_data_shows_destructive_row`: remove a code that has a recorded value → applied; `get_template(view="changes")` has a row with `affects_recorded_data == "true"` in the destructive tier.
    - `test_update_question_name_or_type_is_not_allowed`: `name` → `OP_NOT_ALLOWED_VIA_AGENT` with `field == "name"`; `type` likewise.
    - `test_update_question_options_points_to_set_options`: `field == "options"` and the message contains `set_options`.
    - `test_unknown_op_lists_allowed_ops`: now the 6 names.
  - `tests/integration/mcp/test_mcp_choke_point.py`: `_DRAFT_OP_CASES` gains `set_options` (the coverage test fails until it does), so the parametrized `test_draft_op_choke_point` runs the read-token `SCOPE_INSUFFICIENT`, reviewer `MANAGER_REQUIRED` and foreign-lock `DRAFT_LOCK_HELD` cases for it.
  - `tests/integration/mcp/test_mcp_audit.py`: `option_value_conflict` refused case.

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/unit/test_mcp_template_draft_ops.py tests/integration/mcp/test_mcp_edit_template_draft.py tests/integration/mcp/test_mcp_choke_point.py tests/integration/mcp/test_mcp_audit.py -q` → FAIL.

- [ ] **Step 3: Implement** per Interfaces.

- [ ] **Step 4: Run green + gates.**
  ```bash
  cd "$WT/backend" && uv run pytest tests -q
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh
  cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  ```
  Expected: PASS.

- [ ] **Step 5: Commit.** `git -C "$WT" add backend && git -C "$WT" commit -m "feat(mcp): question flags, units and option editing in a template draft"`

**Done when:** richer add/update and `set_options` apply with the collision and entity-key conflicts mapped, `name`/`type`/`options` refusals point to the right path, `allowed_ops` lists 6, gates green.

---

### Task 3.7b: Draft ops: sections and the template instruction

**Layer:** backend + docs · **Migration:** no · **Commit:** `feat(mcp): section and instruction ops in a template draft`

**Goal:** an agent can add, update and delete sections and set the template's AI instruction, so a blank template can be built entirely by tool calls; the reply reports lint counts and how many destructive changes Publish will ask the human to acknowledge.

**Context:** after Task 3.7a-2 the op union has 6 ops and `edit_template_draft` requires `expected_fingerprint` for `delete_question`/`move_question`. Services: `backend/app/services/template_section_service.py`: `create_section(db, *, project_id, template_id, payload: SectionCreateRequest{name, label, description, cardinality: "one"|"many", parent_entity_type_id, entry_label, is_required})` (L138; `SectionParentMustRepeatError`, `SectionEntryLabelCardinalityError`), `update_section(..., section_id, payload: SectionUpdateRequest{label, entry_label, cardinality, description})` (L225; `SectionCardinalityInUseError`, `SectionEntryLabelCardinalityError`), `delete_section(..., section_id)` (L292; `SectionInUseError`, `SectionOwnsChildrenError`), `owned_section`. `backend/app/services/template_instruction_service.set_template_instruction(db, *, project_id, template_id, llm_template_instruction)` (L49; normalizes whitespace-only to NULL; takes the template draft lock, which `edit_template_draft` already claimed via `claim_draft_lock`). `backend/app/services/template_field_naming.derive_field_name(label, taken)` derives a unique name. `backend/app/services/template_lint.lint_tree` and `extraction_snapshot.live_entity_types` exist. `TemplateConfigDiffRead.changes.destructive` is the destructive bucket. Docs: `docs/how-to/connect-an-ai-agent.md` sections "What edits look like" (~L157) and "Troubleshooting" (~L189).

**Files:**
- Modify: `backend/app/schemas/mcp_template_draft.py` (four ops, `AppliedSectionOp`, `AppliedInstructionOp`, result fields)
- Modify: `backend/app/services/agent_template_draft_service.py` (handlers; split into a `services/agent_template_draft/` package only if `wc -l` would pass 800)
- Modify: `backend/app/api/mcp/tools/template_draft.py` (`_OPS`, mapping, fingerprint rule, result, description)
- Modify: `docs/how-to/connect-an-ai-agent.md` ("What edits look like", Troubleshooting rows; frontmatter `last_reviewed`)
- Test: `backend/tests/unit/test_mcp_template_draft_ops.py`; `backend/tests/integration/mcp/test_mcp_edit_template_draft.py`; `backend/tests/integration/mcp/test_mcp_choke_point.py`; `backend/tests/integration/mcp/test_mcp_result_shape.py`

**Interfaces:**
- Ops:
  ```python
  class AddSectionOp(BaseModel): op: Literal["add_section"]; label: SectionLabel; cardinality: Literal["one", "many"]
      parent_section_id: UUID | None = None; entry_label: SectionEntryLabel | None = None
      description: str | None = Field(default=None, max_length=500); required: bool = False
  class UpdateSectionOp(BaseModel): op: Literal["update_section"]; section_id: UUID
      label: SectionLabel | None = None; description: str | None = Field(default=None, max_length=500)
      entry_label: SectionEntryLabel | None = None; cardinality: Literal["one", "many"] | None = None
  class DeleteSectionOp(BaseModel): op: Literal["delete_section"]; section_id: UUID
  class SetInstructionOp(BaseModel): op: Literal["set_instruction"]; instruction: str | None = Field(max_length=4000)
  ```
  (`SectionLabel`, `SectionEntryLabel` imported from `app.schemas.template_structure`; `update_section` with only `section_id` → `INVALID_ARGUMENT` "name at least one field to change".)
- Applied union gains `AppliedSectionOp{op_index, op: Literal["add_section","update_section","delete_section"], section_id: UUID, label: str | None, cardinality: Literal["one","many"] | None}` (delete carries the removed id, `label`/`cardinality` None) and `AppliedInstructionOp{op_index, op: Literal["set_instruction"], changed: bool}`. `untrusted_fields` already covers `applied[].label`.
- Handlers: `_add_section` derives `name = derive_field_name(label, <names of the template's sections>)` and calls `create_section(payload=SectionCreateRequest(name=..., label=..., description=..., cardinality=..., parent_entity_type_id=op.parent_section_id, entry_label=..., is_required=op.required))`; `_update_section` → `update_section` with the sent keys; `_delete_section` → `before` = label/cardinality, `delete_section`; `_set_instruction` → reads the current live instruction, calls `set_template_instruction`, `changed = normalized_new != old`.
- `_OP_ERRORS`/`_op_failure`: `SectionInUseError`, `SectionCardinalityInUseError` → `IN_USE`; `SectionParentMustRepeatError` → `STRUCTURE_CONFLICT rule="section_parent_must_repeat"`; `SectionEntryLabelCardinalityError` → `rule="section_entry_label_cardinality"`; `SectionOwnsChildrenError` → `rule="section_owns_children"`.
- `expected_fingerprint` is also required when the batch has `delete_section`.
- `EditTemplateDraftResult` gains `lint: McpLintCounts{block: int, warn: int}` (from `lint_tree(live_entity_types(...), live instruction)` after the ops) and `destructive_changes: int` (`len(diff.changes.destructive)`). Neither adds a string leaf.
- `_ALLOWED_OPS` is now the 10 names. The description lists one line per op and says publish is human-only.
- Docs: "What edits look like" lists the ten ops with one example batch (add a repeating section with an entity key and entry label, a select with coded options, an instruction); Troubleshooting gains `IN_USE` (recorded data blocks the change) and `STRUCTURE_CONFLICT` (the `rule` names the conflict) rows.

- [ ] **Step 1: Write the failing tests.**
  - `tests/unit/test_mcp_template_draft_ops.py`: the four ops validate; `cardinality="few"` refused; a 4,001-character instruction refused.
  - `tests/integration/mcp/test_mcp_edit_template_draft.py`:
    - `test_blank_template_built_by_tool_calls`: on a blank template a manager created (`create_blank_template` service for `SEED.primary_project`), tool calls alone build a repeating section with an entity-key question (`update_question is_entity_key`) and an entry label, and a select with coded options; every question carries `instructions`; `view="changes"` fingerprint equals REST `config-diff`; the reply's `lint == {"block": 0, "warn": 0}`.
    - `test_cardinality_many_to_one_with_entries_is_in_use`: a `many` section with 2+ recorded entries (helpers as the section REST tests use) → `update_section cardinality="one"` → `IN_USE`.
    - `test_delete_section_requires_fingerprint` and `test_delete_section_owning_children_is_structure_conflict` (`rule == "section_owns_children"`).
    - `test_delete_section_with_recorded_values_is_in_use`: a section holding a field with a recorded proposal (helpers as the section-in-use REST test in `tests/integration/test_template_structure_endpoints.py`) → `delete_section` with the current fingerprint → `IN_USE` (from `SectionInUseError`), one refused row, section still present.
    - `test_add_section_under_single_parent_is_structure_conflict`: `add_section` with `parent_section_id` of a `cardinality="one"` section → `STRUCTURE_CONFLICT`, `rule == "section_parent_must_repeat"`, one refused row, no section created.
    - `test_entry_label_on_single_section_is_structure_conflict`: `add_section` with `cardinality="one"` and an `entry_label` → `STRUCTURE_CONFLICT`, `rule == "section_entry_label_cardinality"`; and `update_section` setting an `entry_label` on a `one` section → the same rule (both paths raise `SectionEntryLabelCardinalityError`).
    - `test_update_section_without_changes_is_invalid_argument`: `update_section` with only `section_id` → audited `INVALID_ARGUMENT` whose message is "name at least one field to change", `op_index` set, one refused row.
    - `test_set_instruction_while_other_manager_holds_lock`: manager B holds the draft lock → `DRAFT_LOCK_HELD`.
    - `test_set_instruction_reports_changed`.
    - `test_destructive_changes_count`: after removing a published question with data, `destructive_changes >= 1`.
    - `test_one_applied_row_covers_section_ops`.
    - `test_unknown_op_lists_allowed_ops`: the 10 names.
  - `tests/integration/mcp/test_mcp_choke_point.py`: `_DRAFT_OP_CASES` gains `add_section`, `update_section`, `delete_section` (with an `expected_fingerprint`) and `set_instruction`, so each gets the read-token `SCOPE_INSUFFICIENT`, reviewer `MANAGER_REQUIRED` and foreign-lock `DRAFT_LOCK_HELD` cases; the coverage test pins all 10 ops.

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/unit/test_mcp_template_draft_ops.py tests/integration/mcp/test_mcp_edit_template_draft.py tests/integration/mcp/test_mcp_choke_point.py tests/integration/mcp/test_mcp_result_shape.py -q` → FAIL.

- [ ] **Step 3: Implement** per Interfaces; write the docs.

- [ ] **Step 4: Run green + gates.**
  ```bash
  cd "$WT/backend" && uv run pytest tests -q
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh \
    && bash scripts/docs/check-frontmatter.sh
  cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  wc -l "$WT/backend/app/api/mcp/tools/template_draft.py" "$WT/backend/app/services/agent_template_draft_service.py"
  ```
  Expected: PASS; both files ≤ 800.

- [ ] **Step 5: Commit.** `git -C "$WT" add backend docs && git -C "$WT" commit -m "feat(mcp): section and instruction ops in a template draft"`

**Done when:** section and instruction ops apply with their conflicts mapped, a blank template is buildable by tools with clean lint, the reply carries lint counts and destructive changes, docs updated, gates green.

---

### Task 3.8a: Search by article, reference exclusion and block-type filters

**Layer:** backend · **Migration:** no · **Commit:** `feat(mcp): article-level search with reference exclusion and block filters`

**Goal:** `search_project_text` can return one row per article (hit count, top locators, best snippet), skips hits inside a references section by default (echoing that it did), filters by block type, returns tag-free snippets, and refuses an empty or term-less query.

**Context:** `backend/app/api/mcp/tools/search.py` (`search_project_text(db, project_id, query, article_id=None, cursor=None)` → `article_text_search_service.search_project_text`; `InvalidCursorError` → `INVALID_ARGUMENT`). `backend/app/services/article_text_search_service.py` (157 lines): `_PAGE_QUERY_TEMPLATE` ranks blocks with `websearch_to_tsquery('simple', :q)` and `ts_rank`, `project_id` in the WHERE clause (the ownership guard), cursor `(rank, block id)`; `_HEADLINE_QUERY` runs `ts_headline('simple', ..., 'MaxWords=35, MinWords=15, MaxFragments=1')` (default `<b>` markers) only on the page's ids; `_NO_HITS_NOTE`; budget `_HITS_BUDGET = 31_500`. `backend/app/schemas/mcp_search.py`: `McpSearchHit{locator, page, block_index, block_type, snippet}`, `McpSearchArticle{article_id, title, title_truncated, file_id, hits}`, `McpSearchResult{articles, next_cursor, note, untrusted_fields=["articles[].title","articles[].hits[].snippet"]}`. `article_text_blocks` rows carry `article_file_id`, `page_number`, `block_index`, `block_type`, `text`; headings have `block_type = 'heading'`; `backend/app/infrastructure/parsing/base.py:41` `BLOCK_TYPES` (seven values). Locator format `p{page}·b{block}`. Test seeds: `backend/tests/integration/mcp/article_seed.py` (`insert_article`, `insert_pdf`, `insert_blocks(db, file_id, [(page, block_index, text, block_type), ...])`).

**Files:**
- Modify: `backend/app/services/article_text_search_service.py`, `backend/app/api/mcp/tools/search.py`, `backend/app/schemas/mcp_search.py`
- Test: `backend/tests/integration/mcp/test_mcp_search_and_pdf.py`; `backend/tests/unit/test_mcp_search_block_types.py` (new, literal parity); `backend/tests/integration/mcp/test_mcp_result_shape.py`

**Interfaces:**
- `BlockTypeLiteral = Literal[<the seven BLOCK_TYPES values>]` in `schemas/mcp_search.py`, with a unit test asserting `set(get_args(BlockTypeLiteral)) == BLOCK_TYPES`.
- Tool arguments: `group_by: Literal["block", "article"] = "block"`, `exclude_references: bool = True`, `block_types: list[BlockTypeLiteral] | None = None`.
- Schema: `McpSearchLocator{locator: str, page: int, block_index: int, block_type: str, file_id: UUID}`. `McpSearchArticle`: `file_id: UUID | None` (None in article mode), `hits: list[McpSearchHit] = []`, plus `hit_count: int | None = None`, `locators: list[McpSearchLocator] | None = None`, `snippet: str | None = None`. `McpSearchResult` gains `references_excluded: bool`. `untrusted_fields` gains `"articles[].snippet"`; `_TRUSTED_PATHS["search_project_text"]` gains `"articles[].locators[].locator"`, `"articles[].locators[].block_type"`.
- Service `search_project_text(db, *, project_id, query, article_id, cursor, group_by, exclude_references, block_types)`:
  - Term check first: `query.strip() == ""` or `SELECT numnode(websearch_to_tsquery('simple', :q)) = 0` → raise `EmptySearchQueryError` (new); the tool maps it to `INVALID_ARGUMENT` (`field="query"`, message "the query has no searchable terms").
  - Reference exclusion (when `exclude_references`): each candidate block's nearest heading at or before it in the same file (`LEFT JOIN LATERAL (SELECT h.text FROM public.article_text_blocks h WHERE h.article_file_id = b.article_file_id AND h.block_type = 'heading' AND (h.page_number, h.block_index) <= (b.page_number, b.block_index) ORDER BY h.page_number DESC, h.block_index DESC LIMIT 1) lh ON true`) must not match `:refs_re` = `^\s*([0-9]+(\.[0-9]+)*\.?\s*)?(references|bibliography|literature cited|referências|bibliografia)\s*$` (case-insensitive `~*`, bound parameter). A later heading (e.g. Appendix) ends the excluded span.
  - `block_types`: `AND b.block_type = ANY(CAST(:block_types AS text[]))` when given.
  - Snippets: `ts_headline` options add `StartSel="", StopSel=""` so no tags are emitted.
  - `group_by="block"`: today's page shape.
  - `group_by="article"`: one row per `f.article_id` over the same filtered candidates: `count(*)` as `hit_count`, `max(rank)`, the top 3 block ids by `(rank desc, id)` → `locators` (each with its `file_id`), the best block's headline as `snippet`; ordered `(max rank desc, article_id)`; cursor `(max_rank, article_id)` with its own page size (`_PAGE_SIZE`) and the same character budget.
  - No hits → `articles=[]` and a note naming the query (both modes). Zero hits with `exclude_references` → check (one `LIMIT 1` query without the exclusion) whether hits exist inside references; if so `references_excluded=True` and note `"Every hit is inside a references section; retry with exclude_references=false."`. `references_excluded` echoes `exclude_references` otherwise.
- Description: one sentence each for `group_by`, `exclude_references` (on by default) and `block_types`.

- [ ] **Step 1: Write the failing tests.** In `tests/integration/mcp/test_mcp_search_and_pdf.py` (seed with `article_seed` helpers in `SEED.primary_project`):
  - `test_article_mode_excludes_reference_only_citations`: 3 articles mention "MIMIC-IV" in body paragraphs and 1 only after a "References" heading → `group_by="article"` returns exactly the 3 with `hit_count`s in one call; `exclude_references=false` returns 4.
  - `test_appendix_after_references_is_kept`: a hit under "Appendix" (a heading after "References") is returned.
  - `test_numbered_references_heading_is_recognized` ("7. References").
  - `test_block_types_filter`: `block_types=["table_cell"]` returns only table-cell hits.
  - `test_snippets_have_no_tags`: no `<b>` in any snippet.
  - `test_empty_and_termless_query_is_invalid_argument`: `""`, `"   "` and `"!!"` (a query whose tsquery has no node) → `INVALID_ARGUMENT`.
  - `test_all_hits_in_references_note`.
  - `test_article_mode_cursor_pages`.
  - `test_mcp_result_shape.py`: trusted/untrusted updates; `tests/unit/test_mcp_search_block_types.py`: literal parity.

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/integration/mcp/test_mcp_search_and_pdf.py tests/unit/test_mcp_search_block_types.py tests/integration/mcp/test_mcp_result_shape.py -q` → FAIL.

- [ ] **Step 3: Implement** per Interfaces (all SQL through `text()` with bound parameters; `project_id` stays in each WHERE clause).

- [ ] **Step 4: Run green + gates.**
  ```bash
  cd "$WT/backend" && uv run pytest tests -q
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh
  cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  ```
  Expected: PASS, including `check_scope_guards.py` and the existing search tests (block mode unchanged apart from tag-free snippets).

- [ ] **Step 5: Commit.** `git -C "$WT" add backend && git -C "$WT" commit -m "feat(mcp): article-level search with reference exclusion and block filters"`

**Done when:** article mode, reference exclusion, block filters, tag-free snippets and the empty-query refusal work per the tests, result shape updated, gates green.

---

### Task 3.8b: Search syntax descriptions, page-range note and outline filter

**Layer:** backend · **Migration:** no · **Commit:** `feat(mcp): document search syntax and tidy article text reads`

**Goal:** tool descriptions say how search queries and the article list filter behave and what `get_extractions`' stage and AI-only fields mean; `get_article_text` explains a `page_from` past the last page; the file outline drops junk headings (short runs of digits and punctuation) without counting them toward its cap.

**Context:** descriptions live in each tool's `@agent_tool(description=...)`: `backend/app/api/mcp/tools/search.py`, `backend/app/api/mcp/tools/articles.py` (`list_articles(..., query=...)`, a case-insensitive substring of title or authors), `backend/app/api/mcp/tools/extractions.py` (`get_extractions` takes no stage or AI-only argument; its output has `articles[].run.stage` (`McpRunRef.stage`) and `ai_only` (`McpConciseCell.ai_only`), `backend/app/schemas/mcp_extractions.py:22,57`). `backend/app/api/mcp/tools/article_text.py`: `get_article_text(db, article_id, file_id=None, page_from=None, page_to=None, cursor=None) -> str` renders with `_render(article_id, file_id, page, note)` (a note replaces the body). `backend/app/services/article_text_block_read_service.py`: `page_text_blocks(...)`; `get_file_outline(db, *, article_file_id)` (L176) selects headings with `.limit(_HEADING_CAP + 1)` (L200; `_HEADING_CAP = 60`) and sets `headings_truncated` (L203); it also computes `page_count`.

**Files:**
- Modify: `backend/app/api/mcp/tools/search.py`, `backend/app/api/mcp/tools/articles.py`, `backend/app/api/mcp/tools/extractions.py` (descriptions only)
- Modify: `backend/app/api/mcp/tools/article_text.py`, `backend/app/services/article_text_block_read_service.py`
- Test: `backend/tests/integration/mcp/test_mcp_choke_point.py` (description contract), `backend/tests/integration/mcp/test_mcp_article_text.py`, `backend/tests/integration/mcp/test_mcp_article_tools.py`

**Interfaces:**
- `search_project_text` description gains the syntax line, exactly: "Words are ANDed; \"quoted phrase\", or and -term work; & and ! are ignored; no stemming or accent folding." `list_articles` description: "query matches a case-insensitive substring of the title or authors." `get_extractions` description: "Each article's run.stage is the extraction stage; ai_only marks a value only the AI has proposed." (no new argument).
- `get_article_text`: only when `page_from` is given **and** `page_text_blocks` returned no blocks, read the file's last page (`max(page_number)` of its blocks, through a small service helper `last_page_number(db, article_file_id) -> int | None` in `article_text_block_read_service`); if `page_from` exceeds it, return `_render(article_id, file.id, None, f"page_from {page_from} is beyond the last page ({last}).")`. The normal path stays one query.
- `get_file_outline`: add to the heading query's WHERE clause `NOT (char_length(btrim(b.text)) <= 8 AND b.text ~ '^[[:digit:][:punct:][:space:]]*$')`, before `.limit(_HEADING_CAP + 1)`, so dropped headings neither count toward the cap nor set `headings_truncated`.

- [ ] **Step 1: Write the failing tests.**
  - `tests/integration/mcp/test_mcp_choke_point.py`: `test_descriptions_document_search_syntax`: `tools/list` descriptions of `search_project_text` contain `"Words are ANDed"`, `list_articles` contains `"case-insensitive substring"`, `get_extractions` contains `"ai_only"` and `"run.stage"`.
  - `tests/integration/mcp/test_mcp_article_text.py`: `page_from` past the last page → the text contains `"is beyond the last page ("`; an in-range `page_from` returns the page text with no note.
  - `tests/integration/mcp/test_mcp_article_tools.py`: the outline omits a heading `"1 3"`; on a file with more than `_HEADING_CAP` junk headings first (e.g. 70 headings like `"1."`, `"2 3"`) followed by 70 real headings, the outline returns exactly `_HEADING_CAP` real headings with `headings_truncated` true (70 real > cap).

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/integration/mcp/test_mcp_choke_point.py tests/integration/mcp/test_mcp_article_text.py tests/integration/mcp/test_mcp_article_tools.py -q` → FAIL.

- [ ] **Step 3: Implement** per Interfaces.

- [ ] **Step 4: Run green + gates.**
  ```bash
  cd "$WT/backend" && uv run pytest tests -q
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh
  cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  ```
  Expected: PASS.

- [ ] **Step 5: Commit.** `git -C "$WT" add backend && git -C "$WT" commit -m "feat(mcp): document search syntax and tidy article text reads"`

**Done when:** descriptions carry the syntax, the beyond-range note shows, junk headings are filtered in SQL before the cap, gates green.

---

### Task 3.9: Docs, INSTRUCTIONS and the configuration scenario

**Layer:** backend + docs · **Migration:** no · **Commit:** `docs(mcp): configure a project with an agent`

**Goal:** the server instructions tell an agent how to configure a project; the how-to documents the new tools, limits and search behavior; one end-to-end test takes a blank template to a published questionnaire using only MCP calls plus one REST publish, with exactly one applied audit row per MCP write.

**Context:** `backend/app/api/mcp/server.py:63` `INSTRUCTIONS` is 1,314 characters; `backend/tests/integration/mcp/test_mcp_choke_point.py::test_server_info_instructions_and_cache_hints` (~L254) asserts `len(client.instructions) <= _PRE_HARDEN_INSTRUCTIONS_LEN + 250` (1,095 + 250) and a 2,048 cap. `docs/how-to/connect-an-ai-agent.md` (203 lines): sections "What the agent can do" (~L116), "Search results" (~L142), "What edits look like" (~L157, updated in Task 3.7b), "What the agent cannot do" (~L174), "Limits" (~L183), "Troubleshooting" (~L189). REST publish: the template publish endpoint under `/api/v1/projects/{pid}/templates/{tid}/...` that takes the diff fingerprint (find it with `grep -n "publish" backend/app/api/v1/endpoints/project_templates.py`). Tools available after the earlier tasks: `get_setup_readiness`, `get_review_question`, `set_review_question`, `update_project_details`, `list_template_catalogue`, `get_template` (`view` published/draft/changes), `edit_template_draft` (10 ops, `expected_fingerprint`).

**Files:**
- Modify: `backend/app/api/mcp/server.py` (`INSTRUCTIONS`)
- Modify: `backend/tests/integration/mcp/test_mcp_choke_point.py` (bound + assertion)
- Modify: `docs/how-to/connect-an-ai-agent.md` (frontmatter `last_reviewed`)
- Test: new `backend/tests/integration/mcp/test_mcp_config_agent_scenario.py`

**Interfaces:**
- `INSTRUCTIONS` gains, after the questionnaire paragraph, exactly: "Setup: get_setup_readiness first; review question via get/set_review_question with expected_revision; questionnaire via edit_template_draft, then get_template(view='draft'/'changes'); publish is human-only in prumo." (≈ 215 characters; total stays ≤ 1,645 and ≤ 2,048).
- `test_server_info_instructions_and_cache_hints`: bound becomes `_PRE_HARDEN_INSTRUCTIONS_LEN + 250 + 300`, add `assert "get_setup_readiness" in client.instructions`; the 2,048 assertion stays. Update the comment above `_PRE_HARDEN_INSTRUCTIONS_LEN` to say the configuration paragraph may spend at most 300 more.
- How-to: new section "Configure a project with an agent" (the readiness → review question → eligibility → structural ops → changes view → human Publish flow, with the `expected_revision` and `expected_fingerprint` rules). Rewrite "What the agent can do" (add `get_setup_readiness`, `get_review_question`, `set_review_question`, `list_template_catalogue`, the structural `edit_template_draft` ops and `get_template` views), "What the agent cannot do" (drop the move/delete/options/section bullet and "Edit PICOT criteria"; keep publish/discard, changing a field's type or name, clone/import, blind-review visibility) and "Limits". Update "Search results" for `group_by` (article mode), `exclude_references` with `references_excluded`, `block_types` and the query syntax line.

- [ ] **Step 1: Write the failing tests.**
  - `test_mcp_choke_point.py`: the new bound and `get_setup_readiness` assertion (red until `INSTRUCTIONS` changes).
  - New `tests/integration/mcp/test_mcp_config_agent_scenario.py` with a `read_write` PAT for the manager (`pat_primary_rw`), on a project fixture with `review_type` set, reviewer-capable members meeting the HITL `reviewer_count`, text on every article, an engine credential for the caller (recorded-LLM helpers; no real key) and the parser not `llamaparse`; a blank extraction template a manager created with `create_blank_template` and made active:
    1. `get_setup_readiness` → contains `REVIEW_QUESTION_EMPTY`;
    2. `set_review_question` with `expected_revision` from `get_review_question` → applied;
    3. `update_project_details` sets `eligibility_criteria` (expected echoed from `get_project`);
    4. `edit_template_draft` builds a repeating section (entity-key question, `entry_label`) and a single section with a coded select; every question sets `instructions`;
    5. `get_template(view="changes")` → its `fingerprint` equals REST `config-diff` `data.fingerprint`;
    6. `get_setup_readiness` → no block item, and `DRAFT_PENDING_PUBLISH` is the only template warning;
    7. REST publish with that fingerprint → success;
    8. `get_setup_readiness` → no template item.
    After the run, `agent_actions` has exactly one `applied` row per MCP write call (3 + however many `edit_template_draft` calls step 4 made) and no refused row.

- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/integration/mcp/test_mcp_choke_point.py tests/integration/mcp/test_mcp_config_agent_scenario.py -q` → FAIL (instructions bound/assert; the scenario may already pass — if it does, keep it and record that it passed first time).

- [ ] **Step 3: Implement** the instructions and the docs.

- [ ] **Step 4: Run green + gates.**
  ```bash
  cd "$WT/backend" && uv run pytest tests -q
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh \
    && bash scripts/docs/check-frontmatter.sh
  cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  ```
  Expected: PASS; docs CI checks green.

- [ ] **Step 5: Commit.** `git -C "$WT" add backend docs && git -C "$WT" commit -m "docs(mcp): configure a project with an agent"`

**Done when:** instructions carry the setup paragraph within budget, the how-to documents the new surface, the scenario passes end to end with one applied row per write, gates green.

---

## Slice end (after Task 3.9, before the PR opens)

- [ ] **Re-check migration numbers against `origin/dev`.** `git -C "$WT" fetch origin dev`, then `git -C "$WT" ls-tree -r --name-only origin/dev backend/alembic/versions | grep -E '/008[7-9]_'`. No output → nothing to do. Any output means `dev` took a number: merge `origin/dev` into the branch, then renumber this branch's two migrations in order to the next free numbers, renaming together each file, `revision`, `down_revision` (the first one's = `dev`'s head), the docstring revision lines, `expected_head`, the roundtrip tests' names and downgrade targets in `test_migration_roundtrip.py`, and the "Migration head:" line in `docs/reference/extraction-hitl-architecture.md`; re-run `cd "$WT/backend" && uv run alembic upgrade head && uv run pytest tests/integration/test_migration_roundtrip.py -q` → PASS, and commit `fix(db): renumber the config-agent migrations after dev`.
- [ ] **Full gates and diff coverage.**
  ```bash
  cd "$WT/backend" && uv run pytest tests/ --cov=app --cov-report=xml -q \
    && uv run diff-cover coverage.xml --compare-branch=origin/dev --fail-under=80
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh \
    && cd "$WT/backend" && uv run alembic check \
    && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  cd "$WT" && npm run generate:api-types && git -C "$WT" status --short frontend/types/api \
    && npm run test:run && npm run typecheck && npm run lint && npx knip && npx knip --production
  cd "$WT/backend" && uv run pytest tests/integration/mcp tests/unit/test_mcp_errors.py tests/unit/test_template_lint.py -q
  ```
  Expected: full suite PASS; diff coverage ≥ 80% (a file under it gets its missing direct unit or service-level test in a `test(<area>): ...` commit); every gate green; no API type diff.
- [ ] **Design review** (`design-review` skill) on the PicotsPane conflict banner, the run-screen drift chip and the diff-sheet "AI input" badge, desktop and 375 px, light and dark; fixes go in a `fix(<area>): ...` commit.
- [ ] **Manual check (recorded in the PR body).** With `make start` and a `read_write` PAT in Claude Code Auto mode, run the configuration flow from Task 3.9 on a local test project: no per-call prompt appears; record the tool-call count and the largest response (≤ 32,000 characters, notably `get_template` with `view="changes"`); publish in the UI.
- [ ] **PR.** One PR to `dev`, title `feat(mcp): configure a project's review question and questionnaire through MCP`. Body: a behavior summary per area (instrument code, protocol revision and typed shapes, review question in prompts and run drift, settings conflict banner, review-question tools, catalogue and richer `get_template`, lint and `affects_ai`, draft/changes views, readiness, structural draft ops, search) with the tests that pin each; `Fixes PRU-83, PRU-97, PRU-98, PRU-99`; the **Prompt change**, **Fingerprint** and **Deploy skew** notes from Global Constraints; a **Data notes** section (migration 0087 adds `instrument` with default `custom` and writes no data — the seed sets codes; 0088 adds `protocol_revision` default 1); the manual-check record. Describe behavior and tests only; cite no local-only document.
- [ ] **After merge and deploy (recorded in the PR):** `make quality-scan` on the merge SHA. The `web` service runs the idempotent seed on every boot, so the deploy itself sets the global codes and converges clones (a seed failure aborts the boot: `converge_instrument_codes` must stay idempotent and raise nothing on a converged database). Confirm with a read-only `list_template_catalogue` call on a test project that each global shows its code.
