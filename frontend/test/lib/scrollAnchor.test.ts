import {describe, expect, it} from 'vitest';
import {withPinnedTop} from '@/lib/extraction/scrollAnchor';

/**
 * jsdom has no layout, so every rect is zero — the measurements are stubbed
 * per element. What is under test is the correction arithmetic and the choice
 * of scroll node, not the browser's box model.
 */
function scrollerWithRow(tops: number[]) {
  const scroller = document.createElement('div');
  scroller.setAttribute('data-radix-scroll-area-viewport', '');
  const row = document.createElement('div');
  scroller.append(row);
  document.body.append(scroller);
  const queue = [...tops];
  row.getBoundingClientRect = () => ({top: queue.shift() ?? 0} as DOMRect);
  return {scroller, row};
}

describe('withPinnedTop', () => {
  it('gives the scroller back the height the commit removed above the anchor', () => {
    // A collapsed disclosure above this row took 180px with it.
    const {scroller, row} = scrollerWithRow([400, 220]);
    scroller.scrollTop = 500;

    withPinnedTop(row, () => {});

    expect(scroller.scrollTop).toBe(320);
  });

  it('pushes the scroller down when the commit adds height above the anchor', () => {
    const {scroller, row} = scrollerWithRow([220, 400]);
    scroller.scrollTop = 500;

    withPinnedTop(row, () => {});

    expect(scroller.scrollTop).toBe(680);
  });

  it('leaves the scroll alone when the anchor did not move', () => {
    const {scroller, row} = scrollerWithRow([300, 300]);
    scroller.scrollTop = 500;

    withPinnedTop(row, () => {});

    expect(scroller.scrollTop).toBe(500);
  });

  it('measures AFTER the commit, so the commit must be synchronous', () => {
    const {scroller, row} = scrollerWithRow([400, 220]);
    scroller.scrollTop = 500;
    const order: string[] = [];

    withPinnedTop(row, () => order.push('commit'));

    expect(order).toEqual(['commit']);
    expect(scroller.scrollTop).toBe(320);
  });

  it('runs the commit and stays silent when there is no anchor or no scroll node', () => {
    let ran = 0;
    withPinnedTop(null, () => {ran += 1;});

    const orphan = document.createElement('div');
    orphan.getBoundingClientRect = () => ({top: 10} as DOMRect);
    expect(() => withPinnedTop(orphan, () => {ran += 1;})).not.toThrow();
    expect(ran).toBe(2);
  });
});
