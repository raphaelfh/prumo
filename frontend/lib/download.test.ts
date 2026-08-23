/**
 * Contract for the shared download helper.
 *
 * Four call sites depend on it (articles export, extraction export, the
 * extraction error-boundary log dump, and template export), so the anchor
 * wiring and the object-URL lifecycle are pinned here rather than in each
 * caller. The assertions stay at the observable contract — they do not
 * freeze whether the anchor is briefly parented to the document.
 */

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {triggerDownload} from './download';

// jsdom implements neither half of the object-URL API.
const createObjectURL = vi.fn(() => 'blob:mock-url');
const revokeObjectURL = vi.fn();

/** Anchor state captured at click time — when a browser reads href/download. */
let clicks: {href: string; download: string}[] = [];

beforeEach(() => {
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  clicks = [];
  URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
    function (this: HTMLAnchorElement) {
      clicks.push({href: this.href, download: this.download});
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('triggerDownload', () => {
  it('clicks an anchor carrying the object URL and the requested filename', () => {
    const blob = new Blob(['payload'], {type: 'application/json'});

    triggerDownload(blob, 'report.json');

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicks).toEqual([{href: 'blob:mock-url', download: 'report.json'}]);
  });

  it('revokes the object URL it created', () => {
    triggerDownload(new Blob(['payload']), 'report.json');

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('leaves no anchor behind in the document', () => {
    triggerDownload(new Blob(['payload']), 'report.json');

    expect(document.querySelectorAll('a')).toHaveLength(0);
  });
});
