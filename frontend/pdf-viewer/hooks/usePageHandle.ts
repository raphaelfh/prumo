import {useEffect, useState} from 'react';
import {useViewerStore} from '../core/context';
import type {PDFPageHandle} from '../core/engine';

export function usePageHandle(pageNumber: number): PDFPageHandle | null {
  const document = useViewerStore((s) => s.document);
  const [handle, setHandle] = useState<PDFPageHandle | null>(null);

  useEffect(() => {
    if (!document || pageNumber < 1 || pageNumber > document.numPages) {
      setHandle(null);
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
