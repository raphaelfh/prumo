---
status: draft
last_reviewed: 2026-06-20
owner: '@raphaelfh'
---

> **Status:** Draft — design direction approved in brainstorm 2026-06-20
> (incl. an adversarially-verified design review); pending written-spec
> review before `writing-plans`.

# Design: Parse-to-markdown end-to-end (pipeline activation, parse-status visibility, multi-document viewer)

**Date:** 2026-06-20
**Branch:** `claude/trusting-boyd-bf529c`
**Related:**
[ADR-0011](../../adr/0011-structured-pdf-parsing-at-ingest.md) (structured
PDF parsing at ingest),
[ADR-0013](../../adr/0013-dual-tier-markdown-representation.md) (dual-tier markdown),
and the plans
[`2026-06-19-structured-pdf-parsing-at-ingest.md`](../plans/2026-06-19-structured-pdf-parsing-at-ingest.md)
and
[`2026-06-19-grounded-extraction-and-hitl-highlight.md`](../plans/2026-06-19-grounded-extraction-and-hitl-highlight.md).

## Problem

A user added a LlamaParse BYOK key, then added a new article "teste", and
could not tell whether its PDF was parsed to markdown. It was **not**.
Live evidence: `articles.id = 07d38220-…`, file `ed49229d-…`,
`extraction_status = "pending"`, `extracted_at = NULL`, **0** rows in
`article_text_blocks`; the LlamaParse key is saved/valid/default but its
`last_used_at` is `NULL` (never used).

Two compounding root causes (both code-verified):

- **RC1 — the manual "Add article" path never enqueues a parse.**
  `addArticle` (`frontend/services/articlesService.ts:79`) uploads the PDF
  and inserts the `article_files` row **directly via Supabase PostgREST**
  (`articlesService.ts:106`); it never calls the backend, so
  `ArticleFileIngestService.enqueue_parse_at_ingest`
  (`backend/app/services/article_file_ingest_service.py:20`) never fires.
  The **only** caller of that hook today is the Zotero importer
  (`backend/app/services/zotero_import_service.py:460`). There is also a
  **second** un-enqueued upload path, `uploadArticleFile`
  (`articlesService.ts:313`, used by `ArticleFileUploadDialogNew` for
  supplements). Manually-added files therefore sit at `pending` forever.
- **RC2 — the dual-path parse feature is not live in prod.**
  `article_text_blocks` is globally empty and all 39 `article_files` rows
  are `pending`; nothing has ever advanced. The dual-path parse-at-ingest
  feature (dev commit `03ac24ad` / #350) is in `dev` but not promoted to
  `main` (Railway deploys from `main`).

Adjacent gaps surfaced while grounding the fix:

- The **viewer reader pane** is never fed text blocks.
  `ExtractionPDFPanel.tsx:31` only has `articleId` and never calls
  `useArticleTextBlocks`, so the reader always renders the "requires the
  document to be indexed" empty state
  (`frontend/pdf-viewer/primitives/Reader.tsx:43`) — even for parsed docs.
- The viewer is **hardcoded to the MAIN file**
  (`frontend/pdf-viewer/adapters/articleFileSource.ts:31`, `.eq('file_role','MAIN')`),
  so supplemental documents cannot be opened, even though the data model
  fully supports multiple files per article (`article_files.file_role`).

This design makes parsing actually run on every ingest path, makes its
success/failure **visible**, and adds a **document switcher** so the user
can open (and read the grounded markdown of) any linked document.

## Scope guardrails (what this is NOT)

- Not a generic app-schema API buildout. Only the endpoints needed below.
- Not the PHI fail-closed gate (`create_document_parser(project_is_phi=…)`).
  Per the 2026-06-20 decision, supplements follow the **same per-project
  parser backend as the MAIN file** (no special-casing). The PHI gate
  remains a documented future item, out of scope here.
- Not a bulk backfill. Recovery of the 39 stranded files is via a per-file
  **Re-parse** action, not a sweeper.

## Verified review findings folded in (must-fixes)

These are the design-review findings that survived adversarial
verification against the code. Each reshapes a phase below.

- **MF-1 — `parse_failed` never persists.** On a parse exception the
  worker does `session.rollback()` (`backend/app/worker/tasks/parsing_tasks.py:82`),
  discarding the `extraction_status = "parse_failed"` that
  `document_parsing_service.py:127` only `flush()`-es. After `max_retries`
  the row stays `pending`. **Consequence:** the status badge can never show
  "failed". Failures *before* the parse call (storage download) never set
  it at all. → Make terminal failure durable (commit in its own session)
  **before** the badge ships. (Checklist C/D.)
- **MF-2 — service-role reroute can widen access (BOLA/RLS).** The Storage
  INSERT policy is not project-scoped
  (`backend/alembic/versions/0003_storage_object_policies.py:47` —
  `bucket_id='articles' AND auth.uid() IS NOT NULL`); today the real gate
  is the `article_files` RLS insert (`is_project_member`,
  `baseline_v1.sql:2292`). A service-role backend insert bypasses that RLS,
  so the new endpoint **must** resolve `project_id` from `article_id` and
  `ensure_project_member` **before** insert, and **derive `storage_key`
  server-side** (never trust the client). Template:
  `backend/app/api/v1/endpoints/article_text_blocks.py:42`. (Checklist A/B.)
- **MF-3 — RC1 is two paths, not one.** Reroute **both** `addArticle`
  (`articlesService.ts:106`) and `uploadArticleFile`
  (`articlesService.ts:313`). Rerouting only one leaves supplements
  unparsed — and PR-E (supplement parsing) is born from that same path.
- **MF-4 — "re-upload teste" no-ops without the fix.** Re-upload goes
  through the same un-enqueued `addArticle`. The recovery path is a
  per-file **Re-parse** button calling `enqueue_parse_at_ingest` on the
  existing `article_file_id` (no storage round-trip), which also recovers
  `parse_failed` files (MF-1).
- **MF-5 — second reader-wiring site.**
  `frontend/pages/QualityAssessmentFullScreen.tsx:642` has the identical
  reader gap (and is also missing `store`). The viewer's only two
  consumers are it and `ExtractionPDFPanel`. Wire both — ideally via one
  shared hook so they cannot drift again.
- **MF-6 — Articles-list payload lacks `extraction_status`.**
  `loadProjectArticles` (`articlesService.ts:432`) selects only
  `id, title, doi, created_at`; status lives on the child `article_files`,
  and the list's only `article_files` read fetches `article_id` only. The
  badge needs a new data source (a typed backend field for the MAIN file's
  status), not a hand-added PostgREST select.
- **MF-7 — empty-state is sticky after parse.**
  `useArticleTextBlocks` has a 5-min `staleTime`, no `refetchInterval`, no
  invalidation on completion (Celery async, no realtime). Opening the
  reader right after upload pins `[]` for 5 min. → poll while status is
  `pending`, stop on a terminal state.
- **MF-8 — cross-document highlight leak on switch.**
  `useDocumentLoader` reacts to `source` but never clears `citations` /
  `currentPage` / `search`, so `CitationOverlay` projects doc A's rect onto
  doc B (`frontend/pdf-viewer/hooks/useDocumentLoader.ts:15`,
  `frontend/pdf-viewer/primitives/CitationOverlay.tsx:79`). → clear on
  switch. (Checklist G.)
- **MF-9 — ordering: 3.1 before 2.3.** The adapter never surfaces
  `article_file_id`, which the reader hook needs. Generalize the adapter
  first, then wire the reader once. A single `GET /articles/{id}/files`
  feeds both the source and the hook (kills the dual-read/waterfall).
- **MF-10 — unbounded BYOK cost.** `rate_limit="10/m"` is throughput, not
  cost; LlamaParse uploads the whole file at the `agentic` tier with no
  `max_pages`/byte ceiling (`backend/app/infrastructure/parsing/llamaparse_parser.py:44`).
  Fanning out to supplements needs a per-file size guard using the already
  stored `article_files.bytes`.
- **MF-11 — enum drift in 3 places + free-text column.** The stale comment
  (`frontend/types/article-files.ts:24`), the backend
  `ExtractTextResponse.status` literal (`backend/app/schemas/article.py:262`),
  and the e2e fixture writing `"completed"`
  (`frontend/e2e/_fixtures/ensure-fixtures.ts:89`) all disagree with the
  real values `pending | parsed | parse_failed`. Establish one source of
  truth + regenerate types; add a DB CHECK so it cannot silently drift.
- **NOTE (rejected):** the review's claim that "the reader toggle is never
  rendered" was **refuted** — `modeToggle` defaults to `true`
  (`frontend/pdf-viewer/ui/Toolbar.tsx:13`) and both callers render it.
  The toggle works today; reader mode is simply opt-in (no auto-select).

## Decisions (locked 2026-06-20)

1. **Re-parse over backfill.** A per-file "Re-parse" action recovers the
   "teste" article and the 39 stranded files on demand (MF-4). No sweeper.
2. **Drop all three dead BLOB columns** (`pdf_extracted_text`,
   `semantic_abstract_text`, `semantic_fulltext_text`). None has a live
   consumer: `semantic_abstract_text` is redundant with the real metadata
   `abstract` column (`backend/app/models/article.py:66`), and
   `pdf_extracted_text` (legacy raw pypdf dump) is superseded by
   `article_text_blocks` (plain text is reconstructable from blocks).
   Dropped in lockstep: model fields (`article.py:128-130`), the Zotero
   carry-forward block (`zotero_import_service.py:367-369`), FE display +
   `BLOB_COLUMN_IDS` + test refs, regenerated Supabase types, and one
   reversible destructive migration (revision id ≤ 32 chars). This executes
   the `articles`-level subset of roadmap Task 3.2/3.3
   (`text_raw`/`text_html` on `article_files` stay with that task).
3. **Supplements follow the LlamaCloud flow** like the MAIN file (same
   per-project parser backend; no PHI special-case). Keep a lightweight
   per-file cost guard (MF-10) as a safety net.
4. **`parsed_by` column deferred (YAGNI).** The Docling-fallback is already
   observable via the `parser_gate_llamaparse_no_key_fallback_docling` log
   (`backend/app/core/factories.py:66`). Add the column only if the UI must
   persistently show which backend ran.

## Architecture / phased delivery

Five units, one per PR (one concern each, per `CLAUDE.md`). Ordering is
load-bearing where noted.

### PR-A — Fase 0: promote the parse feature to prod (ops, no code)

Promote `dev → main` so the parse worker runs on Railway. The
`/article-files/.../text-blocks` router is already mounted
(`backend/app/api/v1/router.py:110`); this promotion is the only thing
between the existing reader endpoint and prod. Verify against `main` /
Railway before sequencing the rest.

### PR-B — Make every ingest path enqueue parse, durably

Concern: *manual uploads enqueue a parse, and failures are visible.*

- New backend endpoint that creates/confirms an `article_file` and calls
  `enqueue_parse_at_ingest` after the row commits. Reuse the existing
  (currently unwired) `UploadUrlRequest` / `UploadUrlResponse` /
  `ConfirmUploadRequest` schemas (`backend/app/schemas/article.py`,
  exported in `schemas/__init__.py`). These imply a **presigned-URL +
  confirm** flow, so the FE upload sequence is **replaced**, not patched
  (scope note: larger than an insert swap).
- **BOLA/RLS (MF-2):** resolve `project_id` from `article_id`,
  `ensure_project_member` before insert, **derive `storage_key`
  server-side**. Do not swallow a `.delay()` failure into a 2xx — either
  propagate (5xx with `error.message`) or set `parse_failed` +
  `extraction_error` atomically (contrast the Zotero best-effort swallow
  at `zotero_import_service.py:460`).
- Reroute **both** `addArticle` and `uploadArticleFile` through it (MF-3).
- **Re-parse action (MF-4):** endpoint + button that enqueues
  `parse_article_file_task` on an existing `article_file_id`. Surfaced from
  the per-file status (PR-C) and from the article detail dialog.
- **Durable `parse_failed` (MF-1):** persist terminal failure in its own
  committed session in the task's exception handler (after retries
  exhausted), covering pre-parse failures (storage download) too. This is
  a hard prerequisite of PR-C's badge.

### PR-C — Parse-status visibility

Concern: *the user can see parsed / parsing / failed.*

- **Enum single-source (MF-11):** define `pending | parsed | parse_failed`
  once (Python `Literal`/enum + DB CHECK), regenerate
  `frontend/types/api/schema.d.ts`, fix the stale comment, the
  `ExtractTextResponse.status` literal, and the e2e fixture. Reconcile the
  model `nullable=True` vs schema non-Optional mismatch.
- **Per-file badge** reading `extraction_status`. **Aggregation rule:** the
  Articles-list badge reflects the **MAIN** file only; per-file statuses
  (incl. supplements) appear in `ArticleDetailDialog` and the PR-D
  switcher. Handle the no-MAIN article (supplement-only) with a neutral
  state, not "pending".
- **List data source (MF-6):** extend the MAIN-file list query to return
  `extraction_status` for the article's MAIN file via the typed backend
  (not a new `supabase.from(...)` select).
- **UI column swap:** remove all three dead "–" display columns ("PDF
  text", "Sem. abstract", "Sem. fulltext",
  `frontend/lib/articlesListDisplay.ts:46-48` + their `BLOB_COLUMN_IDS`
  entries `:51-55`) and add a "Reader / Indexed" status column. Per
  Decision 2, **drop all three columns in lockstep** (model fields
  `article.py:128-130` + Zotero carry block `zotero_import_service.py:367-369`
  + FE/test refs + regenerated Supabase types + reversible migration,
  revision id ≤ 32 chars).

### PR-D — Reader wiring + multi-document switcher

Concern: *open and read the grounded markdown of any linked document.*
Order inside the PR: **3.1 → 2.3 → 3.3** (MF-9).

- **3.1 Generalize the adapter** so `articleFileSource` accepts an
  `article_file_id` (not hardcoded MAIN) and the panel obtains the id from
  a single `GET /api/v1/articles/{id}/files` (typed, `_gate_article`
  membership check, `ApiResponse[ArticleFileResponse[]]`, single unwrap).
  This kills the dual-read/waterfall.
- **2.3 Wire the reader** in **both** `ExtractionPDFPanel` and
  `QualityAssessmentFullScreen` (MF-5) via one shared hook: resolve the
  selected file id → `useArticleTextBlocks` → pass `readerBlocks` /
  `readerLoading` into `PrumoPdfViewer`. **Poll while status is pending**
  (MF-7), stop on terminal.
- **3.3 Selected-file state** feeds **both** the source and the hook from
  the same `selectedFileId` (no PDF/blocks desync). **On switch, clear**
  `citations` / `search` / page (MF-8); also destroy the outgoing pdf.js
  document to avoid the leak. Switcher = a dropdown of files labeled by
  `FILE_ROLE_LABELS` + filename, default MAIN, with a per-file parsed
  indicator.

### PR-E — Supplement parsing

Concern: *supplements get blocks / reader / highlights.* Blocked on PR-B
(supplements need an enqueue path) and best after PR-D (so they're
viewable).

- Enqueue a parse for **every** `file_role` at creation (the parse task and
  service are already role-agnostic; only the enqueue sites are MAIN-only).
- Supplements use the **same per-project parser backend** as MAIN
  (Decision 3). Add the **per-file cost guard** (MF-10): skip/flag files
  over a configurable page/byte ceiling, reflecting the skip in
  `extraction_status`.

## Cross-cutting concerns

- **Authorization:** every new endpoint resolves project from
  `article_id` / `article_file_id` and `ensure_project_member` before any
  access; never trust a body `project_id`. Cross-project member → 403/404
  integration test.
- **Migrations:** the destructive drop (PR-C) is reversible (down re-adds
  the nullable columns), documented as unrecoverable data, revision id
  ≤ 32 chars, single linear head (`0027_api_key_llama_cloud`). The DB CHECK
  for `extraction_status` is additive.
- **Envelope/types:** new endpoints use `ApiResponse[...]`, FE single-
  unwraps via `apiClient`; FE consumes generated types, never hand-mirrors
  the enum.

## Test strategy

- **Backend (pytest, integration):** confirm endpoint enqueues
  `parse_article_file_task` for MAIN and supplement; rejects non-members
  (BOLA 403); enqueue failure is **not** swallowed into success; terminal
  `parse_failed` is **durable** across a simulated worker rollback;
  re-parse enqueues on an existing `article_file_id`.
- **Frontend (vitest):** `addArticle` / `uploadArticleFile` call the typed
  client, not `supabase.from(...).insert` (RC1 regression-lock); badge
  renders the three real states; switching the selected document changes
  the `articleKeys.textBlocks` key and does not render the prior doc's
  blocks; switching clears citations/search; reader-blocks wiring present
  in **both** `ExtractionPDFPanel` and `QualityAssessmentFullScreen`.
- **E2E (Playwright):** upload → see "parsing" → see "parsed" → open reader
  → see markdown; open a supplement via the switcher.

## Out of scope / follow-ups

- PHI fail-closed gate (`project_is_phi`) — future ADR/plan.
- `parsed_by` column (Decision 4) — add only if persistently displayed.
- Per-role parser policy (e.g. cheaper backend for DATASET/FIGURE) — note
  only; cost guard (MF-10) is the interim safety net.

## Resolved in spec review (2026-06-20)

1. **Column drops:** drop all three dead BLOB columns
   (`pdf_extracted_text`, `semantic_abstract_text`, `semantic_fulltext_text`)
   — none has a live consumer; the three "–" display columns are removed
   from the table too.
2. **Re-parse:** per-file only (badge + article detail dialog). No bulk
   "re-parse all" action for now — revisit if the UX needs it.
