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
 * A11y:
 *   - The active box is focusable (`tabIndex=-1`) and labelled so screen
 *     readers can inspect it after the CitationLiveRegion announcement.
 *   - `aria-hidden` is NOT set — a focusable element must never be
 *     aria-hidden (WCAG 4.1.2 violation).
 *   - A `useEffect` moves focus to the box on activation so keyboard users
 *     land in the right place immediately after the jump.
 *
 * React Compiler constraint: no try/finally, no throw inside try.
 */
import {useEffect, useRef} from 'react';
import {useViewerStore} from '../core/context';
import {usePageHandle} from '../hooks/usePageHandle';
import {projectPdfRectToCss} from '../core/coordinates';
import type {RegionCitationAnchor, HybridCitationAnchor} from '../core/citation';
import {t} from '@/lib/copy';

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
  const boxRef = useRef<HTMLDivElement>(null);

  // Derive whether the overlay should be shown for this page.
  // Text-only anchors are rendered by TextLayer — skip here.
  const anchor = citation?.anchor;
  const isRegionOrHybrid =
    anchor != null && anchor.kind !== 'text';

  const anchorPage =
    isRegionOrHybrid
      ? anchor!.kind === 'region'
        ? (anchor as RegionCitationAnchor).page
        : (anchor as HybridCitationAnchor).range.page
      : null;

  const isActiveOnThisPage =
    mode === 'canvas' &&
    activeCitationId != null &&
    isRegionOrHybrid &&
    anchorPage === pageNumber &&
    pageHandle != null;

  // Move focus to the overlay box when it becomes the active highlight.
  // useEffect is allowed by React Compiler all_errors — no try/finally.
  useEffect(() => {
    if (isActiveOnThisPage && boxRef.current) {
      // preventScroll: the Viewer runs its own programmatic smooth-scroll to
      // the citation; the default focus-scroll would fight it.
      boxRef.current.focus({preventScroll: true});
    }
  }, [isActiveOnThisPage, activeCitationId]);

  if (!isActiveOnThisPage) return null;

  // anchor is region or hybrid at this point — both have a top-level `rect`.
  const rect =
    anchor!.kind === 'region'
      ? (anchor as RegionCitationAnchor).rect
      : (anchor as HybridCitationAnchor).rect;

  const {left, top, width, height} = projectPdfRectToCss(
    rect,
    pageHandle!.size.height,
    scale,
  );

  return (
    <div
      ref={boxRef}
      tabIndex={-1}
      aria-label={t('extraction', 'citationHighlightLabel')}
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
