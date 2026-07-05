/**
 * D0 producer path, end to end at the hook layer: a REAL accept event flows
 * useAISuggestions.sessionAdoption → deriveAiLinkByKey → useAutoSaveProposals
 * → POST /decisions body with proposal_record_id. No hand-fed link maps —
 * this exercises the exact glue the screens compose, including the
 * same-value-adoption case (value equals the persisted baseline, so only the
 * link changes).
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/api', () => ({
  apiClient: vi.fn(async () => ({})),
}));

vi.mock('@/services/aiSuggestionService', () => ({
  AISuggestionService: {
    getArticleInstanceIds: vi.fn(async () => ['inst-1']),
    loadSuggestions: vi.fn(async () => ({
      suggestions: {
        'inst-1_f-1': {
          id: 'proposal-ai-1',
          runId: 'run-1',
          // The AI's value equals what is already persisted — the hardest
          // case: no value delta, the adoption alone must trigger the write.
          value: 'Retrospective cohort',
          confidence: 0.9,
          reasoning: '',
          status: 'pending',
          timestamp: new Date('2026-07-04T10:00:00Z'),
        },
      },
      count: 1,
    })),
    getHistory: vi.fn(async () => []),
  },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/copy', () => ({
  t: (_ns: string, key: string) => key,
}));

import { apiClient } from '@/integrations/api';
import { useAISuggestions } from '@/hooks/extraction/ai/useAISuggestions';
import { useAutoSaveProposals } from '@/hooks/runs/useAutoSaveProposals';
import { deriveAiLinkByKey } from '@/lib/runs/aiLink';

const apiClientMock = apiClient as unknown as ReturnType<typeof vi.fn>;

const BASELINE = { 'inst-1_f-1': 'Retrospective cohort' };

function useHarness() {
  const [values, setValues] = useState<Record<string, unknown>>({ ...BASELINE });
  const ai = useAISuggestions({
    articleId: 'art-1',
    instanceIds: ['inst-1'],
    runId: 'run-1',
    onSuggestionAccepted: (instanceId, fieldId, value) => {
      // Computed key hoisted: the React Compiler cannot lower a
      // template-literal key inside an object expression.
      const key = instanceId + '_' + fieldId;
      setValues((prev) => ({ ...prev, [key]: value }));
    },
    // Mirrors the screens: reject clears the field.
    onSuggestionRejected: (instanceId, fieldId) => {
      const key = instanceId + '_' + fieldId;
      setValues((prev) => ({ ...prev, [key]: null }));
    },
  });
  const linkByKey = deriveAiLinkByKey({
    decisions: [],
    currentUserId: 'me',
    sessionAdoption: ai.sessionAdoption,
  });
  const autosave = useAutoSaveProposals({
    runId: 'run-1',
    stage: 'extract',
    kind: 'extraction',
    values,
    baselineValues: BASELINE,
    linkByKey,
    baselineLinkByKey: {},
  });
  return { ...ai, ...autosave };
}

describe('D0 producer path (accept → sessionAdoption → linkByKey → autosave body)', () => {
  it('a real accept of a same-value suggestion posts the linked edit decision', async () => {
    const { result } = renderHook(() => useHarness());
    await waitFor(() =>
      expect(Object.keys(result.current.suggestions)).toHaveLength(1),
    );
    expect(apiClientMock).not.toHaveBeenCalledWith(
      '/api/v1/runs/run-1/decisions',
      expect.anything(),
    );

    await act(async () => {
      await result.current.acceptSuggestion('inst-1', 'f-1');
    });
    await act(async () => {
      await result.current.saveNow();
    });

    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/runs/run-1/decisions',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          instance_id: 'inst-1',
          field_id: 'f-1',
          decision: 'edit',
          value: { value: 'Retrospective cohort' },
          proposal_record_id: 'proposal-ai-1',
        }),
      }),
    );
  });

  it('a session reject severs the link on the next write', async () => {
    const { result } = renderHook(() => useHarness());
    await waitFor(() =>
      expect(Object.keys(result.current.suggestions)).toHaveLength(1),
    );

    await act(async () => {
      await result.current.acceptSuggestion('inst-1', 'f-1');
    });
    await act(async () => {
      await result.current.rejectSuggestion('inst-1', 'f-1');
    });
    await act(async () => {
      await result.current.saveNow();
    });

    const decisionCalls = apiClientMock.mock.calls.filter(
      ([url]) => url === '/api/v1/runs/run-1/decisions',
    );
    expect(decisionCalls.length).toBeGreaterThan(0);
    const lastBody = decisionCalls[decisionCalls.length - 1][1].body;
    // Reject bubbles null into the form → the cleared value is written
    // WITHOUT any AI link (the tombstone severed it).
    expect(lastBody.value).toEqual({ value: null });
    expect(lastBody).not.toHaveProperty('proposal_record_id');
  });
});
