import { describe, expect, it, vi } from 'vitest';

import { findScrollParent, scrollIntoPane } from '@/lib/runs/paneScroll';

function pane(scrollHeight: number, clientHeight: number): HTMLElement {
  const el = document.createElement('div');
  el.style.overflowY = 'auto';
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight });
  Object.defineProperty(el, 'clientHeight', { value: clientHeight });
  return el;
}

function withChild(parent: HTMLElement): HTMLElement {
  const child = document.createElement('div');
  parent.appendChild(child);
  document.body.appendChild(parent);
  return child;
}

/** jsdom lays nothing out, so both boxes are stated outright. */
function boxes(target: HTMLElement, targetTop: number, targetHeight: number, view: HTMLElement, viewTop: number, viewHeight: number): void {
  target.getBoundingClientRect = () => ({ top: targetTop, height: targetHeight }) as DOMRect;
  view.getBoundingClientRect = () => ({ top: viewTop, height: viewHeight }) as DOMRect;
}

describe('findScrollParent', () => {
  it('finds the pane the form actually scrolls in', () => {
    const parent = pane(2000, 600);
    const child = withChild(parent);
    expect(findScrollParent(child)).toBe(parent);
    parent.remove();
  });

  it('rejects an overflow-auto box that does not overflow', () => {
    // It reports scrollTop + clientHeight >= scrollHeight, so accepting it
    // would make the at-bottom clamp always true and pin the rail to the last
    // section — the "everything stays on the last item" regression.
    const parent = pane(600, 600);
    const child = withChild(parent);
    expect(findScrollParent(child)).toBeNull();
    parent.remove();
  });
});

describe('scrollIntoPane', () => {
  it('moves only the pane — never an ancestor', () => {
    // The box above the pane is `overflow: hidden` in the real tree: were it
    // scrolled, it has no scrollbar to come back and it strands the sticky rail
    // off-screen. `scrollIntoView` scrolls every ancestor, so it must not run.
    const outer = document.createElement('div');
    const parent = pane(3000, 900);
    outer.appendChild(parent);
    const child = withChild(outer);
    parent.appendChild(child);
    parent.scrollTop = 500;
    boxes(child, 740, 300, parent, 40, 900);
    const scrollIntoView = vi.fn();
    child.scrollIntoView = scrollIntoView;

    scrollIntoPane(child, 'start');

    // 740 - 40 = 700 below the pane's top, less the 16px `scroll-mt-4` gap.
    expect(parent.scrollTop).toBe(500 + 700 - 16);
    expect(scrollIntoView).not.toHaveBeenCalled();
    outer.remove();
  });

  it('centres a row that fits, and tops one that does not', () => {
    const parent = pane(3000, 900);
    const child = withChild(parent);
    boxes(child, 640, 100, parent, 40, 900);
    scrollIntoPane(child, 'center');
    // 600 below the top, minus the 400px that centres a 100px row in 900px.
    expect(parent.scrollTop).toBe(200);

    boxes(child, 640, 1200, parent, 40, 900);
    parent.scrollTop = 0;
    scrollIntoPane(child, 'center');
    expect(parent.scrollTop).toBe(600 - 16);
    parent.remove();
  });

  it('falls back to the browser when nothing overflows yet', () => {
    const parent = pane(600, 600);
    const child = withChild(parent);
    const scrollIntoView = vi.fn();
    child.scrollIntoView = scrollIntoView;
    scrollIntoPane(child, 'start');
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    parent.remove();
  });
});
