import {useEffect, useRef, useState} from 'react';
import {Viewer} from './primitives/Viewer';
import {CanvasLayer} from './primitives/CanvasLayer';
import {TextLayer} from './primitives/TextLayer';
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
}: PrumoPdfViewerProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Cmd/Ctrl+F: open the search bar and prevent the browser's native find.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'f' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    root.addEventListener('keydown', handleKeyDown);
    return () => root.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div ref={rootRef} className={`flex flex-col h-full ${className ?? ''}`} tabIndex={-1}>
      <Viewer.Root source={source} className="flex flex-col flex-1 min-h-0">
        {toolbar && <Toolbar onSearchToggle={() => setSearchOpen((v) => !v)} />}
        <SearchBar open={searchOpen} onClose={() => setSearchOpen(false)} />
        <ViewerContent />
      </Viewer.Root>
    </div>
  );
}

function ViewerContent() {
  const status = useViewerStore((s) => s.loadStatus);
  const error = useViewerStore((s) => s.error);

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
