import {Viewer} from './primitives/Viewer';
import {CanvasLayer} from './primitives/CanvasLayer';
import {Toolbar} from './ui/Toolbar';
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
 * zoom. For advanced use-cases (custom toolbars, thumbnails, search) use the
 * compound primitives from `./primitives` directly.
 */
export function PrumoPdfViewer({
  source,
  className,
  toolbar = true,
}: PrumoPdfViewerProps) {
  return (
    <Viewer.Root source={source} className={`flex flex-col h-full ${className ?? ''}`}>
      {toolbar && <Toolbar />}
      <ViewerContent />
    </Viewer.Root>
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
          </Viewer.Page>
        )}
      </Viewer.Pages>
    </Viewer.Body>
  );
}
