/**
 * Precise citation-span highlighting for the reader, layered over block-flash.
 *
 * Locating happens in the RENDERED DOM (a TreeWalker over text nodes), never via
 * source char offsets: the reader renders markdown, so on-screen text is split
 * across many text nodes by inline markup and does not map to source offsets.
 * Matching mirrors `readerLocate.ts` normalization (markdown-syntax strip +
 * whitespace-collapse + lowercase + trailing-ellipsis tolerance).
 *
 * The CSS Custom Highlight API is feature-detected; on unsupported browsers
 * (Safari historically) every function is a safe no-op so the caller's
 * block-flash remains the behaviour (no regression).
 */

export const CITATION_HIGHLIGHT_NAME = 'citation-quote';

// ---------------------------------------------------------------------------
// Normalization (mirrors readerLocate.ts)
// ---------------------------------------------------------------------------

function normalize(s: string): string {
  return s
    .replace(/[*_`~#|>]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function stripTrailingEllipsis(s: string): string {
  const stripped = s.replace(/[.…]+$/, '').trim();
  return stripped || s;
}

// ---------------------------------------------------------------------------
// Index map builder
//
// Boundary invariant: each emitted normalized character maps to its OWN source
// position. A collapsed-whitespace space is attributed to the source position
// of the first whitespace character of the run that produced it (offset `i` in
// its node), even when that run spans a text-node boundary. Correctness of the
// returned Range does not depend on which source char a collapsed space points
// at: the search string is normalized AND trailing/leading-trimmed, so it never
// begins or ends with a space. The match's start (positions[matchStart]) and
// end (positions[matchEnd-1]) therefore always land on real, non-whitespace
// source characters, so Range.toString() returns the expected text; the
// collapsed spaces only ever sit strictly inside the range.
// ---------------------------------------------------------------------------

interface SourcePos {
  node: Text;
  offset: number; // offset into node.textContent (the original, un-normalized text)
}

interface IndexMap {
  normalizedText: string;
  positions: SourcePos[]; // positions[i] = source pos of normalizedText[i]
}

function buildIndexMap(block: Element): IndexMap {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const positions: SourcePos[] = [];
  let normalizedText = '';

  // Track whether the last emitted character was a space (for collapse).
  let lastWasSpace = false;

  let node: Node | null = walker.nextNode();
  while (node !== null) {
    const textNode = node as Text;
    const raw = textNode.textContent ?? '';

    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];

      // Apply the same markdown-char replacement as normalize(): treat [*_`~#|>]
      // as a space.
      const isMdSyntax = /[*_`~#|>]/.test(ch);
      const isWhitespace = /\s/.test(ch) || isMdSyntax;

      if (isWhitespace) {
        // Collapse: only emit one space per run, and only when it would not be
        // the very first character (mirrors .trim() on leading space).
        if (!lastWasSpace && normalizedText.length > 0) {
          // Emit one collapsed space, attributed to this whitespace char's own
          // source position (see the boundary invariant above — collapsed
          // spaces only sit inside a match, never at its start/end).
          positions.push({node: textNode, offset: i});
          normalizedText += ' ';
          lastWasSpace = true;
        }
        // else: skip (collapse multiple spaces / leading space)
      } else {
        const lower = ch.toLowerCase();
        positions.push({node: textNode, offset: i});
        normalizedText += lower;
        lastWasSpace = false;
      }
    }

    node = walker.nextNode();
  }

  // Trim trailing space (mirrors normalize()'s .trim()).
  // The positions array already has the right offsets; we just slice the string.
  const trimmedEnd = normalizedText.trimEnd();
  return {
    normalizedText: trimmedEnd,
    positions: positions.slice(0, trimmedEnd.length),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** True only when both the registry and the Highlight constructor exist. */
export function isHighlightApiSupported(): boolean {
  return (
    typeof Highlight !== 'undefined' &&
    typeof CSS !== 'undefined' &&
    !!(CSS as any).highlights
  );
}

/**
 * Build a Range spanning `quote` inside `block`'s rendered text, or null when
 * the quote (after normalization) is not present. Never throws.
 */
export function locateQuoteRange(block: Element, quote: string): Range | null {
  try {
    const q = stripTrailingEllipsis(normalize(quote));
    if (!q) return null;

    const {normalizedText, positions} = buildIndexMap(block);

    const matchStart = normalizedText.indexOf(q);
    if (matchStart === -1) return null;

    const matchEnd = matchStart + q.length; // exclusive

    const startPos = positions[matchStart];
    // End: last char of the match is positions[matchEnd - 1]; the Range end is
    // one past that character in the source node.
    const endPos = positions[matchEnd - 1];

    if (!startPos || !endPos) return null;

    const range = document.createRange();
    range.setStart(startPos.node, startPos.offset);
    range.setEnd(endPos.node, endPos.offset + 1); // +1: Range end is exclusive

    return range;
  } catch {
    return null;
  }
}

/** Register the citation highlight over `range`. No-op when unsupported. */
export function setCitationHighlight(range: Range): void {
  if (!isHighlightApiSupported()) return;
  (CSS as any).highlights.set(CITATION_HIGHLIGHT_NAME, new Highlight(range));
}

/** Remove the citation highlight. No-op when unsupported or absent. */
export function clearCitationHighlight(): void {
  if (!isHighlightApiSupported()) return;
  (CSS as any).highlights.delete(CITATION_HIGHLIGHT_NAME);
}
