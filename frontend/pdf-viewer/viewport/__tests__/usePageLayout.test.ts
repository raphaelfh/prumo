import {describe, expect, it} from 'vitest';
import {PAGE_GAP, createPageLayout} from '../usePageLayout';

const letter = {width: 612, height: 792};
const landscape = {width: 792, height: 612};

describe('createPageLayout', () => {
  it('stacks pages with a gap above, between and below', () => {
    const layout = createPageLayout({numPages: 3, pageSizes: {1: letter}, viewRotation: 0, zoom: 1});
    expect(layout.offsetOf(1)).toBe(PAGE_GAP);
    expect(layout.offsetOf(2)).toBe(PAGE_GAP + 792 + PAGE_GAP);
    expect(layout.totalHeight).toBe(PAGE_GAP + 3 * (792 + PAGE_GAP));
  });

  it('estimates unknown pages from page 1 and uses a size once it is known', () => {
    const estimated = createPageLayout({numPages: 3, pageSizes: {1: letter}, viewRotation: 0, zoom: 1});
    const known = createPageLayout({numPages: 3, pageSizes: {1: letter, 2: landscape}, viewRotation: 0, zoom: 1});
    expect(estimated.sizeOf(2)).toEqual(letter);
    expect(known.sizeOf(2)).toEqual(landscape);
    expect(known.offsetOf(3) - estimated.offsetOf(3)).toBe(612 - 792);
  });

  it('turns every page for a quarter view rotation', () => {
    const layout = createPageLayout({numPages: 2, pageSizes: {1: letter, 2: landscape}, viewRotation: 90, zoom: 1});
    expect(layout.sizeOf(1)).toEqual(landscape);
    expect(layout.sizeOf(2)).toEqual(letter);
  });

  it('scales sizes, offsets, gaps and width with zoom', () => {
    const input = {numPages: 3, pageSizes: {1: letter, 3: landscape}, viewRotation: 0 as const};
    const one = createPageLayout({...input, zoom: 1});
    const two = createPageLayout({...input, zoom: 2});
    for (const page of [1, 2, 3]) expect(two.offsetOf(page)).toBe(one.offsetOf(page) * 2);
    expect(two.totalHeight).toBe(one.totalHeight * 2);
    expect(two.gap).toBe(PAGE_GAP * 2);
    expect(two.width).toBe(one.width * 2);
  });

  it('measures the content width from the widest page', () => {
    const layout = createPageLayout({numPages: 2, pageSizes: {1: letter, 2: landscape}, viewRotation: 0, zoom: 1.5});
    expect(layout.naturalWidth).toBe(792 + 2 * PAGE_GAP);
    expect(layout.width).toBe((792 + 2 * PAGE_GAP) * 1.5);
  });

  describe('pageAt', () => {
    const VIEWPORT = 725;

    it('round-trips offsetOf for every page', () => {
      const layout = createPageLayout({numPages: 14, pageSizes: {1: {width: 595, height: 842}}, viewRotation: 0, zoom: 1});
      for (let page = 1; page <= 14; page++) expect(layout.pageAt(layout.offsetOf(page), VIEWPORT)).toBe(page);
    });

    it('round-trips with mixed sizes, a rotated view and a zoom', () => {
      const layout = createPageLayout({numPages: 5, pageSizes: {1: letter, 2: landscape, 4: landscape}, viewRotation: 270, zoom: 1.75});
      for (let page = 1; page <= 5; page++) expect(layout.pageAt(layout.offsetOf(page), VIEWPORT)).toBe(page);
    });

    it('picks the page whose top is nearest the top edge within the upper half', () => {
      const layout = createPageLayout({numPages: 14, pageSizes: {1: {width: 595, height: 842}}, viewRotation: 0, zoom: 1});
      // Page 3's top 300px below the edge beats page 2's top 558px above it.
      expect(layout.pageAt(layout.offsetOf(3) - 300, VIEWPORT)).toBe(3);
      // Halfway down page 2, page 3's top is below the upper half.
      expect(layout.pageAt(layout.offsetOf(2) + 421, VIEWPORT)).toBe(2);
    });
  });
});
