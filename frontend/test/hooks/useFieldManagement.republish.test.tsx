/**
 * Field mutations must republish the template version.
 *
 * Template edits are written through PostgREST, so nothing on the backend
 * sees them; article forms render from the run's frozen version snapshot.
 * After every successful field mutation the hook must POST
 * /templates/{id}/republish-version (via templateService) and invalidate the
 * run-view cache so open forms refetch the new schema.
 */

import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {renderHook, waitFor} from '@testing-library/react';
import type {ReactElement, ReactNode} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/services/extractionFieldService', () => ({
  checkProjectPermissions: vi.fn(),
  loadEntityTypeFields: vi.fn(),
  validateFieldImpact: vi.fn(),
  insertField: vi.fn(),
  updateField: vi.fn(),
  deleteField: vi.fn(),
  reorderFields: vi.fn(),
}));
vi.mock('@/services/templateService', () => ({
  republishTemplateVersion: vi.fn(),
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({user: {id: 'user-1'}}),
}));
vi.mock('sonner', () => ({
  toast: {error: vi.fn(), success: vi.fn()},
}));

import {
  checkProjectPermissions,
  insertField,
  loadEntityTypeFields,
  updateField,
  validateFieldImpact,
  deleteField,
} from '@/services/extractionFieldService';
import {republishTemplateVersion} from '@/services/templateService';
import {runsKeys} from '@/hooks/runs/types';
import {useFieldManagement} from '@/hooks/extraction/useFieldManagement';

const permissionsMock = checkProjectPermissions as unknown as ReturnType<typeof vi.fn>;
const loadFieldsMock = loadEntityTypeFields as unknown as ReturnType<typeof vi.fn>;
const insertMock = insertField as unknown as ReturnType<typeof vi.fn>;
const updateMock = updateField as unknown as ReturnType<typeof vi.fn>;
const deleteMock = deleteField as unknown as ReturnType<typeof vi.fn>;
const validateMock = validateFieldImpact as unknown as ReturnType<typeof vi.fn>;
const republishMock = republishTemplateVersion as unknown as ReturnType<typeof vi.fn>;

const FIELD = {
  id: 'f-1',
  entity_type_id: 'et-1',
  name: 'sample_size',
  label: 'Sample size',
  description: null,
  field_type: 'text',
  is_required: false,
  validation_schema: {},
  allowed_values: null,
  unit: null,
  allowed_units: null,
  llm_description: null,
  sort_order: 1,
  created_at: '2024-01-01T00:00:00Z',
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {queries: {retry: false}},
  });
  const wrapper = ({children}: {children: ReactNode}): ReactElement => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return {wrapper, queryClient};
}

function renderFieldManagement() {
  const {wrapper, queryClient} = createWrapper();
  const rendered = renderHook(
    () =>
      useFieldManagement({
        entityTypeId: 'et-1',
        projectId: 'proj-1',
        templateId: 'tpl-1',
      }),
    {wrapper},
  );
  return {...rendered, queryClient};
}

beforeEach(() => {
  vi.clearAllMocks();
  permissionsMock.mockResolvedValue({
    ok: true,
    data: {canView: true, canEdit: true, canDelete: true, canCreate: true, role: 'manager'},
  });
  loadFieldsMock.mockResolvedValue({ok: true, data: [FIELD]});
  validateMock.mockResolvedValue({
    ok: true,
    data: {
      canDelete: true,
      canUpdate: true,
      canChangeType: true,
      extractedValuesCount: 0,
      affectedArticles: [],
    },
  });
  republishMock.mockResolvedValue({
    ok: true,
    data: {version_id: 'v-2', version: 2, changed: true, repinned_run_count: 1},
  });
});

describe('useFieldManagement — republish after mutations', () => {
  it('republishes the template version after a successful addField', async () => {
    insertMock.mockResolvedValue({
      ok: true,
      data: {...FIELD, id: 'f-new', name: 'new_field', label: 'New field'},
    });
    const {result} = renderFieldManagement();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.addField({
      name: 'new_field',
      label: 'New field',
      field_type: 'text',
      is_required: false,
      sort_order: 2,
    });

    expect(republishMock).toHaveBeenCalledWith('proj-1', 'tpl-1');
  });

  it('republishes after a successful updateField and invalidates the runs cache', async () => {
    updateMock.mockResolvedValue({ok: true, data: {...FIELD, label: 'Renamed'}});
    const {result, queryClient} = renderFieldManagement();
    await waitFor(() => expect(result.current.loading).toBe(false));
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await result.current.updateField('f-1', {label: 'Renamed'});

    expect(republishMock).toHaveBeenCalledWith('proj-1', 'tpl-1');
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({queryKey: runsKeys.all}),
      ),
    );
  });

  it('republishes after a successful deleteField', async () => {
    deleteMock.mockResolvedValue({ok: true, data: undefined});
    const {result} = renderFieldManagement();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.deleteField('f-1');

    expect(republishMock).toHaveBeenCalledWith('proj-1', 'tpl-1');
  });

  it('does NOT republish when the mutation fails', async () => {
    updateMock.mockResolvedValue({ok: false, error: {message: 'boom'}});
    const {result} = renderFieldManagement();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.updateField('f-1', {label: 'Renamed'});

    expect(republishMock).not.toHaveBeenCalled();
  });
});
