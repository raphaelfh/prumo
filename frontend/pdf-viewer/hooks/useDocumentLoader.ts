import {useEffect} from 'react';
import {pdfJsEngine} from '../engines/pdfjs';
import {useViewerStoreApi} from '../core/context';
import type {PDFSource} from '../core/source';
import type {PDFEngine} from '../core/engine';

export interface UseDocumentLoaderOptions {
  source: PDFSource | null;
  engine?: PDFEngine; // defaults to pdfJsEngine
}

export function useDocumentLoader({source, engine = pdfJsEngine}: UseDocumentLoaderOptions): void {
  const storeApi = useViewerStoreApi();

  useEffect(() => {
    if (!source) {
      storeApi.getState().actions.setSource(null);
      return;
    }

    let cancelled = false;
    const {actions} = storeApi.getState();
    actions.setSource(source);
    actions.setLoadStatus('loading');

    engine
      .load(source)
      .then((doc) =>
        // Page 1's size is the layout's estimate for every page not yet
        // mounted, so it is known before the pages render. A failure here
        // must still destroy the document, not just the load promise.
        doc
          .getPage(1)
          .then((first) => {
            const size = first.size;
            first.cleanup();
            if (cancelled) {
              doc.destroy();
              return;
            }
            actions.setDocument(doc);
            actions.setPageSize(1, size);
            actions.setLoadStatus('ready');
          })
          .catch((err: unknown) => {
            doc.destroy();
            throw err;
          }),
      )
      .catch((err: unknown) => {
        if (cancelled) return;
        const error = err instanceof Error ? err : new Error(String(err));
        actions.setLoadStatus('error', error);
      });

    return () => {
      cancelled = true;
      // The current document will be destroyed on next setDocument call or on
      // ViewerProvider unmount via reset()
    };
  }, [source, engine, storeApi]);
}
