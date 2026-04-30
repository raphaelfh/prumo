# PDF Viewer — Phase 6: `article_text_blocks` ingestion + backfill

> **Status:** Pending — depends on choosing/integrating an upstream
> text-block extractor (OpenDataLoader-PDF or equivalent).
> **Predecessors:** `article_text_blocks` schema (commit `d2451e6`),
> `pdf-processor.py` service (legacy text extraction).
> **Successor:** Phase 5 reader view (consumes the populated table),
> Phase 4 annotations (uses the bboxes for region anchors).

## Why it's pending

`article_text_blocks` is empty. Without it, three downstream features
either degrade gracefully or stay broken:

- **AI-grounded citations** (Phase 3 write path) — the LLM can emit
  `kind: 'text'` anchors with char ranges, but the viewer can't render
  bboxes for them without a per-page block index.
- **Reader view** (Phase 5) — has nothing to render.
- **Region-anchored annotations** (Phase 4) — can still be created
  manually, but auto-suggesting where to place them based on document
  structure requires the block index.

The blocker is choosing the upstream extractor. The requirements spec
(§1) recommends OpenDataLoader-PDF; the existing service
[`backend/app/services/pdf_processor.py`](../../../backend/app/services/pdf_processor.py)
uses a different library (text-only, no bboxes). One of three paths:

1. Add OpenDataLoader-PDF as a Python dependency, run it in a Celery
   task, persist results to `article_text_blocks`. Heaviest, highest
   fidelity.
2. Use `pdfplumber` (likely already a dep) to extract per-page words
   with bboxes, then group into blocks heuristically. Lighter, still
   reasonable bbox quality.
3. Run pdfjs-dist's `getTextContent()` server-side via Node + jsdom in
   a sidecar service. Frontend-aligned, but adds a Node runtime to
   the backend.

## Open questions

| # | Question | Recommendation |
|---|---|---|
| 1 | Which extractor (1/2/3 above)? | Start with **option 2 (pdfplumber)** — already in the dep tree, fast to ship, gives us bboxes. Re-evaluate quality after the reader view ships. |
| 2 | When to extract — on upload, on first read, or async batch? | On upload as a Celery task. Article ingestion already enqueues a similar task for `text_raw`; piggyback there. |
| 3 | Idempotency strategy — replace all blocks or upsert by `(article_file_id, page_number, block_index)`? | Replace all. The unique key is structural; if the upstream extractor changes its grouping, an upsert leaves stale rows. |
| 4 | Backfill cadence for existing articles — bulk job, or lazy on first read? | Bulk Celery job triggered manually (a Make target / management command). Lazy is too racy and tempts a UI that says "indexing…" forever. |
| 5 | What to do for image-only PDFs (no embedded text)? | OCR is out of scope here — the task records `extraction_status='no_text_layer'` on the `article_files` row and skips the block insert. Track via a follow-up plan. |
| 6 | Header/footer detection — heuristic or accept what the lib gives us? | Map any header/footer-shaped block to `block_type='header'`/`'footer'` based on y-position thresholds; otherwise default to `'paragraph'` per the spec's guidance. |

## Tasks (in order)

### Backend — extractor + Celery task

1. Add a service `backend/app/services/text_block_extractor.py`:

   ```python
   class TextBlockExtractor:
       def extract(self, pdf_bytes: bytes) -> list[TextBlockInput]:
           """Per-page blocks with char offsets and bboxes.

           Uses pdfplumber under the hood. Char offsets are computed by
           concatenating each page's blocks in reading order.
           """
   ```

   - Returns a list of `TextBlockInput` (already defined in
     `backend/app/schemas/extraction.py` per the requirements spec) —
     one entry per (page, block_index).
   - Heuristic block_type: `heading` if font size ≥ 1.4× body median;
     `header`/`footer` if y < 60 or y > height-60; `figure_caption`
     if italic + below an image; everything else `paragraph`.
   - Robust to PDFs with no text layer: returns `[]` and the caller
     stamps `extraction_status='no_text_layer'`.

2. Celery task `backend/app/worker/tasks/text_blocks_tasks.py`:

   ```python
   @celery_app.task(name='extract_article_text_blocks', bind=True, max_retries=3)
   def extract_article_text_blocks(self, article_file_id: str) -> None:
       # 1. Fetch ArticleFile + download bytes from Supabase Storage.
       # 2. Run TextBlockExtractor.
       # 3. Inside one transaction: DELETE FROM article_text_blocks
       #    WHERE article_file_id = ...; INSERT new blocks.
       # 4. Stamp ArticleFile.extraction_status / extracted_at.
   ```

   - Idempotent (delete-then-insert by `article_file_id`).
   - Retries on transient storage / DB errors with exponential backoff.

3. Hook the task into article ingestion. Two existing entry points
   create `ArticleFile` rows: the upload endpoint and the Zotero
   import flow. Both should enqueue
   `extract_article_text_blocks.delay(article_file.id)` after the
   row is committed.

4. Management command for the bulk backfill:
   `python -m backend.app.scripts.backfill_text_blocks` —
   iterates `article_files` rows where no `text_blocks` exist, batches
   of 50, dispatches one Celery job per row, waits for completion.

### Backend — read endpoint (consumed by reader view)

5. `GET /api/v1/article-files/{article_file_id}/text-blocks` — returns
   ordered `TextBlockOutput` rows (mirrors the input shape, plus the
   `id`). Membership-gated; uses the same `is_project_member()` SQL
   helper as the citations endpoint.

### Frontend hook

6. `useArticleTextBlocks(articleFileId)` TanStack Query hook (mirror
   `useArticleCitations`). Stale time 5 min — blocks rarely change.

### Tests

7. Backend unit test `test_text_block_extractor.py` against a tiny
   synthetic PDF (use the fixture in `frontend/pdf-viewer/__fixtures__/three-page.pdf`,
   served from a shared test resource path).
8. Backend integration test for the Celery task using a real Postgres
   transaction (the existing test infra runs Celery `eager`).
9. E2E: upload a PDF via the existing upload flow, wait for the
   Celery task to land, hit the read endpoint, expect ≥1 block per
   page.

## Verification

- After ingestion, every `article_files` row with
  `extraction_status='completed'` has ≥1 `article_text_blocks` row.
- Calling the read endpoint for a fully-indexed article returns blocks
  ordered by `(page_number, block_index)`, all char ranges
  monotonically increasing within a page.
- `text_block_extractor.extract(no_text_layer.pdf)` returns `[]` and
  doesn't crash.
- Backfill script can be re-run safely on a partially-indexed DB
  (idempotent via the delete-then-insert).

## Out of scope

- OCR fallback for image-only PDFs (separate plan).
- Streaming results to the frontend as they're extracted (current
  flow is "extract once → fetch all"; streaming is a perf improvement,
  not a correctness one).
- Cross-language text normalization (NFKC etc.) — defer until we have
  a concrete failure case.
- Re-extraction triggered by template changes — blocks aren't
  template-aware; they only depend on the PDF.

## Operations checklist

- [ ] Confirm Celery worker is provisioned to handle the extra load
      (typical PDF ingestion cost ≈ 1-3s, dominated by I/O).
- [ ] Add a metric / dashboard for `extract_article_text_blocks` task
      latency and failure rate.
- [ ] Decide rollout: backfill via the management command on a
      maintenance window, or trickle in by re-uploading.
