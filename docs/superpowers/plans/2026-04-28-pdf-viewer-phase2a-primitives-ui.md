# PDF Viewer — Phase 2a: Compound primitives + UI shell

> **Status:** Shipped — commit [`87681c9`](../../../).
>
> Retrospective record. The implementation was completed before this plan
> file was authored; this document captures what landed.

**Goal:** Build the React rendering layer on top of `PdfJsEngine`. Ship
compound primitives (`Viewer.Root` / `Body` / `Pages` / `Page`), a
`<CanvasLayer>` that renders each page via the engine, a `<TextLayer>`
stub (the real impl ships with the search plugin in Phase 2b), and the
shadcn-styled UI shell (`Toolbar`, `NavigationControls`, `ZoomControls`,
`LoadingState`, `ErrorState`).

**Predecessor:** Phase 1b. **Successor:** Phase 2b (search/textlayer).

---

## What shipped

### Compound primitives (`frontend/pdf-viewer/primitives/`)

| Component | Role |
|---|---|
| `Viewer.Root` | Per-instance store + ViewerProvider wrapper |
| `Viewer.Body` | Scroll container; `currentPage` sync via IntersectionObserver is **TODO** (suppression logic was complex, not required for parity) |
| `Viewer.Pages` | Iterates 1..numPages, mounts `<Page>` |
| `Viewer.Page` | Owns a `<canvas>` + `<TextLayer>` for one page |
| `CanvasLayer` | AbortSignal-aware re-render on scale/rotation; DPR-aware sharpness |
| `TextLayer` | Stub (returns null); replaced in Phase 2b |

### UI shell (`frontend/pdf-viewer/ui/`)

`Toolbar`, `NavigationControls`, `ZoomControls`, `LoadingState`,
`ErrorState` — shadcn-style, consistent with the rest of the app.

### Hooks (`frontend/pdf-viewer/hooks/`)

`useDocumentLoader`, `usePageHandle`.

### High-level entrypoint

`<PrumoPdfViewer source={...}>` — all-in-one component for the common
case (mount, load, render, continuous scroll, prev/next, zoom).

### Tests

3 smoke tests against the `three-page.pdf` fixture; the scaffolding
test was extended with Phase 2a public-API assertions.

---

## Parity vs. legacy viewer

After Phase 2a the new module reaches parity for: load, render, continuous
scroll, prev/next, zoom. Search, thumbnails, and citation rendering are
deferred to Phase 2b and Phase 3.

---

## Tradeoffs taken

- **TextLayer stub.** The full implementation requires PDFFindController-
  compatible char/range bookkeeping, which lives naturally with the search
  plugin. Lifting it into Phase 2a would have meant building the search
  data model twice. Deferred to Phase 2b.
- **IntersectionObserver currentPage sync.** The naive implementation
  fights with `goToPage()` (programmatic scroll triggers IO callbacks
  that fight back). Deferred with a TODO; not required for parity.
- **`scrollTo` guarded** for jsdom compatibility in tests.

---

## Checklist (✅ all shipped)

- [x] `Viewer.Root` / `Body` / `Pages` / `Page` compound primitives
- [x] `<CanvasLayer>` with AbortSignal + DPR-aware rendering
- [x] `<TextLayer>` stub (full impl in Phase 2b)
- [x] `Toolbar`, `NavigationControls`, `ZoomControls`, `LoadingState`, `ErrorState`
- [x] `useDocumentLoader`, `usePageHandle`
- [x] `<PrumoPdfViewer>` all-in-one
- [x] 3 smoke tests against the synthetic fixture
- [x] Public-API surface assertions in the scaffolding test
- [ ] IntersectionObserver-driven currentPage sync (deferred — TODO in `Body`)
