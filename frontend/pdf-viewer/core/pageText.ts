/**
 * Searchable page text, with an offset map back to the pdf.js text items.
 *
 * pdf.js hands out text as a stream of *fragments*, not lines: a fragment ends
 * wherever the PDF's drawing operators end it, and a line break is carried as
 * `hasEOL` rather than as a character. Concatenating `item.str` therefore glues
 * words together across lines ("validate clinicalmachine learning"), which both
 * loses real matches and invents fake ones. This module rebuilds the page text
 * the way pdf.js's own `PDFFindController` does — line breaks honoured,
 * end-of-line hyphenation rejoined, ligatures and diacritics folded, whitespace
 * collapsed — and records, for every emitted character, which item it came from.
 *
 * That map is the single source of truth shared by the two sides of search:
 * `services/searchService` matches against `text`, and `primitives/TextLayer`
 * turns the resulting char offsets back into DOM Ranges over the item's span.
 * `itemIndex` is an index into the item array as pdf.js streams it — the same
 * order and length as the `textDivs` its TextLayer paints — so empty items are
 * kept, never skipped, or every later index would drift against the DOM.
 */

/** The part of a pdf.js text item this module reads. */
export interface PageTextItem {
  text: string;
  /** pdf.js marks the fragment that ends a line. */
  hasEOL?: boolean;
}

/** Where an emitted character came from. */
export interface CharSource {
  itemIndex: number;
  /** Offset into that item's own `text`. */
  offset: number;
}

export interface PageText {
  /** Normalized, searchable text of the whole page. */
  text: string;
  /** `sources[i]` is the origin of `text[i]`; always `text.length` long. */
  sources: CharSource[];
}

/** Ligatures pdf.js folds too, so a plain "final" matches a typeset "ﬁnal". */
const LIGATURES: Record<string, string> = {
  'ﬀ': 'ff',
  'ﬁ': 'fi',
  'ﬂ': 'fl',
  'ﬃ': 'ffi',
  'ﬄ': 'ffl',
  'ﬅ': 'st',
  'ﬆ': 'st',
};

/** A soft hyphen is a typesetting hint, never part of the word. */
const SOFT_HYPHEN = '­';

const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * The searchable form of one source character: '' when it is dropped, and
 * occasionally more than one character (a ligature expands). Whitespace is
 * returned as a single space; collapsing runs is the caller's job.
 */
function foldChar(ch: string): string {
  if (ch === SOFT_HYPHEN) return '';
  if (/\s/.test(ch)) return ' ';
  const ligature = LIGATURES[ch];
  if (ligature) return ligature;
  // Decompose, then drop the combining marks: "café" → "cafe".
  const folded = ch.normalize('NFD').replace(COMBINING_MARKS, '');
  return folded || ch;
}

/**
 * Build the page's searchable text and its offset map from the pdf.js items,
 * in stream order and with empty items preserved.
 */
export function buildPageText(items: readonly PageTextItem[]): PageText {
  let text = '';
  const sources: CharSource[] = [];
  let lastWasSpace = false;

  const emit = (chars: string, source: CharSource) => {
    for (const ch of chars) {
      text += ch;
      sources.push(source);
    }
  };

  for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
    const item = items[itemIndex];
    const raw = item.text ?? '';

    for (let offset = 0; offset < raw.length; offset++) {
      const folded = foldChar(raw[offset]);
      if (folded === '') continue;
      if (folded === ' ') {
        // Collapse runs, and never open the page with a space (the trim).
        if (lastWasSpace || text.length === 0) continue;
        emit(' ', {itemIndex, offset});
        lastWasSpace = true;
        continue;
      }
      emit(folded, {itemIndex, offset});
      lastWasSpace = false;
    }

    if (!item.hasEOL) continue;

    // A word hyphenated across the line break is one word: drop the hyphen and
    // join the halves, rather than emitting a break between them.
    if (text.endsWith('-')) {
      text = text.slice(0, -1);
      sources.pop();
      lastWasSpace = false;
      continue;
    }
    if (lastWasSpace || text.length === 0) continue;
    // Attribute the break to the line's last item, one past its last character.
    emit(' ', {itemIndex, offset: raw.length});
    lastWasSpace = true;
  }

  // Trailing trim: the sources array is already aligned, so slicing is enough.
  const trimmed = text.trimEnd();
  return {text: trimmed, sources: sources.slice(0, trimmed.length)};
}

/**
 * Fold a user's query the same way `buildPageText` folds the page, so a query
 * typed with plain letters matches typeset ligatures and accents.
 */
export function normalizeQuery(query: string): string {
  let out = '';
  for (const ch of query) {
    const folded = foldChar(ch);
    if (folded === ' ' && out.endsWith(' ')) continue;
    out += folded;
  }
  return out.trim();
}
