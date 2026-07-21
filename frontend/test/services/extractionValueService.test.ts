import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock @/integrations/api BEFORE importing the service under test
vi.mock('@/integrations/api', () => ({ apiClient: vi.fn() }));

import { apiClient } from '@/integrations/api';
import { ExtractionValueService } from '@/services/extractionValueService';

const apiClientMock = apiClient as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  apiClientMock.mockReset();
  // Default: return null (no active run)
  apiClientMock.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// findLatestFinalizedRun
// ---------------------------------------------------------------------------
describe('ExtractionValueService.findLatestFinalizedRun', () => {
  it('returns null when the API returns null', async () => {
    apiClientMock.mockResolvedValueOnce(null);
    const result = await ExtractionValueService.findLatestFinalizedRun('article-1', null);
    expect(result).toBeNull();
  });

  it('returns mapped RunRef when the API returns a RunSummaryResponse', async () => {
    apiClientMock.mockResolvedValueOnce({
      id: 'run-final',
      stage: 'finalized',
      status: 'completed',
      template_id: 'tpl-1',
      project_id: 'proj-1',
      article_id: 'article-1',
      kind: 'extraction',
      version_id: 'v1',
      hitl_config_snapshot: {},
      parameters: {},
      results: {},
      created_at: '2026-04-28T10:00:00Z',
      created_by: 'user-1',
    });
    const result = await ExtractionValueService.findLatestFinalizedRun('article-1', 'tpl-1');
    expect(result).toEqual({
      id: 'run-final',
      stage: 'finalized',
      status: 'completed',
      template_id: 'tpl-1',
    });
  });

  it('calls apiClient with the correct path (with template_id)', async () => {
    apiClientMock.mockResolvedValueOnce(null);
    await ExtractionValueService.findLatestFinalizedRun('article-42', 'tpl-7');
    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/articles/article-42/finalized-run?template_id=tpl-7',
    );
  });

  it('calls apiClient with path without query param when template_id is null', async () => {
    apiClientMock.mockResolvedValueOnce(null);
    await ExtractionValueService.findLatestFinalizedRun('article-42', null);
    expect(apiClientMock).toHaveBeenCalledWith('/api/v1/articles/article-42/finalized-run');
  });

  it('does NOT touch supabase', async () => {
    apiClientMock.mockResolvedValueOnce(null);
    await ExtractionValueService.findLatestFinalizedRun('article-1', null);
    expect(apiClientMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// findFormRunsByArticle
// ---------------------------------------------------------------------------
describe('ExtractionValueService.findFormRunsByArticle', () => {
  it('returns empty Map without calling apiClient when articleIds is empty', async () => {
    const result = await ExtractionValueService.findFormRunsByArticle([], 'tpl-1', 'proj-1');
    expect(result.size).toBe(0);
    expect(apiClientMock).not.toHaveBeenCalled();
  });

  it('calls apiClient with POST body containing article_ids, template_id, project_id', async () => {
    apiClientMock.mockResolvedValueOnce([
      { article_id: 'article-A', run_id: 'run-A' },
      { article_id: 'article-B', run_id: 'run-B' },
    ]);
    await ExtractionValueService.findFormRunsByArticle(
      ['article-A', 'article-B'],
      'tpl-1',
      'proj-1',
    );
    expect(apiClientMock).toHaveBeenCalledWith('/api/v1/articles/form-runs', {
      method: 'POST',
      body: {
        article_ids: ['article-A', 'article-B'],
        template_id: 'tpl-1',
        project_id: 'proj-1',
      },
    });
  });

  it('builds Map<article_id, run_id> from ArticleRunRef[] response', async () => {
    apiClientMock.mockResolvedValueOnce([
      { article_id: 'article-A', run_id: 'run-A' },
      { article_id: 'article-B', run_id: 'run-B' },
    ]);
    const result = await ExtractionValueService.findFormRunsByArticle(
      ['article-A', 'article-B'],
      'tpl-1',
      'proj-1',
    );
    expect(result.get('article-A')).toBe('run-A');
    expect(result.get('article-B')).toBe('run-B');
    expect(result.size).toBe(2);
  });

  it('excludes entries where run_id is null', async () => {
    apiClientMock.mockResolvedValueOnce([
      { article_id: 'article-A', run_id: 'run-A' },
      { article_id: 'article-B', run_id: null },
    ]);
    const result = await ExtractionValueService.findFormRunsByArticle(
      ['article-A', 'article-B'],
      'tpl-1',
      'proj-1',
    );
    expect(result.get('article-A')).toBe('run-A');
    expect(result.has('article-B')).toBe(false);
    expect(result.size).toBe(1);
  });

  it('does NOT touch supabase', async () => {
    apiClientMock.mockResolvedValueOnce([]);
    await ExtractionValueService.findFormRunsByArticle(['article-A'], 'tpl-1', 'proj-1');
    expect(apiClientMock).toHaveBeenCalledTimes(1);
  });
});
