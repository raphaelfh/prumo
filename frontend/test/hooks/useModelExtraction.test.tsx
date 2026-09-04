/**
 * Regression tests for the fire-and-forget class introduced by the #269
 * zero-bailouts refactor: hooks converted ``try/await/finally`` into a
 * ``doExtract().catch().finally()`` chain but dropped the ``return``, so a
 * caller's ``await extractModels(...)`` resolved immediately while the
 * extraction was still in flight. ``useFullAIExtraction`` then loaded the
 * "extracted" models before any existed and never extracted sections for
 * the new models.
 *
 * These tests pin the promise contract of the real hook against a deferred
 * service response: the returned promise settles only after the service
 * does, and a service failure rejects the caller's promise.
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  serviceExtractModels: vi.fn(),
}));

vi.mock('@/services/sectionExtractionService', () => ({
  SectionExtractionService: { extractModels: h.serviceExtractModels },
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock('@/lib/copy', () => ({
  t: (_ns: string, key: string) => key,
}));

import { toast } from 'sonner';
import { APIError } from '@/lib/ai-extraction/errors';
import { useModelExtraction } from '@/hooks/extraction/useModelExtraction';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const REQUEST = { projectId: 'p1', articleId: 'a1', templateId: 't1' };
const SERVICE_RESULT = {
  data: {
    runId: 'run-1',
    modelsCreated: [{ instanceId: 'inst-1', modelName: 'CatBoost' }],
    metadata: { tokensTotal: 10 },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useModelExtraction promise contract', () => {
  it('the returned promise settles only after the service resolves', async () => {
    const gate = deferred<typeof SERVICE_RESULT>();
    h.serviceExtractModels.mockReturnValue(gate.promise);

    const { result } = renderHook(() => useModelExtraction());

    let settled = false;
    let callerPromise: Promise<void>;
    act(() => {
      callerPromise = result.current.extractModels(REQUEST).then(() => {
        settled = true;
      });
    });

    // Drain microtasks: with the service still pending, the caller's await
    // must NOT have resolved (the fire-and-forget bug resolved it here).
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(settled).toBe(false);

    await act(async () => {
      gate.resolve(SERVICE_RESULT);
      await callerPromise;
    });
    expect(settled).toBe(true);
  });

  it('onSuccess receives the created models so callers can chain per-model extraction', async () => {
    h.serviceExtractModels.mockResolvedValue(SERVICE_RESULT);
    const onSuccess = vi.fn();

    const { result } = renderHook(() => useModelExtraction({ onSuccess }));
    await act(async () => {
      await result.current.extractModels(REQUEST);
    });

    expect(onSuccess).toHaveBeenCalledWith('run-1', 1, [
      { instanceId: 'inst-1', modelName: 'CatBoost' },
    ]);
  });

  it('a service failure rejects the caller promise (allSettled sees it)', async () => {
    h.serviceExtractModels.mockRejectedValue(new Error('extraction failed'));

    const { result } = renderHook(() => useModelExtraction());

    let outcome: PromiseSettledResult<void> | null = null;
    await act(async () => {
      [outcome] = await Promise.allSettled([result.current.extractModels(REQUEST)]);
    });
    expect(outcome).not.toBeNull();
    expect(outcome!.status).toBe('rejected');
    // The generic fallback still fires for an unclassified failure.
    expect(toast.error).toHaveBeenCalledWith('modelExtractionErrorTitle: extraction failed');
  });

  it('a MISSING_ENTITY_KEY envelope shows the entry-key toast with the backend message', async () => {
    const message = "The repeating section 'Prediction models' declares no entry key.";
    h.serviceExtractModels.mockRejectedValue(
      new APIError(message, 409, { traceId: 'tr-1' }, 'MISSING_ENTITY_KEY'),
    );

    const { result } = renderHook(() => useModelExtraction());
    await act(async () => {
      await Promise.allSettled([result.current.extractModels(REQUEST)]);
    });

    expect(toast.error).toHaveBeenCalledWith('sectionExtractionErrorNoEntryKey', {
      description: message,
      duration: 8000,
    });
  });
});
