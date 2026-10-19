/**
 * The document reader beside a run's form: ONE stable viewer store shared by
 * the PDF panel and the form panel (so an evidence popover and the reader
 * resolve the SAME store — the prerequisite for click-evidence → highlight),
 * and the panel's open/expanded state.
 *
 * Held by the page, above its loading gates, so paging to the next article
 * keeps the reader where the reviewer left it.
 */

import { useEffect, useRef, useState } from 'react';

import { useIsBelowDesktop, useIsNarrow } from '@/hooks/use-mobile';
import { usePdfPanel } from '@/hooks/usePdfPanel';
import { createViewerStore, subscribeReaderLocate } from '@prumo/pdf-viewer';

/**
 * @param opensByDefault Whether the reader opens on entry: null while that is
 *   not yet known (run or permissions loading); applied once, on desktop only.
 */
export function useRunReader(opensByDefault: boolean | null) {
  // Lazy initializer: one store per mount.
  const [viewerStore] = useState(createViewerStore);
  const pdf = usePdfPanel({ initialOpen: false, compact: useIsNarrow() });
  const belowDesktop = useIsBelowDesktop();

  // `pdf.open`/`pdf.close` are fresh closures each render; refs let the
  // subscriptions below register once.
  const openRef = useRef(pdf.open);
  const closeRef = useRef(pdf.close);
  useEffect(() => {
    openRef.current = pdf.open;
    closeRef.current = pdf.close;
  }, [pdf.open, pdf.close]);

  // Below desktop there is no room for a split: the reader closes.
  useEffect(() => {
    if (belowDesktop) closeRef.current();
  }, [belowDesktop]);

  // A citation-locate (an AI-suggestion popover) reveals a collapsed reader so
  // it can scroll to and flash the cited passage.
  useEffect(() => subscribeReaderLocate(viewerStore, () => openRef.current()), [viewerStore]);

  const defaultApplied = useRef(false);
  useEffect(() => {
    if (opensByDefault === null || defaultApplied.current) return;
    defaultApplied.current = true;
    if (opensByDefault && !belowDesktop) openRef.current();
  }, [opensByDefault, belowDesktop]);

  return { viewerStore, pdf };
}

export type RunReader = ReturnType<typeof useRunReader>;
