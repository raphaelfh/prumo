import {StretchHorizontal, ZoomIn, ZoomOut} from 'lucide-react';
import {IconButton} from '@/components/patterns/IconButton';
import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';
import {useViewerStore} from '../core/context';
import {MAX_ZOOM, MIN_ZOOM, ZOOM_STEP} from '../viewport/zoomMath';

export function ZoomControls({className}: {className?: string}) {
  const zoom = useViewerStore((s) => s.zoom);
  const fitWidth = useViewerStore((s) => s.fitWidth);
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
      <IconButton
        label={t('pdf', 'viewerFitWidth')}
        side="bottom"
        aria-pressed={fitWidth}
        onClick={() => actions.setZoom(zoom, {fitWidth: true})}
        icon={<StretchHorizontal strokeWidth={1.5} />}
      />
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
