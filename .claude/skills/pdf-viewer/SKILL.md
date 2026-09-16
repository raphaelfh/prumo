---
name: pdf-viewer
description: >
  PDF text-layer selection, canvas/dpr scale, Lector. Use when changing
  frontend/pdf-viewer TextLayer, CanvasLayer, selection, or zoom.
paths:
  - "frontend/pdf-viewer/**"
---

# PDF viewer

Sibling: [Lector](https://github.com/anaralabs/lector) ([demo](https://anara.com/lector)). Read it for patterns; do not vendor the package.

**Invariant.** Canvas bitmap = `zoom * pixelRatio`. Text layer viewport = **CSS zoom** (same box as the page). pdf.js multiplies dpr inside `measureText`. Baking `zoom * dpr` into the text layer makes spans too large: extra lines and truncated words.

If native `::selection` still spans two lines after that, copy Lector's `bindTextSelection` (`caretPositionFromPoint` + nearest line). Leave bitmap cache, dark mode, and `pdf_viewer.css` alone.

| Lector (`packages/lector/src/`) | Ours |
|---|---|
| `hooks/layers/useTextLayer.tsx` — viewport `scale: 1` | `primitives/TextLayer.tsx` — scale `zoom` |
| `hooks/layers/useCanvasLayer.tsx` — dpr on the bitmap | `primitives/CanvasLayer.tsx` |
| `lib/text-selection.ts` — custom caret | native `getSelection` |
| `components/pages.tsx` — parent `scale3d(zoom)` | `viewport/useGestureZoom.ts` (preview only) |

Done when a one-line drag highlights that line and `getSelection()` returns whole words; `textLayerCss.test.ts` still passes.
