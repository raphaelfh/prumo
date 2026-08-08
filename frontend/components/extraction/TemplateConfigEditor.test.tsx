/**
 * TemplateConfigEditor — editor-hosted DeleteFieldConfirm (B-5 Task 7).
 *
 * The delete confirm mounts in the EDITOR, outside the grid panel's
 * React subtree: a Radix dialog rendered inside the panel would bubble
 * its dismiss-Esc (portals propagate through the REACT tree) into the
 * panel's `handleEscapeEscalate` and close the inspector as a side
 * effect. These tests pin the hosting, the small dedicated delete
 * mutation path (service + invalidateStructure — not useFieldManagement)
 * and that Esc regression.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));
vi.mock('sonner', () => ({toast: {error: vi.fn(), success: vi.fn()}}));
vi.mock('@/services/templateService', () => ({
  loadTemplateEntityTypes: vi.fn(),
  updateEntityTypeLabel: vi.fn(),
}));
vi.mock('@/services/extractionFieldService', () => ({
  validateFieldImpact: vi.fn(),
  deleteField: vi.fn(),
}));
vi.mock('@/hooks/extraction/useTemplateRepublish', () => ({
  useTemplateConfigCaches: vi.fn(),
}));
vi.mock('@/hooks/extraction/useTemplateEntityTypes', () => ({
  useTemplateEntityTypes: vi.fn(),
}));
vi.mock('@/hooks/extraction/useUpdateTemplateField', () => ({
  useUpdateTemplateField: vi.fn(),
}));
vi.mock('@/hooks/extraction/useInsertTemplateField', () => ({
  useInsertTemplateField: vi.fn(),
}));
vi.mock('@/hooks/shared/useContainerNarrow', () => ({
  useContainerNarrow: vi.fn(() => false),
}));
// Heavy siblings with their own data paths — not under test here.
vi.mock('@/components/extraction/TemplateInstructionRow', () => ({
  TemplateInstructionRow: () => null,
}));
vi.mock('@/components/extraction/template-config/TemplateConfigPublishControls', () => ({
  TemplateConfigPublishControls: () => null,
}));
vi.mock('@/components/extraction/template-config/TemplateFieldDialogs', () => ({
  TemplateFieldDialogs: () => null,
}));
vi.mock('./dialogs', () => ({
  AddSectionDialog: () => null,
  RemoveSectionDialog: () => null,
  ImportTemplateDialog: () => null,
}));

import {TooltipProvider} from '@/components/ui/tooltip';
import {useTemplateEntityTypes} from '@/hooks/extraction/useTemplateEntityTypes';
import {useInsertTemplateField} from '@/hooks/extraction/useInsertTemplateField';
import {useTemplateConfigCaches} from '@/hooks/extraction/useTemplateRepublish';
import {useUpdateTemplateField} from '@/hooks/extraction/useUpdateTemplateField';
import {deleteField, validateFieldImpact} from '@/services/extractionFieldService';
import {loadTemplateEntityTypes} from '@/services/templateService';
import type {FieldValidationResult} from '@/types/extraction';

import {TemplateConfigEditor} from './TemplateConfigEditor';

const SECTION = {
  id: 'sec',
  name: 'sec_a',
  label: 'Section A',
  description: null,
  role: 'study_section',
  cardinality: 'one',
  parent_entity_type_id: null,
  sort_order: 1,
};

const FIELDS = [
  {
    id: 'f1',
    entity_type_id: 'sec',
    name: 'q1',
    label: 'Study design',
    description: null,
    field_type: 'text',
    is_required: false,
    allowed_values: null,
    llm_description: null,
    sort_order: 1,
  },
];

function renderEditor() {
  const queryClient = new QueryClient({
    defaultOptions: {mutations: {retry: false}},
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <TemplateConfigEditor projectId="p1" templateId="t1" />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const invalidateStructure = vi.fn(async () => {});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadTemplateEntityTypes).mockResolvedValue({
    ok: true,
    data: [SECTION] as never,
  });
  vi.mocked(useTemplateConfigCaches).mockReturnValue({
    invalidateStructure,
    invalidateAll: vi.fn(async () => {}),
    invalidateAfterImport: vi.fn(async () => {}),
  });
  vi.mocked(useTemplateEntityTypes).mockReturnValue({
    entityTypes: [{...SECTION, fields: FIELDS}] as never,
    isLoading: false,
    isError: false,
    error: null,
  } as never);
  vi.mocked(useUpdateTemplateField).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as never);
  vi.mocked(useInsertTemplateField).mockReturnValue({
    enqueueInsert: vi.fn(() => ({clientKey: 'pending-1', name: 'peso'})),
    enqueueUpdate: vi.fn(),
  });
  vi.mocked(validateFieldImpact).mockResolvedValue({
    ok: true,
    data: {
      canDelete: true,
      canUpdate: true,
      canChangeType: true,
      extractedValuesCount: 0,
      affectedArticles: [],
      message: 'safe',
    } satisfies FieldValidationResult,
  });
  vi.mocked(deleteField).mockResolvedValue({ok: true, data: undefined});
});

async function openDeleteDialog() {
  await userEvent.click(
    screen.getAllByRole('button', {name: /actionsForFieldAria/})[0],
  );
  await userEvent.click(await screen.findByRole('menuitem', {name: /deleteField/}));
  return screen.findByRole('alertdialog');
}

describe('TemplateConfigEditor — delete-field hosting (B-5 Task 7)', () => {
  it('opens the editor-hosted confirm from the row menu; confirm runs the delete mutation + invalidateStructure', async () => {
    renderEditor();
    await screen.findByRole('button', {name: 'Study design'});

    const dialog = await openDeleteDialog();
    expect(vi.mocked(validateFieldImpact)).toHaveBeenCalledWith(
      'f1',
      expect.any(String),
      expect.any(Function),
    );

    await userEvent.click(
      await within(dialog).findByRole('button', {name: /deleteField/}),
    );

    await waitFor(() => expect(deleteField).toHaveBeenCalledWith('f1'));
    await waitFor(() => expect(invalidateStructure).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('Esc dismisses the delete confirm WITHOUT closing the inspector (dialog lives outside the panel subtree)', async () => {
    renderEditor();
    const label = await screen.findByRole('button', {name: 'Study design'});

    // Select the row so the inspector shows the field form.
    await userEvent.click(label);
    expect(screen.getByLabelText('inspectorLabelLabel')).toBeInTheDocument();

    await openDeleteDialog();
    await userEvent.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    // The regression: an in-panel dialog would have escalated this Esc to
    // rung 2 of the ladder and closed the inspector.
    expect(screen.getByLabelText('inspectorLabelLabel')).toBeInTheDocument();
    expect(deleteField).not.toHaveBeenCalled();
  });
});
