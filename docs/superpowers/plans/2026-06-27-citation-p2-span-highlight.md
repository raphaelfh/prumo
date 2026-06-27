---
status: draft
last_reviewed: 2026-06-27
owner: '@raphaelfh'
---

# Citation P2 — Precise Span Highlight via the CSS Custom Highlight API Implementation Plan

> **Note for the agentic worker:** Execute one `- [ ]` step at a time, in order.
> Each step is a bite-sized TDD loop: write the failing test exactly as given,
> run the verify command and read its output (RED), then write the minimum
> implementation to make it pass and re-run (GREEN). Never batch steps. Never
> mark a step done without running its verify command and reading the output.
> Stop and report if a verify command behaves differently than the step
> predicts — do not "fix forward" past an unexpected signal. This phase is
> **frontend-only**: do NOT touch the backend, the parser, Alembic, or
> migrations. All commands run from the **repo root** (`npm run ...`); there is
> no `frontend/package.json`. Do NOT `npm install` into the worktree —
> `node_modules` resolves from the parent checkout (a worktree install
> duplicates React and breaks the compiler). The worktree is
> `/Users/raphael/PycharmProjects/prumo/.claude/worktrees/condescending-einstein-c5c778`
> on branch `claude/citation-p2-blockid-highlight` (off `dev`, with P0+P1
> merged).

## Goal

The reader already locates citations at the **block** level deterministically:
`Reader.tsx` resolves a `ReaderLocateRequest` to a block id (preferring
`findBlockByIndex(blockIds)`, falling back to `findBlockForQuote(quote)`),
scrolls the `[data-block-id]` div into view, and flashes it for 1800ms. P2 adds
a **precise span highlight of the cited quote *within* the located block** using
the [CSS Custom Highlight API](https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API),
as a **progressive enhancement** over the block-flash.

When a locate resolves to a block, the reader additionally:
1. finds the quote text inside that block's **rendered DOM** (a `TreeWalker`
   over text nodes, normalized the same way `readerLocate.ts` normalizes), and
2. registers a `Highlight` over the resulting `Range` via
   `CSS.highlights.set('citation-quote', new Highlight(range))`, styled by a
   `::highlight(citation-quote)` rule.

The highlight is **transient**: it is cleared on the same 1800ms timer as the
block-flash and on the next locate.

**Progressive enhancement is mandatory — there must be NO regression.** If the
browser lacks the API (`typeof Highlight === 'undefined' || !CSS.highlights` —
Safari historically lagged) OR the quote is not found in the rendered DOM, the
reader does nothing extra; the block-flash (which already fired) remains the
behaviour. The block-flash path is never weakened.

**Why locate in the rendered DOM, never via char offsets.** The reader renders
each block's text through `MarkdownContent` (react-markdown → GFM/KaTeX), so the
on-screen text is a *projection* of the source markdown, split across many text
nodes by inline markup (`**bold**`, links, `<sup>`). Source-string char offsets
do not map to rendered text positions. The only reliable anchor is the live DOM,
which is exactly what `Range` + `TreeWalker` operate on.

**Deferred (NOT in P2):**
- **`block_id` LLM-injection** (having the model emit `block_index` so the
  deterministic path fires more often). That is gated on the citation eval
  corpus — defer to a later phase. P2 improves *rendering precision* of whatever
  block already gets located; it does not change *how* the block is located.
- Multi-span / per-evidence highlight selection (P1 shipped multi-citation
  render; P2 highlights the **single** quote the active locate carries). Wiring
  per-row Locate to distinct spans is a follow-up.
- Table-cell / figure highlighting, scroll-to-span fine positioning beyond the
  existing block-level `scrollIntoView`.

## Architecture

The locate path in `Reader.tsx`, with P2 added (new pieces marked `▶`):

```
viewer store: locateInReader(quote, page, blockIds)
  → readerLocate = { quote, page, blockIds, nonce++ }
        │
        ▼  subscribeReaderLocate (de-dupes by nonce; immediate:true)
Reader effect callback(req):
  matchedId = findBlockByIndex(blocks, req.page, req.blockIds)        ── deterministic
            ?? findBlockForQuote(blocks, req.quote, req.page)         ── quote fallback
  target = root.querySelector('[data-block-id="…"]')  (or page section)
  target.scrollIntoView({behavior:'smooth', block:'center'})
  if matchedId:
    setFlashId(matchedId)            ── block-flash (Tailwind ring, EXISTS)
    setTimeout(clear, 1800ms)
 ▶  applySpanHighlight(target, req.quote)   ── P2, AFTER the flash is set
 ▶    range = locateQuoteRange(blockEl, quote)   (spanHighlight.ts; null when not found)
 ▶    if supported && range: CSS.highlights.set('citation-quote', new Highlight(range))
 ▶    else: no-op (block-flash already happened = no regression)
  on timer / next locate / unmount:
 ▶    clearSpanHighlight()  → CSS.highlights.delete('citation-quote')
```

New / changed files:

```
frontend/pdf-viewer/primitives/
  spanHighlight.ts        ▶ NEW  — pure DOM helpers:
                                    locateQuoteRange(el, quote): Range | null
                                    isHighlightApiSupported(): boolean
                                    setCitationHighlight(range): void
                                    clearCitationHighlight(): void
  Reader.tsx              ▶ EDIT  — call the helpers from the existing locate
                                    effect; clear on the flash timer + unmount
  reader.css              ▶ NEW  — ::highlight(citation-quote) rule (semantic,
                                    dark-mode aware); imported by Reader.tsx
  __tests__/spanHighlight.test.ts   ▶ NEW (unit, jsdom Range/TreeWalker)
frontend/pdf-viewer/__tests__/
  reader-span-highlight.test.tsx    ▶ NEW (integration; mock CSS.highlights + Highlight)
```

The CSS-import pattern is the existing one: `TextLayer.tsx` does
`import './text-layer.css'`. P2 mirrors it with `import './reader.css'` from
`Reader.tsx` (a component-scoped stylesheet, NOT a global). The
`::highlight()` pseudo-element cannot be expressed in Tailwind utility classes,
so a raw CSS rule is required and correct here.

## Tech Stack

- **Frontend:** TypeScript strict, React 19 + Vite (React Compiler,
  `panicThreshold: 'all_errors'`), shadcn/Radix, in-house i18n
  `frontend/lib/copy/`. Reader rendering via `react-markdown` (text is split
  across many text nodes).
- **CSS Custom Highlight API:** `CSS.highlights` (a `HighlightRegistry`,
  `Map`-like) + the `Highlight` constructor (takes `Range`s) + the
  `::highlight(name)` pseudo-element. Baseline-recent; **not universal** (Safari
  historically lagged) — feature-detected, with a block-flash fallback.
- **Tests:** Vitest + jsdom. jsdom implements `Range`, `document.createRange()`,
  `document.createTreeWalker()`, and `NodeFilter` (used by the pure helper). jsdom
  does **not** implement `CSS.highlights` / `Highlight` — the integration test
  installs `Map`-based stubs (and asserts the fallback when they are absent),
  exactly the feature-detection the production code performs.

## Global Constraints

These are prumo invariants. Violating any one fails CI or review. Copy them into
your working memory before each task.

- **Frontend-only.** No backend, parser, Alembic, or migration changes. No new
  endpoint, no schema/`schema.d.ts` change (P2 consumes the existing
  `ReaderLocateRequest`).
- **React Compiler (`panicThreshold: 'all_errors'`).** NO `try/finally` or
  `throw` in component or hook bodies. All DOM mutation and `CSS.highlights`
  registration happen inside the **existing ref-stabilized `useEffect`** locate
  callback / a ref-held timer — never during render. The pure helper
  (`spanHighlight.ts`) is plain module code, not a component/hook, so it is
  outside the compiler's body rules; it MUST still avoid `throw` (return `null`
  on any miss). `'use no memo'` is a last resort only, with a `// kept:` reason.
- **Progressive enhancement / no regression.** The block-flash path
  (`setFlashId` + `scrollIntoView`) is unchanged and always runs first. The span
  highlight is strictly additive: when unsupported or the quote is not found,
  behaviour is byte-identical to today. Tests must prove the fallback.
- **Normalization parity.** Quote matching in the DOM uses the SAME
  normalization semantics as `readerLocate.ts` (`normalize`: strip
  `*_`` ~#|>` markdown syntax → collapse whitespace → lowercase; plus
  `stripTrailingEllipsis`). The block already passed `findBlock*`, so the quote
  is known to exist in the block's *normalized source*; the DOM helper applies
  the same normalization to the *rendered* text so it locates the same span. Do
  not invent a second, divergent normalizer.
- **Copy.** This feature is non-textual (a decorative highlight). The only
  user-facing string is an optional `aria` description if added — it MUST come
  from `frontend/lib/copy/pdf.ts` (the existing reader/PDF namespace), never a
  hardcoded literal. The highlight itself carries no text.
- **Tests from the repo root.** `npm run test:run` (vitest; never bare
  `npm test` — that is watch mode and hangs). `npm run lint`, `npx tsc --noEmit`.
  Do NOT `npm install` into the worktree.
- **No new `supabase.from(...)` / `fetch()` / `import.meta.env.VITE_API_URL`.**
  (CI-enforced; P2 touches none of these, but the constraint stands.)
- **English only. Conventional commits.**

---

### Task 1 — Pure span-locator + highlight-registry helpers (`spanHighlight.ts`)

Build a dependency-free module that (a) given a block element and a quote string
returns a `Range` over the quote in the **rendered** DOM (or `null`), and (b)
wraps the `CSS.highlights` registry behind feature-detected, throw-free
functions. No React, no store.

**Files**
- `frontend/pdf-viewer/primitives/spanHighlight.ts` (new)
- `frontend/pdf-viewer/primitives/__tests__/spanHighlight.test.ts` (new)

**Interfaces**
```ts
/**
 * Precise citation-span highlighting for the reader, layered over block-flash.
 *
 * Locating happens in the RENDERED DOM (a TreeWalker over text nodes), never via
 * source char offsets: the reader renders markdown, so on-screen text is split
 * across many text nodes by inline markup and does not map to source offsets.
 * Matching mirrors `readerLocate.ts` normalization (markdown-syntax strip +
 * whitespace-collapse + lowercase + trailing-ellipsis tolerance).
 *
 * The CSS Custom Highlight API is feature-detected; on unsupported browsers
 * (Safari historically) every function is a safe no-op so the caller's
 * block-flash remains the behaviour (no regression).
 */
export const CITATION_HIGHLIGHT_NAME = 'citation-quote';

/** True only when both the registry and the Highlight constructor exist. */
export function isHighlightApiSupported(): boolean;

/**
 * Build a Range spanning `quote` inside `block`'s rendered text, or null when
 * the quote (after normalization) is not present. Never throws.
 */
export function locateQuoteRange(block: Element, quote: string): Range | null;

/** Register the citation highlight over `range`. No-op when unsupported. */
export function setCitationHighlight(range: Range): void;

/** Remove the citation highlight. No-op when unsupported or absent. */
export function clearCitationHighlight(): void;
```

Implementation notes for `locateQuoteRange`:
- Normalize the quote: strip `[*_`~#|>]` → trim → collapse `\s+` → lowercase,
  then strip a trailing `[.…]+` (mirror `readerLocate.ts`). Bail to `null` on an
  empty result.
- Walk text nodes (`document.createTreeWalker(block, NodeFilter.SHOW_TEXT)`),
  building a single concatenated normalized string while recording, per output
  character, which `(node, originalOffset)` it came from (an index map). Use a
  whitespace-collapsing pass that maps each kept normalized char back to a source
  text-node offset so a match found in the normalized string can be converted to
  real `Range` start/end via `range.setStart(node, offset)` /
  `range.setEnd(node, offset)`.
- `indexOf` the normalized quote in the normalized concatenation; on miss return
  `null`. This makes a quote that spans inline markup (e.g. text broken by
  `<strong>`) locatable, because the walker flattens across element boundaries.
- Never `throw`; any defensive failure returns `null`.

- [ ] **RED — supported-detection + plain-text Range.** Create
  `frontend/pdf-viewer/primitives/__tests__/spanHighlight.test.ts`:
  ```ts
  import {afterEach, describe, expect, it, vi} from 'vitest';
  import {
    CITATION_HIGHLIGHT_NAME,
    clearCitationHighlight,
    isHighlightApiSupported,
    locateQuoteRange,
    setCitationHighlight,
  } from '../spanHighlight';

  function block(html: string): HTMLElement {
    const el = document.createElement('div');
    el.innerHTML = html;
    document.body.appendChild(el);
    return el;
  }

  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  describe('locateQuoteRange', () => {
    it('returns a Range spanning the quote in plain text', () => {
      const el = block('<p>SMART-CARE is a prospective, multicenter cohort study.</p>');
      const range = locateQuoteRange(el, 'prospective, multicenter cohort');
      expect(range).not.toBeNull();
      expect(range!.toString().toLowerCase()).toContain('prospective, multicenter cohort');
    });

    it('returns null when the quote is absent', () => {
      const el = block('<p>nothing relevant here</p>');
      expect(locateQuoteRange(el, 'no such passage')).toBeNull();
    });

    it('returns null for an empty / whitespace quote', () => {
      const el = block('<p>some text</p>');
      expect(locateQuoteRange(el, '   ')).toBeNull();
    });
  });
  ```
  Verify (expect FAIL — module does not exist):
  `npm run test:run -- spanHighlight`
- [ ] **GREEN — implement the locator + registry wrappers.** Create
  `frontend/pdf-viewer/primitives/spanHighlight.ts` per the interface above
  (TreeWalker + index-map locating; throw-free). Implement
  `isHighlightApiSupported` as
  `typeof Highlight !== 'undefined' && typeof CSS !== 'undefined' && !!(CSS as any).highlights`,
  and make `setCitationHighlight` / `clearCitationHighlight` early-return when
  unsupported. Re-run (expect PASS):
  `npm run test:run -- spanHighlight`
- [ ] **RED — quote split by inline markup is still located.** Add to the test
  file:
  ```ts
  it('locates a quote that is split across inline markup', () => {
    const el = block('<p>SMART-CARE is a <strong>prospective, multicenter</strong> cohort study.</p>');
    const range = locateQuoteRange(el, 'prospective, multicenter cohort');
    expect(range).not.toBeNull();
    // start lands in the <strong> text node, end in the trailing text node.
    expect(range!.toString().toLowerCase()).toContain('cohort');
  });

  it('tolerates a trailing ellipsis on the quote', () => {
    const el = block('<p>SMART-CARE is a prospective, multicenter cohort study.</p>');
    const range = locateQuoteRange(el, 'SMART-CARE is a prospective, multicenter...');
    expect(range).not.toBeNull();
  });

  it('matches case- and whitespace-insensitively', () => {
    const el = block('<p>Patients   were  FOLLOWED for six months.</p>');
    const range = locateQuoteRange(el, 'were followed for six MONTHS');
    expect(range).not.toBeNull();
  });
  ```
  Verify (these exercise the cross-node walk + normalization; expect FAIL if the
  GREEN implementation only handled a single contiguous text node — fix the
  index-map until they pass):
  `npm run test:run -- spanHighlight`
- [ ] **GREEN — confirm cross-node + normalization paths.** Adjust the locator so
  all five `locateQuoteRange` cases pass (the index map must span element
  boundaries; the normalizer must collapse whitespace, lowercase, and strip a
  trailing ellipsis). Re-run (expect PASS):
  `npm run test:run -- spanHighlight`
- [ ] **RED — registry wrappers feature-detect and round-trip.** Add:
  ```ts
  describe('highlight registry wrappers', () => {
    it('reports unsupported when Highlight is undefined', () => {
      vi.stubGlobal('Highlight', undefined);
      expect(isHighlightApiSupported()).toBe(false);
      // no throw on a no-op set/clear when unsupported
      const el = block('<p>text</p>');
      const range = locateQuoteRange(el, 'text')!;
      expect(() => setCitationHighlight(range)).not.toThrow();
      expect(() => clearCitationHighlight()).not.toThrow();
    });

    it('registers and removes the named highlight when supported', () => {
      const store = new Map<string, unknown>();
      class FakeHighlight {
        ranges: Range[];
        constructor(...ranges: Range[]) {
          this.ranges = ranges;
        }
      }
      vi.stubGlobal('Highlight', FakeHighlight);
      vi.stubGlobal('CSS', {...(globalThis.CSS ?? {}), highlights: store});
      expect(isHighlightApiSupported()).toBe(true);

      const el = block('<p>cohort study</p>');
      const range = locateQuoteRange(el, 'cohort study')!;
      setCitationHighlight(range);
      expect(store.has(CITATION_HIGHLIGHT_NAME)).toBe(true);

      clearCitationHighlight();
      expect(store.has(CITATION_HIGHLIGHT_NAME)).toBe(false);
    });
  });
  ```
  Verify (expect FAIL if the wrappers don't use the live `CSS.highlights` /
  `Highlight` globals through the feature gate):
  `npm run test:run -- spanHighlight`
- [ ] **GREEN — wire the wrappers to the gated globals.** Make
  `setCitationHighlight` build `new Highlight(range)` and call
  `CSS.highlights.set(CITATION_HIGHLIGHT_NAME, …)` only when supported;
  `clearCitationHighlight` call `CSS.highlights.delete(CITATION_HIGHLIGHT_NAME)`
  guarded by support. Re-run (expect PASS):
  `npm run test:run -- spanHighlight`

### Task 2 — Wire span highlight into the reader + add the CSS rule (`Reader.tsx`, `reader.css`)

Call the Task-1 helpers from the **existing** locate effect in `Reader.tsx`,
after the block-flash is set, and clear them on the same 1800ms timer, on the
next locate, and on unmount. Add the `::highlight(citation-quote)` rule in a new
component-scoped stylesheet imported by `Reader.tsx`.

**Files**
- `frontend/pdf-viewer/primitives/Reader.tsx` (the locate `useEffect` ~L110–144;
  add the import + the additive calls)
- `frontend/pdf-viewer/primitives/reader.css` (new)
- `frontend/pdf-viewer/__tests__/reader-span-highlight.test.tsx` (new)

**Interfaces**
```ts
// Reader.tsx — additive imports
import './reader.css';
import {
  clearCitationHighlight,
  locateQuoteRange,
  setCitationHighlight,
} from './spanHighlight';
```
Inside the existing locate callback, AFTER the `if (matchedId) { setFlashId… }`
block (so the flash always fires first), add the span enhancement. `target` is
the located block element (the `[data-block-id]` div); the quote is `req.quote`:
```ts
        // P2: precise span highlight over the cited quote within the block —
        // a progressive enhancement over the block-flash. Unsupported browser
        // or quote-not-in-DOM → no-op (block-flash already happened).
        clearCitationHighlight();
        if (matchedId && target && req.quote) {
          const range = locateQuoteRange(target, req.quote);
          if (range) setCitationHighlight(range);
        }
```
Clear the highlight on the same timer as the flash and on unmount:
```ts
          flashTimer.current = setTimeout(() => {
            setFlashId(null);
            clearCitationHighlight();
          }, FLASH_MS);
```
```ts
    return () => {
      unsubscribe();
      if (flashTimer.current) clearTimeout(flashTimer.current);
      clearCitationHighlight();
    };
```
All mutation stays inside the existing ref-stabilized effect callback / its
ref-held timer — no render-time DOM access, satisfying the React Compiler.

`reader.css`:
```css
/* Precise citation-span highlight (CSS Custom Highlight API), layered over the
   block-flash. Semantic + dark-mode aware; degrades to nothing where the API is
   unsupported (the block-flash remains). */
::highlight(citation-quote) {
  background-color: hsl(var(--primary) / 0.25);
  color: inherit;
  border-radius: 2px;
}

@media (prefers-color-scheme: dark) {
  ::highlight(citation-quote) {
    background-color: hsl(var(--primary) / 0.35);
  }
}
```

- [ ] **RED — registers a highlight when supported AND quote found.** Create
  `frontend/pdf-viewer/__tests__/reader-span-highlight.test.tsx` (mirrors the
  store-wiring in `reader-locate.test.tsx`):
  ```tsx
  import {act, render, waitFor} from '@testing-library/react';
  import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

  import {Reader, type ReaderTextBlock} from '../primitives/Reader';
  import {CITATION_HIGHLIGHT_NAME} from '../primitives/spanHighlight';
  import {ViewerProvider} from '../core/context';
  import {createViewerStore} from '../core/store';

  const scrollSpy = vi.fn();

  const blocks: ReaderTextBlock[] = [
    {
      id: 'b1',
      pageNumber: 1,
      blockIndex: 0,
      text: 'SMART-CARE is a prospective, multicenter cohort study.',
      blockType: 'paragraph',
    },
  ];

  class FakeHighlight {
    ranges: Range[];
    constructor(...ranges: Range[]) {
      this.ranges = ranges;
    }
  }

  beforeEach(() => {
    scrollSpy.mockReset();
    (Element.prototype as unknown as {scrollIntoView: () => void}).scrollIntoView =
      scrollSpy;
  });
  afterEach(() => {
    delete (Element.prototype as unknown as {scrollIntoView?: () => void})
      .scrollIntoView;
    vi.unstubAllGlobals();
  });

  describe('<Reader> precise span highlight (CSS Custom Highlight API)', () => {
    it('registers a citation-quote highlight when supported and the quote is found', async () => {
      const store = new Map<string, unknown>();
      vi.stubGlobal('Highlight', FakeHighlight);
      vi.stubGlobal('CSS', {...(globalThis.CSS ?? {}), highlights: store});

      const viewer = createViewerStore({mode: 'reader'});
      render(
        <ViewerProvider store={viewer}>
          <Reader blocks={blocks} />
        </ViewerProvider>,
      );

      act(() => {
        viewer.getState().actions.locateInReader('prospective, multicenter cohort', 1);
      });

      await waitFor(() => {
        expect(store.has(CITATION_HIGHLIGHT_NAME)).toBe(true);
      });
    });
  });
  ```
  Verify (expect FAIL — Reader does not yet register a highlight):
  `npm run test:run -- reader-span-highlight`
- [ ] **GREEN — add the import + additive calls + CSS.** Create `reader.css` with
  the rule above; add the imports and the additive span-highlight calls to the
  `Reader.tsx` locate callback, the timer clear, and the unmount cleanup, exactly
  per the interface. Re-run (expect PASS):
  `npm run test:run -- reader-span-highlight`
- [ ] **RED — fallback: no highlight + no throw when API is unsupported, block-flash still fires.**
  Add to the test file:
  ```tsx
  it('falls back to block-flash (no throw, no highlight) when the API is unsupported', async () => {
    vi.stubGlobal('Highlight', undefined);
    // CSS may exist but without `highlights`; emulate an unsupported browser.
    vi.stubGlobal('CSS', {escape: (s: string) => s});

    const viewer = createViewerStore({mode: 'reader'});
    const {container} = render(
      <ViewerProvider store={viewer}>
        <Reader blocks={blocks} />
      </ViewerProvider>,
    );

    act(() => {
      viewer.getState().actions.locateInReader('prospective, multicenter cohort', 1);
    });

    // Block-flash (the existing behaviour) still happens — no regression.
    const target = container.querySelector<HTMLElement>('[data-block-id="b1"]');
    await waitFor(() => {
      expect(target!.className).toContain('bg-primary/15');
    });
    expect(scrollSpy).toHaveBeenCalled();
  });

  it('does not register a highlight when the quote is not found in the DOM', async () => {
    const store = new Map<string, unknown>();
    vi.stubGlobal('Highlight', FakeHighlight);
    vi.stubGlobal('CSS', {...(globalThis.CSS ?? {}), highlights: store});

    const viewer = createViewerStore({mode: 'reader'});
    render(
      <ViewerProvider store={viewer}>
        <Reader blocks={blocks} />
      </ViewerProvider>,
    );

    // Locate resolves to block b1 by page, but this quote is not in its text.
    act(() => {
      viewer.getState().actions.locateInReader('a passage absent from the block', 1);
    });

    await Promise.resolve();
    expect(store.has(CITATION_HIGHLIGHT_NAME)).toBe(false);
  });
  ```
  Verify (the GREEN implementation should already satisfy both via the feature
  gate + `locateQuoteRange` null path; if either fails, the additive calls are
  not properly guarded — fix until green):
  `npm run test:run -- reader-span-highlight`
- [ ] **GREEN — confirm fallback + not-found guards.** Ensure
  `clearCitationHighlight()` is called unconditionally before the guarded
  `setCitationHighlight`, and the `if (range)` guard prevents registration on a
  miss. Re-run (expect PASS):
  `npm run test:run -- reader-span-highlight`
- [ ] **RED — highlight clears on the flash timer.** Add (drives the timer with
  fake timers; clears after FLASH_MS):
  ```tsx
  it('clears the highlight when the flash timer elapses', async () => {
    vi.useFakeTimers();
    const store = new Map<string, unknown>();
    vi.stubGlobal('Highlight', FakeHighlight);
    vi.stubGlobal('CSS', {...(globalThis.CSS ?? {}), highlights: store});

    const viewer = createViewerStore({mode: 'reader'});
    render(
      <ViewerProvider store={viewer}>
        <Reader blocks={blocks} />
      </ViewerProvider>,
    );

    act(() => {
      viewer.getState().actions.locateInReader('prospective, multicenter cohort', 1);
    });
    expect(store.has(CITATION_HIGHLIGHT_NAME)).toBe(true);

    act(() => {
      vi.advanceTimersByTime(2000); // > FLASH_MS (1800)
    });
    expect(store.has(CITATION_HIGHLIGHT_NAME)).toBe(false);

    vi.useRealTimers();
  });
  ```
  Verify (expect FAIL if the timer callback doesn't also clear the highlight):
  `npm run test:run -- reader-span-highlight`
- [ ] **GREEN — clear on the timer.** Confirm the `setTimeout` callback calls
  `clearCitationHighlight()` alongside `setFlashId(null)` (per the interface).
  Re-run (expect PASS):
  `npm run test:run -- reader-span-highlight`

### Task 3 — Harden & verify (whole-phase gate)

- [ ] **Full pdf-viewer suite still green (no regression to the existing
  block-flash/locate tests).** Verify:
  `npm run test:run -- pdf-viewer`
- [ ] **Lint + typecheck clean (React Compiler `all_errors` gate).** Confirms no
  `try/finally`/`throw` slipped into a component/hook body and the new files
  compile. Verify:
  `npm run lint && npx tsc --noEmit`
- [ ] **No forbidden data-path additions.** P2 adds no `fetch`,
  `supabase.from(`, or `import.meta.env.VITE_API_URL`. Verify (expect no output):
  `grep -rn "supabase.from(\|VITE_API_URL\|fetch(" frontend/pdf-viewer/primitives/spanHighlight.ts frontend/pdf-viewer/primitives/Reader.tsx`
- [ ] **Normalization parity is documented at the call site.** The DOM
  normalizer mirrors `readerLocate.ts`. Verify both normalizers strip the same
  syntax set and the helper references the parity in a comment:
  `grep -n "stripTrailingEllipsis\|toLowerCase" frontend/pdf-viewer/primitives/spanHighlight.ts frontend/pdf-viewer/primitives/readerLocate.ts`
- [ ] **Manual smoke in a supporting browser (evidence-backed, optional but
  recommended).** Run the local stack, open a run, locate a citation whose quote
  is present in a located block, and confirm a precise sub-block highlight
  appears (in addition to the block ring) and fades with the flash. Then confirm
  in Safari (or with `Highlight` shimmed off) that locating still scrolls +
  flashes the block with no console error — the fallback. Capture a screenshot of
  each as evidence.

---

## Self-Review

Before opening a PR, confirm each of these against **run output**, not memory:

- **TDD discipline.** Every implementation step was preceded by a RED run whose
  failure you read, and followed by a GREEN run whose pass you read. No step was
  marked done on assertion alone (`verification-before-completion`).
- **No regression / progressive enhancement.** The block-flash + `scrollIntoView`
  path is unchanged and runs first; the span highlight is strictly additive. The
  fallback tests prove that an unsupported browser (`Highlight` undefined / no
  `CSS.highlights`) and a quote-not-in-DOM both leave behaviour identical to
  today (block-flash fires, no throw, no highlight registered).
- **DOM-only locating.** `locateQuoteRange` walks rendered text nodes (TreeWalker
  + index map) and returns a `Range`; it NEVER uses source/projection char
  offsets. A quote split across inline markup is still located (cross-node test).
- **Normalization parity.** The DOM normalizer matches `readerLocate.ts`
  (markdown-syntax strip + whitespace-collapse + lowercase + trailing-ellipsis
  tolerance); there is no second divergent normalizer.
- **Transience.** The highlight clears on the 1800ms flash timer, on the next
  locate (`clearCitationHighlight()` before each `set`), and on unmount — all
  three covered (timer test + the unconditional clear-before-set + the effect
  cleanup).
- **React Compiler.** No `try/finally`/`throw` in any component or hook body; all
  DOM/registry mutation lives in the existing ref-stabilized effect callback and
  its ref-held timer; no `'use no memo'` was needed (or, if it was, it carries a
  `// kept:` reason). `npm run lint` and `tsc --noEmit` are clean.
- **CSS scope.** `::highlight(citation-quote)` lives in a component-scoped
  `reader.css` imported by `Reader.tsx` (mirroring `text-layer.css`), uses
  semantic tokens (`--primary`), and is dark-mode aware. It is raw CSS because
  the `::highlight()` pseudo-element cannot be expressed as a Tailwind utility.
- **Copy.** No hardcoded user-facing strings added; the highlight is non-textual.
  Any `aria` description (if introduced) comes from `frontend/lib/copy/pdf.ts`.
- **Frontend-only / scope honesty.** No backend, parser, Alembic, migration,
  endpoint, or `schema.d.ts` change. `block_id` LLM-injection is explicitly
  deferred to a phase gated on the citation eval corpus; multi-span / per-row
  Locate selection and table/figure highlighting are out of scope.
- **Worktree hygiene.** No `npm install` ran in the worktree (`node_modules`
  resolves from the parent checkout); tests ran from the repo root via
  `npm run test:run`.
