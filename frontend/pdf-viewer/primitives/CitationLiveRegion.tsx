/**
 * CitationLiveRegion — polite aria-live region that announces citation jumps.
 *
 * Subscribes to `activeCitationId` and the `citations` map in the viewer
 * store.  When a citation becomes active it emits a screen-reader-only
 * message: "Jumped to cited source on page N".
 *
 * Mount once inside a ViewerProvider (e.g. at the root of PrumoPdfViewer).
 * Both canvas and reader modes benefit — the announcement fires regardless
 * of the current viewer mode.
 *
 * React Compiler constraint: no try/finally, no throw inside try.
 */
import {useViewerStore} from '../core/context';
import {t} from '@/lib/copy';

export function CitationLiveRegion() {
  const activeCitationId = useViewerStore((s) => s.activeCitationId);
  const activeCitation = useViewerStore((s) =>
    s.activeCitationId != null ? s.citations.get(s.activeCitationId) : undefined,
  );

  let announcement = '';

  if (activeCitationId != null && activeCitation != null) {
    const {anchor} = activeCitation;
    const page =
      anchor.kind === 'region'
        ? anchor.page
        : anchor.range.page;

    announcement = t('extraction', 'citationJumpAnnouncement').replace(
      '{{n}}',
      String(page),
    );
  }

  return (
    <span
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    >
      {announcement}
    </span>
  );
}
