import type {ReactNode} from 'react';
import {BookOpenText, FileImage, Search} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {useViewerStore, useViewerStoreApi} from '../core/context';
import {NavigationControls} from './NavigationControls';
import {ZoomControls} from './ZoomControls';

export function Toolbar({
  className,
  leading,
  trailing,
  onSearchToggle,
  modeToggle = true,
}: {
  className?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** When provided, renders a search button in the trailing controls. */
  onSearchToggle?: () => void;
  /** Show a canvas/reader mode toggle in the leading controls. */
  modeToggle?: boolean;
}) {
  const mode = useViewerStore((s) => s.mode);
  const storeApi = useViewerStoreApi();
  const isReader = mode === 'reader';
  const toggleMode = () => {
    storeApi.getState().actions.setMode(isReader ? 'canvas' : 'reader');
  };

  return (
    <div
      className={`flex items-center justify-between gap-2 px-3 py-2 border-b bg-background ${className ?? ''}`}
    >
      <div className="flex items-center gap-3">
        {leading}
        {modeToggle && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={toggleMode}
            aria-pressed={isReader}
            aria-label={
              isReader ? 'Switch to page view' : 'Switch to reader view'
            }
            data-testid="viewer-mode-toggle"
          >
            {isReader ? (
              <FileImage className="h-4 w-4" />
            ) : (
              <BookOpenText className="h-4 w-4" />
            )}
          </Button>
        )}
        <NavigationControls />
      </div>
      <div className="flex items-center gap-3">
        <ZoomControls />
        {onSearchToggle && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onSearchToggle}
            aria-label="Toggle search"
          >
            <Search className="h-4 w-4" />
          </Button>
        )}
        {trailing}
      </div>
    </div>
  );
}
