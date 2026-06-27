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
import {useEffect, useRef, useState, type ReactNode} from 'react';

import {cn} from '@/lib/utils';
import {useViewerStoreApiOptional} from '../core/context';
import {subscribeReaderLocate} from '../core/subscribeReaderLocate';
import {MarkdownContent} from '../markdown/MarkdownContent';
import {findBlockByIndex, findBlockForQuote} from './readerLocate';
import './reader.css';
import {
  clearCitationHighlight,
  locateQuoteRange,
  setCitationHighlight,
} from './spanHighlight';

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

/** Render one block's body, choosing markdown vs. plain de-emphasised text by type. */
function BlockBody({block}: {block: ReaderTextBlock}) {
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
