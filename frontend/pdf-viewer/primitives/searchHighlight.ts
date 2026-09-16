/**
 * Search highlighting for the canvas (PDF) view.
 *
 * Highlights are painted as DOM Ranges through the CSS Custom Highlight API —
 * the same mechanism `readerSearch.ts` uses for the markdown view, so both
 * views share one highlight vocabulary and one stylesheet. Ranges are built
 * per *character*, mapped through `core/pageText`'s offset map onto the spans
 * pdf.js painted, rather than per span: a pdf.js text item is typically a whole
 * line, so a span-granularity highlight lights up the entire line around the
 * hit.
 *
 * `CSS.highlights` is a document-wide registry, so the live ranges of every
 * mounted page are kept here and merged on each change. Keying by container
 * element (not page number) means two viewers on screen cannot clobber each
 * other's entries.
 */
import type {PageText} from '../core/pageText';
import {isHighlightApiSupported} from './spanHighlight';

export const PDF_SEARCH_HIGHLIGHT = 'pdf-search';
export const PDF_SEARCH_ACTIVE_HIGHLIGHT = 'pdf-search-active';

/**
 * The DOM Ranges covering `[charStart, charEnd)` of the page text, one per text
 * item the match runs through. Characters that map outside a painted span (the
 * synthetic space a line break contributes) are skipped. Never throws.
 */
export function buildMatchRanges(
  pageText: PageText,
  textDivs: readonly HTMLElement[],
  charStart: number,
  charEnd: number,
): Range[] {
  const ranges: Range[] = [];
  const {sources} = pageText;

  let i = charStart;
  while (i < charEnd) {
    const source = sources[i];
    if (!source) break;

    const node = textDivs[source.itemIndex]?.firstChild;
    const length = node?.nodeType === Node.TEXT_NODE ? (node.textContent?.length ?? 0) : 0;
    if (!node || source.offset >= length) {
      i++;
      continue;
    }

    // Extend through every following character that lands in the same span.
    const itemIndex = source.itemIndex;
    let end = i;
    while (end + 1 < charEnd) {
      const next = sources[end + 1];
      if (!next || next.itemIndex !== itemIndex || next.offset >= length) break;
      end++;
    }

    const range = document.createRange();
    range.setStart(node, source.offset);
    // The Range end is exclusive, and one source character can have produced
    // several folded ones (a ligature), so the last character's own offset is
    // what the range must reach past.
    range.setEnd(node, Math.min(sources[end].offset + 1, length));
    ranges.push(range);

    i = end + 1;
  }

  return ranges;
}

interface PageHighlights {
  matches: Range[];
  active: Range[];
}

const byContainer = new Map<HTMLElement, PageHighlights>();

function repaint(): void {
  if (!isHighlightApiSupported()) return;
  const highlights = (CSS as unknown as {highlights: Map<string, unknown>}).highlights;
  const HighlightCtor = Highlight as unknown as new (...ranges: Range[]) => {priority?: number};

  const matches: Range[] = [];
  const active: Range[] = [];
  for (const page of byContainer.values()) {
    matches.push(...page.matches);
    active.push(...page.active);
  }

  if (matches.length === 0) {
    highlights.delete(PDF_SEARCH_HIGHLIGHT);
  } else {
    highlights.set(PDF_SEARCH_HIGHLIGHT, new HighlightCtor(...matches));
  }

  if (active.length === 0) {
    highlights.delete(PDF_SEARCH_ACTIVE_HIGHLIGHT);
  } else {
    const hl = new HighlightCtor(...active);
    hl.priority = 1; // painted over the non-active matches
    highlights.set(PDF_SEARCH_ACTIVE_HIGHLIGHT, hl);
  }
}

/** Publish one page's search ranges, replacing whatever it published before. */
export function setPageSearchHighlights(
  container: HTMLElement,
  matches: Range[],
  active: Range[],
): void {
  if (matches.length === 0 && active.length === 0) {
    byContainer.delete(container);
  } else {
    byContainer.set(container, {matches, active});
  }
  repaint();
}

/** Drop a page's ranges — on unmount, or when its text layer re-renders. */
export function clearPageSearchHighlights(container: HTMLElement): void {
  if (!byContainer.delete(container)) return;
  repaint();
}
