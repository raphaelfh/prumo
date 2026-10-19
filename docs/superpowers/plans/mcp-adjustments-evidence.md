---
status: draft
last_reviewed: 2026-10-18
owner: '@raphaelfh'
---

# Verifiable AI evidence, typed absences, provenance and a usage ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** every stored AI value traces to a verifiable location in the parsed article, to the exact template version, output schema and article text it came from, and to every model call that produced it, with token usage that outlives the run. The reviewer UI, the MCP agent (`get_extractions`) and the REST reads show one shape: `grounded`, `stale`, a `p{page}·b{block}` locator, and compact provenance.

**Architecture:** the PyMuPDF parser types running heads and page numbers as chrome, orders two-column pages by column, and every parser's blocks pass one normalization step before offsets are assigned. Evidence rows record the article `content_version` they anchored against; a reparse re-anchors them in the same lock and transaction or leaves them visibly stale. The prompt carries `[p{page}·b{index}]` block refs (prompt-only; the reader markdown is byte-identical); the model answers `{block_ref, quote}`, a grounding validator retries bad refs, and the page is always derived from the anchor, never taken from the model. The AI output model offers only the `absent_reason` codes a field allows, and the write mapping stores typed markers or in-domain values. Snapshots gain template version, schema and text hashes and per-pass call detail; a metered `StructuredCall` writes one durable row per model call to a deny-all `ai_usage_ledger`. A unique index enforces one `entity_key` per coordinate.

**Tech Stack:** FastAPI, Pydantic v2, pydantic-ai 1.107, SQLAlchemy 2 async, Alembic, Postgres 17, PyMuPDF (fitz), MCP Python SDK, React 19 + TanStack Query + Vitest.

**Scope:** 19 tasks, one PR. No spec link: the goal, the global constraints and the per-task requirements below are the contract.

## Global Constraints

- **Worktree.** `$WT` = `/Users/raphaelfedericcihaddad/PycharmProjects/prumo/.claude/worktrees/mcp-adjustments-config-agent-s4-d22977` (branch `feat/mcp-adjustments-evidence`, cut from `origin/dev` at `e91417d5`). Every command uses `git -C "$WT"` or absolute `$WT/...` paths; never touch the main checkout. Confirm with `git -C "$WT" status` that edits landed there. Never `git stash`. One implementer at a time: tasks run strictly in document order (the build is sequential).
- **One PR.** The plan ships as one PR to `dev` (squash-merged), title `feat(extraction): verifiable evidence locators, typed absences, provenance and a usage ledger`. Each task ends in its own conventional commit (title given in the task). PR body tracker line: `Fixes PRU-75, PRU-78, PRU-84, PRU-85, PRU-87, PRU-106, PRU-66` and `Refs PRU-105` (Part 1 only; it stays open). If Task 4.2(a) did not run (no corpus go), `PRU-84` moves from `Fixes` to `Refs`. The body carries the **Prompt change** note (prompts now carry block refs and ask for `{block_ref, quote}`; prompt VERSION hashes change; about 3–6% more prompt tokens), the **Data notes** (0089 adds a nullable column and writes nothing; 0090 heals duplicate `entity_key` holders, keeping the oldest, and the downgrade cannot restore keys; 0091 adds a deny-all table) and the **Post-merge maintainer steps** (Slice end).
- **Test-first.** Each task writes its failing test, runs it red and reads the failure, then implements; no "done" without the green command output read back.
- **Errors.** New REST domain errors subclass `AppError` (`backend/app/core/error_handler.py`) with an UPPER_SNAKE code through the global handler; an endpoint that newly answers a status declares it in `responses=` (`scripts/fitness/check_response_descriptions.py`). MCP tool errors keep the `McpToolError` envelope; this plan adds no MCP error code (the `tests/unit/test_mcp_errors.py` member set stays at 17).
- **MCP result shape** (`get_extractions` is the only MCP tool touched): every new string leaf is either a server-generated path added to `_TRUSTED_PATHS["get_extractions"]` in `backend/tests/integration/mcp/test_mcp_result_shape.py` or listed in `untrusted_fields`. The walker writes list items as `[]` and map values as `{}`, skips `const`/`enum`/`Literal` leaves and `uuid`/`date-time` formats, and demands exact set equality. Each result stays at most 32,000 characters (`app.utils.compact_json.RESULT_CAP`, measured as `len(compact_json(model.model_dump(mode="json")))`). Reads only: no MCP write is added, so no audit row changes.
- **Layering.** `backend/app/api/**` imports services and support modules only (`scripts/fitness/check_layered_arch.py`). `app/domain/`, `app/llm/`, `app/infrastructure/` and `app/schemas/` are support: they import support only, never `app.services`, `app.repositories` or `app.models`. New `app/domain/evidence_block_refs.py` is support and imports no service. Services own their writes; endpoints commit. One ownership predicate, in the WHERE clause (`scripts/fitness/check_scope_guards.py` stays green).
- **Data path.** No new direct PostgREST read or write; frontend data goes through `apiClient` → service (`ErrorResult<T>` via `toResult`) → TanStack hook. `scripts/fitness/check_frontend_data_path.py` baseline does not grow.
- **Migrations.** Three, in this order: Task 4.3 (`0089_evidence_content_version`), Task 4.9a (`0090_entity_key_unique`), Task 4.8a (`0091_ai_usage_ledger`). Each migration task first confirms the head: `ls "$WT/backend/alembic/versions" | grep '^0' | sort | tail -1` must print the previous file (`0088_protocol_revision.py` for 4.3, `0089_evidence_content_version.py` for 4.9a, `0090_entity_key_unique.py` for 4.8a). Revision id ≤ 32 characters, `down_revision` = previous head; move `expected_head` in `backend/tests/integration/test_migration_roundtrip.py::test_alembic_head_is_expected_revision` (~L1334) and add a roundtrip test modelled on `test_migration_0088_protocol_revision_roundtrip` (~L2282): at head the object exists; `_run_alembic("downgrade", "<parent>", database_url=migration_db_url)` removes it; `"upgrade", "head"` restores it; `rollback()` after each read. Every index (partial ones included) and every `Computed` column is declared on the model so `cd "$WT/backend" && uv run alembic check` prints no diff. Additive only, no seed data, never app-schema DDL through the Supabase MCP. Each migration task also bumps the "Migration head:" line (~L138) of `docs/reference/extraction-hitl-architecture.md` and its frontmatter `last_reviewed:`, and runs `bash scripts/fitness/check_migration_split.sh` and `check_rls_coverage.py`.
- **Backend test infra.** `backend/.env` points `DATABASE_URL` at database `postgres_test_mcp_config_agent` on `localhost:55432` (stub + `alembic upgrade head` + seed applied) and `REDIS_URL=redis://localhost:56379/0`. Run `cd "$WT/backend" && uv run pytest <paths> -q`. Never the shared local Supabase stack; never `make db-fresh`/`make reset-db`; never print `.env`. A migration task runs `cd "$WT/backend" && uv run alembic upgrade head` on that database before the suite. **Every backend task's gate runs the full backend suite** (`uv run pytest tests -q`), not only the touched files.
- **No LLM in CI.** CI has no provider key. A test that reaches a model call uses the recorded fake (`backend/tests/fakes/recorded_llm.py::RecordedLlm`, with `tests/integration/helpers/engine_setup`) or monkeypatches the credential seam; no test reads a real key. Prompt changes update recorded fixtures in the same task.
- **Coverage.** CI fails a PR whose diff coverage is under 80%. Each changed REST endpoint body gets a direct unit test (handler via `fn.__wrapped__`, as in `backend/tests/unit/test_ai_context_endpoints_unit.py`); each service function a direct service-level test on `db_session`; MCP code is covered through the `mcp_client` fixtures. Reproduce: `cd "$WT/backend" && uv run pytest tests/ --cov=app --cov-report=xml -q && uv run diff-cover coverage.xml --compare-branch=origin/dev --fail-under=80`.
- **No app-unused symbol at any task boundary.** Vulture scans `backend/app` only, so a function, field, constant or property lands in the task that adds its first `backend/app` caller (tests do not count). Each backend task ends with `cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec` green; the baseline never grows, and a deletion that removes a baselined name shrinks `backend/.vulture_baseline` in the same task. Frontend: `npx knip` and `npx knip --production` stay at 0.
- **File size.** `scripts/fitness/check_file_size.py` caps `backend/app` and `frontend` files at 800 lines. At `e91417d5`: `services/extraction_agent_read_service.py` 798, `services/evidence_anchor_service.py` 764. Growth goes to the two new helper files named by this plan — `backend/app/domain/evidence_block_refs.py` (Task 4.4a/4.4b) and `backend/app/services/extraction_agent_evidence.py` (Task 4.5b) — each ≤ 800 lines. Check `wc -l` of every grown file before committing.
- **Fitness scripts** run from `$WT` with the backend venv first on PATH: `cd "$WT" && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/<script>.py`, and `cd "$WT" && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh` for the whole set.
- **Frontend tooling runs from the repo root** (`$WT`): `npx vitest run <file>`, `npm run test:run`, `npm run typecheck`, `npm run lint`, `npx knip`, `npx knip --production`. Never `cd frontend && npm ...`. If `$WT/node_modules` is missing or a symlink, run `cd "$WT" && npm ci` first. React Compiler: no `try/finally` and no `throw` inside `try` in a component or hook body.
- **REST contract change** (any edit to a schema served by `/api/v1`, docstrings included) ⇒ `cd "$WT" && npm run generate:api-types` and commit `frontend/types/api/schema.d.ts` + `frontend/types/api/openapi.json` in the same task; `npm run typecheck` is green at every task boundary.
- **Amendments only to ADR 0011, 0013 and 0016**, each as a dated "Amendment (2026-10)" section; no new ADR. Docs edits keep valid frontmatter (`bash scripts/docs/check-frontmatter.sh`) and bump `last_reviewed:`.
- **Derived state is computed, never stored.** `grounded` = the position parses to an anchor (`parse_position`). `stale` = grounded AND `evidence.content_version IS NOT NULL` AND `evidence.content_version <> article_files.content_version` — one predicate, `evidence_is_stale`, in `app/domain/evidence_block_refs.py`. Re-anchoring may rewrite `position`, `page_number` and `content_version`, never `text_content` or `anchor.quote`. `llm.prompts.content_version()` (a prompt hash) is never confused with the integer article `content_version`.
- **No dead code.** A replaced path is deleted in the same task; orphans found outside the task go in a sibling `refactor(<area>): ...` commit.
- **Copy** goes through `t(namespace, key)` from `frontend/lib/copy/`; `scripts/fitness/check_copy_keys.py` stays green. Query keys come from factories only.
- **English only** in code, comments, commits, docs and copy keys.
- **Public wording.** This repo is public. Commit messages, the PR title/body and docs describe the intended behavior and the tests only, cite no local-only document, path or key, name no private project and carry no attack recipe or "before" reproduction.
- **Production data steps are not build tasks.** `evidence_repair --apply`, the production `evidence_repair` dry run and the reparse backfill run only after merge, with the maintainer's recorded go (Slice end).
- **Gates per task:** backend tasks — `cd "$WT" && make lint-backend`, `cd "$WT/backend" && uv run pytest tests -q`, the vulture command, `PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh`, `uv run alembic check` on model or migration tasks; frontend tasks — `npm run test:run`, `npm run lint`, `npm run typecheck`, `npx knip`, `npx knip --production`, `check_copy_keys.py`. Tasks that touch both run both sets.

## Task order

| Task | Title | Layer | Migration | Depends on |
|---|---|---|---|---|
| 4.1a | Chrome typing and one normalization pass for every parser | backend | no | — |
| 4.1b | Column-aware reading order and the two-column golden fixture | backend | no | 4.1a |
| 4.3 | Evidence records its content version; reparse re-anchors or leaves it stale (0089) | backend | **0089** | — |
| 4.4a | Block refs in the prompt; prompt always built from blocks; ADR 0013 Amendment | backend + docs | no | 4.3 |
| 4.4b | `{block_ref, quote}` evidence, grounding validator, derived location | backend | no | 4.4a |
| 4.5a-1 | REST `grounded` / `stale` on evidence + regenerated types | backend + types | no | 4.4b |
| 4.5a-2 | Review UI: grounded, stale and ungrounded evidence states | frontend | no | 4.5a-1 |
| 4.5b | Anchor-based MCP locator, `grounded` / `stale`, docs | backend + docs | no | 4.4b |
| 4.5c | `evidence_repair` operator command (dry run by default) | backend | no | 4.4b |
| 4.6a | `absent_reason` offered per field; `Unclear` scales; prompt rules | backend | no | 4.4b |
| 4.6b | Absent-reason write mapping, `Unclear` rule, ADR 0016 Amendment | backend + frontend test + docs | no | 4.6a |
| 4.9a | One `entity_key` per coordinate in the database (0090) | backend | **0090** | 4.3 |
| 4.9b | Re-key duplicate check, typed 409 everywhere, dialog message | both | no | 4.9a |
| 4.7a-1 | Call accounting: request ids, verify/entailment usage, `passes_detail` | backend | no | 4.3, 4.6b |
| 4.7a-2 | Snapshot identity: template version, schema and text hashes | backend + frontend type | no | 4.7a-1 |
| 4.7b | Compact provenance on MCP AI rows | backend | no | 4.7a-2, 4.5b |
| 4.8a | `ai_usage_ledger` table, deny-all posture (0091) | backend | **0091** | 4.7b, 4.9a |
| 4.8b | Metered model calls write durable ledger rows; one `results.tokens` shape | backend | no | 4.8a |
| 4.2 | **HUMAN GATE: corpus download.** Docling bake-off + ADR 0011 Amendment; parser selection only on ruling a/b | backend + docs | no | 4.1b, all |

- Sequential by shared files: 4.1a → 4.1b edit `infrastructure/parsing/pymupdf_parser.py`; 4.3 → 4.4a → 4.4b → 4.7a-2 edit `services/extraction_prompt_input.py`; 4.3 → 4.4b → 4.6b → 4.7a-1 edit `services/ai_extraction/_candidates.py`; 4.4b → 4.6a → 4.7a-1 → 4.7a-2 edit `services/ai_extraction/_model_calls.py`; 4.5b → 4.7b edit `services/extraction_agent_evidence.py`; 4.9a → 4.9b edit `services/entity_key.py`.

## Review Focus

1. **The LLM never supplies a page:** an unanchored quote persists `page_number = NULL`, `position = {}` and `ungroundable`; a grounded quote's page comes from the anchor (4.4b); the MCP locator is built from the parsed anchor only (4.5b).
2. **Locators are derived, the quote is history:** re-anchoring and `evidence_repair` rewrite only `position`, `page_number`, `content_version` of AI evidence; `text_content` and `anchor.quote` never change; a NULL version reads current, a failed re-anchor reads stale; `stamp-versions --apply` holds the same per-file lock as a reparse and re-reads under it (4.3, 4.5c).
3. **Reader bytes:** `content_markdown` and the reader stay byte-identical; refs are prompt-only (4.4a).
4. **Typed absences:** only offered codes are written; `not_evaluated` is never offered; an `Unclear` scale stores its own code, never a marker (4.6a, 4.6b).
5. **Ledger durability and posture:** one row per model call in its own transaction from a session factory built in `app/core/factories.py` and injected by the worker (never derived inside the service), surviving the run rollback; a ledger write failure is raised (or logged at error on an already-failing call), never swallowed; `anon`/`authenticated` cannot select or insert (4.8a, 4.8b).
6. **Identity:** the 0090 heal is deterministic (oldest holder keeps the key) and the re-key, manual add and AI landing paths all return the typed outcome, never a 500 (4.9a, 4.9b).

---

### Task 4.1a: Chrome typing and one normalization pass for every parser

**Layer:** backend · **Migration:** no · **Commit:** `feat(parsing): type running heads as page chrome and normalize block text once for every parser`

**Goal:** PyMuPDF types running heads, footers and page numbers as `header`/`footer` (still stored; `render_blocks_to_markdown` already skips them), and every parser's blocks go through one pure normalization step before char offsets are assigned, so no zero-width character or dotted leader reaches storage.

**Context:** `backend/app/infrastructure/parsing/pymupdf_parser.py::PymupdfParser.parse` (L137): pass 1 (L146-184) fills `per_page[page_number] = {"text", "tables", "images"}`; pass 2 (L196-276) sorts `entries` by `(y, x)` (L215) and builds `ParsedBlock`s with `block_type=normalize_block_type("heading" | "paragraph")`. `fitz` page height is `page.rect.height`; block bboxes are `[x0, y0, x1, y1]` with y growing downwards. `backend/app/infrastructure/parsing/base.py`: `ParsedBlock` (L~97, a dataclass with `page_number`, `block_index`, `text`, `char_start`, `char_end`, `bbox`, `block_type`, table-cell fields), `BLOCK_TYPES` includes `header`/`footer` (L49-50), `assign_char_offsets_to_blocks` (L168), `render_blocks_to_markdown` (L329) skips `header`/`footer`/`figure`. `backend/app/services/document_parsing_service.py::parse_article_file` (L95): `blocks = self.parser.parse(pdf_bytes)` (L134), then `assign_char_offsets_to_blocks(blocks)` (L143), lock, `replace_for_file`, `content_markdown`, `content_version` bump. This one call site covers PyMuPDF, Docling, LlamaParse and `FallbackDocumentParser`.

**Files:**
- Modify: `backend/app/infrastructure/parsing/pymupdf_parser.py` (`_classify_chrome`, page heights collected in pass 1)
- Modify: `backend/app/infrastructure/parsing/base.py` (`normalize_block_text`, `normalize_blocks`)
- Modify: `backend/app/services/document_parsing_service.py` (apply `normalize_blocks` before offsets)
- Test: `backend/tests/unit/test_pymupdf_parser.py`, `backend/tests/unit/test_parsing_base.py`, `backend/tests/integration/test_document_parsing_service.py`

**Interfaces:**
- `pymupdf_parser.py`:
  ```python
  _CHROME_BAND_RATIO = 0.08          # top/bottom band: at most 8% of page height
  _CHROME_MIN_REPEATS = 3            # digit-masked text on >= 3 pages
  _CHROME_SHORT_DOC_PAGES = 6        # below this, >= 50% of pages instead
  def _classify_chrome(per_page: dict[int, list[ParsedBlock]], page_heights: dict[int, float]) -> None
  ```
  Pure, mutates `block_type` in place (`ParsedBlock` is a mutable `@dataclass`, `base.py` L71). A non-table, non-figure block whose bbox lies wholly in the top band (`y + height <= band`) or bottom band (`y >= page_height - band`) becomes `header` (top) or `footer` (bottom) when either (a) its stripped text is a bare page number (`^\d{1,4}$`), `Page n` / `Page n of m` (case-insensitive), or a digits-only string of at most 6 characters after removing spaces and `-–/.`; or (b) its digit-masked key (`re.sub(r"\d+", "#", text.strip().casefold())` with whitespace collapsed) occurs in the same band on at least `_CHROME_MIN_REPEATS` distinct pages — or on at least half the pages when the document has fewer than `_CHROME_SHORT_DOC_PAGES` pages (minimum 2). Odd/even alternation is allowed naturally because the count is per key, not per consecutive page. Run it once after pass 2 has built the page's blocks (group the built `ParsedBlock`s by page; record `page_heights[page_number] = float(page.rect.height)` in pass 1). Body text that appears once is never touched.
- `base.py`:
  ```python
  _INVISIBLE = dict.fromkeys(map(ord, "​‌‍⁠﻿­"), None)
  _DOT_LEADER = re.compile(r"(?:\s*\.){4,}\s*")     # >= 4 dots (spaced or not) -> one space
  def normalize_block_text(text: str) -> str
  def normalize_blocks(blocks: list[ParsedBlock]) -> list[ParsedBlock]
  ```
  `normalize_block_text`: `text.translate(_INVISIBLE)`, then collapse dot-leader runs to `" "`, then `.strip()`; `"..."` (three dots) is kept; no NFKC. `normalize_blocks`: returns new blocks with normalized text; drops a block whose `block_type != "table_cell"` and whose text was non-empty before and is empty after (figure blocks, whose text is already `""`, are kept); then renumbers `block_index` contiguously per page in the existing order so later block-ref windows (±1 block) stay meaningful. Table cells are never dropped (an empty cell is a valid grid position).
- `document_parsing_service.py`: `blocks = normalize_blocks(self.parser.parse(pdf_bytes))` inside the existing `try` (a normalization error is a parse failure), then the existing `assign_char_offsets_to_blocks(blocks)`.

- [ ] **Step 1: Write the failing tests.**
  - `tests/unit/test_pymupdf_parser.py`: build PDFs with fitz in the test (helper beside `_one_page_pdf`): `test_running_heads_typed_as_chrome` — 4 pages, each with a top-band line `"J Clin Epi 2024; 12:{page}"` and a bottom-band `"{page}"`, plus distinct body text; every running head parses as `header`, every page number as `footer`, body blocks as `paragraph`/`heading`, and `render_blocks_to_markdown(blocks)` contains no running head. `test_body_text_repeated_once_is_not_chrome` — a body sentence that appears in the top band on one page only stays `paragraph`. `test_page_n_of_m_footer` — `"Page 2 of 3"` in the bottom band is `footer`. `test_short_document_half_pages_rule` — a 2-page document with the same top line on both pages types it `header`.
  - `tests/unit/test_parsing_base.py`: `test_normalize_block_text_strips_invisible_chars` (`"10.1000/​xyz­"` → `"10.1000/xyz"`), `test_normalize_block_text_collapses_dot_leaders` (`"Age ........ 54"` → `"Age 54"`, `". . . . ."` collapses), `test_normalize_block_text_keeps_ellipsis` (`"and so on..."` unchanged), `test_normalize_block_text_no_nfkc` (`"ﬁ"` ligature unchanged), `test_normalize_blocks_drops_emptied_prose_keeps_figures_and_cells` (a `"​"` paragraph is dropped, a figure with `""` and an empty `table_cell` stay; indexes renumbered 0..n-1 per page).
  - `tests/integration/test_document_parsing_service.py::test_blocks_normalized_before_offsets`: a stub `DocumentParser` returning blocks with `"​"` inside text; after `parse_article_file`, no stored block text contains U+200B and, for every stored block, `concat_page_text(blocks)[page][char_start:char_end] == text`.
- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/unit/test_pymupdf_parser.py tests/unit/test_parsing_base.py tests/integration/test_document_parsing_service.py -q` → FAIL (`ImportError: normalize_block_text`, chrome blocks typed `paragraph`).
- [ ] **Step 3: Implement** per Interfaces. Keep `pymupdf_parser.py` and `base.py` under 800 lines (283 and 366 today).
- [ ] **Step 4: Run green + gates.**
  ```bash
  cd "$WT/backend" && uv run pytest tests -q
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh
  cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  ```
  Expected: PASS. Existing reader/markdown tests stay green (chrome was already skipped by the renderer; only typing changed).
- [ ] **Step 5: Commit.** `git -C "$WT" add backend && git -C "$WT" commit -m "feat(parsing): type running heads as page chrome and normalize block text once for every parser"`

**Done when:** running heads and page numbers are typed chrome and stay stored, body text is untouched, every parser's blocks are normalized before offsets, the offset invariant holds, gates green.

---

### Task 4.1b: Column-aware reading order and the two-column golden fixture

**Layer:** backend · **Migration:** no · **Commit:** `feat(parsing): column-aware reading order with a two-column golden fixture`

**Goal:** PyMuPDF orders a two-column page band by band, column by column (left to right), top to bottom, instead of interleaving the columns by y; single-column pages are unchanged. A deterministic generated PDF pins the whole parse (order, chrome, normalization) in a golden file.

**Context:** after Task 4.1a. `pymupdf_parser.py` pass 2 builds `entries: list[tuple[float, float, str, Any]]` as `(y0, x0, kind, payload)` for text blocks (`payload["bbox"]`), tables (`rect`) and images (`img["bbox"]`), then `entries.sort(key=lambda e: (e[0], e[1]))` (L215 at `e91417d5`). The page width is `page.rect.width` (collect it in pass 1 next to the 4.1a page heights). Normalization happens in `DocumentParsingService` (4.1a), so the golden test runs `normalize_blocks(PymupdfParser().parse(pdf))` followed by `assign_char_offsets_to_blocks` — the exact ingest sequence.

**Files:**
- Modify: `backend/app/infrastructure/parsing/pymupdf_parser.py` (`_reading_order`; entries carry the full bbox)
- Create: `backend/tests/fixtures/parsing/two_column.py` (deterministic PDF builder)
- Create: `backend/tests/fixtures/parsing/two_column.golden.json`
- Create: `backend/tests/unit/test_pymupdf_parser_golden.py`
- Test: `backend/tests/unit/test_pymupdf_parser.py`

**Interfaces:**
- Entries become `(x0, y0, x1, y1, kind, payload)` (or a small `NamedTuple _Entry(x0, y0, x1, y1, kind, payload)`; prefer the NamedTuple for readability).
  ```python
  _FULL_WIDTH_RATIO = 0.60
  def _reading_order(entries: list[_Entry], page_width: float) -> list[_Entry]
  ```
  Pure. (1) An entry with `x1 - x0 >= 0.60 * page_width` is full-width; full-width entries, taken in y order, cut the page into horizontal bands (a full-width entry is its own band, emitted in y order between the bands it separates). (2) Within a band, detect column gaps from the x-intervals of its entries: sort intervals by `x0`, merge overlapping ones; each gap between merged intervals whose width is at least 2% of `page_width` is a column boundary. (3) Assign each entry to a column by its x-center against the boundaries; order band → column left-to-right → `y0` → `x0`. (4) A band with no gap (one column) sorts by `(y0, x0)` — byte-identical to today, so single-column pages never change.
  Replace the `entries.sort(...)` line with `entries = _reading_order(entries, page_widths[page_number])`; the per-entry unpacking in the loop reads the new tuple shape. Chrome classification (4.1a) still runs after the blocks are built.
- `tests/fixtures/parsing/two_column.py`: `def build_two_column_pdf() -> bytes` — fitz, fixed page size (A4, 595×842), fixed font (`helv`) and sizes, `insert_textbox` only, 3 pages: page 1 a full-width title and a full-width abstract, then two columns (left x 50-290, right x 305-545) with distinct, recognisable sentences (`"LEFT-1-a"`, `"RIGHT-1-a"` prefixes); an alternating running head (odd pages `"Short Title et al."`, even pages `"J Test Med 2026"`) in the top band and the page number in the bottom band; a DOI line containing U+200B characters (`"doi:10.​1000/​test"`); a dotted-leader table-like row (`"Age ........ 54"`). No timestamps or randomness (`doc.set_metadata({})`; `doc.tobytes(garbage=0, deflate=False)` must be stable across runs — assert two builds are byte-equal in the test).
- Golden file: a JSON list of `{"page": int, "block_index": int, "block_type": str, "text": str}` in reading order. `test_pymupdf_parser_golden.py::test_two_column_golden` compares the parse to it; regenerate only deliberately with `UPDATE_GOLDEN=1 uv run pytest tests/unit/test_pymupdf_parser_golden.py` (the test writes the file when the env var is set, then fails with "golden updated, review the diff" so a regen never passes silently).

- [ ] **Step 1: Write the failing tests.**
  - `tests/unit/test_pymupdf_parser.py::test_single_column_order_unchanged`: a single-column page with 5 blocks at known y positions parses in the same order as `sorted(by (y, x))` — and pure `_reading_order` on synthetic single-column entries returns them in `(y0, x0)` order.
  - `::test_two_column_band_reads_left_column_first` (pure `_reading_order` on synthetic entries: a full-width title, then left blocks at y 100/200 and right blocks at y 110/210) → title, left 100, left 200, right 110, right 210.
  - `::test_full_width_entry_splits_bands` (synthetic: two-column band, a full-width figure caption, another two-column band) → band 1 columns, the caption, band 2 columns.
  - `tests/unit/test_pymupdf_parser_golden.py::test_two_column_golden` and `::test_fixture_is_deterministic`; the golden asserts, among others: no block text contains U+200B; the running heads are `header`, page numbers `footer`; every `LEFT-1-*` block precedes every `RIGHT-1-*` block on page 1; `"Age 54"` appears once.
- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/unit/test_pymupdf_parser.py tests/unit/test_pymupdf_parser_golden.py -q` → FAIL (no `_reading_order`; golden missing). Create the golden with `UPDATE_GOLDEN=1` only after `_reading_order` is implemented, then read the file and check by eye that the order is column-wise before committing it.
- [ ] **Step 3: Implement** `_reading_order` and the entry shape; build the fixture and golden.
- [ ] **Step 4: Run green + gates** (as Task 4.1a, full suite). Expected: PASS; `tests/fixtures/parsing/sample_two_page.pdf` tests unchanged.
- [ ] **Step 5: Commit.** `git -C "$WT" add backend && git -C "$WT" commit -m "feat(parsing): column-aware reading order with a two-column golden fixture"`

**Done when:** two-column bands read column-wise, single-column order is byte-identical, the golden pins order + chrome + normalization, gates green.

---

### Task 4.3: Evidence records its content version; reparse re-anchors or leaves it stale (migration 0089)

**Layer:** backend · **Migration:** yes (`0089_evidence_content_version`) · **Commit:** `feat(extraction): evidence records the article version it anchored against and follows reparses`

**Goal:** a grounded AI evidence row records the `article_files.content_version` it was anchored against. A reparse re-anchors the file's grounded rows inside the same lock and transaction, or leaves them visibly stale; a row with an unknown (NULL) version reads current until a reparse or `stamp-versions` (Task 4.5c) stamps it.

**Context:** `backend/app/models/extraction.py::ExtractionEvidence` (class L564; columns `article_file_id` L590 FK SET NULL, `page_number`, `position` JSONB, `text_content`, `attribution_label`, `rank`; `__table_args__` L632-652: GIN on `position`, four btree workflow-link indexes, CHECK `workflow_target_present`, `{"schema": "public"}`). `backend/app/services/extraction_prompt_input.py::PromptInputInfo` (L28: `anchor_blocks`, `anchor_file_id`, `file_name`, `truncated`, `est_tokens`) built at the end of `build_prompt_input` from `main_file` (an `ArticleFile`, which has `content_version`). `backend/app/services/ai_extraction/_pipeline.py` exposes `anchor_blocks` / `anchor_file_id` properties (L104-109). `backend/app/services/ai_extraction/_candidates.py::_evidence` (L153-175) already stamps `article_file_id` on grounded rows only. `backend/app/services/document_parsing_service.py::parse_article_file`: after `pg_advisory_xact_lock` (L148), `replace_for_file`, `content_markdown`, then `article_file.content_version = (article_file.content_version or 0) + 1` (L154). `backend/app/services/evidence_anchor_service.py::build_anchor(quote, blocks, *, fuzz_threshold=DEFAULT_FUZZ_THRESHOLD) -> PositionV1 | None` (L700); `fuzz_threshold=1.0` is exact-only. `backend/app/schemas/extraction.py::parse_position` (L614) validates a stored position (raises `ValidationError` on a bad shape; `None` → `None`). The anchor's page is `pos.anchor.page` for `kind == "region"`, else `pos.anchor.range.page` (pattern at `_candidates.py` L161).

**Files:**
- Create: `backend/alembic/versions/0089_evidence_content_version.py`
- Modify: `backend/app/models/extraction.py` (`ExtractionEvidence.content_version` + partial index)
- Modify: `backend/app/services/extraction_prompt_input.py` (`PromptInputInfo.content_version`)
- Modify: `backend/app/services/ai_extraction/_pipeline.py` (`anchor_content_version` property)
- Modify: `backend/app/services/ai_extraction/_candidates.py` (`_evidence` stamps it on grounded rows)
- Create: `backend/app/services/evidence_reanchor.py`
- Modify: `backend/app/services/document_parsing_service.py` (take the block lock through `lock_file_blocks`; call `reanchor_file` after the version bump)
- Modify: `backend/tests/integration/test_migration_roundtrip.py` (head pin + roundtrip)
- Modify: `docs/reference/extraction-hitl-architecture.md` ("Migration head:" → `0089_evidence_content_version`; document the column and the stale rule in the evidence section; `last_reviewed:`)
- Test: `backend/tests/integration/test_ai_extraction_candidates.py`, `backend/tests/integration/test_document_parsing_service.py`

**Interfaces / schema:**
- Migration: `revision = "0089_evidence_content_version"`, `down_revision = "0088_protocol_revision"`. `op.add_column("extraction_evidence", sa.Column("content_version", sa.Integer(), nullable=True), schema="public")`; `op.create_index("idx_extraction_evidence_article_file_id", "extraction_evidence", ["article_file_id"], schema="public", postgresql_where=sa.text("article_file_id IS NOT NULL"))`. Downgrade drops the index, then the column. No data written; no grant or policy change (migration 0081 already made evidence writes backend-only).
- Model: `content_version: Mapped[int | None] = mapped_column(Integer, nullable=True)` with a comment ("the `article_files.content_version` this row's position was anchored against; NULL = unknown"), and in `__table_args__` `Index("idx_extraction_evidence_article_file_id", "article_file_id", postgresql_where=text("article_file_id IS NOT NULL"))`.
- `PromptInputInfo.content_version: int | None` = `main_file.content_version` read after the optional on-demand parse (`db.refresh(main_file)` already happens there). `Pipeline.anchor_content_version` property mirrors `anchor_file_id`.
- `_evidence`: `content_version=p.anchor_content_version if pos is not None else None`.
- `backend/app/services/evidence_reanchor.py`:
  ```python
  @dataclass(frozen=True)
  class ReanchorOutcome:
      reanchored: int
      stale: int

  async def lock_file_blocks(db: AsyncSession, file_id: UUID) -> None
  def match_anchor(text: str, blocks: Sequence[ParsedBlock]) -> PositionV1 | None
  def ai_evidence_filter() -> ColumnElement[bool]

  async def reanchor_file(
      db: AsyncSession, file_id: UUID, old_version: int, new_version: int, blocks: Sequence[ParsedBlock]
  ) -> ReanchorOutcome
  ```
  `lock_file_blocks` is the one definition of the per-file block lock: `SELECT pg_advisory_xact_lock(hashtextextended(:k, 0))` with `k = str(file_id)`, moved verbatim out of `parse_article_file` (which now calls it at the same point); Task 4.5c's apply path takes the same lock through it. `match_anchor` is the exact-then-fuzzy rule: `build_anchor(text, blocks, fuzz_threshold=1.0) or build_anchor(text, blocks)`. `ai_evidence_filter()` is the AI-evidence predicate: `proposal_record_id IS NOT NULL AND reviewer_decision_id IS NULL AND consensus_decision_id IS NULL` and an `EXISTS` on `extraction_proposal_records` with `source = 'ai'` (reviewer and consensus evidence is part of the human audit trail, constitution §IX, and never moves).
  `reanchor_file` selects the file's grounded AI rows: `ai_evidence_filter()`, `ExtractionEvidence.article_file_id == file_id`, `position` is a non-empty object (`position != {}` via `text("position <> '{}'::jsonb")` or `func.jsonb_typeof(...) == 'object'` plus `position.has_key('anchor')`), and `or_(content_version.is_(None), content_version == old_version)`; rows with any other version are untouched (already stale from an earlier reparse). For each row (skipping, uncounted, a row whose stored position fails `parse_position`): `pos = match_anchor(row.text_content, blocks)` (exact first, fuzzy only on a miss). On a match: rewrite `position` from `pos.model_dump(by_alias=True, mode="json")` **with the stored `anchor.quote` copied back in** (the quote is history), `page_number` from the new anchor, `content_version = new_version`. On no match: leave `position` and `page_number` untouched; if `content_version` was NULL set it to `old_version` (so it reads stale), otherwise leave it. Never touch `text_content`, `attribution_label`, `rank` or any workflow link. `flush()` once and return the counts. This is a service write inside the caller's transaction: it never commits.
- `parse_article_file`: capture `old_version = article_file.content_version or 0` before the bump; after the bump and inside the same lock/transaction call `await reanchor_file(self.db, article_file_id, old_version, article_file.content_version, blocks)` (blocks already carry offsets). A first parse (`old_version == 0`) finds no grounded rows and is a no-op. The service logs `evidence_reanchored` with `article_file_id`, `outcome.reanchored` and `outcome.stale` (the log is the first app reader of both fields, so vulture stays green).

- [ ] **Step 1: Write the failing tests.**
  - `test_migration_roundtrip.py`: `expected_head = "0089_evidence_content_version"`; `test_migration_0089_evidence_content_version_roundtrip`: column (`information_schema.columns`) and index (`pg_indexes WHERE indexname = 'idx_extraction_evidence_article_file_id'`, and its `indexdef` contains `WHERE (article_file_id IS NOT NULL)`) present at head, gone after downgrade to `0088_protocol_revision`, back after upgrade.
  - `test_ai_extraction_candidates.py::test_grounded_evidence_stamps_content_version`: with the recorded fake and a parsed file at `content_version = N`, a grounded quote's row has `article_file_id` and `content_version == N`; an unanchored quote's row has both NULL.
  - `test_document_parsing_service.py` (stub parser whose second parse shifts or removes text; evidence rows inserted directly through the ORM on `db_session`, linked to a run + proposal record from the seed graph the file already uses; reuse `_insert_article_file`/`_cleanup` and add an evidence helper):
    - `::test_reparse_reanchors_shifted_blocks` — a block moves from page 1 to page 2: the row's `page_number`, `position.anchor.range` and `content_version` follow; `text_content` and `position.anchor.quote` are unchanged.
    - `::test_reparse_with_removed_text_leaves_evidence_stale` — the quoted text disappears: `position`/`page_number` unchanged, `content_version` stays `old_version` (≠ the file's new version).
    - `::test_reparse_reanchors_unversioned_legacy_rows` — a grounded row with `content_version IS NULL` whose text still exists is re-anchored and stamped `new_version`.
    - `::test_failed_reanchor_of_unversioned_row_reads_stale` — a NULL-version row whose text is gone is stamped `old_version`.
    - `::test_other_files_evidence_untouched` — a row on another file and an ungrounded row (`position = {}`) are byte-identical after the reparse.
    - `::test_human_and_decision_evidence_does_not_follow_reparse` — grounded rows on a human proposal record and on a reviewer decision, on the reparsed file, with text that moved, are byte-identical after the reparse.
- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/integration/test_migration_roundtrip.py tests/integration/test_ai_extraction_candidates.py tests/integration/test_document_parsing_service.py -q` → FAIL.
- [ ] **Step 3: Implement.** Render the SQL first: `cd "$WT/backend" && uv run alembic upgrade 0088_protocol_revision:0089_evidence_content_version --sql | grep -i content_version`. Then `uv run alembic upgrade head && uv run alembic check` (no diff).
- [ ] **Step 4: Run green + gates.**
  ```bash
  cd "$WT/backend" && uv run pytest tests -q
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh \
    && bash scripts/fitness/check_migration_split.sh \
    && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/check_rls_coverage.py
  cd "$WT/backend" && uv run alembic check && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  ```
  Expected: PASS; `wc -l app/services/evidence_anchor_service.py` unchanged (764).
- [ ] **Step 5: Commit.** `git -C "$WT" add backend docs && (cd "$WT" && bash scripts/docs/check-frontmatter.sh) && git -C "$WT" commit -m "feat(extraction): evidence records the article version it anchored against and follows reparses"`

**Done when:** grounded rows carry the version, a reparse re-anchors or leaves stale per the rules, the quote never changes, roundtrip + head pin pass, `alembic check` clean, gates green.

---

### Task 4.4a: Block refs in the prompt; prompt always built from blocks; ADR 0013 Amendment

**Layer:** backend + docs · **Migration:** no · **Commit:** `feat(extraction): carry block refs in the extraction prompt and always build it from blocks`

**Goal:** the article text in every extraction prompt carries a `[p{page}·b{index}] ` ref before each block and `[p{page}·b{first}–b{last}] ` before each coalesced table, so the model can cite where a quote came from. The stored `content_markdown` and the reader stay byte-identical (refs are prompt-only, one serializer). The prompt is always assembled from blocks; the stored-markdown shortcut is deleted.

**Context:** after Task 4.3. `backend/app/infrastructure/parsing/base.py::render_blocks_to_markdown(blocks)` (L329): sorted by `(page_number, block_index)`, skips `header`/`footer`/`figure`, coalesces a same-page `table_cell` run via `_render_table`, emits `## ` for headings and `- ` for list items, joins with `"\n"`. Its callers: `backend/app/llm/assembler.py::_serialize_section` (L159: optional `## {section.title}` line, then the body) and `backend/app/services/document_parsing_service.py` (L153, `content_markdown`, unchanged). `backend/app/schemas/mcp_article_text.py::chunk_locator_prefix(page_number, block_index, char_offset)` (L24) is the one locator-prefix format (`[p4·b123] `), shared with `get_article_text`; `infrastructure` → `schemas` is a support → support import (allowed). `backend/app/services/extraction_prompt_input.py::build_prompt_input` (L44): uses `main_file.content_markdown` when it fits `settings.LLM_ASSEMBLY_BUDGET_TOKENS` (the `stored_markdown` branch, L83-86), else `assemble_for_model`. Prompts: `backend/app/llm/prompts/section_extraction.py` (`SYSTEM_PROMPT`, `_USER_TEMPLATE`, `VERSION = content_version(...)`) and `backend/app/llm/prompts/quality_assessment.py` (`_SYSTEM_TEMPLATE`, `_USER_TEMPLATE`, `VERSION`). ADR: `docs/adr/0013-dual-tier-markdown-representation.md`.

**Files:**
- Modify: `backend/app/schemas/mcp_article_text.py` (`block_range_prefix` beside `chunk_locator_prefix`)
- Modify: `backend/app/infrastructure/parsing/base.py` (`render_blocks_to_markdown(..., *, block_refs=False)`)
- Modify: `backend/app/llm/assembler.py` (`_serialize_section` passes `block_refs=True`)
- Modify: `backend/app/services/extraction_prompt_input.py` (delete the `stored_markdown` branch)
- Modify: `backend/app/llm/prompts/section_extraction.py`, `backend/app/llm/prompts/quality_assessment.py` (explain the refs)
- Modify: `docs/adr/0013-dual-tier-markdown-representation.md` (Amendment)
- Modify: recorded prompt fixtures/snapshots that pin prompt text or VERSION (find with `grep -rn "Article text:" backend/tests` and the `VERSION` pins in `backend/tests/unit/llm/test_prompts.py`)
- Test: `backend/tests/unit/test_parsing_base.py`, `backend/tests/unit/test_assembler.py`, `backend/tests/unit/test_extraction_prompt_input.py`

**Interfaces:**
- `schemas/mcp_article_text.py`: `def block_range_prefix(page_number: int, first: int, last: int) -> str` → `f"[p{page_number}·b{first}–b{last}] "` (en dash U+2013). Docstring: the table form of `chunk_locator_prefix`.
- `render_blocks_to_markdown(blocks, *, block_refs: bool = False) -> str`: with `block_refs=False` the output is byte-identical to today. With `True`: a paragraph/`figure_caption` line is `chunk_locator_prefix(page, idx, 0) + text`; a heading is `"## " + prefix + text`; a list item `"- " + prefix + text` (the ref goes after the markdown marker so the heading/list structure survives); a coalesced table run is `block_range_prefix(page, run[0].block_index, run[-1].block_index)` on its own line, followed by the unchanged GFM table. Skipped chrome/figure blocks get no ref.
- `_serialize_section`: `render_blocks_to_markdown(section.blocks, block_refs=True)`. If the section's `## {title}` line is produced from a heading block that is not also in `section.blocks` (read `_segment_into_sections` first), prefix the title with that heading block's ref the same way (`## [p1·b0] Methods`) so no cited heading loses its ref; if the heading block is in `section.blocks`, do not emit it twice. Budget accounting is unchanged code-wise: the char budget already measures the serialized text, so refs count automatically.
- `build_prompt_input`: delete `stored_md`, `est` from stored markdown, the `"stored_markdown"` source and its branch; always `text, info = assemble_for_model(blocks, model_name=model, budget_tokens=settings.LLM_ASSEMBLY_BUDGET_TOKENS)`; keep the `extraction.assembly` log (drop the `source` field or set it to `"blocks"` — the log is the only reader). Update the module docstring (the stored-markdown sentence is now false).
- Prompts: append to each system prompt one sentence: "The article text marks each block with a citation ref such as [p3·b12] (page 3, block 12) or [p3·b12–b18] for a table; refs are not part of the article's words." — do not change the evidence output instruction yet (Task 4.4b changes the output shape and the instruction together). VERSION hashes change on their own; update any test that pins a literal VERSION string or a full prompt.
- ADR 0013 "Amendment (2026-10)": the prompt projection prefixes each block with a `p{page}·b{block}` ref (the citable locator vocabulary shared with `get_article_text` and evidence); the prefixes are prompt-only; `content_markdown` and the reader are unchanged; there is still one serializer (`render_blocks_to_markdown`, a flag, not a second codepath); the stored-markdown prompt shortcut is removed, so every prompt is assembled from blocks.

- [ ] **Step 1: Write the failing tests.**
  - `test_parsing_base.py::test_block_refs_prefix_blocks_and_tables`: paragraph, heading, list item and a 2×2 table run on page 2 → `"[p2·b0] text"`, `"## [p2·b1] Title"`, `"- [p2·b2] item"`, a line `"[p2·b3–b6] "` then the GFM table; header/footer/figure blocks get no ref and are still skipped.
  - `::test_reader_markdown_unchanged`: for the same blocks (and for the Task 4.1b golden fixture's blocks), `render_blocks_to_markdown(blocks)` equals the output captured before the change (assert against a literal) — `block_refs` defaults to off.
  - `test_assembler.py::test_budget_counts_ref_prefixes`: a document whose plain markdown fits a budget but whose ref-prefixed text does not → `assemble` reports dropped sections; and every kept block line starts with its ref.
  - `test_extraction_prompt_input.py::test_prompt_always_from_blocks_with_refs`: a file with stored `content_markdown` that fits the budget still yields a prompt text containing `"[p1·b0] "` and not equal to the stored markdown. Delete `test_uses_stored_markdown_when_blocks_present` (the branch is gone) and adapt `test_falls_back_to_assembler_when_markdown_over_budget` into the new test or delete it as redundant.
- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/unit/test_parsing_base.py tests/unit/test_assembler.py tests/unit/test_extraction_prompt_input.py -q` → FAIL.
- [ ] **Step 3: Implement** per Interfaces; then run `uv run pytest tests/unit/llm tests/integration -q -k "prompt or extraction"` and update every pinned prompt/VERSION fixture the change breaks (recorded fakes match on prompt name, not text — confirm in `tests/fakes/recorded_llm.py` before editing fixtures).
- [ ] **Step 4: Run green + gates** (full suite, lint, fitness, vulture; `bash scripts/docs/check-frontmatter.sh`).
- [ ] **Step 5: Commit.** `git -C "$WT" add backend docs && git -C "$WT" commit -m "feat(extraction): carry block refs in the extraction prompt and always build it from blocks"`

**Done when:** prompts carry refs on every kept block and table, reader markdown is byte-identical, the stored-markdown branch is deleted, the ADR 0013 Amendment records it, gates green.

---

### Task 4.4b: `{block_ref, quote}` evidence, grounding validator, derived location

**Layer:** backend · **Migration:** no · **Commit:** `feat(extraction): ground AI evidence in cited blocks and derive its page from the anchor`

**Goal:** the model answers evidence as `{block_ref, quote}`; a validator sends it back (bounded) when a ref is unknown or the quote is not inside the cited window; the stored location always comes from the anchor, never from the model. An unanchored quote persists with no page and is flagged `ungroundable` whatever its status.

**Context:** after Task 4.4a. `backend/app/llm/schema.py`: `Evidence` (L26: `text`, `page_number`), `_PROPERTIES_PER_FIELD = 8` (L19), `_field_result_model` (L76), `dump_extraction` (`model_dump(by_alias=True)`). `backend/app/llm/validators.py::evidence_is_plausible` (whole file, 37 lines) is wired once at `backend/app/services/ai_extraction/_model_calls.py::extract_fields` (`validators=[evidence_is_plausible]`, ~L123). pydantic-ai output validators may take `ctx: RunContext` first; `ctx.retry` and `ctx.max_retries` are available (pydantic-ai 1.107). `backend/app/services/evidence_anchor_service.py` (764 lines): `_normalize_with_index_map` (L231) and `_normalize` (L278) do NFKC + whitespace folding; `match(quote, blocks, *, fuzz_threshold)` (L552) builds per-page strings from the blocks it is given (`concat_page_text`), so filtering blocks to one page keeps that page's offsets; `build_anchor(quote, blocks, *, fuzz_threshold)` (L700) sets `anchor.quote = quote`. `backend/app/services/ai_extraction/_candidates.py`: `build_candidates` (L28), `_quotes` (L140-147: `{"text", "page_number"}`), `_evidence` (L150-175: model page when unanchored; `ungroundable` only for `found`, L84-88), the entailment `GateSpec(quote=quote["text"], pos=..., anchor_blocks=...)`. `backend/app/infrastructure/parsing/base.py::concat_page_text(blocks) -> dict[int, str]` (L139). Recorded fake: `backend/tests/fakes/recorded_llm.py` ignores `validators` (pydantic-ai only) and validates scripted replies into the output model, so scripts that cite evidence must use the new keys.

**Files:**
- Create: `backend/app/domain/evidence_block_refs.py`
- Modify: `backend/app/services/evidence_anchor_service.py` (`build_anchor(..., hint=)`; import the moved normalizers)
- Modify: `backend/app/llm/schema.py` (`Evidence {block_ref, quote}`), `backend/app/llm/validators.py` (replace the validator)
- Modify: `backend/app/llm/prompts/section_extraction.py`, `backend/app/llm/prompts/quality_assessment.py` (evidence instruction)
- Modify: `backend/app/services/ai_extraction/_pipeline.py` (`block_ref_index`), `_model_calls.py` (wire the validator, carry retry count), `_candidates.py` (`_quotes`, `_evidence`, ungroundable rule, log), `_sections.py` (pass the retry count)
- Modify: tests/fixtures that script evidence (`grep -rln '"page_number"' backend/tests`; `test_ai_extraction_candidates.py`, `test_extraction_generation_attempts.py`, `tests/unit/llm/test_schema.py`, `tests/unit/llm/test_review_question_prompt.py`)
- Test: `backend/tests/unit/llm/test_validators.py`, `backend/tests/unit/test_llm_schema.py`, `backend/tests/unit/test_evidence_anchor_blockids.py`, new `backend/tests/unit/test_evidence_block_refs.py`, `backend/tests/integration/test_ai_extraction_candidates.py`

**Interfaces:**
- `app/domain/evidence_block_refs.py` (support module; imports `app.infrastructure.parsing.base` and stdlib only, never a service; module docstring says so):
  ```python
  @dataclass(frozen=True)
  class BlockRef:            # parsed "p3·b12" or "p3·b12–b18"
      page: int
      first: int
      last: int               # == first for a single block
  @dataclass(frozen=True)
  class BlockRefWindow:
      page: int
      block_indexes: tuple[int, ...]
      text: str               # the window blocks' text joined with "\n"
  class BlockRefIndex:
      def __init__(self, blocks: Sequence[BlockLike]) -> None   # page -> {block_index: block}
  def parse_block_ref(raw: str) -> BlockRef | None
  def ref_window(index: BlockRefIndex, ref: BlockRef) -> BlockRefWindow | None
  def normalize_with_index_map(original: str) -> tuple[str, list[int]]   # moved from evidence_anchor_service
  def normalize_text(text: str) -> str                                   # moved (was _normalize)
  def quote_in_window(quote: str, window: BlockRefWindow) -> bool        # normalized containment
  ```
  `parse_block_ref` accepts optional surrounding `[` `]` and whitespace, `·` or `.` as separator, `–` or `-` in a range, case-insensitive `p`/`b`; `p0`, `first > last` or garbage → `None`. `ref_window`: a single-block ref → the blocks `first-1 … first+1` that exist on that page; a range ref (a table) → every block `first … last` on that page; `None` when the page or `first` is unknown. `quote_in_window` = `normalize_text(quote) in normalize_text(window.text)` with a non-empty quote. Move the two normalizers verbatim (behavior identical) and have `evidence_anchor_service` import them — this also takes lines off the 764-line anchor service. `evidence_is_stale` joins this module in Task 4.5a-1 (its first app caller).
- `build_anchor(quote, blocks, *, hint: BlockRefWindow | None = None, fuzz_threshold=DEFAULT_FUZZ_THRESHOLD)`: when `hint` is set, first `m = match(quote, [b for b in blocks if b.page_number == hint.page], fuzz_threshold=...)` and accept it only if `set(m.block_ids) & set(hint.block_indexes)`; otherwise (or with no hint) match the whole document as today. The anchor-building tail is shared (no duplicate code).
- `schema.py`: `Evidence` = `block_ref: str = Field(description="The citation ref of the block the quote comes from, exactly as shown before it in the article text, e.g. p3·b12 (or p3·b12–b18 for a table).")` and `quote: str = Field(description="Short verbatim quote from that block supporting the value.")`; `page_number` removed. `_PROPERTIES_PER_FIELD` stays 8 (comment: value, confidence, reasoning, evidence{block_ref, quote}, status). Module docstring updated.
- `validators.py`: delete `evidence_is_plausible`; add
  ```python
  @dataclass
  class GroundingStats:
      retried: int = 0
  def evidence_grounding_validator(index: BlockRefIndex, stats: GroundingStats | None = None) -> Callable[[RunContext[Any], Any], Any]
  ```
  The returned validator walks each field result's `evidence` like the old one (label = `field_info.alias or field_name`) and raises `ModelRetry` — with a message naming the field, the entry index and the problem — on an empty quote, an unparseable ref, a ref `ref_window` cannot resolve, or a quote not `quote_in_window`; it raises only while `ctx.retry < ctx.max_retries` (bump `stats.retried` when it raises); on the last attempt it returns the output unchanged so the write path decides grounding.
- `Pipeline.block_ref_index` — built once in `assemble_prompt_text` right after `self.prompt_input = info` (`BlockRefIndex(info.anchor_blocks)`), an empty index before.
- `_model_calls.extract_fields`: one `GroundingStats()` per section call; `validators=[evidence_grounding_validator(p.block_ref_index, stats)]`; `FieldCall` gains `grounding_retries: int = 0`.
- `_candidates.py`:
  - `_quotes` returns `[{"quote": str(e["quote"]).strip(), "block_ref": e.get("block_ref")}]` for entries with a non-blank quote (not-found answers still cite none).
  - `_evidence(p, run, quote, rank)`: `ref = parse_block_ref(quote["block_ref"] or "")`; `window = ref_window(p.block_ref_index, ref) if ref else None`; `pos = build_anchor(quote["quote"], p.anchor_blocks, hint=window) if p.anchor_blocks else None`. **Grounded:** `page_number` from the anchor (as today), `text_content` = the source slice `concat_page_text(p.anchor_blocks)[page][range.char_start:range.char_end]` (compute `concat_page_text` once per `build_candidates`, not per quote), `position` from the anchor (whose `anchor.quote` is the model's words), `article_file_id`/`content_version` as in Task 4.3. **Ungrounded:** `page_number=None`, `position={}`, `text_content` = the model's quote, `attribution_label="ungroundable"` — set inside `_evidence` for every status (delete the found-only branch in `build_candidates`).
  - The entailment `GateSpec.quote` is the source slice (`row.text_content`), not the model's words.
  - `build_candidates(..., grounding_retries: int = 0)` logs `evidence_grounding` once per call with `grounded`, `ungrounded`, `retried=grounding_retries` and `entity_type_id`; `_sections._verify_and_land` passes `call.grounding_retries`.
- Prompts: replace each `"evidence": an object with "text" ... "page_number" ...` user-template line with `"evidence": a list of up to 3 objects {"block_ref": the ref shown before the quoted block, e.g. "p3·b12", "quote": a short verbatim passage from that block}; [] when status is not_found`; in each system prompt replace `evidence=null` with `evidence=[]`. VERSION hashes bump on their own.

- [ ] **Step 1: Write the failing tests.**
  - New `tests/unit/test_evidence_block_refs.py`: `parse_block_ref` accepts `p3·b12`, `[p3·b12]`, `p3.b12`, `p3·b12–b18`, `p3.b12-b18`, rejects `p0·b1`, `p3·b9–b2`, `page 3`; `ref_window` returns ±1 neighbours on the page (clipped at page edges) and the whole run for a range; unknown page → `None`; `quote_in_window` tolerates whitespace/NFKC differences.
  - `tests/unit/llm/test_validators.py` (rewrite; four cases): a good ref + in-window quote passes; an unknown ref raises `ModelRetry` while `ctx.retry < ctx.max_retries`; a quote outside the window raises; on the last attempt (`ctx.retry == ctx.max_retries`) the same bad output passes through unchanged. Use a minimal `ctx` stand-in exposing `retry`/`max_retries` (`SimpleNamespace`) if building a real `RunContext` is heavy.
  - `tests/unit/test_llm_schema.py`: the evidence item schema has exactly `block_ref` and `quote` (no `page_number`); the per-field property count used for chunking is still 8.
  - `tests/unit/test_evidence_anchor_blockids.py::test_hint_window_beats_earlier_page`: the same sentence on page 1 and page 3; with `hint` = page 3's window the anchor is on page 3; without a hint, page 1 (unchanged tie-break).
  - `tests/integration/test_ai_extraction_candidates.py` (recorded fake; scripts use `{"block_ref", "quote"}`):
    - `::test_unanchored_quote_never_persists_a_page` — a quote absent from the article with `block_ref` `p2·b0` → `page_number IS NULL`, `position == {}`, `attribution_label == "ungroundable"`, `text_content` = the model quote.
    - `::test_grounded_quote_stores_source_slice_and_derived_page` — a quote that differs from the source only in whitespace/case, cited with a wrong-page ref → `page_number` = the anchor's page, `text_content` = the exact source slice, `position.anchor.quote` = the model's words.
    - `::test_ungroundable_flag_for_ambiguous_quote` — an `ambiguous` answer with an unanchorable quote is flagged `ungroundable`.
    - `::test_evidence_grounding_log_carries_retries` — `build_candidates(..., grounding_retries=2)` emits one `evidence_grounding` entry (`structlog.testing.capture_logs()`) with `retried == 2` and the grounded/ungrounded counts.
  - `tests/unit/llm/test_grounding_validator_agent.py` (the recorded fake ignores validators, so this drives a real pydantic-ai agent): `extract_structured` with a `FunctionModel` that answers an unknown `block_ref` first and a valid one second, and `validators=[evidence_grounding_validator(index, stats)]` → the result carries the valid ref and `stats.retried == 1`.
- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/unit/test_evidence_block_refs.py tests/unit/llm/test_validators.py tests/unit/llm/test_grounding_validator_agent.py tests/unit/test_llm_schema.py tests/unit/test_evidence_anchor_blockids.py tests/integration/test_ai_extraction_candidates.py -q` → FAIL.
- [ ] **Step 3: Implement** per Interfaces; migrate every scripted evidence fixture to `{block_ref, quote}`.
- [ ] **Step 4: Run green + gates** (full suite, lint, fitness incl. `check_layered_arch.py` — `app.domain.evidence_block_refs` imports no service — and `check_file_size.py`, vulture: the deleted `evidence_is_plausible` leaves the baseline only if it was listed).
- [ ] **Step 5: Commit.** `git -C "$WT" add backend && git -C "$WT" commit -m "feat(extraction): ground AI evidence in cited blocks and derive its page from the anchor"`

**Done when:** evidence is `{block_ref, quote}`, the validator retries within bounds, grounded rows store the source slice and the anchor's page, ungrounded rows store no page and are `ungroundable`, the hint window wins, gates green.

---

### Task 4.5a-1: REST `grounded` / `stale` on evidence + regenerated types

**Layer:** backend + types · **Migration:** no · **Commit:** `feat(extraction): report grounded and stale on AI suggestion evidence`

**Goal:** every evidence item the suggestion reads return carries `grounded` (its position parses to an anchor) and `stale` (grounded, its version is known and differs from the file's current version), computed with one `article_files` version read per load.

**Context:** after Task 4.4b. `backend/app/schemas/extraction_suggestion.py::EvidenceResponse` (L10: `proposal_record_id`, `text_content`, `page_number`, `block_ids` alias `blockIds`, `rank`, `attribution_label` alias `attributionLabel`). `backend/app/services/extraction_suggestion_read_service.py`: `_extract_block_ids(ev)` (L50, parses with `parse_position`, swallowing `ValidationError`/`ValueError`), `load_suggestions` (L86; evidence loaded L164-181, mapped L217-228) and `get_suggestion_history` (L252; evidence L301-318, mapped L322-333). `ExtractionEvidence.article_file_id` / `.content_version` (Task 4.3); `ArticleFile.content_version` (`backend/app/models/article.py`).

**Files:**
- Modify: `backend/app/domain/evidence_block_refs.py` (`evidence_is_stale`)
- Modify: `backend/app/schemas/extraction_suggestion.py` (`grounded`, `stale`)
- Modify: `backend/app/services/extraction_suggestion_read_service.py`
- Modify: `backend/app/services/evidence_reanchor.py` (`file_versions`)
- Regenerate: `frontend/types/api/schema.d.ts`, `frontend/types/api/openapi.json`
- Test: `backend/tests/integration/test_suggestion_read.py`, `backend/tests/unit/test_evidence_block_refs.py`

**Interfaces:**
- `def evidence_is_stale(*, grounded: bool, evidence_version: int | None, file_version: int | None) -> bool` → `grounded and evidence_version is not None and file_version is not None and evidence_version != file_version`. Docstring states the rule (a NULL version is unknown and reads current until a reparse or `stamp-versions` stamps it). This is the single predicate; Task 4.5b's MCP read uses it too.
- `EvidenceResponse`: `grounded: bool = False` and `stale: bool = False`, each with a `Field(description=...)` ("the position resolves to a parsed-text anchor" / "grounded, and the article was re-parsed since this anchor was made: the location may have moved").
- Read service: replace `_extract_block_ids` with `_anchor_of(ev) -> PositionV1 | None` (same tolerant parse; `{}`/`None`/invalid → `None`) so `block_ids` and `grounded` come from one parse; add the one public version read, `async def file_versions(db, file_ids: Iterable[UUID]) -> dict[UUID, int]`, to `backend/app/services/evidence_reanchor.py` (beside the other content-version rules; Task 4.5b reuses it) — one `select(ArticleFile.id, ArticleFile.content_version).where(ArticleFile.id.in_(ids))`, skipped when the set is empty — called with `{ev.article_file_id for ev in rows if ev.article_file_id}` once in each of `load_suggestions` and `get_suggestion_history`; one shared `_evidence_response(p_id, ev, versions) -> EvidenceResponse` builds every item (removes the duplicated mapping in the two functions). No ownership change: the rows were already scoped by the caller's article/run; the version read is keyed only by those rows' file ids.

- [ ] **Step 1: Write the failing tests.**
  - `tests/unit/test_evidence_block_refs.py::test_evidence_is_stale_truth_table`: ungrounded → False; grounded + NULL evidence version → False; grounded + equal → False; grounded + different → True.
  - `tests/integration/test_suggestion_read.py::test_evidence_grounded_and_stale_flags`: three evidence rows on one proposal — grounded at the file's current version, grounded at an older version, ungrounded (`position = {}`) → `(grounded, stale)` = `(True, False)`, `(True, True)`, `(False, False)`; the same through `get_suggestion_history`.
  - `::test_null_version_is_not_stale`: a grounded row with `content_version = NULL` after a file version bump → `grounded=True, stale=False`.
  - Count queries in one of them (an `after_cursor_execute` listener on the test engine, or assert via `sqlalchemy` echo capture, whichever the file already uses): adding evidence rows on several files adds exactly one `article_files` select per load.
- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/integration/test_suggestion_read.py tests/unit/test_evidence_block_refs.py -q` → FAIL.
- [ ] **Step 3: Implement**, then `cd "$WT" && npm run generate:api-types && npm run typecheck`.
- [ ] **Step 4: Run green + gates** (backend set + `npm run typecheck`, `npm run lint`, `npx knip`, `npx knip --production`; the api-contract diff is committed).
- [ ] **Step 5: Commit.** `git -C "$WT" add backend frontend/types/api && git -C "$WT" commit -m "feat(extraction): report grounded and stale on AI suggestion evidence"`

**Done when:** both reads return `grounded`/`stale` per the single predicate with one version read per load, types regenerated, gates green.

---

### Task 4.5a-2: Review UI: grounded, stale and ungrounded evidence states

**Layer:** frontend · **Migration:** no · **Commit:** `feat(extraction): show stale and ungrounded evidence states in the review UI`

**Goal:** an evidence row shows three states. **Grounded, current:** "Page N" chip, attribution badge, Locate with page and block hints. **Grounded, stale:** muted chip, "Location may have moved" (tooltip: the article was re-parsed), Locate by text only. **Ungrounded:** no chip, "Verify manually", no Locate. Loading, empty, error, not-found and unauthorized states are unchanged.

**Context:** after Task 4.5a-1 (the generated `EvidenceResponse` has `grounded`/`stale`). `frontend/types/ai-extraction.ts::EvidenceCitation` (L26: `text`, `pageNumber`, `blockIds`, `attributionLabel`, `rank`). `frontend/services/aiSuggestionService.ts::mapEvidenceList` (L36-48). `frontend/components/extraction/ai/AISuggestionEvidence.tsx`: `CitationRow` (L78; `isUngroundable = label === 'ungroundable'` L83; page chip L107-109 from `pageNumber`; locate controls L142, L164-185), `ATTRIBUTION` map incl. `ungroundable: {copy: 'attributionUngroundable', ...}` (L44). Locate call sites: `frontend/components/extraction/ai/AISuggestionReviewPopover.tsx` L91 `locate(citation.text, citation.pageNumber ?? null, citation.blockIds ?? [])` and `frontend/components/extraction/review/ProposalCard.tsx` L48. Copy: `frontend/lib/copy/extraction.ts` (`attributionUngroundable: 'Verify manually'` L686). Existing tests: `AISuggestionEvidence.test.tsx`, `AISuggestionEvidence.copy.test.tsx`, `__tests__/AISuggestionEvidence.ungroundable.test.tsx`, `AISuggestionReviewPopover.test.tsx`, `frontend/test/components/ProposalCard.test.tsx`.

**Files:**
- Modify: `frontend/types/ai-extraction.ts` (`grounded`, `stale` on `EvidenceCitation`)
- Modify: `frontend/services/aiSuggestionService.ts` (map them)
- Modify: `frontend/components/extraction/ai/AISuggestionEvidence.tsx`, `AISuggestionReviewPopover.tsx`, `frontend/components/extraction/review/ProposalCard.tsx`
- Modify: `frontend/lib/copy/extraction.ts` (`evidenceStale`, `evidenceStaleTooltip`)
- Test: `frontend/components/extraction/ai/AISuggestionEvidence.test.tsx`, `AISuggestionReviewPopover.test.tsx`, `frontend/test/components/ProposalCard.test.tsx`, the service test beside `aiSuggestionService.ts` if one exists (else assert the mapping through the popover test)

**Interfaces:**
- `EvidenceCitation`: `grounded: boolean; stale: boolean;` (required; the mapper defaults a missing server value to `false`).
- One pure helper in `AISuggestionEvidence.tsx` (exported only if a second file uses it — knip): `function citationState(c: EvidenceCitation): 'current' | 'stale' | 'ungrounded'` → `!c.grounded ? 'ungrounded' : c.stale ? 'stale' : 'current'`.
- `CitationRow`: `current` keeps today's rendering; `stale` renders the page chip with muted styling (`text-muted-foreground`, no accent), plus a `Tooltip` text `t('extraction','evidenceStale')` with tooltip `t('extraction','evidenceStaleTooltip')`; `ungrounded` renders no page chip and the `attributionUngroundable` badge (reused), and no Locate control (neither the icon button nor the clickable passage — render the passage as plain text). Keyboard focus and `aria-pressed` behavior of the remaining controls is unchanged.
- Locate call sites: `stale` → `locate(citation.text, null, [])` (text-only search); `current` → unchanged; `ungrounded` → never called (the row hides Locate; the call site also guards so a stray call is a no-op).
- Copy: `evidenceStale: 'Location may have moved'`, `evidenceStaleTooltip: 'The article was re-parsed after this evidence was anchored; the passage is searched by its text.'`.

- [ ] **Step 1: Write the failing tests.**
  - `AISuggestionEvidence.test.tsx`: three states — current shows "Page 4" and a Locate control; stale shows a muted "Page 4", the text "Location may have moved" and still a Locate control; ungrounded shows no page chip, "Verify manually" and no Locate control (`queryByRole('button', {name: /locate/i})` is null).
  - `AISuggestionReviewPopover.test.tsx`: clicking Locate on a stale citation calls `locate` with `(text, null, [])`; on a current one with `(text, page, blockIds)`.
  - `ProposalCard.test.tsx`: the same text-only Locate for a stale citation.
  - `frontend/test/services/aiSuggestionService.test.ts`: an evidence payload without `grounded`/`stale` maps both to `false`.
- [ ] **Step 2: Run red.** `cd "$WT" && npx vitest run frontend/components/extraction/ai frontend/test/components/ProposalCard.test.tsx frontend/test/services/aiSuggestionService.test.ts` → FAIL.
- [ ] **Step 3: Implement**; update fixtures in the existing evidence tests to carry `grounded`/`stale`.
- [ ] **Step 4: Run green + gates.** `cd "$WT" && npm run test:run && npm run lint && npm run typecheck && npx knip && npx knip --production && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/check_copy_keys.py`.
- [ ] **Step 5: Commit.** `git -C "$WT" add frontend && git -C "$WT" commit -m "feat(extraction): show stale and ungrounded evidence states in the review UI"`

**Done when:** the three states render as specified in the evidence list, popover and proposal card, stale locates by text only, ungrounded has no Locate, gates green.

---

### Task 4.5b: Anchor-based MCP locator, `grounded` / `stale`, docs

**Layer:** backend + docs · **Migration:** no · **Commit:** `feat(mcp): anchor-based evidence locators with grounded and stale flags in get_extractions`

**Goal:** `get_extractions` evidence becomes `{quote, quote_truncated, locator|null, grounded, stale}`. The locator is `p{page}·b{first_block}` built from the parsed anchor only, never from a bare `page_number`; ungrounded evidence has `locator: null, grounded: false`.

**Context:** after Task 4.4b (and 4.5a-1 for `evidence_is_stale`). `backend/app/schemas/mcp_extractions.py::McpEvidence` (L28: `quote`, `quote_truncated: bool` (required), `locator: str | None`); `McpDetailedRow.evidence: list[McpEvidence]` (L71). `backend/app/services/extraction_agent_read_service.py` (798 lines, 800 cap): constants `_EVIDENCE_QUOTE_CAP = 300`, `_EVIDENCE_PER_ROW_CAP = 3` (L84-85); `_evidence_for(resolved, *, evidence_by_proposal, evidence_by_decision)` (L355-380, locator `f"p{ev.page_number}"`); the detailed-format evidence batch inside `list_agent_extractions` (L577-618: visible proposal/decision ids, the M1 visibility rule, one `select(ExtractionEvidence)` filtered by `project_id`, run ids and `or_(*conditions)`, ordered by `rank`); the call site at L727. Tool: `backend/app/api/mcp/tools/extractions.py::get_extractions` (static `description`). `_TRUSTED_PATHS["get_extractions"]` (`backend/tests/integration/mcp/test_mcp_result_shape.py` L92-102) already lists `articles[].rows[].evidence[].locator`; booleans add no path. Docs: `docs/how-to/connect-an-ai-agent.md` (the archived MCP spec is never edited).

**Files:**
- Create: `backend/app/services/extraction_agent_evidence.py`
- Modify: `backend/app/services/extraction_agent_read_service.py` (delete `_evidence_for`, the two evidence constants and the inline batch; import from the new module)
- Modify: `backend/app/schemas/mcp_extractions.py` (`McpEvidence`)
- Modify: `backend/app/api/mcp/tools/extractions.py` (description)
- Modify: `docs/how-to/connect-an-ai-agent.md` (evidence shape; `last_reviewed:`)
- Test: `backend/tests/integration/mcp/test_mcp_get_extractions.py`

**Interfaces:**
- `McpEvidence`: `quote: str`, `quote_truncated: bool`, `locator: str | None`, `grounded: bool`, `stale: bool`. Class docstring: "`locator` is `p{page}·b{block}` from the parsed anchor, or null when the quote could not be grounded; `stale`: the article was re-parsed after anchoring, so the location may have moved."
- `services/extraction_agent_evidence.py` (≤ 800 lines; module docstring: evidence and, from Task 4.7b, provenance for the agent read, batched once per page):
  ```python
  EVIDENCE_QUOTE_CAP = 300
  EVIDENCE_PER_ROW_CAP = 3
  @dataclass
  class EvidenceBatch:
      by_proposal: dict[UUID, list[ExtractionEvidence]]
      by_decision: dict[UUID, list[ExtractionEvidence]]
      file_versions: dict[UUID, int]
  async def load_evidence_batch(db, *, project_id: UUID, details: Mapping[UUID, Any]) -> EvidenceBatch
  def evidence_for(resolved: Any, batch: EvidenceBatch) -> list[McpEvidence]
  ```
  `load_evidence_batch` is the moved L577-618 block verbatim (same predicates, same M1 comment, same project predicate in the WHERE clause) plus one `evidence_reanchor.file_versions(db, {loaded rows' article_file_id})` call (Task 4.5a-1's helper; no second version select). `evidence_for` is the moved `_evidence_for` with: `anchor = parse_position(ev.position)` tolerant of `{}`/invalid (→ `None`); `grounded = anchor is not None`; `locator = f"p{page}·b{min(anchor.anchor.block_ids)}"` when grounded and `block_ids` is non-empty (page from `anchor.anchor.page` for `region`, else `anchor.anchor.range.page`), else `None` (a grounded anchor without block ids — legacy — yields `locator=None` but `grounded=True`); `stale = evidence_is_stale(grounded=..., evidence_version=ev.content_version, file_version=batch.file_versions.get(ev.article_file_id))`. `page_number` is never read. The `resolved` parameter is typed by the read service's `_Resolved`; to avoid a cycle, type it structurally (`decision_id`, `proposal_id`) with a small `Protocol` in the new module.
- `list_agent_extractions`: `batch = await load_evidence_batch(db, project_id=project_id, details=details) if response_format == "detailed" and details else EvidenceBatch({}, {}, {})`; row build calls `evidence_for(resolved, batch)`. Net effect: the read service shrinks well under 800.
- Tool description: replace any "page locator" wording with "evidence carries a `p{page}·b{block}` locator from the parsed text (null when ungrounded) and `grounded`/`stale` flags". `test_no_tool_listing_cites_internal_spec_sections` stays green.

- [ ] **Step 1: Write the failing tests** (`tests/integration/mcp/test_mcp_get_extractions.py`; seed evidence rows directly on `db_session` for an AI proposal the reviewer token can see, following `test_detailed_evidence_quote_flags_its_cut`):
  - `::test_evidence_locator_is_block_anchored` — a grounded row (valid `PositionV1`, `block_ids=[7, 8]`, page 3) → `locator == "p3·b7"`, `grounded is True`; an ungrounded row (`position={}`, `page_number=5`) → `locator is None`, `grounded is False`; every locator matches `^p\d+·b\d+$`.
  - `::test_legacy_llm_page_never_becomes_locator` — a legacy AI row with a page and an empty position never yields `"p5"`.
  - `::test_stale_after_reparse` — a grounded row at the file's version reads `stale=False`; after bumping `article_files.content_version` it reads `stale=True`; a NULL-version grounded row reads `stale=False`.
  - Re-run `test_response_size_cap_get_extractions` and `test_mcp_result_shape.py` unchanged (no new string path).
- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/integration/mcp/test_mcp_get_extractions.py -q` → FAIL.
- [ ] **Step 3: Implement** per Interfaces; `wc -l app/services/extraction_agent_read_service.py app/services/extraction_agent_evidence.py` (both ≤ 800).
- [ ] **Step 4: Run green + gates** (full suite incl. `tests/integration/mcp`, lint, fitness, vulture; `bash scripts/docs/check-frontmatter.sh`).
- [ ] **Step 5: Commit.** `git -C "$WT" add backend docs && git -C "$WT" commit -m "feat(mcp): anchor-based evidence locators with grounded and stale flags in get_extractions"`

**Done when:** MCP evidence has the five-key shape, locators come only from anchors, stale follows the shared predicate, the read service is under the cap with the evidence code in its own module, docs updated, gates green.

---

### Task 4.5c: `evidence_repair` operator command (dry run by default)

**Layer:** backend · **Migration:** no · **Commit:** `feat(extraction): evidence_repair operator command for legacy pages, versions and reparse`

**Goal:** an operator command, dry run by default with a per-project report, repairs legacy AI evidence: (1) `llm-pages` clears model-supplied pages on unanchored rows and flags them `ungroundable`; (2) `stamp-versions` gives grounded rows with an unknown version a version (current when the stored range still slices to the quote, re-anchored when it can be, otherwise one that reads stale); (3) `reparse` enqueues a reparse of each main PDF of a project as a named manager. `--apply` is never run in this build (post-merge maintainer step).

**Context:** after Task 4.4b. Precedent for a read-only operator module: `backend/app/services/value_envelope_audit.py` (`_report()` opens `AsyncSessionLocal`, `SET TRANSACTION READ ONLY`, prints, `if __name__ == "__main__":  # pragma: no cover - operator entry point`). `extraction_evidence` is not trigger-protected (only revoked from `authenticated`, migration 0081), so the backend may update it. AI evidence = `proposal_record_id IS NOT NULL AND reviewer_decision_id IS NULL AND consensus_decision_id IS NULL` joined to `extraction_proposal_records.source = 'ai'`. `backend/app/services/evidence_reanchor.py` (Task 4.3) holds `match_anchor` (exact-then-fuzzy), `ai_evidence_filter()` and `lock_file_blocks` (the per-file `pg_advisory_xact_lock(hashtextextended(:k,0))` key that `parse_article_file` holds while it replaces blocks, bumps `content_version` and re-anchors). Blocks: `backend/app/repositories/article_text_block_repository.py::list_ordered_for_file`; offsets via `infrastructure/parsing/base.concat_page_text`. Reparse: `backend/app/services/article_file_service.py::ArticleFileService.reparse(*, article_file_id, project_id, user_id: str, trace_id)` (L85; raises `ParseEnqueueError` when the enqueue fails). Main PDF: `ArticleFile.file_role == "MAIN"`. Manager check from a service: `backend/app/services/llm_engine_service.py::viewer_is_manager(db, project_id, viewer_id)` (services may not import `app.api.deps`).

**Files:**
- Create: `backend/app/services/evidence_repair.py`
- Test: new `backend/tests/integration/test_evidence_repair.py`, new `backend/tests/unit/test_evidence_repair_classify.py`

**Interfaces:**
- `evidence_repair.py` (module docstring: purpose, dry-run default, "`--apply` and `reparse` need the maintainer's go"):
  ```python
  class RepairAction(StrEnum):
      CLEAR_LLM_PAGE = "clear_llm_page"
      STAMP_CURRENT = "stamp_current"
      REANCHOR = "reanchor"
      STAMP_STALE = "stamp_stale"
      NONE = "none"
  def classify_llm_page(*, position: dict | None, page_number: int | None) -> RepairAction      # pure
  def classify_version(*, slice_matches: bool, reanchorable: bool) -> RepairAction              # pure
  @dataclass
  class RepairReport:
      command: str
      applied: bool
      per_project: dict[UUID, Counter[RepairAction]]
      row_ids: dict[RepairAction, list[UUID]]
  async def llm_pages(db, *, apply: bool) -> RepairReport
  async def stamp_versions(db, *, apply: bool) -> RepairReport
  async def reparse_project(db, *, project_id: UUID, as_user: UUID, apply: bool, trace_id: str) -> RepairReport
  def format_report(report: RepairReport) -> str
  def main(argv: list[str] | None = None) -> int     # argparse: <cmd> [--apply] [--project ID --as-user ID]
  ```
  - `llm_pages`: AI evidence with `position` NULL or `{}` and `page_number IS NOT NULL` → `CLEAR_LLM_PAGE`; apply sets `page_number = NULL`, `attribution_label = 'ungroundable'`.
  - `stamp_versions`: AI evidence (`ai_evidence_filter()`) that is grounded (`parse_position` succeeds) with `content_version IS NULL` and an `article_file_id`, grouped by file. Per file, `_classify_file(db, file_id)` loads the file's blocks and `article_files.content_version` (a fresh `select`, never an identity-map hit) and the file's candidate rows, and classifies each: `slice_matches` = `normalize_text(concat_page_text(blocks)[page][char_start:char_end]) == normalize_text(text_content)` (normalizer from `app.domain.evidence_block_refs`); `reanchorable` = `match_anchor(text_content, blocks) is not None`; `classify_version(...)` → `STAMP_CURRENT` / `REANCHOR` / `STAMP_STALE`. A file with no blocks reports its rows under `NONE`. Dry run: the whole pass runs inside `SET TRANSACTION READ ONLY` (as the precedent does) and rolls back; nothing is written and no lock is taken.
  - **Apply is serialized against reparses.** Per file, in its own transaction: `await lock_file_blocks(db, file_id)` **first**, then `_classify_file` runs again **under the lock** (re-reads `content_version`, the blocks and the candidate rows, so a reparse that committed after the dry run or after an earlier file is seen), each candidate row is re-checked `content_version IS NULL` in the `UPDATE ... WHERE id = :id AND content_version IS NULL` (a row a reparse stamped meanwhile matches nothing and is reported under `NONE`), then writes: `STAMP_CURRENT` → `content_version = file.content_version`; `REANCHOR` → `position` from `match_anchor` with the stored `anchor.quote` copied back, `page_number` from the new anchor, `content_version = file.content_version`; `STAMP_STALE` → `content_version = file.content_version - 1` (no CHECK constrains either column, so `0` or `-1` is valid and reads stale). Commit per file (releases the lock, so a waiting reparse runs next and re-anchors from the stamped version). The report's `row_ids` are the rows actually updated.
  - `reparse_project`: refuses (`ValueError`) unless `viewer_is_manager(db, project_id, as_user)`; lists the project's `MAIN` files with one project-scoped query — `select(ArticleFile.id).join(Article, Article.id == ArticleFile.article_id).where(Article.project_id == project_id, ArticleFile.file_role == "MAIN")` (the ownership predicate in the WHERE clause; `ArticleFileService.reparse` trusts the ids it is given) (dry run: report only); apply calls `ArticleFileService(db).reparse(article_file_id=..., project_id=project_id, user_id=str(as_user), trace_id=trace_id)` per file and commits once after enqueueing (a `ParseEnqueueError` is reported per file and does not stop the loop).
  - `llm_pages` and `reparse_project` apply paths commit once at the end; `stamp_versions` commits per file (above); human and decision evidence is never selected. `main()` opens `AsyncSessionLocal`, runs the command, prints `format_report`, returns 0; the `__main__` guard is `# pragma: no cover - operator entry point`. Invocation: `cd backend && uv run python -m app.services.evidence_repair llm-pages|stamp-versions|reparse --project <id> --as-user <profile_id> [--apply]`.

- [ ] **Step 1: Write the failing tests.**
  - `tests/unit/test_evidence_repair_classify.py`: `classify_llm_page` truth table (empty position + page → clear; anchored → none; empty position + no page → none); `classify_version` (slice match → stamp_current; no match but reanchorable → reanchor; neither → stamp_stale).
  - `tests/integration/test_evidence_repair.py` (rows inserted on `db_session` with a seeded run, an AI proposal record, a human proposal record and a reviewer decision; blocks inserted for one file):
    - `test_dry_run_writes_nothing` — each command's dry run reports the expected counts per project and every row is byte-identical afterwards.
    - `test_apply_touches_exactly_the_reported_rows` — after `apply=True`, the changed row ids equal the dry run's `row_ids`; `llm-pages` rows read `page_number NULL`, `ungroundable`; `stamp-versions` rows carry the expected versions (current / re-anchored / `file - 1`), and `text_content` and `position.anchor.quote` never change.
    - `test_human_and_decision_evidence_untouched` — evidence on the human proposal and on the reviewer decision, shaped exactly like repairable AI rows, is neither reported nor changed.
    - `test_stamp_apply_rereads_after_a_reparse_between_classify_and_apply` — dry run `stamp_versions` (rows A and B NULL-version, both `STAMP_CURRENT`); then `DocumentParsingService.parse_article_file` with a stub parser that shifts A's text to another page (the 4.3 test helpers), which re-anchors and stamps A and B at the new version; then `stamp_versions(apply=True)`: A and B keep the reparse's `position`, `page_number` and `content_version` (never the dry run's old version), the apply report lists them under `NONE`, and a row C inserted NULL-version after the reparse is classified against the **new** blocks and version.
    - `test_stamp_apply_takes_the_parse_lock_before_reading` — a `before_cursor_execute` listener on the session's connection records statements during `stamp_versions(apply=True)`: for the file, `pg_advisory_xact_lock(hashtextextended(` with parameter `str(file_id)` precedes the `article_files` version read and every `extraction_evidence` UPDATE.
    - `test_reparse_requires_a_manager_and_lists_main_files` — a reviewer `as_user` raises; a non-member `as_user` raises; a manager dry run lists only this project's `MAIN` files (a `MAIN` file of another project is never listed or enqueued); apply (with `ArticleFileService._enqueue_or_fail` monkeypatched to record calls) enqueues each once; with the patch raising `ParseEnqueueError` for the first file, the report records that file's failure and the second file is still enqueued.
    - `test_main_prints_the_report` — `main(["llm-pages"])` with `AsyncSessionLocal` monkeypatched to the test session factory returns 0 and prints `format_report`'s output (capsys).
- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/unit/test_evidence_repair_classify.py tests/integration/test_evidence_repair.py tests/integration/test_document_parsing_service.py -q` → FAIL (module missing; the 4.3 reparse tests stay green).
- [ ] **Step 3: Implement** per Interfaces; vulture: `main` is reached through `__main__`, so call it from the guard (`raise SystemExit(main())`) and keep the guard's pragma.
- [ ] **Step 4: Run green + gates** (full suite, lint, fitness, vulture).
- [ ] **Step 5: Commit.** `git -C "$WT" add backend && git -C "$WT" commit -m "feat(extraction): evidence_repair operator command for legacy pages, versions and reparse"`

**Done when:** all three commands dry-run by default with per-project counts, `--apply` touches exactly the reported AI rows, `stamp-versions --apply` takes the parse lock per file and re-reads under it, quotes never change, reparse is manager-gated and project-scoped, gates green.

---

### Task 4.6a: `absent_reason` offered per field; `Unclear` scales; prompt rules

**Layer:** backend · **Migration:** no · **Commit:** `feat(extraction): offer the AI only the absent-reason codes a field allows`

**Goal:** the per-field output model offers `absent_reason: Literal[codes] | None`, where `codes` holds `no_information` when the field `allows_no_information` and `not_applicable` when it `allows_not_applicable`; the property is omitted when `codes` is empty and `not_evaluated` is never offered. A field whose option codes include `Unclear` (case-insensitive) is an uncertainty scale: its status drops `not_found` and `codes` never offers `no_information`. The section and QA system prompts state the rules.

**Context:** after Task 4.4b. `backend/app/llm/schema.py`: `_PROPERTIES_PER_FIELD = 8` (L19, drives chunking with `OPENAI_STRICT_PROPERTY_BUDGET = 100`), `_enum_values(field)` (option codes via `claim_value.normalize_options`), `_field_result_model(field, index)` (L76: `value`, `confidence`, `reasoning`, `evidence`, `status: Literal["found","not_found","ambiguous"]`; every property required for OpenAI strict mode). Field flags: `ExtractionField.allows_not_applicable` (L438) / `allows_no_information` (L446) in `backend/app/models/extraction.py`; the pinned run-view field carries the same names (read with `getattr(field, ..., False)` like the other schema readers). `backend/app/services/value_semantics.py::AbsentReason` (StrEnum: `no_information`, `not_applicable`, `not_evaluated`) — `app.llm` is support and may not import `app.services`, so the two codes are literals in `schema.py` with a comment pointing at `AbsentReason`. Seeds: `Unclear` codes at `backend/app/seed.py` L296-308 (`_YES_NO_UNCLEAR`, `_PROBAST_JUDGMENT`, `_QUADAS2_*`) and lowercase `unclear` ~L2367/L2443. Prompts: `backend/app/llm/prompts/section_extraction.py::SYSTEM_PROMPT`, `quality_assessment.py::_SYSTEM_TEMPLATE` (both contain the "set status=\"not_found\", value=null, and evidence=[]" line after Task 4.4b). Recorded fake: `backend/tests/fakes/recorded_llm.py` (`NOT_FOUND` default for unscripted fields, `_FOUND` defaults) validates replies against the output model, so it must fill `absent_reason` where declared and must not answer `not_found` for an uncertainty-scale field.

**Files:**
- Modify: `backend/app/llm/schema.py`
- Modify: `backend/app/llm/prompts/section_extraction.py`, `backend/app/llm/prompts/quality_assessment.py`
- Modify: `backend/tests/fakes/recorded_llm.py` (schema-aware defaults)
- Test: `backend/tests/unit/test_llm_schema.py`, `backend/tests/unit/llm/test_prompts.py`

**Interfaces:**
- `schema.py`:
  ```python
  _PROPERTIES_PER_FIELD = 9  # value, confidence, reasoning, evidence{block_ref, quote}, status, absent_reason
  _UNCERTAIN_CODE = "unclear"
  def is_uncertainty_scale(field: Any) -> bool        # any option code .casefold() == "unclear"
  def offered_absent_codes(field: Any) -> tuple[str, ...]
  ```
  `offered_absent_codes`: `("no_information",)` if `allows_no_information` and not an uncertainty scale, plus `("not_applicable",)` if `allows_not_applicable`; never `not_evaluated`. `_field_result_model`: status `Literal["found", "ambiguous"]` for an uncertainty scale (its description drops the not_found sentence), else today's three; when `codes` is non-empty add `absent_reason=(Literal[codes] | None, Field(description="Set only when there is no value on purpose: no_information = the article is silent about it; not_applicable = the criterion does not apply to this study. Null otherwise."))` (list only the offered codes in the description). Budget: keep 9 for every field (a field without the property simply uses fewer), so a chunk now holds 11 fields instead of 12. Update the module docstring.
  `is_uncertainty_scale` and `offered_absent_codes` gain their write-path caller in Task 4.6b; in this task `_field_result_model` is their app caller.
- Prompts — replace the not_found sentence in both system prompts with rules (keep them short; VERSION bumps on its own):
  - "When the article is silent about a field: if the field's allowed values include a no-information answer (for example NI), return it as the value; otherwise, if absent_reason offers no_information, set it; otherwise return value=null with status=\"not_found\". Never invent a value or a quote."
  - "When a criterion does not apply to this study, set absent_reason=\"not_applicable\" where it is offered."
  - QA only: "A domain judgment is never 'not found': when the article does not permit judging, answer Unclear."
  - Delete the conflicting `value=null, and evidence=[]` instruction line; keep the `ambiguous` and `found` guidance.
- `recorded_llm.py`: build each unscripted field's default from the field's result model: `NOT_FOUND` plus `"absent_reason": None` when the model declares it; for a model whose `status` Literal has no `not_found`, default to `{"value": <the model's Unclear code>, "status": "ambiguous", "confidence": 0.0, "reasoning": None, "evidence": [], ...}` (read the Literal args from `model_fields["status"].annotation` and the value Literal similarly). Scripted answers also get `absent_reason: None` filled when declared and not given. Document the behavior in the module docstring.

- [ ] **Step 1: Write the failing tests.**
  - `tests/unit/test_llm_schema.py::test_absent_reason_enum_follows_flags` — parametrized over `(allows_no_information, allows_not_applicable)`: `(T, T)` → enum `{no_information, not_applicable}`; `(T, F)` → `{no_information}`; `(F, T)` → `{not_applicable}`; `(F, F)` → no `absent_reason` property in the JSON schema; `not_evaluated` never appears even when `allows_not_evaluated=True`.
  - `::test_uncertainty_scale_drops_not_found_and_no_information` — a field with codes `["Low", "High", "Unclear"]` and both flags on → status enum `{found, ambiguous}`, absent enum `{not_applicable}`; the same with lowercase `unclear`.
  - `::test_chunk_holds_eleven_fields` — 23 fields → 3 output models (11, 11, 1).
  - `tests/unit/llm/test_prompts.py::test_absent_rules_in_system_prompts` — both system prompts contain the no-information and not_applicable rules, the QA one the Unclear rule, and neither contains `value=null, and evidence=`.
- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/unit/test_llm_schema.py tests/unit/llm/test_prompts.py -q` → FAIL.
- [ ] **Step 3: Implement**; update the fake; run `uv run pytest tests/integration -q -k "extraction or qa or probast or quality"` and fix fixtures whose expectations depended on an `Unclear`-scale field answering `not_found` (they now default to `ambiguous` + the Unclear code in the fake; the write mapping lands in Task 4.6b).
- [ ] **Step 4: Run green + gates** (full suite, lint, fitness, vulture).
- [ ] **Step 5: Commit.** `git -C "$WT" add backend && git -C "$WT" commit -m "feat(extraction): offer the AI only the absent-reason codes a field allows"`

**Done when:** the output model offers exactly the allowed codes, uncertainty scales drop `not_found`/`no_information`, chunking reflects 9 properties, prompts carry the rules, the fake answers valid defaults, gates green.

---

### Task 4.6b: Absent-reason write mapping, `Unclear` rule, ADR 0016 Amendment

**Layer:** backend + frontend test + docs · **Migration:** no · **Commit:** `feat(extraction): store typed absent reasons and in-domain answers from AI output`

**Goal:** the AI write path stores what the model meant: an offered `absent_reason` becomes its typed marker; an in-domain enum answer (for example NI) is kept whatever the status; a `not_found` with no in-domain value becomes the `no_information` marker when allowed, else a bare null; an uncertainty-scale field (`Unclear`) stores its own `Unclear` code instead of a marker. A code the field does not offer is logged and never written. ADR 0016 and the architecture reference record the rules.

**Context:** after Task 4.6a. `backend/app/services/ai_extraction/_candidates.py::_candidate(spec, answer, verdicts)` (today: `not_found` → `{"value": None}` plus `absent_reason: no_information` when `spec.allows_no_information`, confidence dropped, reasoning kept; otherwise `{"value": answer["value"]}` plus the `verification` sibling); `build_candidates` gates evidence through entailment only for `found` answers and `_quotes` returns `[]` for `not_found`. `backend/app/llm/schema.py::is_uncertainty_scale`, `offered_absent_codes`, `_enum_values` (Task 4.6a; `_enum_values` is private — expose a public `option_codes(field)` alias only if `_candidates` needs it, rather than importing a private name). `AbsentReason` in `backend/app/services/value_semantics.py`. Seeds for tests: PROBAST+AI (`allows_no_information` off, `NI` as an in-domain code — `backend/app/seed_probast_ai.py`), PROBAST judgment `["Low","High","Unclear"]` (`seed.py` L303). Frontend: `frontend/lib/ai-extraction/suggestionUtils.ts` (`formatSuggestionValue`, `valuelessProposalKind`), copy `dispositionNotApplicable: 'Not applicable'` (`frontend/lib/copy/extraction.ts` L630). Docs: `docs/adr/0016-typed-absent-reason-marker.md` (existing "Amendment: `no_information` becomes opt-in too (2026-08-29)" at L127), `docs/reference/extraction-hitl-architecture.md`.

**Files:**
- Modify: `backend/app/services/ai_extraction/_candidates.py` (`_candidate`, evidence gating)
- Modify: `backend/app/llm/schema.py` (public `option_codes` if needed)
- Modify: `docs/adr/0016-typed-absent-reason-marker.md` (Amendment (2026-10)), `docs/reference/extraction-hitl-architecture.md`
- Test: `backend/tests/integration/test_ai_extraction_candidates.py`, `frontend/test/suggestionUtils.test.ts`

**Interfaces:**
- `_candidate(spec, answer, verdicts, *, logger)` — the mapping, in order (one branch each; keep the function small, a helper per rule if it grows past ~40 lines):
  1. `answer.get("absent_reason")` set: if it is in `offered_absent_codes(spec)` → `{"value": None, "absent_reason": code}`, confidence `None`, reasoning kept; else log `absent_reason_not_offered` (field, code) and continue to the next rules as if it were null.
  2. `spec` has option codes and `answer["value"]` is in-domain (for lists: every item in-domain and the list non-empty) → `{"value": value}` (plus `verification` when a verdict exists), whatever the status.
  3. `is_uncertainty_scale(spec)` and status `not_found` (reachable from a model or replay that ignores the narrowed Literal; rule 2 already kept any in-domain value) → `{"value": <the field's own Unclear code, exact case>}` — never a marker (PRU-66).
  4. Status `not_found` (any remaining field with no in-domain value) → `{"value": None, "absent_reason": "no_information"}` when `allows_no_information` (and not an uncertainty scale), else `{"value": None}`; confidence dropped, reasoning kept.
  5. `found` / `ambiguous` → `{"value": value}` plus the `verification` annotation (today's path).
- Evidence: `_quotes` keeps quotes for a marker answer (rule 1) — it filters only on `status == "not_found"` today; change it to "no quotes when the stored value is a bare null or a no-information marker", and gate through entailment only rows of rule 2/5 answers with status `found` (a marker's evidence is kept, ungroundable-flagged when unanchored per Task 4.4b, never entailment-gated).
- ADR 0016 "Amendment (2026-10)": the AI output offers `no_information` iff `allows_no_information` (and the field is not an uncertainty scale), `not_applicable` iff `allows_not_applicable`, and never `not_evaluated`; the write order above; the `Unclear` rule (an uncertainty scale stores its `Unclear` code, closing PRU-66's write-time half); un-offered codes are logged, never written. `extraction-hitl-architecture.md`: the same rules in the proposal-value section (short), `last_reviewed:` bumped.

- [ ] **Step 1: Write the failing tests.**
  - `tests/integration/test_ai_extraction_candidates.py` (recorded fake + seeded templates):
    - `test_probast_ai_ni_answer_is_kept_as_value` — `{value:"NI", status:"not_found"}` stores `{"value": "NI"}`.
    - `test_unclear_scale_not_found_stores_unclear_code` — a `Low/High/Unclear` judgment answering `{value: null, status: "not_found"}` stores `{"value": "Unclear"}`, not a marker; with a lowercase-`unclear` field the stored code is `"unclear"`. Drive this case through `build_candidates(p, run=..., entity_type_id=..., extracted={...}, verdicts=None)` with a hand-built `extracted` dict: the narrowed output model would refuse `not_found` from the recorded fake.
    - `test_conditional_criterion_stores_not_applicable_marker` — `absent_reason: "not_applicable"` on a field that allows it stores `{"value": None, "absent_reason": "not_applicable"}` and keeps its quote as evidence without an entailment call (`RecordedLlm` records no `entailment_judge` call for it).
    - `test_unoffered_code_is_not_written` — `not_applicable` on a field that does not allow it is never stored as a marker (the answer falls through to rule 4/5) and `absent_reason_not_offered` is logged (`caplog` or the structlog capture the file already uses).
    - `test_numeric_not_found_gives_no_information_marker` — a number field `not_found` with `allows_no_information` stores the marker; with the flag off, `{"value": None}`.
    - `test_multiselect_list_value_rule` — a multi-select field answering status `not_found`: a list with every item in the domain is stored as the list (rule 2, whatever the status); a list with one out-of-domain item and an empty list each skip rule 2 and land by rule 4 (marker with `allows_no_information`, else `{"value": None}`).
  - `frontend/test/suggestionUtils.test.ts`: `formatSuggestionValue({value: null, absent_reason: 'not_applicable'}, …)` (or the function the review list uses for an AI proposal) renders "Not applicable". This pins existing frontend behavior for AI markers and may pass at once; keep it.
- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/integration/test_ai_extraction_candidates.py -q` → FAIL; `cd "$WT" && npx vitest run frontend/test/suggestionUtils.test.ts`.
- [ ] **Step 3: Implement** per Interfaces; write the two docs.
- [ ] **Step 4: Run green + gates** (backend set, the frontend set, `bash scripts/docs/check-frontmatter.sh`).
- [ ] **Step 5: Commit.** `git -C "$WT" add backend frontend docs && git -C "$WT" commit -m "feat(extraction): store typed absent reasons and in-domain answers from AI output"`

**Done when:** every rule writes as specified, un-offered codes never land, `Unclear` scales store their own code, ADR 0016 and the architecture reference are amended, gates green.

---

### Task 4.9a: One `entity_key` per coordinate in the database (migration 0090)

**Layer:** backend · **Migration:** yes (`0090_entity_key_unique`) · **Commit:** `feat(extraction): enforce one entry identity per coordinate in the database`

**Goal:** the database enforces one `entity_key` per `(article, entity type, parent instance)` coordinate, roots included (`NULLS NOT DISTINCT`). The migration first audits and heals existing duplicates — the oldest holder keeps the key; every other holder records the loss in its key history and drops the key — and prints a report. The AI landing's create path survives a concurrent creator by re-reading.

**Context:** after Task 4.3 (head `0089_evidence_content_version`). `backend/app/models/extraction.py::ExtractionInstance` (class L484; `parent_instance_id` nullable; `metadata_` mapped to column `"metadata"` JSONB NOT NULL; `__table_args__` ~L547 with a GIN index on `metadata`). `backend/app/services/entity_key.py`: `STORE_KEY = "entity_key"`, `HISTORY_KEY = "entity_key_history"` (L60-62; history entries are `{who, when, from, to}`); `resolve_instance` (L229: `match_or_none`, then `db.add` + `flush`); `match_or_none` (L305; the docstring's last paragraph at L324-325 is the stale "Two siblings can hold one normalized key…" sentence — deleted in Task 4.9b). Caller: `backend/app/services/ai_extraction/landing.py::ProposalLanding.open_entry` (L240-264). Keys are stored normalized (`normalize_key`), so equality on `metadata->>'entity_key'` is the identity. Postgres 17 supports `NULLS NOT DISTINCT`; SQLAlchemy's PostgreSQL dialect takes `postgresql_nulls_not_distinct=True` on `Index` (the lock has SQLAlchemy 2.0.50). Alembic 1.18.4 with SQLAlchemy 2 **does** compare expression indexes and the `nulls_not_distinct` option (`_skip_functional_indexes` only runs without SQLAlchemy 2), normalizing quotes, `::text` and parentheses, so the model declaration must match the reflected index exactly; treat any `alembic check` diff as a real mismatch, not noise. The partial `WHERE` is not compared, so the roundtrip's `indexdef` assertion is the only guard for the predicate.

**Files:**
- Create: `backend/alembic/versions/0090_entity_key_unique.py`
- Modify: `backend/app/models/extraction.py` (`ExtractionInstance.__table_args__` unique index)
- Modify: `backend/app/services/entity_key.py` (`resolve_instance` nested insert + re-read)
- Modify: `backend/tests/integration/test_migration_roundtrip.py` (head pin + roundtrip + seeded-duplicates heal test)
- Modify: `docs/reference/extraction-hitl-architecture.md` ("Migration head:" → `0090_entity_key_unique`; one line on the identity index; `last_reviewed:`)
- Test: `backend/tests/integration/test_entity_key_matching.py`

**Interfaces / schema:**
- Migration `revision = "0090_entity_key_unique"`, `down_revision = "0089_evidence_content_version"`. Upgrade, in order:
  0. **Lock:** `LOCK TABLE public.extraction_instances IN SHARE ROW EXCLUSIVE MODE` (old app code still serves during the Railway deploy; the lock keeps a concurrent insert or re-key from landing a duplicate between the heal and the index build; held until the migration's transaction commits).
  1. **Audit:** `SELECT article_id, entity_type_id, parent_instance_id, metadata->>'entity_key' AS k, count(*) FROM public.extraction_instances WHERE metadata ? 'entity_key' GROUP BY 1,2,3,4 HAVING count(*) > 1` — print `0090_entity_key_unique: <n> duplicate group(s), <m> holder(s) to heal` (ids only, never keys or labels: keys can be study names).
  2. **Heal** (one statement, idempotent — a re-run finds no duplicates): with `ranked AS (SELECT id, row_number() OVER (PARTITION BY article_id, entity_type_id, parent_instance_id, metadata->>'entity_key' ORDER BY created_at, id) AS rn FROM public.extraction_instances WHERE metadata ? 'entity_key')`, `UPDATE public.extraction_instances i SET metadata = (i.metadata - 'entity_key') || jsonb_build_object('entity_key_history', COALESCE(i.metadata->'entity_key_history', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('who', 'migration:0090_entity_key_unique', 'when', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'), 'from', i.metadata->>'entity_key', 'to', NULL))) FROM ranked r WHERE r.id = i.id AND r.rn > 1`. Print the healed instance ids.
  3. `CREATE UNIQUE INDEX uq_extraction_instances_entity_key ON public.extraction_instances (article_id, entity_type_id, parent_instance_id, (metadata->>'entity_key')) NULLS NOT DISTINCT WHERE metadata ? 'entity_key'` (via `op.execute`; plain `CREATE INDEX`, not `CONCURRENTLY`, since Alembic runs in a transaction).
  Downgrade: `DROP INDEX IF EXISTS public.uq_extraction_instances_entity_key`; the docstring says the heal is not reversed (keys removed from losers stay removed; their history records them).
- Model, in `ExtractionInstance.__table_args__`: `Index("uq_extraction_instances_entity_key", "article_id", "entity_type_id", "parent_instance_id", text("(metadata->>'entity_key')"), unique=True, postgresql_nulls_not_distinct=True, postgresql_where=text("metadata ? 'entity_key'"))`.
- `resolve_instance`: after a `match_or_none` miss, create inside `async with db.begin_nested():` (`db.add(instance)`; `await db.flush()`); on `IntegrityError` whose constraint is `uq_extraction_instances_entity_key` (`app.core.integrity.violates_constraint(exc, ENTITY_KEY_UNIQUE_INDEX)`, a support helper), the savepoint rolls back and the function re-reads with `match_or_none` and returns `(existing, False)`; any other `IntegrityError` re-raises. Expose the index name as `ENTITY_KEY_UNIQUE_INDEX = "uq_extraction_instances_entity_key"` in `entity_key.py` (used here and in Task 4.9b).

- [ ] **Step 1: Write the failing tests.**
  - `test_migration_roundtrip.py`: `expected_head = "0090_entity_key_unique"`; `test_migration_0090_entity_key_unique_roundtrip` — index present at head (`pg_indexes`, `indexdef` contains `NULLS NOT DISTINCT` and `WHERE (metadata ? 'entity_key'::text)`), absent after downgrade to `0089_evidence_content_version`, back after upgrade. `test_migration_0090_heals_seeded_duplicates` — downgrade to `0089…`, insert three root instances (same article, entity type, `parent_instance_id NULL`, same key) with distinct `created_at`, upgrade: the oldest keeps `metadata.entity_key`; the other two have no key and a last history entry `{who: "migration:0090_entity_key_unique", from: <key>, to: null}`; clean the rows up in `finally`.
  - `test_entity_key_matching.py::test_db_rejects_duplicate_identity_including_root` — inserting a second instance with the same normalized key at the same coordinate raises `IntegrityError` naming the index, both for a root (`parent_instance_id NULL`) and a child coordinate; the same key under a different parent is accepted.
  - `::test_concurrent_resolve_instance_yields_one_row` — two independent sessions (the real-commit fixture `db_session_real`, or two sessions from the test engine, per `web-testing` conventions) call `resolve_instance` for the same new key concurrently (`asyncio.gather`) and commit; exactly one row exists and one call reports `created=True`, the other `False` with the same id. Clean up committed rows.
- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/integration/test_migration_roundtrip.py tests/integration/test_entity_key_matching.py -q` → FAIL.
- [ ] **Step 3: Implement.** Render: `cd "$WT/backend" && uv run alembic upgrade 0089_evidence_content_version:0090_entity_key_unique --sql | grep -i entity_key`. Then `uv run alembic upgrade head && uv run alembic check` (no diff) and re-seed nothing (no seed change).
- [ ] **Step 4: Run green + gates** (full suite, lint, fitness incl. `check_migration_split.sh`, `check_rls_coverage.py`; `alembic check`; vulture).
- [ ] **Step 5: Commit.** `git -C "$WT" add backend docs && (cd "$WT" && bash scripts/docs/check-frontmatter.sh) && git -C "$WT" commit -m "feat(extraction): enforce one entry identity per coordinate in the database"`

**Done when:** duplicates are healed deterministically with history, the unique index (roots included) is enforced and declared on the model, the concurrent AI create yields one row, roundtrip + heal tests pass, gates green.

---

### Task 4.9b: Re-key duplicate check, typed 409 everywhere, dialog message

**Layer:** both · **Migration:** no · **Commit:** `fix(extraction): refuse a re-key onto a sibling's identity with a typed 409`

**Goal:** re-keying an entry onto an identity a sibling already holds answers a typed 409 `ENTRY_KEY_DUPLICATE` and leaves the entry and its history unchanged; manual add maps a database violation (a race past the pre-check) to the same 409; the rename dialog shows the server's 409 message inline, while 404, 403 and network failures show the generic message.

**Context:** after Task 4.9a. `backend/app/services/instance_identity_service.py::update_instance_identity` (L28-66: coordinate-scoped load via `ExtractionInstanceRepository.get_in_coordinate`, label, then `rekey_instance(...)` with no uniqueness check, `flush`, `refresh`). `backend/app/services/entry_hierarchy_service.py`: `EntryKeyDuplicateError(AppError)` (L70, code `ENTRY_KEY_DUPLICATE`, 409 via the handler), `create_entry` pre-checks with `match_or_none` (L141-149) then `self.db.add(entry); await self.db.flush()` (~L169). `backend/app/services/entity_key.py::match_or_none` (L305; docstring L324-325 holds the stale sentence) and `ENTITY_KEY_UNIQUE_INDEX` (Task 4.9a). Endpoint `backend/app/api/v1/endpoints/extraction_instances.py`: `create_entry` already does `except EntryKeyDuplicateError: await db.rollback(); raise` (L102-104) and states the 409 in its `description`; `update_instance` (L192-230) catches only `InstanceNotFoundError` (404) and `ValueError` (400). `app.core.integrity.violates_constraint(exc, *names)`. Frontend: `frontend/components/extraction/AddEntryDialog.tsx` — `failureMessage(err, fallback)` (L68: any thrown `Error` message wins) used by both dialogs; the rename dialog's fallback is `t('extraction','errors_updateEntry')` (L291). The add dialog's duplicate-key message does **not** arrive as an `ApiError`: `frontend/hooks/extraction/useAddEntry.ts` (L123-126) catches `ApiError` code `ENTRY_KEY_DUPLICATE` and rethrows a plain `Error(t('pages','extractionScreenEntryKeyDuplicate'))`, which the current helper shows. `frontend/hooks/extraction/useUpdateInstanceIdentity.ts` `onError` toasts `` `${t('extraction','errors_updateEntry')…}: ${error.message}` `` for every status. `ApiError(code, message, status, …)` in `frontend/integrations/api/client.ts` (L68). Tests: `frontend/components/extraction/AddEntryDialog.test.tsx`; no `useAddEntry` test exists.

**Files:**
- Modify: `backend/app/services/entity_key.py` (`match_or_none(..., exclude_id=None)`; delete the stale docstring sentence)
- Modify: `backend/app/services/instance_identity_service.py` (pre-check + violation mapping)
- Modify: `backend/app/services/entry_hierarchy_service.py` (violation mapping on create)
- Modify: `backend/app/api/v1/endpoints/extraction_instances.py` (`update_instance` passes the AppError through; description)
- Modify: `frontend/components/extraction/AddEntryDialog.tsx` (`renameFailureMessage` for the rename dialog; the add dialog's `failureMessage` unchanged)
- Modify: `frontend/hooks/extraction/useUpdateInstanceIdentity.ts` (`onError` toast appends the server message only for a 409)
- Regenerate API types if the endpoint description changed (`npm run generate:api-types`)
- Test: `backend/tests/integration/test_instance_identity.py`, `backend/tests/integration/test_entity_key_matching.py` (create mapping), a direct handler unit test (new `backend/tests/unit/test_extraction_instances_endpoint_unit.py` or the existing unit file for this router), `frontend/components/extraction/AddEntryDialog.test.tsx`, new `frontend/hooks/extraction/useAddEntry.test.tsx`, new `frontend/hooks/extraction/useUpdateInstanceIdentity.test.tsx`

**Interfaces:**
- `match_or_none(db, *, article_id, entity_type_id, key_value, parent_instance_id=None, exclude_id: UUID | None = None)` adds `ExtractionInstance.id != exclude_id` when set. Delete the paragraph "Two siblings can hold one normalized key: `update_instance_identity` re-keys without a uniqueness check, so which one answers is arbitrary." — the index makes it false.
- `update_instance_identity`: when a non-blank `entity_key` normalizes to a different key, call `match_or_none(..., key_value=entity_key, parent_instance_id=instance.parent_instance_id, exclude_id=instance.id)` (coordinate = the instance's own `article_id`, `entity_type_id`, `parent_instance_id`); a hit raises `EntryKeyDuplicateError(entity_key)` **before** `rekey_instance` (nothing mutated). Wrap the `flush` in `try/except IntegrityError` → `violates_constraint(exc, ENTITY_KEY_UNIQUE_INDEX)` → raise `EntryKeyDuplicateError(entity_key) from exc` (the endpoint's rollback discards the in-memory change); other `IntegrityError`s re-raise. Import `EntryKeyDuplicateError` from `entry_hierarchy_service` (services → services is allowed); if that creates an import cycle, move the class to `entity_key.py` and re-export nothing (update both importers).
- `create_entry`: wrap `self.db.add(entry); await self.db.flush()` in `async with self.db.begin_nested():` and map an `IntegrityError` on `ENTITY_KEY_UNIQUE_INDEX` to `EntryKeyDuplicateError(key_value)`.
- `update_instance`: add `except EntryKeyDuplicateError: await db.rollback(); raise` before the `ValueError` branch (the global handler renders the typed 409 envelope); append "A re-key onto an identity a sibling already holds answers a typed 409 ENTRY_KEY_DUPLICATE and changes nothing." to the route `description` (mirrors `create_entry`); run `check_response_descriptions.py`.
- The 409-only rule is scoped to the rename path. New `renameFailureMessage(err, fallback)` beside `failureMessage` (a plain function, React Compiler): returns `err.message` only when `err instanceof ApiError && err.status === 409 && err.message`; otherwise `fallback` (404, 403, network, unknown). `RenameEntryDialog` (L295) calls it. `AddEntryDialog` keeps `failureMessage` unchanged: its error arrives from `useAddEntry` as a plain `Error` carrying the `extractionScreenEntryKeyDuplicate` copy text, and the existing `'boom'` test stays as it is.
- `useUpdateInstanceIdentity` `onError`: the toast is `t('extraction','errors_updateEntry')…` alone, with `: ${error.message}` appended only when `error instanceof ApiError && error.status === 409` (spec: 404, 403 and network errors are generic).

- [ ] **Step 1: Write the failing tests.**
  - `test_instance_identity.py::test_rekey_to_sibling_key_is_409_and_unchanged` — two siblings `A` (key `x`) and `B` (key `y`): re-keying `B` to `" X "` raises `EntryKeyDuplicateError`; after rollback `B` still has key `y` and an unchanged `entity_key_history`. Re-keying `B` to its own key is still a no-op; to a free key succeeds.
  - `::test_patch_rekey_onto_sibling_answers_409` — through `db_client`: status 409, `error.code == "ENTRY_KEY_DUPLICATE"`; plus a direct handler test (`update_instance.__wrapped__`) asserting the AppError propagates and `db.rollback` was awaited (diff coverage).
  - `test_entity_key_matching.py::test_create_entry_maps_index_violation_to_409` — with `match_or_none` monkeypatched to miss once (simulating a concurrent creator), `create_entry` for an existing key raises `EntryKeyDuplicateError`, not `IntegrityError`.
  - `AddEntryDialog.test.tsx::rename shows duplicate-key 409 message` — `onConfirm` rejects with `new ApiError('ENTRY_KEY_DUPLICATE', 'An entry with the key …', 409)` → that message renders and the dialog stays open; `::rename shows the generic message for 404, 403 and network errors` — `ApiError(…, 404)`, `ApiError(…, 403)` and `new TypeError('Failed to fetch')` each render the `errors_updateEntry` text. The add dialog's existing `'boom'` test (plain `Error` message shown) stays green unchanged.
  - `useAddEntry.test.tsx::add dialog shows the duplicate-key message from a server 409` — a harness renders `useAddEntry` and spreads its `dialogProps` into `AddEntryDialog`, with `vi.mock('@/integrations/api/client', …)` making `createEntry` reject `new ApiError('ENTRY_KEY_DUPLICATE', 'raw server text', 409)`; after `open(...)`, typing a key and confirming, the dialog shows `t('pages','extractionScreenEntryKeyDuplicate')` and stays open (this drives the real hook → dialog path the plain-`Error` rethrow takes).
  - `useUpdateInstanceIdentity.test.tsx`: a 409 toast includes the server message; a 404 and a `TypeError` toast show only the generic text (`toast.error` mocked from `sonner`).
- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/integration/test_instance_identity.py tests/integration/test_entity_key_matching.py -q` and `cd "$WT" && npx vitest run frontend/components/extraction/AddEntryDialog.test.tsx frontend/hooks/extraction/` → FAIL.
- [ ] **Step 3: Implement** per Interfaces; `npm run generate:api-types` (the description is in the OpenAPI document) and commit the diff.
- [ ] **Step 4: Run green + gates** (backend and frontend sets; `check_scope_guards.py` unchanged — the duplicate lookup is keyed by the already coordinate-scoped instance).
- [ ] **Step 5: Commit.** `git -C "$WT" add backend frontend && git -C "$WT" commit -m "fix(extraction): refuse a re-key onto a sibling's identity with a typed 409"`

**Done when:** re-key, manual add and AI landing all yield typed outcomes against the unique index, the entry is unchanged on a 409, the stale docstring is gone, the rename dialog and its toast show only the 409 server message, the add dialog still shows its duplicate-key copy (tested through `useAddEntry`), gates green.

---

### Task 4.7a-1: Call accounting: request ids, verify/entailment usage, `passes_detail`

**Layer:** backend · **Migration:** no · **Commit:** `feat(extraction): record every model pass with its tokens and request ids in the proposal snapshot`

**Goal:** each section snapshot lists every pass that produced its proposals — extract, identify (entry groups), verify and entailment — with prompt name, prompt version, tokens and provider request ids. Verify and entailment prompt versions become content hashes, and the entailment judge stops discarding its usage.

**Context:** after Tasks 4.3 and 4.6b. `backend/app/llm/extractor.py`: `LlmUsage` (L47, dataclass `prompt_tokens`, `completion_tokens`, `total_tokens` property, `__add__`), `extract_structured` (L92; `result = await agent.run(...)`, returns `LlmUsage(prompt_tokens=result.usage.input_tokens or 0, ...)`). pydantic-ai 1.107: `result.all_messages()` yields `ModelRequest`/`ModelResponse`; `ModelResponse.provider_response_id: str | None`. `backend/app/llm/verify.py`: `NAME = "verify_pass"`, `VERSION = "1"` (L30-31), `_SYSTEM` (L36), the user prompt built inside `run_verify_pass` (L77), returning `(verdicts, usage)`. `backend/app/llm/entailment.py`: `NAME = "entailment_judge"`, `VERSION = "1"` (L18-19), `_SYSTEM` (L21), `judge_entailment` (L38: `verdict, _usage = await extract(...)`), `gate_evidence` (L63), `run_entailment_gate(specs, model, logger, *, concurrency, extract) -> list[AttributionLabel | None]` (L150, degrades a raised judge to `None`). `backend/app/llm/prompts/__init__.py::content_version(*parts)`. `backend/app/services/ai_extraction/_model_calls.py`: `FieldCall` (`extracted`, `usage`, `inputs`, `grounding_retries`), `verify_and_snapshot` (returns `(verdicts, usage, snapshot)`; `_verify` returns `(verdicts, usage, mode_executed, passes)`), `_section_snapshot` → `build_run_provenance(...)` (`backend/app/services/run_engine_freeze.py` L143) merged with `connection_id`/`deviation`. `backend/app/services/ai_extraction/_sections.py`: `_extract_entry_group` calls `_identify_entries` once per group (L131) then `_verify_and_land` per entry; `_verify_and_land` (L191: `verify_and_snapshot`, `build_candidates`, `landing.land(..., Generation(p.engine, snapshot, p.attempt_id))`). `backend/app/services/ai_extraction/_candidates.py::build_candidates` calls `run_entailment_gate` once per field call. `backend/app/services/ai_extraction/landing.py::_SNAPSHOT_KEYS` (L74) sanitizes the snapshot (unknown top-level keys are dropped). `backend/app/llm/prompts/entry_identification.py` (`NAME`, `VERSION`). Recorded fake: `RecordedLlm(usage=..., usages={prompt_name: LlmUsage})`.

**Files:**
- Modify: `backend/app/llm/extractor.py` (`LlmUsage.request_ids`)
- Modify: `backend/app/llm/verify.py`, `backend/app/llm/entailment.py` (content-hash VERSION; usage returned)
- Create: `backend/app/llm/pass_kinds.py` (`PassKind`, `PASS_KIND_BY_PROMPT` — the one prompt-name → pass-kind map; Task 4.8b's ledger imports it)
- Modify: `backend/app/schemas/prompt_composition.py` (`PassDetail`, `PassTokens` models beside `PromptComposition`)
- Modify: `backend/app/services/ai_extraction/_model_calls.py` (`pass_detail`, `passes_detail` in the snapshot)
- Modify: `backend/app/services/ai_extraction/_candidates.py` (`build_candidates` returns entailment usage)
- Modify: `backend/app/services/ai_extraction/_sections.py` (identify entry per group; entailment entry appended before landing)
- Modify: `backend/app/services/ai_extraction/landing.py` (`passes_detail` kept by the sanitizer)
- Modify: other `run_entailment_gate` / `judge_entailment` callers (`grep -rn "run_entailment_gate\|judge_entailment" backend/app`)
- Test: `backend/tests/integration/test_extraction_generation_attempts.py`, `backend/tests/integration/test_entry_group_extraction.py`, `backend/tests/unit/llm/test_prompts.py`, `backend/tests/unit/llm` extractor test (new `test_extractor_request_ids.py` with pydantic-ai's `FunctionModel`/`TestModel`)

**Interfaces:**
- `LlmUsage.request_ids: list[str] = field(default_factory=list)`; `__add__` concatenates (`self.request_ids + other.request_ids`). `extract_structured` fills it from `[m.provider_response_id for m in result.all_messages() if isinstance(m, ModelResponse) and m.provider_response_id]` (all attempts, including output-validator retries). Update the class docstring.
- `verify.py` / `entailment.py`: lift the inline user-prompt template into a module constant (`_USER_TEMPLATE`) rendered with `.format(...)` (byte-identical output), and set `VERSION = content_version(_SYSTEM, _USER_TEMPLATE)`. `judge_entailment` returns `(label, usage)`; `gate_evidence` returns `(label, usage)` (a short-circuit without a call returns zero usage); `run_entailment_gate` returns `(labels, usage_sum)` — a raised judge contributes zero usage (Task 4.8b's ledger records the failed call itself).
- `llm/pass_kinds.py` (support; imports only `app.llm` prompt modules):
  ```python
  PassKind = Literal["extract", "identify", "verify", "entailment"]
  PASS_KIND_BY_PROMPT: dict[str, PassKind] = {
      section_extraction.NAME: "extract", quality_assessment.NAME: "extract",
      entry_identification.NAME: "identify", verify.NAME: "verify", entailment.NAME: "entailment",
  }
  ```
  An unknown prompt name is a `KeyError` (a new prompt must be added here). This is the only map; nothing else hard-codes a kind.
- `schemas/prompt_composition.py` (the precedent docstring: one Pydantic model so a key typo at the write site fails loudly): `class PassTokens(BaseModel): prompt: int; completion: int; total: int` and `class PassDetail(BaseModel): kind: PassKind; prompt_name: str; prompt_version: str; tokens: PassTokens; request_ids: list[str]`.
- `_model_calls.py`:
  ```python
  def pass_detail(prompt_name: str, prompt_version: str, usage: LlmUsage) -> PassDetail
      # kind = PASS_KIND_BY_PROMPT[prompt_name]; written into the snapshot as .model_dump()
  ```
  `verify_and_snapshot(..., identify: dict[str, Any] | None = None)` builds `passes_detail = [identify?] + [extract entry from call.inputs.prompt_name/prompt_version and call.usage] + [verify entry when the verify pass ran a model call]`, and `_section_snapshot` writes `snapshot["passes_detail"]`. `_verify` additionally returns the verify usage it already has (no new call). Snapshot `tokens` stay extract + verify for this section (unchanged); snapshot tokens are never summed across sections.
- `_candidates.build_candidates` returns `(section, candidates, entailment_usage)`; `_sections._verify_and_land(..., identify=None)` passes `identify` to `verify_and_snapshot`, then, when `entailment_usage` came from at least one judge call, appends `pass_detail(entailment.NAME, entailment.VERSION, entailment_usage).model_dump()` to `snapshot["passes_detail"]` **after** `build_candidates` and **before** `landing.land`. `_extract_entry_group` builds the group's one identify entry from `_identify_entries`' usage (`entry_identification.NAME`/`VERSION`) and passes the same dict to every entry's `_verify_and_land` (same `request_ids`).
- `landing._SNAPSHOT_KEYS` gains `"passes_detail"` (a list; not in `_NESTED_SNAPSHOT_KEYS`; sanitize each entry to the six keys above in `_sanitize`).

- [ ] **Step 1: Write the failing tests.**
  - `tests/unit/llm/test_extractor_request_ids.py`: `extract_structured` with a pydantic-ai `FunctionModel` whose responses carry `provider_response_id="resp-1"` (and a retry producing `"resp-2"`) returns `usage.request_ids == ["resp-1", "resp-2"]`; `LlmUsage(..., ["a"]) + LlmUsage(..., ["b"])` concatenates.
  - `tests/unit/llm/test_pass_kinds.py`: every prompt `NAME` maps (`section_extraction`, `quality_assessment` → extract; `entry_identification` → identify; `verify_pass` → verify; `entailment_judge` → entailment); an unknown name raises `KeyError`; `pass_detail(...)` derives the kind from the prompt name and its `model_dump()` has exactly the five keys.
  - `tests/unit/llm/test_prompts.py::test_verify_and_entailment_versions_are_content_hashes`: each `VERSION` equals `content_version(_SYSTEM, _USER_TEMPLATE)` and is a 12-hex string, not `"1"`.
  - `test_extraction_generation_attempts.py::test_passes_detail_counts_verify_and_entailment_tokens`: a verified run with the recorded fake and `usages={"section_extraction": LlmUsage(100, 10, ["x1"]), "verify_pass": LlmUsage(50, 5, ["v1"]), "entailment_judge": LlmUsage(7, 1, ["e1"])}` → the proposal snapshot's `passes_detail` kinds are `["extract", "verify", "entailment"]` with those tokens and request ids (entailment summed over its calls); it survives the landing sanitizer.
  - `test_entry_group_extraction.py::test_identify_pass_in_snapshot`: a two-entry group → each entry's snapshot starts with the same `identify` entry (same `request_ids`).
- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/unit/llm tests/integration/test_extraction_generation_attempts.py tests/integration/test_entry_group_extraction.py -q` → FAIL.
- [ ] **Step 3: Implement** per Interfaces; update callers/tests that unpack the old two-value `build_candidates` / `run_entailment_gate` results.
- [ ] **Step 4: Run green + gates** (full suite, lint, fitness, vulture).
- [ ] **Step 5: Commit.** `git -C "$WT" add backend && git -C "$WT" commit -m "feat(extraction): record every model pass with its tokens and request ids in the proposal snapshot"`

**Done when:** request ids flow from pydantic-ai into usage, verify/entailment versions are content hashes, every snapshot carries `passes_detail` with identify/extract/verify/entailment entries as they ran, gates green.

---

### Task 4.7a-2: Snapshot identity: template version, schema and text hashes

**Layer:** backend + frontend type · **Migration:** no · **Commit:** `feat(extraction): snapshot the template version, output schema and article text each proposal came from`

**Goal:** each section snapshot proves its inputs: `template_version: {id, version}` (the run's pinned version, even if the template is republished mid-run), `schema_sha256` over the canonical output-model schemas actually sent, and `prompt_composition.article_ref.{content_version, text_sha256}` (the article version and the hash of the exact text substituted for the article marker). The landing sanitizer keeps the new keys; the frontend type gains the optional article-ref fields.

**Context:** after Task 4.7a-1. `backend/app/services/ai_extraction/_model_calls.py`: `ARTICLE_MARKDOWN_MARKER` (L34), `_SnapshotInputs` (L38: `prompt_name`, `prompt_version`, `section_name`, `section_label`, `system_prompt`, `section_instruction`, `fields`, `llm_calls`), `extract_fields` builds `output_models = build_output_models(...)` and loops them, `_section_snapshot` builds `PromptCompositionArticleRef(file_id, file_name, truncated, est_tokens)` from `p.prompt_input` and calls `build_run_provenance`. `backend/app/schemas/prompt_composition.py::PromptCompositionArticleRef` (L16). `backend/app/services/extraction_prompt_input.py::PromptInputInfo` (gains `content_version` in Task 4.3; the returned `text` is what the prompt substitutes for the marker). `ExtractionRun.version_id` → `ExtractionTemplateVersion.version` (`backend/app/models/extraction_versioning.py`, integer `version`). `Pipeline` caches per-run data (`_pinned` keyed by `(run.id, run.version_id)`, `_pipeline.py` L188-196). `backend/app/services/ai_extraction/landing.py`: `_SNAPSHOT_KEYS` (L74), `_NESTED_SNAPSHOT_KEYS` (L91), `_ARTICLE_REF_KEYS` (L103), `_sanitize` (L110-123). Frontend: `frontend/types/ai-extraction.ts::PromptCompositionArticleRef` (L39), mapped in `frontend/services/aiSuggestionService.ts` (~L130-140, `ar['est_tokens']` etc.), test `frontend/test/services/aiSuggestionService.test.ts` (~L540-570).

**Files:**
- Modify: `backend/app/services/extraction_prompt_input.py` (`PromptInputInfo.text_sha256`)
- Modify: `backend/app/schemas/prompt_composition.py` (`content_version`, `text_sha256`; `TemplateVersionRef`)
- Modify: `backend/app/services/ai_extraction/_model_calls.py` (`schema_sha256` on `_SnapshotInputs`; snapshot fields)
- Modify: `backend/app/services/ai_extraction/_pipeline.py` (`template_version_ref`)
- Modify: `backend/app/services/ai_extraction/_sections.py` (pass the run to the snapshot)
- Modify: `backend/app/services/ai_extraction/landing.py` (allowlists)
- Modify: `frontend/types/ai-extraction.ts`, `frontend/services/aiSuggestionService.ts`
- Test: `backend/tests/integration/test_extraction_generation_attempts.py`, `backend/tests/integration/test_proposal_landing.py`, `frontend/test/services/aiSuggestionService.test.ts`

**Interfaces:**
- `PromptInputInfo.text_sha256: str` = `hashlib.sha256(text.encode("utf-8")).hexdigest()` of the markdown `build_prompt_input` returns.
- `PromptCompositionArticleRef`: `content_version: int | None = None`, `text_sha256: str | None = None` (docstring: the integer article version, not a prompt hash; the full SHA-256 of the substituted article text). Filled in `_section_snapshot` from `info.content_version` / `info.text_sha256`. This schema is not served by `/api/v1` as a response model — confirm with `grep -rn PromptComposition backend/app/schemas backend/app/api`; if it is, regenerate the API types.
- `_SnapshotInputs.schema_sha256: str` computed in `extract_fields`: `hashlib.sha256(json.dumps([m.model_json_schema(by_alias=True) for m in output_models], sort_keys=True, separators=(",", ":")).encode()).hexdigest()` — the canonical schemas of the chunks actually sent.
- `schemas/prompt_composition.py`: `class TemplateVersionRef(BaseModel): id: str; version: int`. `Pipeline.template_version_ref(run) -> TemplateVersionRef` — `id=str(run.version_id)`, `version=<ExtractionTemplateVersion.version>`, one select per `run.version_id`, cached on the pipeline. `verify_and_snapshot(..., template_version: TemplateVersionRef)` writes `template_version.model_dump()`; `_verify_and_land` passes `await p.template_version_ref(a.run)`.
- Snapshot top-level gains `template_version` and `schema_sha256` (alongside `passes_detail`). `landing`: `_SNAPSHOT_KEYS` += `{"template_version", "schema_sha256"}`; `_NESTED_SNAPSHOT_KEYS["template_version"] = {"id", "version"}`; `_ARTICLE_REF_KEYS` += `{"content_version", "text_sha256"}`.
- Frontend: `PromptCompositionArticleRef` gains `contentVersion?: number | null; textSha256?: string | null;` and the mapper reads `ar['content_version']` / `ar['text_sha256']`. No new rendering (the generation details stay data-driven; legacy snapshots show nothing new).

- [ ] **Step 1: Write the failing tests.**
  - `test_extraction_generation_attempts.py::test_snapshot_records_template_version_schema_and_text_hash`: a run with the recorded fake → the proposal snapshot has `template_version == {"id": str(run.version_id), "version": N}`, `schema_sha256` equal to the hash of the output models the fake recorded (`Call.output_model`), `prompt_composition.article_ref.content_version` = the file's version and `text_sha256` = SHA-256 of the user prompt's article section (recompute from `p.prompt_input` or by hashing the text the fake saw between the template's "Article text:" line and the next block). Republish mid-run: a `RecordedLlm(during=...)` hook that publishes a new template version during the first call → the snapshot still records the run's pinned version.
  - `test_proposal_landing.py::test_sanitize_keeps_provenance_keys`: `_sanitize` keeps `template_version` (`id`, `version` only), `schema_sha256`, `passes_detail` and the two article-ref keys, and still drops an unknown key at each level.
  - `aiSuggestionService.test.ts`: an article ref with `content_version: 3, text_sha256: "ab…"` maps to `contentVersion: 3, textSha256: "ab…"`; a legacy one maps to `undefined`.
- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/integration/test_extraction_generation_attempts.py tests/integration/test_proposal_landing.py -q`; `cd "$WT" && npx vitest run frontend/test/services/aiSuggestionService.test.ts` → FAIL.
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run green + gates** (backend and frontend sets).
- [ ] **Step 5: Commit.** `git -C "$WT" add backend frontend && git -C "$WT" commit -m "feat(extraction): snapshot the template version, output schema and article text each proposal came from"`

**Done when:** every new snapshot names its pinned template version, schema hash, article version and text hash; the sanitizer keeps exactly the new keys; the frontend type maps them; gates green.

---

### Task 4.7b: Compact provenance on MCP AI rows

**Layer:** backend · **Migration:** no · **Commit:** `feat(mcp): compact generation provenance on AI rows in get_extractions`

**Goal:** a detailed `get_extractions` row decided by the AI carries `provenance = {model, mode, template_version, schema_sha256, text_sha256, content_version, prompt_version}` (hashes cut to 12 characters); human, consensus and legacy rows carry `null`. Provenance is loaded in the same batch as evidence (no N+1) and pages stay within 32,000 characters.

**Context:** after Tasks 4.7a-2 and 4.5b. `backend/app/models/extraction_workflow.py::ExtractionProposalRecord.generation_snapshot` (JSONB, L117) holds the landed per-proposal snapshot: `model`, `mode_executed`, `prompt_version`, `template_version {id, version}`, `schema_sha256`, `prompt_composition.article_ref.{content_version, text_sha256}` (Tasks 4.7a-1/4.7a-2; older rows lack the new keys). `backend/app/services/extraction_agent_evidence.py` (Task 4.5b: `EvidenceBatch`, `load_evidence_batch`, `evidence_for`). `backend/app/services/extraction_agent_read_service.py`: `_Resolved` (L188: `decider`, `proposal_id`, `decision_id`, …), detailed row build (`McpDetailedRow(...)`, ~L716-735 at `e91417d5`). `backend/app/schemas/mcp_extractions.py::McpDetailedRow` (L65). `_TRUSTED_PATHS["get_extractions"]` in `backend/tests/integration/mcp/test_mcp_result_shape.py` (L92-102). `_item_cost` already measures each row's JSON, so the page packer accounts for the new field.

**Files:**
- Modify: `backend/app/schemas/mcp_extractions.py` (`McpProvenance`; `McpDetailedRow.provenance`)
- Modify: `backend/app/services/extraction_agent_evidence.py` (provenance batch + builder)
- Modify: `backend/app/services/extraction_agent_read_service.py` (pass provenance into the row)
- Modify: `backend/tests/integration/mcp/test_mcp_result_shape.py` (four trusted paths)
- Modify: `docs/how-to/connect-an-ai-agent.md` (one line on `provenance`; `last_reviewed:`)
- Test: `backend/tests/integration/mcp/test_mcp_get_extractions.py`

**Interfaces:**
- `McpProvenance(BaseModel)`: `model: str`, `mode: Literal["fast", "verified"]`, `template_version: int`, `schema_sha256: str`, `text_sha256: str | None`, `content_version: int | None`, `prompt_version: str`. Docstring: server-generated identity of the generation; hashes are the first 12 hex characters. `McpDetailedRow.provenance: McpProvenance | None`.
- `extraction_agent_evidence.py`:
  ```python
  async def load_provenance_batch(db, *, project_id: UUID, proposal_ids: Collection[UUID]) -> dict[UUID, McpProvenance]
  def compact_provenance(snapshot: Mapping[str, Any] | None) -> McpProvenance | None     # pure
  ```
  `load_provenance_batch`: one `select(ExtractionProposalRecord.id, ExtractionProposalRecord.generation_snapshot).join(ExtractionRun, ExtractionRun.id == ExtractionProposalRecord.run_id).where(ExtractionRun.project_id == project_id, ExtractionProposalRecord.id.in_(proposal_ids), ExtractionProposalRecord.source == "ai")` (the project predicate in the WHERE clause; skipped when `proposal_ids` is empty). `compact_provenance` returns `None` unless the snapshot has `model`, `mode_executed in {"fast","verified"}`, `template_version.version` (int), `schema_sha256` and `prompt_version` — a legacy snapshot is `None`, never a partial object; `text_sha256`/`content_version` may be null; hashes `[:12]`.
- Read service: collect `{r.proposal_id for r in resolved rows if r.decider == "ai" and r.proposal_id}` over the page's detailed rows before building them (or over all `details` proposals that are AI), call `load_provenance_batch` once, and set `provenance=prov.get(resolved.proposal_id) if resolved.decider == "ai" else None`. Keep the read service ≤ 800 lines (move any growth into the evidence module).
- `_TRUSTED_PATHS["get_extractions"]` += `"articles[].rows[].provenance.model"`, `".schema_sha256"`, `".text_sha256"`, `".prompt_version"` (full paths). `mode` is a Literal (skipped by the walker); `template_version` and `content_version` are integers.

- [ ] **Step 1: Write the failing tests** (`test_mcp_get_extractions.py`; AI proposal records seeded with a full new-style `generation_snapshot`, a legacy one, plus a human decision):
  - `::test_ai_row_has_compact_provenance` — the AI row's `provenance` equals the expected dict (12-char hashes, `mode == "verified"`, `template_version` int).
  - `::test_human_and_legacy_rows_provenance_null` — the human row and the legacy-snapshot AI row have `provenance is None`.
  - `::test_detailed_page_with_provenance_fits_the_cap` — many AI rows with provenance and evidence: every page `len(compact_json(body)) <= RESULT_CAP` and `next_cursor` continues.
  - A query-count assertion (same mechanism as Task 4.5a-1) that provenance adds exactly one select per call regardless of row count.
  - `test_mcp_result_shape.py` passes with the four new trusted paths (red before the paths are added, since the new string leaves are undeclared).
- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/integration/mcp/test_mcp_get_extractions.py tests/integration/mcp/test_mcp_result_shape.py -q` → FAIL.
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run green + gates** (full suite, lint, fitness incl. `check_scope_guards.py` and `check_file_size.py`, vulture; `bash scripts/docs/check-frontmatter.sh`).
- [ ] **Step 5: Commit.** `git -C "$WT" add backend docs && git -C "$WT" commit -m "feat(mcp): compact generation provenance on AI rows in get_extractions"`

**Done when:** AI rows carry the compact provenance, human/legacy rows null, one batched read, trusted paths exact, size cap holds, gates green.

---

### Task 4.8a: `ai_usage_ledger` table, deny-all posture (migration 0091)

**Layer:** backend · **Migration:** yes (`0091_ai_usage_ledger`) · **Commit:** `feat(db): deny-all AI usage ledger table`

**Goal:** a backend-only table records one row per model call with its tokens, outcome and provider request id, linked to project, owner, run, attempt and batch. Project delete cascades; owner/run/attempt/batch deletes null the link so the usage outlives them. RLS on with a single `deny_all` policy and every privilege revoked from `authenticated` and `anon`. The append-only repository lands with its first caller in Task 4.8b (vulture: no app-unused symbol at a task boundary).

**Context:** after Tasks 4.7b and 4.9a (head `0090_entity_key_unique`). Posture precedent: `backend/alembic/versions/0079_agent_actions.py` (L99-101: `ENABLE ROW LEVEL SECURITY`, `CREATE POLICY "deny_all" ... FOR ALL USING (false)`, `REVOKE ALL ... FROM "authenticated", "anon"`; indexes via `op.create_index`). Model bases: `backend/app/models/base.py` (`Base`, `UUIDMixin`, `TimestampMixin`, `BaseModel` = all three; `__table_args__` ends with `{"schema": "public"}`). Model registry: `backend/app/models/__init__.py` (imports every model so Alembic sees the metadata). FK targets: `public.projects`, `public.profiles` (never `auth.*`, constitution §III), `public.extraction_runs`, `public.extraction_attempts` (`models/extraction_attempt.py`), `public.extraction_batches` (`models/extraction_batch.py`). Deny-all test precedent: `backend/tests/integration/test_llm_connection_rls.py` (`has_table_privilege` per role/privilege L93-104; `_attempt` running SQL under `SET LOCAL ROLE authenticated` with JWT claims, L52-84; the policy-floor probe with a re-grant inside a rolled-back transaction, L143+). `KeyScope` values: `user_byok`, `project_shared`, `global_service` (`services/llm_connection_service.py` L72).

**Files:**
- Create: `backend/alembic/versions/0091_ai_usage_ledger.py`
- Create: `backend/app/models/ai_usage_ledger.py`; Modify: `backend/app/models/__init__.py`
- Modify: `backend/tests/integration/test_migration_roundtrip.py` (head pin + roundtrip)
- Modify: `docs/reference/extraction-hitl-architecture.md` ("Migration head:" → `0091_ai_usage_ledger`; one paragraph on the ledger; `last_reviewed:`)
- Test: new `backend/tests/integration/test_ai_usage_ledger.py`

**Interfaces / schema:**
- Table `public.ai_usage_ledger`: `id uuid PK default gen_random_uuid()`, `created_at timestamptz NOT NULL default now()`, `project_id uuid NOT NULL → projects(id) ON DELETE CASCADE`, `owner_id uuid NULL → profiles(id) ON DELETE SET NULL`, `run_id uuid NULL → extraction_runs(id) ON DELETE SET NULL`, `attempt_id uuid NULL → extraction_attempts(id) ON DELETE SET NULL`, `batch_id uuid NULL → extraction_batches(id) ON DELETE SET NULL`, `provider text NOT NULL`, `model text NOT NULL`, `key_scope text NULL` with CHECK `key_scope IS NULL OR key_scope IN ('user_byok','project_shared','global_service')` (an env-default call before credentials resolve has no scope), `pass_kind text NOT NULL` CHECK `IN ('extract','identify','verify','entailment')`, `prompt_version text NOT NULL`, `prompt_tokens integer NOT NULL` CHECK `>= 0`, `completion_tokens integer NOT NULL` CHECK `>= 0`, `total_tokens integer GENERATED ALWAYS AS (prompt_tokens + completion_tokens) STORED`, `outcome text NOT NULL` CHECK `IN ('ok','failed')`, `request_id text NULL`. No `updated_at` (rows are append-only).
- Indexes: `ix_ai_usage_ledger_project_created (project_id, created_at)`, `ix_ai_usage_ledger_owner_created (owner_id, created_at)`, partial `ix_ai_usage_ledger_run_id (run_id) WHERE run_id IS NOT NULL`, same for `attempt_id` and `batch_id`.
- Posture (in the migration, after the table): `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`; `CREATE POLICY "deny_all" ON "public"."ai_usage_ledger" FOR ALL USING (false)`; `REVOKE ALL ON "public"."ai_usage_ledger" FROM "authenticated", "anon"`. Downgrade: `op.drop_table("ai_usage_ledger", schema="public")` (indexes and policy go with it).
- Model `AiUsageLedger(Base, UUIDMixin)` in `models/ai_usage_ledger.py`, `__tablename__ = "ai_usage_ledger"`: the columns above (`created_at` with `server_default=func.now()`; `total_tokens: Mapped[int] = mapped_column(Integer, Computed("prompt_tokens + completion_tokens", persisted=True))`), short CHECK names (`key_scope`, `pass_kind`, `outcome`, `prompt_tokens_nonneg`, `completion_tokens_nonneg` — the `ck` convention expands them; use the same names in the migration), and every index (partial ones with `postgresql_where`) in `__table_args__`, ending with `{"schema": "public"}`. Register it in `models/__init__.py`.

- [ ] **Step 1: Write the failing tests.**
  - `test_migration_roundtrip.py`: `expected_head = "0091_ai_usage_ledger"`; `test_migration_0091_ai_usage_ledger_roundtrip` — table, the five indexes (`pg_indexes`), the `deny_all` policy (`pg_policies`) and `relrowsecurity` present at head; all gone after downgrade to `0090_entity_key_unique`; back after upgrade; the CHECK names asserted in `pg_constraint`; and after the re-upgrade `has_table_privilege('anon', 'public.ai_usage_ledger', 'SELECT')` and `has_table_privilege('authenticated', 'public.ai_usage_ledger', 'SELECT')` are both false (the REVOKE survives the cycle; Supabase default privileges would otherwise re-grant).
  - New `tests/integration/test_ai_usage_ledger.py::test_ledger_is_deny_all` — parametrized over `anon`/`authenticated` × `SELECT`/`INSERT`/`UPDATE`/`DELETE`: `has_table_privilege` is false; a manager JWT under `SET LOCAL ROLE authenticated` gets "permission denied" on select and insert; with SELECT re-granted inside the rolled-back probe, the policy floor returns 0 rows for a row the backend inserted. `::test_total_tokens_is_generated_and_links_survive` — an ORM insert reads back `total_tokens == prompt + completion`; deleting the run (or nulling via `ON DELETE SET NULL` on the attempt) keeps the row with `run_id IS NULL`; deleting the project removes it. `::test_negative_tokens_refused` — a negative `prompt_tokens` raises `IntegrityError`.
- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/integration/test_migration_roundtrip.py tests/integration/test_ai_usage_ledger.py -q` → FAIL.
- [ ] **Step 3: Implement.** Render: `cd "$WT/backend" && uv run alembic upgrade 0090_entity_key_unique:0091_ai_usage_ledger --sql | grep -iE "ai_usage_ledger|policy|revoke"`. Then `uv run alembic upgrade head && uv run alembic check` (no diff: the generated column and the partial indexes are on the model).
- [ ] **Step 4: Run green + gates.**
  ```bash
  cd "$WT/backend" && uv run pytest tests -q
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh \
    && bash scripts/fitness/check_migration_split.sh \
    && PATH="$WT/backend/.venv/bin:$PATH" python3 scripts/fitness/check_rls_coverage.py
  cd "$WT/backend" && uv run alembic check && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  ```
  Expected: PASS; `check_rls_coverage.py` sees the new table with RLS on.
- [ ] **Step 5: Commit.** `git -C "$WT" add backend docs && (cd "$WT" && bash scripts/docs/check-frontmatter.sh) && git -C "$WT" commit -m "feat(db): deny-all AI usage ledger table"`

**Done when:** the table exists with its checks, generated total, indexes and deny-all posture, declared on the model; roundtrip and deny-all tests pass; `alembic check` clean; gates green.

---

### Task 4.8b: Metered model calls write durable ledger rows; one `results.tokens` shape

**Layer:** backend · **Migration:** no · **Commit:** `feat(extraction): meter every model call into the usage ledger`

**Goal:** every model call the extraction pipeline makes — extract, identify, verify, entailment — writes one `ai_usage_ledger` row in its own short transaction, so a run rollback cannot erase it; a call that raises records `outcome='failed'` with whatever tokens are known (or 0) and the exception still propagates. Run results carry one `tokens = {prompt, completion, total}` shape that equals the sum of the run's `ok` ledger rows.

**Context:** after Task 4.8a. `backend/app/llm/extractor.py`: `StructuredCall` protocol (L67), `LlmUsage` (with `request_ids`, Task 4.7a-1). `backend/app/services/ai_extraction/_pipeline.py::Pipeline.__init__` (L58-102: `self.llm = llm`, `self.engine` rebound by `adopt_frozen_engine` L111-139, `self.credentials` re-keyed there, `self.attempt_id`, `self.user_id`); every model call goes through `p.llm` (section extract in `_model_calls.extract_fields`, identify in `_sections._identify_entries`, verify via `run_verify_pass(extract=p.llm)`, entailment via `run_entailment_gate(extract=p.llm)`). `backend/app/services/ai_extraction/service.py::AiExtraction.__init__` (L~85-119) builds the Pipeline; runs are opened at ~L180, ~L305 and ~L423 (`open_run_for_write` / `db.get`). Worker wiring: `backend/app/worker/tasks/extraction_tasks.py` (`async with worker_session() as session` → `AiExtraction(db=session, ...)`; `worker_session` builds a per-task NullPool engine, `backend/app/worker/_session.py`). Result writers: `service.py` single-section `complete_run(results={... "tokens_prompt", "tokens_completion", "tokens_total" ...})` (~L239-247), batch `sections.append({... "tokens_used" ...})` (~L363-371) and `"total_tokens_used"` (~L385); `backend/app/services/ai_extraction/_batch.py` `"tokens_used"` (~L126) and `"total_tokens_used"` (~L142), `_section_with_memory` returns `outcome.usage.total_tokens` (~L208). API response models (`backend/app/schemas/extraction.py` L180-209: `tokens_used`, `tokens_prompt`, `tokens_total`, `total_tokens_used`) are unchanged. `ExtractionBatchItem.attempt_id` / `.batch_id` (`backend/app/models/extraction_batch.py` L54-58). `KeyScope` (`services/llm_connection_service.py`).

**Files:**
- Create: `backend/app/repositories/ai_usage_ledger_repository.py` (append only)
- Create: `backend/app/services/ai_usage_metering.py` (`UsageContext`, `UsageSink` protocol, `LedgerSink`, `metered`)
- Modify: `backend/app/core/factories.py` (`create_ledger_session_factory`)
- Modify: `backend/app/worker/tasks/extraction_tasks.py` (composition root: builds the sink and passes it)
- Modify: `backend/app/services/ai_extraction/_pipeline.py` (wrap `llm`; `current_run`; context callable)
- Modify: `backend/app/services/ai_extraction/service.py` (required `usage_sink`; set `p.current_run`; `results.tokens`), `_batch.py` (`results.tokens`, usage objects), `_sections.py` (section usage includes entailment)
- Create: `backend/tests/fakes/usage_sink.py` (`RecordingUsageSink` — test-only, so vulture never sees an app-unused class)
- Modify: `backend/tests/integration/helpers/ai_extraction.py` and `backend/tests/integration/test_run_engine_freeze.py` (the three test constructions of `AiExtraction` pass `usage_sink=RecordingUsageSink()`)
- Test: `backend/tests/integration/test_ai_usage_ledger.py` (extend), new `backend/tests/unit/test_ai_usage_metering.py`, `backend/tests/unit/test_run_section_extraction_task.py` (extend), `backend/tests/unit/test_parser_factory.py` (extend; it already covers `app/core/factories.py`)

**Interfaces:**
- `repositories/ai_usage_ledger_repository.py`: `class AiUsageLedgerRepository: def __init__(self, db); async def append(self, **values) -> None` (`db.add(AiUsageLedger(**values))`; `flush()`; never commits, never updates or deletes). No other method.
- `core/factories.py` (support; imports SQLAlchemy only — `app.core` may not import `app.services`, so the factory builds the session factory and the composition root wraps it):
  ```python
  def create_ledger_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
      """A second session factory on the caller's engine: ledger rows commit independently of the run transaction."""
      return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False, autoflush=False)
  ```
- `services/ai_usage_metering.py`:
  ```python
  @dataclass(frozen=True)
  class UsageContext:
      project_id: UUID | None; owner_id: UUID | None; run_id: UUID | None; attempt_id: UUID | None
      provider: str; model: str; key_scope: str | None
  class UsageSink(Protocol):
      async def record(self, ctx: UsageContext, *, pass_kind: PassKind, prompt_version: str,
                       usage: LlmUsage, outcome: Literal["ok", "failed"]) -> None: ...
  class LedgerSink:  # implements UsageSink
      def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None
  def metered(llm: StructuredCall, sink: UsageSink, context: Callable[[], UsageContext]) -> StructuredCall
  ```
  `metered` returns an async callable with the `StructuredCall` signature: `kind = PASS_KIND_BY_PROMPT[prompt_name]` (the Task 4.7a-1 map in `app.llm.pass_kinds`; no second map); calls `llm(...)`; on success records `outcome="ok"` with the returned usage, then returns it unchanged; on exception records `outcome="failed"` with the usage pydantic-ai attached to the exception if any (read defensively; else zero) and re-raises. `context()` is called per model call, never captured at wrap time.
- **A ledger write failure is surfaced, never swallowed.** EV-21 requires one durable row per call and states no "metering never fails a call" exemption, so `LedgerSink.record` catches nothing. On the success path a sink error propagates out of the metered call (the attempt fails through its normal failure path, which already logs and records the error; the model output is not landed without its ledger row). On the failure path the model's exception stays primary: `metered` catches the sink error, logs `usage_ledger_write_failed` at **error** level with `pass_kind`, `run_id`, `attempt_id` and `error_type`, attaches it with `exc.add_note(...)`, and re-raises the model's exception.
- `LedgerSink.record`: when `ctx.project_id is None` (no run is open yet), logs `usage_ledger_skipped` at **warning** level with `pass_kind` and `attempt_id` and returns (the table's `project_id` is NOT NULL). Otherwise opens `async with self._session_factory() as s, s.begin():`, resolves `batch_id` once per `attempt_id` (`select(ExtractionBatchItem.batch_id).where(ExtractionBatchItem.attempt_id == ctx.attempt_id)`, cached on the sink), and `AiUsageLedgerRepository(s).append(project_id=..., owner_id=..., run_id=..., attempt_id=..., batch_id=..., provider=..., model=..., key_scope=..., pass_kind=pass_kind, prompt_version=..., prompt_tokens=usage.prompt_tokens, completion_tokens=usage.completion_tokens, outcome=..., request_id=usage.request_ids[-1] if usage.request_ids else None)`. One short transaction per call on its own connection, so concurrent entailment calls never share an asyncpg connection (pool pressure is the known cost; buffering is a later optimisation). Visibility: the worker session (`owns_transactions=True`) commits before every external call, so the run and attempt rows the ledger row references are committed when the sink writes.
- `Pipeline.__init__(..., usage_sink: UsageSink)`: `self.current_run: ExtractionRun | None = None`; `self.llm = metered(llm, usage_sink, self._usage_context)` (always wrapped). `_usage_context()` reads at call time: `current_run.project_id` / `.id` (or `None`), `UUID(self.user_id)`, `self.attempt_id`, `self.engine.provider` / `.model`, `self.credentials.key_scope.value if self.credentials.key_scope else None`.
- `AiExtraction.__init__(..., usage_sink: UsageSink)` — a **required** keyword, no default (constitution §II: dependencies are injected, never built inside the service; a required argument makes a caller that forgets metering a `TypeError`, not a run with no ledger rows). The service never touches `db.bind`. Set `self._p.current_run = run` wherever a run is opened (the three sites, ~L180, ~L305, ~L423).
- Worker composition root (`extraction_tasks.py`, the only production caller): `usage_sink=LedgerSink(create_ledger_session_factory(session.bind))` — `session.bind` is the per-task NullPool engine `worker_session()` built, so the ledger session opens its own connection on that engine and disposes with it.
- Tests: `RecordingUsageSink` (in `tests/fakes/usage_sink.py`) appends each `record(...)` call to a list and writes nothing, so existing tests that build `AiExtraction` on `db_session` never write ledger rows on the shared test connection.
- Results: `_sections._verify_and_land` returns `usage + entailment_usage` so section usage covers every call. Single-section `complete_run` writes `"tokens": {"prompt", "completion", "total"}` instead of the three `tokens_*` keys; batch paths accumulate an `LlmUsage` (not an int), write `"tokens": {...}` instead of `"total_tokens_used"`, and per-section entries carry `"tokens": {...}` instead of `"tokens_used"`. Response models are filled from the same usage (unchanged API); `_section_with_memory` returns the `LlmUsage`. Log fields keep `tokens_total` (logs are not result keys).

- [ ] **Step 1: Write the failing tests.**
  - `tests/unit/test_ai_usage_metering.py` (fake `llm`, `RecordingUsageSink` or a raising stub sink): `metered` records one `ok` with the returned usage and returns it unchanged; re-raises the wrapped exception after one `failed` record (tokens 0 when the exception carries no usage); an unknown prompt name raises `KeyError` before the call; `context` is called per call (mutate the context source between two calls and see both values recorded); **ok-path sink failure** — a sink raising `RuntimeError("sink down")` makes the metered call raise that error; **failed-path sink failure** — model raises `ValueError`, sink raises `RuntimeError`: the `ValueError` propagates, carries a note naming the sink error, and `structlog.testing.capture_logs()` holds one `usage_ledger_write_failed` entry at `log_level == "error"`.
  - `tests/unit/test_parser_factory.py::test_ledger_session_factory_binds_the_engine` — `create_ledger_session_factory(engine)` yields sessions bound to that engine with `expire_on_commit=False`.
  - `tests/unit/test_run_section_extraction_task.py::test_worker_injects_a_ledger_sink` — with `AiExtraction` patched in the task module to capture kwargs (as the file's existing tests patch collaborators), `usage_sink` is a `LedgerSink` whose session factory is bound to the task session's engine.
  - `tests/integration/test_ai_usage_ledger.py` (extend), two groups:
    - **Per-call accounting** (service on `db_session`, recorded fake with per-prompt `usages` carrying `request_ids`, `RecordingUsageSink` injected): `test_single_section_verified_run_records_one_entry_per_call` — entries for extract, verify and each entailment call with the right `pass_kind`, `prompt_version` and `request_ids[-1]`; `sum` over `ok` entries equals `results["tokens"]` (prompt, completion, total); no `tokens_prompt`/`tokens_total` key is written. `test_multi_section_run_entries_sum_to_reported_usage` — a batch run, including an entry group's single identify call; sums equal `results["tokens"]`; no `total_tokens_used` or `tokens_used` key.
    - **Durability** (`LedgerSink(create_ledger_session_factory(_engine))` — its own connections, so the parents it references must be committed): fixture `committed_ledger_parents` opens its own session on `_engine`, inserts and **commits** a run on the seeded project/article/template, an attempt, and an `extraction_batches` row with one batch item linked to the attempt; it yields their ids and, in its finalizer, deletes `ai_usage_ledger` rows `WHERE project_id = :seed_project AND (attempt_id = :attempt_id OR run_id = :run_id)` and then the batch item, batch, attempt and run it created (tolerating a run the test already deleted), and commits. Tests drive `metered(fake_llm, sink, ctx)` with `ctx` pointing at those ids:
      - `test_rows_survive_the_outer_rollback` — inside a separate session's open transaction, an `extract` call succeeds and a `verify` call raises; the session rolls back; the ledger holds one `ok` row (with its `request_id`) and one `failed` row with tokens 0.
      - `test_batch_id_resolved_from_attempt` — both rows carry the fixture's `batch_id`; the lookup runs once (statement count via `before_cursor_execute`).
      - `test_run_delete_nulls_run_id` — delete and commit the fixture's run: the rows remain with `run_id IS NULL`.
      - `test_sink_write_failure_surfaces` — `ctx.project_id` = a random UUID (FK violation): a successful model call raises `IntegrityError` out of `metered`; no row is written.
      - `test_missing_project_is_skipped_and_logged` — `ctx.project_id = None`: no row, the call returns, and `capture_logs()` holds one `usage_ledger_skipped` warning.
- [ ] **Step 2: Run red.** `cd "$WT/backend" && uv run pytest tests/unit/test_ai_usage_metering.py tests/unit/test_parser_factory.py tests/unit/test_run_section_extraction_task.py tests/integration/test_ai_usage_ledger.py -q` → FAIL.
- [ ] **Step 3: Implement** per Interfaces; update tests that asserted the old result keys (`grep -rn "tokens_used\|total_tokens_used\|tokens_prompt\|tokens_total" backend/tests`) and every `AiExtraction(` construction in tests (`grep -rn "AiExtraction(" backend/tests`).
- [ ] **Step 4: Run green + gates** (full suite, lint, fitness incl. `check_layered_arch.py` — the repository imports models only; the metering service imports the repository, `app.llm` and models; `app.core.factories` imports no service — vulture).
- [ ] **Step 5: Commit.** `git -C "$WT" add backend && git -C "$WT" commit -m "feat(extraction): meter every model call into the usage ledger"`

**Done when:** the worker injects the ledger sink built through `app/core/factories.py`, each model call writes one durable row (ok or failed), rows survive a rolled-back transaction and a deleted run, `batch_id` resolves, a sink write failure is surfaced (raised, or logged at error on an already-failing call) and tested, results carry one `tokens` shape equal to the per-call sum, gates green.

---

### Task 4.2: Docling bake-off and ruling — **HUMAN GATE: corpus download**

**Layer:** backend + docs · **Migration:** no · **Commits:** (A) `feat(parsing): bake-off metrics for column order, page chrome, invisible characters and resources`; (B) `docs(parsing): PyMuPDF vs Docling bake-off results and ADR 0011 Amendment`; (C, only on ruling a or b) `feat(parsing): parser selection per the bake-off ruling`

**Goal:** decide, from measured data, whether ingest keeps PyMuPDF (status quo, option c) or moves to Docling (a or b). The status quo holds until the maintainer rules on the results; no ruling exists today.

**Context:** runs last, after every other task (the improved PyMuPDF from Tasks 4.1a/4.1b is what is compared). Harness: `backend/scripts/parsing_bakeoff/` (`README.md`: manifest schema, `jats_gold` builds gold from PMC JATS XML, run command `PYTHONPATH=scripts uv run python -m parsing_bakeoff.run --manifest <m> --parsers pymupdf,docling --out <dir>`; `scoring.py`: `DocScore` L144, `ParserReport` L162, `aggregate` L181; `run.py`: `score_doc` L34, `run_bakeoff` L49, `format_markdown` L80, `write_outputs` L100; unit tests `backend/tests/unit/test_bakeoff_*.py` import it via `pythonpath = ["scripts"]`). Today's metrics are table/bbox/section/reference only. Docling is pinned `docling==2.104.0` in `backend/pyproject.toml` with OCR disabled in `DoclingParser`. Worker image: `backend/Dockerfile` (Railway `builder = "DOCKERFILE"`). Prior pilot: `docs/superpowers/quality-runs/2026-06-19-parsing-bakeoff-pilot.md`. ADR: `docs/adr/0011-structured-pdf-parsing-at-ingest.md`. Selection code for part C: `backend/app/worker/tasks/parsing_tasks.py::_run_parse` (L38; the `auto` branch L61-81), `backend/app/core/factories.py::create_document_parser` (L36), and `backend/app/services/extraction_prompt_input.py::build_prompt_input`, which constructs `PymupdfParser()` itself for the on-demand parse.

**Part A — metrics (no gate; build it first in this task):**
- Files: Modify `backend/scripts/parsing_bakeoff/scoring.py`, `run.py`; Test `backend/tests/unit/test_bakeoff_scoring.py`, `test_bakeoff_run.py`.
- Add to `DocScore` and the report/CSV/markdown: `column_inversions` (count of adjacent body-block pairs whose order contradicts the gold section text order — define it as the number of inversions of gold paragraph indexes in the parser's reading order, using the gold JATS paragraph sequence matched by normalized text prefix), `chrome_leakage` (non-`header`/`footer` blocks whose digit-masked text repeats on ≥ 3 pages in the top/bottom 8% band — the 4.1a rule, measured over the parser's own blocks), `zw_chars` (count of U+200B–U+200D, U+2060, U+FEFF, U+00AD in stored block text), `parse_seconds` per doc with `p95_parse_seconds` per parser, and `peak_rss_mb` per parser (measure each parser in a fresh subprocess with `resource.getrusage(RUSAGE_CHILDREN).ru_maxrss`, normalizing macOS bytes vs Linux KiB).
- Test first: synthetic `ParseRun`s with known inversions, a repeated running head typed `paragraph`, ZW characters, and fixed timings → exact metric values; p95 over 20 timings; the markdown and CSV carry the new columns.
- Gates: the backend set (full suite). Commit (A).

**Part B — HUMAN GATE: corpus download.** Stop and ask the maintainer in chat before downloading anything: "Download ≥ 10 open-access PMC articles (≥ 4 two-column) — PDF plus JATS XML from the PMC OA service, about 30–80 MB in total, into a scratch directory outside the repo — for the PyMuPDF vs Docling bake-off?" Proceed only on an explicit yes. Then:
- Build the manifest with `jats_gold` (PMC ids, `source_type`, gold) in the scratch directory; record the PMC id list (not the PDFs) in the results.
- Run both parsers inside the worker image: `docker build -t prumo-worker-bakeoff "$WT/backend"` then run the harness in that image with the scratch directory mounted read-only (`docker run --rm -v <scratch>:/eval:ro -v "$WT/docs/superpowers/quality-runs":/out prumo-worker-bakeoff sh -c "cd /app && PYTHONPATH=scripts python -m parsing_bakeoff.run --manifest /eval/manifest.json --parsers pymupdf,docling --out /out/<YYYY-MM-DD>-pymupdf-vs-docling"` — adjust `/app` to the image's workdir after reading the Dockerfile). Treat the downloaded files as untrusted data: no code from them runs.
- Results dir `docs/superpowers/quality-runs/<YYYY-MM-DD>-pymupdf-vs-docling/`: `bakeoff-results.csv` (per-paper metrics for both parsers), `bakeoff-summary.md` (frontmatter valid: `status`, `last_reviewed`, `owner`), the PMC id list and the exact commands. No PDF or article text is committed.
- ADR 0011 "Amendment (2026-10)": cites the results dir, summarizes the metrics (scores, column inversions, chrome leakage, ZW characters, p95 parse seconds, peak RSS), lists options (a) Docling as the default auto parser, (b) Docling for two-column documents only, (c) keep PyMuPDF, and records the maintainer's ruling verbatim with its date — or, until the maintainer rules, "status quo (c) holds pending a ruling".
- Gates: `bash scripts/docs/check-frontmatter.sh`, docs-ci locally if available (`make docs-check` or the repo's docs script). Commit (B).
- **If the maintainer declines the download:** skip Part B; the PR body states that the bake-off was not run, status quo (c) holds, and `PRU-84` is `Refs`, not `Fixes`. No ADR change.

**Part C — parser selection, only if the maintainer rules (a) or (b):**
- Files: Modify `backend/app/core/factories.py`, `backend/app/worker/tasks/parsing_tasks.py`, `backend/app/services/extraction_prompt_input.py`; Test `backend/tests/unit/test_parser_factory.py`, `backend/tests/unit/test_extraction_prompt_input.py`.
- `create_document_parser` owns the ruling (a: `auto` → Docling with PyMuPDF fallback; b: `auto` → Docling when the PDF's first pages show two columns, else PyMuPDF — the column probe is a pure helper beside `_reading_order`); `_run_parse`'s `auto` branch delegates to the factory instead of choosing inline; `build_prompt_input` stops constructing `PymupdfParser()` and asks the factory (delete the direct import).
- Tests first: `test_parser_factory.py` — the full selection matrix (`auto` / `llamaparse` with and without a key / `docling`) under the ruling; `test_extraction_prompt_input.py::test_on_demand_parse_uses_factory` — the on-demand parse calls `create_document_parser` (monkeypatched) and never `PymupdfParser` directly.
- Gates: backend set (full suite). Commit (C). On ruling (c), Part C does not exist.

**Done when:** the metrics are in the harness with tests (A); with the maintainer's go, the results dir holds per-paper metrics for ≥ 10 PMC papers (≥ 4 two-column) and the ADR 0011 Amendment cites it and records the ruling or the pending status quo (B); parser selection changes only on ruling a/b (C); gates green.

---

## Slice end (after Task 4.2, before the PR opens)

- [ ] **Re-check migration numbers against `origin/dev`.** `git -C "$WT" fetch origin dev`, then `git -C "$WT" ls-tree -r --name-only origin/dev backend/alembic/versions | grep -E '/(0089|009[0-1])_'`. No output → nothing to do. Any output means `dev` took a number: merge `origin/dev` into the branch, then renumber this branch's three migrations in order to the next free numbers, renaming together each file, `revision`, `down_revision` (the first one's = `dev`'s head), docstring revision lines, `expected_head`, the roundtrip tests' names and downgrade targets, the heal's `who` string in 0090 (`migration:<rev>`), and the "Migration head:" line in `docs/reference/extraction-hitl-architecture.md`; re-run `cd "$WT/backend" && uv run alembic upgrade head && uv run pytest tests/integration/test_migration_roundtrip.py -q` → PASS; commit `fix(db): renumber the evidence migrations after dev`.
- [ ] **Full gates and diff coverage.**
  ```bash
  cd "$WT/backend" && uv run pytest tests/ --cov=app --cov-report=xml -q \
    && uv run diff-cover coverage.xml --compare-branch=origin/dev --fail-under=80
  cd "$WT" && make lint-backend && PATH="$WT/backend/.venv/bin:$PATH" bash scripts/fitness/run_all.sh \
    && cd "$WT/backend" && uv run alembic check \
    && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
  cd "$WT" && npm run generate:api-types && git -C "$WT" status --short frontend/types/api \
    && npm run test:run && npm run typecheck && npm run lint && npx knip && npx knip --production
  cd "$WT" && make quality-scan
  ```
  Expected: full suite PASS; diff coverage ≥ 80% (a file under it gets its missing direct test in a `test(<area>): ...` commit); every gate green; no API type diff.
- [ ] **Design review** (`design-review` skill) on the evidence row states (current, stale, ungrounded) in the evidence list, review popover and proposal card, and on the rename dialog's 409 message — desktop and 375 px, light and dark; fixes go in a `fix(<area>): ...` commit.
- [ ] **PR.** One PR to `dev`, title `feat(extraction): verifiable evidence locators, typed absences, provenance and a usage ledger`. Body: a behavior summary per area (parser chrome/normalization/column order; content version and re-anchoring; block-ref grounding; REST/UI grounded and stale; MCP locator and provenance; `evidence_repair`; typed absent reasons and `Unclear` scales; snapshot provenance and `passes_detail`; usage ledger; entry identity uniqueness; bake-off status) with the tests that pin each; the tracker lines from Global Constraints; the **Prompt change**, **Data notes** and **Post-merge maintainer steps** sections. Describe behavior and tests only; cite no local-only document.
- [ ] **Post-merge maintainer steps (recorded in the PR; not build tasks; each needs the maintainer's recorded go):**
  1. Staging exit: reparse a two-column article (no running heads, no ZWSP in the reader); run an extraction and check every `get_extractions` locator matches `^p\d+·b\d+$` or is null with `grounded=false` and no page exceeds the page count, with the grounded share before/after from Logfire; reparse again (evidence re-anchored or stale in UI and MCP); a PROBAST+AI run gives NI values and `not_applicable` markers; a proposal snapshot shows every new provenance field and ledger rows sum to per-call usage; re-keying onto a sibling's key shows the 409 inline.
  2. `evidence_repair llm-pages` and `stamp-versions` dry runs, read-only against production; per-project counts recorded.
  3. `--apply` for those two commands only after the maintainer's go on the counts.
  4. The reparse backfill (`evidence_repair reparse --project <id> --as-user <manager profile id> --apply`) for the projects and window the maintainer names — after this PR is deployed (it contains 4.1b, 4.3 and 4.5c, and 4.2 Part C when the ruling is a or b).
  5. The 0090 heal report printed on deploy is recorded (the heal rule is accepted; no further approval).
  6. After the backfill, re-measure the article-text outline filter (`services/article_text_block_read_service.py`) on the fixture set; if it removes nothing beyond the new chrome typing, delete it in a sibling `refactor(mcp): ...` PR.
