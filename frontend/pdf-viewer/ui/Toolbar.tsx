import type {ReactNode} from 'react';
import {BookOpenText, ExternalLink, Menu, RotateCw, Search} from 'lucide-react';
import {IconButton} from '@/components/patterns/IconButton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';
import {useViewerStore, useViewerStoreApi} from '../core/context';
import {NavigationControls} from './NavigationControls';
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
  externalLink,
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
  /** A caller-owned link (e.g. the source article page) shown in the ☰ menu. */
  externalLink?: {label: string; href: string};
}) {
  const mode = useViewerStore((s) => s.mode);
  const storeApi = useViewerStoreApi();
  const isReader = mode === 'reader';
  const toggleMode = () => {
    storeApi.getState().actions.setMode(isReader ? 'canvas' : 'reader');
  };

  return (
    <div className={cn('@container/viewerbar border-b bg-background', className)}>
      <div className="grid min-h-10 grid-cols-[1fr_auto_1fr] items-center gap-2 px-2 [&_[data-viewer-step]]:hidden @[32rem]/viewerbar:[&_[data-viewer-step]]:inline-flex">
        <div className="flex items-center gap-0.5">
          {modeToggle && (
            <IconButton
              label={t('pdf', 'viewerReaderToggle')}
              tooltip={t('pdf', isReader ? 'viewerReaderHide' : 'viewerReaderShow')}
              hint={t('pdf', isReader ? 'viewerReaderHideHint' : 'viewerReaderShowHint')}
              side="bottom"
              onClick={toggleMode}
              aria-pressed={isReader}
              className="aria-pressed:bg-accent aria-pressed:text-accent-foreground"
              data-testid="viewer-mode-toggle"
              icon={<BookOpenText strokeWidth={1.5} />}
            />
          )}
          {leading}
          <NavigationControls className="ml-1.5" />
        </div>
        <div className="flex min-w-0 justify-center">{center}</div>
        <div className="flex items-center justify-end gap-0.5">
          {/* Zoom acts on the PDF canvas; the reader is typography, not a
              page surface, so it is hidden in reader mode. */}
          {!isReader && <ZoomControls />}
          {onSearchToggle && (
            <IconButton
              label={t('pdf', 'viewerSearch')}
              hint={t('pdf', 'viewerSearchHint')}
              side="bottom"
              onClick={onSearchToggle}
              icon={<Search strokeWidth={1.5} />}
            />
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                label={t('pdf', 'viewerMoreOptions')}
                side="bottom"
                icon={<Menu strokeWidth={1.5} />}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {!isReader && (
                <DropdownMenuItem onSelect={() => storeApi.getState().actions.rotateView()}>
                  <RotateCw strokeWidth={1.5} className="mr-2 size-4" />
                  {t('pdf', 'viewerRotateView')}
                </DropdownMenuItem>
              )}
              {externalLink && (
                <DropdownMenuItem asChild>
                  <a href={externalLink.href} target="_blank" rel="noopener noreferrer">
                    <ExternalLink strokeWidth={1.5} className="mr-2 size-4" />
                    {externalLink.label}
                  </a>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {trailing}
        </div>
      </div>
    </div>
  );
}
