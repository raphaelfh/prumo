import type {ReactNode} from 'react';
import {BookOpenText, Search} from 'lucide-react';
import {TooltipProvider} from '@/components/ui/tooltip';
import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';
import {useViewerStore, useViewerStoreApi} from '../core/context';
import {NavigationControls} from './NavigationControls';
import {ToolbarIconButton} from './ToolbarIconButton';
import {ZoomControls} from './ZoomControls';

/**
 * The viewer's single bar: view mode + page navigation on the left, a
 * caller-owned `center` (the document switcher) in the middle, zoom + search
 * on the right. Below 32rem of its own width the step buttons (prev/next page,
 * zoom ±) fold away — the page input and zoom-level menu stay.
 */
export function Toolbar({
  className,
  leading,
  center,
  trailing,
  onSearchToggle,
  modeToggle = true,
}: {
  className?: string;
  /** Rendered right after the mode toggle (e.g. a parse-status control). */
  leading?: ReactNode;
  /** Rendered centred in the bar (e.g. a document switcher). */
  center?: ReactNode;
  trailing?: ReactNode;
  /** When provided, renders a search button in the trailing controls. */
  onSearchToggle?: () => void;
  /** Show the original/parsed-text mode toggle in the leading controls. */
  modeToggle?: boolean;
}) {
  const mode = useViewerStore((s) => s.mode);
  const storeApi = useViewerStoreApi();
  const isReader = mode === 'reader';
  const toggleMode = () => {
    storeApi.getState().actions.setMode(isReader ? 'canvas' : 'reader');
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className={cn('@container/viewerbar border-b bg-background', className)}>
        <div className="grid min-h-10 grid-cols-[1fr_auto_1fr] items-center gap-2 px-2 [&_[data-viewer-step]]:hidden @[32rem]/viewerbar:[&_[data-viewer-step]]:inline-flex">
          <div className="flex items-center gap-0.5">
            {modeToggle && (
              <ToolbarIconButton
                label={t('pdf', 'viewerReaderToggle')}
                tooltip={t('pdf', isReader ? 'viewerReaderHide' : 'viewerReaderShow')}
                hint={t('pdf', isReader ? 'viewerReaderHideHint' : 'viewerReaderShowHint')}
                onClick={toggleMode}
                aria-pressed={isReader}
                className="aria-pressed:bg-accent aria-pressed:text-accent-foreground"
                data-testid="viewer-mode-toggle"
              >
                <BookOpenText strokeWidth={1.5} />
              </ToolbarIconButton>
            )}
            {leading}
            <NavigationControls className="ml-1.5" />
          </div>
          <div className="flex min-w-0 justify-center">{center}</div>
          <div className="flex items-center justify-end gap-0.5">
            {/* Zoom scales the PDF canvas; the reader is typography, not a page
                surface, so there's nothing to zoom there — hide it in reader mode. */}
            {!isReader && <ZoomControls />}
            {onSearchToggle && (
              <ToolbarIconButton
                label={t('pdf', 'viewerSearch')}
                hint={t('pdf', 'viewerSearchHint')}
                onClick={onSearchToggle}
              >
                <Search strokeWidth={1.5} />
              </ToolbarIconButton>
            )}
            {trailing}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
