import {useEffect, useRef, useState} from 'react';
import {Viewer} from './primitives/Viewer';
import {CanvasLayer} from './primitives/CanvasLayer';
import {TextLayer} from './primitives/TextLayer';
import {Reader, type ReaderTextBlock} from './primitives/Reader';
import {Toolbar} from './ui/Toolbar';
import {SearchBar} from './ui/SearchBar';
import {LoadingState} from './ui/LoadingState';
import {ErrorState} from './ui/ErrorState';
import {useViewerStore} from './core/context';
import type {PDFSource} from './core/source';

export interface PrumoPdfViewerProps {
  source: PDFSource | null;
  className?: string;
  /** Show the built-in toolbar. Defaults to true. */
  toolbar?: boolean;
  /**
   * Reader-view content. When provided AND the user toggles the viewer to
   * `mode === 'reader'`, the canvas surface is hidden and these blocks are
   * rendered instead. Pass `[]` while the upstream fetch is in flight (along
   * with `readerLoading={true}`) so the viewer renders the loading state.
   */
  readerBlocks?: readonly ReaderTextBlock[];
  readerLoading?: boolean;
}

/**
 * High-level all-in-one PDF viewer component.
 *
 * Handles the common case: mount, load, render, continuous scroll, prev/next,
 * zoom, text selection, and search. For advanced use-cases (custom toolbars,
 * thumbnails, custom search) use the compound primitives from `./primitives`
 * directly.
 */
export function PrumoPdfViewer({
  source,
  className,
  toolbar = true,
  readerBlocks,
  readerLoading,
}: PrumoPdfViewerProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Cmd/Ctrl+F: open the search bar and prevent the browser's native find.
  // The listener is on `window`, gated by `rootRef.current` being mounted
  // and visible — that way the shortcut still works when focus is on a
  // sibling form panel (which it almost always is on the QA + Extraction
  // pages) without us having to sweep focus into the viewer first.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'f' || !(e.metaKey || e.ctrlKey)) return;
      const root = rootRef.current;
      if (!root || !root.isConnected || root.offsetParent === null) return;
      e.preventDefault();
      setSearchOpen(true);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div ref={rootRef} className={`flex flex-col h-full ${className ?? ''}`} tabIndex={-1}>
      <Viewer.Root source={source} className="flex flex-col flex-1 min-h-0">
        {toolbar && <Toolbar onSearchToggle={() => setSearchOpen((v) => !v)} />}
        <SearchBar open={searchOpen} onClose={() => setSearchOpen(false)} />
        <ViewerContent
          readerBlocks={readerBlocks}
          readerLoading={readerLoading}
        />
      </Viewer.Root>
    </div>
  );
}

function ViewerContent({
  readerBlocks,
  readerLoading,
}: {
  readerBlocks?: readonly ReaderTextBlock[];
  readerLoading?: boolean;
}) {
  const status = useViewerStore((s) => s.loadStatus);
  const error = useViewerStore((s) => s.error);
  const mode = useViewerStore((s) => s.mode);

  // Reader view is decoupled from the engine load lifecycle — it renders
  // structured text from the API even when the canvas hasn't finished
  // loading yet (or fails).
  if (mode === 'reader') {
    return (
      <div className="flex-1 overflow-auto bg-muted/30">
        <Reader blocks={readerBlocks ?? []} loading={readerLoading} />
      </div>
    );
  }

  if (status === 'idle') {
    return <div className="flex-1" />;
  }
  if (status === 'loading') {
    return (
      <div className="flex-1">
        <LoadingState />
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="flex-1">
        <ErrorState error={error ?? new Error('Unknown error')} />
      </div>
    );
  }

  return (
    <Viewer.Body className="flex-1 bg-muted/30">
      <Viewer.Pages>
        {(page) => (
          <Viewer.Page pageNumber={page.number}>
            <CanvasLayer pageNumber={page.number} />
            <TextLayer pageNumber={page.number} />
          </Viewer.Page>
        )}
      </Viewer.Pages>
    </Viewer.Body>
  );
}
