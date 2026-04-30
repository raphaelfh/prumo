# PDF Viewer — Phase 5: Reader view + a11y + legacy cleanup

> **Status:** Pending — needs design + a11y review.
> **Predecessors:** Phases 0-3 shipped, Phase 4 (annotations) ideally landed
> first so the reader view inherits a final-shape DOM.
> **Successor:** None planned. This is the closing phase of the refactor.

## Why it's pending

This phase is three discrete bodies of work that share a release window
but no code:

1. **Reader view** — a typography-first mode that renders the PDF's
   extracted text without page-by-page rasterization. Useful for long
   articles, screen readers, and slow networks. Needs a UX mock and
   product sign-off.
2. **A11y baseline** — keyboard navigation, focus management, ARIA
   roles, contrast, and screen-reader announcements across the viewer.
   Needs an audit pass against WCAG 2.1 AA before code changes.
3. **Legacy cleanup** — dead code that survived earlier phases. Mostly
   discovery work; the actual deletes are small.

Each can ship independently; they're bundled because they all touch
the viewer's public surface and benefit from being released together.

## Track A — Reader view

### Open questions

| # | Question | Recommendation |
|---|---|---|
| 1 | Source of truth for the text — `article_text_blocks` (per-page, ordered, with bboxes) or `article_files.text_raw` (concatenated blob)? | `article_text_blocks` — gives us page boundaries, heading/paragraph types, and char offsets that survive citation lookups. |
| 2 | Render mode — single scrollable column, or paginated (mimics PDF page boundaries)? | Single column with discreet page markers. Mimicking pages defeats the point. |
| 3 | Toggle UX — separate route, modal, or split-pane next to the canvas viewer? | Toolbar button that swaps the viewer's body content. State lives on the per-instance store. |
| 4 | Citations and annotations — do they render in reader view? | Yes — same data, different overlay. Render highlights as inline `<mark>` elements with the same color palette. |

### Tasks

1. New primitive `Viewer.Reader` next to `Viewer.Pages` in `frontend/pdf-viewer/primitives/`. Renders an ordered stream of `<TextBlock>` from `article_text_blocks` keyed by page+index.
2. Store action `setMode('canvas' | 'reader')` on the viewer state.
3. `<Toolbar>` toggle button (icon: `BookOpenText` from `lucide-react`) that flips the mode.
4. Adapter `articleTextBlocksSource(articleFileId)` (mirrors `articleFileSource`) that fetches blocks from a new endpoint `GET /api/v1/article-files/{id}/text-blocks`.
5. Backend endpoint `GET /api/v1/article-files/{article_file_id}/text-blocks` → returns ordered blocks with selectors, gated by project membership.
6. Citations + annotations render as inline `<mark>` overlays in reader mode (reuse the `Citation` data, different renderer).
7. Tests: vitest smoke for the toggle + reader render; e2e for the mode switch.

### Dependencies

- `article_text_blocks` table (already in DB via commit `d2451e6`).
- A populated set of blocks for at least one test article — Phase 6 owns the population pipeline. Until then the reader view will look empty for unprocessed articles; render an `EmptyState` ("Reader view requires the document to be indexed; processing…") in that case.

## Track B — A11y baseline

### Audit checklist (run this BEFORE writing fixes)

- [ ] Tab order across the toolbar, page list, and search bar is logical (left-to-right, top-to-bottom).
- [ ] Every interactive element has either a visible label or an `aria-label`.
- [ ] Page navigation is keyboard-accessible (`PageDown`/`PageUp`/`Home`/`End`).
- [ ] Search bar opens via Cmd/Ctrl+F **even when focus is in a sibling form panel** — currently it only fires when the viewer container itself has focus. (See `PrumoPdfViewer.tsx:39-46` — root listener.)
- [ ] Focus is restored to the page that had it after closing the search bar.
- [ ] Active match in search is announced to screen readers via `aria-live`.
- [ ] Color contrast on highlights, badges, and zoom indicators ≥ 4.5:1.
- [ ] Reduced motion: `prefers-reduced-motion: reduce` disables the citation flash animation.
- [ ] All canvases have a `role="img"` + `aria-label` describing the page.
- [ ] Loading and error states are announced (currently they render but aren't `role="status"`).

### Likely fixes (mostly small)

- Hoist Cmd/Ctrl+F listener from the viewer root to `window` and gate by "is the viewer mounted in this page" — fixes the foster-focus issue noted in the probe earlier this session.
- Add `aria-label="Page N of M"` on each rendered canvas.
- Add `role="status" aria-live="polite"` to `LoadingState` and `ErrorState`.
- Add a `<VisuallyHidden>` H1 inside `Viewer.Root` so screen readers announce "PDF document".
- Honor `prefers-reduced-motion` for the active-match flash and the field-just-updated keyframe in `frontend/index.css`.

## Track C — Legacy cleanup

### Discovery checklist

Run these greps on a fresh worktree to surface dead code:

```bash
# Anything left from the pre-pdf-viewer module
grep -rn "PDFViewer\|usePDFStore\|usePDFPerformance\|usePDFVirtualization" \
  frontend --include="*.ts" --include="*.tsx" | grep -v node_modules

# Vestigial pdfSearchService callsites
grep -rn "pdfSearchService" frontend --include="*.ts" --include="*.tsx" \
  | grep -v node_modules

# Stale CSS selectors targeting the old DOM
grep -rn "react-pdf__\|rpv-\|@react-pdf-viewer" frontend --include="*.css" \
  --include="*.tsx" | grep -v node_modules

# Storybook stories or dev docs referencing the old viewer
find frontend -name "*.stories.tsx" -exec grep -l "PDFViewer" {} \;
```

Anything found is fair game for deletion. Phase 2b (commit `a4335c3`)
already deleted the bulk of it, but stragglers tend to surface once
real usage starts — typically:

- An import in a deeply-imported util that doesn't trigger a build error.
- A test fixture that still references the old API.
- An i18n key for the old UI ("zoomIn", "downloadPDF", etc) that the
  new viewer doesn't use.

### Tasks

1. Run the greps above. Open issues for each non-trivial hit.
2. Delete the obvious dead code in a single PR with a "before/after"
   bundle-size diff in the description.
3. Audit `frontend/index.css` and `frontend/lib/copy/*` for keys/rules
   referencing the legacy viewer.
4. Confirm no e2e regression and no bundle-size regression (`npm run build`
   then compare `dist/assets/pdf-vendor*.js` size against main).

## Verification

- Reader view renders without errors for a fully-indexed article and
  shows an EmptyState for an un-indexed one.
- Axe-core or Lighthouse a11y score on the QA + Extraction pages
  improves vs. main; no new violations.
- Bundle: `pdf-vendor.js` size doesn't grow more than the
  Recogito/reader code itself accounts for.
- E2E suite remains 41-44 passing, 0 failed.

## Out of scope

- AI-driven summarization in reader view (that's a separate feature).
- Per-user reader-view preferences (font, line-height) — could be a
  follow-up; v1 picks a sensible default.
- Translation — reader view shows whatever language the source PDF
  has; localization is its own track.
