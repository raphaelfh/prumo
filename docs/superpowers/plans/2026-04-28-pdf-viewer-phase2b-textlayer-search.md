# PDF Viewer — Phase 2b: Real TextLayer + search service + SearchBar + consumer migration

> **Status:** Shipped — commits [`a4335c3`](../../../) (consumer migration
> + legacy delete) and [`5d35c99`](../../../) (TextLayer + search).
>
> Retrospective record. The implementation was completed before this plan
> file was authored; this document captures what landed.

**Goal:** Close the two largest feature-parity gaps with the legacy viewer
(real TextLayer, full-document search) and switch the two production call
sites to `@prumo/pdf-viewer`, deleting the legacy code.

**Predecessor:** Phase 2a. **Successor:** Phase 3 (Citation API) — blocked
on the database schema items in
[`docs/superpowers/specs/2026-04-28-pdf-viewer-database-requirements.md`](../specs/2026-04-28-pdf-viewer-database-requirements.md).

---

## What shipped — TextLayer + search ([`5d35c99`])

### TextLayer (was a stub)

- `pdfjs-dist` v5 `TextLayer` class, rendered in an absolute-positioned
  container above each page.
- Re-renders on scale / rotation change with `AbortSignal`.
- CSS provides text selection + highlight surface.
- Engine interface gained `PDFPageHandle.renderTextLayer(opts)`
  (additive, backwards-compatible).

### Search service (`frontend/pdf-viewer/services/searchService.ts`)

- Per-document text cache via `WeakMap<DocumentHandle, …>` — auto-GCs
  with the document. No global cache, no leaks (the legacy
  `pdfSearchService` had a global Map that was never cleared).
- Case-sensitive and whole-words options.
- Match objects include page + char range + pre-resolved text.

### Search state on the store

`query`, `options` (case / wholeWord), `matches`, `activeIndex`,
`searching` — all per-instance via the Zustand factory.

### `SearchBar` UI (`frontend/pdf-viewer/ui/SearchBar.tsx`)

- Input, prev/next, X/Y counter, options checkboxes
- `Esc` to close, `Enter` for next, `Shift+Enter` for previous
- `Cmd/Ctrl+F` opens the search bar
- Active match scrolls into view and gets a stronger highlight color

---

## What shipped — consumer migration + legacy delete ([`a4335c3`])

### Migrated call sites

- `ExtractionPDFPanel`: `<PDFViewer articleId>` →
  `<PrumoPdfViewer source={articleFileSource(articleId)}>`
- `QualityAssessmentFullScreen`: same shape
- `QualityAssessmentFullScreen.test`: stubbed the new module

### New domain adapter

`frontend/pdf-viewer/adapters/articleFileSource.ts` — resolves an
`article_id` to a `PDFLazySource` via the `article_files` table + Supabase
Storage signed URL. Lives in `adapters/` so the viewer core stays
domain-free.

### Deleted (no remaining consumers)

- `frontend/components/PDFViewer/` (full directory: 21 files — core, toolbar,
  search, dialogs, utils)
- `frontend/stores/usePDFStore.ts` — Zustand singleton, replaced by per-
  instance store factory + Context
- `frontend/services/pdfSearchService.ts` — replaced; legacy custom search
  had cross-span bugs and global cache issues
- `frontend/hooks/usePDFPerformance.ts` — magic-number GC without benchmarks
- `frontend/hooks/usePDFVirtualization.ts` — replaced by future plugin

---

## Checklist (✅ all shipped)

- [x] Real TextLayer using pdfjs-dist v5 `TextLayer` class
- [x] `PDFPageHandle.renderTextLayer` added to engine contract
- [x] Per-document search service with WeakMap-keyed text cache
- [x] Case-sensitive + whole-word search options
- [x] Search state on per-instance store
- [x] `SearchBar` UI with keyboard shortcuts
- [x] Active-match highlight + scroll-into-view
- [x] `articleFileSource` adapter
- [x] Consumer migration (ExtractionPDFPanel, QualityAssessmentFullScreen)
- [x] Legacy viewer code deleted

---

## Known follow-ups for Phase 3+

1. **Citation rendering.** Currently the viewer can show ad-hoc text/region
   highlights via the search plugin, but the citation flow described in
   `core/citation.ts` requires backend support — see the database
   requirements spec.
2. **`article_text_blocks` table** is a hard prerequisite for AI-grounded
   citations.
3. **W3C annotations + Recogito** (Phase 4) blocked on schema coordination.
