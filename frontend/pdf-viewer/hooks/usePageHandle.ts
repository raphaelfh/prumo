import {useEffect, useState} from 'react';
import {useStore} from 'zustand';
import {useViewerStoreApiOptional} from '../core/context';
import {createViewerStore} from '../core/store';
import type {PDFPageHandle} from '../core/engine';

// Fallback store for the case where usePageHandle renders OUTSIDE a
// ViewerProvider. Its `document` is null, so the hook returns null instead of
// throwing. Module-level + read-only: shared and never mutated.
const NO_PROVIDER_STORE = createViewerStore();

export function usePageHandle(pageNumber: number): PDFPageHandle | null {
  // Subscribe through the optional store API so the hook degrades gracefully
  // outside a ViewerProvider rather than throwing. In-provider behaviour is
  // unchanged: the real store is used whenever a provider is present.
  const storeApi = useViewerStoreApiOptional();
  const document = useStore(storeApi ?? NO_PROVIDER_STORE, (s) => s.document);
  const [handle, setHandle] = useState<PDFPageHandle | null>(null);

  // Drop the stale handle as soon as the document/page changes (during render,
  // so the effect never needs a synchronous setState for the invalid case).
  const [prevKey, setPrevKey] = useState({document, pageNumber});
  if (prevKey.document !== document || prevKey.pageNumber !== pageNumber) {
    setPrevKey({document, pageNumber});
    setHandle(null);
  }

  useEffect(() => {
    if (!document || pageNumber < 1 || pageNumber > document.numPages) {
      return;
    }
    let active = true;
    let h: PDFPageHandle | null = null;
    document.getPage(pageNumber).then((page) => {
      if (!active) {
        page.cleanup();
        return;
      }
      h = page;
      setHandle(page);
    });
    return () => {
      active = false;
      h?.cleanup();
      setHandle(null);
    };
  }, [document, pageNumber]);

  return handle;
}
