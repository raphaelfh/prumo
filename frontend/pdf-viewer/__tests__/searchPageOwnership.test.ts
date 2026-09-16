/**
 * Search must not release the pages it reads.
 *
 * `getPage(n)` hands back a *shared, cached* page handle (pdf.js caches its
 * PDFPageProxy per index), and `cleanup()` on it discards that page's operator
 * list and font/image objects — for the page the canvas is displaying. Reading
 * text allocates none of that, so the searcher has nothing of its own to free:
 * the owner is `usePageHandle`, which cleans a page up when it unmounts.
 */
import {describe, expect, it} from 'vitest';
import {createMockEngine} from '../engines/mock';
import {getPageText, searchDocument} from '../services/searchService';

describe('search page ownership', () => {
  it('leaves the page handle alive after reading its text', async () => {
    const engine = createMockEngine({numPages: 3, text: ['alpha', 'beta', 'gamma']});
    const doc = await engine.load({kind: 'url', url: 'mock.pdf'});

    await getPageText(doc, 2);

    const page = (await doc.getPage(2)) as unknown as {isCleanedUp: boolean};
    expect(page.isCleanedUp).toBe(false);
  });

  it('leaves every page alive after a whole-document search', async () => {
    const engine = createMockEngine({numPages: 3, text: ['alpha', 'beta', 'gamma']});
    const doc = await engine.load({kind: 'url', url: 'mock.pdf'});

    await searchDocument(doc, 'a', {caseSensitive: false, wholeWords: false});

    for (const n of [1, 2, 3]) {
      const page = (await doc.getPage(n)) as unknown as {isCleanedUp: boolean};
      expect(page.isCleanedUp, `page ${n}`).toBe(false);
    }
  });
});
