/**
 * useAddEntry — the run form's add-entry flow.
 *
 * What matters here is that the hook writes through the TYPED endpoint and
 * not through a browser-side insert: the key value is recorded as a
 * ReviewerDecision, which only the server may author, and the singleton
 * children have to land in the same transaction.
 */
import {act, renderHook, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

// Mocks define their fakes INLINE and are imported back below. A factory
// that closes over a top-level `const` is hoisted above that declaration,
// which vitest rejects — it passed locally and failed in CI.
// `importActual` keeps the REAL `ApiError`, so `instanceof` in the hook
// tests the class the hook actually sees rather than a hand-mirrored copy.
vi.mock('@/integrations/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/integrations/api/client')>(
    '@/integrations/api/client',
  );
  return {...actual, createEntry: vi.fn()};
});

vi.mock('sonner', () => ({
  toast: {error: vi.fn(), success: vi.fn()},
}));

import {toast} from 'sonner';

import {ApiError, createEntry as createEntryImport} from '@/integrations/api/client';
import {useAddEntry} from '@/hooks/extraction/useAddEntry';
import type {ExtractionEntityTypeWithFields, ExtractionInstance} from '@/types/extraction';

const createEntry = vi.mocked(createEntryImport);
const toastError = vi.mocked(toast.error);
const toastSuccess = vi.mocked(toast.success);

const KEY_FIELD = {
  id: 'f-key',
  entity_type_id: 'et-root',
  name: 'model_name',
  label: 'Model name',
  field_type: 'text',
  is_entity_key: true,
  sort_order: 0,
} as unknown as ExtractionEntityTypeWithFields['fields'][number];

const ROOT_GROUP = {
  id: 'et-root',
  name: 'prediction_models',
  label: 'Prediction Models',
  cardinality: 'many',
  parent_entity_type_id: null,
  entry_label: 'model',
  sort_order: 0,
  fields: [KEY_FIELD],
} as unknown as ExtractionEntityTypeWithFields;

const NESTED_GROUP = {
  ...ROOT_GROUP,
  id: 'et-nested',
  name: 'final_predictors',
  label: 'Final Predictors',
  parent_entity_type_id: 'et-root',
  entry_label: 'predictor',
  fields: [],
} as unknown as ExtractionEntityTypeWithFields;

const ACTIVE_MODEL = {
  id: 'inst-active-model',
  entity_type_id: 'et-root',
  parent_instance_id: null,
  label: 'Cox Model',
} as unknown as ExtractionInstance;

function setup(overrides: Partial<Parameters<typeof useAddEntry>[0]> = {}) {
  const onCreated = vi.fn().mockResolvedValue(undefined);
  const hook = renderHook(() =>
    useAddEntry({
      projectId: 'p-1',
      articleId: 'a-1',
      templateId: 't-1',
      entityTypes: [ROOT_GROUP, NESTED_GROUP],
      instances: [ACTIVE_MODEL],
      modelParentEntityTypeId: 'et-root',
      activeModelId: 'inst-active-model',
      onCreated,
      ...overrides,
    }),
  );
  return {hook, onCreated};
}

beforeEach(() => {
  createEntry.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
});

describe('useAddEntry', () => {
  it('creates the entry through the typed endpoint, not a browser insert', async () => {
    createEntry.mockResolvedValue({instanceId: 'inst-new', label: 'XGBoost'});
    const {hook, onCreated} = setup();

    act(() => hook.result.current.open('et-root'));
    await act(async () => {
      await hook.result.current.dialogProps.onConfirm('XGBoost');
    });

    expect(createEntry).toHaveBeenCalledWith({
      projectId: 'p-1',
      articleId: 'a-1',
      templateId: 't-1',
      entityTypeId: 'et-root',
      parentInstanceId: null,
      label: 'XGBoost',
      entityKey: 'XGBoost',
    });
    // The SERVER records the key as the reviewer's decision inside the
    // create transaction; writing it again locally would let autosave POST
    // a second, identical row into an append-only trail.
    expect(onCreated).toHaveBeenCalled();
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  it('passes the enclosing entry as parentInstanceId for a nested group', async () => {
    createEntry.mockResolvedValue({instanceId: 'inst-nested', label: 'Age'});
    const {hook} = setup();

    act(() => hook.result.current.open('et-nested'));
    await act(async () => {
      await hook.result.current.dialogProps.onConfirm('Age');
    });

    expect(createEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        entityTypeId: 'et-nested',
        parentInstanceId: 'inst-active-model',
        // No key field on this section: the human path creates it from a
        // label alone rather than refusing.
        entityKey: null,
      }),
    );
  });

  it('REJECTS on the duplicate refusal, with the message the dialog shows', async () => {
    // AddEntryDialog sets `loading` before awaiting onConfirm and clears it
    // ONLY in its catch. A handled-here failure leaves the dialog stuck on
    // "Creating…" with Cancel disabled and onOpenChange refusing to close —
    // so rejecting is the contract, not an implementation detail.
    createEntry.mockRejectedValue(new ApiError('ENTRY_KEY_DUPLICATE', 'already exists', 409));
    const {hook, onCreated} = setup();

    act(() => hook.result.current.open('et-root'));
    await act(async () => {
      // Pin text ONLY the copy key carries: asserting on "already exists"
      // would also match the raw server message and pass with the typed
      // branch deleted.
      await expect(
        hook.result.current.dialogProps.onConfirm('Cox Model'),
      ).rejects.toThrow(/Open it instead/);
    });

    // A refusal must not look like a success.
    expect(onCreated).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('rethrows any other failure rather than swallowing it', async () => {
    createEntry.mockRejectedValue(new ApiError('EXTRACTION_FAILED', 'boom', 500));
    const {hook, onCreated} = setup();

    act(() => hook.result.current.open('et-root'));
    await act(async () => {
      await expect(
        hook.result.current.dialogProps.onConfirm('XGBoost'),
      ).rejects.toThrow('boom');
    });

    expect(onCreated).not.toHaveBeenCalled();
  });

  it('refuses to open a nested group with no active parent entry', () => {
    const {hook} = setup({activeModelId: null});

    act(() => hook.result.current.open('et-nested'));

    expect(hook.result.current.dialogProps.open).toBe(false);
    expect(toastError).toHaveBeenCalled();
    expect(createEntry).not.toHaveBeenCalled();
  });
});
