/**
 * TemplateConfigGridPanel — search-filter retention (B-5 Task 3).
 *
 * When an inline commit changes a field so it no longer matches the
 * active search, the row must NOT vanish mid-interaction: the panel
 * retains it until the query string changes. The retention lives in the
 * panel's filter application (not in templateTree), so these tests pin
 * both the pure merge helper and the wired behavior.
 */
import {act, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));
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
vi.mock('@/services/extractionFieldService', () => ({
  validateFieldImpact: vi.fn(),
}));
vi.mock('sonner', () => ({toast: {error: vi.fn(), success: vi.fn()}}));

import {TooltipProvider} from '@/components/ui/tooltip';
import {useTemplateEntityTypes} from '@/hooks/extraction/useTemplateEntityTypes';
import {
  useInsertTemplateField,
  type UseInsertTemplateFieldArgs,
} from '@/hooks/extraction/useInsertTemplateField';
import {useUpdateTemplateField} from '@/hooks/extraction/useUpdateTemplateField';
import {useContainerNarrow} from '@/hooks/shared/useContainerNarrow';
import {validateFieldImpact} from '@/services/extractionFieldService';
import {toast} from 'sonner';
import type {ExtractionField, FieldValidationResult} from '@/types/extraction';

import {
  applyRetentionToFilter,
  TemplateConfigGridPanel,
} from './TemplateConfigGridPanel';
import type {TemplateSectionActions} from './TemplateGrid';
import {buildTemplateTree, filterTemplateTree} from './templateTree';

const field = (
  id: string,
  entityTypeId: string,
  name: string,
  label: string,
  sortOrder: number,
) => ({
  id,
  entity_type_id: entityTypeId,
  name,
  label,
  description: null,
  field_type: 'text',
  is_required: false,
  allowed_values: null,
  llm_description: null,
  sort_order: sortOrder,
});

describe('applyRetentionToFilter', () => {
  const tree = buildTemplateTree(
    [
      {
        id: 's1',
        name: 's_one',
        label: 'Basics',
        role: 'study_section',
        cardinality: 'one',
        parent_entity_type_id: null,
        sort_order: 1,
      },
      {
        id: 'g1',
        name: 'g_one',
        label: 'Models',
        role: 'model_container',
        cardinality: 'one',
        parent_entity_type_id: null,
        sort_order: 2,
      },
      {
        id: 'c1',
        name: 'c_one',
        label: 'Child',
        role: 'model_section',
        cardinality: 'one',
        parent_entity_type_id: 'g1',
        sort_order: 1,
      },
    ],
    [
      field('a1', 's1', 'k1', 'Alpha', 1),
      field('a2', 's1', 'k2', 'Beta', 2),
      field('a3', 's1', 'k3', 'Gamma', 3),
      field('d1', 'c1', 'k4', 'Delta', 1),
    ],
  );

  it('returns the filtered sections untouched when nothing is retained', () => {
    const filtered = filterTemplateTree(tree, 'beta');
    expect(applyRetentionToFilter(tree, filtered.sections, new Set())).toBe(
      filtered.sections,
    );
  });

  it('re-inserts a retained field at its original position', () => {
    const filtered = filterTemplateTree(tree, 'gamma');
    const merged = applyRetentionToFilter(tree, filtered.sections, new Set(['a1']));
    const basics = merged.find((s) => s.id === 's1');
    expect(basics?.fields.map((f) => f.id)).toEqual(['a1', 'a3']);
  });

  it('resurrects a section the filter dropped when it owns a retained field — child sections included', () => {
    const filtered = filterTemplateTree(tree, 'beta');
    expect(filtered.sections.find((s) => s.id === 'g1')).toBeUndefined();
    const merged = applyRetentionToFilter(tree, filtered.sections, new Set(['d1']));
    const group = merged.find((s) => s.id === 'g1');
    expect(group?.children[0]?.fields.map((f) => f.id)).toEqual(['d1']);
  });
});

/** Task 6: the grid row owns the rename draft — the panel only threads
 * the single commit through (plus delete and the dead-until-Task-8
 * add-field). Shared across suites; no panel test asserts on it. */
const sectionActions: TemplateSectionActions = {
  onCommitRename: vi.fn(),
  onDelete: vi.fn(),
  onAddField: vi.fn(),
};

/** Default queue stub: enqueueInsert echoes a deterministic client key. */
function stubInsertQueue() {
  const enqueueInsert = vi.fn(() => ({clientKey: 'pending-1', name: 'peso'}));
  const enqueueUpdate = vi.fn();
  vi.mocked(useInsertTemplateField).mockReturnValue({enqueueInsert, enqueueUpdate});
  return {enqueueInsert, enqueueUpdate};
}

/** Impact-probe stub (type changes route through it on REAL rows). */
function stubProbe(canChangeType: boolean) {
  vi.mocked(validateFieldImpact).mockResolvedValue({
    ok: true,
    data: {
      canDelete: canChangeType,
      canUpdate: true,
      canChangeType,
      extractedValuesCount: canChangeType ? 0 : 3,
      affectedArticles: [],
      message: '',
    } satisfies FieldValidationResult,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  stubInsertQueue();
  stubProbe(true);
  vi.mocked(useContainerNarrow).mockReturnValue(false);
});

describe('TemplateConfigGridPanel — retention wiring', () => {
  const makeEntityTypes = (firstLabel: string) => [
    {
      id: 'sec',
      name: 'sec_a',
      label: 'Section A',
      description: null,
      role: 'study_section',
      cardinality: 'one',
      parent_entity_type_id: null,
      sort_order: 1,
      fields: [
        field('f1', 'sec', 'q1', firstLabel, 1),
        field('f2', 'sec', 'q2', 'Sample size', 2),
      ],
    },
  ];

  // A FRESH element per (re)render: reusing one element reference makes
  // React bail out of the subtree on rerender, so mocked data never lands.
  const panel = () => (
    <TooltipProvider>
      <TemplateConfigGridPanel
        projectId="p1"
        templateId="t1"
        onEditField={vi.fn()}
        onDeleteField={vi.fn()}
        sectionActions={sectionActions}
        onAddSection={vi.fn()}
      />
    </TooltipProvider>
  );

  const mockEntityTypes = (firstLabel: string) => {
    vi.mocked(useTemplateEntityTypes).mockReturnValue({
      entityTypes: makeEntityTypes(firstLabel) as never,
      isLoading: false,
      isError: false,
      error: null,
    });
  };

  it('keeps an edited-away row visible until the query changes', async () => {
    const mutate = vi.fn();
    vi.mocked(useUpdateTemplateField).mockReturnValue({
      mutate,
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateTemplateField>);
    mockEntityTypes('Study design');

    const {rerender} = render(panel());

    await userEvent.type(
      screen.getByRole('textbox', {name: 'gridSearchPlaceholder'}),
      'design',
    );
    expect(screen.getByRole('button', {name: 'Study design'})).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Sample size'})).toBeNull();

    // Inline-edit to a label that no longer matches the query.
    const label = screen.getByRole('button', {name: 'Study design'});
    await userEvent.click(label);
    await userEvent.click(label);
    await userEvent.keyboard('Cohort type{Enter}');
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith(
      {fieldId: 'f1', updates: {label: 'Cohort type'}},
      undefined,
    );

    // The refetch lands the new label — the row must NOT vanish.
    mockEntityTypes('Cohort type');
    rerender(panel());
    expect(screen.getByRole('button', {name: 'Cohort type'})).toBeInTheDocument();

    // Changing the query clears the retention.
    await userEvent.type(
      screen.getByRole('textbox', {name: 'gridSearchPlaceholder'}),
      's',
    );
    expect(screen.queryByRole('button', {name: 'Cohort type'})).toBeNull();
  });
});

describe('TemplateConfigGridPanel — optimistic ghost inserts (B-5 Task 4)', () => {
  const makeEntityTypes = (extraFields: object[] = []) => [
    {
      id: 'sec',
      name: 'sec_a',
      label: 'Section A',
      description: null,
      role: 'study_section',
      cardinality: 'one',
      parent_entity_type_id: null,
      sort_order: 1,
      fields: [
        field('f1', 'sec', 'q1', 'Study design', 1),
        field('f2', 'sec', 'q2', 'Sample size', 2),
        ...extraFields,
      ],
    },
  ];

  const panel = () => (
    <TooltipProvider>
      <TemplateConfigGridPanel
        projectId="p1"
        templateId="t1"
        onEditField={vi.fn()}
        onDeleteField={vi.fn()}
        sectionActions={sectionActions}
        onAddSection={vi.fn()}
      />
    </TooltipProvider>
  );

  const mockEntityTypes = (extraFields: object[] = []) => {
    vi.mocked(useTemplateEntityTypes).mockReturnValue({
      entityTypes: makeEntityTypes(extraFields) as never,
      isLoading: false,
      isError: false,
      error: null,
    });
  };

  const mockMutation = () => {
    const mutate = vi.fn();
    vi.mocked(useUpdateTemplateField).mockReturnValue({
      mutate,
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateTemplateField>);
    return mutate;
  };

  /** Insert 'Peso' through the ghost editor of section 'sec'. */
  async function insertPeso() {
    await userEvent.click(screen.getByTestId('template-grid-add-field-sec'));
    await userEvent.keyboard('Peso');
    await userEvent.keyboard('{Enter}');
  }

  it('renders the optimistic pending row immediately, enqueued with committed names + base sort', async () => {
    const {enqueueInsert} = stubInsertQueue();
    mockMutation();
    mockEntityTypes();
    render(panel());

    await insertPeso();

    expect(enqueueInsert).toHaveBeenCalledTimes(1);
    expect(enqueueInsert).toHaveBeenCalledWith({
      entityTypeId: 'sec',
      label: 'Peso',
      existingNames: ['q1', 'q2'],
      baseSortOrder: 2,
    });
    // The pending row is on screen BEFORE any server confirmation.
    expect(screen.getByRole('button', {name: 'Peso'})).toBeInTheDocument();
  });

  it('routes label edits on a still-pending row through the queue, not the mutation (rule 5)', async () => {
    const {enqueueUpdate} = stubInsertQueue();
    const mutate = mockMutation();
    mockEntityTypes();
    render(panel());
    await insertPeso();

    const pendingLabel = screen.getByRole('button', {name: 'Peso'});
    await userEvent.click(pendingLabel);
    await userEvent.click(pendingLabel);
    await userEvent.keyboard('Peso corporal{Enter}');

    expect(enqueueUpdate).toHaveBeenCalledWith('pending-1', {label: 'Peso corporal'});
    expect(mutate).not.toHaveBeenCalled();
    // The optimistic row reflects the queued edit.
    expect(screen.getByRole('button', {name: 'Peso corporal'})).toBeInTheDocument();
  });

  it('disables the row-menu Delete on a PENDING row (Task 7: the queued insert cannot be cancelled)', async () => {
    stubInsertQueue();
    mockMutation();
    mockEntityTypes();
    render(panel());
    await insertPeso();

    // Pending row renders last — its actions trigger is the third one.
    const triggers = screen.getAllByRole('button', {name: /actionsForFieldAria/});
    await userEvent.click(triggers[triggers.length - 1]);
    const deleteItem = await screen.findByRole('menuitem', {name: /deleteField/});
    expect(deleteItem).toHaveAttribute('aria-disabled', 'true');
    await userEvent.keyboard('{Escape}');

    // A REAL row keeps its Delete enabled.
    await userEvent.click(triggers[0]);
    expect(
      await screen.findByRole('menuitem', {name: /deleteField/}),
    ).not.toHaveAttribute('aria-disabled');
  });

  it('keeps ONE row across confirm + drain, reconciled by client key to the server id', async () => {
    const hookArgs: Partial<UseInsertTemplateFieldArgs> = {};
    const enqueueInsert = vi.fn(() => ({clientKey: 'pending-1', name: 'peso'}));
    vi.mocked(useInsertTemplateField).mockImplementation((args) => {
      hookArgs.onConfirmed = args.onConfirmed;
      hookArgs.onDrained = args.onDrained;
      return {enqueueInsert, enqueueUpdate: vi.fn()};
    });
    mockMutation();
    mockEntityTypes();

    const {rerender} = render(panel());
    await insertPeso();
    expect(screen.getByRole('button', {name: 'Peso'})).toBeInTheDocument();

    // Server confirms: the pending row stays (still client-keyed).
    act(() => {
      hookArgs.onConfirmed?.(
        'pending-1',
        field('srv-9', 'sec', 'peso', 'Peso', 3) as unknown as ExtractionField,
      );
    });
    expect(screen.getAllByRole('button', {name: 'Peso'})).toHaveLength(1);

    // Drain: the refetch now carries the committed row; the pending copy
    // must be pruned — ONE row, no duplicate.
    mockEntityTypes([field('srv-9', 'sec', 'peso', 'Peso', 3)]);
    act(() => {
      hookArgs.onDrained?.();
    });
    rerender(panel());
    expect(screen.getAllByRole('button', {name: 'Peso'})).toHaveLength(1);
  });
});

describe('TemplateConfigGridPanel — control-cell write routing (B-5 Task 5)', () => {
  const makeEntityTypes = () => [
    {
      id: 'sec',
      name: 'sec_a',
      label: 'Section A',
      description: null,
      role: 'study_section',
      cardinality: 'one',
      parent_entity_type_id: null,
      sort_order: 1,
      fields: [
        field('f1', 'sec', 'q1', 'Study design', 1),
        field('f2', 'sec', 'q2', 'Sample size', 2),
      ],
    },
  ];

  const panel = () => (
    <TooltipProvider>
      <TemplateConfigGridPanel
        projectId="p1"
        templateId="t1"
        onEditField={vi.fn()}
        onDeleteField={vi.fn()}
        sectionActions={sectionActions}
        onAddSection={vi.fn()}
      />
    </TooltipProvider>
  );

  const mockEntityTypes = () => {
    vi.mocked(useTemplateEntityTypes).mockReturnValue({
      entityTypes: makeEntityTypes() as never,
      isLoading: false,
      isError: false,
      error: null,
    });
  };

  const mockMutation = () => {
    const mutate = vi.fn();
    vi.mocked(useUpdateTemplateField).mockReturnValue({
      mutate,
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateTemplateField>);
    return mutate;
  };

  async function insertPeso() {
    await userEvent.click(screen.getByTestId('template-grid-add-field-sec'));
    await userEvent.keyboard('Peso');
    await userEvent.keyboard('{Enter}');
  }

  it('routes a Required toggle on a REAL row through the update mutation — one write', async () => {
    const mutate = mockMutation();
    mockEntityTypes();
    render(panel());

    await userEvent.click(
      screen.getAllByRole('checkbox', {name: /gridRequiredToggleAria/})[0],
    );
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith(
      {fieldId: 'f1', updates: {is_required: true}},
      undefined,
    );
  });

  it('routes a Required toggle on a PENDING row through the insert queue', async () => {
    const {enqueueUpdate} = stubInsertQueue();
    const mutate = mockMutation();
    mockEntityTypes();
    render(panel());
    await insertPeso();

    // The pending row renders last — its checkbox is the third one.
    const checkboxes = screen.getAllByRole('checkbox', {
      name: /gridRequiredToggleAria/,
    });
    await userEvent.click(checkboxes[checkboxes.length - 1]);
    expect(enqueueUpdate).toHaveBeenCalledWith('pending-1', {is_required: true});
    expect(mutate).not.toHaveBeenCalled();
  });

  it('writes a grid type change after the impact probe allows it, with type-dependent clears', async () => {
    const mutate = mockMutation();
    mockEntityTypes();
    render(panel());

    await userEvent.click(
      screen.getAllByRole('button', {name: /gridTypeMenuAria/})[0],
    );
    await userEvent.click(
      await screen.findByRole('menuitemradio', {name: 'fieldTypeNumber'}),
    );

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(vi.mocked(validateFieldImpact)).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith(
      {
        fieldId: 'f1',
        updates: {
          field_type: 'number',
          allowed_values: null,
          allow_other: false,
          other_label: null,
          other_placeholder: null,
        },
      },
      undefined,
    );
  });

  it('refuses a grid type change when the probe says no — toast, no write', async () => {
    stubProbe(false);
    const mutate = mockMutation();
    mockEntityTypes();
    render(panel());

    await userEvent.click(
      screen.getAllByRole('button', {name: /gridTypeMenuAria/})[0],
    );
    await userEvent.click(
      await screen.findByRole('menuitemradio', {name: 'fieldTypeNumber'}),
    );

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('errors_cannotChangeFieldType'),
    );
    expect(mutate).not.toHaveBeenCalled();
  });

  it('skips the probe for type changes on PENDING rows — the queue serializes them', async () => {
    const {enqueueUpdate} = stubInsertQueue();
    const mutate = mockMutation();
    mockEntityTypes();
    render(panel());
    await insertPeso();

    const triggers = screen.getAllByRole('button', {name: /gridTypeMenuAria/});
    await userEvent.click(triggers[triggers.length - 1]);
    await userEvent.click(
      await screen.findByRole('menuitemradio', {name: 'fieldTypeNumber'}),
    );

    expect(vi.mocked(validateFieldImpact)).not.toHaveBeenCalled();
    expect(enqueueUpdate).toHaveBeenCalledWith(
      'pending-1',
      expect.objectContaining({field_type: 'number'}),
    );
    expect(mutate).not.toHaveBeenCalled();
  });

  it('routes an inspector Save on a PENDING row through the insert queue', async () => {
    const {enqueueUpdate} = stubInsertQueue();
    const mutate = mockMutation();
    mockEntityTypes();
    render(panel());
    await insertPeso();

    // Select the pending row; its full properties open in the inspector.
    await userEvent.click(screen.getByRole('button', {name: 'Peso'}));
    const label = screen.getByLabelText('inspectorLabelLabel');
    expect(label).toHaveValue('Peso');
    await userEvent.type(label, ' corporal');
    await userEvent.click(screen.getByRole('button', {name: 'inspectorSave'}));

    expect(enqueueUpdate).toHaveBeenCalledWith(
      'pending-1',
      expect.objectContaining({label: 'Peso corporal'}),
    );
    expect(mutate).not.toHaveBeenCalled();
  });
});

describe('TemplateConfigGridPanel — inspector visibility (B-5 Task 5)', () => {
  const panel = () => (
    <TooltipProvider>
      <TemplateConfigGridPanel
        projectId="p1"
        templateId="t1"
        onEditField={vi.fn()}
        onDeleteField={vi.fn()}
        sectionActions={sectionActions}
        onAddSection={vi.fn()}
      />
    </TooltipProvider>
  );

  const mockEntityTypes = () => {
    vi.mocked(useTemplateEntityTypes).mockReturnValue({
      entityTypes: [
        {
          id: 'sec',
          name: 'sec_a',
          label: 'Section A',
          description: null,
          role: 'study_section',
          cardinality: 'one',
          parent_entity_type_id: null,
          sort_order: 1,
          fields: [field('f1', 'sec', 'q1', 'Study design', 1)],
        },
      ] as never,
      isLoading: false,
      isError: false,
      error: null,
    });
  };

  const mockMutation = () => {
    vi.mocked(useUpdateTemplateField).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateTemplateField>);
  };

  it('⌘. toggles the docked inspector', async () => {
    mockMutation();
    mockEntityTypes();
    render(panel());
    expect(screen.getByText('inspectorEmptyTitle')).toBeInTheDocument();

    // The shortcut listens on the panel, so focus must be inside it.
    await userEvent.click(
      screen.getByRole('textbox', {name: 'gridSearchPlaceholder'}),
    );
    await userEvent.keyboard('{Meta>}.{/Meta}');
    expect(screen.queryByText('inspectorEmptyTitle')).toBeNull();

    await userEvent.keyboard('{Meta>}.{/Meta}');
    expect(screen.getByText('inspectorEmptyTitle')).toBeInTheDocument();
  });

  it('offers a pointer affordance for the same toggle', async () => {
    mockMutation();
    mockEntityTypes();
    render(panel());
    const toggle = screen.getByRole('button', {name: 'inspectorToggle'});
    await userEvent.click(toggle);
    expect(screen.queryByText('inspectorEmptyTitle')).toBeNull();
    await userEvent.click(toggle);
    expect(screen.getByText('inspectorEmptyTitle')).toBeInTheDocument();
  });

  it('deep-linking from the ✨ cell selects the field and opens its inspector group', async () => {
    mockMutation();
    mockEntityTypes();
    render(panel());

    await userEvent.click(
      screen.getAllByRole('button', {name: /gridAiCellAria/})[0],
    );
    expect(screen.getByLabelText('inspectorLabelLabel')).toHaveValue(
      'Study design',
    );
    expect(document.activeElement).toBe(
      screen.getByLabelText(/inspectorAiLabel/),
    );
  });

  it('below the container breakpoint the inspector is a Sheet, opened by deep-link', async () => {
    vi.mocked(useContainerNarrow).mockReturnValue(true);
    mockMutation();
    mockEntityTypes();
    render(panel());

    // No docked pane in narrow mode — and no auto-opened overlay either.
    expect(screen.queryByText('inspectorEmptyTitle')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();

    await userEvent.click(
      screen.getAllByRole('button', {name: /gridAiCellAria/})[0],
    );
    const sheet = await screen.findByRole('dialog');
    expect(sheet).toBeInTheDocument();
    expect(screen.getByLabelText('inspectorLabelLabel')).toHaveValue(
      'Study design',
    );
  });

  it('⌘. opens and closes the Sheet in narrow mode', async () => {
    vi.mocked(useContainerNarrow).mockReturnValue(true);
    mockMutation();
    mockEntityTypes();
    render(panel());

    await userEvent.click(
      screen.getByRole('textbox', {name: 'gridSearchPlaceholder'}),
    );
    await userEvent.keyboard('{Meta>}.{/Meta}');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});

describe('TemplateConfigGridPanel — 3-rung Esc ladder (B-5 Task 6)', () => {
  const panel = () => (
    <TooltipProvider>
      <TemplateConfigGridPanel
        projectId="p1"
        templateId="t1"
        onEditField={vi.fn()}
        onDeleteField={vi.fn()}
        sectionActions={sectionActions}
        onAddSection={vi.fn()}
      />
    </TooltipProvider>
  );

  const mockEntityTypes = () => {
    vi.mocked(useTemplateEntityTypes).mockReturnValue({
      entityTypes: [
        {
          id: 'sec',
          name: 'sec_a',
          label: 'Section A',
          description: null,
          role: 'study_section',
          cardinality: 'one',
          parent_entity_type_id: null,
          sort_order: 1,
          fields: [
            field('f1', 'sec', 'q1', 'Study design', 1),
            field('f2', 'sec', 'q2', 'Sample size', 2),
          ],
        },
      ] as never,
      isLoading: false,
      isError: false,
      error: null,
    });
  };

  const mockMutation = () => {
    const mutate = vi.fn();
    vi.mocked(useUpdateTemplateField).mockReturnValue({
      mutate,
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateTemplateField>);
    return mutate;
  };

  it('rung 1: a cell-edit Esc cancels only the edit — the inspector stays open', async () => {
    const mutate = mockMutation();
    mockEntityTypes();
    render(panel());

    const label = screen.getByRole('button', {name: 'Study design'});
    await userEvent.click(label); // select (the inspector shows the form)
    await userEvent.click(label); // second click edits
    await userEvent.keyboard('zzz');
    await userEvent.keyboard('{Escape}');

    // The edit reverted without a write…
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', {name: 'gridEditLabelAria'})).toBeNull();
    // …and the ladder did NOT advance: the inspector form is still open.
    expect(screen.getByLabelText('inspectorLabelLabel')).toBeInTheDocument();
  });

  it('rung 2: Esc closes the open inspector and returns focus to the focused cell', async () => {
    mockMutation();
    mockEntityTypes();
    render(panel());

    const label = screen.getByRole('button', {name: 'Study design'});
    await userEvent.click(label);
    const inspectorLabel = screen.getByLabelText('inspectorLabelLabel');
    // Esc pressed while focus is INSIDE the inspector: the pane unmounts
    // under the focused element, so the return to the roving cell is the
    // dispatcher's job — not a browser accident.
    await userEvent.click(inspectorLabel);
    expect(document.activeElement).toBe(inspectorLabel);
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByLabelText('inspectorLabelLabel')).toBeNull();
    expect(document.activeElement).toBe(label);
    // Only the inspector closed — the selection survives rung 2.
    expect(label).toHaveAttribute('aria-current', 'true');
  });

  it('rung 2 before rung 3: the open inspector absorbs Esc BEFORE the query clears', async () => {
    mockMutation();
    mockEntityTypes();
    render(panel());

    const search = screen.getByRole('textbox', {name: 'gridSearchPlaceholder'});
    await userEvent.type(search, 'design');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByText('inspectorEmptyTitle')).toBeNull();
    expect(search).toHaveValue('design');

    // Second Esc: the inspector is closed now — the query clears.
    await userEvent.keyboard('{Escape}');
    expect(search).toHaveValue('');
  });

  it('rung 3: with the inspector closed and no query, Esc clears the selection', async () => {
    mockMutation();
    mockEntityTypes();
    render(panel());

    await userEvent.click(screen.getByRole('button', {name: 'inspectorToggle'}));
    const label = screen.getByRole('button', {name: 'Study design'});
    await userEvent.click(label);
    expect(label).toHaveAttribute('aria-current', 'true');

    await userEvent.keyboard('{Escape}');
    expect(label).not.toHaveAttribute('aria-current');
  });
});
