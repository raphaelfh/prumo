---
status: in_progress
last_reviewed: 2026-06-21
owner: '@raphaelfh'
---

# Parsing Fix (LlamaParse default, PHI-free) + Reader/Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make article PDF parse-to-markdown actually work end-to-end —
default non-opted-in projects to the LlamaParse cloud parser when a
`llama_cloud` key exists (Docling as a *working* fallback), render the
parsed markdown in the reader pane, and add a MAIN↔supplement document
switcher. Remove all PHI gating/branching (we do not handle PHI) and
reconcile the docs.

**Architecture:** Parser selection moves from "opt-in to llamaparse, else
docling" to "auto: llamaparse-when-key, else docling" resolved in the
worker task; the Docling fallback gets its missing system libs so it no
longer crashes on import. A new typed `GET /articles/{id}/files` endpoint
feeds a shared frontend hook that lists the article's files, drives a
switcher, and pipes the selected file's `article_text_blocks` into the
already-built reader pane.

**Tech Stack:** FastAPI + SQLAlchemy async + Celery (backend), React 19 +
TanStack Query + Zustand + the in-house `@prumo/pdf-viewer` (frontend),
Docling / LlamaParse (LlamaCloud) parsers, Docker on Railway.

## Global Constraints

- English only for code, comments, docs, copy keys.
- Backend layering `api → services → repositories → models` (CI-enforced).
- `ApiResponse` envelope; errors via `error.message`; new endpoints get a
  typed Pydantic response model; every project-scoped endpoint checks
  project membership (`ensure_project_member`).
- Frontend data access through the typed client `frontend/integrations/api/client.ts`;
  no new `supabase.from(...)` *table* reads (storage signing is allowed);
  TanStack keys from the key factories.
- No `try/finally`/`throw` in React component/hook bodies (React Compiler
  `panicThreshold: all_errors`); IO lives in `frontend/services/*`.
- SQLAlchemy model change ⇒ Alembic migration. (This plan adds NO columns.)
- After any endpoint/schema change: `npm run generate:api-types` + commit.

---

## Root cause (verified, prod)

`article_files` MAIN of article "teste 2" = `parse_failed`,
`extraction_error = "libxcb.so.1: cannot open shared object file"`,
0 `article_text_blocks`. Worker logs: Docling → `docling_ibm_models`
TableFormer → `import cv2` (opencv full wheel) → `libxcb.so.1` missing on
`python:3.12-slim`. The valid default `llama_cloud` key
(`last_used_at = NULL`) was never used because project "sfa" never opted
into `parsing.type = "llamaparse"` (settings has no `parsing` key). PHI is
referenced only in docs, never in `backend/app/`.

---

## Task 1: Parser selection — default to "auto" (LlamaParse-when-key)

**Files:**
- Modify: `backend/app/services/parser_settings_service.py:14-36`
- Modify: `backend/app/worker/tasks/parsing_tasks.py:42-61`
- Modify: `backend/app/schemas/parser_settings.py`
- Modify: `backend/app/core/config.py:96-102` (comment only)
- Test: `backend/tests/integration/test_parser_settings_service.py` (exists? else create)
- Test: `backend/tests/integration/test_parse_article_file_task.py` (selection assertions)
- Test: `backend/tests/unit/test_create_document_parser.py` (unchanged behaviour; factory still concrete)

**Interfaces:**
- Produces: `ParserSettingsService.get_for_project(project_id) -> "auto" | "llamaparse" | "docling"` (default `"auto"`; legacy `"standard"` normalises to `"docling"`).
- Produces (worker): resolves `auto` → `llamaparse` iff a `llama_cloud` key resolves, else `docling`; passes the resolved key to `create_document_parser`.

- [ ] **Step 1:** Write failing test `test_get_for_project_defaults_to_auto` (absent `parsing` → `"auto"`) and `test_standard_normalises_to_docling`.
- [ ] **Step 2:** Run → fails.
- [ ] **Step 3:** In `parser_settings_service.py`: `_VALID_TYPES = ("auto", "llamaparse", "docling")`, `_DEFAULT_TYPE = "auto"`, and in `get_for_project` map legacy `"standard"` → `"docling"` before the membership check return.
- [ ] **Step 4:** Run → passes.
- [ ] **Step 5:** Write failing worker test: with `parsing` absent + a stubbed `llama_cloud` key present, `_run_parse` builds a `LlamaParseParser`; with no key, builds `DoclingParser`; with explicit `"docling"`, never looks up the key.
- [ ] **Step 6:** Run → fails.
- [ ] **Step 7:** Rewrite `parsing_tasks._body` selection block:

```python
pref = await ParserSettingsService(session).get_for_project(UUID(project_id))
llama_key: str | None = None
if pref in ("auto", "llamaparse"):
    llama_key = await APIKeyService(session, user_id).get_key_for_provider("llama_cloud")
if pref == "docling":
    backend = "docling"
elif pref == "llamaparse":
    backend = "llamaparse"
else:  # auto (default): prefer cloud when a key is available
    backend = "llamaparse" if llama_key else "docling"
```

- [ ] **Step 8:** `schemas/parser_settings.py`: `ParserType = Literal["auto", "standard", "llamaparse", "docling"]` (accept legacy `"standard"` on the PUT for back-compat; service normalises).
- [ ] **Step 9:** `config.py:96-102`: update comment to "Default resolution is `auto` (LlamaParse cloud when a key is configured, else self-hosted Docling); resolved per-project in the worker task." Keep `PARSER_BACKEND = "docling"` as the factory's last-resort fallback.
- [ ] **Step 10:** Run targeted tests → pass. Commit.

## Task 2: Docling fallback — install missing system libs

**Files:**
- Modify: `backend/Dockerfile` (runtime stage, after `WORKDIR /app`, before `COPY`).

- [ ] **Step 1:** Add to the **runtime** stage:

```dockerfile
# Docling's self-hosted fallback pulls opencv (via rapidocr) which dlopens
# libGL/libxcb/glib at import. The slim base ships none of these, so the
# fallback crashes on `import cv2` (libxcb.so.1) without them.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libgl1 libglib2.0-0 libxcb1 libxext6 libsm6 libxrender1 \
    && rm -rf /var/lib/apt/lists/*
```

- [ ] **Step 2:** `docker build backend/ -t prumo-parse-check` (or note: verified at deploy) and confirm `python -c "import cv2"` succeeds. Commit.

## Task 3: Backend `GET /articles/{id}/files`

**Files:**
- Modify: `backend/app/api/v1/endpoints/article_files.py` (add GET)
- Modify/Create: `backend/app/services/article_text_block_read_service.py` or a small `article_file_read_service.py` (`list_files_for_article`)
- Modify: `backend/app/schemas/article.py` (`ArticleFileListItem` response model)
- Test: `backend/tests/integration/test_article_files_list.py`

**Interfaces:**
- Produces: `GET /api/v1/articles/{article_id}/files` → `ApiResponse[list[ArticleFileListItem]]` with `{id, file_role, file_type, original_filename, extraction_status, bytes}` ordered MAIN-first then `created_at`. Gated by `get_article_project_id` + `ensure_project_member`.

- [ ] **Step 1:** Write failing integration test: member lists MAIN+supplement; non-member → 403; unknown article → 404.
- [ ] **Step 2:** Run → fails.
- [ ] **Step 3:** Add `ArticleFileListItem` schema; add read-service `list_files_for_article(db, article_id) -> list[Row]`; add the GET handler mirroring the existing reparse gate pattern.
- [ ] **Step 4:** Run → passes.
- [ ] **Step 5:** `npm run generate:api-types`; commit backend + regenerated `frontend/types/api/*`.

## Task 4: Frontend — documents service + shared reader hook

**Files:**
- Create: `frontend/services/articleFilesService.ts` (`listArticleFiles(articleId)`)
- Create: `frontend/hooks/extraction/useArticleDocuments.ts`
- Modify: `frontend/lib/query-keys/articles.ts` (add `files(articleId)`)
- Modify: `frontend/pdf-viewer/adapters/articleFileSource.ts` (accept an explicit `storageKey`)
- Test: `frontend/test/hooks/useArticleDocuments.test.tsx`

**Interfaces:**
- Produces: `useArticleDocuments(articleId)` → `{ files, selectedFileId, setSelectedFileId, selectedFile, source, readerBlocks, readerLoading }`. Default `selectedFileId` = the MAIN file. `readerBlocks` from `useArticleTextBlocks(selectedFileId)` mapped to `ReaderTextBlock[]`. Polls the files list + blocks while the selected file's `extraction_status === 'pending'` (`refetchInterval`).
- Produces: `articleFileSource(storageKey, opts)` builds the lazy signed-URL source from a known `storage_key` (no `supabase.from` table read; storage signing only).

- [ ] **Step 1:** Failing test: hook returns MAIN selected by default; switching `setSelectedFileId` swaps `source` + `readerBlocks`; while pending, `refetchInterval` is set.
- [ ] **Step 2:** Run (`npm run test:run -- useArticleDocuments`) → fails.
- [ ] **Step 3:** Implement service (typed client), key factory entry, hook, adapter generalization. Map API `extraction_status`/`file_role` and block `block_type`/`pageNumber` to the reader shape.
- [ ] **Step 4:** Run → passes. Commit.

## Task 5: Frontend — switcher + wire both panels (clear-on-switch)

**Files:**
- Create: `frontend/components/extraction/DocumentSwitcher.tsx`
- Modify: `frontend/components/extraction/ExtractionPDFPanel.tsx`
- Modify: `frontend/pages/QualityAssessmentFullScreen.tsx` (pdfPanel ~643)
- Modify: `frontend/lib/copy/` (switcher copy keys)
- Test: `frontend/test/components/DocumentSwitcher.test.tsx`

**Interfaces:**
- Consumes: `useArticleDocuments`, `FILE_ROLE_LABELS` (`frontend/lib/file-constants.ts`).
- Produces: a header dropdown listing files (role label + filename + a per-file parsed/pending/failed dot); selecting calls `setSelectedFileId` and clears viewer citations/search/current page (MF-8) via the shared store.

- [ ] **Step 1:** Failing test: renders one option per file, default MAIN, `onSelect` fires with the file id; failed file shows a re-parse affordance.
- [ ] **Step 2:** Run → fails.
- [ ] **Step 3:** Build `DocumentSwitcher`; in `ExtractionPDFPanel` call `useArticleDocuments(articleId)`, render the switcher above `PrumoPdfViewer`, pass `source`, `readerBlocks`, `readerLoading`; on switch reset the shared store (citations/search/page). Repeat for `QualityAssessmentFullScreen`.
- [ ] **Step 4:** Run → passes.
- [ ] **Step 5:** Visual verify via `/design-review` on the run/extraction route (render → screenshot → compare → fix). Commit.

## Task 6: Docs — remove PHI, reconcile parser default

**Files (PHI / parser-default references):**
- `docs/adr/0011-structured-pdf-parsing-at-ingest.md` (default = LlamaParse-when-key; Docling fallback; delete PHI/fail-closed gating language)
- `docs/adr/0013-*` (if it references the PHI split-default)
- `docs/superpowers/specs/2026-06-20-parse-to-markdown-end-to-end-design.md`
- `docs/superpowers/plans/2026-06-19-structured-pdf-parsing-at-ingest.md`
- `docs/superpowers/plans/2026-06-19-grounded-extraction-and-hitl-highlight.md`
- `docs/superpowers/quality-runs/2026-06-19-parsing-bakeoff-pilot.md`
- `llms.txt` (if parser policy is summarised)

- [ ] **Step 1:** Grep `\bPHI\b|fail-closed|fail_closed|protected health` across `docs/` + `llms.txt`; for each hit, rewrite to the PHI-free policy ("LlamaParse cloud is the default when a `llama_cloud` key is configured; the self-hosted Docling parser is the no-key fallback; no PHI gate").
- [ ] **Step 2:** Update ADR-0011 status/decision section; bump `last_reviewed`.
- [ ] **Step 3:** Add this plan to `.markdownlintignore` (single-source rule). Commit.

## Task 7: Verify + recover data (offer)

- [ ] `make lint-backend`, `make test-backend` (parsing slices), `npm run test:run`, `npm run lint`, `tsc --noEmit`.
- [ ] After deploy (dev→main, Railway): set "sfa" to use the cloud key (auto default already does this) and **Re-parse** teste 2; optionally backfill the 39 legacy `pending` (no auto-sweep exists) — only after Task 1+2 land.

---

## Self-review

- Spec coverage: parser-default (T1), crash fix (T2), list endpoint (T3),
  reader wiring + switcher (T4/T5), PHI removal + docs (T6), verify/recover
  (T7). ✓
- No new columns ⇒ no migration. ✓
- API contract change (T3 + T1 schema) ⇒ regenerate types (T3 step 5). ✓
- React-compiler: hook IO via services; no try/finally in hook bodies. ✓
