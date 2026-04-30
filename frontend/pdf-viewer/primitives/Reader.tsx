/**
 * <Viewer.Reader> — typography-first rendering of an article's text blocks.
 *
 * Active when `state.mode === 'reader'`. Consumers feed in the blocks
 * (typically via `useArticleTextBlocks`); this component owns the visual
 * layout — page-grouped, semantically-tagged paragraphs / headings /
 * captions — and an EmptyState when the upstream ingestion pipeline
 * (Phase 6) hasn't populated `article_text_blocks` yet.
 */
import type {ReactNode} from 'react';

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

function blockClass(type: ReaderTextBlock['blockType']): string {
  switch (type) {
    case 'heading':
      return 'text-xl font-semibold text-foreground';
    case 'list_item':
      return 'pl-4 -indent-4 text-foreground';
    case 'figure_caption':
      return 'text-xs italic text-muted-foreground';
    case 'header':
    case 'footer':
      return 'text-xs text-muted-foreground/60';
    case 'table_cell':
      return 'font-mono text-sm text-foreground';
    case 'paragraph':
    default:
      return 'text-base text-foreground';
  }
}

function Reader({blocks, emptyState, loading, loadingState, className}: ReaderProps) {
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
      data-pdf-viewer-reader=""
      className={`mx-auto max-w-2xl space-y-6 px-6 py-8 leading-relaxed ${className ?? ''}`}
    >
      {pages.map((page) => {
        const items = byPage.get(page) ?? [];
        return (
          <section key={page} aria-label={`Page ${page}`} data-reader-page={page}>
            <header className="mb-2 select-none text-[10px] uppercase tracking-wider text-muted-foreground/70">
              Page {page}
            </header>
            <div className="space-y-3">
              {items.map((block) => (
                <p
                  key={block.id}
                  data-block-id={block.id}
                  data-block-type={block.blockType}
                  className={blockClass(block.blockType)}
                >
                  {block.text}
                </p>
              ))}
            </div>
          </section>
        );
      })}
    </article>
  );
}

export {Reader};
