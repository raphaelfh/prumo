/**
 * useTemplateConfigCaches / useTemplateRepublish — the B-4 invalidation
 * contract. No other test guards the worklist against going stale after
 * Publish (templateActiveStructureKeys), or the runs cache against
 * churning on every draft edit — this file is that guard.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {renderHook, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const republishTemplateVersion = vi.fn();
// The refusal class comes from the MOCKED module, so the `instanceof`
// branch in the hook matches exactly what these tests hand it.
const {TemplatePublishRefusal} = vi.hoisted(() => {
  class TemplatePublishRefusal extends Error {
    constructor(
      message: string,
      public readonly code: string,
      public readonly sectionLabels: readonly string[] = [],
    ) {
      super(message);
      this.name = 'TemplatePublishRefusal';
    }
  }
  return {TemplatePublishRefusal};
});
vi.mock('@/services/templateService', () => ({
  republishTemplateVersion: (...a: unknown[]) => republishTemplateVersion(...a),
  TemplatePublishRefusal,
}));
vi.mock('sonner', () => ({
  toast: {success: vi.fn(), error: vi.fn()},
}));

import {
  useTemplateConfigCaches,
  useTemplateRepublish,
} from '@/hooks/extraction/useTemplateRepublish';
import {runsKeys} from '@/hooks/runs/types';
import {extraction, templateConfig} from '@/lib/copy';
import {
  templateActiveStructureKeys,
  templateConfigStatusKeys,
  templateEntityTypesKeys,
  templateInstructionKeys,
} from '@/lib/query-keys/extraction';
import {toast} from 'sonner';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {queries: {retry: false}},
  });
  return {
    queryClient,
    wrapper: ({children}: {children: ReactNode}) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useTemplateConfigCaches', () => {
  it('invalidateStructure refreshes grid + chip and NEVER touches runs', async () => {
    const {queryClient, wrapper} = createWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const {result} = renderHook(() => useTemplateConfigCaches('p1', 't1'), {
      wrapper,
    });

    await result.current.invalidateStructure();

    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({queryKey: templateEntityTypesKeys.byTemplate('t1')}),
    );
    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: templateConfigStatusKeys.byTemplate('p1', 't1'),
      }),
    );
    expect(invalidate).not.toHaveBeenCalledWith(
      expect.objectContaining({queryKey: runsKeys.all}),
    );
    expect(invalidate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: templateActiveStructureKeys.byTemplate('p1', 't1'),
      }),
    );
  });

  it('invalidateAll additionally refreshes runs + the ACTIVE structure', async () => {
    const {queryClient, wrapper} = createWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const {result} = renderHook(() => useTemplateConfigCaches('p1', 't1'), {
      wrapper,
    });

    await result.current.invalidateAll();

    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({queryKey: templateEntityTypesKeys.byTemplate('t1')}),
    );
    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: templateConfigStatusKeys.byTemplate('p1', 't1'),
      }),
    );
    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({queryKey: runsKeys.all}),
    );
    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: templateActiveStructureKeys.byTemplate('p1', 't1'),
      }),
    );
  });

  it('invalidateAfterImport hits the .all families (import may target a DIFFERENT template)', async () => {
    const {queryClient, wrapper} = createWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const {result} = renderHook(() => useTemplateConfigCaches('p1', 't1'), {
      wrapper,
    });

    await result.current.invalidateAfterImport();

    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({queryKey: templateEntityTypesKeys.all}),
    );
    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({queryKey: templateConfigStatusKeys.all}),
    );
    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({queryKey: templateActiveStructureKeys.all}),
    );
    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({queryKey: runsKeys.all}),
    );
  });

  it('invalidateAfterDiscard refreshes grid + chip + INSTRUCTION, and nothing else (B-9c2 D7)', async () => {
    const {queryClient, wrapper} = createWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const {result} = renderHook(() => useTemplateConfigCaches('p1', 't1'), {
      wrapper,
    });

    await result.current.invalidateAfterDiscard();

    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({queryKey: templateEntityTypesKeys.byTemplate('t1')}),
    );
    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: templateConfigStatusKeys.byTemplate('p1', 't1'),
      }),
    );
    // Discard can reset the general AI instruction to its published text
    // (DiscardDraftResponse.instruction_reset) — the cached row must re-read.
    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: templateInstructionKeys.byTemplate('p1', 't1'),
      }),
    );
    // A discard leaves the ACTIVE version untouched, so these stay correct;
    // refetching the runs tree would be pure waste.
    expect(invalidate).not.toHaveBeenCalledWith(
      expect.objectContaining({queryKey: runsKeys.all}),
    );
    expect(invalidate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: templateActiveStructureKeys.byTemplate('p1', 't1'),
      }),
    );
  });

  it('is inert without ids', async () => {
    const {queryClient, wrapper} = createWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const {result} = renderHook(
      () => useTemplateConfigCaches(undefined, undefined),
      {wrapper},
    );

    await result.current.invalidateStructure();
    await result.current.invalidateAll();
    await result.current.invalidateAfterDiscard();

    expect(invalidate).not.toHaveBeenCalled();

    // Import invalidation is id-free by design (.all families).
    await result.current.invalidateAfterImport();
    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({queryKey: templateEntityTypesKeys.all}),
    );
  });
});

describe('useTemplateRepublish (the Publish path)', () => {
  it('returns the publish result and runs the full invalidation', async () => {
    republishTemplateVersion.mockResolvedValue({
      ok: true,
      data: {version_id: 'v-2', version: 2, changed: true, repinned_run_count: 3},
    });
    const {queryClient, wrapper} = createWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const {result} = renderHook(() => useTemplateRepublish('p1', 't1'), {
      wrapper,
    });

    const outcome = await result.current.republish({expected_fingerprint: 'fp'});

    expect(outcome).toEqual({
      version_id: 'v-2',
      version: 2,
      changed: true,
      repinned_run_count: 3,
    });
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith(
        expect.objectContaining({queryKey: runsKeys.all}),
      ),
    );
  });

  it('keeps the GENERIC copy for a failure that is not the typed refusal', async () => {
    republishTemplateVersion.mockResolvedValue({
      ok: false,
      error: {message: 'boom'},
    });
    const {queryClient, wrapper} = createWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const {result} = renderHook(() => useTemplateRepublish('p1', 't1'), {
      wrapper,
    });

    const outcome = await result.current.republish({expected_fingerprint: 'fp'});

    expect(outcome).toBeNull();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(extraction.errors_republishTemplate);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('composes the local copy from the refusal, naming EVERY section (B-9b0 D4)', async () => {
    // The server prose is diagnostic, not the contract: the code and the
    // labels are, and the sentence the manager reads is ours.
    republishTemplateVersion.mockResolvedValue({
      ok: false,
      error: new TemplatePublishRefusal(
        'SERVER PROSE the UI must not echo',
        'PUBLISH_BLOCKED_BY_MULTI_ENTRY',
        ['Final predictors', 'Model results'],
      ),
    });
    const {queryClient, wrapper} = createWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const {result} = renderHook(() => useTemplateRepublish('p1', 't1'), {
      wrapper,
    });

    const outcome = await result.current.republish({expected_fingerprint: 'fp'});

    expect(outcome).toBeNull();
    expect(toast.error).toHaveBeenCalledWith(
      templateConfig.errors_publishBlockedOther.replace(
        '{{sections}}',
        '“Final predictors”, “Model results”',
      ),
    );
    expect(vi.mocked(toast.error).mock.calls[0][0]).not.toContain('SERVER PROSE');
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('reads as a singular sentence for one offending section', async () => {
    republishTemplateVersion.mockResolvedValue({
      ok: false,
      error: new TemplatePublishRefusal('prose', 'PUBLISH_BLOCKED_BY_MULTI_ENTRY', [
        'Final predictors',
      ]),
    });
    const {wrapper} = createWrapper();
    const {result} = renderHook(() => useTemplateRepublish('p1', 't1'), {wrapper});

    await result.current.republish({expected_fingerprint: 'fp'});

    expect(toast.error).toHaveBeenCalledWith(
      templateConfig.errors_publishBlockedOne.replace(
        '{{sections}}',
        '“Final predictors”',
      ),
    );
  });

  it('falls back to the nameless refusal copy when the payload carried no labels', async () => {
    // Still a policy refusal, so it must not read like a server fault —
    // it just cannot name names (the discardConfirmBodyPlain precedent).
    republishTemplateVersion.mockResolvedValue({
      ok: false,
      error: new TemplatePublishRefusal('prose', 'PUBLISH_BLOCKED_BY_MULTI_ENTRY', []),
    });
    const {wrapper} = createWrapper();
    const {result} = renderHook(() => useTemplateRepublish('p1', 't1'), {wrapper});

    await result.current.republish({expected_fingerprint: 'fp'});

    expect(toast.error).toHaveBeenCalledWith(templateConfig.errors_publishBlockedPlain);
  });
});
