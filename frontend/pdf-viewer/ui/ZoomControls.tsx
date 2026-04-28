import {ZoomIn, ZoomOut} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {useViewerStore} from '../core/context';

const PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function ZoomControls({className}: {className?: string}) {
  const scale = useViewerStore((s) => s.scale);
  const setScale = useViewerStore((s) => s.actions.setScale);

  return (
    <div className={`flex items-center gap-1 ${className ?? ''}`}>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setScale(Math.max(0.25, scale - 0.25))}
        disabled={scale <= 0.25}
        aria-label="Zoom out"
        className="h-8 w-8"
      >
        <ZoomOut className="h-4 w-4" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 min-w-[60px] justify-center"
          >
            {Math.round(scale * 100)}%
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {PRESETS.map((p) => (
            <DropdownMenuItem key={p} onClick={() => setScale(p)}>
              {Math.round(p * 100)}%
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setScale(Math.min(4, scale + 0.25))}
        disabled={scale >= 4}
        aria-label="Zoom in"
        className="h-8 w-8"
      >
        <ZoomIn className="h-4 w-4" />
      </Button>
    </div>
  );
}
