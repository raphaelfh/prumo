import {ZoomIn, ZoomOut} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {IconButton} from '@/components/patterns/IconButton';
import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';
import {useViewerStore} from '../core/context';
import {MAX_ZOOM, MIN_ZOOM, ZOOM_STEP} from '../viewport/zoomMath';

const PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function ZoomControls({className}: {className?: string}) {
  const zoom = useViewerStore((s) => s.zoom);
  const actions = useViewerStore((s) => s.actions);

  return (
    <div className={cn('flex items-center gap-0.5', className)}>
      <IconButton
        label={t('pdf', 'viewerZoomOut')}
        side="bottom"
        onClick={() => actions.zoomBy(1 / ZOOM_STEP)}
        disabled={zoom <= MIN_ZOOM}
        data-viewer-step=""
        icon={<ZoomOut strokeWidth={1.5} />}
      />
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="min-w-12 justify-center px-1.5 tabular-nums">
                {Math.round(zoom * 100)}%
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="px-2.5 py-1.5 text-[12px]">
            {t('pdf', 'viewerZoomLevel')}
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end">
          {PRESETS.map((p) => (
            <DropdownMenuItem key={p} onClick={() => actions.setZoom(p)} className="text-[13px] tabular-nums">
              {Math.round(p * 100)}%
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <IconButton
        label={t('pdf', 'viewerZoomIn')}
        side="bottom"
        onClick={() => actions.zoomBy(ZOOM_STEP)}
        disabled={zoom >= MAX_ZOOM}
        data-viewer-step=""
        icon={<ZoomIn strokeWidth={1.5} />}
      />
    </div>
  );
}
