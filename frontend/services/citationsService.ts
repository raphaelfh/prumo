/**
 * Citations service — fetches per-article citation anchors from the backend.
 *
 * Service-layer contract (zero-bailouts spec): exported functions never throw
 * across the boundary; they return ErrorResult<T>. IO lives here; the React
 * Compiler never sees try/catch inside a hook body.
 */

import {apiClient} from '@/integrations/api/client';
import {toResult, type ErrorResult} from '@/lib/error-utils';
import type {CitationAnchor} from '@/pdf-viewer/core/citation';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ArticleCitationItem {
  id: string;
  verified: boolean;
  anchorKind: 'text' | 'region' | 'hybrid' | null;
  anchor: CitationAnchor | null;
  metadata: {
    pageNumber: number | null;
    textContent: string | null;
    source: string;
  };
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

/**
 * Fetches all citations for a given article.
 * Returns an empty array when the article has no citations yet.
 */
export function fetchArticleCitations(
  articleId: string,
): Promise<ErrorResult<ArticleCitationItem[]>> {
  return toResult(async () => {
    const data = await apiClient<ArticleCitationItem[]>(
      `/api/v1/articles/${articleId}/citations`,
    );
    return data ?? [];
  }, 'citationsService.fetchArticleCitations');
}

// ---------------------------------------------------------------------------
// Pure matcher — no IO, deterministic
// ---------------------------------------------------------------------------

/**
 * Normalizes a string for fuzzy comparison: trim, collapse whitespace,
 * lowercase.
 */
function normalize(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Attempts to match an AI evidence quote to a citation in the list.
 *
 * Matching strategy (in priority order):
 *  1. Same page number AND (normalized textContent equals OR contains the
 *     evidence text)
 *  2. Text-only match (page is null/absent) — normalized textContent equals
 *     or contains the evidence text
 *
 * Ties are broken by list order (earliest first).
 * Returns null when no citation matches.
 */
export function matchEvidenceToCitation(
  evidence: {text: string; pageNumber?: number | null},
  citations: ArticleCitationItem[],
): ArticleCitationItem | null {
  const normalizedEvidence = normalize(evidence.text);
  const hasPage =
    evidence.pageNumber !== null && evidence.pageNumber !== undefined;

  const textMatches = (item: ArticleCitationItem): boolean => {
    const tc = item.metadata.textContent;
    if (!tc) return false;
    const normalizedTc = normalize(tc);
    return (
      normalizedTc === normalizedEvidence ||
      normalizedTc.includes(normalizedEvidence)
    );
  };

  // Pass 1: page + text match
  if (hasPage) {
    const pageAndText = citations.find(
      (item) =>
        item.metadata.pageNumber === evidence.pageNumber && textMatches(item),
    );
    if (pageAndText) return pageAndText;
  }

  // Pass 2: text-only match
  return citations.find(textMatches) ?? null;
}
