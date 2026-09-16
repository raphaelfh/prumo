/**
 * The pdf.js adapter's item stream must stay index-aligned with the spans its
 * TextLayer paints, because search highlighting maps `sources[i].itemIndex`
 * straight onto `textDivs[i]`.
 *
 * pdf.js emits an item with `str: ''` when a line break arrives with no text
 * accumulated (`appendEOL` in the worker pushes `{str: '', hasEOL: true}`),
 * and its `TextLayer` creates a div for *every* item whose `str` is not
 * `undefined` — an empty one included, it merely marks it `hasText: false`.
 * Dropping empty items in the adapter would therefore shift every later index
 * against the DOM, and highlights would land on the wrong line.
 *
 * The proxy is stubbed rather than driven from a real PDF: the uninitialized
 * `appendEOL` branch is not reachable from ordinary content-stream operators,
 * so a fixture cannot exercise this, and a stub pins the contract exactly.
 */
import type {PDFPageProxy} from 'pdfjs-dist';
import {describe, expect, it} from 'vitest';

import {PdfJsPageHandle} from '../engines/pdfjs/page';

const item = (str: string, hasEOL = false) => ({
  str,
  hasEOL,
  transform: [1, 0, 0, 1, 10, 20],
  width: str.length * 6,
  height: 12,
  fontName: 'g_d0_f1',
  dir: 'ltr',
});

function handleFor(items: unknown[]): PdfJsPageHandle {
  const proxy = {
    getTextContent: async (opts: {disableNormalization?: boolean}) => {
      // Guards the precondition: normalization must stay off, or `str` is
      // rewritten and the offset map no longer matches the painted spans.
      expect(opts.disableNormalization).toBe(true);
      return {items, styles: {}};
    },
  } as unknown as PDFPageProxy;
  return new PdfJsPageHandle(proxy, 1);
}

describe('pdf.js adapter text items', () => {
  it('keeps an empty item, so later indices stay aligned with textDivs', async () => {
    const {items} = await handleFor([
      item('first line', true),
      item('', true), // the EOL-with-no-text item
      item('third line'),
    ]).getTextContent();

    expect(items).toHaveLength(3);
    expect(items[1].text).toBe('');
    // The one that matters: 'third line' must still be at index 2.
    expect(items[2].text).toBe('third line');
  });

  it('drops marked-content entries, exactly as the TextLayer does', async () => {
    const {items} = await handleFor([
      {type: 'beginMarkedContent', id: 'mc0'},
      item('inside'),
      {type: 'endMarkedContent'},
    ]).getTextContent();

    expect(items).toHaveLength(1);
    expect(items[0].text).toBe('inside');
  });

  it('carries hasEOL through, since page text rebuilds line breaks from it', async () => {
    const {items} = await handleFor([item('ends a line', true), item('does not')]).getTextContent();
    expect(items.map((i) => i.hasEOL)).toEqual([true, false]);
  });
});
