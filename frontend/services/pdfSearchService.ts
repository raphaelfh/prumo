/**
 * pdfSearchService - PDF document search service
 *
 * Features:
 * - Extract text from PDF pages using PDF.js
 * - Search with case sensitive, whole words and regex support
 * - Cache extracted text for performance
 * - Extract context around matches
 */

import type {PDFDocumentProxy, PDFPageProxy} from 'pdfjs-dist';

export interface SearchOptions {
  caseSensitive?: boolean;
  wholeWords?: boolean;
  useRegex?: boolean;
}

export interface SearchMatch {
  start: number;
  end: number;
  text: string;
}

export interface SearchResult {
  pageNumber: number;
  matches: SearchMatch[];
  text: string;
  context: string;
}

// Cache of extracted text (page -> text)
const textCache = new Map<string, string>();
const MAX_CACHE_SIZE = 20; // Limit cache to 20 pages

/**
 * Generates unique cache key from document and page
 */
function getCacheKey(doc: PDFDocumentProxy, pageNumber: number): string {
    // Use PDF fingerprint + page number
  const fingerprint = (doc as any).fingerprint || doc.loadingTask?.docId || 'unknown';
  return `${fingerprint}-${pageNumber}`;
}

/**
 * Trims cache when it exceeds max size (FIFO)
 */
function trimCache() {
  if (textCache.size > MAX_CACHE_SIZE) {
    const firstKey = textCache.keys().next().value;
    if (firstKey) {
      textCache.delete(firstKey);
    }
  }
}

/**
 * Extracts text from a PDF page
 */
export async function extractTextFromPage(page: PDFPageProxy): Promise<string> {
  try {
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map((item: any) => item.str)
      .join(' ');
    return text;
  } catch (error) {
      console.error('Error extracting page text:', error);
    return '';
  }
}

/**
 * Searches for query matches in text
 */
export function searchInText(
  text: string,
  query: string,
  options: SearchOptions = {}
): SearchMatch[] {
  const { caseSensitive = false, wholeWords = false, useRegex = false } = options;
  const matches: SearchMatch[] = [];

  if (!query.trim()) return matches;

  try {
    let pattern: RegExp;

    if (useRegex) {
        // Regex mode: use query directly
      pattern = new RegExp(query, caseSensitive ? 'g' : 'gi');
    } else {
        // Escape regex special characters
      let escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Add word boundaries if wholeWords is on
      if (wholeWords) {
        escapedQuery = `\\b${escapedQuery}\\b`;
      }
      
      pattern = new RegExp(escapedQuery, caseSensitive ? 'g' : 'gi');
    }

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
      });

        // Avoid infinite loop with zero-length matches
      if (match[0].length === 0) {
        pattern.lastIndex++;
      }
    }
  } catch (error) {
      console.error('Search error in text (invalid regex?):', error);
  }

  return matches;
}

/**
 * Extracts context around a match
 */
function extractContext(text: string, match: SearchMatch, contextLength = 50): string {
  const start = Math.max(0, match.start - contextLength);
  const end = Math.min(text.length, match.end + contextLength);
  
  let context = text.substring(start, end);

    // Add ellipsis if truncated
  if (start > 0) context = '...' + context;
  if (end < text.length) context = context + '...';
  
  return context;
}

/**
 * Searches the entire PDF document
 */
export async function searchInDocument(
  doc: PDFDocumentProxy,
  query: string,
  options: SearchOptions = {},
  onProgress?: (current: number, total: number) => void
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  
  if (!query.trim()) return results;

  const numPages = doc.numPages;

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    try {
        // Check cache first
      const cacheKey = getCacheKey(doc, pageNum);
      let pageText: string;

      if (textCache.has(cacheKey)) {
        pageText = textCache.get(cacheKey)!;
      } else {
          // Extract text from page
        const page = await doc.getPage(pageNum);
        pageText = await extractTextFromPage(page);

          // Save to cache
        textCache.set(cacheKey, pageText);
        trimCache();
      }

        // Search for matches on page
      const matches = searchInText(pageText, query, options);

      if (matches.length > 0) {
          // Get context from first match (for preview)
        const context = extractContext(pageText, matches[0]);
        
        results.push({
          pageNumber: pageNum,
          matches,
          text: pageText,
          context,
        });
      }

        // Notify progress
      if (onProgress) {
        onProgress(pageNum, numPages);
      }
    } catch (error) {
        console.error(`Search error on page ${pageNum}:`, error);
    }
  }

  return results;
}

/**
 * Clears text cache (useful when switching document)
 */
export function clearTextCache() {
  textCache.clear();
}

