# PDF Viewer — Phase 1a: Core Types + Store Factory + Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder `PDF_VIEWER_MODULE_VERSION` with the real headless core: type definitions for sources/coordinates/engine/citations, a multi-instance Zustand `createViewerStore` factory, and a React Context (`<ViewerProvider>` + `useViewerStore`) that lets two viewers coexist on the same page with fully isolated state.

**Architecture:** Type-first, runtime-thin. Each domain concept gets its own file (one responsibility per file). The store uses Zustand 5's vanilla `createStore` (not the React-bound `create`) so each `<ViewerProvider>` owns its own `StoreApi<ViewerState>` — the canonical multi-instance pattern. The Context exposes hooks (`useViewerStore<T>(selector)`) that subscribe to the nearest provider's store. No engine implementation, no UI primitives, no plugins yet — those come in Phase 1b and onward.

**Tech Stack:** TypeScript 5.8 strict, React 18.3, Zustand 5.0.11 (vanilla `createStore` + generic `useStore`), Vitest 4 with `@testing-library/react`.

**Out of scope:**
- Concrete PDF.js engine implementation → **Phase 1b** (next plan)
- Compound primitives (`<Viewer.Root>`, `<Viewer.Pages>`, `<Viewer.Page>`) → **Phase 2a**
- Plugin system → **Phase 2a**
- Annotation types → **Phase 4** (W3C; intentionally deferred so we don't bake assumptions before schema coordination with `claude/strange-wiles-a189ef`)
- Search state, virtualization state → **Phase 2b**

**Predecessors:** Plan 1 (Phase 0 — Foundation) — ✅ complete on `claude/brave-chaplygin-9e6e73`.

**Successors:** Phase 1b — `PDFJsEngine` implementation + multi-instance smoke demo using the contracts defined here.

---

## File Structure

### Files created

| Path | Purpose |
|---|---|
| `frontend/pdf-viewer/core/coordinates.ts` | `PDFPoint`, `PDFRect`, `PDFTextRange` — coordinate primitives in PDF user space |
| `frontend/pdf-viewer/core/source.ts` | `PDFSource` discriminated union (url / data / lazy) |
| `frontend/pdf-viewer/core/engine.ts` | `PDFEngine`, `PDFDocumentHandle`, `PDFPageHandle` interfaces + aux types (`LoadOptions`, `RenderOptions`, `RenderResult`, `PDFMetadata`, `OutlineNode`, `TextContent`, `TextItem`, `PageRotation`) |
| `frontend/pdf-viewer/core/citation.ts` | `Citation`, `CitationId`, `CitationAnchor` — wire-format-aligned with backend `extraction_evidence.position` |
| `frontend/pdf-viewer/core/state.ts` | `ViewerState`, `ViewerActions`, `LoadStatus` types |
| `frontend/pdf-viewer/core/store.ts` | `createViewerStore(initial?)` factory returning `StoreApi<ViewerState>` |
| `frontend/pdf-viewer/core/context.tsx` | `<ViewerProvider>`, `useViewerStore<T>(selector)`, `useViewerStoreApi()` |
| `frontend/pdf-viewer/__tests__/store.test.ts` | Multi-instance isolation, action behavior, initial state |
| `frontend/pdf-viewer/__tests__/context.test.tsx` | Provider injection, hook usage, error outside provider, **two-providers isolation integration test** |

### Files modified

| Path | Change |
|---|---|
| `frontend/pdf-viewer/core/types.ts` | Replace placeholder constant with re-exports from sibling type files (becomes a pure barrel) |
| `frontend/pdf-viewer/core/index.ts` | Re-export from `types`, `store`, `context` |
| `frontend/pdf-viewer/index.ts` | Re-export from `core` |
| `frontend/pdf-viewer/__tests__/scaffolding.test.ts` | Replace with assertions against the real exports |
| `frontend/pdf-viewer/README.md` | Bump status note from "Phase 0 — only a version constant" to "Phase 1a — types + store + Context" |

### Files removed

None (all Phase 0 files survive; only `types.ts` content is replaced).

---

## Task 1: Add coordinate primitives (`coordinates.ts`)

**Files:**
- Create: `frontend/pdf-viewer/core/coordinates.ts`

PDF coordinates are in user space (origin bottom-left, units in points). All coordinate types use this convention. Persisted citation/annotation coordinates use these types so they survive zoom, rotation, engine swap.

- [ ] **Step 1: Create the file**

```ts
/**
 * Coordinate primitives in PDF user space.
 *
 * PDF user space origin is bottom-left of the page, units are points (1/72 inch).
 * Persisted citations and annotations use these types directly so coordinates
 * survive zoom changes, rotation, and engine swaps without re-projection.
 */

export interface PDFPoint {
  x: number;
  y: number;
}

export interface PDFRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A range of characters within a single page's text content.
 * `charStart` and `charEnd` are offsets into the page's concatenated text
 * (the same offsets emitted by the engine's `getTextContent()`).
 */
export interface PDFTextRange {
  page: number;       // 1-indexed
  charStart: number;
  charEnd: number;
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep "frontend/pdf-viewer/core/coordinates"
```

Expected: empty output (no errors related to this file).

- [ ] **Step 3: Commit**

```bash
git add frontend/pdf-viewer/core/coordinates.ts
git commit -m "$(cat <<'EOF'
feat(pdf-viewer): add coordinate primitives in PDF user space

PDFPoint, PDFRect, PDFTextRange — used by Citation, Annotation,
TextItem, and the engine's render/text APIs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add source abstraction (`source.ts`)

**Files:**
- Create: `frontend/pdf-viewer/core/source.ts`

The source abstraction is what removes domain coupling: the viewer accepts `PDFSource`, never `articleId`. Consumers (extraction, assessment, evidence preview) implement the resolver themselves.

- [ ] **Step 1: Create the file**

```ts
/**
 * Source descriptor for a PDF document.
 *
 * The viewer accepts any of these forms; resolving an article ID, a Supabase
 * signed URL, or an upload preview to one of these is the consumer's job.
 * Domain knowledge (article_files, MAIN role, Supabase Storage) does NOT
 * leak into the viewer — invariant from the architecture spec.
 */
export type PDFSource =
  | PDFUrlSource
  | PDFDataSource
  | PDFLazySource;

export interface PDFUrlSource {
  kind: 'url';
  url: string;
  withCredentials?: boolean;
  httpHeaders?: Record<string, string>;
}

export interface PDFDataSource {
  kind: 'data';
  data: Uint8Array | ArrayBuffer;
}

/**
 * A source that resolves to another source on first access.
 * Used when generating a signed URL is expensive or has a TTL —
 * the consumer keeps that work outside the viewer's render path.
 */
export interface PDFLazySource {
  kind: 'lazy';
  load: () => Promise<PDFUrlSource | PDFDataSource>;
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep "frontend/pdf-viewer/core/source"
```

Expected: empty.

- [ ] **Step 3: Commit**

```bash
git add frontend/pdf-viewer/core/source.ts
git commit -m "$(cat <<'EOF'
feat(pdf-viewer): add PDFSource discriminated union

Three forms — url, data, lazy. Consumers map domain concepts
(article files, signed URLs, upload previews) to a PDFSource;
the viewer remains domain-free.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add engine interface (`engine.ts`)

**Files:**
- Create: `frontend/pdf-viewer/core/engine.ts`

Defines the `PDFEngine` interface that Phase 1b will implement against PDF.js (and a future plan may implement against PDFium-WASM). All engine operations are typed; no concrete engine is bundled here.

- [ ] **Step 1: Create the file**

```ts
import type {PDFRect} from './coordinates';
import type {PDFSource} from './source';

/**
 * Page rotation in degrees, clockwise.
 */
export type PageRotation = 0 | 90 | 180 | 270;

/**
 * The PDF engine — abstracts the underlying rendering library.
 *
 * Phase 1b implements this against pdfjs-dist v5. A future plan may
 * implement it against PDFium-WASM (EmbedPDF or similar). Consumers
 * never see the underlying library directly.
 */
export interface PDFEngine {
  /**
   * Load a PDF document. Returns a handle whose lifecycle is owned by
   * the caller — call `destroy()` when the handle is no longer needed.
   */
  load(source: PDFSource, opts?: LoadOptions): Promise<PDFDocumentHandle>;
}

export interface LoadOptions {
  withCredentials?: boolean;
  httpHeaders?: Record<string, string>;
  onProgress?: (loaded: number, total: number) => void;
}

export interface PDFDocumentHandle {
  readonly numPages: number;
  /** Stable identifier from the PDF — useful for cache keys. */
  readonly fingerprint: string;
  metadata(): Promise<PDFMetadata>;
  outline(): Promise<OutlineNode[]>;
  getPage(pageNumber: number): Promise<PDFPageHandle>;
  /** Release engine resources. Idempotent. */
  destroy(): void;
}

export interface PDFPageHandle {
  readonly pageNumber: number;
  /** Page size in PDF user space points (origin bottom-left). */
  readonly size: {width: number; height: number};
  render(opts: RenderOptions): Promise<RenderResult>;
  getTextContent(): Promise<TextContent>;
  /** Release page-level resources (canvas, text layer caches). Idempotent. */
  cleanup(): void;
}

export interface RenderOptions {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  scale: number;
  rotation?: PageRotation;
}

export interface RenderResult {
  /** Rendered pixel width. */
  width: number;
  /** Rendered pixel height. */
  height: number;
  /** Cancel an in-flight render. Safe to call after completion. */
  cancel(): void;
}

export interface PDFMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
  producer?: string;
  creationDate?: Date;
  modificationDate?: Date;
}

export interface OutlineNode {
  title: string;
  /** Target page (1-indexed) or null if the entry has no destination. */
  page: number | null;
  children: OutlineNode[];
}

export interface TextContent {
  items: TextItem[];
}

export interface TextItem {
  text: string;
  /** Bounding box in PDF user space. */
  bbox: PDFRect;
  /** Offset of the first character within the page's concatenated text. */
  charStart: number;
  /** Offset of the character after the last character (exclusive). */
  charEnd: number;
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep "frontend/pdf-viewer/core/engine"
```

Expected: empty.

- [ ] **Step 3: Commit**

```bash
git add frontend/pdf-viewer/core/engine.ts
git commit -m "$(cat <<'EOF'
feat(pdf-viewer): add PDFEngine interface and handle types

Defines the contract Phase 1b will implement against pdfjs-dist v5.
Concrete engine is intentionally absent; consumers depend only on
this interface so a future PDFium-WASM swap is one isolated change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Add citation types (`citation.ts`)

**Files:**
- Create: `frontend/pdf-viewer/core/citation.ts`

The `Citation` type is the wire format that aligns with `extraction_evidence.position` in the backend (see `docs/superpowers/specs/...` future Phase 6 spec). Defining it here means the viewer's runtime contract matches the persisted shape — no translation layer.

- [ ] **Step 1: Create the file**

```ts
import type {PDFRect, PDFTextRange} from './coordinates';

export type CitationId = string;

/**
 * A citation — an anchored reference into a PDF document.
 *
 * `Citation` is the runtime shape; the persisted shape lives in the backend
 * `extraction_evidence.position` JSONB column with the same field names so
 * round-trips don't need a translation layer. See backend Phase 6 plan for
 * the storage schema.
 *
 * Three anchor kinds:
 *   - `text`   — char-range only (most robust to re-OCR)
 *   - `region` — bbox only (works for figures, tables, image regions)
 *   - `hybrid` — both, plus the canonical quote text (the recommended kind
 *                for AI-generated citations: max resilience)
 */
export interface Citation {
  id: CitationId;
  anchor: CitationAnchor;
  metadata?: CitationMetadata;
  style?: CitationStyle;
}

export type CitationAnchor =
  | TextCitationAnchor
  | RegionCitationAnchor
  | HybridCitationAnchor;

export interface TextCitationAnchor {
  kind: 'text';
  range: PDFTextRange;
  /** Optional canonical text used for highlight matching. */
  quote?: string;
}

export interface RegionCitationAnchor {
  kind: 'region';
  /** 1-indexed page the rect is on. */
  page: number;
  /** Bounding box in PDF user space (origin bottom-left, units in points). */
  rect: PDFRect;
}

export interface HybridCitationAnchor {
  kind: 'hybrid';
  range: PDFTextRange;
  rect: PDFRect;
  quote: string;
}

export interface CitationMetadata {
  /** ID of the extraction field this citation supports, if applicable. */
  fieldId?: string;
  /** Model confidence in [0, 1]. */
  confidence?: number;
  /** Where the citation came from. */
  source?: 'ai' | 'human' | 'review';
}

export interface CitationStyle {
  /** CSS color string for the highlight overlay. */
  color?: string;
  /** If true, the highlight is short-lived (used for "flash on click"). */
  ephemeral?: boolean;
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep "frontend/pdf-viewer/core/citation"
```

Expected: empty.

- [ ] **Step 3: Commit**

```bash
git add frontend/pdf-viewer/core/citation.ts
git commit -m "$(cat <<'EOF'
feat(pdf-viewer): add Citation type aligned with backend wire format

Citation, CitationAnchor (text/region/hybrid), CitationMetadata,
CitationStyle — same field names as the planned backend
extraction_evidence.position JSONB shape. AI citations should use
'hybrid' for max resilience.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Add viewer state types (`state.ts`)

**Files:**
- Create: `frontend/pdf-viewer/core/state.ts`

Defines `ViewerState`, `ViewerActions`, and `LoadStatus`. The state shape is intentionally minimal for Phase 1a; subsequent phases will add slices (search, annotations, view modes) following the same pattern (`actions` namespace, derived selectors).

- [ ] **Step 1: Create the file**

```ts
import type {Citation, CitationId} from './citation';
import type {PDFDocumentHandle, PageRotation} from './engine';
import type {PDFSource} from './source';

/**
 * Document load status.
 *
 * Transitions: idle → loading → (ready | error). After error, calling
 * `setSource` with a new source resets to loading.
 */
export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * The full viewer state.
 *
 * Convention: data fields are top-level; mutating actions live under
 * the `actions` namespace so consumers can subscribe to actions with
 * a stable reference (selector returns the same object across renders).
 */
export interface ViewerState {
  // Document
  source: PDFSource | null;
  document: PDFDocumentHandle | null;
  numPages: number;
  loadStatus: LoadStatus;
  error: Error | null;

  // Navigation
  /** 1-indexed current page. */
  currentPage: number;

  // Rendering
  /** Render scale. 1.0 = 100%. */
  scale: number;
  rotation: PageRotation;

  // Citations
  citations: ReadonlyMap<CitationId, Citation>;
  activeCitationId: CitationId | null;

  // Actions namespace — stable object reference across all updates.
  actions: ViewerActions;
}

export interface ViewerActions {
  // Document
  setSource(source: PDFSource | null): void;
  setDocument(doc: PDFDocumentHandle | null): void;
  setLoadStatus(status: LoadStatus, error?: Error | null): void;

  // Navigation
  goToPage(page: number): void;

  // Rendering
  setScale(scale: number): void;
  setRotation(rotation: PageRotation): void;

  // Citations
  addCitation(citation: Citation): void;
  removeCitation(id: CitationId): void;
  clearCitations(): void;
  setActiveCitation(id: CitationId | null): void;

  // Lifecycle
  /** Reset the store to its initial state. Calls `document.destroy()` if present. */
  reset(): void;
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep "frontend/pdf-viewer/core/state"
```

Expected: empty.

- [ ] **Step 3: Commit**

```bash
git add frontend/pdf-viewer/core/state.ts
git commit -m "$(cat <<'EOF'
feat(pdf-viewer): add ViewerState and ViewerActions types

Minimal Phase 1a shape: document/load, navigation (currentPage),
rendering (scale, rotation), citations map. Actions namespaced for
stable selector returns. Search, annotations, view modes deferred
to later phases.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Implement `createViewerStore` factory (TDD)

**Files:**
- Create: `frontend/pdf-viewer/core/store.ts`
- Create: `frontend/pdf-viewer/__tests__/store.test.ts`

Use Zustand's vanilla `createStore` from `'zustand'` (not React-bound `create`). The factory returns a fresh `StoreApi<ViewerState>` per call — that's what enables multi-instance.

- [ ] **Step 1: Write the failing test file**

Create `frontend/pdf-viewer/__tests__/store.test.ts`:

```ts
import {describe, expect, it} from 'vitest';
import {createViewerStore} from '../core/store';

describe('createViewerStore', () => {
  it('returns a store with the expected initial state', () => {
    const store = createViewerStore();
    const state = store.getState();
    expect(state.source).toBeNull();
    expect(state.document).toBeNull();
    expect(state.numPages).toBe(0);
    expect(state.loadStatus).toBe('idle');
    expect(state.error).toBeNull();
    expect(state.currentPage).toBe(1);
    expect(state.scale).toBe(1);
    expect(state.rotation).toBe(0);
    expect(state.citations.size).toBe(0);
    expect(state.activeCitationId).toBeNull();
    expect(typeof state.actions.goToPage).toBe('function');
  });

  it('returns isolated stores — mutating one does not affect another', () => {
    const a = createViewerStore();
    const b = createViewerStore();
    a.getState().actions.setScale(2);
    expect(a.getState().scale).toBe(2);
    expect(b.getState().scale).toBe(1);
  });

  it('actions namespace has a stable reference across state updates', () => {
    const store = createViewerStore();
    const actionsBefore = store.getState().actions;
    store.getState().actions.setScale(1.5);
    const actionsAfter = store.getState().actions;
    expect(actionsAfter).toBe(actionsBefore);
  });

  it('setLoadStatus transitions through all four states', () => {
    const store = createViewerStore();
    const {actions} = store.getState();
    actions.setLoadStatus('loading');
    expect(store.getState().loadStatus).toBe('loading');
    actions.setLoadStatus('ready');
    expect(store.getState().loadStatus).toBe('ready');
    const err = new Error('boom');
    actions.setLoadStatus('error', err);
    expect(store.getState().loadStatus).toBe('error');
    expect(store.getState().error).toBe(err);
  });

  it('setLoadStatus to non-error clears any prior error', () => {
    const store = createViewerStore();
    store.getState().actions.setLoadStatus('error', new Error('x'));
    store.getState().actions.setLoadStatus('loading');
    expect(store.getState().error).toBeNull();
  });

  it('goToPage clamps below 1 to 1', () => {
    const store = createViewerStore();
    store.getState().actions.goToPage(0);
    expect(store.getState().currentPage).toBe(1);
    store.getState().actions.goToPage(-5);
    expect(store.getState().currentPage).toBe(1);
  });

  it('goToPage clamps above numPages to numPages (when known)', () => {
    const store = createViewerStore();
    // numPages defaults to 0 — we set it via setDocument typically; for the
    // unit test, simulate a 10-page doc by directly bumping numPages via the
    // setDocument path with a stub handle.
    const stubDoc = {
      numPages: 10,
      fingerprint: 'stub',
      metadata: async () => ({}),
      outline: async () => [],
      getPage: async () => {throw new Error('stub');},
      destroy: () => {},
    };
    store.getState().actions.setDocument(stubDoc);
    expect(store.getState().numPages).toBe(10);
    store.getState().actions.goToPage(99);
    expect(store.getState().currentPage).toBe(10);
  });

  it('addCitation puts an entry in the citations map; removeCitation drops it', () => {
    const store = createViewerStore();
    const cite = {
      id: 'c1',
      anchor: {kind: 'text' as const, range: {page: 1, charStart: 0, charEnd: 5}},
    };
    store.getState().actions.addCitation(cite);
    expect(store.getState().citations.get('c1')).toEqual(cite);
    store.getState().actions.removeCitation('c1');
    expect(store.getState().citations.has('c1')).toBe(false);
  });

  it('clearCitations empties the map and unsets activeCitationId', () => {
    const store = createViewerStore();
    const cite = {
      id: 'c1',
      anchor: {kind: 'text' as const, range: {page: 1, charStart: 0, charEnd: 5}},
    };
    store.getState().actions.addCitation(cite);
    store.getState().actions.setActiveCitation('c1');
    store.getState().actions.clearCitations();
    expect(store.getState().citations.size).toBe(0);
    expect(store.getState().activeCitationId).toBeNull();
  });

  it('reset returns to initial state', () => {
    const store = createViewerStore();
    store.getState().actions.setScale(2);
    store.getState().actions.goToPage(5);
    store.getState().actions.reset();
    const s = store.getState();
    expect(s.scale).toBe(1);
    expect(s.currentPage).toBe(1);
    expect(s.loadStatus).toBe('idle');
  });

  it('reset calls document.destroy() if a document was loaded', () => {
    const store = createViewerStore();
    let destroyed = false;
    const stubDoc = {
      numPages: 3,
      fingerprint: 'x',
      metadata: async () => ({}),
      outline: async () => [],
      getPage: async () => {throw new Error('stub');},
      destroy: () => {destroyed = true;},
    };
    store.getState().actions.setDocument(stubDoc);
    store.getState().actions.reset();
    expect(destroyed).toBe(true);
    expect(store.getState().document).toBeNull();
  });

  it('accepts initial overrides', () => {
    const store = createViewerStore({scale: 1.5, currentPage: 7});
    expect(store.getState().scale).toBe(1.5);
    expect(store.getState().currentPage).toBe(7);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npx vitest run frontend/pdf-viewer/__tests__/store.test.ts
```

Expected: failure with `Cannot find module '../core/store'` (file does not exist yet).

- [ ] **Step 3: Implement the factory**

Create `frontend/pdf-viewer/core/store.ts`:

```ts
import {createStore, type StoreApi} from 'zustand';
import type {Citation, CitationId} from './citation';
import type {PDFDocumentHandle, PageRotation} from './engine';
import type {PDFSource} from './source';
import type {LoadStatus, ViewerActions, ViewerState} from './state';

type ViewerData = Omit<ViewerState, 'actions'>;

const initialData: ViewerData = {
  source: null,
  document: null,
  numPages: 0,
  loadStatus: 'idle',
  error: null,
  currentPage: 1,
  scale: 1,
  rotation: 0,
  citations: new Map<CitationId, Citation>(),
  activeCitationId: null,
};

/**
 * Create a fresh viewer store. Each call returns an isolated `StoreApi`;
 * two stores never share state. This is the multi-instance entry point.
 *
 * The returned `StoreApi` is the vanilla Zustand contract — pass it to
 * `useStore(store, selector)` to subscribe in React, or call
 * `store.getState()` / `store.setState()` directly.
 */
export function createViewerStore(
  initial?: Partial<ViewerData>,
): StoreApi<ViewerState> {
  return createStore<ViewerState>((set, get) => {
    const actions: ViewerActions = {
      setSource(source: PDFSource | null) {
        set({source});
      },

      setDocument(document: PDFDocumentHandle | null) {
        set({
          document,
          numPages: document?.numPages ?? 0,
        });
      },

      setLoadStatus(status: LoadStatus, error: Error | null = null) {
        set({
          loadStatus: status,
          error: status === 'error' ? error : null,
        });
      },

      goToPage(page: number) {
        const {numPages} = get();
        const clamped = numPages > 0
          ? Math.max(1, Math.min(page, numPages))
          : Math.max(1, page);
        set({currentPage: clamped});
      },

      setScale(scale: number) {
        set({scale});
      },

      setRotation(rotation: PageRotation) {
        set({rotation});
      },

      addCitation(citation: Citation) {
        const next = new Map(get().citations);
        next.set(citation.id, citation);
        set({citations: next});
      },

      removeCitation(id: CitationId) {
        const next = new Map(get().citations);
        next.delete(id);
        set({citations: next});
      },

      clearCitations() {
        set({
          citations: new Map<CitationId, Citation>(),
          activeCitationId: null,
        });
      },

      setActiveCitation(id: CitationId | null) {
        set({activeCitationId: id});
      },

      reset() {
        const {document} = get();
        document?.destroy();
        set({...initialData});
      },
    };

    return {
      ...initialData,
      ...initial,
      actions,
    };
  });
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npx vitest run frontend/pdf-viewer/__tests__/store.test.ts
```

Expected: 12 tests passing.

If a specific test fails, read the assertion and fix the implementation. Common issues:

- `goToPage` clamping when `numPages` is 0 — use `Math.max(1, page)` (no upper clamp until numPages set)
- `actions` reference instability — make sure the actions object is built once inside `createStore`'s initializer and never replaced

- [ ] **Step 5: Commit**

```bash
git add frontend/pdf-viewer/core/store.ts frontend/pdf-viewer/__tests__/store.test.ts
git commit -m "$(cat <<'EOF'
feat(pdf-viewer): add createViewerStore factory with isolated state

Vanilla Zustand store factory — each call returns a fresh StoreApi
with no shared state. Actions namespace is stable across updates so
selector consumers can subscribe to actions without re-render churn.

12 tests cover initial state, multi-instance isolation, action
behavior, page clamping, citation map mutations, and reset.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Implement `<ViewerProvider>` + hooks (TDD)

**Files:**
- Create: `frontend/pdf-viewer/core/context.tsx`
- Create: `frontend/pdf-viewer/__tests__/context.test.tsx`

The Context wraps a per-instance store. `useViewerStore<T>(selector)` is the consumer hook; `useViewerStoreApi()` returns the raw `StoreApi` for cases where imperative `setState` is needed.

- [ ] **Step 1: Write the failing test file**

Create `frontend/pdf-viewer/__tests__/context.test.tsx`:

```tsx
import {render, screen, act} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import {ViewerProvider, useViewerStore, useViewerStoreApi} from '../core/context';
import {createViewerStore} from '../core/store';
import type {ViewerState} from '../core/state';

function CurrentScale() {
  const scale = useViewerStore((s: ViewerState) => s.scale);
  return <span data-testid="scale">{scale.toFixed(2)}</span>;
}

function ScaleSetter({to}: {to: number}) {
  const setScale = useViewerStore((s: ViewerState) => s.actions.setScale);
  return (
    <button data-testid="set-scale" onClick={() => setScale(to)}>
      set
    </button>
  );
}

describe('<ViewerProvider> + useViewerStore', () => {
  it('exposes the store state to descendants', () => {
    render(
      <ViewerProvider>
        <CurrentScale />
      </ViewerProvider>,
    );
    expect(screen.getByTestId('scale').textContent).toBe('1.00');
  });

  it('updates descendants when an action mutates state', async () => {
    const {getByTestId} = render(
      <ViewerProvider>
        <CurrentScale />
        <ScaleSetter to={2} />
      </ViewerProvider>,
    );
    await act(async () => {
      getByTestId('set-scale').click();
    });
    expect(getByTestId('scale').textContent).toBe('2.00');
  });

  it('throws when useViewerStore is called outside a ViewerProvider', () => {
    function Orphan() {
      useViewerStore((s: ViewerState) => s.scale);
      return null;
    }
    // Suppress React's error logging for this expected throw.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Orphan />)).toThrow(
      /useViewerStore must be used within a ViewerProvider/,
    );
    spy.mockRestore();
  });

  it('useViewerStoreApi returns the underlying StoreApi', () => {
    let captured: ReturnType<typeof useViewerStoreApi> | null = null;
    function Capture() {
      captured = useViewerStoreApi();
      return null;
    }
    render(
      <ViewerProvider>
        <Capture />
      </ViewerProvider>,
    );
    expect(captured).not.toBeNull();
    expect(typeof captured!.getState).toBe('function');
    expect(typeof captured!.setState).toBe('function');
    expect(typeof captured!.subscribe).toBe('function');
  });

  it('accepts an externally created store via the `store` prop', () => {
    const external = createViewerStore({scale: 0.75});
    render(
      <ViewerProvider store={external}>
        <CurrentScale />
      </ViewerProvider>,
    );
    expect(screen.getByTestId('scale').textContent).toBe('0.75');
  });

  it('accepts initial state via the `initial` prop when no store is passed', () => {
    render(
      <ViewerProvider initial={{scale: 1.5}}>
        <CurrentScale />
      </ViewerProvider>,
    );
    expect(screen.getByTestId('scale').textContent).toBe('1.50');
  });

  // The critical multi-instance integration test.
  it('two ViewerProvider instances on the same page have isolated state', async () => {
    function Pair() {
      return (
        <>
          <ViewerProvider>
            <div data-testid="left">
              <CurrentScale />
              <ScaleSetter to={2} />
            </div>
          </ViewerProvider>
          <ViewerProvider>
            <div data-testid="right">
              <CurrentScale />
              <ScaleSetter to={3} />
            </div>
          </ViewerProvider>
        </>
      );
    }
    const {getByTestId} = render(<Pair />);
    const leftScale = () =>
      getByTestId('left').querySelector('[data-testid="scale"]')!.textContent;
    const rightScale = () =>
      getByTestId('right').querySelector('[data-testid="scale"]')!.textContent;
    expect(leftScale()).toBe('1.00');
    expect(rightScale()).toBe('1.00');

    await act(async () => {
      getByTestId('left').querySelector<HTMLButtonElement>(
        '[data-testid="set-scale"]',
      )!.click();
    });
    expect(leftScale()).toBe('2.00');
    expect(rightScale()).toBe('1.00'); // ← unchanged

    await act(async () => {
      getByTestId('right').querySelector<HTMLButtonElement>(
        '[data-testid="set-scale"]',
      )!.click();
    });
    expect(leftScale()).toBe('2.00'); // ← unchanged
    expect(rightScale()).toBe('3.00');
  });
});
```

You will need `vi` from `vitest` in the orphan-throws test. Add `import {vi} from 'vitest'` to the test file's imports if not already covered by globals (vitest config has `globals: true`, so `vi` should be available without import — verify by running the test).

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npx vitest run frontend/pdf-viewer/__tests__/context.test.tsx
```

Expected: failure with `Cannot find module '../core/context'`.

- [ ] **Step 3: Implement the context and hooks**

Create `frontend/pdf-viewer/core/context.tsx`:

```tsx
import {createContext, useContext, useState, type ReactNode} from 'react';
import {useStore, type StoreApi} from 'zustand';
import {createViewerStore} from './store';
import type {ViewerState} from './state';

const ViewerStoreContext = createContext<StoreApi<ViewerState> | null>(null);

export interface ViewerProviderProps {
  /**
   * Optional pre-built store. When provided, this Provider does not create
   * its own — useful when a parent wants to lift store ownership (e.g., to
   * keep state across an unmount/remount, or to imperatively control it
   * from outside the React tree).
   */
  store?: StoreApi<ViewerState>;
  /**
   * Optional initial-state overrides. Ignored when `store` is provided.
   */
  initial?: Parameters<typeof createViewerStore>[0];
  children: ReactNode;
}

export function ViewerProvider({store, initial, children}: ViewerProviderProps) {
  // useState with a lazy initializer: the store is created exactly once
  // per Provider instance and survives re-renders. Each <ViewerProvider>
  // owns its own StoreApi — isolation by construction.
  const [ownedStore] = useState(() => store ?? createViewerStore(initial));
  return (
    <ViewerStoreContext.Provider value={ownedStore}>
      {children}
    </ViewerStoreContext.Provider>
  );
}

/**
 * Subscribe to the nearest ViewerProvider's store via a selector.
 * Throws if called outside a Provider.
 */
export function useViewerStore<T>(selector: (state: ViewerState) => T): T {
  const store = useContext(ViewerStoreContext);
  if (!store) {
    throw new Error(
      'useViewerStore must be used within a ViewerProvider',
    );
  }
  return useStore(store, selector);
}

/**
 * Return the raw StoreApi for the nearest ViewerProvider's store.
 * Use sparingly — prefer `useViewerStore(selector)` for reads.
 * Throws if called outside a Provider.
 */
export function useViewerStoreApi(): StoreApi<ViewerState> {
  const store = useContext(ViewerStoreContext);
  if (!store) {
    throw new Error(
      'useViewerStoreApi must be used within a ViewerProvider',
    );
  }
  return store;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npx vitest run frontend/pdf-viewer/__tests__/context.test.tsx
```

Expected: 7 tests passing.

If a test fails:
- "useViewerStore must be used within…" not thrown → confirm the `if (!store) throw` block is in both hooks
- Multi-instance test shows shared state → confirm `useState(() => createViewerStore(...))` is the ownership pattern (not `createViewerStore()` called inline, which would re-create on every render)
- React testing library "act" warnings → wrap state changes in `await act(async () => ...)` (already in the test; confirm)

- [ ] **Step 5: Commit**

```bash
git add frontend/pdf-viewer/core/context.tsx frontend/pdf-viewer/__tests__/context.test.tsx
git commit -m "$(cat <<'EOF'
feat(pdf-viewer): add ViewerProvider, useViewerStore, useViewerStoreApi

Multi-instance Context: each <ViewerProvider> owns a StoreApi via
useState lazy-init, so two providers on the same page have fully
isolated state. Hooks throw when used outside a provider.

Includes the critical multi-instance integration test (two
providers, scale set on left, right unchanged) — proves the
architecture invariant from the master plan.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Update `core/types.ts` — turn into pure barrel

**Files:**
- Modify: `frontend/pdf-viewer/core/types.ts`

The placeholder constant was Phase 0 scaffolding; Phase 1a replaces it with re-exports of all the type modules. Keeping `types.ts` as the named "all types" entry point lets consumers do `import type {Citation, PDFSource} from '@prumo/pdf-viewer/core/types'` if they want the bundle.

- [ ] **Step 1: Replace `core/types.ts`**

Replace the entire content with:

```ts
/**
 * Re-export of all type modules in the core/ directory.
 *
 * Convention: domain types live in their own files
 * (coordinates.ts, source.ts, engine.ts, citation.ts, state.ts).
 * This barrel is provided for consumers that prefer a single import.
 */

export type {PDFPoint, PDFRect, PDFTextRange} from './coordinates';

export type {
  PDFSource,
  PDFUrlSource,
  PDFDataSource,
  PDFLazySource,
} from './source';

export type {
  PDFEngine,
  PDFDocumentHandle,
  PDFPageHandle,
  PageRotation,
  LoadOptions,
  RenderOptions,
  RenderResult,
  PDFMetadata,
  OutlineNode,
  TextContent,
  TextItem,
} from './engine';

export type {
  Citation,
  CitationId,
  CitationAnchor,
  TextCitationAnchor,
  RegionCitationAnchor,
  HybridCitationAnchor,
  CitationMetadata,
  CitationStyle,
} from './citation';

export type {LoadStatus, ViewerState, ViewerActions} from './state';
```

Note: `PDF_VIEWER_MODULE_VERSION` is gone. The scaffolding test in `__tests__/scaffolding.test.ts` will start failing — Task 11 replaces that test.

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep "frontend/pdf-viewer/core/types"
```

Expected: empty.

- [ ] **Step 3: Commit (do not run tests yet — scaffolding test is intentionally broken until Task 11)**

```bash
git add frontend/pdf-viewer/core/types.ts
git commit -m "$(cat <<'EOF'
refactor(pdf-viewer): turn core/types.ts into a pure barrel

Replaces the Phase 0 placeholder constant with re-exports of all
domain type modules. The scaffolding test is now stale and will be
replaced in Task 11 of this plan.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Update `core/index.ts` — re-export types + runtime

**Files:**
- Modify: `frontend/pdf-viewer/core/index.ts`

`core/index.ts` is the canonical sub-module entry. It must re-export both the types and the runtime (store factory + Context).

- [ ] **Step 1: Replace `core/index.ts`**

Replace the entire content with:

```ts
// Types (re-exported through types.ts barrel)
export type * from './types';

// Runtime
export {createViewerStore} from './store';
export {
  ViewerProvider,
  useViewerStore,
  useViewerStoreApi,
  type ViewerProviderProps,
} from './context';
```

`export type *` re-exports only types — no runtime code is duplicated.

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep "frontend/pdf-viewer/core/index"
```

Expected: empty.

- [ ] **Step 3: Commit**

```bash
git add frontend/pdf-viewer/core/index.ts
git commit -m "$(cat <<'EOF'
refactor(pdf-viewer): re-export types and runtime from core/index

Types via 'export type *' from the barrel; runtime (store factory,
Provider, hooks) named explicitly.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Update package entry barrel (`index.ts`)

**Files:**
- Modify: `frontend/pdf-viewer/index.ts`

The package root re-exports everything from `core`. When subsequent phases add more sub-modules (`engines/pdfjs`, `plugins/*`), they will be added here.

- [ ] **Step 1: Replace `index.ts`**

Replace the entire content with:

```ts
export * from './core';
```

`export *` re-exports both types and runtime; combined with `core/index.ts` doing `export type *` for types, the type-only origin is preserved.

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep "frontend/pdf-viewer/index"
```

Expected: empty.

- [ ] **Step 3: Commit**

```bash
git add frontend/pdf-viewer/index.ts
git commit -m "$(cat <<'EOF'
refactor(pdf-viewer): re-export everything from core at the package root

Phase 1a public API surface: PDFSource, PDFEngine, Citation, ViewerState,
createViewerStore, ViewerProvider, useViewerStore, useViewerStoreApi.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Replace scaffolding test with public-API smoke test

**Files:**
- Modify: `frontend/pdf-viewer/__tests__/scaffolding.test.ts`

The Phase 0 test asserted a constant that no longer exists. Replace with a smoke test of the real public API: types are exported (via runtime probes) and the factory + Provider are wired correctly.

- [ ] **Step 1: Replace the test file**

Replace the entire content with:

```ts
import {describe, expect, it} from 'vitest';

describe('@prumo/pdf-viewer public API', () => {
  it('exports the runtime entry points from the package root', async () => {
    const mod = await import('@prumo/pdf-viewer');
    expect(typeof mod.createViewerStore).toBe('function');
    expect(typeof mod.ViewerProvider).toBe('function');
    expect(typeof mod.useViewerStore).toBe('function');
    expect(typeof mod.useViewerStoreApi).toBe('function');
  });

  it('createViewerStore returns a store with getState/setState/subscribe', async () => {
    const {createViewerStore} = await import('@prumo/pdf-viewer');
    const store = createViewerStore();
    expect(typeof store.getState).toBe('function');
    expect(typeof store.setState).toBe('function');
    expect(typeof store.subscribe).toBe('function');
  });
});
```

- [ ] **Step 2: Run the test to confirm it passes**

```bash
npx vitest run frontend/pdf-viewer/__tests__/scaffolding.test.ts
```

Expected: 2 passing.

- [ ] **Step 3: Commit**

```bash
git add frontend/pdf-viewer/__tests__/scaffolding.test.ts
git commit -m "$(cat <<'EOF'
test(pdf-viewer): replace scaffolding test with Phase 1a API smoke test

Phase 0 test asserted PDF_VIEWER_MODULE_VERSION which no longer
exists. New smoke test verifies the real public API surface
(createViewerStore, ViewerProvider, hooks) is reachable from the
package root.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Update README — bump status to Phase 1a

**Files:**
- Modify: `frontend/pdf-viewer/README.md`

- [ ] **Step 1: Replace the `## Status` section**

In `frontend/pdf-viewer/README.md`, find the `## Status` section (which currently begins with "**Phase 0** — Foundation only…"). Replace ONLY that section (everything from `## Status` up to but not including `## Architecture`) with:

```markdown
## Status

**Phase 1a** — Headless core types and per-instance store. The package now
exposes:

- Type definitions: `PDFSource`, `PDFRect`, `PDFTextRange`, `Citation`,
  `PDFEngine` (interface only — no implementation yet), `ViewerState`.
- Runtime: `createViewerStore(initial?)` factory, `<ViewerProvider>`,
  `useViewerStore<T>(selector)`, `useViewerStoreApi()`.

Multi-instance is verified: two `<ViewerProvider>`s on the same page have
fully isolated state.

**Not yet:** concrete PDF.js engine (Phase 1b), compound primitives
(`<Viewer.Root>`, `<Viewer.Page>`) (Phase 2a), plugins (Phase 2b),
citation rendering (Phase 3), annotations (Phase 4), reader view (Phase 5).

The full refactor is split across the following plans (one per subsystem):
```

The phase index table that follows in the existing README should now be updated to mark Phase 1a as having a real plan filename:

Find the row:
```
| 1a | `2026-XX-XX-pdf-viewer-phase1a-core-types-store.md` | Headless core: types + store factory |
```
Replace with:
```
| 1a | `2026-04-28-pdf-viewer-phase1a-core-types-store.md` | Headless core: types + store factory |
```

(Just change `XX-XX` to `04-28` for the Phase 1a row only. Leave the other rows with `XX-XX`.)

- [ ] **Step 2: Commit**

```bash
git add frontend/pdf-viewer/README.md
git commit -m "$(cat <<'EOF'
docs(pdf-viewer): bump README status to Phase 1a

Document the new public API surface and update the phase index
table to reference this plan's filename.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Final integration verification

**Files:** None — verification only.

- [ ] **Step 1: Full unit test run**

```bash
npm run test:run
```

Expected: 99 (Phase 0 baseline) + 12 (store) + 7 (context) + 2 (smoke) = **120 passing tests**, plus 2 pre-existing infrastructure failures (zoteroImportService env var). If the store/context test counts differ from these, investigate before proceeding.

- [ ] **Step 2: Production build**

```bash
npm run build 2>&1 | tail -15
```

Expected: build succeeds. The `@prumo/pdf-viewer` module has no concrete engine yet, but the build should succeed because nothing in `frontend/components/` or `frontend/pages/` consumes the new module yet — Phase 0's vite alias fix means the build is ready when consumption arrives.

- [ ] **Step 3: Bundle inspection — confirm no dead imports**

```bash
grep -r "@prumo/pdf-viewer" dist/ 2>/dev/null | head -5 || echo "no consumer-side bundling yet"
```

Expected: `no consumer-side bundling yet` (the module is not imported by app code in Phase 1a; Phase 2a will start consuming it).

- [ ] **Step 4: Type-check the entire app**

```bash
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep "frontend/pdf-viewer" || echo "no errors in pdf-viewer"
```

Expected: `no errors in pdf-viewer`. Pre-existing ~17 unrelated errors in article/extraction components remain — they are not in scope.

- [ ] **Step 5: Commit history sanity check**

```bash
git log --oneline -15
```

Verify the recent commits cover (in some order): coordinates, source, engine, citation, state, store + tests, context + tests, types barrel, core barrel, package barrel, scaffolding-test replacement, README. ~12 commits added in this plan.

- [ ] **Step 6: Hand off**

This plan does not prescribe merge. Branch is ready for code review or merge to `dev`.

---

## Self-review checklist

After all tasks complete:

- [ ] `coordinates.ts`, `source.ts`, `engine.ts`, `citation.ts`, `state.ts`, `store.ts`, `context.tsx` all exist under `frontend/pdf-viewer/core/`
- [ ] `core/types.ts` is a pure barrel — no runtime exports
- [ ] `core/index.ts` re-exports types via `export type *` and runtime explicitly
- [ ] `index.ts` re-exports everything from `./core`
- [ ] `npm run test:run` shows 120 passing tests (Phase 0 baseline 99 + 21 new)
- [ ] The multi-instance integration test (two `<ViewerProvider>`s) passes — this is the critical proof
- [ ] `npm run build` succeeds
- [ ] No `frontend/pdf-viewer/` files have type errors
- [ ] README's `## Status` section reflects Phase 1a; phase-index table has `2026-04-28-` for row 1a only

---

## Out of scope for this plan (handed to subsequent plans)

- **Concrete `PDFJsEngine` implementation** → **Phase 1b**: implements `PDFEngine` against `pdfjs-dist` v5; multi-instance smoke demo using two `<ViewerProvider>`s loading different PDFs concurrently
- **Compound primitives** (`<Viewer.Root>`, `<Viewer.Pages>`, `<Viewer.Page>`, `<Viewer.CanvasLayer>`, `<Viewer.TextLayer>`) → **Phase 2a**
- **Plugin system** (`definePlugin`, `PluginContext`, `registerLayer`, `registerToolbarItem`) → **Phase 2a**
- **Plugin migration** (toolbar, search via `PDFFindController`, zoom, navigation, virtualization via TanStack Virtual, thumbnails with OffscreenCanvas) → **Phase 2b**
- **Citation rendering and AI integration** (`HighlightController`, `goToCitation`, `regionSelector`, OpenDataLoader pre-indexing) → **Phase 3**
- **W3C annotations** (`Annotation` type, Recogito integration, `pdf_annotations` table) → **Phase 4** — blocked on schema coordination with `claude/strange-wiles-a189ef`
- **Reader-view a11y** + mobile gestures + legacy cleanup (delete old `frontend/components/PDFViewer/`, `usePDFStore`, `usePDFPerformance`, `pdfSearchService`) → **Phase 5**
