/**
 * <Viewer.Reader> — professional markdown rendering of an article's text blocks.
 *
 * Active when `state.mode === 'reader'`. Each block's text is parsed markdown
 * (LlamaParse output), so it is rendered through `MarkdownContent` —
 * GFM tables, math (KaTeX), and flow diagrams (Mermaid) all render as the
 * document intends, rather than as raw `| … |` / `graph TD` / `<page_number>`
 * noise. Blocks are page-grouped and tagged (`data-block-id` / `data-reader-page`)
 * so the markdown-first citation locator can scroll + flash the cited passage.
 *
 * Citation locating is driven by the shared viewer store's `readerLocate`
 * request (set by `actions.locateInReader`); this component owns the scroll +
 * flash. When rendered outside a ViewerProvider (e.g. unit tests) the optional
 * store hook returns null and locating is simply inert.
 */
import {memo, useEffect, useRef, useState, type ReactNode, type RefObject} from 'react';

import {cn} from '@/lib/utils';
import {useViewerStore, useViewerStoreApi, useViewerStoreApiOptional} from '../core/context';
import {subscribeReaderLocate} from '../core/subscribeReaderLocate';
import {MarkdownContent} from '../markdown/MarkdownContent';
import {findBlockByIndex, findBlockForQuote} from './readerLocate';
import './reader.css';
import {
  clearCitationHighlight,
  locateQuoteRange,
  setCitationHighlight,
} from './spanHighlight';
import {
  clearReaderSearchHighlights,
  computeRevealScroll,
  findReaderMatches,
  setReaderSearchHighlights,
} from './readerSearch';

export interface ReaderTextBlock {
  id: string;
  pageNumber: number;
  blockIndex: number;
  text: string;
  blockType:
    | 'paragraph'
    | 'heading'
    | 'list_item'
    | 'table_cell'
    | 'figure_caption'
    | 'header'
    | 'footer';
}

export interface ReaderProps {
  blocks: readonly ReaderTextBlock[];
  /** Shown when `blocks` is empty AND `loading` is false. */
  emptyState?: ReactNode;
  /** Shown while the upstream fetch is in flight. */
  loading?: boolean;
  /** Optional override for the default loading affordance. */
  loadingState?: ReactNode;
  className?: string;
}

const DEFAULT_EMPTY: ReactNode = (
  <div
    data-testid="reader-empty"
    className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground"
  >
    Reader view requires the document to be indexed. Processing typically
    completes shortly after upload — try again in a minute, or switch back
    to the page view.
  </div>
);

const DEFAULT_LOADING: ReactNode = (
  <div
    role="status"
    aria-live="polite"
    data-testid="reader-loading"
    className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground"
  >
    Loading reader view…
  </div>
);

const FLASH_MS = 1800;

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value;
}

/**
 * Render one block's body, choosing markdown vs. plain de-emphasised text by type.
 *
 * `memo` is load-bearing, not just perf: search highlights are DOM Ranges over
 * this rendered text, and any re-render rebuilds the markdown subtree (new text
 * nodes) which silently detaches those Ranges. Memoising on the stable `block`
 * keeps the DOM (and thus the highlights) intact across unrelated Reader
 * re-renders — e.g. a citation flash toggling a sibling block's background.
 */
const BlockBody = memo(function BlockBody({block}: {block: ReaderTextBlock}) {
  const text = block.text;
  switch (block.blockType) {
    case 'header':
    case 'footer':
      return <p className="text-[11px] text-muted-foreground/60">{text}</p>;
    case 'figure_caption':
      return <p className="text-xs italic text-muted-foreground">{text}</p>;
    case 'heading':
      // LlamaParse heading blocks carry no `#`; promote to a real heading so it
      // renders (and reads) as one. Page-markdown blocks already have their `#`.
      return <MarkdownContent>{/^#/.test(text.trim()) ? text : `## ${text}`}</MarkdownContent>;
    default:
      return <MarkdownContent>{text}</MarkdownContent>;
  }
});

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Suppress the page-sync IntersectionObserver for ~500ms so a programmatic
 * scroll (page nav OR find reveal) isn't mistaken for a user scroll — otherwise
 * the observer writes currentPage, which triggers a competing section-scroll
 * that fights the reveal (snapping to the page header instead of the match).
 */
function armScrollGuard(
  flagRef: {current: boolean},
  timerRef: {current: ReturnType<typeof setTimeout> | null},
) {
  flagRef.current = true;
  if (timerRef.current) clearTimeout(timerRef.current);
  timerRef.current = setTimeout(() => {
    flagRef.current = false;
    timerRef.current = null;
  }, 500);
}

/**
 * Reveal a match Range inside the reader's scroll container, centering the exact
 * match (not its enclosing block — a long paragraph centered would still hide
 * the hit). No-op when the match is already comfortably visible, so stepping
 * through nearby matches (or typing) doesn't jangle the view. `onBeforeScroll`
 * fires only when a scroll will actually happen (used to arm the scroll guard).
 */
function revealRange(scroller: Element | null, range: Range, onBeforeScroll?: () => void) {
  if (!scroller || typeof range.getBoundingClientRect !== 'function') return;
  const rRect = range.getBoundingClientRect();
  // jsdom returns all-zero rects — nothing meaningful to scroll there.
  if (rRect.top === 0 && rRect.height === 0 && rRect.width === 0) return;
  const el = scroller as HTMLElement;
  const {needsScroll, top} = computeRevealScroll({
    rangeTop: rRect.top,
    rangeHeight: rRect.height,
    scrollerTop: el.getBoundingClientRect().top,
    scrollTop: el.scrollTop,
    clientHeight: el.clientHeight,
  });
  if (!needsScroll) return;
  onBeforeScroll?.();
  const behavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth';
  if (typeof el.scrollTo === 'function') el.scrollTo({top, behavior});
  else el.scrollTop = top;
}

/**
 * ReaderInteractions — wires the shared toolbar controls to the reader DOM.
 *
 * Rendered only inside a ViewerProvider (Reader guards on the optional store),
 * so it may use the non-optional store hooks. It supplies the behaviours the PDF
 * engine gives canvas mode but that have no equivalent for the markdown reader:
 *   - find-in-document over the rendered markdown (highlight + count + scroll)
 *   - page nav: scroll to a page's reader section, and report the visible page
 *     back as the user scrolls (mirrors <Viewer.Body>'s two-way sync)
 * Renders nothing.
 */
function ReaderInteractions({
  rootRef,
  blocks,
}: {
  rootRef: RefObject<HTMLElement | null>;
  blocks: readonly ReaderTextBlock[];
}) {
  const storeApi = useViewerStoreApi();
  const mode = useViewerStore((s) => s.mode);
  const query = useViewerStore((s) => s.search.query);
  const caseSensitive = useViewerStore((s) => s.search.options.caseSensitive);
  const wholeWords = useViewerStore((s) => s.search.options.wholeWords);
  const activeIndex = useViewerStore((s) => s.search.activeIndex);
  const currentPage = useViewerStore((s) => s.currentPage);

  const rangesRef = useRef<Range[]>([]);
  const isProgrammaticScrollRef = useRef(false);
  const programmaticTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Find-in-document: recompute matches when the query, options, mode, or the
  // rendered blocks change. Highlights live in the CSS Custom Highlight registry
  // (no-op where unsupported); the count flows to the store so the shared search
  // bar shows "n / N".
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (mode !== 'reader' || !query.trim()) {
      rangesRef.current = [];
      clearReaderSearchHighlights();
      storeApi.getState().actions.setReaderMatchCount(0);
      return;
    }
    // Debounce the DOM scan (mirrors the canvas search) so typing doesn't run a
    // full TreeWalker + aria-live announcement on every keystroke.
    const timer = setTimeout(() => {
      const ranges = findReaderMatches(root, query, {caseSensitive, wholeWords});
      rangesRef.current = ranges;
      setReaderSearchHighlights(ranges, 0);
      const prevActive = storeApi.getState().search.activeIndex;
      storeApi.getState().actions.setReaderMatchCount(ranges.length); // sets activeIndex 0
      // Reveal the first hit. When prevActive was already 0 the active effect
      // won't re-fire (0 → 0), so reveal here; otherwise the active effect
      // (prev → 0) owns the reveal and we skip to avoid a double scroll.
      if (ranges.length > 0 && prevActive === 0) {
        revealRange(root.closest('[data-reader-scroll]'), ranges[0], () =>
          armScrollGuard(isProgrammaticScrollRef, programmaticTimerRef),
        );
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [rootRef, mode, query, caseSensitive, wholeWords, blocks, storeApi]);

  // Move the active highlight + reveal it as the user steps through matches
  // (next/prev). Re-anchors first if a re-render detached the stored Ranges
  // (defense-in-depth; React.memo on BlockBody prevents the common flash case).
  useEffect(() => {
    const root = rootRef.current;
    let ranges = rangesRef.current;
    if (root && ranges.length > 0 && !ranges[0].startContainer.isConnected) {
      const {query: q, options} = storeApi.getState().search;
      ranges = findReaderMatches(root, q, options);
      rangesRef.current = ranges;
    }
    if (activeIndex < 0 || activeIndex >= ranges.length) return;
    setReaderSearchHighlights(ranges, activeIndex);
    revealRange(root?.closest('[data-reader-scroll]') ?? null, ranges[activeIndex], () =>
      armScrollGuard(isProgrammaticScrollRef, programmaticTimerRef),
    );
  }, [activeIndex, rootRef, storeApi]);

  // Page nav (programmatic): currentPage → scroll the matching reader section.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const section = root.querySelector<HTMLElement>(`[data-reader-page="${currentPage}"]`);
    if (!section || typeof section.scrollIntoView !== 'function') return;
    armScrollGuard(isProgrammaticScrollRef, programmaticTimerRef);
    section.scrollIntoView({block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth'});
  }, [currentPage, rootRef]);

  // Page nav (inverse): report the section closest to the top as currentPage.
  useEffect(() => {
    const root = rootRef.current;
    const scroller = root?.closest('[data-reader-scroll]') ?? null;
    if (!root || !scroller) return;
    if (typeof IntersectionObserver === 'undefined') return; // jsdom / SSR safety

    const visible = new Map<number, IntersectionObserverEntry>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const page = parseInt((entry.target as HTMLElement).dataset.readerPage ?? '', 10);
          if (Number.isNaN(page)) continue;
          if (entry.isIntersecting) visible.set(page, entry);
          else visible.delete(page);
        }
        if (isProgrammaticScrollRef.current || visible.size === 0) return;
        let best = -1;
        let bestDistance = Infinity;
        for (const [page, entry] of visible) {
          const distance = Math.abs(entry.boundingClientRect.top);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = page;
          }
        }
        if (best > 0 && best !== storeApi.getState().currentPage) {
          storeApi.getState().actions.goToPage(best);
        }
      },
      {root: scroller, threshold: [0, 0.1, 0.5, 1], rootMargin: '0px 0px -50% 0px'},
    );
    root.querySelectorAll<HTMLElement>('[data-reader-page]').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [blocks, rootRef, storeApi]);

  // Clear search highlights + count on unmount (mode switch / document switch).
  useEffect(
    () => () => {
      clearReaderSearchHighlights();
      storeApi.getState().actions.setReaderMatchCount(0);
    },
    [storeApi],
  );

  return null;
}

function Reader({blocks, emptyState, loading, loadingState, className}: ReaderProps) {
  const storeApi = useViewerStoreApiOptional();
  const rootRef = useRef<HTMLElement>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Read `blocks` through a ref so the locate subscription stays mounted across
  // block-list changes (poll refetch / re-parse) instead of tearing down and
  // re-subscribing — an in-flight flash must survive an unrelated refetch.
  const blocksRef = useRef(blocks);
  useEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);

  useEffect(() => {
    if (!storeApi) return;
    const unsubscribe = subscribeReaderLocate(
      storeApi,
      (req) => {
        const root = rootRef.current;
        if (!root) return;

        const matchedId =
          findBlockByIndex(blocksRef.current, req.page, req.blockIds ?? []) ??
          findBlockForQuote(blocksRef.current, req.quote, req.page);
        let target: Element | null = matchedId
          ? root.querySelector(`[data-block-id="${cssEscape(matchedId)}"]`)
          : null;
        if (!target && req.page != null) {
          target = root.querySelector(`[data-reader-page="${req.page}"]`);
        }
        if (target && typeof (target as HTMLElement).scrollIntoView === 'function') {
          (target as HTMLElement).scrollIntoView({behavior: 'smooth', block: 'center'});
        }

        if (matchedId) {
          setFlashId(matchedId);
          if (flashTimer.current) clearTimeout(flashTimer.current);
          flashTimer.current = setTimeout(() => {
            setFlashId(null);
            clearCitationHighlight();
          }, FLASH_MS);
        }

        // P2: precise span highlight over the cited quote within the block —
        // a progressive enhancement over the block-flash. Unsupported browser
        // or quote-not-in-DOM → no-op (block-flash already happened).
        clearCitationHighlight();
        if (matchedId && target && req.quote) {
          const range = locateQuoteRange(target, req.quote);
          if (range) setCitationHighlight(range);
        }
      },
      {immediate: true},
    );

    return () => {
      unsubscribe();
      if (flashTimer.current) clearTimeout(flashTimer.current);
      clearCitationHighlight();
    };
  }, [storeApi]);

  if (loading) {
    return <>{loadingState ?? DEFAULT_LOADING}</>;
  }
  if (blocks.length === 0) {
    return <>{emptyState ?? DEFAULT_EMPTY}</>;
  }

  // Group blocks by page so we can render a per-page header.
  const byPage = new Map<number, ReaderTextBlock[]>();
  for (const b of blocks) {
    const list = byPage.get(b.pageNumber) ?? [];
    list.push(b);
    byPage.set(b.pageNumber, list);
  }
  const pages = [...byPage.keys()].sort((a, b) => a - b);

  return (
    <article
      ref={rootRef}
      data-pdf-viewer-reader=""
      className={cn('mx-auto max-w-2xl space-y-6 px-6 py-8', className)}
    >
      {storeApi && <ReaderInteractions rootRef={rootRef} blocks={blocks} />}
      {pages.map((page) => {
        const items = (byPage.get(page) ?? []).sort(
          (a, b) => a.blockIndex - b.blockIndex,
        );
        return (
          <section key={page} aria-label={`Page ${page}`} data-reader-page={page}>
            <header className="mb-3 select-none text-[10px] uppercase tracking-wider text-muted-foreground/70">
              Page {page}
            </header>
            <div className="space-y-1">
              {items.map((block) => (
                <div
                  key={block.id}
                  data-block-id={block.id}
                  data-block-type={block.blockType}
                  className={cn(
                    '-mx-2 scroll-mt-4 rounded-md px-2 py-0.5 transition-colors duration-700',
                    flashId === block.id && 'bg-primary/15 ring-1 ring-primary/50',
                  )}
                >
                  <BlockBody block={block} />
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </article>
  );
}

export {Reader};
