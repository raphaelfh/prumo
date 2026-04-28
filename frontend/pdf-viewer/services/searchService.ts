import type {PDFDocumentHandle} from '../core/engine';
import type {SearchMatch, SearchOptions} from '../core/state';

/**
 * Per-document text cache so re-searching the same query/options doesn't
 * re-extract text from each page. The WeakMap key is the document handle,
 * so entries are automatically eligible for GC when the handle is released.
 */
const textCache = new WeakMap<PDFDocumentHandle, Map<number, string>>();

async function getPageText(doc: PDFDocumentHandle, pageNumber: number): Promise<string> {
  let cache = textCache.get(doc);
  if (!cache) {
    cache = new Map();
    textCache.set(doc, cache);
  }
  if (cache.has(pageNumber)) return cache.get(pageNumber)!;

  const page = await doc.getPage(pageNumber);
  const tc = await page.getTextContent();
  const text = tc.items.map((i) => i.text).join('');
  cache.set(pageNumber, text);
  page.cleanup();
  return text;
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
  if (!query) return [];
  const matches: SearchMatch[] = [];

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const pageText = await getPageText(doc, pageNumber);
    const hits = findInPage(pageText, query, options);
    for (const {charStart, charEnd} of hits) {
      matches.push({
        pageNumber,
        charStart,
        charEnd,
        context: pageText.slice(
          Math.max(0, charStart - 32),
          Math.min(pageText.length, charEnd + 32),
        ),
      });
    }
    onProgress?.(pageNumber, doc.numPages);
  }

  return matches;
}

function findInPage(
  text: string,
  query: string,
  {caseSensitive, wholeWords}: SearchOptions,
): {charStart: number; charEnd: number}[] {
  if (!query) return [];
  const flags = caseSensitive ? 'g' : 'gi';
  // Escape regex metacharacters in the query string.
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

/**
 * Drop the text cache for a document. The WeakMap will GC entries
 * automatically when the doc handle is no longer reachable, but this
 * provides explicit control for memory-sensitive flows.
 */
export function clearSearchCache(doc: PDFDocumentHandle): void {
  textCache.delete(doc);
}
