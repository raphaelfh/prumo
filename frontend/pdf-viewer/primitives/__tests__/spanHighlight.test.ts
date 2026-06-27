import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  CITATION_HIGHLIGHT_NAME,
  clearCitationHighlight,
  isHighlightApiSupported,
  locateQuoteRange,
  setCitationHighlight,
} from '../spanHighlight';

function block(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('locateQuoteRange', () => {
  it('returns a Range spanning the quote in plain text', () => {
    const el = block('<p>SMART-CARE is a prospective, multicenter cohort study.</p>');
    const range = locateQuoteRange(el, 'prospective, multicenter cohort');
    expect(range).not.toBeNull();
    expect(range!.toString().toLowerCase()).toContain('prospective, multicenter cohort');
  });

  it('returns null when the quote is absent', () => {
    const el = block('<p>nothing relevant here</p>');
    expect(locateQuoteRange(el, 'no such passage')).toBeNull();
  });

  it('returns null for an empty / whitespace quote', () => {
    const el = block('<p>some text</p>');
    expect(locateQuoteRange(el, '   ')).toBeNull();
  });

  it('locates a quote that is split across inline markup', () => {
    const el = block(
      '<p>SMART-CARE is a <strong>prospective, multicenter</strong> cohort study.</p>',
    );
    const range = locateQuoteRange(el, 'prospective, multicenter cohort');
    expect(range).not.toBeNull();
    // start lands in the <strong> text node, end in the trailing text node.
    expect(range!.toString().toLowerCase()).toContain('cohort');
  });

  it('tolerates a trailing ellipsis on the quote', () => {
    const el = block('<p>SMART-CARE is a prospective, multicenter cohort study.</p>');
    const range = locateQuoteRange(el, 'SMART-CARE is a prospective, multicenter...');
    expect(range).not.toBeNull();
  });

  it('matches case- and whitespace-insensitively', () => {
    const el = block('<p>Patients   were  FOLLOWED for six months.</p>');
    const range = locateQuoteRange(el, 'were followed for six MONTHS');
    expect(range).not.toBeNull();
    expect(range!.toString().toLowerCase()).toContain('were');
  });
});

describe('highlight registry wrappers', () => {
  it('reports unsupported when Highlight is undefined', () => {
    vi.stubGlobal('Highlight', undefined);
    expect(isHighlightApiSupported()).toBe(false);
    // no throw on a no-op set/clear when unsupported
    const el = block('<p>text</p>');
    const range = locateQuoteRange(el, 'text')!;
    expect(() => setCitationHighlight(range)).not.toThrow();
    expect(() => clearCitationHighlight()).not.toThrow();
  });

  it('registers and removes the named highlight when supported', () => {
    const store = new Map<string, unknown>();
    class FakeHighlight {
      ranges: Range[];
      constructor(...ranges: Range[]) {
        this.ranges = ranges;
      }
    }
    vi.stubGlobal('Highlight', FakeHighlight);
    vi.stubGlobal('CSS', {...(globalThis.CSS ?? {}), highlights: store});
    expect(isHighlightApiSupported()).toBe(true);

    const el = block('<p>cohort study</p>');
    const range = locateQuoteRange(el, 'cohort study')!;
    setCitationHighlight(range);
    expect(store.has(CITATION_HIGHLIGHT_NAME)).toBe(true);

    clearCitationHighlight();
    expect(store.has(CITATION_HIGHLIGHT_NAME)).toBe(false);
  });
});
