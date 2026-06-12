/**
 * Regression test for issue #109 — stale-response overwrite in
 * useQAAssessmentSession.
 *
 * When the user navigates between articles while an open() POST is still in
 * flight, the slow response for the *previous* article must not overwrite the
 * session for the current one — otherwise useAutoSaveProposals routes the new
 * article's QA values to the wrong run. The fix is the generation-counter
 * guard (mirroring useExtractionSession); the old cancelledRef toggle could not
 * solve it because React resets it to false before the in-flight Promise reads it.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/qaTemplateService', () => ({
  openQASession: vi.fn(),
}));

import { openQASession } from '@/services/qaTemplateService';
import { useQAAssessmentSession } from '@/hooks/qa/useQAAssessmentSession';

// Alias for readability — the test was originally written against apiClient.
const apiClientMock = openQASession as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useQAAssessmentSession — stale-response guard (#109)', () => {
  it('discards an open() response that resolves after articleId changed', async () => {
    // art-1's open() is slow; art-2's is fast.
    let resolveFirst!: (v: unknown) => void;
    const firstOpen = new Promise((res) => {
      resolveFirst = res;
    });

    // openQASession returns ErrorResult<OpenQASessionResponse>; wrap the raw
    // data in {ok: true, data: ...} to match the service contract.
    const wrapResult = (data: unknown) => ({ok: true, data});
    const firstOpenResult = firstOpen.then(wrapResult);
    apiClientMock.mockReturnValueOnce(firstOpenResult).mockResolvedValue(
      wrapResult({
        run_id: 'run-art2',
        project_template_id: 'tpl-1',
        instances_by_entity_type: {},
      }),
    );

    const { result, rerender } = renderHook(
      ({ articleId }) =>
        useQAAssessmentSession({
          projectId: 'proj-1',
          articleId,
          projectTemplateId: 'tpl-1',
        }),
      { initialProps: { articleId: 'art-1' } },
    );

    // Navigate to art-2 while art-1's open() is still pending.
    rerender({ articleId: 'art-2' });

    // art-2 resolves fast → session points at run-art2.
    await waitFor(() => expect(result.current.session?.runId).toBe('run-art2'));

    // Now let the stale art-1 response arrive. With the generation guard it is
    // discarded; with the old cancelledRef toggle it would overwrite run-art2.
    await act(async () => {
      resolveFirst({
        run_id: 'run-art1-STALE',
        project_template_id: 'tpl-1',
        instances_by_entity_type: {},
      });
    });

    expect(result.current.session?.runId).toBe('run-art2');
    expect(result.current.session?.runId).not.toBe('run-art1-STALE');
  });
});
