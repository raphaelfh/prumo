/**
 * Contract for the shared triggerDownload helper.
 *
 * Every export path in the app funnels through it, so the anchor wiring and
 * the object-URL lifecycle are pinned here rather than in each caller. The
 * assertions stay at the observable contract and deliberately do not freeze
 * whether the anchor is briefly parented to the document.
 */

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {triggerDownload} from './download';

// jsdom implements neither half of the object-URL API.
const createObjectURL = vi.fn();
const revokeObjectURL = vi.fn();
URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
URL.revokeObjectURL = revokeObjectURL;

beforeEach(() => {
  vi.resetAllMocks();
  createObjectURL.mockReturnValue('blob:mock-url');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('triggerDownload', () => {
  it('clicks an anchor carrying the object URL and the requested filename', () => {
    // Stubbing the click keeps jsdom from attempting a real navigation; the
    // spy's context is the anchor as a browser would have seen it at click
    // time, which is when href and download are read.
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    const blob = new Blob(['payload'], {type: 'application/json'});

    triggerDownload(blob, 'report.json');

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(click).toHaveBeenCalledTimes(1);
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.href).toBe('blob:mock-url');
    expect(anchor.download).toBe('report.json');
  });

  it('revokes the object URL it created', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    triggerDownload(new Blob(['payload']), 'report.json');

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });
});
