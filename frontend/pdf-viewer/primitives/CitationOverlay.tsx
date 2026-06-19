/**
 * CitationOverlay — renders a single region/hybrid citation highlight box
 * as a `position:absolute` child of the Viewer.Page div.
 *
 * Only renders in `canvas` mode: in `reader` mode there is no canvas surface
 * and the region coordinates are meaningless in the DOM flow.
 *
 * Text-only anchors are handled by TextLayer search highlights; this component
 * renders nothing for them.
 *
 * React Compiler constraint: no try/finally, no throw inside try.
 */
import {useViewerStore} from '../core/context';
import {usePageHandle} from '../hooks/usePageHandle';
import {projectPdfRectToCss} from '../core/coordinates';

export interface CitationOverlayProps {
  pageNumber: number;
}

export function CitationOverlay({pageNumber}: CitationOverlayProps) {
  const mode = useViewerStore((s) => s.mode);
  const scale = useViewerStore((s) => s.scale);
  const activeCitationId = useViewerStore((s) => s.activeCitationId);
  const citation = useViewerStore((s) =>
    s.activeCitationId != null ? s.citations.get(s.activeCitationId) : undefined,
  );

  const pageHandle = usePageHandle(pageNumber);

  // Only render in canvas mode.
  if (mode !== 'canvas') return null;

  // No active citation or citation not yet in the map.
  if (activeCitationId == null || citation == null) return null;

  const {anchor} = citation;

  // Text-only anchors are rendered by TextLayer — skip here.
  if (anchor.kind === 'text') return null;

  // Only render on the correct page.
  const anchorPage = anchor.kind === 'region' ? anchor.page : anchor.range.page;
  if (anchorPage !== pageNumber) return null;

  // Need the page handle to know the page height in PDF points.
  if (pageHandle == null) return null;

  const {left, top, width, height} = projectPdfRectToCss(
    anchor.rect,
    pageHandle.size.height,
    scale,
  );

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        left,
        top,
        width,
        height,
        pointerEvents: 'none',
        // Subtle ring + translucent fill so the underlying content stays readable.
        backgroundColor: 'rgba(250, 204, 21, 0.25)',
        outline: '2px solid rgba(234, 179, 8, 0.8)',
        borderRadius: '2px',
        boxSizing: 'border-box',
      }}
    />
  );
}
