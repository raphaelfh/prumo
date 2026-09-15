---
status: approved
last_reviewed: 2026-09-15
owner: '@raphaelfh'
---

# PDF viewer — dead-API cleanup, page rotation fix, virtualized pages, gesture zoom, fit width

Status: approved by the user on 2026-09-15. Implementation plan:
`docs/superpowers/plans/2026-09-15-pdf-viewer-virtualized-gesture-zoom.md`. Built from the 2026-09-15 investigation of slow PDF loads, a study of
`anaralabs/lector` (MIT) and `zotero/reader` (AGPL-3.0, design reference only — no code copied), and the
user's rulings: (1) open every document at fit width, (2) rotation stays and must be correct for articles
with landscape pages, (3) phase order 0 → 1 → 2 → 3 → 4. Paths were checked against the worktree
(`claude/pdf-viewer-slow-load-53fe3d`, base `dev` `f5fe9ed8`). **NEW** marks a file or symbol that does
not exist yet.

## 1. Problem

| Slice | Problem on `dev` |
|---|---|
| Load time | `Viewer.Pages` (`frontend/pdf-viewer/primitives/Viewer.tsx:77`) mounts every page, and each `CanvasLayer` / `TextLayer` renders on mount. `contentVisibility: 'auto'` skips paint, not the pdf.js work. Measured headless (pdfjs-dist 6.2.108, scale 1.5 × DPR 2, canvas + text): 18-page PDF 1134 ms for all pages vs 71 ms for the first 2; 8-page article 314 ms vs 62 ms. |
| Rotation | `PdfJsPageHandle.render` / `renderTextLayer` (`engines/pdfjs/page.ts:25-28,89`) pass `rotation: opts.rotation ?? 0`, and the store starts at `0`, so pdf.js's default `rotation = this.rotate` is always overridden. `size` (`page.ts:18-22`) reads the unrotated `view`. Reproduced with a PyMuPDF fixture: a `/Rotate 90` page renders 612×792 with its content sideways; pdf.js natively gives 792×612. Articles with landscape tables/figures are affected. |
| Zoom | Buttons and a preset menu only (`ui/ZoomControls.tsx`), ±0.25 steps duplicated inline. No ctrl/⌘+wheel, no trackpad or touch pinch, no fit width. A zoom change re-renders every page. |
| Dead API | knip is blind inside the viewer: `knip.jsonc` keeps `frontend/pdf-viewer/index.ts!` an entry under `--production` as a "documented contract" for phases that never shipped. Unused: `PDFDocumentHandle.metadata/outline/fingerprint`, `PDFMetadata`, `OutlineNode`, `PDFEngine.destroy` (no-op), `LoadOptions` (never passed), `PDFDataSource` (`kind: 'data'`), and barrel exports the app never imports (`Viewer`, `CanvasLayer`, `TextLayer`, `usePageHandle`, `useDocumentLoader`, `NavigationControls`, `ZoomControls`, `LoadingState`, `ErrorState`). Stray `;` lines in five barrels. |
| Docs/copy | `frontend/pdf-viewer/README.md` says pdfjs v5, lists shipped work as "not yet", reserves `engines/pdfium/`. `ui/SearchBar.tsx` hardcodes `Searching…`, `No results`, `Find in document`, `Search query`. |

## 2. Non-goals

- Signed-URL caching, HTTP range requests and `Access-Control-Expose-Headers` on Supabase Storage — separate task.
- Lector's detail canvas, `ImageBitmap` cache, dark-mode recolor, and the WebKit `USE_LAYOUT_ZOOM` branch. Revisit only on a measured need (a blurry zoom on Safari is the trigger for the WebKit branch).
- Double-tap zoom, zoom animation, per-document zoom memory (ruling 1: always fit width on open).
- Replacing the engine (PDFium/EmbedPDF) or adopting pdf.js `PDFViewer` / Lector as a dependency.
- Reader (markdown) mode behaviour, other than `usePageScrollSync` keeping its DOM locator for it.

## 3. Requirements

### Phase 0 — cleanup and rotation fix (one PR, no new dependency)

- **R1** Public barrel `frontend/pdf-viewer/index.ts` exports only what production imports through `@prumo/pdf-viewer`: `PrumoPdfViewer`, `createViewerStore`, `subscribeReaderLocate`, `articleFileSourceFromStorageKey`, `type ViewerState`. `frontend/components/runs/RunSplitShell.tsx:12` imports `ViewerProvider` and `type ViewerState` from `@/pdf-viewer/core` on purpose (it must not pull pdfjs into its module graph), so `core/index.ts` keeps those. The 8 page tests under `frontend/test/` that mock `@prumo/pdf-viewer` with `core.createViewerStore` keep working unchanged. Internal modules import each other by path.
- **R2** `knip.jsonc`: the entry becomes `frontend/pdf-viewer/index.ts` (no `!`) and its comment is rewritten. Both `npx knip --no-tag-hints` and `npx knip --production --no-tag-hints` stay at zero; every finding this surfaces is triaged per `.claude/rules/frontend.md` § Dead code in the same PR. Amended 2026-09-15 during implementation: `frontend/pdf-viewer/index.ts` is removed from knip's `entry` list altogether — with it listed, knip production mode reported the 4 live exports as unused (a knip quirk with barrel entries). The intent — production-mode knip reports an export the app stops using — holds without the entry line.
- **R3** Engine interface pruned (`core/engine.ts`, `engines/pdfjs/*`, `engines/mock/index.ts`): remove `metadata`, `outline`, `fingerprint`, `PDFMetadata`, `OutlineNode`, `PDFEngine.destroy`, `LoadOptions`. `PDFEngine.load(source)` takes the source only.
- **R4** Remove `PDFDataSource`; `PDFSource = PDFUrlSource | PDFLazySource`, `PDFUrlSource` loses `withCredentials` / `httpHeaders` (no caller sets them). `sourceToGetDocumentParams` shrinks accordingly. Amended 2026-09-15 during implementation: `PDFDataSource` (`{kind: 'data'}`) is kept as a documented test seam instead of removed — under vitest's jsdom realm pdf.js cannot read `file://` URLs (Node `Buffer`s fail its cross-realm `instanceof Uint8Array` check), so tests load pdf.js fixtures as bytes via `PDFDataSource`. `withCredentials` and `httpHeaders` are still removed as planned.
- **R5** Rotation is correct and stays:
  - `PDFPageHandle` gains **NEW** `readonly rotation: PageRotation` = the page's intrinsic `/Rotate`.
  - `size` returns the **displayed** size at the intrinsic rotation (width/height swapped for 90/270).
  - Store `rotation` is renamed **NEW** `viewRotation` (user delta, default 0). Every render and layout site uses **NEW** `effectiveRotation(page, viewRotation) = (page.rotation + viewRotation) % 360` (one helper in `core/`), and the canvas, text layer and page box (`Viewer.Page` intrinsic size) all read it.
  - **NEW** "Rotate view" `IconButton` in `ui/Toolbar.tsx` (copy in `lib/copy/pdf.ts`) calls **NEW** `rotateView()` (+90° clockwise). Without it `viewRotation` would be state no UI sets, which is dead code.
- **R6** Remove the stray `;` lines from `index.ts`, `primitives/index.ts`, `ui/index.ts`, `core/types.ts`, `engines/pdfjs/index.ts`.
- **R7** `SearchBar.tsx` strings move to `frontend/lib/copy/pdf.ts`.
- **R8** `frontend/pdf-viewer/README.md` rewritten to the shipped surface: pdfjs-dist 6, the modules of §4, the public API of R1. No phase table, no reserved engines.

### Phase 1 — only pages near the viewport render

- **R9** **NEW** dependency `@tanstack/react-virtual`. **NEW** `viewport/usePageLayout.ts` (pure): from per-page displayed sizes (R5), `viewRotation`, `zoom` and `gap`, returns `offsetOf(page)`, `pageAt(scrollTop)`, `totalHeight`. The first page's size is read at load; the rest are estimated from page 1 and corrected as each page handle resolves (`resizeItem` above the viewport keeps the reading position, as Lector does).
- **R10** **NEW** `viewport/useVirtualPages.ts` wraps `useVirtualizer` (`overscan: 1`, `useScrollendEvent: false`) and freezes the mounted set while `isGesturing` (adding newly revealed pages), re-measuring when the gesture ends.
- **R11** `Viewer.Pages` renders only virtual items; `Viewer.Page` drops the `contentVisibility` workaround. `CanvasLayer` / `TextLayer` cancel on unmount (existing `AbortController`).
- **R12** `hooks/usePageScrollSync.ts` keeps its settle-hold logic (#870) and takes an injected **NEW** `PageLocator` (`offsetOf`, `pageAt`, `onScroll`). Canvas uses the layout locator from R9 (no DOM query, no `IntersectionObserver`); `Reader.tsx` uses a DOM locator built from the current implementation.
- **R13** Search on an unmounted page: `goToNextMatch` → `currentPage` → sync scrolls → page mounts → `TextLayer` applies the highlight. Locked by a test.

### Phase 2 — gesture zoom

- **R14** Store: `scale` / `setScale` become **NEW** `zoom`, `setZoom(zoom, {fitWidth?})`, `zoomBy(factor, origin?)`, `fitWidth: boolean`, `isGesturing: boolean`. Any manual zoom sets `fitWidth = false`. Limits `MIN_ZOOM = 0.25`, `MAX_ZOOM = 4` live in one place.
- **R15** **NEW** `viewport/zoomMath.ts` (pure, no DOM): `clampZoom`, `anchoredScroll({contentPoint, containerPoint, zoom})` (keeps the point under the pointer fixed), `wheelStep(event)` (mouse line/page delta = one step; pixel/trackpad delta = continuous factor `exp(-deltaY/100)`), and the wheel-inertia filter (swallow non-ctrl wheel for 140 ms after a pinch unless direction flips, the gesture turns horizontal, or |delta| grows > 1.35×).
- **R16** **NEW** dependency `@use-gesture/react`. **NEW** `viewport/useGestureZoom.ts` on the `Viewer.Body` scroller: `onPinch` (touch and trackpad), ctrl/⌘ + wheel, `gesturestart`/`gesturechange` prevented on Safari. During the gesture it applies `transform: scale(zoom / committedZoom)` to the pages element and writes the anchored scroll, at most once per animation frame; at gesture end it commits `zoom` to the store. `pointercancel` or a container resize mid-gesture restores the committed zoom. `preventDefault` applies only inside the viewer. Adapted code carries `// Adapted from anaralabs/lector (MIT)`.
- **R17** Keyboard: ⌘/Ctrl `=`, `-`, `0` (0 = fit width) through `frontend/hooks/useKeyboardShortcuts.ts`, active only while focus or the pointer is inside the viewer root, so browser zoom keeps working elsewhere.
- **R18** `ZoomControls` calls `zoomBy` / `setZoom` only; its inline clamp and ±0.25 arithmetic are deleted.

### Phase 3 — sharp re-render after the gesture

- **R19** `CanvasLayer` renders at the committed zoom only, debounced 100 ms after the last zoom change; during `isGesturing` it keeps its current bitmap (stretched by the transform). Render scale = `zoom × min(devicePixelRatio, 2)`, clamped so width × height ≤ **NEW** `MAX_CANVAS_PIXELS` (16 777 216).
- **R20** `TextLayer` is hidden while `isGesturing` and re-rendered at the committed zoom.

### Phase 4 — fit width

- **R21** **NEW** `viewport/useFitWidth.ts`: a `ResizeObserver` on the scroller; while `fitWidth` is true, a width change recomputes `zoom = clampZoom(containerWidth / widestDisplayedPageWidth)`, coalesced to one update per frame, without re-rendering canvases mid-drag (R19's debounce covers it).
- **R22** Every document opens with `fitWidth = true` (ruling 1). `ZoomControls` gains a "Fit width" item (copy in `lib/copy/pdf.ts`); presets stay.

## 4. Module layout after the change

```text
frontend/pdf-viewer/
├── core/          store, context, state/types, engine interface, effectiveRotation
├── engines/pdfjs/ load, page render + text layer (intrinsic rotation aware)
├── engines/mock/  test engine (implements the pruned interface)
├── viewport/      NEW usePageLayout, useVirtualPages, zoomMath, useGestureZoom, useFitWidth
├── hooks/         useDocumentLoader, usePageHandle, usePageScrollSync (PageLocator)
├── primitives/    Viewer, CanvasLayer, TextLayer, Reader and its helpers
├── ui/            Toolbar (+ rotate), ZoomControls (+ fit width), SearchBar, NavigationControls, states
└── index.ts       R1 public surface only
```

## 5. Testing strategy

| Requirement | Test |
|---|---|
| R2 | `npx knip --no-tag-hints` and `npx knip --production --no-tag-hints` = 0 findings |
| R5 | **NEW** fixture `frontend/pdf-viewer/__fixtures__/rotated-page.pdf` (page 2 `/Rotate 90`, generated once with PyMuPDF, committed). Engine test: page 2 `size` = 792×612, `rotation` = 90; `viewRotation` 90 → effective 180. Store test for `rotateView` wrap-around. |
| R9, R12 | Pure tests of `usePageLayout` (`offsetOf`/`pageAt` round trip, mixed sizes and rotations). `page-scroll-sync.test.tsx` rewritten against an injected locator; the settle-hold cases kept. |
| R10, R11 | Mock-engine render test: 18-page document mounts ≤ 3 pages; scrolling to page 10 mounts pages 9–11 only. |
| R13 | Search match on page 12 while pages 1–3 are mounted → page 12 mounts with a highlighted span. |
| R15 | Pure `zoomMath` tests written first: anchor invariant (point under pointer unchanged within 1px), clamp, wheel step by delta mode, inertia filter cases. |
| R16, R17 | Integration: synthetic ctrl+wheel at a point keeps that content point fixed; ⌘/Ctrl `=` inside the viewer zooms, outside it does nothing. Manual in the Browser pane: trackpad pinch, mobile preset touch pinch. |
| R19, R20 | Five zoom changes within 100 ms → one render per mounted page; no text layer while gesturing. |
| R21, R22 | Resize with `fitWidth` recomputes zoom; a manual zoom stops it; a new document reopens at fit width. |
| E2E | `frontend/e2e/flows/pdf-viewer-page-sync.ui.e2e.ts` updated: it currently expects every `PDF page N` img to exist at once, which virtualization intentionally breaks. `extraction-review-workspace.ui.e2e.ts:460` (`PDF page 1` visible) must stay green. |
| Visual | `/design-review` on the run split view after phases 2 and 4. |

Every phase runs `npm run typecheck`, `npm run lint`, `npm run test:run`, both knip modes, and `scripts/fitness/check_copy_keys.py` before its PR.

## 6. Slicing for the plan

| Phase | PR | Depends on | Deletes |
|---|---|---|---|
| 0 | cleanup + rotation fix (R1–R8) | — | dead engine API, data source, unused barrel exports, stray `;`, stale README |
| 1 | virtualized pages (R9–R13) | 0 | `contentVisibility` workaround, IntersectionObserver canvas path |
| 2 | gesture zoom (R14–R18) | 1 | `scale`/`setScale`, inline zoom arithmetic in `ZoomControls` |
| 3 | deferred re-render (R19–R20) | 2 | per-tick canvas re-render |
| 4 | fit width (R21–R22) | 2 | fixed initial zoom of 1 |

## 7. Risks

- **Safari canvas blur under `transform`** (WebKit bug 264954). Mitigation: the transform is only live during the gesture; the commit re-renders at the real size. If blur persists after commit, add Lector's CSS `zoom` branch (non-goal until measured).
- **React Compiler** (`panicThreshold: 'all_errors'`): gesture and virtualizer refs must not be read during render; no `try/finally` in hook bodies.
- **Renaming `scale` / `rotation`**: no app code outside `frontend/pdf-viewer/` reads either (checked 2026-09-15; `ExtractionFullScreen.tsx:119` and `QualityAssessmentFullScreen.tsx:344` only call `createViewerStore()`), so the rename is internal — but the viewer's own tests (`store.test.ts`, `canvas-layer.test.tsx`, `pageContainment.test.tsx`, `injected-store.test.tsx`) change with it.
