import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/api', () => ({
  apiClient: vi.fn(),
}));

vi.mock('@/services/extractionValueService', () => ({
  ExtractionValueService: {
    findActiveRun: vi.fn(),
    acceptProposal: vi.fn(async () => undefined),
    rejectValue: vi.fn(async () => undefined),
  },
}));

import { AISuggestionService } from '@/services/aiSuggestionService';
import { ExtractionValueService } from '@/services/extractionValueService';
import { apiClient } from '@/integrations/api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal server AISuggestionItem fixture */
function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p-1',
    run_id: 'run-A',
    instance_id: 'inst-1',
    field_id: 'f-1',
    proposed_value: { value: 'X' },
    confidence_score: 0.8,
    rationale: 'because',
    created_at: '2026-04-28T10:00:00Z',
    status: 'pending',
    evidence: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// acceptSuggestion / rejectSuggestion — delegate to ExtractionValueService
// ---------------------------------------------------------------------------

describe('AISuggestionService.acceptSuggestion', () => {
  it('uses the provided runId without calling findActiveRun', async () => {
    await AISuggestionService.acceptSuggestion({
      suggestionId: 'proposal-1',
      projectId: 'proj-1',
      articleId: 'art-1',
      instanceId: 'inst-1',
      fieldId: 'field-1',
      value: 'X',
      confidence: 0.9,
      reviewerId: 'user-1',
      runId: 'run-explicit',
    });
    expect(ExtractionValueService.findActiveRun).not.toHaveBeenCalled();
    expect(ExtractionValueService.acceptProposal).toHaveBeenCalledWith(
      'run-explicit',
      'inst-1',
      'field-1',
      'proposal-1',
    );
  });

  it('falls back to findActiveRun when no runId is supplied', async () => {
    (ExtractionValueService.findActiveRun as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'run-fallback',
      stage: 'extract',
      status: 'running',
      template_id: 'tpl-1',
    });
    await AISuggestionService.acceptSuggestion({
      suggestionId: 'proposal-1',
      projectId: 'proj-1',
      articleId: 'art-1',
      instanceId: 'inst-1',
      fieldId: 'field-1',
      value: 'X',
      confidence: 0.9,
      reviewerId: 'user-1',
    });
    expect(ExtractionValueService.findActiveRun).toHaveBeenCalledWith('art-1', null);
    expect(ExtractionValueService.acceptProposal).toHaveBeenCalledWith(
      'run-fallback',
      'inst-1',
      'field-1',
      'proposal-1',
    );
  });
});

describe('AISuggestionService.rejectSuggestion', () => {
  it('uses the provided runId without calling findActiveRun', async () => {
    await AISuggestionService.rejectSuggestion({
      suggestionId: 'proposal-1',
      reviewerId: 'user-1',
      instanceId: 'inst-1',
      fieldId: 'field-1',
      projectId: 'proj-1',
      articleId: 'art-1',
      runId: 'run-explicit',
    });
    expect(ExtractionValueService.findActiveRun).not.toHaveBeenCalled();
    expect(ExtractionValueService.rejectValue).toHaveBeenCalledWith(
      'run-explicit',
      'inst-1',
      'field-1',
    );
  });

  it('falls back to findActiveRun when no runId is supplied', async () => {
    (ExtractionValueService.findActiveRun as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'run-fallback',
      stage: 'extract',
      status: 'running',
      template_id: 'tpl-1',
    });
    await AISuggestionService.rejectSuggestion({
      suggestionId: 'proposal-1',
      reviewerId: 'user-1',
      instanceId: 'inst-1',
      fieldId: 'field-1',
      projectId: 'proj-1',
      articleId: 'art-1',
    });
    expect(ExtractionValueService.findActiveRun).toHaveBeenCalledWith('art-1', null);
    expect(ExtractionValueService.rejectValue).toHaveBeenCalledWith(
      'run-fallback',
      'inst-1',
      'field-1',
    );
  });
});

// ---------------------------------------------------------------------------
// loadSuggestions
// ---------------------------------------------------------------------------

describe('AISuggestionService.loadSuggestions', () => {
  it('short-circuits to empty when instanceIds is empty (no apiClient call)', async () => {
    const result = await AISuggestionService.loadSuggestions('art-1', []);
    expect(result).toEqual({ suggestions: {}, count: 0 });
    expect(apiClient).not.toHaveBeenCalled();
  });

  it('calls the suggestions endpoint with repeated instance_ids params', async () => {
    (apiClient as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      suggestions: [],
      count: 0,
    });
    await AISuggestionService.loadSuggestions('art-1', ['inst-1', 'inst-2']);
    expect(apiClient).toHaveBeenCalledOnce();
    const [path] = (apiClient as ReturnType<typeof vi.fn>).mock.calls[0] as [string, ...unknown[]];
    expect(path).toContain('/api/v1/articles/art-1/suggestions');
    expect(path).toContain('instance_ids=inst-1');
    expect(path).toContain('instance_ids=inst-2');
  });

  it('appends run_id param when provided', async () => {
    (apiClient as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      suggestions: [],
      count: 0,
    });
    await AISuggestionService.loadSuggestions('art-1', ['inst-1'], 'run-A');
    const [path] = (apiClient as ReturnType<typeof vi.fn>).mock.calls[0] as [string, ...unknown[]];
    expect(path).toContain('run_id=run-A');
  });

  it('does NOT append run_id when none is provided', async () => {
    (apiClient as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      suggestions: [],
      count: 0,
    });
    await AISuggestionService.loadSuggestions('art-1', ['inst-1']);
    const [path] = (apiClient as ReturnType<typeof vi.fn>).mock.calls[0] as [string, ...unknown[]];
    expect(path).not.toContain('run_id=');
  });

  it('maps server AISuggestionItem to AISuggestion keyed by instance_field', async () => {
    (apiClient as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      suggestions: [makeItem()],
      count: 1,
    });
    const result = await AISuggestionService.loadSuggestions('art-1', ['inst-1']);
    expect(result.count).toBe(1);
    const sug = result.suggestions['inst-1_f-1'];
    expect(sug).toBeDefined();
    expect(sug.id).toBe('p-1');
    expect(sug.runId).toBe('run-A');
    expect(sug.value).toBe('X'); // unwrapped from {value:'X'}
    expect(sug.confidence).toBe(0.8);
    expect(sug.reasoning).toBe('because');
    expect(sug.status).toBe('pending');
    expect(sug.timestamp).toBeInstanceOf(Date);
    expect(sug.evidence).toBeUndefined(); // evidence=null → undefined
  });

  it('maps evidence when present', async () => {
    (apiClient as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      suggestions: [
        makeItem({
          evidence: {
            text_content: 'verbatim quote',
            page_number: 3,
            proposal_record_id: 'p-1',
          },
        }),
      ],
      count: 1,
    });
    const result = await AISuggestionService.loadSuggestions('art-1', ['inst-1']);
    expect(result.suggestions['inst-1_f-1'].evidence).toEqual({
      text: 'verbatim quote',
      pageNumber: 3,
    });
  });

  it("uses server-provided status='accepted'", async () => {
    (apiClient as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      suggestions: [makeItem({ status: 'accepted' })],
      count: 1,
    });
    const result = await AISuggestionService.loadSuggestions('art-1', ['inst-1']);
    expect(result.suggestions['inst-1_f-1'].status).toBe('accepted');
  });

  it("uses server-provided status='rejected'", async () => {
    (apiClient as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      suggestions: [makeItem({ status: 'rejected' })],
      count: 1,
    });
    const result = await AISuggestionService.loadSuggestions('art-1', ['inst-1']);
    expect(result.suggestions['inst-1_f-1'].status).toBe('rejected');
  });

  it('keeps only the first-wins entry per (instance, field) when server returns dupes', async () => {
    // Server should deduplicate but the guard must be harmless
    (apiClient as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      suggestions: [
        makeItem({ id: 'p-first', proposed_value: { value: 'first' } }),
        makeItem({ id: 'p-second', proposed_value: { value: 'second' } }),
      ],
      count: 2,
    });
    const result = await AISuggestionService.loadSuggestions('art-1', ['inst-1']);
    // first-wins guard keeps p-first
    expect(result.suggestions['inst-1_f-1'].id).toBe('p-first');
  });

  it('throws when apiClient rejects', async () => {
    (apiClient as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('network down'),
    );
    await expect(
      AISuggestionService.loadSuggestions('art-1', ['inst-1']),
    ).rejects.toThrow(/network down/);
  });
});

// ---------------------------------------------------------------------------
// getHistory
// ---------------------------------------------------------------------------

describe('AISuggestionService.getHistory', () => {
  it('calls the history endpoint with instance_id, field_id, and limit', async () => {
    (apiClient as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    await AISuggestionService.getHistory('art-1', 'inst-1', 'f-1', 7);
    const [path] = (apiClient as ReturnType<typeof vi.fn>).mock.calls[0] as [string, ...unknown[]];
    expect(path).toContain('/api/v1/articles/art-1/suggestions/history');
    expect(path).toContain('instance_id=inst-1');
    expect(path).toContain('field_id=f-1');
    expect(path).toContain('limit=7');
  });

  it('default limit is 10', async () => {
    (apiClient as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    await AISuggestionService.getHistory('art-1', 'inst-1', 'f-1');
    const [path] = (apiClient as ReturnType<typeof vi.fn>).mock.calls[0] as [string, ...unknown[]];
    expect(path).toContain('limit=10');
  });

  it('returns mapped history items with evidence', async () => {
    (apiClient as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: 'p-1',
        run_id: 'run-A',
        instance_id: 'inst-1',
        field_id: 'f-1',
        proposed_value: { value: 'V' },
        confidence_score: 0.8,
        rationale: null,
        created_at: '2026-04-28T10:00:00Z',
        evidence: {
          text_content: 'quote',
          page_number: 2,
          proposal_record_id: 'p-1',
        },
      },
    ]);
    const result = await AISuggestionService.getHistory('art-1', 'inst-1', 'f-1');
    expect(result).toHaveLength(1);
    expect(result[0].evidence).toEqual({ text: 'quote', pageNumber: 2 });
    expect(result[0].value).toBe('V');
    expect(result[0].runId).toBe('run-A');
    // History items have no server status — default to 'pending'
    expect(result[0].status).toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// getArticleInstanceIds
// ---------------------------------------------------------------------------

describe('AISuggestionService.getArticleInstanceIds', () => {
  it('calls the instance-ids endpoint and returns the array', async () => {
    (apiClient as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      'inst-1',
      'inst-2',
      'inst-3',
    ]);
    const ids = await AISuggestionService.getArticleInstanceIds('art-1');
    expect(ids).toEqual(['inst-1', 'inst-2', 'inst-3']);
    const [path] = (apiClient as ReturnType<typeof vi.fn>).mock.calls[0] as [string, ...unknown[]];
    expect(path).toBe('/api/v1/articles/art-1/instance-ids');
  });

  it('returns empty array when server returns empty', async () => {
    (apiClient as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const ids = await AISuggestionService.getArticleInstanceIds('art-1');
    expect(ids).toEqual([]);
  });

  it('throws when apiClient rejects', async () => {
    (apiClient as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('instance fail'),
    );
    await expect(
      AISuggestionService.getArticleInstanceIds('art-1'),
    ).rejects.toThrow(/instance fail/);
  });
});
