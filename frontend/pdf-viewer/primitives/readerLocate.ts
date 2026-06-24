/**
 * Pure matcher for markdown-first citation locating.
 *
 * Given the reader's text blocks and an evidence quote, find the block to
 * scroll to and flash. Matching is whitespace/case-insensitive and tolerant of
 * the trailing ellipsis the AI evidence snippet often carries. A page hint is
 * tried first, then the whole document.
 */

export interface LocatableBlock {
  id: string;
  pageNumber: number;
  blockIndex: number;
  text: string;
}

/**
 * Normalize for comparison: drop common markdown syntax (so a plain-text AI
 * quote matches a block that renders it as `**bold**`, a `| table |` cell, a
 * `# heading`, etc.), collapse whitespace, lowercase.
 */
function normalize(s: string): string {
  return s
    .replace(/[*_`~#|>]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** Drop a trailing "…" / "..." the evidence snippet often appends. */
function stripTrailingEllipsis(s: string): string {
  const stripped = s.replace(/[.…]+$/, '').trim();
  return stripped || s;
}

/**
 * Deterministic locate by (page, block_index); the reader's preferred path.
 *
 * Returns the id of the first block whose pageNumber matches `page` (or any
 * page when `page` is null/undefined) AND whose blockIndex is in `blockIds`.
 * Returns null when `blockIds` is empty or nothing matches.
 */
export function findBlockByIndex(
  blocks: readonly LocatableBlock[],
  page: number | null | undefined,
  blockIds: readonly number[],
): string | null {
  if (!blockIds.length) return null;
  // block_index is PAGE-RELATIVE: without a page, the same index could match
  // the wrong block on a different page.
  if (page == null) return null;
  const wanted = new Set(blockIds);
  const hit = blocks.find(
    (b) => (page == null || b.pageNumber === page) && wanted.has(b.blockIndex),
  );
  return hit ? hit.id : null;
}

/**
 * Returns the id of the best-matching block, or null when nothing matches.
 *
 * Strategy (page-scoped pool first, then all blocks):
 *   1. a block whose text contains the quote
 *   2. a block whose (non-trivial) text is contained by the quote
 *      (the quote spans more than one block — match the first such block)
 */
export function findBlockForQuote(
  blocks: readonly LocatableBlock[],
  quote: string,
  page?: number | null,
): string | null {
  const q = stripTrailingEllipsis(normalize(quote));
  if (!q) return null;

  // Normalize each block once, then scan the page-hinted pool first, then all.
  const normalized = blocks.map((b) => ({id: b.id, page: b.pageNumber, n: normalize(b.text)}));
  const pagePool =
    page != null ? normalized.filter((b) => b.page === page) : [];
  const pools = pagePool.length > 0 ? [pagePool, normalized] : [normalized];

  for (const pool of pools) {
    const contains = pool.find((b) => b.n.includes(q));
    if (contains) return contains.id;

    const within = pool.find((b) => b.n.length > 12 && q.includes(b.n));
    if (within) return within.id;
  }

  return null;
}
