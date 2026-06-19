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
// findActiveRun
// ---------------------------------------------------------------------------
describe('ExtractionValueService.findActiveRun', () => {
  it('returns null when the API returns null', async () => {
    apiClientMock.mockResolvedValueOnce(null);
    const result = await ExtractionValueService.findActiveRun('article-1', 'tpl-1');
    expect(result).toBeNull();
  });

  it('returns mapped RunRef when the API returns a RunSummaryResponse', async () => {
    apiClientMock.mockResolvedValueOnce({
      id: 'run-1',
      stage: 'review',
      status: 'running',
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
    const result = await ExtractionValueService.findActiveRun('article-1', 'tpl-1');
    expect(result).toEqual({
      id: 'run-1',
      stage: 'review',
      status: 'running',
      template_id: 'tpl-1',
    });
  });

  it('calls apiClient with the correct path (with template_id)', async () => {
    apiClientMock.mockResolvedValueOnce(null);
    await ExtractionValueService.findActiveRun('article-42', 'tpl-7');
    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/articles/article-42/active-run?template_id=tpl-7',
    );
  });

  it('calls apiClient with path without query param when template_id is null', async () => {
    apiClientMock.mockResolvedValueOnce(null);
    await ExtractionValueService.findActiveRun('article-42', null);
    expect(apiClientMock).toHaveBeenCalledWith('/api/v1/articles/article-42/active-run');
  });

  it('does NOT touch supabase', async () => {
    // If supabase were imported and called, the test environment would error
    // because we never mock it here. This test simply verifies apiClient is
    // the sole transport by confirming the call lands on it.
    apiClientMock.mockResolvedValueOnce(null);
    await ExtractionValueService.findActiveRun('article-1', null);
    expect(apiClientMock).toHaveBeenCalledTimes(1);
  });
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

// ---------------------------------------------------------------------------
// Write paths (saveValue / acceptProposal / rejectValue) — unchanged
// ---------------------------------------------------------------------------
describe('ExtractionValueService write paths', () => {
  it('saveValue posts an edit decision with wrapped value', async () => {
    apiClientMock.mockResolvedValueOnce({});
    await ExtractionValueService.saveValue('run-1', 'inst-1', 'field-1', 42);
    expect(apiClientMock).toHaveBeenCalledWith('/api/v1/runs/run-1/decisions', {
      method: 'POST',
      body: {
        instance_id: 'inst-1',
        field_id: 'field-1',
        decision: 'edit',
        value: { value: 42 },
        rationale: undefined,
      },
    });
  });

  it('saveValue forwards rationale when provided', async () => {
    apiClientMock.mockResolvedValueOnce({});
    await ExtractionValueService.saveValue('run-1', 'inst-1', 'field-1', null, 'because');
    const lastCall = apiClientMock.mock.calls.at(-1)!;
    expect(lastCall[1].body.rationale).toBe('because');
    expect(lastCall[1].body.value).toEqual({ value: null });
  });

  it('acceptProposal posts decision=accept_proposal with proposal_record_id', async () => {
    apiClientMock.mockResolvedValueOnce({});
    await ExtractionValueService.acceptProposal('run-1', 'inst-1', 'field-1', 'proposal-1');
    expect(apiClientMock).toHaveBeenCalledWith('/api/v1/runs/run-1/decisions', {
      method: 'POST',
      body: {
        instance_id: 'inst-1',
        field_id: 'field-1',
        decision: 'accept_proposal',
        proposal_record_id: 'proposal-1',
      },
    });
  });

  it('rejectValue posts a reject decision with no value', async () => {
    apiClientMock.mockResolvedValueOnce({});
    await ExtractionValueService.rejectValue('run-1', 'inst-1', 'field-1');
    expect(apiClientMock).toHaveBeenCalledWith('/api/v1/runs/run-1/decisions', {
      method: 'POST',
      body: {
        instance_id: 'inst-1',
        field_id: 'field-1',
        decision: 'reject',
      },
    });
  });

  it('writes always target the runId passed in (no implicit findActiveRun)', async () => {
    apiClientMock.mockResolvedValue({});
    apiClientMock.mockClear();
    await ExtractionValueService.saveValue('explicit-run', 'inst-1', 'field-1', 1);
    await ExtractionValueService.acceptProposal('explicit-run', 'inst-1', 'field-1', 'p-1');
    await ExtractionValueService.rejectValue('explicit-run', 'inst-1', 'field-1');
    for (const call of apiClientMock.mock.calls) {
      expect(call[0]).toBe('/api/v1/runs/explicit-run/decisions');
    }
  });
});
