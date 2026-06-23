/**
 * useReaderLocate — markdown-first citation locating.
 *
 * Returns a `locate(quote, page)` that switches the shared PDF viewer to reader
 * (markdown) mode and asks it to scroll to + flash the block containing the
 * cited text. This replaces the fragile PDF-bbox jump for AI evidence: the
 * reader matches on text, which is far more robust than projected coordinates.
 *
 * Safe outside a ViewerProvider: `isAvailable` is false and `locate` is a no-op.
 */
import {useCallback} from 'react';

import {useViewerStoreApiOptional} from '@/pdf-viewer/core/context';

export interface UseReaderLocateReturn {
  /** Switch to reader mode and locate `quote` (optionally page-hinted). */
  locate: (quote: string, page?: number | null) => void;
  /** True when a viewer store is present and `locate` will do something. */
  isAvailable: boolean;
}

export function useReaderLocate(): UseReaderLocateReturn {
  const storeApi = useViewerStoreApiOptional();

  const locate = useCallback(
    (quote: string, page?: number | null) => {
      storeApi?.getState().actions.locateInReader(quote, page ?? null);
    },
    [storeApi],
  );

  return {locate, isAvailable: storeApi != null};
}
