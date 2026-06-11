import {useEffect, useState} from 'react';
import {useViewerStore} from '../core/context';
import type {PDFPageHandle} from '../core/engine';

export function usePageHandle(pageNumber: number): PDFPageHandle | null {
  const document = useViewerStore((s) => s.document);
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
