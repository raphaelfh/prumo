/**
 * Find-in-document for the reader (markdown) view.
 *
 * Sibling of `spanHighlight.ts`: both locate text in the RENDERED reader DOM
 * (never via source char offsets — markdown is rendered, so on-screen text is
 * split across many text nodes). They stay separate because the rules differ:
 * citation locating strips markdown syntax, always lowercases, tolerates a
 * trailing ellipsis and finds ONE block; find-in-document searches the visible
 * text as-is (case per option, optional whole-word) and returns EVERY match.
 *
 * Matching is scoped to `[data-block-id]` blocks, so page-header chrome
 * ("Page 1") is excluded and a phrase never matches across two blocks.
 *
 * The CSS Custom Highlight API is feature-detected (shared with spanHighlight);
 * on unsupported browsers the highlight wrappers are safe no-ops.
 */
import {isHighlightApiSupported} from './spanHighlight';

export const READER_SEARCH_HIGHLIGHT = 'reader-search';
export const READER_SEARCH_ACTIVE_HIGHLIGHT = 'reader-search-active';

export interface ReaderSearchOptions {
  caseSensitive: boolean;
  wholeWords: boolean;
}

interface SourcePos {
  node: Text;
  offset: number; // offset into node.textContent (original, un-normalized)
}

interface BlockIndex {
  /** Visible text with whitespace collapsed + trimmed (lowercased unless case-sensitive). */
  text: string;
  /** positions[i] = source position of text[i]. */
  positions: SourcePos[];
}

/** Collapse whitespace runs to single spaces, trim; lowercase unless case-sensitive. */
function buildBlockIndex(block: Element, caseSensitive: boolean): BlockIndex {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const positions: SourcePos[] = [];
  let text = '';
  let lastWasSpace = false;

  let node: Node | null = walker.nextNode();
  while (node !== null) {
    const textNode = node as Text;
    const raw = textNode.textContent ?? '';
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (/\s/.test(ch)) {
        // Collapse runs; never emit a leading space (mirrors .trim()).
        if (!lastWasSpace && text.length > 0) {
          positions.push({node: textNode, offset: i});
          text += ' ';
          lastWasSpace = true;
        }
      } else {
        positions.push({node: textNode, offset: i});
        text += caseSensitive ? ch : ch.toLowerCase();
        lastWasSpace = false;
      }
    }
    node = walker.nextNode();
  }

  // Trim trailing collapsed space; keep positions aligned with the string.
  const trimmed = text.trimEnd();
  return {text: trimmed, positions: positions.slice(0, trimmed.length)};
}

const isWordChar = (ch: string | undefined): boolean => ch !== undefined && /\w/.test(ch);

function isWholeWordMatch(haystack: string, start: number, end: number): boolean {
  return !isWordChar(haystack[start - 1]) && !isWordChar(haystack[end]);
}

/**
 * Every match of `query` in the rendered reader DOM, as DOM Ranges in document
 * order. Returns [] for an empty/whitespace query or when nothing matches.
 * Never throws.
 */
export function findReaderMatches(
  root: Element,
  query: string,
  options: ReaderSearchOptions,
): Range[] {
  try {
    const collapsed = query.trim().replace(/\s+/g, ' ');
    if (!collapsed) return [];
    const needle = options.caseSensitive ? collapsed : collapsed.toLowerCase();

    const ranges: Range[] = [];
    const blocks = root.querySelectorAll('[data-block-id]');

    for (const block of blocks) {
      const {text, positions} = buildBlockIndex(block, options.caseSensitive);
      let from = 0;
      while (from <= text.length) {
        const idx = text.indexOf(needle, from);
        if (idx === -1) break;
        const end = idx + needle.length; // exclusive
        if (!options.wholeWords || isWholeWordMatch(text, idx, end)) {
          const startPos = positions[idx];
          const endPos = positions[end - 1];
          if (startPos && endPos) {
            const range = document.createRange();
            range.setStart(startPos.node, startPos.offset);
            range.setEnd(endPos.node, endPos.offset + 1); // Range end is exclusive
            ranges.push(range);
          }
          from = end; // non-overlapping
        } else {
          from = idx + 1; // a rejected substring may still precede a real word match
        }
      }
    }

    return ranges;
  } catch {
    return [];
  }
}

/**
 * Register the search highlights: all non-active matches under `reader-search`
 * and the active match (if any) under `reader-search-active` (painted on top via
 * priority). No-op when the API is unsupported.
 */
export function setReaderSearchHighlights(ranges: Range[], activeIndex: number): void {
  if (!isHighlightApiSupported()) return;
  const highlights = (CSS as unknown as {highlights: Map<string, unknown>}).highlights;

  if (ranges.length === 0) {
    highlights.delete(READER_SEARCH_HIGHLIGHT);
    highlights.delete(READER_SEARCH_ACTIVE_HIGHLIGHT);
    return;
  }

  const HighlightCtor = Highlight as unknown as new (...ranges: Range[]) => {priority?: number};
  const base = ranges.filter((_, i) => i !== activeIndex);
  highlights.set(READER_SEARCH_HIGHLIGHT, new HighlightCtor(...base));

  const active = activeIndex >= 0 && activeIndex < ranges.length ? ranges[activeIndex] : null;
  if (active) {
    const hl = new HighlightCtor(active);
    hl.priority = 1;
    highlights.set(READER_SEARCH_ACTIVE_HIGHLIGHT, hl);
  } else {
    highlights.delete(READER_SEARCH_ACTIVE_HIGHLIGHT);
  }
}

export interface RevealScrollInput {
  /** Match top in client/viewport coords (range.getBoundingClientRect().top). */
  rangeTop: number;
  rangeHeight: number;
  /** Scroller viewport top in the same coords (scroller.getBoundingClientRect().top). */
  scrollerTop: number;
  /** Current scroll offset of the scroller. */
  scrollTop: number;
  /** Visible height of the scroller (scroller.clientHeight). */
  clientHeight: number;
  /** Comfort padding kept above/below the match. */
  margin?: number;
}

/**
 * Pure reveal geometry for the find-in-document scroll. Returns whether the
 * match needs scrolling and, if so, the target `scrollTop` that brings it into
 * comfortable view — centered, or top-aligned when the match is taller than the
 * viewport. Editor behaviour: leave the view alone when the match is already
 * visible (no jarring re-center on every keystroke/step).
 */
export function computeRevealScroll(input: RevealScrollInput): {needsScroll: boolean; top: number} {
  const {rangeTop, rangeHeight, scrollerTop, scrollTop, clientHeight} = input;
  const margin = input.margin ?? 24;

  const offsetInViewport = rangeTop - scrollerTop; // 0 = match at the scroller's top edge
  const visibleTop = margin;
  const visibleBottom = clientHeight - margin;
  const inView = offsetInViewport >= visibleTop && offsetInViewport + rangeHeight <= visibleBottom;
  if (inView) return {needsScroll: false, top: scrollTop};

  const tallerThanViewport = rangeHeight > clientHeight - margin * 2;
  const target = tallerThanViewport
    ? scrollTop + offsetInViewport - margin // align top
    : scrollTop + offsetInViewport - (clientHeight - rangeHeight) / 2; // center
  return {needsScroll: true, top: Math.max(0, target)};
}

/** Remove both search highlights. No-op when unsupported or absent. */
export function clearReaderSearchHighlights(): void {
  if (!isHighlightApiSupported()) return;
  const highlights = (CSS as unknown as {highlights: Map<string, unknown>}).highlights;
  highlights.delete(READER_SEARCH_HIGHLIGHT);
  highlights.delete(READER_SEARCH_ACTIVE_HIGHLIGHT);
}
