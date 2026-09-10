import {ZoomIn, ZoomOut} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';
import {useViewerStore} from '../core/context';
import {ToolbarIconButton} from './ToolbarIconButton';

const PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function ZoomControls({className}: {className?: string}) {
  const scale = useViewerStore((s) => s.scale);
  const setScale = useViewerStore((s) => s.actions.setScale);

  return (
    <div className={cn('flex items-center gap-0.5', className)}>
      <ToolbarIconButton
        label={t('pdf', 'viewerZoomOut')}
        onClick={() => setScale(Math.max(0.25, scale - 0.25))}
        disabled={scale <= 0.25}
        data-viewer-step=""
      >
        <ZoomOut strokeWidth={1.5} />
      </ToolbarIconButton>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="min-w-12 justify-center px-1.5 tabular-nums">
                {Math.round(scale * 100)}%
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="px-2.5 py-1.5 text-[12px]">
            {t('pdf', 'viewerZoomLevel')}
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end">
          {PRESETS.map((p) => (
            <DropdownMenuItem key={p} onClick={() => setScale(p)} className="text-[13px] tabular-nums">
              {Math.round(p * 100)}%
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <ToolbarIconButton
        label={t('pdf', 'viewerZoomIn')}
        onClick={() => setScale(Math.min(4, scale + 0.25))}
        disabled={scale >= 4}
        data-viewer-step=""
      >
        <ZoomIn strokeWidth={1.5} />
      </ToolbarIconButton>
    </div>
  );
}
