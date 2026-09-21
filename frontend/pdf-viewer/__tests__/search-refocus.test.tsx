/**
 * ⌘F claims the find box on EVERY press, not just the one that opens the bar.
 *
 * The regression it guards: SearchBar focuses its input from an effect keyed on
 * `open`. A second ⌘F while the bar is already open leaves `open` true, so the
 * effect never re-ran and the caret stayed in whatever form field the reviewer
 * was typing in — the key looked dead, and the browser's own find was
 * suppressed as well, so there was no fallback.
 */

import {fireEvent, render, screen} from '@testing-library/react';
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';

// pdfjs-dist uses browser APIs unavailable in jsdom; swap in the legacy Node
// build so import resolution succeeds without crashing.
import * as legacyPdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
vi.mock('pdfjs-dist', () => legacyPdfjs);

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({select: () => ({eq: () => ({eq: () => ({maybeSingle: async () => ({data: null, error: null})})})})}),
    storage: {from: () => ({createSignedUrl: async () => ({data: null, error: null})})},
  },
}));

const {PrumoPdfViewer} = await import('../PrumoPdfViewer');

// The ⌘F listener is gated on the viewer being on screen, which it reads from
// `offsetParent`. jsdom has no layout, so it answers null for every element and
// the handler would return early — the gate is what is stubbed here, not the
// behaviour under test.
const offsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get(this: HTMLElement) {
      return this.parentElement;
    },
  });
});
afterAll(() => {
  if (offsetParent) Object.defineProperty(HTMLElement.prototype, 'offsetParent', offsetParent);
  else Reflect.deleteProperty(HTMLElement.prototype, 'offsetParent');
});

describe('⌘F in the viewer', () => {
  it('returns focus to the find box when the bar is already open', () => {
    render(
      <>
        <input data-testid="form-field" />
        <PrumoPdfViewer source={null} />
      </>,
    );

    fireEvent.keyDown(window, {key: 'f', metaKey: true});
    const find = screen.getByLabelText('Search query');
    expect(find).toHaveFocus();

    // The reviewer goes back to the form, then reaches for ⌘F again.
    const field = screen.getByTestId('form-field') as HTMLInputElement;
    field.focus();
    expect(field).toHaveFocus();

    fireEvent.keyDown(window, {key: 'f', metaKey: true});
    expect(screen.getByLabelText('Search query')).toHaveFocus();
  });
});
