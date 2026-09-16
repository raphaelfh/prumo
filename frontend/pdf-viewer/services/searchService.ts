import type {PDFDocumentHandle} from '../core/engine';
import {buildPageText, normalizeQuery, type PageText} from '../core/pageText';
import type {SearchMatch, SearchOptions} from '../core/state';

/**
 * Per-document page-text cache so re-searching the same document doesn't
 * re-extract and re-normalize each page. The WeakMap key is the document
 * handle, so entries are eligible for GC when the handle is released.
 *
 * The cached `PageText` is also what `primitives/TextLayer` needs to turn a
 * match's char offsets back into DOM ranges — see `getPageText`.
 */
const pageTextCache = new WeakMap<PDFDocumentHandle, Map<number, Promise<PageText>>>();

/**
 * The page's searchable text and its offset map, extracted once per document.
 * Shared by search (which matches against it) and the text layer (which maps
 * match offsets back onto the painted spans), so the two can never disagree
 * about what character number 400 of a page is.
 */
export function getPageText(doc: PDFDocumentHandle, pageNumber: number): Promise<PageText> {
  let cache = pageTextCache.get(doc);
  if (!cache) {
    cache = new Map();
    pageTextCache.set(doc, cache);
  }
  const cached = cache.get(pageNumber);
  if (cached) return cached;

  const pending = (async () => {
    const page = await doc.getPage(pageNumber);
    const {items} = await page.getTextContent();
    // The handle is NOT cleaned up here: `getPage` returns a shared, cached
    // page (pdf.js caches its PDFPageProxy per index), and `cleanup()` discards
    // that page's operator list and font/image objects — for the page the
    // canvas may be displaying. Reading text allocates none of that, so there
    // is nothing of our own to release; `usePageHandle` owns the lifecycle and
    // cleans a page up when it unmounts.
    return buildPageText(items);
  })();
  // A rejection must not be cached: pdf.js page reads fail transiently (an
  // aborted stream, a worker that was torn down mid-render), and a cached
  // rejection would make that page permanently unsearchable for the life of
  // the document. Drop the entry so the next caller retries.
  pending.catch(() => {
    if (cache.get(pageNumber) === pending) cache.delete(pageNumber);
  });
  cache.set(pageNumber, pending);
  return pending;
}

/**
 * Search the document for the query, returning matches ordered by page +
 * position. The entire document is searched; for very large PDFs (1000+
 * pages) a streaming variant could be added later.
 */
export async function searchDocument(
  doc: PDFDocumentHandle,
  query: string,
  options: SearchOptions,
  onProgress?: (page: number, total: number) => void,
  signal?: AbortSignal,
): Promise<SearchMatch[]> {
  // Fold the query the same way the page text is folded, so "final" matches a
  // typeset "ﬁnal" and "cafe" matches "café".
  const needle = normalizeQuery(query);
  if (!needle) return [];
  const matches: SearchMatch[] = [];

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const {text} = await getPageText(doc, pageNumber);
    for (const {charStart, charEnd} of findInPage(text, needle, options)) {
      matches.push({
        pageNumber,
        charStart,
        charEnd,
        context: text.slice(Math.max(0, charStart - 32), Math.min(text.length, charEnd + 32)),
      });
    }
    onProgress?.(pageNumber, doc.numPages);
  }

  return matches;
}

function findInPage(
  text: string,
  needle: string,
  {caseSensitive, wholeWords}: SearchOptions,
): {charStart: number; charEnd: number}[] {
  const flags = caseSensitive ? 'g' : 'gi';
  // Escape regex metacharacters in the query string.
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = wholeWords ? `\\b${escaped}\\b` : escaped;
  const re = new RegExp(pattern, flags);
  const hits: {charStart: number; charEnd: number}[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    hits.push({charStart: m.index, charEnd: m.index + m[0].length});
  }
  return hits;
}
