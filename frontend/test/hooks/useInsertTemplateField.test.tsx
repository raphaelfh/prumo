/**
 * useInsertTemplateField — the ghost-row Enter-chain's serialized insert
 * queue (B-5 Task 4). The five concurrency rules under test:
 *
 *   1. reconcile by client key: the panel learns `clientKey → server row`
 *      through `onConfirmed` (optimistic rows are panel-local state)
 *   2. structure invalidation is SUPPRESSED while the queue is non-empty
 *      and fires ONCE on drain
 *   3. sort_order is computed at DEQUEUE time, counting inserts already
 *      committed this session in the section — two chained inserts get
 *      distinct values
 *   4. the collision suffix sees IN-QUEUE names too (there is NO unique
 *      constraint on (entity_type_id, name); a stale suffix would insert
 *      silent duplicates) — and a collision NEVER dead-ends with a toast
 *   5. updates on a still-pending row queue BEHIND its insert by client
 *      key and run against the returned server id
 *
 * Plus: the permission probe is hoisted ONCE per queue session, and the
 * B-4 invariant migrates here — inserts NEVER republish.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {renderHook, waitFor} from '@testing-library/react';
import type {ReactElement, ReactNode} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/services/extractionFieldService', () => ({
  checkProjectPermissions: vi.fn(),
  insertField: vi.fn(),
  updateField: vi.fn(),
}));
vi.mock('@/services/templateService', () => ({
  republishTemplateVersion: vi.fn(),
  loadTemplateConfigStatus: vi.fn(),
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({user: {id: 'user-1'}}),
}));
vi.mock('sonner', () => ({
  toast: {error: vi.fn(), success: vi.fn()},
}));

import {toast} from 'sonner';

import {
  checkProjectPermissions,
  insertField,
  updateField,
} from '@/services/extractionFieldService';
import {republishTemplateVersion} from '@/services/templateService';
import {templateEntityTypesKeys} from '@/lib/query-keys/extraction';
import {
  resetTemplateFieldInsertQueueForTests,
  useInsertTemplateField,
} from '@/hooks/extraction/useInsertTemplateField';

const permissionsMock = checkProjectPermissions as unknown as ReturnType<typeof vi.fn>;
const insertMock = insertField as unknown as ReturnType<typeof vi.fn>;
const updateMock = updateField as unknown as ReturnType<typeof vi.fn>;
const republishMock = republishTemplateVersion as unknown as ReturnType<typeof vi.fn>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return {promise, resolve};
}

const serverRow = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  entity_type_id: 'sec',
  name: 'peso',
  label: 'Peso',
  description: null,
  field_type: 'text',
  is_required: false,
  validation_schema: {},
  allowed_values: null,
  unit: null,
  allowed_units: null,
  llm_description: null,
  sort_order: 1,
  ...over,
});

/** Flush the microtask queue a few times (the queue chains promises). */
async function flush() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: {queries: {retry: false}},
  });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const onConfirmed = vi.fn();
  const onFailed = vi.fn();
  const onDrained = vi.fn();
  const wrapper = ({children}: {children: ReactNode}): ReactElement => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const {result} = renderHook(
    () =>
      useInsertTemplateField({
        projectId: 'p1',
        templateId: 't1',
        onConfirmed,
        onFailed,
        onDrained,
      }),
    {wrapper},
  );
  return {result, invalidateSpy, onConfirmed, onFailed, onDrained};
}

const structureInvalidations = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.filter((call: unknown[]) => {
    const arg = call[0] as {queryKey?: unknown} | undefined;
    return (
      JSON.stringify(arg?.queryKey) ===
      JSON.stringify(templateEntityTypesKeys.byTemplate('t1'))
    );
  });

beforeEach(() => {
  vi.clearAllMocks();
  resetTemplateFieldInsertQueueForTests();
  permissionsMock.mockResolvedValue({
    ok: true,
    data: {canView: true, canEdit: true, canDelete: true, canCreate: true, role: 'manager'},
  });
  insertMock.mockImplementation((row: {name: string}) =>
    Promise.resolve({ok: true, data: serverRow(`srv-${row.name}`, {name: row.name})}),
  );
  updateMock.mockResolvedValue({ok: true, data: serverRow('srv-peso')});
});

describe('useInsertTemplateField — queue serialization', () => {
  it('serializes inserts: the second write waits for the first', async () => {
    const gate = deferred<{ok: true; data: ReturnType<typeof serverRow>}>();
    insertMock.mockImplementationOnce(() => gate.promise);
    const {result} = setup();

    result.current.enqueueInsert({
      entityTypeId: 'sec',
      label: 'Peso',
      existingNames: [],
      baseSortOrder: 0,
    });
    result.current.enqueueInsert({
      entityTypeId: 'sec',
      label: 'Altura',
      existingNames: [],
      baseSortOrder: 0,
    });

    await waitFor(() => expect(insertMock).toHaveBeenCalledTimes(1));
    await flush();
    expect(insertMock).toHaveBeenCalledTimes(1);

    gate.resolve({ok: true, data: serverRow('srv-1')});
    await waitFor(() => expect(insertMock).toHaveBeenCalledTimes(2));
  });

  it('two inserts in the same section get DISTINCT sort_order, computed at dequeue', async () => {
    const {result} = setup();
    result.current.enqueueInsert({
      entityTypeId: 'sec',
      label: 'Peso',
      existingNames: ['weight'],
      baseSortOrder: 5,
    });
    result.current.enqueueInsert({
      entityTypeId: 'sec',
      label: 'Altura',
      existingNames: ['weight'],
      baseSortOrder: 5,
    });

    await waitFor(() => expect(insertMock).toHaveBeenCalledTimes(2));
    expect(insertMock.mock.calls[0][0]).toMatchObject({name: 'peso', sort_order: 6});
    expect(insertMock.mock.calls[1][0]).toMatchObject({name: 'altura', sort_order: 7});
  });

  it('hoists the permission probe ONCE per queue session', async () => {
    const {result, onDrained} = setup();
    result.current.enqueueInsert({
      entityTypeId: 'sec',
      label: 'A one',
      existingNames: [],
      baseSortOrder: 0,
    });
    result.current.enqueueInsert({
      entityTypeId: 'sec',
      label: 'B two',
      existingNames: [],
      baseSortOrder: 0,
    });
    result.current.enqueueInsert({
      entityTypeId: 'sec',
      label: 'C three',
      existingNames: [],
      baseSortOrder: 0,
    });

    await waitFor(() => expect(onDrained).toHaveBeenCalledTimes(1));
    expect(permissionsMock).toHaveBeenCalledTimes(1);

    // A NEW chain after the drain is a NEW session — it probes again.
    result.current.enqueueInsert({
      entityTypeId: 'sec',
      label: 'D four',
      existingNames: [],
      baseSortOrder: 0,
    });
    await waitFor(() => expect(onDrained).toHaveBeenCalledTimes(2));
    expect(permissionsMock).toHaveBeenCalledTimes(2);
  });
});

describe('useInsertTemplateField — collision suffix (rule 4)', () => {
  it('suffixes against committed AND in-queue names — never a dead-end toast', async () => {
    const {result, onDrained} = setup();
    const first = result.current.enqueueInsert({
      entityTypeId: 'sec',
      label: 'Sample size',
      existingNames: ['sample_size'],
      baseSortOrder: 1,
    });
    // The second collides with the FIRST, which is still only in-queue.
    const second = result.current.enqueueInsert({
      entityTypeId: 'sec',
      label: 'Sample size',
      existingNames: ['sample_size'],
      baseSortOrder: 1,
    });

    expect(first.name).toBe('sample_size_2');
    expect(second.name).toBe('sample_size_3');
    await waitFor(() => expect(onDrained).toHaveBeenCalledTimes(1));
    expect(insertMock.mock.calls[0][0]).toMatchObject({name: 'sample_size_2'});
    expect(insertMock.mock.calls[1][0]).toMatchObject({name: 'sample_size_3'});
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('useInsertTemplateField — reconcile + drain (rules 1, 2)', () => {
  it('confirms each insert by CLIENT KEY with the server row', async () => {
    const {result, onConfirmed} = setup();
    const enqueued = result.current.enqueueInsert({
      entityTypeId: 'sec',
      label: 'Peso',
      existingNames: [],
      baseSortOrder: 0,
    });

    await waitFor(() => expect(onConfirmed).toHaveBeenCalledTimes(1));
    expect(onConfirmed).toHaveBeenCalledWith(
      enqueued.clientKey,
      expect.objectContaining({id: 'srv-peso', name: 'peso'}),
    );
  });

  it('suppresses structure invalidation mid-chain and invalidates ONCE on drain', async () => {
    const gate = deferred<{ok: true; data: ReturnType<typeof serverRow>}>();
    insertMock
      .mockImplementationOnce(() =>
        Promise.resolve({ok: true, data: serverRow('srv-1', {name: 'peso'})}),
      )
      .mockImplementationOnce(() => gate.promise);
    const {result, invalidateSpy, onDrained} = setup();

    result.current.enqueueInsert({
      entityTypeId: 'sec',
      label: 'Peso',
      existingNames: [],
      baseSortOrder: 0,
    });
    result.current.enqueueInsert({
      entityTypeId: 'sec',
      label: 'Altura',
      existingNames: [],
      baseSortOrder: 0,
    });

    // First insert confirmed, second still in flight: NO invalidation yet.
    await waitFor(() => expect(insertMock).toHaveBeenCalledTimes(2));
    expect(structureInvalidations(invalidateSpy)).toHaveLength(0);

    gate.resolve({ok: true, data: serverRow('srv-2', {name: 'altura'})});
    await waitFor(() => expect(onDrained).toHaveBeenCalledTimes(1));
    expect(structureInvalidations(invalidateSpy)).toHaveLength(1);
  });

  it('NEVER republishes — inserts are draft edits (B-4 invariant, migrated here)', async () => {
    const {result, onDrained} = setup();
    result.current.enqueueInsert({
      entityTypeId: 'sec',
      label: 'Peso',
      existingNames: [],
      baseSortOrder: 0,
    });
    result.current.enqueueInsert({
      entityTypeId: 'sec',
      label: 'Altura',
      existingNames: [],
      baseSortOrder: 0,
    });

    await waitFor(() => expect(onDrained).toHaveBeenCalledTimes(1));
    expect(republishMock).not.toHaveBeenCalled();
  });
});

describe('useInsertTemplateField — updates behind inserts (rule 5)', () => {
  it('queues an edit on a still-pending row BEHIND its insert, remapped to the server id', async () => {
    const gate = deferred<{ok: true; data: ReturnType<typeof serverRow>}>();
    insertMock.mockImplementationOnce(() => gate.promise);
    const {result} = setup();

    const enqueued = result.current.enqueueInsert({
      entityTypeId: 'sec',
      label: 'Peso',
      existingNames: [],
      baseSortOrder: 0,
    });
    result.current.enqueueUpdate(enqueued.clientKey, {label: 'Peso corporal'});

    await flush();
    expect(updateMock).not.toHaveBeenCalled();

    gate.resolve({ok: true, data: serverRow('srv-1', {name: 'peso'})});
    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith('srv-1', {label: 'Peso corporal'}),
    );
  });

  it('drops the queued update silently when its insert failed (the row is gone)', async () => {
    insertMock.mockResolvedValueOnce({ok: false, error: {message: 'boom'}});
    const {result, onFailed, onDrained} = setup();

    const enqueued = result.current.enqueueInsert({
      entityTypeId: 'sec',
      label: 'Peso',
      existingNames: [],
      baseSortOrder: 0,
    });
    result.current.enqueueUpdate(enqueued.clientKey, {label: 'Peso corporal'});

    await waitFor(() => expect(onDrained).toHaveBeenCalledTimes(1));
    expect(onFailed).toHaveBeenCalledWith(enqueued.clientKey);
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe('useInsertTemplateField — failure paths', () => {
  it('a failed insert drops its row and the chain CONTINUES to the next', async () => {
    insertMock.mockResolvedValueOnce({ok: false, error: {message: 'boom'}});
    const {result, onConfirmed, onFailed, onDrained} = setup();

    const first = result.current.enqueueInsert({
      entityTypeId: 'sec',
      label: 'Peso',
      existingNames: [],
      baseSortOrder: 0,
    });
    result.current.enqueueInsert({
      entityTypeId: 'sec',
      label: 'Altura',
      existingNames: [],
      baseSortOrder: 0,
    });

    await waitFor(() => expect(onDrained).toHaveBeenCalledTimes(1));
    expect(onFailed).toHaveBeenCalledWith(first.clientKey);
    expect(onConfirmed).toHaveBeenCalledTimes(1);
    expect(onConfirmed).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({name: 'altura'}),
    );
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('a denied permission probe fails every queued insert with ONE toast and no writes', async () => {
    permissionsMock.mockResolvedValue({
      ok: true,
      data: {canView: true, canEdit: false, canDelete: false, canCreate: false, role: 'reviewer'},
    });
    const {result, onFailed, onDrained} = setup();

    result.current.enqueueInsert({
      entityTypeId: 'sec',
      label: 'Peso',
      existingNames: [],
      baseSortOrder: 0,
    });
    result.current.enqueueInsert({
      entityTypeId: 'sec',
      label: 'Altura',
      existingNames: [],
      baseSortOrder: 0,
    });

    await waitFor(() => expect(onDrained).toHaveBeenCalledTimes(1));
    expect(insertMock).not.toHaveBeenCalled();
    expect(onFailed).toHaveBeenCalledTimes(2);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });
});
