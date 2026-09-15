---
status: draft
last_reviewed: 2026-09-15
owner: '@raphaelfh'
---

# PDF Viewer — Virtualized Pages, Gesture Zoom, Fit Width Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the PDF viewer load fast (render only pages near the viewport), render landscape (`/Rotate`) pages correctly, zoom by pinch / ctrl+wheel / keys with the point under the pointer fixed, and open every document at fit width — with zero dead API left behind.

**Architecture:** Five phases, one PR each, in order 0 → 1 → 2 → 3 → 4. Phase 0 prunes the engine and public surface and fixes intrinsic rotation. Phase 1 adds a pure page layout (`viewport/usePageLayout.ts`) that is the single source of page positions, feeds `@tanstack/react-virtual` for which pages mount, and replaces the DOM-based page ⇄ scroll sync with an injected `PageLocator`. Phase 2 adds pure zoom math and a gesture controller that previews zoom as a CSS transform and commits it to the store at gesture end (Lector's model). Phase 3 defers canvas and text-layer re-renders until zoom settles. Phase 4 adds fit width.

**Tech Stack:** TypeScript strict, React 19 (React Compiler, `panicThreshold: 'all_errors'`), Zustand 5, pdfjs-dist 6.2.108, `@tanstack/react-virtual` 3 (new), `@use-gesture/react` 10 (new), Vitest 4 + jsdom + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-15-pdf-viewer-virtualized-gesture-zoom-design.md` (R1–R22). Read it before Task 1.

## Global Constraints

- English only: code, comments, commits, copy keys and copy text.
- Work in the worktree `/Users/raphael/PycharmProjects/prumo/.claude/worktrees/pdf-viewer-slow-load-53fe3d`. Use absolute paths; never edit the main checkout.
- Frontend tooling runs from the worktree ROOT (`package.json`, `vitest.config.ts`). There is no `frontend/package.json`; never `cd frontend && npm …`. The worktree has no `node_modules` yet: run `test -d node_modules || npm ci` once before Task 1.
- One PR per phase, targeting `dev`, squash-merged. Phase 0 uses the current branch `claude/pdf-viewer-slow-load-53fe3d`. Start each later phase on a fresh branch from `origin/dev` **after** the previous phase's PR has merged (`git fetch origin dev`, then `git switch -c feat/pdf-viewer-phase<N>-<slug> origin/dev`) — stacking branches on a squash-merged base re-applies its hunks. Open a PR only when the user asks; one armed auto-merge at a time.
- Run git commands one per Bash call (the worktree guard refuses compound shell with git). Conventional commits; end every commit message with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Single test file: `npx vitest run <path>`. Whole suite: `npm run test:run` (never plain `npm test` — watch mode hangs).
- In test files, `await import(...)` modules that pull pdf.js **at module scope** after `vi.mock('pdfjs-dist', () => legacyPdfjs)`, never inside `it()` (transform time is charged to the test timeout and flakes).
- jsdom's user agent is not a Mac: `mod` is Control in Vitest. Drive mod chords with `{Control>}…{/Control}`.
- React Compiler: no `try/finally` in component or hook bodies; never read `ref.current` during render; no synchronous `setState` in an effect body (derive during render with the "previous value in state" pattern `usePageHandle.ts` uses, or set state from event/promise callbacks); no template-literal computed keys in components. Element handles a hook needs go through `useState` + callback ref (`ref={setElement}`), not a ref read in render.
- All user-facing text goes through `frontend/lib/copy/pdf.ts` via `t('pdf', key)`. Every icon-only control is `IconButton`.
- Dead code: `npx knip --no-tag-hints` and `npx knip --production --no-tag-hints` stay at **0**; `python3 scripts/fitness/check_copy_keys.py` stays green. Triage any knip finding per `.claude/rules/frontend.md` § Dead code; never widen `ignore`.
- Code adapted from Lector carries `// Adapted from anaralabs/lector (MIT)` in its header comment. No code from zotero/reader (AGPL).
- **Phase gate** (last task of every phase, all must pass, record each result):
  ```bash
  npm run typecheck
  npm run lint
  npm run test:run
  npx knip --no-tag-hints
  npx knip --production --no-tag-hints
  python3 scripts/fitness/check_copy_keys.py
  ```

## Plan refinements over the spec

Each is a place the spec left room or where the design review of this plan found a defect. Executors follow the plan.

1. **Gaps scale with zoom.** `PAGE_GAP` (16 px at zoom 1) is multiplied by zoom, as in Lector. The gesture preview (a transform of the whole page column) and the committed layout are then the same picture, and anchoring is linear. A fixed gap drifts the anchor by `gap × pagesAbove × (ratio − 1)` px.
2. **`zoomBy(factor)` has no `origin` parameter (R14).** Anchoring lives in `useGestureZoom`; no caller has an origin to pass, so the parameter would be dead API.
3. **`wheelStep` clamps pixel-mode factors to one `ZOOM_STEP` each way (R15).** Chrome reports a mouse notch as `deltaY ±100` in pixel mode; unclamped `exp(-1)` zooms 2.7× per notch.
4. **The virtualizer's gesture freeze (R10) lands in Phase 2**, with `isGesturing`. In Phase 1 it would be a parameter nothing sets.
5. **Page sizes live in the store** (`pageSizes`, `setPageSize`) — how R9's "corrected as each page handle resolves" reaches the layout. Page 1's size is read before `loadStatus` turns `ready`.
6. **⌘/Ctrl `0` lands in Phase 4** with fit width (R17 says `0` = fit width).
7. **The text layer waits 100 ms after a zoom change too (R19/R20).** Otherwise a fit-width resize drag re-renders every text layer per frame.
8. **`TextLayer` highlights after its spans paint (R13).** Today the highlight effect can run before the async text layer resolves, which virtualization makes the normal case.
9. **`core/rotation.ts` holds `displayedSize` beside `effectiveRotation` (R5)**, so the canvas, page box and layout share one quarter-turn swap.
10. **`core/types.ts`, `primitives/index.ts` and `ui/index.ts` are deleted (R6)** — nothing imports them once R1 lands.

## File map

| File | Phase | Responsibility |
|---|---|---|
| `frontend/pdf-viewer/core/engine.ts` | 0 | Engine interface: `load(source)`, document `numPages/getPage/destroy`, page `rotation/size/render/…` |
| `frontend/pdf-viewer/core/source.ts` | 0 | `PDFSource = PDFUrlSource \| PDFLazySource` |
| `frontend/pdf-viewer/core/rotation.ts` (new) | 0 | `effectiveRotation`, `displayedSize` |
| `frontend/pdf-viewer/core/state.ts`, `core/store.ts` | 0,1,2,4 | `viewRotation/rotateView`; `pageSizes/setPageSize`; `zoom/setZoom/zoomBy/fitWidth/isGesturing/setGesturing` |
| `frontend/pdf-viewer/core/index.ts` | 0 | Engine-free surface for `RunSplitShell` and the app's page-test mocks |
| `frontend/pdf-viewer/index.ts` | 0 | R1 public surface |
| `frontend/pdf-viewer/engines/pdfjs/{index,document,page,source}.ts` | 0 | pdf.js engine, intrinsic-rotation aware |
| `frontend/pdf-viewer/engines/mock/index.ts` | 0 | Test engine on the pruned interface, `rotation` config |
| `frontend/pdf-viewer/viewport/usePageLayout.ts` (new) | 1 | Pure `createPageLayout`, `usePageLayout`, `layoutPageLocator` |
| `frontend/pdf-viewer/viewport/useVirtualPages.ts` (new) | 1,2 | Which pages mount; size corrections; gesture freeze |
| `frontend/pdf-viewer/hooks/usePageScrollSync.ts` | 1,2 | Page ⇄ scroll sync over a `PageLocator`; `createDomPageLocator` |
| `frontend/pdf-viewer/viewport/zoomMath.ts` (new) | 2 | Limits, `clampZoom`, `anchoredScroll`, `wheelStep`, `filterWheel` |
| `frontend/pdf-viewer/viewport/useGestureZoom.ts` (new) | 2 | Pinch + ctrl/⌘ wheel preview and commit |
| `frontend/pdf-viewer/viewport/useZoomShortcuts.ts` (new) | 2,4 | ⌘/Ctrl `=` `-` (`0` in Phase 4) scoped to the viewer |
| `frontend/pdf-viewer/viewport/useFitWidth.ts` (new) | 4 | Zoom follows scroller width |
| `frontend/pdf-viewer/primitives/Viewer.tsx` | 0,1,2,4 | Root/Body/Pages/Page |
| `frontend/pdf-viewer/primitives/CanvasLayer.tsx`, `TextLayer.tsx` | 0,1,2,3 | Rendering |
| `frontend/pdf-viewer/ui/Toolbar.tsx`, `ZoomControls.tsx`, `SearchBar.tsx` | 0,2,4 | Rotate view, zoom, fit width, copy |
| `frontend/lib/copy/pdf.ts` | 0,4 | Copy keys |

---

# Phase 0 — cleanup and rotation fix (R1–R8)

### Task 1: Prune the engine API and keep only URL sources (R3, R4)

**Files:**
- Modify: `frontend/pdf-viewer/core/engine.ts`, `frontend/pdf-viewer/core/source.ts`
- Modify: `frontend/pdf-viewer/engines/pdfjs/index.ts`, `engines/pdfjs/document.ts`, `engines/pdfjs/source.ts`, `engines/mock/index.ts`
- Test: `frontend/pdf-viewer/__tests__/engine.test.ts`, `mockEngine.test.ts`, `searchService.test.ts`, `primitives.test.tsx`, `pageContainment.test.tsx`, `store.test.ts`

**Interfaces:**
- Produces: `PDFEngine { load(source: PDFSource): Promise<PDFDocumentHandle> }`; `PDFDocumentHandle { numPages; getPage(n); destroy() }`; `PDFSource = PDFUrlSource | PDFLazySource`; `PDFUrlSource { kind: 'url'; url: string }`; `PDFLazySource { kind: 'lazy'; load(): Promise<PDFUrlSource> }`; `sourceToGetDocumentParams(source): Promise<{url: string}>`. Tests load fixtures with `pathToFileURL(...).href` (verified: legacy pdf.js 6.2.108 loads `file://` URLs in Node).

- [ ] **Step 1: Point every test at URL sources and drop the removed API from them**

`engine.test.ts` — replace the whole file:

```ts
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {beforeAll, describe, expect, it, vi} from 'vitest';

// The bundled pdfjs-dist is browser-only (DOMMatrix at module init). In jsdom
// we shim it with the legacy build, the Node-compatible variant of the same version.
import * as legacyPdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
vi.mock('pdfjs-dist', () => legacyPdfjs);

// Import AFTER the mock is registered so the engine sees the shim.
const {pdfJsEngine} = await import('../engines/pdfjs');
import type {PDFDocumentHandle} from '../core/engine';

import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
legacyPdfjs.GlobalWorkerOptions.workerSrc = `file://${require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')}`;

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUrl = (name: string) => pathToFileURL(resolve(here, '../__fixtures__', name)).href;

describe('pdfJsEngine.load', () => {
  let doc: PDFDocumentHandle;

  beforeAll(async () => {
    doc = await pdfJsEngine.load({kind: 'url', url: fixtureUrl('three-page.pdf')});
  });

  it('reports the correct number of pages', () => {
    expect(doc.numPages).toBe(3);
  });

  it('getPage returns a handle with size in PDF points', async () => {
    const page = await doc.getPage(1);
    expect(page.pageNumber).toBe(1);
    expect(page.size.width).toBe(400);
    expect(page.size.height).toBe(600);
  });

  it('page text content has items with char offsets', async () => {
    const page = await doc.getPage(1);
    const tc = await page.getTextContent();
    expect(tc.items.length).toBeGreaterThan(0);
    expect(tc.items[0].charStart).toBe(0);
    expect(tc.items[0].charEnd).toBeGreaterThan(0);
    expect(tc.items.map((i) => i.text).join('')).toMatch(/Page 1/);
  });

  it('resolves a lazy source before loading', async () => {
    const lazy = await pdfJsEngine.load({
      kind: 'lazy',
      load: async () => ({kind: 'url', url: fixtureUrl('three-page.pdf')}),
    });
    expect(lazy.numPages).toBe(3);
    lazy.destroy();
  });
});

describe('pdfJsEngine load failure', () => {
  it('rejects on a file that is not a PDF', async () => {
    await expect(pdfJsEngine.load({kind: 'url', url: pathToFileURL(fileURLToPath(import.meta.url)).href})).rejects.toThrow();
  });
});
```

`mockEngine.test.ts`:
- Replace the first test with:
  ```ts
  it('returns the configured numPages', async () => {
    const engine = createMockEngine({numPages: 4});
    const doc = await engine.load({kind: 'url', url: 'mock.pdf'});
    expect(doc.numPages).toBe(4);
  });
  ```
- Replace every remaining `{kind: 'data', data: new Uint8Array(1)}` with `{kind: 'url', url: 'mock.pdf'}`.

`searchService.test.ts`:
- Replace the `readFileSync`, `fixturePath` and `fixtureBytes` lines, and the `beforeAll` body, with:
  ```ts
  import {pathToFileURL} from 'node:url';
  // …
  const fixtureUrl = pathToFileURL(resolve(__dirname, '../__fixtures__/three-page.pdf')).href;
  let doc: PDFDocumentHandle;

  beforeAll(async () => {
    doc = await pdfJsEngine.load({kind: 'url', url: fixtureUrl});
  });
  ```
- Remove the now-unused `readFileSync` import.

`primitives.test.tsx`:
- Replace the `fixturePath`/`fixtureBytes` declarations, and the `readFileSync` line in `beforeAll`, with:
  ```ts
  const fixtureUrl = pathToFileURL(resolve(__dirname, '../__fixtures__/three-page.pdf')).href;
  ```
  Keep the `getContext` stub in `beforeAll`.
- Error test source: `{kind: 'url' as const, url: pathToFileURL(fileURLToPath(import.meta.url)).href}`.
- Pages test source: `{kind: 'url' as const, url: fixtureUrl}`.
- Import `pathToFileURL` from `node:url` and drop `readFileSync`.

`pageContainment.test.tsx`:
- In `renderFirstPage`, render `<PrumoPdfViewer source={{kind: 'url', url: pathToFileURL(fixturePath).href}} store={store} />`.
- Import `pathToFileURL` from `node:url`.
- `firstPageSize` keeps its direct `legacyPdfjs.getDocument({data})` call: that is pdf.js's API, not ours.

`store.test.ts`:
- Add, below the imports:
  ```ts
  import type {PDFDocumentHandle} from '../core/engine';

  function stubDocument(numPages: number, onDestroy: () => void = () => {}): PDFDocumentHandle {
    return {numPages, getPage: async () => {throw new Error('stub');}, destroy: onDestroy};
  }
  ```
- Replace the four inline `stubDoc`/`setDocument({...})` object literals with:
  - `stubDocument(10)`
  - `stubDocument(3, () => {destroyed = true;})`
  - `stubDocument(5)`, twice.

- [ ] **Step 2: Run the touched tests — they still pass on the old API**

Run: `npx vitest run frontend/pdf-viewer/__tests__/engine.test.ts frontend/pdf-viewer/__tests__/mockEngine.test.ts frontend/pdf-viewer/__tests__/searchService.test.ts frontend/pdf-viewer/__tests__/primitives.test.tsx frontend/pdf-viewer/__tests__/pageContainment.test.tsx frontend/pdf-viewer/__tests__/store.test.ts`
Expected: PASS. URL sources already work, so this proves the tests no longer depend on the API about to go.

- [ ] **Step 3: Prune `core/engine.ts`**

Replace lines 1–47 (imports through `PDFDocumentHandle`) with:

```ts
import type {PDFRect} from './coordinates';
import type {PDFSource} from './source';

/**
 * Page rotation in degrees, clockwise.
 */
export type PageRotation = 0 | 90 | 180 | 270;

/**
 * The PDF engine — abstracts the rendering library. The app ships one
 * implementation, pdfjs-dist (`engines/pdfjs`); `engines/mock` drives tests.
 */
export interface PDFEngine {
  /** Load a PDF document. The caller owns the handle and calls `destroy()` on it. */
  load(source: PDFSource): Promise<PDFDocumentHandle>;
}

export interface PDFDocumentHandle {
  readonly numPages: number;
  getPage(pageNumber: number): Promise<PDFPageHandle>;
  /** Release engine resources. Idempotent. */
  destroy(): void;
}
```

Also delete the `PDFMetadata` and `OutlineNode` interfaces (old lines 90–106). Keep everything else.

- [ ] **Step 4: Shrink `core/source.ts`**

```ts
/**
 * Source descriptor for a PDF document.
 *
 * Resolving an article or a Supabase signed URL to one of these is the
 * consumer's job. Domain knowledge (article_files, MAIN role, Supabase
 * Storage) does NOT leak into the viewer — invariant from the architecture spec.
 */
export type PDFSource = PDFUrlSource | PDFLazySource;

export interface PDFUrlSource {
  kind: 'url';
  url: string;
}

/**
 * A source that resolves to a URL source on first access.
 * Used when generating a signed URL is expensive or has a TTL —
 * the consumer keeps that work outside the viewer's render path.
 */
export interface PDFLazySource {
  kind: 'lazy';
  load: () => Promise<PDFUrlSource>;
}
```

- [ ] **Step 5: Shrink the pdf.js engine**

`engines/pdfjs/source.ts`:

```ts
import type {PDFSource} from '../../core/source';

/** Resolve a source — running a lazy source's loader — to pdf.js `getDocument` params. */
export async function sourceToGetDocumentParams(source: PDFSource): Promise<{url: string}> {
  const resolved = source.kind === 'lazy' ? await source.load() : source;
  return {url: resolved.url};
}
```

`engines/pdfjs/index.ts`:

```ts
import * as pdfjs from 'pdfjs-dist';
import type {PDFDocumentHandle, PDFEngine} from '../../core/engine';
import type {PDFSource} from '../../core/source';
import {PdfJsDocumentHandle} from './document';
import {sourceToGetDocumentParams} from './source';
import {PDF_WORKER_SRC} from '@/lib/pdf-worker';

// Configure the PDF.js worker URL once on module load. The engine pulls
// pdfjs directly from `pdfjs-dist` (not from `react-pdf`, which would bundle
// a nested duplicate copy at a different version and force the worker URL
// onto the wrong module instance).
if (typeof pdfjs !== 'undefined') {
  pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
}

/** The PDF.js engine. Stateless: every resource belongs to a document handle. */
export const pdfJsEngine: PDFEngine = {
  async load(source: PDFSource): Promise<PDFDocumentHandle> {
    const proxy = await pdfjs.getDocument(await sourceToGetDocumentParams(source)).promise;
    return new PdfJsDocumentHandle(proxy);
  },
};
```

`engines/pdfjs/document.ts`:

```ts
import type {PDFDocumentProxy} from 'pdfjs-dist';
import type {PDFDocumentHandle, PDFPageHandle} from '../../core/engine';
import {PdfJsPageHandle} from './page';

export class PdfJsDocumentHandle implements PDFDocumentHandle {
  private destroyed = false;

  constructor(private readonly proxy: PDFDocumentProxy) {}

  get numPages(): number {
    return this.proxy.numPages;
  }

  async getPage(pageNumber: number): Promise<PDFPageHandle> {
    const proxy = await this.proxy.getPage(pageNumber);
    return new PdfJsPageHandle(proxy, pageNumber);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    // pdfjs-dist v6 removed PDFDocumentProxy.destroy() (it was an alias);
    // loadingTask.destroy() has the same semantics and also stops the worker.
    void this.proxy.loadingTask.destroy();
  }
}
```

- [ ] **Step 6: Prune the mock engine**

In `engines/mock/index.ts`:
- Import list: remove `LoadOptions`, `PDFMetadata`, `OutlineNode`.
- `MockEngineConfig`: remove `fingerprint`, `metadata`, `outline`.
- `MockDocumentHandle`: remove the `fingerprint` field, its constructor assignment, and the `metadata()` and `outline()` methods.
- Replace `MockEngineImpl` and `createMockEngine` with:

```ts
/**
 * Create a configurable mock PDF engine that satisfies `PDFEngine`
 * without invoking pdfjs-dist. See module docstring for usage.
 */
export function createMockEngine(cfg: MockEngineConfig = {}): PDFEngine {
  return {
    async load(_source: PDFSource): Promise<PDFDocumentHandle> {
      return new MockDocumentHandle(cfg);
    },
  };
}
```

- [ ] **Step 7: Confirm the only production source producer still type-checks**

Run: `npm run typecheck`
Expected: PASS.
- If `frontend/pdf-viewer/adapters/articleFileSource.ts` fails, its `load()` returned something other than `{kind: 'url', url}`. Make it return exactly that.
- Any other error names a leftover use of a removed symbol. Delete that use.

- [ ] **Step 8: Run the viewer tests**

Run: `npx vitest run frontend/pdf-viewer`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add frontend/pdf-viewer
git commit -m "refactor(pdf-viewer): drop unused engine API and the data source"
```

### Task 2: Intrinsic page rotation in the engine (R5, engine half)

**Files:**
- Create: `frontend/pdf-viewer/__fixtures__/rotated-page.pdf` (generated)
- Create: `frontend/pdf-viewer/core/rotation.ts`
- Test: `frontend/pdf-viewer/__tests__/rotation.test.ts` (new)
- Modify: `frontend/pdf-viewer/core/engine.ts`, `engines/pdfjs/page.ts`, `engines/mock/index.ts`
- Test: `frontend/pdf-viewer/__tests__/engine.test.ts`, `mockEngine.test.ts`

**Interfaces:**
- Consumes: Task 1's pruned engine.
- Produces:
  - `PDFPageHandle.rotation: PageRotation` — the page's own `/Rotate`.
  - `PDFPageHandle.size` — the displayed size at that rotation.
  - `RenderOptions.rotation: PageRotation` and `TextLayerRenderOptions.rotation: PageRotation` — **required**, absolute.
  - `effectiveRotation(page: {readonly rotation: PageRotation}, viewRotation: PageRotation): PageRotation`.
  - `displayedSize(size: {width: number; height: number}, viewRotation: PageRotation, zoom: number): {width: number; height: number}`.
  - `MockEngineConfig.rotation?: PageRotation` (every page's `/Rotate`; `pageSize` is then the displayed size).

- [ ] **Step 1: Generate the fixture**

Run from the worktree root:

```bash
/Users/raphael/PycharmProjects/prumo/backend/.venv/bin/python - <<'EOF'
import fitz
doc = fitz.open()
for text in ("Portrait page 1", "Landscape table page 2", "Portrait page 3"):
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 72), text, fontsize=18)
doc[1].set_rotation(90)
doc.save("frontend/pdf-viewer/__fixtures__/rotated-page.pdf", garbage=4, deflate=True)
EOF
```

Expected: the file exists. This was verified on 2026-09-15: pdf.js reports page 2 as `rotate 90`, `view [0,0,612,792]`, and a scale-1 viewport of 792×612.

- [ ] **Step 2: Write the failing tests**

`frontend/pdf-viewer/__tests__/rotation.test.ts`:

```ts
import {describe, expect, it} from 'vitest';
import {displayedSize, effectiveRotation} from '../core/rotation';

describe('effectiveRotation', () => {
  it('adds the view rotation to the page’s own /Rotate, wrapping at 360', () => {
    expect(effectiveRotation({rotation: 0}, 0)).toBe(0);
    expect(effectiveRotation({rotation: 90}, 0)).toBe(90);
    expect(effectiveRotation({rotation: 90}, 90)).toBe(180);
    expect(effectiveRotation({rotation: 270}, 180)).toBe(90);
  });
});

describe('displayedSize', () => {
  it('scales the size by zoom', () => {
    expect(displayedSize({width: 612, height: 792}, 0, 1.5)).toEqual({width: 918, height: 1188});
  });

  it('swaps width and height for a quarter view rotation only', () => {
    expect(displayedSize({width: 612, height: 792}, 90, 1)).toEqual({width: 792, height: 612});
    expect(displayedSize({width: 612, height: 792}, 180, 1)).toEqual({width: 612, height: 792});
    expect(displayedSize({width: 612, height: 792}, 270, 2)).toEqual({width: 1584, height: 1224});
  });
});
```

Append to `engine.test.ts`:

```ts
describe('intrinsic page rotation', () => {
  let doc: PDFDocumentHandle;

  beforeAll(async () => {
    doc = await pdfJsEngine.load({kind: 'url', url: fixtureUrl('rotated-page.pdf')});
  });

  it('reports a portrait page unrotated', async () => {
    const page = await doc.getPage(1);
    expect(page.rotation).toBe(0);
    expect(page.size).toEqual({width: 612, height: 792});
  });

  it('reports a /Rotate 90 page at its displayed, landscape size', async () => {
    const page = await doc.getPage(2);
    expect(page.rotation).toBe(90);
    expect(page.size).toEqual({width: 792, height: 612});
  });

  it('draws a /Rotate 90 page landscape when the view is not rotated', async () => {
    const page = await doc.getPage(2);
    const canvas = document.createElement('canvas');
    // jsdom has no 2d context. The engine sizes the canvas before pdf.js draws,
    // and pdf.js then rejects on the fake context — the size is what this checks.
    canvas.getContext = (() => ({})) as unknown as HTMLCanvasElement['getContext'];
    await page.render({canvas, scale: 1, rotation: effectiveRotation(page, 0)}).catch(() => undefined);
    expect([canvas.width, canvas.height]).toEqual([792, 612]);
  });
});
```

Also add `import {effectiveRotation} from '../core/rotation';` to its imports.

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run frontend/pdf-viewer/__tests__/rotation.test.ts frontend/pdf-viewer/__tests__/engine.test.ts`
Expected: FAIL. `rotation.test.ts` fails to resolve `../core/rotation`; the engine tests fail on `page.rotation` being `undefined` and on `page.size` being 612×792.

- [ ] **Step 4: Create `core/rotation.ts`**

```ts
import type {PageRotation} from './engine';

/** A page's rotation on screen: the PDF's own `/Rotate` plus the user's view rotation. */
export function effectiveRotation(
  page: {readonly rotation: PageRotation},
  viewRotation: PageRotation,
): PageRotation {
  return ((page.rotation + viewRotation) % 360) as PageRotation;
}

/**
 * A page's on-screen size at `zoom`. `size` is the page's displayed size at its
 * own rotation (`PDFPageHandle.size`); a quarter view rotation swaps it.
 */
export function displayedSize(
  size: {width: number; height: number},
  viewRotation: PageRotation,
  zoom: number,
): {width: number; height: number} {
  const quarterTurn = viewRotation % 180 !== 0;
  return {
    width: (quarterTurn ? size.height : size.width) * zoom,
    height: (quarterTurn ? size.width : size.height) * zoom,
  };
}
```

- [ ] **Step 5: Update the engine interface**

In `core/engine.ts`, replace the `PDFPageHandle` `pageNumber`/`size` lines:

```ts
export interface PDFPageHandle {
  readonly pageNumber: number;
  /** The page's own `/Rotate`, clockwise. */
  readonly rotation: PageRotation;
  /** Displayed size in PDF points at `rotation`: width and height are swapped for 90/270. */
  readonly size: {width: number; height: number};
```

In both `TextLayerRenderOptions` and `RenderOptions`, replace `rotation?: PageRotation;` with:

```ts
  /** Absolute rotation to draw at: `effectiveRotation(page, viewRotation)`. */
  rotation: PageRotation;
```

- [ ] **Step 6: Implement it in the pdf.js page handle**

In `engines/pdfjs/page.ts`:
- Add `PageRotation` to the type import from `../../core/engine`.
- Replace the `size` getter with:

```ts
  get rotation(): PageRotation {
    return this.proxy.rotate as PageRotation;
  }

  get size(): {width: number; height: number} {
    // A viewport without an explicit rotation uses the page's own /Rotate.
    const {width, height} = this.proxy.getViewport({scale: 1});
    return {width, height};
  }
```

- In `render`, replace the `getViewport` call with:
  `const viewport = this.proxy.getViewport({scale: opts.scale, rotation: opts.rotation});`
- In `renderTextLayer`, replace it with:
  `const viewport = this.proxy.getViewport({scale, rotation});`

- [ ] **Step 7: Implement it in the mock engine**

In `engines/mock/index.ts`:
- Import `PageRotation`.
- Add to `MockEngineConfig`:

```ts
  /** Every page's own `/Rotate`; `pageSize` is then the displayed size at it. */
  rotation?: PageRotation;
```

- In `MockPageHandle`, add a `readonly rotation: PageRotation;` field and set `this.rotation = cfg.rotation ?? 0;` in the constructor.
- Replace the size lines in `render` with:

```ts
    // The drawn size turns only for the part of the rotation that is not the page's own.
    const quarterTurn = (opts.rotation - this.rotation) % 180 !== 0;
    const w = Math.floor((quarterTurn ? this.size.height : this.size.width) * opts.scale);
    const h = Math.floor((quarterTurn ? this.size.width : this.size.height) * opts.scale);
```

In `mockEngine.test.ts`, add `rotation: 0` to all three option objects: the two `page.render({...})` calls and the `page.renderTextLayer({...})` call.

- [ ] **Step 8: Run tests and typecheck**

Run: `npx vitest run frontend/pdf-viewer/__tests__/rotation.test.ts frontend/pdf-viewer/__tests__/engine.test.ts frontend/pdf-viewer/__tests__/mockEngine.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS. `CanvasLayer`/`TextLayer` still pass the store's `rotation` (a `PageRotation`), which type-checks; Task 3 makes it correct.

- [ ] **Step 9: Commit**

```bash
git add frontend/pdf-viewer
git commit -m "fix(pdf-viewer): honour each page's own /Rotate in size and rendering"
```

### Task 3: View rotation in the store, its consumers, and a Rotate view button (R5, UI half)

**Files:**
- Modify: `frontend/pdf-viewer/core/state.ts`, `core/store.ts`, `primitives/CanvasLayer.tsx`, `primitives/TextLayer.tsx`, `primitives/Viewer.tsx`, `ui/Toolbar.tsx`, `frontend/lib/copy/pdf.ts`
- Test: `frontend/pdf-viewer/__tests__/store.test.ts`, `canvas-layer.test.tsx`, `pageContainment.test.tsx`, `frontend/pdf-viewer/ui/__tests__/Toolbar.test.tsx`

**Interfaces:**
- Consumes: `effectiveRotation`, `displayedSize` (Task 2); `MockEngineConfig.rotation`.
- Produces: `ViewerState.viewRotation: PageRotation` (default 0); `ViewerActions.rotateView(): void`; copy key `pdf.viewerRotateView`. `setRotation` and `rotation` are gone.

- [ ] **Step 1: Write the failing tests**

`store.test.ts`:
- In the initial-state test, replace `expect(state.rotation).toBe(0);` with `expect(state.viewRotation).toBe(0);`.
- Append inside `describe('createViewerStore')`:

```ts
  it('rotateView turns the view 90° clockwise and wraps after 270', () => {
    const store = createViewerStore();
    const turns = [1, 2, 3, 4].map(() => {
      store.getState().actions.rotateView();
      return store.getState().viewRotation;
    });
    expect(turns).toEqual([90, 180, 270, 0]);
  });
```

`canvas-layer.test.tsx` — replace the whole file:

```tsx
import {render, waitFor} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {ViewerProvider} from '../core/context';
import {createViewerStore} from '../core/store';
import type {PageRotation} from '../core/engine';
import {createMockEngine} from '../engines/mock';
import {CanvasLayer} from '../primitives/CanvasLayer';

/**
 * The CSS size and the render options when the first render starts. The canvas
 * backing store is DPR-scaled; without an explicit CSS size the canvas lays out
 * at that backing size — DPR× too large until the render resolves — so the CSS
 * size must be in place before rendering starts.
 */
async function atRenderStart(opts: {
  scale: number;
  viewRotation: PageRotation;
  pageRotation?: PageRotation;
  pageSize?: {width: number; height: number};
}) {
  const seen: {cssWidth: string; cssHeight: string; renderScale: number; rotation: PageRotation}[] = [];
  const engine = createMockEngine({
    numPages: 1,
    pageSize: opts.pageSize ?? {width: 600, height: 800},
    rotation: opts.pageRotation ?? 0,
    onRender: (_page, {canvas, scale, rotation}) => {
      const {style} = canvas as HTMLCanvasElement;
      seen.push({cssWidth: style.width, cssHeight: style.height, renderScale: scale, rotation});
    },
  });
  const store = createViewerStore({scale: opts.scale, viewRotation: opts.viewRotation});
  store.getState().actions.setDocument(await engine.load({kind: 'url', url: 'mock.pdf'}));

  render(
    <ViewerProvider store={store}>
      <CanvasLayer pageNumber={1} />
    </ViewerProvider>,
  );
  await waitFor(() => expect(seen).toHaveLength(1));
  return seen[0];
}

describe('<CanvasLayer>', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sizes the canvas in CSS pixels before the render is invoked on a HiDPI screen', async () => {
    vi.stubGlobal('devicePixelRatio', 2);
    const start = await atRenderStart({scale: 1.5, viewRotation: 0});
    // Precondition: the backing store really is DPR-scaled.
    expect(start.renderScale).toBe(3);
    expect(start).toMatchObject({cssWidth: '900px', cssHeight: '1200px', rotation: 0});
  });

  it('swaps the CSS width and height for a quarter view rotation', async () => {
    const start = await atRenderStart({scale: 1.5, viewRotation: 90});
    expect(start).toMatchObject({cssWidth: '1200px', cssHeight: '900px', rotation: 90});
  });

  it('draws a /Rotate 90 page at 90° and landscape with no view rotation', async () => {
    const start = await atRenderStart({scale: 1.5, viewRotation: 0, pageRotation: 90, pageSize: {width: 800, height: 600}});
    expect(start).toMatchObject({cssWidth: '1200px', cssHeight: '900px', rotation: 90});
  });

  it('adds the view rotation to the page’s own rotation', async () => {
    const start = await atRenderStart({scale: 1.5, viewRotation: 90, pageRotation: 90, pageSize: {width: 800, height: 600}});
    expect(start).toMatchObject({cssWidth: '900px', cssHeight: '1200px', rotation: 180});
  });
});
```

`pageContainment.test.tsx`: replace `createViewerStore({scale: 1.5, rotation: 90})` with `createViewerStore({scale: 1.5, viewRotation: 90})`.

`Toolbar.test.tsx` — append:

```tsx
describe('<Toolbar> rotate view', () => {
  it('turns the view 90° clockwise per click', async () => {
    const user = userEvent.setup();
    const store = renderToolbar('canvas');
    await user.click(screen.getByLabelText('Rotate view'));
    expect(store.getState().viewRotation).toBe(90);
  });

  it('is hidden in reader mode (no page surface to rotate)', () => {
    renderToolbar('reader');
    expect(screen.queryByLabelText('Rotate view')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run frontend/pdf-viewer/__tests__/store.test.ts frontend/pdf-viewer/__tests__/canvas-layer.test.tsx frontend/pdf-viewer/ui/__tests__/Toolbar.test.tsx`
Expected: FAIL. `viewRotation` is undefined, `rotateView` is not a function, the canvas gets rotation 0 for a `/Rotate 90` page, and there is no "Rotate view" label.

- [ ] **Step 3: Store**

`core/state.ts`:
- Replace the `rotation: PageRotation;` line with:
  ```ts
    /** The user's rotation of the whole view, clockwise — added to each page's own `/Rotate`. */
    viewRotation: PageRotation;
  ```
- Replace `setRotation(rotation: PageRotation): void;` with:
  ```ts
    /** Turn the view 90° clockwise. */
    rotateView(): void;
  ```

`core/store.ts`:
- In `initialData`, replace `rotation: 0,` with `viewRotation: 0,`.
- Replace the `setRotation` action with:
  ```ts
        rotateView() {
          set({viewRotation: ((get().viewRotation + 90) % 360) as PageRotation});
        },
  ```

- [ ] **Step 4: Consumers**

`primitives/CanvasLayer.tsx` — replace the component body with:

```tsx
export function CanvasLayer({pageNumber, className}: CanvasLayerProps) {
  const page = usePageHandle(pageNumber);
  const scale = useViewerStore((s) => s.scale);
  const viewRotation = useViewerStore((s) => s.viewRotation);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!page || !canvas) return;

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const renderScale = scale * dpr;

    // Display size in CSS pixels, set BEFORE rendering: the engine sizes the
    // DPR-scaled backing store up front, and a canvas without a CSS size lays
    // out at its backing size — DPR× too large until the render resolves.
    const {width, height} = displayedSize(page.size, viewRotation, scale);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const controller = new AbortController();
    page
      .render({canvas, scale: renderScale, rotation: effectiveRotation(page, viewRotation), signal: controller.signal})
      .catch((err) => {
        if ((err as DOMException).name !== 'AbortError') {
          console.warn(`CanvasLayer page ${pageNumber} render failed:`, err);
        }
      });

    return () => controller.abort();
  }, [page, scale, viewRotation, pageNumber]);

  return <canvas ref={canvasRef} className={className} role="img" aria-label={`PDF page ${pageNumber}`} />;
}
```

Add `import {displayedSize, effectiveRotation} from '../core/rotation';`.

`primitives/TextLayer.tsx`:
- Replace `const rotation = useViewerStore((s) => s.rotation);` with `const viewRotation = useViewerStore((s) => s.viewRotation);`.
- Change the render call to `.renderTextLayer({container, scale: renderScale, rotation: effectiveRotation(page, viewRotation), signal: ctrl.signal})`.
- In that effect's dependency array, replace `rotation` with `viewRotation`.
- Import `effectiveRotation` from `../core/rotation`.

`primitives/Viewer.tsx` `Page`:
- Replace `const rotation = useViewerStore((s) => s.rotation);` with `const viewRotation = useViewerStore((s) => s.viewRotation);`.
- Replace the `if (handle) {…}` block with:

```tsx
  if (handle) {
    const {width, height} = displayedSize(handle.size, viewRotation, scale);
    style = {contentVisibility: 'auto', containIntrinsicSize: `auto ${width}px auto ${height}px`};
  }
```

- Import `displayedSize` from `../core/rotation`.
- In the comment above, change "turned for a quarter rotation" to "turned for a quarter view rotation (`displayedSize`)".

- [ ] **Step 5: Rotate view button**

`frontend/lib/copy/pdf.ts`: after `viewerZoomLevel`, add:

```ts
    viewerRotateView: 'Rotate view',
```

`ui/Toolbar.tsx`:
- Change the lucide import to `import {BookOpenText, RotateCw, Search} from 'lucide-react';`.
- Replace `{!isReader && <ZoomControls />}`, together with its comment, with:

```tsx
          {/* Rotation and zoom act on the PDF canvas; the reader is typography,
              not a page surface, so both are hidden in reader mode. */}
          {!isReader && (
            <>
              <IconButton
                label={t('pdf', 'viewerRotateView')}
                side="bottom"
                onClick={() => storeApi.getState().actions.rotateView()}
                icon={<RotateCw strokeWidth={1.5} />}
              />
              <ZoomControls />
            </>
          )}
```

- [ ] **Step 6: Run tests, typecheck and the copy gate**

Run: `npx vitest run frontend/pdf-viewer`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS.

Run: `python3 scripts/fitness/check_copy_keys.py`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/pdf-viewer frontend/lib/copy/pdf.ts
git commit -m "feat(pdf-viewer): rotate the view on top of each page's own rotation"
```

### Task 4: Public surface = what the app imports; knip sees inside the viewer (R1, R2, R6)

**Files:**
- Modify: `frontend/pdf-viewer/index.ts`, `frontend/pdf-viewer/core/index.ts`, `knip.jsonc`
- Delete: `frontend/pdf-viewer/core/types.ts`, `frontend/pdf-viewer/primitives/index.ts`, `frontend/pdf-viewer/ui/index.ts` (verified 2026-09-15: only `index.ts` and `core/index.ts` import them)
- Test: `frontend/pdf-viewer/__tests__/scaffolding.test.ts`

**Interfaces:**
- Produces:
  - `@prumo/pdf-viewer` exports exactly `PrumoPdfViewer`, `createViewerStore`, `subscribeReaderLocate`, `articleFileSourceFromStorageKey` and `type ViewerState`.
  - `@/pdf-viewer/core` exports `createViewerStore`, `subscribeReaderLocate`, `ViewerProvider` and `type ViewerState`. These serve `RunSplitShell.tsx:12`, `RunSplitShell.test.tsx`, and the 8 `frontend/test/*FullScreen*.test.tsx` mocks that spread `importActual('@/pdf-viewer/core')`.

- [ ] **Step 1: Write the failing test**

Replace the three `it` blocks of `scaffolding.test.ts` (keep its mocks and module-scope import) with:

```ts
describe('@prumo/pdf-viewer public API', () => {
  it('exports exactly what the app imports', () => {
    expect(Object.keys(mod).sort()).toEqual([
      'PrumoPdfViewer',
      'articleFileSourceFromStorageKey',
      'createViewerStore',
      'subscribeReaderLocate',
    ]);
  });

  it('createViewerStore returns a vanilla Zustand store', () => {
    const store = mod.createViewerStore();
    expect(typeof store.getState).toBe('function');
    expect(typeof store.setState).toBe('function');
    expect(typeof store.subscribe).toBe('function');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run frontend/pdf-viewer/__tests__/scaffolding.test.ts`
Expected: FAIL. The key list also contains `CanvasLayer`, `ErrorState`, `LoadingState`, `NavigationControls`, `TextLayer`, `Toolbar`, `ViewerProvider`, `Viewer`, `ZoomControls`, `useDocumentLoader`, `usePageHandle`, `useViewerStore`, `useViewerStoreApi`.

- [ ] **Step 3: Narrow the barrels**

`frontend/pdf-viewer/index.ts`:

```ts
/**
 * `@prumo/pdf-viewer` — the viewer's public surface: exactly what the app
 * imports. Modules inside the viewer import each other by path.
 */
export {createViewerStore, subscribeReaderLocate, type ViewerState} from './core';
export {PrumoPdfViewer} from './PrumoPdfViewer';
export {articleFileSourceFromStorageKey} from './adapters/articleFileSource';
```

`frontend/pdf-viewer/core/index.ts`:

```ts
/**
 * The engine-free core. `RunSplitShell` imports `ViewerProvider` from here so
 * its module graph never pulls in pdf.js, and the app's page tests mock
 * `@prumo/pdf-viewer` with this module.
 */
export type {ViewerState} from './state';
export {createViewerStore} from './store';
export {subscribeReaderLocate} from './subscribeReaderLocate';
export {ViewerProvider} from './context';
```

Then delete the three files:

```bash
git rm frontend/pdf-viewer/core/types.ts frontend/pdf-viewer/primitives/index.ts frontend/pdf-viewer/ui/index.ts
```

- [ ] **Step 4: Stop exempting the viewer from production-mode knip**

In `knip.jsonc`, replace the `frontend/pdf-viewer/index.ts` bullet of the "Entry points" comment and the `"entry"` line with:

```jsonc
  // - frontend/pdf-viewer/index.ts: the `@prumo/pdf-viewer` package boundary
  //   (aliased in tsconfig.json, tsconfig.app.json, vite.config.ts and
  //   vitest.config.ts). It exports only what the app imports, so it needs no
  //   production-mode exemption: an export the app stops using is reported.
  "entry": ["scripts/*.mjs", "frontend/pdf-viewer/index.ts"],
```

- [ ] **Step 5: Run the test, typecheck, and both knip modes**

Run: `npx vitest run frontend/pdf-viewer/__tests__/scaffolding.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS.

Run: `npx knip --no-tag-hints`
Expected: 0 findings.

Run: `npx knip --production --no-tag-hints`
Expected: 0 findings. Any finding is an export inside `frontend/pdf-viewer/` that the old `!` entry hid. Triage it in the order `.claude/rules/frontend.md` § Dead code gives (in-file use, duplicate, orphan → delete code and test, `@internal` seam). Delete orphans in this task and re-run until 0.

- [ ] **Step 6: Run the app tests that mock the viewer**

Run: `npx vitest run frontend/test frontend/components/runs/RunSplitShell.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A frontend/pdf-viewer knip.jsonc
git commit -m "refactor(pdf-viewer): export only what the app imports and let knip see the viewer"
```

### Task 5: Search bar copy, README, Phase 0 gate (R7, R8)

**Files:**
- Modify: `frontend/pdf-viewer/ui/SearchBar.tsx`, `frontend/lib/copy/pdf.ts`, `frontend/pdf-viewer/README.md`
- Test: `frontend/pdf-viewer/ui/__tests__/SearchBar.test.tsx` (existing, asserts `No results` and `Search query` — must stay green)

**Interfaces:**
- Produces: copy keys `pdf.viewerSearchPlaceholder`, `pdf.viewerSearchQueryLabel`, `pdf.viewerSearchSearching`, `pdf.viewerSearchNoResults`.

- [ ] **Step 1: Add the copy keys**

In `frontend/lib/copy/pdf.ts`, after `viewerSearchClose`:

```ts
    viewerSearchPlaceholder: 'Find in document',
    viewerSearchQueryLabel: 'Search query',
    viewerSearchSearching: 'Searching…',
    viewerSearchNoResults: 'No results',
```

- [ ] **Step 2: Use them in `SearchBar.tsx`**

Replace the `positionLabel` expression with:

```tsx
  const positionLabel =
    matchCount === 0
      ? search.searching
        ? t('pdf', 'viewerSearchSearching')
        : search.query
          ? t('pdf', 'viewerSearchNoResults')
          : ''
      : `${search.activeIndex + 1} / ${matchCount}`;
```

On the `<Input>`, set `placeholder={t('pdf', 'viewerSearchPlaceholder')}` and `aria-label={t('pdf', 'viewerSearchQueryLabel')}`.

- [ ] **Step 3: Run the search bar tests and the copy gate**

Run: `npx vitest run frontend/pdf-viewer/ui/__tests__/SearchBar.test.tsx`
Expected: PASS (same strings, now from copy).

Run: `python3 scripts/fitness/check_copy_keys.py`
Expected: PASS.

- [ ] **Step 4: Rewrite `frontend/pdf-viewer/README.md`**

Replace the whole file with:

````markdown
---
status: stable
last_reviewed: 2026-09-15
owner: '@raphaelfh'
---

# @prumo/pdf-viewer

The PDF viewer on the extraction and quality-assessment screens: pdf.js pages
with a text layer and find-in-document, plus a parsed-text (markdown) reader.

## Public API

Imported through the `@prumo/pdf-viewer` alias (`index.ts`); nothing else is exported.

| Export | Use |
|---|---|
| `PrumoPdfViewer` | The all-in-one viewer: toolbar, search, canvas pages, reader mode. |
| `createViewerStore()` | A fresh, isolated store. Pass it as `store` to share it with a sibling panel. |
| `subscribeReaderLocate(store, listener)` | React to citation-locate requests outside the viewer. |
| `articleFileSourceFromStorageKey(key)` | A lazy `PDFSource` that signs a Supabase Storage URL on first load. |
| `type ViewerState` | The store's state. |

`@/pdf-viewer/core` (engine-free) also exports `ViewerProvider`, for a parent
that owns the store without importing pdf.js.

## Modules

```text
frontend/pdf-viewer/
├── core/          store, context, state, engine interface, rotation helpers
├── engines/pdfjs/ pdfjs-dist 6: load, page render, text layer
├── engines/mock/  in-memory engine for tests
├── hooks/         useDocumentLoader, usePageHandle, usePageScrollSync
├── primitives/    Viewer, CanvasLayer, TextLayer, Reader and its helpers
├── markdown/      the reader's markdown rendering
├── services/      searchService (canvas find-in-document)
├── adapters/      articleFileSource
├── ui/            Toolbar, NavigationControls, ZoomControls, SearchBar, states
└── index.ts       the public API above
```

## Rotation

A page handle's `rotation` is the PDF's own `/Rotate`, and its `size` is the
size the page displays at, so a landscape table page is landscape. The store's
`viewRotation` (toolbar: Rotate view) turns every page on top of that. Draw with
`effectiveRotation(page, viewRotation)` and size boxes with `displayedSize`
(`core/rotation.ts`).
````

- [ ] **Step 5: Commit**

```bash
git add frontend/pdf-viewer frontend/lib/copy/pdf.ts
git commit -m "chore(pdf-viewer): route search bar text through copy and rewrite the README"
```

- [ ] **Step 6: Phase 0 gate**

Run every command in Global Constraints § Phase gate.
Expected: typecheck, lint and tests PASS; both knip modes 0; the copy gate PASS. Record each result. Stop and fix on any failure before Phase 1.

# Phase 1 — only pages near the viewport render (R9–R13)

Branch: `feat/pdf-viewer-phase1-virtual-pages` from `origin/dev`, after the Phase 0 PR merged.

### Task 6: Page sizes in the store; page 1's size known at load

**Files:**
- Modify: `frontend/pdf-viewer/core/state.ts`, `core/store.ts`, `hooks/useDocumentLoader.ts`
- Test: `frontend/pdf-viewer/__tests__/store.test.ts`, `frontend/pdf-viewer/__tests__/document-loader.test.tsx` (new)

**Interfaces:**
- Produces:
  - `interface PageSize {width: number; height: number}`, exported from `core/state.ts`.
  - `ViewerState.pageSizes: Readonly<Record<number, PageSize>>` (default `{}`; `setDocument` resets it).
  - `ViewerActions.setPageSize(pageNumber: number, size: PageSize): void` — a no-op when unchanged.
  - `useDocumentLoader` sets `pageSizes[1]` before `loadStatus` becomes `ready`.

- [ ] **Step 1: Write the failing tests**

Append to `store.test.ts` inside `describe('createViewerStore')`:

```ts
  it('setPageSize records a page size and keeps the object when unchanged', () => {
    const store = createViewerStore();
    store.getState().actions.setPageSize(2, {width: 792, height: 612});
    const recorded = store.getState().pageSizes;
    expect(recorded[2]).toEqual({width: 792, height: 612});
    store.getState().actions.setPageSize(2, {width: 792, height: 612});
    expect(store.getState().pageSizes).toBe(recorded);
  });

  it('setDocument forgets the previous document’s page sizes', () => {
    const store = createViewerStore();
    store.getState().actions.setPageSize(1, {width: 612, height: 792});
    store.getState().actions.setDocument(stubDocument(3));
    expect(store.getState().pageSizes).toEqual({});
  });
```

Create `frontend/pdf-viewer/__tests__/document-loader.test.tsx`:

```tsx
import {renderHook, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import {describe, expect, it, vi} from 'vitest';

// useDocumentLoader imports the pdf.js engine as its default.
import * as legacyPdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
vi.mock('pdfjs-dist', () => legacyPdfjs);

import {ViewerProvider} from '../core/context';
import {createViewerStore} from '../core/store';
import {createMockEngine} from '../engines/mock';

const {useDocumentLoader} = await import('../hooks/useDocumentLoader');

describe('useDocumentLoader', () => {
  it('knows page 1’s size by the time the document is ready', async () => {
    const store = createViewerStore();
    const sizesWhenReady: unknown[] = [];
    store.subscribe((state, prev) => {
      if (state.loadStatus === 'ready' && prev.loadStatus !== 'ready') sizesWhenReady.push(state.pageSizes[1]);
    });
    const engine = createMockEngine({numPages: 3, pageSize: {width: 500, height: 700}});
    const source = {kind: 'url' as const, url: 'mock.pdf'};
    const wrapper = ({children}: {children: ReactNode}) => <ViewerProvider store={store}>{children}</ViewerProvider>;

    renderHook(() => useDocumentLoader({source, engine}), {wrapper});

    await waitFor(() => expect(store.getState().loadStatus).toBe('ready'));
    expect(sizesWhenReady).toEqual([{width: 500, height: 700}]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run frontend/pdf-viewer/__tests__/store.test.ts frontend/pdf-viewer/__tests__/document-loader.test.tsx`
Expected: FAIL. `setPageSize` is not a function, and `pageSizes` is undefined.

- [ ] **Step 3: Store**

`core/state.ts`:
- Add above `ViewerState`:

```ts
/** A page's displayed size in PDF points, at its own rotation (`PDFPageHandle.size`). */
export interface PageSize {
  width: number;
  height: number;
}
```

- In `ViewerState`, after `numPages`:

```ts
  /**
   * Sizes of the pages whose handle has resolved, keyed by page number. Page 1
   * is known before `loadStatus` turns `ready`; the layout estimates the rest
   * from it until they mount.
   */
  pageSizes: Readonly<Record<number, PageSize>>;
```

- In `ViewerActions`, after `setLoadStatus`:

```ts
  /** Record a page's displayed size; a no-op when unchanged. */
  setPageSize(pageNumber: number, size: PageSize): void;
```

`core/store.ts`:
- Add `pageSizes: {},` to `initialData` after `numPages: 0,`.
- Replace `setDocument`, and add `setPageSize` after `setLoadStatus`:

```ts
      setDocument(doc: PDFDocumentHandle | null) {
        set({
          document: doc,
          numPages: doc?.numPages ?? 0,
          pageSizes: {},
        });
      },
```

```ts
      setPageSize(pageNumber: number, size: PageSize) {
        const known = get().pageSizes[pageNumber];
        if (known?.width === size.width && known?.height === size.height) return;
        set({pageSizes: {...get().pageSizes, [pageNumber]: {width: size.width, height: size.height}}});
      },
```

- Import `PageSize` in the type import from `./state`.

- [ ] **Step 4: Loader**

In `hooks/useDocumentLoader.ts`, replace the `.then((doc) => {…})` callback with:

```ts
      .then(async (doc) => {
        // Page 1's size is the layout's estimate for every page not yet
        // mounted, so it is known before the pages render.
        const first = await doc.getPage(1);
        const size = first.size;
        first.cleanup();
        if (cancelled) {
          doc.destroy();
          return;
        }
        actions.setDocument(doc);
        actions.setPageSize(1, size);
        actions.setLoadStatus('ready');
      })
```

- [ ] **Step 5: Run the viewer tests**

Run: `npx vitest run frontend/pdf-viewer`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/pdf-viewer
git commit -m "feat(pdf-viewer): record page sizes in the store, page 1 before ready"
```

### Task 7: The pure page layout (R9)

**Files:**
- Create: `frontend/pdf-viewer/viewport/usePageLayout.ts`
- Test: `frontend/pdf-viewer/viewport/__tests__/usePageLayout.test.ts`

**Interfaces:**
- Consumes: `displayedSize` (Task 2), `PageSize`, `pageSizes` (Task 6).
- Produces:

```ts
export const PAGE_GAP = 16;
export interface PageLayout {
  readonly numPages: number;
  readonly zoom: number;
  readonly viewRotation: PageRotation;
  readonly gap: number;          // PAGE_GAP * zoom
  sizeOf(page: number): PageSize; // on-screen size at zoom
  offsetOf(page: number): number; // content y of the page top
  pageAt(scrollTop: number, viewportHeight: number): number;
  readonly totalHeight: number;
  readonly naturalWidth: number; // widest page + 2 gaps, at zoom 1
  readonly width: number;        // naturalWidth * zoom
}
export function createPageLayout(input: {numPages: number; pageSizes: Readonly<Record<number, PageSize>>; viewRotation: PageRotation; zoom: number}): PageLayout;
export function usePageLayout(): PageLayout; // reads numPages, pageSizes, viewRotation, scale from the store
```

- [ ] **Step 1: Write the failing test**

`frontend/pdf-viewer/viewport/__tests__/usePageLayout.test.ts`:

```ts
import {describe, expect, it} from 'vitest';
import {PAGE_GAP, createPageLayout} from '../usePageLayout';

const letter = {width: 612, height: 792};
const landscape = {width: 792, height: 612};

describe('createPageLayout', () => {
  it('stacks pages with a gap above, between and below', () => {
    const layout = createPageLayout({numPages: 3, pageSizes: {1: letter}, viewRotation: 0, zoom: 1});
    expect(layout.offsetOf(1)).toBe(PAGE_GAP);
    expect(layout.offsetOf(2)).toBe(PAGE_GAP + 792 + PAGE_GAP);
    expect(layout.totalHeight).toBe(PAGE_GAP + 3 * (792 + PAGE_GAP));
  });

  it('estimates unknown pages from page 1 and uses a size once it is known', () => {
    const estimated = createPageLayout({numPages: 3, pageSizes: {1: letter}, viewRotation: 0, zoom: 1});
    const known = createPageLayout({numPages: 3, pageSizes: {1: letter, 2: landscape}, viewRotation: 0, zoom: 1});
    expect(estimated.sizeOf(2)).toEqual(letter);
    expect(known.sizeOf(2)).toEqual(landscape);
    expect(known.offsetOf(3) - estimated.offsetOf(3)).toBe(612 - 792);
  });

  it('turns every page for a quarter view rotation', () => {
    const layout = createPageLayout({numPages: 2, pageSizes: {1: letter, 2: landscape}, viewRotation: 90, zoom: 1});
    expect(layout.sizeOf(1)).toEqual(landscape);
    expect(layout.sizeOf(2)).toEqual(letter);
  });

  it('scales sizes, offsets, gaps and width with zoom', () => {
    const input = {numPages: 3, pageSizes: {1: letter, 3: landscape}, viewRotation: 0 as const};
    const one = createPageLayout({...input, zoom: 1});
    const two = createPageLayout({...input, zoom: 2});
    for (const page of [1, 2, 3]) expect(two.offsetOf(page)).toBe(one.offsetOf(page) * 2);
    expect(two.totalHeight).toBe(one.totalHeight * 2);
    expect(two.gap).toBe(PAGE_GAP * 2);
    expect(two.width).toBe(one.width * 2);
  });

  it('measures the content width from the widest page', () => {
    const layout = createPageLayout({numPages: 2, pageSizes: {1: letter, 2: landscape}, viewRotation: 0, zoom: 1.5});
    expect(layout.naturalWidth).toBe(792 + 2 * PAGE_GAP);
    expect(layout.width).toBe((792 + 2 * PAGE_GAP) * 1.5);
  });

  describe('pageAt', () => {
    const VIEWPORT = 725;

    it('round-trips offsetOf for every page', () => {
      const layout = createPageLayout({numPages: 14, pageSizes: {1: {width: 595, height: 842}}, viewRotation: 0, zoom: 1});
      for (let page = 1; page <= 14; page++) expect(layout.pageAt(layout.offsetOf(page), VIEWPORT)).toBe(page);
    });

    it('round-trips with mixed sizes, a rotated view and a zoom', () => {
      const layout = createPageLayout({numPages: 5, pageSizes: {1: letter, 2: landscape, 4: landscape}, viewRotation: 270, zoom: 1.75});
      for (let page = 1; page <= 5; page++) expect(layout.pageAt(layout.offsetOf(page), VIEWPORT)).toBe(page);
    });

    it('picks the page whose top is nearest the top edge within the upper half', () => {
      const layout = createPageLayout({numPages: 14, pageSizes: {1: {width: 595, height: 842}}, viewRotation: 0, zoom: 1});
      // Page 3's top 300px below the edge beats page 2's top 558px above it.
      expect(layout.pageAt(layout.offsetOf(3) - 300, VIEWPORT)).toBe(3);
      // Halfway down page 2, page 3's top is below the upper half.
      expect(layout.pageAt(layout.offsetOf(2) + 421, VIEWPORT)).toBe(2);
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run frontend/pdf-viewer/viewport/__tests__/usePageLayout.test.ts`
Expected: FAIL (cannot resolve `../usePageLayout`).

- [ ] **Step 3: Implement**

`frontend/pdf-viewer/viewport/usePageLayout.ts`:

```ts
/**
 * Where every page of the canvas view sits, computed from page sizes alone —
 * no DOM — so a page that is not mounted still has a position. Pages the
 * viewer has not opened yet are estimated from page 1. Gaps scale with zoom,
 * like the pages, so zooming scales the whole column uniformly.
 */
import {useMemo} from 'react';
import {useViewerStore} from '../core/context';
import type {PageRotation} from '../core/engine';
import {displayedSize} from '../core/rotation';
import type {PageSize} from '../core/state';

/** Space above, between and below pages at zoom 1, in CSS px. */
export const PAGE_GAP = 16;

export interface PageLayout {
  readonly numPages: number;
  readonly zoom: number;
  readonly viewRotation: PageRotation;
  /** `PAGE_GAP` at this zoom. */
  readonly gap: number;
  /** On-screen size of `page` (1-based): its known size, or page 1's as the estimate. */
  sizeOf(page: number): PageSize;
  /** Distance from the top of the content to the top of `page`. */
  offsetOf(page: number): number;
  /** Among the pages showing in the viewport's upper half, the one whose top is nearest `scrollTop`. */
  pageAt(scrollTop: number, viewportHeight: number): number;
  readonly totalHeight: number;
  /** Widest page plus its side gaps, at zoom 1 — what fit width divides by. */
  readonly naturalWidth: number;
  /** `naturalWidth` at this zoom. */
  readonly width: number;
}

export function createPageLayout({
  numPages,
  pageSizes,
  viewRotation,
  zoom,
}: {
  numPages: number;
  pageSizes: Readonly<Record<number, PageSize>>;
  viewRotation: PageRotation;
  zoom: number;
}): PageLayout {
  const estimate = pageSizes[1] ?? {width: 0, height: 0};
  const gap = PAGE_GAP * zoom;
  const sizes: PageSize[] = [];
  const offsets: number[] = [];
  let y = gap;
  let widest = 0;
  for (let page = 1; page <= numPages; page++) {
    const size = displayedSize(pageSizes[page] ?? estimate, viewRotation, zoom);
    sizes.push(size);
    offsets.push(y);
    y += size.height + gap;
    widest = Math.max(widest, size.width);
  }
  const naturalWidth = widest / zoom + 2 * PAGE_GAP;

  return {
    numPages,
    zoom,
    viewRotation,
    gap,
    sizeOf: (page) => sizes[page - 1],
    offsetOf: (page) => offsets[page - 1],
    totalHeight: numPages > 0 ? y : 0,
    naturalWidth,
    width: naturalWidth * zoom,
    pageAt(scrollTop, viewportHeight) {
      // The first page whose bottom edge is below scrollTop…
      let lo = 0;
      let hi = numPages - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (offsets[mid] + sizes[mid].height <= scrollTop) lo = mid + 1;
        else hi = mid;
      }
      // …then every page whose top is still inside the upper half.
      const halfway = scrollTop + viewportHeight / 2;
      let best = lo + 1;
      let bestDistance = Infinity;
      for (let i = lo; i < numPages && offsets[i] < halfway; i++) {
        const distance = Math.abs(offsets[i] - scrollTop);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = i + 1;
        }
      }
      return best;
    },
  };
}

/** The layout of the current document at the store's zoom and view rotation. */
export function usePageLayout(): PageLayout {
  const numPages = useViewerStore((s) => s.numPages);
  const pageSizes = useViewerStore((s) => s.pageSizes);
  const viewRotation = useViewerStore((s) => s.viewRotation);
  const zoom = useViewerStore((s) => s.scale);
  return useMemo(
    () => createPageLayout({numPages, pageSizes, viewRotation, zoom}),
    [numPages, pageSizes, viewRotation, zoom],
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run frontend/pdf-viewer/viewport/__tests__/usePageLayout.test.ts`
Expected: PASS.

Do not run knip yet: `usePageLayout` has no production caller until Task 8.

- [ ] **Step 5: Commit**

```bash
git add frontend/pdf-viewer/viewport
git commit -m "feat(pdf-viewer): pure page layout for the canvas view"
```

### Task 8: Page ⇄ scroll sync over an injected `PageLocator` (R12)

**Files:**
- Modify: `frontend/pdf-viewer/hooks/usePageScrollSync.ts`, `frontend/pdf-viewer/viewport/usePageLayout.ts`, `frontend/pdf-viewer/primitives/Viewer.tsx` (`Body`), `frontend/pdf-viewer/primitives/Reader.tsx` (`ReaderInteractions`)
- Test: `frontend/pdf-viewer/__tests__/page-scroll-sync.test.tsx` (rewrite)

**Interfaces:**
- Consumes: `PageLayout`, `usePageLayout` (Task 7).
- Produces:

```ts
// hooks/usePageScrollSync.ts
export interface PageLocator {
  offsetOf(page: number, root: HTMLElement, scroller: HTMLElement): number | null;
  pageAt(root: HTMLElement, scroller: HTMLElement): number | null;
  onScroll(root: HTMLElement, scroller: HTMLElement, listener: () => void): () => void;
}
export function createDomPageLocator(pageAttribute: string): PageLocator;
export function usePageScrollSync(opts: {
  rootRef: RefObject<HTMLElement | null>;
  scrollerSelector: string;
  locator: PageLocator;
  pagesKey: unknown;
}): (scroller: HTMLElement, top: number) => void;
// viewport/usePageLayout.ts
export function layoutPageLocator(layout: PageLayout): PageLocator;
```

- [ ] **Step 1: Rewrite the test**

Replace `frontend/pdf-viewer/__tests__/page-scroll-sync.test.tsx` with:

```tsx
/**
 * Page ⇄ scroll sync for the canvas body (`Viewer.Body`, located by the page
 * layout) and the markdown reader (`<Reader>`, located in the DOM): navigation
 * scrolls to a page, scrolling publishes the page back to `currentPage`, and
 * neither may undo the other.
 *
 * jsdom has no layout, no smooth scrolling and no IntersectionObserver, so
 * these tests play the browser: the geometry measured on the real Articles
 * document view, a `scrollTo` that records a smooth scroll without moving, and
 * (for the reader) a fake observer the test fires itself. The real-browser
 * check is `frontend/e2e/flows/pdf-viewer-page-sync.ui.e2e.ts`.
 */
import {act, render} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// Viewer.tsx loads the pdf.js engine, whose browser build needs DOMMatrix.
import * as legacyPdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
vi.mock('pdfjs-dist', () => legacyPdfjs);

import {ViewerProvider} from '../core/context';
import {createViewerStore} from '../core/store';
import {Reader, type ReaderTextBlock} from '../primitives/Reader';

const {Viewer} = await import('../primitives/Viewer');

// Measured in headless Chromium on the Articles document view: A4 pages at
// 100%, 16px apart, in a 725px-tall scroller.
const A4 = {width: 595, height: 842};
const PAGE_HEIGHT = A4.height;
const PAGE_GAP = 16;
const PAGE_PITCH = PAGE_HEIGHT + PAGE_GAP;
const VIEWPORT = 725;

/** The scrollTop that puts `page`'s top on the scroller's top edge. */
const pageTop = (page: number) => PAGE_GAP + (page - 1) * PAGE_PITCH;
const maxScrollTop = (pages: number) => PAGE_GAP + pages * PAGE_PITCH - VIEWPORT;

let observers: FakeIntersectionObserver[] = [];

class FakeIntersectionObserver {
  constructor(readonly callback: IntersectionObserverCallback) {
    observers.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    observers = observers.filter((o) => o !== this);
  }
  takeRecords() {
    return [];
  }
}

function box(top: number, height: number): DOMRect {
  return {top, bottom: top + height, height, left: 0, right: 600, width: 600, x: 0, y: top, toJSON: () => ({})};
}

const elapse = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

/** The scroller's size, a recording `scrollTo`, and the browser's moves. */
function playScroller(scroller: HTMLElement, pages: number) {
  Object.defineProperty(scroller, 'clientHeight', {configurable: true, value: VIEWPORT});
  Object.defineProperty(scroller, 'scrollHeight', {configurable: true, value: PAGE_GAP + pages * PAGE_PITCH});
  const scrollTo = vi.fn();
  scroller.scrollTo = scrollTo as unknown as HTMLElement['scrollTo'];
  return {
    scrollTo,
    /** One animation frame: the scroller moves. */
    move(top: number) {
      scroller.scrollTop = top;
      act(() => {
        scroller.dispatchEvent(new Event('scroll'));
      });
    },
    /** The scroll comes to rest. */
    end() {
      act(() => {
        scroller.dispatchEvent(new Event('scrollend'));
      });
    },
  };
}

beforeEach(() => {
  observers = [];
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
  // jsdom has no Element.scrollTo; a no-op keeps a scroll requested before the
  // test installs its spy from crashing the render.
  HTMLElement.prototype.scrollTo = () => undefined;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (HTMLElement.prototype as {scrollTo?: unknown}).scrollTo;
});

describe('Viewer.Body page sync', () => {
  function renderBody(initial: {numPages: number; currentPage: number}, pages = true) {
    const store = createViewerStore({...initial, pageSizes: {1: A4}});
    const {container} = render(
      <ViewerProvider store={store}>
        <Viewer.Body>{pages && <Viewer.Pages>{({number}) => <Viewer.Page pageNumber={number} />}</Viewer.Pages>}</Viewer.Body>
      </ViewerProvider>,
    );
    const scroller = container.querySelector<HTMLElement>('[data-pdf-viewer-body]')!;
    const browser = playScroller(scroller, initial.numPages);
    elapse(1000); // nothing the mount started is still pending
    return {store, scroller, frame: browser.move, ...browser};
  }

  it('scrolls to a page that has no element on screen', () => {
    // The layout knows every page's position; nothing is queried from the DOM.
    const {store, scrollTo} = renderBody({numPages: 14, currentPage: 1}, false);
    act(() => store.getState().actions.goToPage(12));
    expect(scrollTo).toHaveBeenLastCalledWith({top: pageTop(12), behavior: 'smooth'});
  });

  it('holds the requested page while a long smooth scroll is still travelling', () => {
    const {store, scroller, scrollTo, frame, end} = renderBody({numPages: 14, currentPage: 14});
    scroller.scrollTop = maxScrollTop(14);

    act(() => store.getState().actions.goToPage(7));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenLastCalledWith({top: pageTop(7), behavior: 'smooth'});

    // Past half a second the animation is still two pages short.
    elapse(600);
    frame(pageTop(9) - 154);
    expect(store.getState().currentPage).toBe(7);

    frame(pageTop(7));
    end();
    expect(store.getState().currentPage).toBe(7);

    // Settled, scrolling is followed again.
    frame(pageTop(9));
    expect(store.getState().currentPage).toBe(9);
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it('follows a user scroll without scrolling back to the page top', () => {
    const {store, scrollTo, frame, end} = renderBody({numPages: 14, currentPage: 1});
    frame(pageTop(2) + PAGE_HEIGHT / 2);
    end();
    expect(store.getState().currentPage).toBe(2);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('publishes the page the user stopped on when they take over a navigation', () => {
    const {store, scrollTo, frame, end} = renderBody({numPages: 14, currentPage: 1});
    act(() => store.getState().actions.goToPage(7));
    frame(1200); // our smooth scroll has started…
    frame(pageTop(11) + 100); // …and the user flings past its target
    end();
    expect(store.getState().currentPage).toBe(11);
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it('does not hold the page sync for a navigation that needs no scroll', () => {
    // A scroll to where the scroller already is fires no scrollend, so a hold would never lift.
    const {store, scroller, scrollTo, frame} = renderBody({numPages: 14, currentPage: 13});
    scroller.scrollTop = pageTop(14);
    act(() => store.getState().actions.goToPage(14));
    frame(pageTop(12));
    expect(store.getState().currentPage).toBe(12);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  describe('where scrollend is unsupported', () => {
    let onscrollend: PropertyDescriptor | undefined;

    beforeEach(() => {
      onscrollend = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'onscrollend');
      delete (HTMLElement.prototype as {onscrollend?: unknown}).onscrollend;
    });

    afterEach(() => {
      if (onscrollend) Object.defineProperty(HTMLElement.prototype, 'onscrollend', onscrollend);
    });

    it('holds the requested page until scroll events stop arriving', () => {
      const {store, scroller, scrollTo, frame} = renderBody({numPages: 14, currentPage: 14});
      expect('onscrollend' in scroller).toBe(false);
      scroller.scrollTop = maxScrollTop(14);

      act(() => store.getState().actions.goToPage(7));
      for (const top of [10900, 10000, 8800, 7600, 6726, 5900, 5400, pageTop(7)]) {
        elapse(100);
        frame(top);
        expect(store.getState().currentPage).toBe(7);
      }

      elapse(1000); // the scroller has gone quiet
      frame(pageTop(9));
      expect(store.getState().currentPage).toBe(9);
      expect(scrollTo).toHaveBeenCalledTimes(1);
    });
  });
});

describe('<Reader> page sync', () => {
  const blocks: ReaderTextBlock[] = Array.from({length: 6}, (_, i) => ({
    id: `b${i + 1}`,
    pageNumber: i + 1,
    blockIndex: 0,
    text: `Body of page ${i + 1}.`,
    blockType: 'paragraph',
  }));

  function renderReader(currentPage: number, scrollerTop = 0) {
    const intoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    const store = createViewerStore({mode: 'reader', numPages: blocks.length, currentPage});
    const {container} = render(
      <ViewerProvider store={store}>
        <div data-reader-scroll="">
          <Reader blocks={blocks} />
        </div>
      </ViewerProvider>,
    );
    const scroller = container.querySelector<HTMLElement>('[data-reader-scroll]')!;
    const pages = [...scroller.querySelectorAll<HTMLElement>('[data-reader-page]')];
    const browser = playScroller(scroller, pages.length);
    scroller.getBoundingClientRect = () => box(scrollerTop, VIEWPORT);
    pages.forEach((page, i) => {
      page.getBoundingClientRect = () => box(scrollerTop + pageTop(i + 1) - scroller.scrollTop, PAGE_HEIGHT);
    });
    // The observer's root is the scroller's top half (rootMargin -50%).
    const rootBounds = box(scrollerTop, VIEWPORT / 2);
    elapse(1000); // nothing the mount started is still pending
    intoView.mockClear();
    return {
      store,
      scroller,
      end: browser.end,
      // Either API moves the scroller, so a stray scroll cannot hide behind the other.
      scrollRequests: () => browser.scrollTo.mock.calls.length + intoView.mock.calls.length,
      /** One animation frame: the scroller moves, then the observer reports. */
      frame(top: number) {
        browser.move(top);
        const entries = pages.map((page) => {
          const rect = page.getBoundingClientRect();
          const isIntersecting = rect.top < rootBounds.bottom && rect.bottom > rootBounds.top;
          return {target: page, isIntersecting, boundingClientRect: rect, rootBounds} as unknown as IntersectionObserverEntry;
        });
        const observer = observers.at(-1);
        if (!observer) throw new Error('no IntersectionObserver is attached to the pages');
        act(() => observer.callback(entries, observer as unknown as IntersectionObserver));
      },
    };
  }

  it('holds the requested page while a long smooth scroll is still travelling', () => {
    const {store, scroller, scrollRequests, frame, end} = renderReader(6);
    scroller.scrollTop = maxScrollTop(6);

    act(() => store.getState().actions.goToPage(2));
    expect(scrollRequests()).toBe(1);

    elapse(600);
    frame(pageTop(4) + 110); // page 4 is the page nearest the top edge
    expect(store.getState().currentPage).toBe(2);
    expect(scrollRequests()).toBe(1);

    frame(pageTop(2));
    end();
    expect(store.getState().currentPage).toBe(2);
    expect(scrollRequests()).toBe(1);
  });

  it('follows a user scroll without jumping to the page header', () => {
    const {store, scrollRequests, frame, end} = renderReader(1);
    frame(pageTop(2) + PAGE_HEIGHT / 2);
    end();
    expect(store.getState().currentPage).toBe(2);
    expect(scrollRequests()).toBe(0);
  });

  it('measures the page nearest the top edge from the scroller, not the window', () => {
    // Where the Articles document panel puts the scroller: ~175px down the window.
    const {store, frame} = renderReader(1, 175);
    // Page 3's top is 300px below the scroller's top edge and page 2's is 558px
    // above it, so page 3 is nearer. Measured from the window's top instead
    // (475px against 383px), page 2 would win.
    frame(pageTop(3) - 300);
    expect(store.getState().currentPage).toBe(3);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run frontend/pdf-viewer/__tests__/page-scroll-sync.test.tsx`
Expected: FAIL. The canvas cases fail: "scrolls to a page that has no element on screen" gets no `scrollTo`, and scrolling publishes nothing because no IntersectionObserver entries are fired for canvas. The reader cases pass.

- [ ] **Step 3: Rewrite `hooks/usePageScrollSync.ts`**

```ts
/**
 * Two-way sync between the store's `currentPage` and a scroll container of
 * pages — `<Viewer.Body>`'s canvas pages and the markdown reader's page
 * sections. Where the pages are comes from a `PageLocator`: the canvas asks its
 * page layout (pages may not be mounted), the reader asks the DOM.
 *
 *   - Navigation (a `currentPage` change the scroll position did not cause:
 *     nav buttons, the page input, search, citations) scrolls the container to
 *     that page.
 *   - Scrolling publishes the page nearest the container's top edge to
 *     `currentPage`, and never scrolls in return: the viewport is already
 *     there, and scrolling to the page top would pull a reader back mid-page or
 *     re-target a navigation that is still travelling.
 *
 * A programmatic scroll holds the publishing until it settles, however long it
 * runs. A smooth scroll across several pages passes every page in between;
 * publishing those would overwrite the page the user asked for, and a fixed
 * suppression window cannot prevent it — a long jump outlasts any window short
 * enough not to swallow the user's own scrolling.
 */
import {useEffect, useRef, useState, type RefObject} from 'react';
import type {StoreApi} from 'zustand';

import {useViewerStore, useViewerStoreApi} from '../core/context';
import type {ViewerState} from '../core/state';

/**
 * Where `scrollend` is unsupported (Safari before 26.2), a programmatic scroll
 * counts as settled once `scroll` events have paused this long.
 */
const SCROLL_IDLE_MS = 150;

/** Where a surface's pages are. `root` is the element the surface renders; `scroller` the scroll container around it. */
export interface PageLocator {
  /** The `scrollTop` that puts `page`'s top on the scroller's top edge, or null when the page has no position. */
  offsetOf(page: number, root: HTMLElement, scroller: HTMLElement): number | null;
  /** The page nearest the scroller's top edge, or null when no page is showing. */
  pageAt(root: HTMLElement, scroller: HTMLElement): number | null;
  /** Call `listener` whenever `pageAt` may have changed; returns the detach. */
  onScroll(root: HTMLElement, scroller: HTMLElement, listener: () => void): () => void;
}

/**
 * A `PageLocator` over page elements carrying `pageAttribute`, for a surface
 * that mounts every page (the markdown reader). An IntersectionObserver
 * tracks the pages crossing the scroller's upper half.
 */
export function createDomPageLocator(pageAttribute: string): PageLocator {
  // Pages intersecting the scroller's upper half, with their latest entry.
  const visible = new Map<number, IntersectionObserverEntry>();
  return {
    offsetOf(page, root, scroller) {
      const element = root.querySelector<HTMLElement>(`[${pageAttribute}="${page}"]`);
      if (!element) return null;
      return element.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    },

    pageAt() {
      // Entry rects are in viewport coordinates, so measure from the root's top
      // (`rootBounds`, always set for an element root) — measured from the
      // viewport's, the pick would move with where the container sits on screen.
      let bestPage: number | null = null;
      let bestDistance = Infinity;
      for (const [page, entry] of visible) {
        const distance = Math.abs(entry.boundingClientRect.top - entry.rootBounds!.top);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestPage = page;
        }
      }
      return bestPage;
    },

    onScroll(root, scroller, listener) {
      if (typeof IntersectionObserver === 'undefined') return () => {}; // SSR / jsdom safety
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const page = parseInt(entry.target.getAttribute(pageAttribute) ?? '', 10);
            if (Number.isNaN(page)) continue;
            if (entry.isIntersecting) visible.set(page, entry);
            else visible.delete(page);
          }
          listener();
        },
        // Pages at the top of the viewport are "current"; pages below
        // contribute only when they cross the upper half.
        {root: scroller, threshold: [0, 0.1, 0.5, 1], rootMargin: '0px 0px -50% 0px'},
      );
      root.querySelectorAll<HTMLElement>(`[${pageAttribute}]`).forEach((element) => observer.observe(element));
      return () => {
        observer.disconnect();
        visible.clear();
      };
    },
  };
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Calls `onSettled` once the scroll now under way on `scroller` has come to rest; returns the detach. */
function onScrollSettled(scroller: HTMLElement, onSettled: () => void): () => void {
  // Without `scrollend` support the handler property is absent, not null.
  if (scroller.onscrollend !== undefined) {
    scroller.addEventListener('scrollend', onSettled);
    return () => scroller.removeEventListener('scrollend', onSettled);
  }
  let timer = setTimeout(onSettled, SCROLL_IDLE_MS);
  const restart = () => {
    clearTimeout(timer);
    timer = setTimeout(onSettled, SCROLL_IDLE_MS);
  };
  scroller.addEventListener('scroll', restart);
  return () => {
    clearTimeout(timer);
    scroller.removeEventListener('scroll', restart);
  };
}

function createPageScrollSync(storeApi: StoreApi<ViewerState>) {
  // The page last published from the scroll position. Its `currentPage`
  // change is consumed by the navigation effect instead of scrolling.
  let publishedPage: number | null = null;
  // Detaches the listeners of a programmatic scroll that has not settled.
  let unsettled: (() => void) | null = null;
  // The page under the scroll position now; replaced by the hook on every commit.
  let locate: () => number | null = () => null;

  function publishLocatedPage() {
    const page = locate();
    const {currentPage, actions} = storeApi.getState();
    if (page !== null && page !== currentPage) {
      publishedPage = page;
      actions.goToPage(page);
    }
  }

  return {
    setLocate(next: () => number | null) {
      locate = next;
    },

    /** The scroll position may have moved: publish its page, unless a programmatic scroll is travelling. */
    onScroll() {
      if (!unsettled) publishLocatedPage();
    },

    /** True when `page` is the page last published from the scroll position; consumes it. */
    takePublishedPage(page: number): boolean {
      const published = page === publishedPage;
      publishedPage = null;
      return published;
    },

    /** Scroll `scroller` to `top`, holding the publishing until the scroll settles. */
    scrollTo(scroller: HTMLElement, top: number) {
      const target = Math.max(0, Math.min(top, scroller.scrollHeight - scroller.clientHeight));
      // A scroll that goes nowhere fires no `scrollend`, so it must not hold.
      if (!unsettled && Math.abs(scroller.scrollTop - target) < 1) return;
      unsettled?.();
      const detach = onScrollSettled(scroller, () => {
        detach();
        unsettled = null;
        // Stopping short of the target means the user took over mid-scroll:
        // the pages they scrolled to were held back, so publish where they are.
        if (Math.abs(scroller.scrollTop - target) >= 1) publishLocatedPage();
      });
      unsettled = detach;
      scroller.scrollTo({top: target, behavior: prefersReducedMotion() ? 'auto' : 'smooth'});
    },

    dispose() {
      unsettled?.();
      unsettled = null;
    },
  };
}

/**
 * Wire the page ⇄ scroll sync onto a page container. Returns the scroll the
 * surface must use for any other programmatic scroll (e.g. revealing a search
 * match), so the sync holds while that scroll travels too.
 */
export function usePageScrollSync({
  rootRef,
  scrollerSelector,
  locator,
  pagesKey,
}: {
  /** An element inside the scroll container, or the container itself. */
  rootRef: RefObject<HTMLElement | null>;
  /** Selects the scroll container from the root via `closest()`. */
  scrollerSelector: string;
  /** Where the pages are. A new locator takes effect on the next scroll or navigation. */
  locator: PageLocator;
  /** Changes whenever the page elements are replaced, so the locator re-subscribes. */
  pagesKey: unknown;
}): (scroller: HTMLElement, top: number) => void {
  const storeApi = useViewerStoreApi();
  const currentPage = useViewerStore((s) => s.currentPage);
  // A ViewerProvider's store never changes, so one sync serves the mount.
  const [sync] = useState(() => createPageScrollSync(storeApi));

  // The latest locator, for the effects below that must not re-run when it
  // changes: a new layout (a zoom, a page size arriving) must not scroll back
  // to the current page's top.
  const locatorRef = useRef(locator);
  useEffect(() => {
    locatorRef.current = locator;
    sync.setLocate(() => {
      const root = rootRef.current;
      const scroller = root?.closest<HTMLElement>(scrollerSelector);
      return root && scroller ? locator.pageAt(root, scroller) : null;
    });
  }, [locator, rootRef, scrollerSelector, sync]);

  // Navigation: currentPage → scroll position.
  useEffect(() => {
    const root = rootRef.current;
    const scroller = root?.closest<HTMLElement>(scrollerSelector);
    if (!root || !scroller) return;
    if (sync.takePublishedPage(currentPage)) return;
    const top = locatorRef.current.offsetOf(currentPage, root, scroller);
    if (top !== null) sync.scrollTo(scroller, top);
  }, [currentPage, rootRef, scrollerSelector, sync]);

  // Scrolling: scroll position → currentPage.
  useEffect(() => {
    const root = rootRef.current;
    const scroller = root?.closest<HTMLElement>(scrollerSelector);
    if (!root || !scroller) return;
    return locatorRef.current.onScroll(root, scroller, () => sync.onScroll());
  }, [pagesKey, rootRef, scrollerSelector, sync]);

  useEffect(() => () => sync.dispose(), [sync]);

  return sync.scrollTo;
}
```

- [ ] **Step 4: Add the layout locator**

Append to `viewport/usePageLayout.ts`, and add `import type {PageLocator} from '../hooks/usePageScrollSync';` to its imports:

```ts
/** A `PageLocator` that answers from the layout — no DOM query, so it works for pages that are not mounted. */
export function layoutPageLocator(layout: PageLayout): PageLocator {
  return {
    offsetOf: (page) => (page >= 1 && page <= layout.numPages ? layout.offsetOf(page) : null),
    pageAt: (_root, scroller) => (layout.numPages > 0 ? layout.pageAt(scroller.scrollTop, scroller.clientHeight) : null),
    onScroll(_root, scroller, listener) {
      scroller.addEventListener('scroll', listener, {passive: true});
      return () => scroller.removeEventListener('scroll', listener);
    },
  };
}
```

- [ ] **Step 5: Wire both surfaces**

`primitives/Viewer.tsx` `Body` — replace the `numPages` selector and the `usePageScrollSync({...})` call with:

```tsx
  const layout = usePageLayout();
  const locator = useMemo(() => layoutPageLocator(layout), [layout]);

  // Navigation scrolls to the current page; scrolling publishes the page at
  // the top of the viewport. Both read the page layout, so an unmounted page
  // still has a position.
  usePageScrollSync({rootRef: ref, scrollerSelector: '[data-pdf-viewer-body]', locator, pagesKey: layout.numPages});
```

Add `useMemo` to the React import and `import {layoutPageLocator, usePageLayout} from '../viewport/usePageLayout';`.

`primitives/Reader.tsx` `ReaderInteractions` — replace the `usePageScrollSync({...})` call with:

```tsx
  // The reader mounts every page section, so the DOM knows where pages are.
  const [locator] = useState(() => createDomPageLocator('data-reader-page'));
  const scrollTo = usePageScrollSync({
    rootRef,
    scrollerSelector: '[data-reader-scroll]',
    locator,
    pagesKey: blocks,
  });
```

Change the import to `import {createDomPageLocator, usePageScrollSync} from '../hooks/usePageScrollSync';`. Make sure `useState` is in `Reader.tsx`'s React import; it is already used by `Reader`.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run frontend/pdf-viewer`
Expected: PASS, including every case of `page-scroll-sync.test.tsx` and the reader locate and search tests.

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/pdf-viewer
git commit -m "refactor(pdf-viewer): drive page scroll sync from an injected page locator"
```

### Task 9: Virtualized pages (R10 without the gesture freeze, R11)

**Files:**
- Create: `frontend/pdf-viewer/viewport/useVirtualPages.ts`
- Modify: `frontend/pdf-viewer/primitives/Viewer.tsx`, `package.json`, `package-lock.json`
- Delete: `frontend/pdf-viewer/__tests__/pageContainment.test.tsx` (its `content-visibility` contract is gone)
- Test: `frontend/pdf-viewer/__tests__/virtual-pages.test.tsx` (new), `frontend/pdf-viewer/__tests__/primitives.test.tsx`

**Interfaces:**
- Consumes: `PageLayout`, `usePageLayout`, `layoutPageLocator` (Tasks 7–8); `setPageSize` (Task 6).
- Produces:
  - `useVirtualPages({scroller, layout}: {scroller: HTMLElement | null; layout: PageLayout}): VirtualItem[]` — `item.index` is 0-based.
  - DOM contract: `Viewer.Body` renders `[data-pdf-viewer-body]`, the scroller. `Viewer.Pages` renders `[data-pdf-viewer-pages]` with one absolutely positioned slot per mounted page. `Viewer.Page` renders `[data-page-number]` filling its slot and reports `handle.size` via `setPageSize`.
  - Facts verified in `@tanstack/virtual-core` 3.17: the scroller size comes from `offsetWidth/offsetHeight`; `resizeItem` shifts the scroll position for an item above it; `measure()` clears measured sizes and re-reads `estimateSize`.

- [ ] **Step 1: Install the dependency**

Run: `npm install @tanstack/react-virtual@^3.14.13`
Expected: `package.json` `dependencies` gains `"@tanstack/react-virtual"`.

- [ ] **Step 2: Write the failing test**

`frontend/pdf-viewer/__tests__/virtual-pages.test.tsx`:

```tsx
/**
 * Only the pages in and next to the viewport mount. jsdom has no layout: the
 * virtualizer reads the scroller's size from offsetHeight/offsetWidth, which
 * the tests stub, and scroll positions are set by hand.
 */
import {act, render, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import * as legacyPdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
vi.mock('pdfjs-dist', () => legacyPdfjs);

import {ViewerProvider} from '../core/context';
import {createViewerStore} from '../core/store';
import {createMockEngine} from '../engines/mock';
import {createPageLayout} from '../viewport/usePageLayout';

const {Viewer} = await import('../primitives/Viewer');
const {CanvasLayer} = await import('../primitives/CanvasLayer');

const VIEWPORT = 725;
const LETTER = {width: 612, height: 792};
const LANDSCAPE = {width: 792, height: 612};

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(VIEWPORT);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(900);
  // The virtualizer's scroll correction calls scrollTo; jsdom has none.
  HTMLElement.prototype.scrollTo = function (this: HTMLElement, options?: ScrollToOptions | number) {
    if (typeof options === 'object' && options.top !== undefined) this.scrollTop = options.top;
  } as HTMLElement['scrollTo'];
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (HTMLElement.prototype as {scrollTo?: unknown}).scrollTo;
});

async function renderDocument(numPages: number) {
  const engine = createMockEngine({numPages, pageSize: LETTER});
  const store = createViewerStore();
  store.getState().actions.setDocument(await engine.load({kind: 'url', url: 'mock.pdf'}));
  store.getState().actions.setPageSize(1, LETTER);
  const {container} = render(
    <ViewerProvider store={store}>
      <Viewer.Body>
        <Viewer.Pages>
          {({number}) => (
            <Viewer.Page pageNumber={number}>
              <CanvasLayer pageNumber={number} />
            </Viewer.Page>
          )}
        </Viewer.Pages>
      </Viewer.Body>
    </ViewerProvider>,
  );
  const scroller = container.querySelector<HTMLElement>('[data-pdf-viewer-body]')!;
  const mounted = () =>
    [...container.querySelectorAll('[data-page-number]')].map((el) => Number(el.getAttribute('data-page-number')));
  const scrollTo = (top: number) =>
    act(() => {
      scroller.scrollTop = top;
      scroller.dispatchEvent(new Event('scroll'));
    });
  return {store, scroller, mounted, scrollTo};
}

describe('Viewer.Pages virtualization', () => {
  const layout = createPageLayout({numPages: 18, pageSizes: {1: LETTER}, viewRotation: 0, zoom: 1});

  it('mounts only the pages in and next to the viewport', async () => {
    const {mounted} = await renderDocument(18);
    await waitFor(() => expect(mounted()).toEqual([1, 2]));
  });

  it('mounts the pages around a scroll position far down the document', async () => {
    const {mounted, scrollTo} = await renderDocument(18);
    scrollTo(layout.offsetOf(10));
    await waitFor(() => expect(mounted()).toEqual([9, 10, 11]));
  });

  it('keeps the reading position when a page above it turns out landscape', async () => {
    const {store, scroller, mounted, scrollTo} = await renderDocument(18);
    scrollTo(layout.offsetOf(10));
    await waitFor(() => expect(mounted()).toContain(9));
    // Precondition: page 9 was laid out on page 1's portrait estimate.
    expect(store.getState().pageSizes[9]).toEqual(LETTER);

    act(() => store.getState().actions.setPageSize(9, LANDSCAPE));

    expect(scroller.scrollTop).toBe(layout.offsetOf(10) - (LETTER.height - LANDSCAPE.height));
  });
});
```

Also, in `primitives.test.tsx`, replace the third test (`renders pages with data-page-number attributes after load`) with the version below. jsdom reports a zero-height scroller, so only page 1 and its overscan neighbour mount.

```tsx
  it(
    'renders the first pages with data-page-number attributes after load',
    async () => {
      const {container} = render(<PrumoPdfViewer source={{kind: 'url' as const, url: fixtureUrl}} />);
      await waitFor(
        () => {
          const nums = [...container.querySelectorAll('div[data-page-number]')].map((p) => Number(p.getAttribute('data-page-number')));
          expect(nums).toEqual([1, 2]);
        },
        {timeout: 10000},
      );
    },
    15000, // pdfjs worker startup + load can exceed 5 s
  );
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run frontend/pdf-viewer/__tests__/virtual-pages.test.tsx frontend/pdf-viewer/__tests__/primitives.test.tsx`
Expected: FAIL. Every page mounts (`[1, 2, …, 18]`; `[1, 2, 3]` for the fixture).

The precondition in the third test also fails: `pageSizes[9]` is undefined because pages don't report sizes yet. It passes once `Viewer.Page` reports its size in Step 5. Page 9's reported size is `LETTER`, since the mock engine gives every page `LETTER`.

- [ ] **Step 4: Create `viewport/useVirtualPages.ts`**

```ts
/**
 * The pages to mount: those in the scroller's viewport plus one on each side.
 * Adapted from anaralabs/lector (MIT): overscan 1, never trusting `scrollend`
 * alone, and a size correction above the viewport keeps the reading position.
 */
import {useVirtualizer, type VirtualItem} from '@tanstack/react-virtual';
import {useLayoutEffect, useRef} from 'react';
import type {PageLayout} from './usePageLayout';

export function useVirtualPages({
  scroller,
  layout,
}: {
  scroller: HTMLElement | null;
  layout: PageLayout;
}): VirtualItem[] {
  const virtualizer = useVirtualizer({
    count: layout.numPages,
    getScrollElement: () => scroller,
    estimateSize: (index) => layout.sizeOf(index + 1).height,
    gap: layout.gap,
    paddingStart: layout.gap,
    paddingEnd: layout.gap,
    overscan: 1,
    // A missed `scrollend` (a known browser flake) would pin `isScrolling`;
    // the idle timer is the fallback that always fires.
    useScrollendEvent: false,
  });

  // A new layout either rescales every page (zoom, view rotation, a new
  // document) or brings one page's real size. The first re-reads every size
  // and leaves the scroll position to whoever changed the zoom; the second
  // corrects that page in place, and the virtualizer shifts the scroll
  // position when the page sits above it, so the text being read stays put.
  const previous = useRef(layout);
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = layout;
    if (before === layout) return;
    if (before.zoom !== layout.zoom || before.viewRotation !== layout.viewRotation || before.numPages !== layout.numPages) {
      virtualizer.measure();
      return;
    }
    for (let page = 1; page <= layout.numPages; page++) {
      const height = layout.sizeOf(page).height;
      if (height !== before.sizeOf(page).height) virtualizer.resizeItem(page - 1, height);
    }
  }, [layout, virtualizer]);

  return virtualizer.getVirtualItems();
}
```

- [ ] **Step 5: Rewrite `primitives/Viewer.tsx`**

```tsx
import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import type {StoreApi} from 'zustand';
import {ViewerProvider, useViewerStore} from '../core/context';
import type {PDFSource} from '../core/source';
import type {ViewerState} from '../core/state';
import type {createViewerStore} from '../core/store';
import {useDocumentLoader} from '../hooks/useDocumentLoader';
import {usePageHandle} from '../hooks/usePageHandle';
import {usePageScrollSync} from '../hooks/usePageScrollSync';
import {layoutPageLocator, usePageLayout} from '../viewport/usePageLayout';
import {useVirtualPages} from '../viewport/useVirtualPages';

/** The scroll container `Viewer.Body` renders, for the `Viewer.Pages` inside it. */
const ScrollerContext = createContext<HTMLElement | null>(null);

interface RootProps {
  source: PDFSource | null;
  store?: StoreApi<ViewerState>;
  initial?: Parameters<typeof createViewerStore>[0];
  children: ReactNode;
  className?: string;
}

function Root({source, store, initial, children, className}: RootProps) {
  return (
    <ViewerProvider store={store} initial={initial}>
      <RootInner source={source} className={className}>
        {children}
      </RootInner>
    </ViewerProvider>
  );
}

function RootInner({source, children, className}: {source: PDFSource | null; children: ReactNode; className?: string}) {
  useDocumentLoader({source});
  return (
    <div className={className} data-pdf-viewer-root="">
      {children}
    </div>
  );
}

function Body({children, className}: {children: ReactNode; className?: string}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const attach = useCallback((element: HTMLDivElement | null) => {
    rootRef.current = element;
    setScroller(element);
  }, []);
  const layout = usePageLayout();
  const locator = useMemo(() => layoutPageLocator(layout), [layout]);

  // Navigation scrolls to the current page; scrolling publishes the page at
  // the top of the viewport. Both read the page layout, so an unmounted page
  // still has a position.
  usePageScrollSync({rootRef, scrollerSelector: '[data-pdf-viewer-body]', locator, pagesKey: layout.numPages});

  return (
    <ScrollerContext.Provider value={scroller}>
      <div ref={attach} className={className} data-pdf-viewer-body="" style={{overflow: 'auto', position: 'relative', height: '100%'}}>
        {children}
      </div>
    </ScrollerContext.Provider>
  );
}

/**
 * Mounts only the pages near the viewport, each in a slot the page layout
 * positions. The column is as tall as the whole document, so the scrollbar
 * and page navigation work before any other page has rendered.
 */
function Pages({children}: {children: (page: {number: number}) => ReactNode}) {
  const scroller = useContext(ScrollerContext);
  const layout = usePageLayout();
  const items = useVirtualPages({scroller, layout});
  if (layout.numPages === 0) return null;
  return (
    <div data-pdf-viewer-pages="" style={{position: 'relative', margin: '0 auto', width: layout.width, height: layout.totalHeight}}>
      {items.map((item) => {
        const page = item.index + 1;
        const {width, height} = layout.sizeOf(page);
        return (
          <div
            key={item.key}
            style={{position: 'absolute', top: layout.offsetOf(page), left: (layout.width - width) / 2, width, height}}
          >
            {children({number: page})}
          </div>
        );
      })}
    </div>
  );
}

function Page({pageNumber, children}: {pageNumber: number; children?: ReactNode}) {
  const handle = usePageHandle(pageNumber);
  const setPageSize = useViewerStore((s) => s.actions.setPageSize);

  // The layout sizes a page from page 1 until its handle resolves; a landscape
  // page corrects it here.
  useEffect(() => {
    if (handle) setPageSize(pageNumber, handle.size);
  }, [handle, pageNumber, setPageSize]);

  return (
    // bg-white is intentional, not a missed token: a PDF page is a
    // physical sheet of white paper. It must stay white in both light
    // and dark themes so the page contents render with the contrast
    // and colour the document author intended.
    <div data-page-number={pageNumber} className="relative size-full shadow-md bg-white">
      {children}
    </div>
  );
}

export const Viewer = {Root, Body, Pages, Page};
```

- [ ] **Step 6: Delete the obsolete containment test**

```bash
git rm frontend/pdf-viewer/__tests__/pageContainment.test.tsx
```

- [ ] **Step 7: Run the tests, typecheck and both knip modes**

Run: `npx vitest run frontend/pdf-viewer`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS.

Run: `npx knip --no-tag-hints`
Expected: 0.

Run: `npx knip --production --no-tag-hints`
Expected: 0.

If Vitest or the build reports a React Compiler bailout in `useVirtualPages` (for example about `getScrollElement`), keep the element-in-state design, move the virtualizer options into a `useMemo` keyed on `[scroller, layout]`, and re-run. Do not add `'use no memo'`.

- [ ] **Step 8: Commit**

```bash
git add -A frontend/pdf-viewer package.json package-lock.json
git commit -m "perf(pdf-viewer): mount only the pages near the viewport"
```

### Task 10: Search reveals a page that is not mounted (R13)

**Files:**
- Modify: `frontend/pdf-viewer/primitives/TextLayer.tsx`
- Test: `frontend/pdf-viewer/__tests__/search-unmounted-page.test.tsx` (new)

**Interfaces:**
- Consumes: the virtualized `Viewer` (Task 9); the store's `setSearchMatches` and `setActiveMatchIndex`.
- Produces: `TextLayer` applies match highlights once its asynchronous text layer has painted.

- [ ] **Step 1: Write the failing test**

```tsx
/**
 * A match on a page far from the viewport: the active match navigates to its
 * page, the page scroll sync scrolls there, the page mounts, and its text
 * layer highlights the match once it has painted.
 */
import {act, render, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import * as legacyPdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
vi.mock('pdfjs-dist', () => legacyPdfjs);

import {ViewerProvider} from '../core/context';
import {createViewerStore} from '../core/store';
import {createMockEngine} from '../engines/mock';
import {createPageLayout} from '../viewport/usePageLayout';

const {Viewer} = await import('../primitives/Viewer');
const {TextLayer} = await import('../primitives/TextLayer');

const VIEWPORT = 725;
const LETTER = {width: 612, height: 792};
const PAGES = 18;

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(VIEWPORT);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(900);
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (Element.prototype as {scrollIntoView?: unknown}).scrollIntoView;
});

describe('search on a page that is not mounted', () => {
  it('scrolls to the page, mounts it, and highlights the match', async () => {
    const text = Array.from({length: PAGES}, (_, i) => (i === 11 ? 'needle in page twelve' : `page ${i + 1}`));
    const engine = createMockEngine({numPages: PAGES, pageSize: LETTER, text});
    const store = createViewerStore();
    store.getState().actions.setDocument(await engine.load({kind: 'url', url: 'mock.pdf'}));
    store.getState().actions.setPageSize(1, LETTER);
    const {container} = render(
      <ViewerProvider store={store}>
        <Viewer.Body>
          <Viewer.Pages>
            {({number}) => (
              <Viewer.Page pageNumber={number}>
                <TextLayer pageNumber={number} />
              </Viewer.Page>
            )}
          </Viewer.Pages>
        </Viewer.Body>
      </ViewerProvider>,
    );
    const scroller = container.querySelector<HTMLElement>('[data-pdf-viewer-body]')!;
    const layout = createPageLayout({numPages: PAGES, pageSizes: {1: LETTER}, viewRotation: 0, zoom: 1});
    Object.defineProperty(scroller, 'clientHeight', {configurable: true, value: VIEWPORT});
    Object.defineProperty(scroller, 'scrollHeight', {configurable: true, value: layout.totalHeight});
    // The browser: the scroll lands at once and comes to rest.
    scroller.scrollTo = (({top}: ScrollToOptions) => {
      scroller.scrollTop = top ?? 0;
      scroller.dispatchEvent(new Event('scroll'));
      scroller.dispatchEvent(new Event('scrollend'));
    }) as HTMLElement['scrollTo'];
    // Precondition: page 12 is not mounted.
    expect(container.querySelector('[data-page-number="12"]')).toBeNull();

    act(() => {
      store.getState().actions.setSearchMatches([{pageNumber: 12, charStart: 0, charEnd: 6, context: 'needle'}]);
      store.getState().actions.setActiveMatchIndex(0);
    });

    expect(scroller.scrollTop).toBe(layout.offsetOf(12));
    await waitFor(() =>
      expect(container.querySelector('[data-page-number="12"] [data-mock-page="12"].highlight.selected')).not.toBeNull(),
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run frontend/pdf-viewer/__tests__/search-unmounted-page.test.tsx`
Expected: FAIL at the last `waitFor`. Page 12 mounts, but the highlight effect ran before the mock text layer appended its span, so the span has no `highlight` class.

- [ ] **Step 3: Highlight after the text layer paints**

In `primitives/TextLayer.tsx`:
- Add `useState` to the React import.
- Just after `containerRef`, add:

```tsx
  // The text layer paints asynchronously; the highlights below wait for the
  // spans it paints. A page mounted by search navigation paints after its
  // match is already active.
  const [painted, setPainted] = useState<object | null>(null);
```

- In the render effect, replace the `.then((h) => { handle = h; })` callback with:

```tsx
      .then((h) => {
        handle = h;
        if (!ctrl.signal.aborted) setPainted(h);
      })
```

- At the top of the highlight effect, change `if (!container) return;` to `if (!container || !painted) return;`.
- Add `painted` to that effect's dependency array.

- [ ] **Step 4: Run the viewer tests**

Run: `npx vitest run frontend/pdf-viewer`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/pdf-viewer
git commit -m "fix(pdf-viewer): highlight a search match on a page mounted by navigation"
```

### Task 11: E2E page sync, README, Phase 1 gate

**Files:**
- Modify: `frontend/e2e/flows/pdf-viewer-page-sync.ui.e2e.ts`, `frontend/pdf-viewer/README.md`

- [ ] **Step 1: Stop expecting every page at once**

In `openLongDocument`, replace the `toHaveCount(PAGE_COUNT, …)` expectation and its comment with:

```ts
  // Only the pages near the viewport mount, so wait for the first one.
  await expect(page.getByRole("img", { name: "PDF page 1" })).toBeVisible({ timeout: 30_000 });
```

In the first test, replace the precondition line `expect(await pageTopOffset(body, 7)).toBeLessThan(-5000);` and its comment with:

```ts
    // Seven A4 pages away: page 7 is not even mounted, and the smooth scroll
    // back outlasts half a second.
    await expect(body.locator('[data-page-number="7"]')).toHaveCount(0);
    expect(await body.evaluate((el) => el.scrollTop)).toBeGreaterThan(5000);
```

Leave everything else. After the navigation, page 7 is mounted, so `pageTopOffset(body, 7)` works. In the second test, page 2 is mounted at the top of the document.

- [ ] **Step 2: Run the E2E file where its environment exists**

Run: `npx playwright test frontend/e2e/flows/pdf-viewer-page-sync.ui.e2e.ts`
Expected:
- With the E2E env set and the local stack up (`make start`), both tests PASS.
- Without the env, both SKIP ("Missing required env"). Report a skip as a skip, not a pass. CI runs it.

- [ ] **Step 3: README**

In `frontend/pdf-viewer/README.md`:
- In the modules tree, replace the `hooks/` line with these two lines:

```text
├── viewport/      usePageLayout (page positions), useVirtualPages (what mounts)
├── hooks/         useDocumentLoader, usePageHandle, usePageScrollSync (PageLocator)
```

- Append a section:

```markdown
## Pages and scrolling

`viewport/usePageLayout.ts` computes every page's position from page sizes
alone. Page 1 is read at load; the rest are estimated from it until they mount.
`Viewer.Pages` mounts only the pages in and next to the viewport
(`@tanstack/react-virtual`). The page ⇄ scroll sync asks a `PageLocator`
where pages are — the layout for canvas pages, the DOM for the reader — so
navigating to a page that is not mounted still scrolls there.
```

- [ ] **Step 4: Commit**

```bash
git add frontend/e2e/flows/pdf-viewer-page-sync.ui.e2e.ts frontend/pdf-viewer/README.md
git commit -m "test(pdf-viewer): page sync e2e for virtualized pages; document the layout"
```

- [ ] **Step 5: Phase 1 gate**

Run every command in Global Constraints § Phase gate. Expected: all green, both knip modes at 0. Record each result.

Then check the load-time win in the Browser pane:
- Open a run's PDF view on the local dev server.
- Run `read_console_messages` with `onlyErrors`.
- Run `document.querySelectorAll('[data-page-number]').length` via `javascript_tool` on an 8+ page article. Expected: ≤ 3.
- Take a screenshot as proof.

# Phase 2 — gesture zoom (R14–R18)

Branch: `feat/pdf-viewer-phase2-gesture-zoom` from `origin/dev`, after the Phase 1 PR merged.

### Task 12: Pure zoom math, test-first (R15)

**Files:**
- Create: `frontend/pdf-viewer/viewport/zoomMath.ts`
- Test: `frontend/pdf-viewer/viewport/__tests__/zoomMath.test.ts`

**Interfaces:**
- Produces:

```ts
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;
export const ZOOM_STEP = 1.25;
export function clampZoom(zoom: number): number;
export interface Point {x: number; y: number}
export function anchoredScroll(input: {
  pointer: Point;                          // px from the scroller's top-left corner
  scroll: {left: number; top: number};     // at fromZoom
  viewportWidth: number;                   // scroller clientWidth
  contentWidth: number;                    // PageLayout.naturalWidth (zoom 1)
  fromZoom: number;
  toZoom: number;
}): {left: number; top: number};
export function wheelStep(event: {deltaY: number; deltaMode: number}): number;
export const WHEEL_INERTIA_GAP_MS = 140;
export const WHEEL_INERTIA_ESCAPE_FACTOR = 1.35;
export interface WheelInertia {active: boolean; lastTime: number; lastAbsDeltaY: number; lastSign: -1 | 0 | 1}
export const IDLE_WHEEL_INERTIA: WheelInertia;
export function filterWheel(state: WheelInertia, event: {ctrlKey: boolean; deltaX: number; deltaY: number; timeStamp: number}): {state: WheelInertia; prevent: boolean};
```

- [ ] **Step 1: Write the failing test**

```ts
import {describe, expect, it} from 'vitest';
import {
  IDLE_WHEEL_INERTIA,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEP,
  anchoredScroll,
  clampZoom,
  filterWheel,
  wheelStep,
  type WheelInertia,
} from '../zoomMath';

describe('clampZoom', () => {
  it('keeps a zoom inside the limits', () => {
    expect(clampZoom(0.1)).toBe(MIN_ZOOM);
    expect(clampZoom(9)).toBe(MAX_ZOOM);
    expect(clampZoom(1.3)).toBe(1.3);
  });
});

describe('anchoredScroll', () => {
  // A 612pt page plus 16px side gaps, in an 800px-wide scroller.
  const base = {viewportWidth: 800, contentWidth: 644};

  it('keeps the content under the pointer in place when the column starts narrower than the viewport', () => {
    // At zoom 1 the 644px column is centred (78px inset), so the pointer at
    // x=400 is over content x=322; at zoom 2 the column overflows (no inset).
    const next = anchoredScroll({...base, pointer: {x: 400, y: 300}, scroll: {left: 0, top: 1000}, fromZoom: 1, toZoom: 2});
    expect(next).toEqual({left: 322 * 2 - 400, top: 1300 * 2 - 300});
  });

  it('returns to the starting scroll position when the zoom is undone', () => {
    const pointer = {x: 250, y: 410};
    const start = {left: 120, top: 5320};
    const zoomedIn = anchoredScroll({...base, pointer, scroll: start, fromZoom: 1.5, toZoom: 3});
    const back = anchoredScroll({...base, pointer, scroll: zoomedIn, fromZoom: 3, toZoom: 1.5});
    expect(back.left).toBeCloseTo(start.left, 6);
    expect(back.top).toBeCloseTo(start.top, 6);
  });

  it('never asks for a negative scroll position', () => {
    const next = anchoredScroll({...base, pointer: {x: 400, y: 300}, scroll: {left: 0, top: 0}, fromZoom: 2, toZoom: 0.5});
    expect(next.left).toBeGreaterThanOrEqual(0);
    expect(next.top).toBeGreaterThanOrEqual(0);
  });
});

describe('wheelStep', () => {
  const LINE = 1;
  const PAGE = 2;
  const PIXEL = 0;

  it('makes a line or page delta one zoom step', () => {
    expect(wheelStep({deltaY: -3, deltaMode: LINE})).toBe(ZOOM_STEP);
    expect(wheelStep({deltaY: 3, deltaMode: LINE})).toBe(1 / ZOOM_STEP);
    expect(wheelStep({deltaY: -1, deltaMode: PAGE})).toBe(ZOOM_STEP);
  });

  it('zooms continuously on small pixel deltas (a trackpad pinch)', () => {
    expect(wheelStep({deltaY: -10, deltaMode: PIXEL})).toBeCloseTo(Math.exp(0.1), 10);
    expect(wheelStep({deltaY: 4, deltaMode: PIXEL})).toBeCloseTo(Math.exp(-0.04), 10);
  });

  it('caps a large pixel delta (a mouse notch in Chrome) at one step', () => {
    expect(wheelStep({deltaY: -100, deltaMode: PIXEL})).toBe(ZOOM_STEP);
    expect(wheelStep({deltaY: 100, deltaMode: PIXEL})).toBe(1 / ZOOM_STEP);
  });

  it('does nothing for a zero delta', () => {
    expect(wheelStep({deltaY: 0, deltaMode: PIXEL})).toBe(1);
  });
});

describe('filterWheel', () => {
  const wheel = (over: Partial<{ctrlKey: boolean; deltaX: number; deltaY: number; timeStamp: number}>) => ({
    ctrlKey: false,
    deltaX: 0,
    deltaY: 10,
    timeStamp: 1000,
    ...over,
  });
  const afterPinch = (): WheelInertia => filterWheel(IDLE_WHEEL_INERTIA, wheel({ctrlKey: true, deltaY: 10, timeStamp: 1000})).state;

  it('prevents a ctrl/⌘ wheel — it zooms', () => {
    expect(filterWheel(IDLE_WHEEL_INERTIA, wheel({ctrlKey: true})).prevent).toBe(true);
  });

  it('lets a plain wheel scroll when no pinch preceded it', () => {
    expect(filterWheel(IDLE_WHEEL_INERTIA, wheel({})).prevent).toBe(false);
  });

  it('swallows the pinch’s inertia: same direction, similar size, within 140ms', () => {
    const first = filterWheel(afterPinch(), wheel({deltaY: 9, timeStamp: 1100}));
    expect(first.prevent).toBe(true);
    expect(filterWheel(first.state, wheel({deltaY: 7, timeStamp: 1200})).prevent).toBe(true);
  });

  it('lets the user scroll after a 140ms pause', () => {
    expect(filterWheel(afterPinch(), wheel({deltaY: 9, timeStamp: 1141})).prevent).toBe(false);
  });

  it('lets the user scroll when the direction flips', () => {
    expect(filterWheel(afterPinch(), wheel({deltaY: -9, timeStamp: 1050})).prevent).toBe(false);
  });

  it('lets the user pan sideways', () => {
    expect(filterWheel(afterPinch(), wheel({deltaX: 30, deltaY: 5, timeStamp: 1050})).prevent).toBe(false);
  });

  it('lets the user scroll when the delta grows past 1.35× (+1)', () => {
    expect(filterWheel(afterPinch(), wheel({deltaY: 14.6, timeStamp: 1050})).prevent).toBe(false);
    expect(filterWheel(afterPinch(), wheel({deltaY: 14.4, timeStamp: 1050})).prevent).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run frontend/pdf-viewer/viewport/__tests__/zoomMath.test.ts`
Expected: FAIL (cannot resolve `../zoomMath`).

- [ ] **Step 3: Implement**

`frontend/pdf-viewer/viewport/zoomMath.ts`:

```ts
/**
 * Zoom arithmetic for the canvas view — pure, no DOM, so every rule is unit
 * tested. The wheel-inertia filter is adapted from anaralabs/lector (MIT).
 */

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;
/** One zoom step: a button press, a key chord, or a mouse-wheel notch. */
export const ZOOM_STEP = 1.25;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export interface Point {
  x: number;
  y: number;
}

/**
 * The scroll position at `toZoom` that keeps the content under `pointer` where
 * it is. The page column scales uniformly with zoom (gaps included) and is
 * centred while narrower than the viewport, top-aligned always.
 */
export function anchoredScroll({
  pointer,
  scroll,
  viewportWidth,
  contentWidth,
  fromZoom,
  toZoom,
}: {
  pointer: Point;
  scroll: {left: number; top: number};
  viewportWidth: number;
  contentWidth: number;
  fromZoom: number;
  toZoom: number;
}): {left: number; top: number} {
  const inset = (zoom: number) => Math.max(0, (viewportWidth - contentWidth * zoom) / 2);
  // The pointer's position in the column at zoom 1.
  const x = (pointer.x + scroll.left - inset(fromZoom)) / fromZoom;
  const y = (pointer.y + scroll.top) / fromZoom;
  return {
    left: Math.max(0, x * toZoom + inset(toZoom) - pointer.x),
    top: Math.max(0, y * toZoom - pointer.y),
  };
}

const DOM_DELTA_PIXEL = 0;

/**
 * The zoom factor one ctrl/⌘ + wheel event asks for. A line or page delta (a
 * mouse notch) is one step; pixel deltas zoom continuously, capped at one step
 * per event — Chrome reports a mouse notch as ±100px.
 */
export function wheelStep({deltaY, deltaMode}: {deltaY: number; deltaMode: number}): number {
  if (deltaY === 0) return 1;
  if (deltaMode !== DOM_DELTA_PIXEL) return deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
  return Math.min(ZOOM_STEP, Math.max(1 / ZOOM_STEP, Math.exp(-deltaY / 100)));
}

/** How long after a pinch plain wheel events still count as its inertia. */
export const WHEEL_INERTIA_GAP_MS = 140;
/** A plain wheel delta this many times the last one (+1) is the user scrolling, not inertia. */
export const WHEEL_INERTIA_ESCAPE_FACTOR = 1.35;

export interface WheelInertia {
  active: boolean;
  lastTime: number;
  lastAbsDeltaY: number;
  lastSign: -1 | 0 | 1;
}

export const IDLE_WHEEL_INERTIA: WheelInertia = {active: false, lastTime: 0, lastAbsDeltaY: 0, lastSign: 0};

/**
 * Classify one wheel event. A trackpad keeps sending plain wheel events for a
 * moment after a pinch; scrolling on them would fling the page just zoomed.
 * Returns the next state and whether to prevent the native scroll. ctrl/⌘
 * events are always prevented — they zoom.
 */
export function filterWheel(
  state: WheelInertia,
  event: {ctrlKey: boolean; deltaX: number; deltaY: number; timeStamp: number},
): {state: WheelInertia; prevent: boolean} {
  const abs = Math.abs(event.deltaY);
  const sign = (event.deltaY > 0 ? 1 : event.deltaY < 0 ? -1 : 0) as -1 | 0 | 1;
  const tracked: WheelInertia = {active: true, lastTime: event.timeStamp, lastAbsDeltaY: abs, lastSign: sign};
  if (event.ctrlKey) return {state: tracked, prevent: true};
  if (!state.active) return {state, prevent: false};
  const escaped =
    // Inertia is vertical: a horizontal-dominant wheel is a pan.
    Math.abs(event.deltaX) > abs ||
    event.timeStamp - state.lastTime > WHEEL_INERTIA_GAP_MS ||
    (state.lastSign !== 0 && sign !== 0 && sign !== state.lastSign) ||
    (state.lastAbsDeltaY > 0 && abs > state.lastAbsDeltaY * WHEEL_INERTIA_ESCAPE_FACTOR + 1);
  if (escaped) return {state: IDLE_WHEEL_INERTIA, prevent: false};
  return {state: tracked, prevent: true};
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run frontend/pdf-viewer/viewport/__tests__/zoomMath.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/pdf-viewer/viewport
git commit -m "feat(pdf-viewer): pure zoom math — limits, anchoring, wheel steps, inertia"
```

### Task 13: Store zoom API and zoom controls (R14, R18)

**Files:**
- Modify: `frontend/pdf-viewer/core/state.ts`, `core/store.ts`, `ui/ZoomControls.tsx`, `primitives/CanvasLayer.tsx`, `primitives/TextLayer.tsx`, `viewport/usePageLayout.ts`
- Test: `frontend/pdf-viewer/__tests__/store.test.ts`, `context.test.tsx`, `injected-store.test.tsx`, `canvas-layer.test.tsx`, `frontend/pdf-viewer/ui/__tests__/ZoomControls.test.tsx` (new)

**Interfaces:**
- Consumes: `clampZoom`, `MIN_ZOOM`, `MAX_ZOOM`, `ZOOM_STEP` (Task 12).
- Produces:
  - `ViewerState`:
    - `zoom: number` (default 1)
    - `fitWidth: boolean` (default `false` in this phase; Task 18 makes it `true`)
    - `isGesturing: boolean` (default `false`)
  - `ViewerActions`:
    - `setZoom(zoom: number, opts?: {fitWidth?: boolean}): void` — clamps; `fitWidth` becomes `opts?.fitWidth ?? false`
    - `zoomBy(factor: number): void`
    - `setGesturing(isGesturing: boolean): void`
  - `scale` and `setScale` no longer exist.

- [ ] **Step 1: Write the failing tests**

In `store.test.ts`:
- Rename in every test: `setScale(` → `setZoom(`, `.scale` → `.zoom`, and `{scale: 1.5, currentPage: 7}` → `{zoom: 1.5, currentPage: 7}`.
- In the initial-state test, replace `expect(state.zoom).toBe(1);` with these three lines:
  ```ts
  expect(state.zoom).toBe(1);
  expect(state.fitWidth).toBe(false);
  expect(state.isGesturing).toBe(false);
  ```
- Append inside `describe('createViewerStore')`:

```ts
  it('setZoom clamps to the zoom limits', () => {
    const store = createViewerStore();
    store.getState().actions.setZoom(10);
    expect(store.getState().zoom).toBe(4);
    store.getState().actions.setZoom(0.01);
    expect(store.getState().zoom).toBe(0.25);
  });

  it('zoomBy multiplies the zoom and clamps', () => {
    const store = createViewerStore({zoom: 2});
    store.getState().actions.zoomBy(1.25);
    expect(store.getState().zoom).toBe(2.5);
    store.getState().actions.zoomBy(10);
    expect(store.getState().zoom).toBe(4);
  });

  it('a manual zoom turns fit width off unless asked to keep it', () => {
    const store = createViewerStore({fitWidth: true});
    store.getState().actions.setZoom(1.5, {fitWidth: true});
    expect(store.getState().fitWidth).toBe(true);
    store.getState().actions.zoomBy(1.25);
    expect(store.getState().fitWidth).toBe(false);
  });

  it('setGesturing records a gesture under way', () => {
    const store = createViewerStore();
    store.getState().actions.setGesturing(true);
    expect(store.getState().isGesturing).toBe(true);
  });
```

In `context.test.tsx` and `injected-store.test.tsx`:
- Replace `s.scale` with `s.zoom`.
- Replace `s.actions.setScale` with `s.actions.setZoom`.
- Replace `setScale(` with `setZoom(`.
- Replace every initial-state key `scale:` with `zoom:` (in `createViewerStore({...})` and `initial={{...}}`).
- Leave the `data-testid="scale"` / `"set-scale"` test ids and the helper component names unchanged.

In `canvas-layer.test.tsx`:
- Rename the helper option `scale` to `zoom`, in both the type and the `createViewerStore({zoom: opts.zoom, viewRotation: opts.viewRotation})` call.
- Replace every `{scale: 1.5, …}` argument with `{zoom: 1.5, …}`.

Create `frontend/pdf-viewer/ui/__tests__/ZoomControls.test.tsx`:

```tsx
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it} from 'vitest';

import {ViewerProvider} from '../../core/context';
import {createViewerStore} from '../../core/store';
import {ZoomControls} from '../ZoomControls';

function renderControls(zoom: number) {
  const store = createViewerStore({zoom});
  render(
    <ViewerProvider store={store}>
      <ZoomControls />
    </ViewerProvider>,
  );
  return store;
}

describe('<ZoomControls>', () => {
  it('zooms in and out by one step', async () => {
    const user = userEvent.setup();
    const store = renderControls(1);
    await user.click(screen.getByLabelText('Zoom in'));
    expect(store.getState().zoom).toBe(1.25);
    await user.click(screen.getByLabelText('Zoom out'));
    expect(store.getState().zoom).toBe(1);
  });

  it('stops at the limits', () => {
    renderControls(4);
    expect(screen.getByLabelText('Zoom in')).toBeDisabled();
  });

  it('shows the zoom as a percentage', () => {
    renderControls(1.5);
    expect(screen.getByRole('button', {name: '150%'})).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run frontend/pdf-viewer/__tests__/store.test.ts frontend/pdf-viewer/__tests__/context.test.tsx frontend/pdf-viewer/__tests__/injected-store.test.tsx frontend/pdf-viewer/__tests__/canvas-layer.test.tsx frontend/pdf-viewer/ui/__tests__/ZoomControls.test.tsx`
Expected: FAIL. `setZoom`, `zoomBy` and `setGesturing` are not functions, and `zoom` is undefined.

- [ ] **Step 3: Store**

`core/state.ts`:
- Replace the `/** Render scale… */ scale: number;` pair with:

```ts
  /**
   * Committed zoom: 1 = 100%. A gesture previews its zoom as a transform and
   * commits it here when it ends.
   */
  zoom: number;
  /** While true, `zoom` follows the viewer's width; any manual zoom turns it off. */
  fitWidth: boolean;
  /** True while a pinch or ctrl/⌘ + wheel gesture is under way. */
  isGesturing: boolean;
```

- Replace `setScale(scale: number): void;` with:

```ts
  /** Set the zoom, clamped to the limits. Turns fit width off unless `opts.fitWidth` is true. */
  setZoom(zoom: number, opts?: {fitWidth?: boolean}): void;
  /** Multiply the zoom by `factor` (clamped); turns fit width off. */
  zoomBy(factor: number): void;
  setGesturing(isGesturing: boolean): void;
```

`core/store.ts`:
- In `initialData`, replace `scale: 1,` with three keys: `zoom: 1,`, `fitWidth: false,` and `isGesturing: false,`.
- Replace `setScale` with:

```ts
      setZoom(zoom: number, opts?: {fitWidth?: boolean}) {
        set({zoom: clampZoom(zoom), fitWidth: opts?.fitWidth ?? false});
      },

      zoomBy(factor: number) {
        get().actions.setZoom(get().zoom * factor);
      },

      setGesturing(isGesturing: boolean) {
        set({isGesturing});
      },
```

- Add `import {clampZoom} from '../viewport/zoomMath';`.

- [ ] **Step 4: Consumers**

- `primitives/CanvasLayer.tsx`:
  - Replace `const scale = useViewerStore((s) => s.scale);` with `const zoom = useViewerStore((s) => s.zoom);`.
  - `const renderScale = zoom * dpr;`
  - `displayedSize(page.size, viewRotation, zoom)`
  - Dependency array `[page, zoom, viewRotation, pageNumber]`.
- `primitives/TextLayer.tsx`:
  - Same selector change.
  - `const renderScale = zoom * dpr;`
  - Dependency array `[page, zoom, viewRotation, pageNumber]`.
- `viewport/usePageLayout.ts`: `const zoom = useViewerStore((s) => s.zoom);`

`ui/ZoomControls.tsx` — replace the component and `PRESETS` block with:

```tsx
const PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function ZoomControls({className}: {className?: string}) {
  const zoom = useViewerStore((s) => s.zoom);
  const actions = useViewerStore((s) => s.actions);

  return (
    <div className={cn('flex items-center gap-0.5', className)}>
      <IconButton
        label={t('pdf', 'viewerZoomOut')}
        side="bottom"
        onClick={() => actions.zoomBy(1 / ZOOM_STEP)}
        disabled={zoom <= MIN_ZOOM}
        data-viewer-step=""
        icon={<ZoomOut strokeWidth={1.5} />}
      />
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="min-w-12 justify-center px-1.5 tabular-nums">
                {Math.round(zoom * 100)}%
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="px-2.5 py-1.5 text-[12px]">
            {t('pdf', 'viewerZoomLevel')}
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end">
          {PRESETS.map((p) => (
            <DropdownMenuItem key={p} onClick={() => actions.setZoom(p)} className="text-[13px] tabular-nums">
              {Math.round(p * 100)}%
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <IconButton
        label={t('pdf', 'viewerZoomIn')}
        side="bottom"
        onClick={() => actions.zoomBy(ZOOM_STEP)}
        disabled={zoom >= MAX_ZOOM}
        data-viewer-step=""
        icon={<ZoomIn strokeWidth={1.5} />}
      />
    </div>
  );
}
```

Add `import {MAX_ZOOM, MIN_ZOOM, ZOOM_STEP} from '../viewport/zoomMath';`.

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run frontend/pdf-viewer`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS. Then `grep -rn "setScale\|s\.scale" frontend` must print nothing.

- [ ] **Step 6: Commit**

```bash
git add frontend/pdf-viewer
git commit -m "refactor(pdf-viewer): zoom store API with limits in one place"
```

### Task 14: Pinch and ctrl/⌘ + wheel zoom with a fixed anchor (R16, and R10's gesture freeze)

**Files:**
- Create: `frontend/pdf-viewer/viewport/useGestureZoom.ts`
- Modify: `frontend/pdf-viewer/primitives/Viewer.tsx` (`Body`, `Pages`), `viewport/useVirtualPages.ts`, `hooks/usePageScrollSync.ts`, `package.json`, `package-lock.json`
- Test: `frontend/pdf-viewer/__tests__/gesture-zoom.test.tsx` (new), `page-scroll-sync.test.tsx`, `virtual-pages.test.tsx`

**Interfaces:**
- Consumes: `anchoredScroll`, `clampZoom`, `filterWheel`, `IDLE_WHEEL_INERTIA`, `wheelStep`, `Point` (Task 12); `setZoom`, `setGesturing`, `isGesturing`, `zoom` (Task 13); `PageLayout.naturalWidth`, `width`, `totalHeight` (Task 7).
- Produces:
  - `useGestureZoom({scroller, sizer, pages, layout}): void`.
  - `useVirtualPages({scroller, layout, isGesturing}): VirtualItem[]`.
  - DOM contract: `[data-pdf-viewer-body]` › `[data-pdf-viewer-sizer]` (centred, sized to the column) › `[data-pdf-viewer-pages]` (`transform-origin: 0 0`; a live gesture sets `transform: scale(zoom / committedZoom)`).
  - Scroll sync publishes nothing while `isGesturing`, and publishes once when it ends.

- [ ] **Step 1: Install the dependency**

Run: `npm install @use-gesture/react@^10.3.1`
Expected: `package.json` `dependencies` gains `"@use-gesture/react"`. `pinchOnWheel` exists in `@use-gesture/core` 10.3.1 (verified).

- [ ] **Step 2: Write the failing tests**

`frontend/pdf-viewer/__tests__/gesture-zoom.test.tsx`:

```tsx
/**
 * ctrl/⌘ + wheel zooms around the pointer: the content under it stays put, the
 * zoom previews as a transform, and commits to the store when the wheel pauses.
 * jsdom has no layout, so the scroller's geometry is stubbed and animation
 * frames run at once. Trackpad and touch pinch are verified by hand (Task 16).
 */
import {act, render} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import * as legacyPdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
vi.mock('pdfjs-dist', () => legacyPdfjs);

import {ViewerProvider} from '../core/context';
import {createViewerStore} from '../core/store';

const {Viewer} = await import('../primitives/Viewer');

const LETTER = {width: 612, height: 792};

beforeEach(() => {
  vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(725);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderViewer() {
  // fitWidth off: this test drives the zoom itself.
  const store = createViewerStore({numPages: 20, pageSizes: {1: LETTER}, fitWidth: false});
  const {container} = render(
    <ViewerProvider store={store}>
      <Viewer.Body>
        <Viewer.Pages>{({number}) => <Viewer.Page pageNumber={number} />}</Viewer.Pages>
      </Viewer.Body>
    </ViewerProvider>,
  );
  const scroller = container.querySelector<HTMLElement>('[data-pdf-viewer-body]')!;
  const pages = container.querySelector<HTMLElement>('[data-pdf-viewer-pages]')!;
  Object.defineProperty(scroller, 'clientWidth', {configurable: true, value: 800});
  Object.defineProperty(scroller, 'clientHeight', {configurable: true, value: 725});
  scroller.getBoundingClientRect = () => ({left: 0, top: 100, right: 800, bottom: 825, width: 800, height: 725, x: 0, y: 100, toJSON: () => ({})});
  scroller.scrollTop = 1000;
  return {store, scroller, pages};
}

const ctrlWheel = (deltaY: number, clientX = 400, clientY = 400) =>
  new WheelEvent('wheel', {ctrlKey: true, deltaY, deltaMode: 0, clientX, clientY, bubbles: true, cancelable: true});

describe('ctrl/⌘ + wheel zoom', () => {
  it('previews the zoom around the pointer and commits it when the wheel pauses', () => {
    const {store, scroller, pages} = renderViewer();

    const event = ctrlWheel(-100); // one step in: 1 → 1.25
    act(() => {
      scroller.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(store.getState().isGesturing).toBe(true);
    expect(store.getState().zoom).toBe(1); // not committed yet
    expect(pages.style.transform).toBe('scale(1.25)');
    // The pointer is 400px right of and 300px below the scroller's corner. At
    // zoom 1 the 644px column is centred (78px inset), so it is over column
    // x=322, y=1300; at 1.25 the 805px column overflows the 800px viewport.
    expect(scroller.scrollTop).toBe(1300 * 1.25 - 300);
    expect(scroller.scrollLeft).toBe(322 * 1.25 - 400);

    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(store.getState().zoom).toBe(1.25);
    expect(store.getState().isGesturing).toBe(false);
    expect(store.getState().fitWidth).toBe(false);
    expect(pages.style.transform).toBe('');
    expect(scroller.scrollTop).toBe(1300 * 1.25 - 300);
  });

  it('lets a plain wheel scroll the document', () => {
    const {store, scroller} = renderViewer();
    const event = new WheelEvent('wheel', {deltaY: 40, bubbles: true, cancelable: true});
    act(() => {
      scroller.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
    expect(store.getState().isGesturing).toBe(false);
  });

  it('does not touch a ctrl + wheel outside the viewer', () => {
    const {store} = renderViewer();
    const event = ctrlWheel(-100);
    act(() => {
      document.body.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
    expect(store.getState().isGesturing).toBe(false);
  });
});

describe('a zoom that is not a gesture', () => {
  it('keeps the top of the viewport on the same content', () => {
    const {store, scroller} = renderViewer();
    act(() => store.getState().actions.setZoom(2));
    // Anchored at the top centre: column y=1000 stays at the top edge.
    expect(scroller.scrollTop).toBe(2000);
    expect(scroller.scrollLeft).toBe(322 * 2 - 400);
  });
});
```

Append to `page-scroll-sync.test.tsx` inside `describe('Viewer.Body page sync')`:

```tsx
  it('publishes nothing during a zoom gesture, then where it left the viewport', () => {
    const {store, frame} = renderBody({numPages: 14, currentPage: 1});
    act(() => store.getState().actions.setGesturing(true));
    frame(pageTop(9));
    expect(store.getState().currentPage).toBe(1);
    act(() => store.getState().actions.setGesturing(false));
    expect(store.getState().currentPage).toBe(9);
  });
```

Append to `virtual-pages.test.tsx` inside `describe('Viewer.Pages virtualization')`:

```tsx
  it('keeps the pages mounted when a gesture began while it runs', async () => {
    const {store, mounted, scrollTo} = await renderDocument(18);
    await waitFor(() => expect(mounted()).toEqual([1, 2]));
    act(() => store.getState().actions.setGesturing(true));
    scrollTo(layout.offsetOf(10));
    await waitFor(() => expect(mounted()).toEqual(expect.arrayContaining([1, 2, 9, 10, 11])));
    act(() => store.getState().actions.setGesturing(false));
    await waitFor(() => expect(mounted()).toEqual([9, 10, 11]));
  });
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run frontend/pdf-viewer/__tests__/gesture-zoom.test.tsx frontend/pdf-viewer/__tests__/page-scroll-sync.test.tsx frontend/pdf-viewer/__tests__/virtual-pages.test.tsx`
Expected: FAIL. No wheel handler exists; `[data-pdf-viewer-pages]` has no transform; a store zoom leaves `scrollTop` at 1000; scrolling publishes during a gesture; pages 1–2 unmount.

- [ ] **Step 4: Create `viewport/useGestureZoom.ts`**

```ts
/**
 * Pinch (touch, trackpad) and ctrl/⌘ + wheel zoom on the canvas view.
 *
 * Adapted from anaralabs/lector (MIT): a gesture previews its zoom as a CSS
 * transform on the page column, keeps the content under the pointer in place
 * by writing the scroll position at most once per animation frame, and commits
 * the zoom to the store only when it ends — so pages re-lay out and re-render
 * once, not per event. A zoom that does not come from a gesture (buttons, keys,
 * fit width) is anchored at the top centre of the viewport.
 */
import {usePinch} from '@use-gesture/react';
import {useEffect, useLayoutEffect, useMemo, useRef} from 'react';
import type {StoreApi} from 'zustand';
import {useViewerStoreApi} from '../core/context';
import type {ViewerState} from '../core/state';
import type {PageLayout} from './usePageLayout';
import {IDLE_WHEEL_INERTIA, anchoredScroll, clampZoom, filterWheel, wheelStep, type Point} from './zoomMath';

/** A ctrl/⌘ + wheel gesture ends once its events pause this long. */
const WHEEL_GESTURE_END_MS = 150;

interface Elements {
  scroller: HTMLElement;
  sizer: HTMLElement;
  pages: HTMLElement;
}

interface Gesture {
  committedZoom: number;
  appliedZoom: number;
  zoom: number;
  pointer: Point;
  startScroll: {left: number; top: number};
  frame: number | null;
}

function createGestureController(storeApi: StoreApi<ViewerState>, {scroller, sizer, pages}: Elements) {
  let layout: PageLayout | null = null;
  let gesture: Gesture | null = null;
  let committed = false;

  function paint() {
    if (!gesture || !layout) return;
    gesture.frame = null;
    const scale = gesture.zoom / gesture.committedZoom;
    const scroll = anchoredScroll({
      pointer: gesture.pointer,
      scroll: {left: scroller.scrollLeft, top: scroller.scrollTop},
      viewportWidth: scroller.clientWidth,
      contentWidth: layout.naturalWidth,
      fromZoom: gesture.appliedZoom,
      toZoom: gesture.zoom,
    });
    // Resize the sizer first, so the scroll position is not clamped to the old size.
    sizer.style.width = `${layout.width * scale}px`;
    sizer.style.height = `${layout.totalHeight * scale}px`;
    pages.style.transform = `scale(${scale})`;
    scroller.scrollLeft = scroll.left;
    scroller.scrollTop = scroll.top;
    gesture.appliedZoom = gesture.zoom;
  }

  function restoreCommittedGeometry() {
    if (!layout) return;
    sizer.style.width = `${layout.width}px`;
    sizer.style.height = `${layout.totalHeight}px`;
    pages.style.transform = '';
  }

  return {
    /** The layout at the committed zoom. */
    setLayout(next: PageLayout) {
      layout = next;
    },

    /** The zoom of the gesture under way, else the committed zoom. */
    zoom(): number {
      return gesture?.zoom ?? storeApi.getState().zoom;
    },

    /** Zoom to `zoom` keeping the content under `pointer` (px from the scroller's top-left) in place. */
    zoomTo(zoom: number, pointer: Point) {
      if (!gesture) {
        const committedZoom = storeApi.getState().zoom;
        gesture = {
          committedZoom,
          appliedZoom: committedZoom,
          zoom: committedZoom,
          pointer,
          startScroll: {left: scroller.scrollLeft, top: scroller.scrollTop},
          frame: null,
        };
        storeApi.getState().actions.setGesturing(true);
      }
      gesture.zoom = clampZoom(zoom);
      gesture.pointer = pointer;
      if (gesture.frame === null) gesture.frame = requestAnimationFrame(paint);
    },

    /** Commit the gesture's zoom to the store. */
    end() {
      if (!gesture) return;
      if (gesture.frame !== null) {
        cancelAnimationFrame(gesture.frame);
        paint();
      }
      const {zoom, committedZoom} = gesture;
      gesture = null;
      if (zoom === committedZoom) restoreCommittedGeometry();
      else committed = true;
      const {actions} = storeApi.getState();
      actions.setZoom(zoom);
      actions.setGesturing(false);
    },

    /** Abandon the gesture: back to the committed zoom and the scroll position it started from. */
    cancel() {
      if (!gesture) return;
      if (gesture.frame !== null) cancelAnimationFrame(gesture.frame);
      const {startScroll} = gesture;
      gesture = null;
      restoreCommittedGeometry();
      scroller.scrollLeft = startScroll.left;
      scroller.scrollTop = startScroll.top;
      storeApi.getState().actions.setGesturing(false);
    },

    /** True once after `end()` committed a new zoom — that zoom is already anchored. */
    takeCommitted(): boolean {
      const was = committed;
      committed = false;
      return was;
    },
  };
}

export function useGestureZoom({
  scroller,
  sizer,
  pages,
  layout,
}: {
  scroller: HTMLElement | null;
  sizer: HTMLElement | null;
  pages: HTMLElement | null;
  layout: PageLayout;
}): void {
  const storeApi = useViewerStoreApi();
  const controller = useMemo(
    () => (scroller && sizer && pages ? createGestureController(storeApi, {scroller, sizer, pages}) : null),
    [storeApi, scroller, sizer, pages],
  );

  // A new committed zoom: drop the preview transform, and anchor a zoom that
  // did not come from a gesture at the top centre of the viewport.
  const previousZoom = useRef(layout.zoom);
  useLayoutEffect(() => {
    controller?.setLayout(layout);
    const fromZoom = previousZoom.current;
    previousZoom.current = layout.zoom;
    if (!controller || !scroller || !pages || fromZoom === layout.zoom) return;
    pages.style.transform = '';
    if (controller.takeCommitted()) return;
    const scroll = anchoredScroll({
      pointer: {x: scroller.clientWidth / 2, y: 0},
      scroll: {left: scroller.scrollLeft, top: scroller.scrollTop},
      viewportWidth: scroller.clientWidth,
      contentWidth: layout.naturalWidth,
      fromZoom,
      toZoom: layout.zoom,
    });
    scroller.scrollLeft = scroll.left;
    scroller.scrollTop = scroll.top;
  }, [controller, layout, scroller, pages]);

  useEffect(() => {
    if (!controller || !scroller) return;
    let inertia = IDLE_WHEEL_INERTIA;
    let endTimer: ReturnType<typeof setTimeout> | undefined;

    const onWheel = (event: WheelEvent) => {
      const ctrlKey = event.ctrlKey || event.metaKey;
      const next = filterWheel(inertia, {ctrlKey, deltaX: event.deltaX, deltaY: event.deltaY, timeStamp: event.timeStamp});
      inertia = next.state;
      if (next.prevent) event.preventDefault();
      if (!ctrlKey) return;
      const rect = scroller.getBoundingClientRect();
      controller.zoomTo(controller.zoom() * wheelStep(event), {x: event.clientX - rect.left, y: event.clientY - rect.top});
      clearTimeout(endTimer);
      endTimer = setTimeout(() => controller.end(), WHEEL_GESTURE_END_MS);
    };
    // Safari turns a trackpad pinch into gesture events and zooms the whole page on them.
    const preventPageZoom = (event: Event) => event.preventDefault();
    const cancel = () => controller.cancel();
    const resizes = new ResizeObserver(cancel);

    scroller.addEventListener('wheel', onWheel, {passive: false});
    scroller.addEventListener('gesturestart', preventPageZoom);
    scroller.addEventListener('gesturechange', preventPageZoom);
    // Capture: a cancelled touch restores before the pinch handler could commit.
    scroller.addEventListener('pointercancel', cancel, {capture: true});
    resizes.observe(scroller);
    return () => {
      clearTimeout(endTimer);
      controller.cancel();
      scroller.removeEventListener('wheel', onWheel);
      scroller.removeEventListener('gesturestart', preventPageZoom);
      scroller.removeEventListener('gesturechange', preventPageZoom);
      scroller.removeEventListener('pointercancel', cancel, {capture: true});
      resizes.disconnect();
    };
  }, [controller, scroller]);

  usePinch(
    ({first, last, movement: [ratio], origin: [x, y], memo}) => {
      if (!controller || !scroller) return memo;
      if (last) {
        controller.end();
        return memo;
      }
      const startZoom: number = first ? controller.zoom() : memo;
      const rect = scroller.getBoundingClientRect();
      controller.zoomTo(startZoom * ratio, {x: x - rect.left, y: y - rect.top});
      return startZoom;
    },
    // ctrl/⌘ + wheel is handled above with its own step and inertia filter.
    {target: scroller ?? undefined, eventOptions: {passive: false}, pinchOnWheel: false, enabled: controller !== null},
  );
}
```

- [ ] **Step 5: Freeze the mounted pages during a gesture**

Replace `viewport/useVirtualPages.ts`'s signature and its `return` line so the whole hook reads:

```ts
export function useVirtualPages({
  scroller,
  layout,
  isGesturing,
}: {
  scroller: HTMLElement | null;
  layout: PageLayout;
  /** While true the mounted set only grows: the virtualizer sees scroll offsets at the preview's scale. */
  isGesturing: boolean;
}): VirtualItem[] {
  // …useVirtualizer call and the layout effect unchanged…

  const items = virtualizer.getVirtualItems();
  // The pages mounted when the gesture began, kept until it ends.
  const [held, setHeld] = useState<{isGesturing: boolean; items: VirtualItem[]}>({isGesturing: false, items: []});
  if (held.isGesturing !== isGesturing) setHeld({isGesturing, items: isGesturing ? items : []});
  if (!isGesturing) return items;
  const byIndex = new Map(items.map((item) => [item.index, item]));
  for (const item of held.items) byIndex.set(item.index, item);
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}
```

Add `useState` to its React import. In the header comment, append this sentence: "During a pinch it keeps the pages mounted when the gesture began, adding any it reveals."

- [ ] **Step 6: Hold the scroll sync during a gesture**

In `hooks/usePageScrollSync.ts` `createPageScrollSync`, change `onScroll` to:

```ts
    /**
     * The scroll position may have moved: publish its page, unless a
     * programmatic scroll is travelling or a zoom gesture is previewing (its
     * scroll positions are at the preview's scale).
     */
    onScroll() {
      if (!unsettled && !storeApi.getState().isGesturing) publishLocatedPage();
    },
```

In `usePageScrollSync`, after the locator effect, add:

```ts
  // A gesture's scroll events were not published; publish where it left the
  // viewport once it commits (the locator above already has the new layout).
  const isGesturing = useViewerStore((s) => s.isGesturing);
  const wasGesturing = useRef(false);
  useEffect(() => {
    if (wasGesturing.current && !isGesturing) sync.onScroll();
    wasGesturing.current = isGesturing;
  }, [isGesturing, sync]);
```

Keep hook calls at the top: put the `isGesturing` selector next to the `currentPage` selector.

- [ ] **Step 7: Wire `Viewer.Body` and `Viewer.Pages`**

In `primitives/Viewer.tsx`:
- Add `import {useGestureZoom} from '../viewport/useGestureZoom';`.
- In `Body`, change the scroller's `style` to `{overflow: 'auto', position: 'relative', height: '100%', touchAction: 'pan-x pan-y'}` and add this comment above the JSX: `// pan-x pan-y: one finger still scrolls; the browser's own pinch-zoom is off so the pinch reaches useGestureZoom.`
- Replace `Pages` with:

```tsx
/**
 * Mounts only the pages near the viewport, each in a slot the page layout
 * positions. The column is as tall as the whole document, so the scrollbar and
 * page navigation work before any other page has rendered. A zoom gesture
 * resizes the sizer and scales the column inside it (`useGestureZoom`).
 */
function Pages({children}: {children: (page: {number: number}) => ReactNode}) {
  const scroller = useContext(ScrollerContext);
  const layout = usePageLayout();
  const isGesturing = useViewerStore((s) => s.isGesturing);
  const items = useVirtualPages({scroller, layout, isGesturing});
  const [sizer, setSizer] = useState<HTMLDivElement | null>(null);
  const [pages, setPages] = useState<HTMLDivElement | null>(null);
  useGestureZoom({scroller, sizer, pages, layout});

  if (layout.numPages === 0) return null;
  return (
    <div ref={setSizer} data-pdf-viewer-sizer="" style={{margin: '0 auto', width: layout.width, height: layout.totalHeight}}>
      <div
        ref={setPages}
        data-pdf-viewer-pages=""
        style={{position: 'relative', width: layout.width, height: layout.totalHeight, transformOrigin: '0 0'}}
      >
        {items.map((item) => {
          const page = item.index + 1;
          const {width, height} = layout.sizeOf(page);
          return (
            <div
              key={item.key}
              style={{position: 'absolute', top: layout.offsetOf(page), left: (layout.width - width) / 2, width, height}}
            >
              {children({number: page})}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Run the tests, typecheck and both knip modes**

Run: `npx vitest run frontend/pdf-viewer`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS.

Run: `npx knip --no-tag-hints`
Expected: 0.

Run: `npx knip --production --no-tag-hints`
Expected: 0.

- [ ] **Step 9: Commit**

```bash
git add -A frontend/pdf-viewer package.json package-lock.json
git commit -m "feat(pdf-viewer): pinch and ctrl/cmd+wheel zoom around the pointer"
```

### Task 15: ⌘/Ctrl `=` and `-` zoom while the viewer has the pointer or focus (R17)

**Files:**
- Create: `frontend/pdf-viewer/viewport/useZoomShortcuts.ts`
- Modify: `frontend/pdf-viewer/primitives/Viewer.tsx` (`Body`)
- Test: `frontend/pdf-viewer/viewport/__tests__/useZoomShortcuts.test.tsx` (new)

**Interfaces:**
- Consumes:
  - `useKeyboardShortcuts({bindings, enabled})` from `frontend/hooks/useKeyboardShortcuts.ts`. Mod chords match in the capture phase, `preventDefault` on a match, and fire inside inputs.
  - `zoomBy` (Task 13) and `ZOOM_STEP` (Task 12).
- Produces: `useZoomShortcuts(scroller: HTMLElement | null): void`. Its zone is the closest `[data-pdf-viewer-root]` (toolbar, search bar and pages).

- [ ] **Step 1: Write the failing test**

```tsx
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

import * as legacyPdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
vi.mock('pdfjs-dist', () => legacyPdfjs);

import {ViewerProvider} from '../../core/context';
import {createViewerStore} from '../../core/store';

const {Viewer} = await import('../../primitives/Viewer');

// jsdom's user agent is not a Mac, so `mod` is Control here.
function renderViewer() {
  const store = createViewerStore({fitWidth: false});
  render(
    <ViewerProvider store={store}>
      <button type="button">Outside the viewer</button>
      <div data-pdf-viewer-root="" data-testid="viewer-root">
        <Viewer.Body>{null}</Viewer.Body>
      </div>
    </ViewerProvider>,
  );
  return store;
}

describe('zoom shortcuts', () => {
  it('zooms in and out while the pointer is over the viewer', async () => {
    const user = userEvent.setup();
    const store = renderViewer();
    await user.hover(screen.getByTestId('viewer-root'));
    await user.keyboard('{Control>}={/Control}');
    expect(store.getState().zoom).toBe(1.25);
    await user.keyboard('{Control>}-{/Control}');
    expect(store.getState().zoom).toBe(1);
  });

  it('leaves the browser’s zoom alone while the viewer has neither pointer nor focus', async () => {
    const user = userEvent.setup();
    const store = renderViewer();
    await user.hover(screen.getByRole('button', {name: 'Outside the viewer'}));
    await user.keyboard('{Control>}={/Control}');
    expect(store.getState().zoom).toBe(1);
  });

  it('zooms while focus is inside the viewer', async () => {
    const user = userEvent.setup();
    const store = renderViewer();
    const body = screen.getByTestId('viewer-root').querySelector<HTMLElement>('[data-pdf-viewer-body]')!;
    body.tabIndex = -1;
    body.focus();
    await user.keyboard('{Control>}={/Control}');
    expect(store.getState().zoom).toBe(1.25);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run frontend/pdf-viewer/viewport/__tests__/useZoomShortcuts.test.tsx`
Expected: FAIL. The zoom stays 1 in the first and third tests.

- [ ] **Step 3: Implement**

`frontend/pdf-viewer/viewport/useZoomShortcuts.ts`:

```ts
/**
 * ⌘/Ctrl `=` and `-` zoom the canvas while the pointer or focus is inside the
 * viewer; everywhere else the browser keeps its own page zoom.
 */
import {useEffect, useState} from 'react';
import {useKeyboardShortcuts} from '@/hooks/useKeyboardShortcuts';
import {useViewerStoreApi} from '../core/context';
import {ZOOM_STEP} from './zoomMath';

export function useZoomShortcuts(scroller: HTMLElement | null): void {
  const storeApi = useViewerStoreApi();
  const inside = usePointerOrFocusInside(scroller);
  useKeyboardShortcuts({
    enabled: inside,
    bindings: [
      {type: 'chord', key: '=', mod: true, handler: () => storeApi.getState().actions.zoomBy(ZOOM_STEP)},
      {type: 'chord', key: '-', mod: true, handler: () => storeApi.getState().actions.zoomBy(1 / ZOOM_STEP)},
    ],
  });
}

/** Whether the pointer or focus is inside the viewer root around `scroller`. */
function usePointerOrFocusInside(scroller: HTMLElement | null): boolean {
  const [pointerInside, setPointerInside] = useState(false);
  const [focusInside, setFocusInside] = useState(false);

  useEffect(() => {
    const root = scroller?.closest<HTMLElement>('[data-pdf-viewer-root]');
    if (!root) return;
    const enter = () => setPointerInside(true);
    const leave = () => setPointerInside(false);
    const focusIn = () => setFocusInside(true);
    const focusOut = (event: FocusEvent) =>
      setFocusInside(event.relatedTarget instanceof Node && root.contains(event.relatedTarget));
    root.addEventListener('pointerenter', enter);
    root.addEventListener('pointerleave', leave);
    root.addEventListener('focusin', focusIn);
    root.addEventListener('focusout', focusOut);
    return () => {
      root.removeEventListener('pointerenter', enter);
      root.removeEventListener('pointerleave', leave);
      root.removeEventListener('focusin', focusIn);
      root.removeEventListener('focusout', focusOut);
    };
  }, [scroller]);

  return pointerInside || focusInside;
}
```

In `primitives/Viewer.tsx` `Body`:
- Add `useZoomShortcuts(scroller);` after the `usePageScrollSync(...)` call.
- Import it from `../viewport/useZoomShortcuts`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run frontend/pdf-viewer frontend/hooks`
Expected: PASS.

If the first test fails because `user.hover` does not reach a listener on the root, check that the root receives `pointerenter`. user-event dispatches `pointerover`/`pointerenter` on the hovered element, and `pointerenter` does not bubble, so hover the root element itself, as the test does.

- [ ] **Step 5: Commit**

```bash
git add frontend/pdf-viewer
git commit -m "feat(pdf-viewer): cmd/ctrl = and - zoom inside the viewer"
```

### Task 16: README, Phase 2 gate, hands-on verification

**Files:**
- Modify: `frontend/pdf-viewer/README.md`

- [ ] **Step 1: README**

In the modules tree, change the `viewport/` line to:

```text
├── viewport/      usePageLayout, useVirtualPages, zoomMath, useGestureZoom, useZoomShortcuts
```

Append:

```markdown
## Zoom

`zoom` in the store is the committed zoom (`MIN_ZOOM` 0.25 – `MAX_ZOOM` 4,
`viewport/zoomMath.ts`). A pinch or ctrl/⌘ + wheel previews its zoom as a
transform on the page column, keeps the content under the pointer in place,
and commits once the gesture ends (`useGestureZoom`, adapted from Lector). The
toolbar and ⌘/Ctrl `=` `-` step by `ZOOM_STEP`; those shortcuts only act while
the pointer or focus is inside the viewer.
```

- [ ] **Step 2: Commit**

```bash
git add frontend/pdf-viewer/README.md
git commit -m "docs(pdf-viewer): document zoom"
```

- [ ] **Step 3: Phase 2 gate**

Run every command in Global Constraints § Phase gate. Expected: all green, both knip modes at 0.

- [ ] **Step 4: Verify in the Browser pane**

1. Start the local dev server with `preview_start` and open a run's PDF view.
2. Dispatch a ctrl + wheel event over the second page with `javascript_tool`:
   `document.querySelector('[data-pdf-viewer-body]').dispatchEvent(new WheelEvent('wheel', {ctrlKey: true, deltaY: -100, clientX: <x>, clientY: <y>, bubbles: true, cancelable: true}))`.
3. After 300 ms, read the zoom label (`get_page_text`). Expected: `125%`.
4. Take a screenshot as proof.
5. Check `read_console_messages` with `onlyErrors`. Expected: none.
6. Press ⌘/Ctrl `=` with the pointer over the pages. Expected: 150%.
7. Press it with focus in the extraction form. Expected: the browser zooms and the viewer does not.
8. Run `/design-review` on the run split view.

A trackpad pinch and a touch pinch cannot be synthesized faithfully. Ask the user to try both once (trackpad in Chrome and Safari; touch on a tablet or phone) and record their result in the PR description.

# Phase 3 — sharp re-render after the zoom settles (R19, R20)

Branch: `feat/pdf-viewer-phase3-deferred-render` from `origin/dev`, after the Phase 2 PR merged.

### Task 17: Canvas and text layer render once the zoom settles

**Files:**
- Modify: `frontend/pdf-viewer/primitives/CanvasLayer.tsx`, `frontend/pdf-viewer/primitives/TextLayer.tsx`
- Test: `frontend/pdf-viewer/__tests__/deferred-render.test.tsx` (new), `canvas-layer.test.tsx` (existing, stays green)

**Interfaces:**
- Consumes: `zoom`, `viewRotation`, `isGesturing` (store); `displayedSize`, `effectiveRotation`.
- Produces:
  - A page's first render starts at once. A later zoom or rotation change renders 100 ms after the last change.
  - Nothing renders while `isGesturing`: the canvas keeps its bitmap, and the text layer is emptied.
  - Render scale = `zoom × min(devicePixelRatio, 2)`, lowered so the backing store stays ≤ 16 777 216 px.

- [ ] **Step 1: Write the failing test**

```tsx
import {act, render} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {ViewerProvider} from '../core/context';
import type {RenderOptions} from '../core/engine';
import {createViewerStore} from '../core/store';
import {createMockEngine} from '../engines/mock';
import {CanvasLayer} from '../primitives/CanvasLayer';
import {TextLayer} from '../primitives/TextLayer';

const LETTER = {width: 612, height: 792};

beforeEach(() => {
  vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function renderPage(zoom = 1) {
  const renders: RenderOptions[] = [];
  const textLayers: number[] = [];
  const engine = createMockEngine({
    numPages: 1,
    pageSize: LETTER,
    text: ['page one'],
    onRender: (_page, opts) => renders.push(opts),
    onRenderTextLayer: (page) => textLayers.push(page),
  });
  const store = createViewerStore({zoom, fitWidth: false});
  store.getState().actions.setDocument(await engine.load({kind: 'url', url: 'mock.pdf'}));
  const {container} = render(
    <ViewerProvider store={store}>
      <CanvasLayer pageNumber={1} />
      <TextLayer pageNumber={1} />
    </ViewerProvider>,
  );
  // The page handle resolves, then the first render starts at once.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  return {store, container, renders, textLayers};
}

describe('deferred page rendering', () => {
  it('renders a burst of zoom changes once, 100ms after the last', async () => {
    const {store, renders, textLayers} = await renderPage();
    // Precondition: the first render did not wait.
    expect(renders).toHaveLength(1);
    expect(textLayers).toHaveLength(1);

    for (const zoom of [1.1, 1.2, 1.3, 1.4, 1.5]) {
      act(() => store.getState().actions.setZoom(zoom));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20);
      });
    }
    expect(renders).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(renders).toHaveLength(2);
    expect(textLayers).toHaveLength(2);
    expect(renders[1].scale).toBe(1.5);
  });

  it('keeps the canvas bitmap and hides the text layer during a gesture', async () => {
    const {store, container, renders} = await renderPage();
    act(() => store.getState().actions.setGesturing(true));
    expect(container.querySelector('.pdf-viewer-text-layer span')).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(renders).toHaveLength(1);

    act(() => {
      store.getState().actions.setZoom(2);
      store.getState().actions.setGesturing(false);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(renders).toHaveLength(2);
    expect(container.querySelector('.pdf-viewer-text-layer span')?.textContent).toBe('page one');
  });

  it('caps the device pixel ratio at 2 and the backing store at 16 777 216 pixels', async () => {
    vi.stubGlobal('devicePixelRatio', 3);
    const low = await renderPage(1);
    expect(low.renders[0].scale).toBe(2); // zoom 1 × min(3, 2)

    const high = await renderPage(4);
    const {scale} = high.renders[0];
    expect(scale).toBeGreaterThan(4);
    // At the cap the product equals the budget up to float rounding.
    expect(LETTER.width * scale * LETTER.height * scale).toBeLessThanOrEqual(16_777_216 + 1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run frontend/pdf-viewer/__tests__/deferred-render.test.tsx`
Expected: FAIL. Each zoom change renders at once (6 renders); the text layer is not emptied during a gesture; the DPR is uncapped (scale 3).

- [ ] **Step 3: Rewrite `primitives/CanvasLayer.tsx`**

```tsx
import {useEffect, useRef} from 'react';
import {useViewerStore} from '../core/context';
import {displayedSize, effectiveRotation} from '../core/rotation';
import {usePageHandle} from '../hooks/usePageHandle';

/** Past 2× device pixels, a sharper backing store costs memory and render time nobody sees. */
const MAX_PIXEL_RATIO = 2;
/** Largest canvas backing store (4096²) — iOS Safari's ceiling; a bigger page renders softer, not blank. */
const MAX_CANVAS_PIXELS = 16_777_216;
/** A zoom or rotation change renders this long after the last one, so a burst renders once. */
const RERENDER_DELAY_MS = 100;

export interface CanvasLayerProps {
  pageNumber: number;
  className?: string;
}

export function CanvasLayer({pageNumber, className}: CanvasLayerProps) {
  const page = usePageHandle(pageNumber);
  const zoom = useViewerStore((s) => s.zoom);
  const viewRotation = useViewerStore((s) => s.viewRotation);
  const isGesturing = useViewerStore((s) => s.isGesturing);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The page handle last drawn: a later render of it waits for the zoom to settle.
  const drawnRef = useRef<object | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    // During a gesture the canvas keeps its bitmap, stretched by the column's transform.
    if (!page || !canvas || isGesturing) return;

    // Display size in CSS pixels, set BEFORE rendering: the engine sizes the
    // backing store up front, and a canvas without a CSS size lays out at its
    // backing size. Set at once, so the old bitmap stretches to the new layout.
    const box = displayedSize(page.size, viewRotation, zoom);
    canvas.style.width = `${box.width}px`;
    canvas.style.height = `${box.height}px`;

    const devicePixels = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    const pixelRatio = Math.min(devicePixels, Math.sqrt(MAX_CANVAS_PIXELS / (box.width * box.height)));
    const controller = new AbortController();
    const draw = () => {
      drawnRef.current = page;
      page
        .render({canvas, scale: zoom * pixelRatio, rotation: effectiveRotation(page, viewRotation), signal: controller.signal})
        .catch((err) => {
          if ((err as DOMException).name !== 'AbortError') {
            console.warn(`CanvasLayer page ${pageNumber} render failed:`, err);
          }
        });
    };
    const timer = setTimeout(draw, drawnRef.current === page ? RERENDER_DELAY_MS : 0);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [page, zoom, viewRotation, isGesturing, pageNumber]);

  return <canvas ref={canvasRef} className={className} role="img" aria-label={`PDF page ${pageNumber}`} />;
}
```

- [ ] **Step 4: Defer the text layer the same way**

In `primitives/TextLayer.tsx`:
- Add a module constant:
  ```tsx
  /** A zoom or rotation change re-renders the text layer this long after the last one. */
  const RERENDER_DELAY_MS = 100;
  ```
- Add the selector `const isGesturing = useViewerStore((s) => s.isGesturing);` and the ref `const renderedRef = useRef<object | null>(null);`.
- Replace the render effect with:

```tsx
  // Render the text layer when page/zoom/rotation changes. During a gesture the
  // layer stays empty — its spans would sit at the pre-gesture scale.
  useEffect(() => {
    const container = containerRef.current;
    if (!page || !container || isGesturing) return;

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const renderScale = zoom * dpr;
    const ctrl = new AbortController();
    let handle: {cancel(): void} | null = null;

    const paint = () => {
      renderedRef.current = page;
      page
        .renderTextLayer({container, scale: renderScale, rotation: effectiveRotation(page, viewRotation), signal: ctrl.signal})
        .then((h) => {
          handle = h;
          if (!ctrl.signal.aborted) setPainted(h);
        })
        .catch((err) => {
          if ((err as DOMException).name !== 'AbortError') {
            console.warn(`TextLayer page ${pageNumber} render failed:`, err);
          }
        });
    };
    const timer = setTimeout(paint, renderedRef.current === page ? RERENDER_DELAY_MS : 0);

    return () => {
      clearTimeout(timer);
      ctrl.abort();
      handle?.cancel();
      container.innerHTML = '';
    };
  }, [page, zoom, viewRotation, isGesturing, pageNumber]);
```

- [ ] **Step 5: Run the viewer tests**

Run: `npx vitest run frontend/pdf-viewer`
Expected: PASS, including `canvas-layer.test.tsx` (its `waitFor` uses real timers; a first render starts after a 0 ms timeout) and `search-unmounted-page.test.tsx`.

- [ ] **Step 6: Commit**

```bash
git add frontend/pdf-viewer
git commit -m "perf(pdf-viewer): re-render pages once the zoom settles, with a pixel budget"
```

- [ ] **Step 7: Phase 3 gate**

Run every command in Global Constraints § Phase gate. Expected: all green.

Then, in the Browser pane on a run's PDF view:
- Press ⌘/Ctrl `=` five times quickly with the pointer over the pages.
- Take a screenshot 300 ms later. Expected: sharp text at the new zoom.
- `read_console_messages` with `onlyErrors`. Expected: none.

# Phase 4 — fit width (R21, R22)

Branch: `feat/pdf-viewer-phase4-fit-width` from `origin/dev`, after the Phase 3 PR merged. Phase 4 depends only on Phase 2, but running it after Phase 3 keeps the resize-drag re-render cheap (R19's delay).

### Task 18: Documents open at fit width and stay fitted while the viewer resizes

**Files:**
- Create: `frontend/pdf-viewer/viewport/useFitWidth.ts`
- Modify: `frontend/pdf-viewer/core/store.ts`, `primitives/Viewer.tsx` (`Pages`), `ui/ZoomControls.tsx`, `viewport/useZoomShortcuts.ts`, `frontend/lib/copy/pdf.ts`, `frontend/pdf-viewer/README.md`
- Test: `frontend/pdf-viewer/viewport/__tests__/useFitWidth.test.tsx` (new), `store.test.ts`, `ui/__tests__/ZoomControls.test.tsx`, `viewport/__tests__/useZoomShortcuts.test.tsx`

**Interfaces:**
- Consumes: `PageLayout.naturalWidth` (Task 7); `setZoom(zoom, {fitWidth})`, `fitWidth` (Task 13); `clampZoom` (Task 12).
- Produces:
  - `useFitWidth({scroller, layout}: {scroller: HTMLElement | null; layout: PageLayout}): void`.
  - Store default `fitWidth: true`; `setDocument` sets `fitWidth: true`.
  - Copy key `pdf.viewerFitWidth`.
  - ⌘/Ctrl `0` = fit width.

- [ ] **Step 1: Write the failing tests**

`frontend/pdf-viewer/viewport/__tests__/useFitWidth.test.tsx`:

```tsx
import {act, render} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import * as legacyPdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
vi.mock('pdfjs-dist', () => legacyPdfjs);

import {ViewerProvider} from '../../core/context';
import type {PDFDocumentHandle} from '../../core/engine';
import {createViewerStore} from '../../core/store';
import {PAGE_GAP} from '../usePageLayout';

const {Viewer} = await import('../../primitives/Viewer');

const LETTER = {width: 612, height: 792};
const NATURAL_WIDTH = LETTER.width + 2 * PAGE_GAP; // 644

let resize: () => void = () => {};

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly callback: () => void) {
        resize = callback;
      }
      observe() {}
      // A disconnected observer never reports again, as in the browser.
      disconnect() {
        if (resize === this.callback) resize = () => {};
      }
    },
  );
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const stubDocument = (numPages: number): PDFDocumentHandle => ({
  numPages,
  getPage: async () => {
    throw new Error('stub');
  },
  destroy: () => {},
});

function renderViewer(width: number) {
  // jsdom defines clientWidth on Element.prototype.
  const clientWidth = vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(width);
  const store = createViewerStore({numPages: 3, pageSizes: {1: LETTER}});
  render(
    <ViewerProvider store={store}>
      <Viewer.Body>
        <Viewer.Pages>{({number}) => <Viewer.Page pageNumber={number} />}</Viewer.Pages>
      </Viewer.Body>
    </ViewerProvider>,
  );
  const resizeTo = (next: number) => {
    clientWidth.mockReturnValue(next);
    act(() => resize());
  };
  return {store, resizeTo};
}

describe('fit width', () => {
  it('opens with the widest page filling the viewer', () => {
    const {store} = renderViewer(966);
    expect(store.getState().fitWidth).toBe(true);
    expect(store.getState().zoom).toBeCloseTo(966 / NATURAL_WIDTH, 10);
  });

  it('follows the viewer’s width while on', () => {
    const {store, resizeTo} = renderViewer(966);
    resizeTo(NATURAL_WIDTH);
    expect(store.getState().zoom).toBe(1);
  });

  it('stops following after a manual zoom', () => {
    const {store, resizeTo} = renderViewer(966);
    act(() => store.getState().actions.setZoom(2));
    resizeTo(NATURAL_WIDTH);
    expect(store.getState().zoom).toBe(2);
  });

  it('fits a newly opened document again', () => {
    const {store} = renderViewer(966);
    act(() => store.getState().actions.setZoom(2));
    act(() => {
      store.getState().actions.setDocument(stubDocument(3));
      store.getState().actions.setPageSize(1, LETTER);
    });
    expect(store.getState().fitWidth).toBe(true);
    expect(store.getState().zoom).toBeCloseTo(966 / NATURAL_WIDTH, 10);
  });
});
```

`store.test.ts`: in the initial-state test, change `expect(state.fitWidth).toBe(false);` to `toBe(true)`.

`ZoomControls.test.tsx`: append inside the `describe`:

```tsx
  it('offers fit width', async () => {
    const user = userEvent.setup();
    const store = renderControls(2);
    await user.click(screen.getByRole('button', {name: '200%'}));
    await user.click(await screen.findByRole('menuitem', {name: 'Fit width'}));
    expect(store.getState().fitWidth).toBe(true);
  });
```

Change `renderControls` to build `createViewerStore({zoom, fitWidth: false})`.

`useZoomShortcuts.test.tsx`: append inside the `describe`:

```tsx
  it('fits the width on ⌘/Ctrl 0', async () => {
    const user = userEvent.setup();
    const store = renderViewer();
    await user.hover(screen.getByTestId('viewer-root'));
    await user.keyboard('{Control>}0{/Control}');
    expect(store.getState().fitWidth).toBe(true);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run frontend/pdf-viewer/viewport/__tests__/useFitWidth.test.tsx frontend/pdf-viewer/__tests__/store.test.ts frontend/pdf-viewer/ui/__tests__/ZoomControls.test.tsx frontend/pdf-viewer/viewport/__tests__/useZoomShortcuts.test.tsx`
Expected: FAIL. `fitWidth` defaults to `false`; the zoom stays 1; there is no "Fit width" item; ⌘0 does nothing.

- [ ] **Step 3: Store defaults**

In `core/store.ts`:
- In `initialData`, change `fitWidth: false,` to `fitWidth: true,` and add the comment `// Every document opens at fit width.` above it.
- In `setDocument`, add `fitWidth: true,` to the `set({...})` object.

- [ ] **Step 4: Create `viewport/useFitWidth.ts`**

```ts
/**
 * While `fitWidth` is on, the zoom follows the scroller's width: the widest
 * page plus its side gaps fills it. However often the scroller resizes (a
 * split-pane drag), the zoom updates at most once per animation frame;
 * CanvasLayer's re-render delay keeps the drag from re-rendering pages.
 * Adapted from anaralabs/lector (MIT).
 */
import {useEffect} from 'react';
import {useViewerStore, useViewerStoreApi} from '../core/context';
import type {PageLayout} from './usePageLayout';
import {clampZoom} from './zoomMath';

/** Zoom changes smaller than this are rounding, not a resize: ignoring them stops a scrollbar feedback loop. */
const ZOOM_EPSILON = 0.001;

export function useFitWidth({scroller, layout}: {scroller: HTMLElement | null; layout: PageLayout}): void {
  const storeApi = useViewerStoreApi();
  const fitWidth = useViewerStore((s) => s.fitWidth);
  const {naturalWidth, numPages} = layout;

  useEffect(() => {
    if (!scroller || !fitWidth || numPages === 0) return;
    let frame: number | null = null;
    const fit = () => {
      frame = null;
      // A hidden scroller (display: none) has no width to fit.
      if (scroller.clientWidth === 0) return;
      const {zoom, actions} = storeApi.getState();
      const next = clampZoom(scroller.clientWidth / naturalWidth);
      if (Math.abs(next - zoom) > ZOOM_EPSILON) actions.setZoom(next, {fitWidth: true});
    };
    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(fit);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(scroller);
    schedule();
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [scroller, fitWidth, naturalWidth, numPages, storeApi]);
}
```

In `primitives/Viewer.tsx` `Pages`:
- Add `useFitWidth({scroller, layout});` right after `useGestureZoom(...)`.
- Import it from `../viewport/useFitWidth`.

- [ ] **Step 5: Fit width in the menu and on ⌘/Ctrl 0**

`frontend/lib/copy/pdf.ts`: after `viewerZoomLevel`, add:

```ts
    viewerFitWidth: 'Fit width',
```

`ui/ZoomControls.tsx`:
- Add `DropdownMenuSeparator` to the dropdown-menu import.
- Make these the first children of `<DropdownMenuContent align="end">`:

```tsx
          <DropdownMenuItem onClick={() => actions.setZoom(zoom, {fitWidth: true})} className="text-[13px]">
            {t('pdf', 'viewerFitWidth')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
```

`viewport/useZoomShortcuts.ts`:
- Add a third binding:

```ts
      {
        type: 'chord',
        key: '0',
        mod: true,
        handler: () => {
          const {zoom, actions} = storeApi.getState();
          actions.setZoom(zoom, {fitWidth: true});
        },
      },
```

- Update its header comment to: "⌘/Ctrl `=` and `-` zoom the canvas and ⌘/Ctrl `0` fits its width, while the pointer or focus is inside the viewer; everywhere else the browser keeps its own page zoom."

- [ ] **Step 6: Keep earlier tests independent of fit width**

These tests drive the zoom themselves and must not be refitted:
- `gesture-zoom.test.tsx` already creates its store with `fitWidth: false`.
- `deferred-render.test.tsx` already does too.
- `virtual-pages.test.tsx` and `search-unmounted-page.test.tsx` report `clientWidth` 0 in jsdom, so `useFitWidth` skips.

Run: `npx vitest run frontend/pdf-viewer`
Expected: PASS. If a test fails because its zoom changed, create its store with `fitWidth: false` (after `setDocument`, also call `store.getState().actions.setZoom(1)`, which turns fit width off).

- [ ] **Step 7: README**

In the modules tree, add `useFitWidth` to the `viewport/` line, and change the `ui/` line to `Toolbar (rotate view), ZoomControls (fit width), NavigationControls, SearchBar, states`.

Append to the Zoom section:

```markdown
Every document opens at fit width (`useFitWidth`): the widest page fills the
viewer and keeps filling it as the viewer resizes, until a manual zoom. The
zoom menu's "Fit width" and ⌘/Ctrl `0` turn it back on.
```

- [ ] **Step 8: Commit**

```bash
git add frontend/pdf-viewer frontend/lib/copy/pdf.ts
git commit -m "feat(pdf-viewer): open documents at fit width and keep them fitted"
```

- [ ] **Step 9: Phase 4 gate and visual review**

Run every command in Global Constraints § Phase gate. Expected: all green, both knip modes at 0.

Then, in the Browser pane:
1. Open a run's split view.
2. Screenshot. Expected: the page fills the pane width.
3. Drag the split separator and screenshot again. Expected: still fitted, no blank pages.
4. Press ⌘/Ctrl `=`, then drag. Expected: the zoom stays.
5. Press ⌘/Ctrl `0`. Expected: fitted again.
6. Open an article with a landscape page. Expected: that page is landscape and fits within the pane.
7. Run `/design-review` on the run split view.
8. Run the E2E file from Task 11 Step 2 again. Expected: PASS where its env exists.

