/**
 * Tests for citationsService.
 *
 * Covers:
 *  - fetchArticleCitations: correct URL, data mapping, ErrorResult on failure
 *  - matchEvidenceToCitation: page+text, whitespace/case normalisation,
 *    page-null text-only fallback, no-match → null, tie → earliest
 */

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/api/client', () => ({
  apiClient: vi.fn(),
}));

vi.mock('@/lib/copy', () => ({
  t: (_ns: string, key: string) => key,
}));

vi.mock('@/lib/logger', () => ({
  logger: {debug: vi.fn(), error: vi.fn(), warn: vi.fn()},
}));

import {apiClient} from '@/integrations/api/client';
import {
  fetchArticleCitations,
  matchEvidenceToCitation,
  type ArticleCitationItem,
} from '@/services/citationsService';

const apiClientMock = apiClient as unknown as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeItem(
  id: string,
  textContent: string | null,
  pageNumber: number | null,
): ArticleCitationItem {
  return {
    id,
    verified: false,
    anchorKind: 'text',
    anchor: null,
    metadata: {pageNumber, textContent, source: 'ai'},
  };
}

// ---------------------------------------------------------------------------
// fetchArticleCitations
// ---------------------------------------------------------------------------

describe('fetchArticleCitations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls the correct URL and returns ok:true with mapped data', async () => {
    const items = [makeItem('c-1', 'Hello world', 1)];
    apiClientMock.mockResolvedValueOnce(items);

    const result = await fetchArticleCitations('art-123');

    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/articles/art-123/citations',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(items);
    }
  });

  it('returns empty array when apiClient resolves to null/undefined', async () => {
    apiClientMock.mockResolvedValueOnce(null);

    const result = await fetchArticleCitations('art-456');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([]);
    }
  });

  it('returns ok:false when apiClient throws', async () => {
    apiClientMock.mockRejectedValueOnce(new Error('Network error'));

    const result = await fetchArticleCitations('art-789');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Network error');
    }
  });
});

// ---------------------------------------------------------------------------
// matchEvidenceToCitation
// ---------------------------------------------------------------------------

describe('matchEvidenceToCitation', () => {
  it('returns null for empty citation list', () => {
    expect(
      matchEvidenceToCitation({text: 'some text', pageNumber: 1}, []),
    ).toBeNull();
  });

  it('matches by exact page + text content', () => {
    const c1 = makeItem('c-1', 'The quick brown fox', 2);
    const c2 = makeItem('c-2', 'Another sentence', 2);
    expect(
      matchEvidenceToCitation(
        {text: 'The quick brown fox', pageNumber: 2},
        [c1, c2],
      ),
    ).toBe(c1);
  });

  it('matches when textContent contains the evidence text', () => {
    const c1 = makeItem('c-1', 'Prefix. The evidence text. Suffix.', 3);
    expect(
      matchEvidenceToCitation(
        {text: 'The evidence text.', pageNumber: 3},
        [c1],
      ),
    ).toBe(c1);
  });

  it('matches despite different whitespace and casing', () => {
    const c1 = makeItem('c-1', 'Hello   World', 1);
    expect(
      matchEvidenceToCitation({text: '  hello world  ', pageNumber: 1}, [c1]),
    ).toBe(c1);
  });

  it('falls back to text-only match when evidence pageNumber is null', () => {
    const c1 = makeItem('c-1', 'Specific phrase', 5);
    expect(
      matchEvidenceToCitation({text: 'Specific phrase', pageNumber: null}, [c1]),
    ).toBe(c1);
  });

  it('falls back to text-only match when evidence pageNumber is undefined', () => {
    const c1 = makeItem('c-1', 'Another phrase', 7);
    expect(
      matchEvidenceToCitation({text: 'Another phrase'}, [c1]),
    ).toBe(c1);
  });

  it('prefers page+text match over text-only match on a different page', () => {
    const wrongPage = makeItem('c-wrong', 'Target text', 99);
    const rightPage = makeItem('c-right', 'Target text', 4);
    expect(
      matchEvidenceToCitation(
        {text: 'Target text', pageNumber: 4},
        [wrongPage, rightPage],
      ),
    ).toBe(rightPage);
  });

  it('returns null when no citation matches', () => {
    const c1 = makeItem('c-1', 'Completely different content', 1);
    expect(
      matchEvidenceToCitation({text: 'No match here', pageNumber: 1}, [c1]),
    ).toBeNull();
  });

  it('breaks ties by list order — returns earliest match', () => {
    const first = makeItem('c-first', 'Same text', 2);
    const second = makeItem('c-second', 'Same text', 2);
    expect(
      matchEvidenceToCitation({text: 'Same text', pageNumber: 2}, [first, second]),
    ).toBe(first);
  });

  it('returns null when textContent is null on all items', () => {
    const c1 = makeItem('c-1', null, 1);
    expect(
      matchEvidenceToCitation({text: 'any text', pageNumber: 1}, [c1]),
    ).toBeNull();
  });
});
