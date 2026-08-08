/**
 * TemplateConfigGridPanel — search-filter retention (B-5 Task 3).
 *
 * When an inline commit changes a field so it no longer matches the
 * active search, the row must NOT vanish mid-interaction: the panel
 * retains it until the query string changes. The retention lives in the
 * panel's filter application (not in templateTree), so these tests pin
 * both the pure merge helper and the wired behavior.
 */
import {act, render, screen} from '@testing-library/react';
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

import {TooltipProvider} from '@/components/ui/tooltip';
import {useTemplateEntityTypes} from '@/hooks/extraction/useTemplateEntityTypes';
import {
  useInsertTemplateField,
  type UseInsertTemplateFieldArgs,
} from '@/hooks/extraction/useInsertTemplateField';
import {useUpdateTemplateField} from '@/hooks/extraction/useUpdateTemplateField';
import type {ExtractionField} from '@/types/extraction';

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

/** Default queue stub: enqueueInsert echoes a deterministic client key. */
function stubInsertQueue() {
  const enqueueInsert = vi.fn(() => ({clientKey: 'pending-1', name: 'peso'}));
  const enqueueUpdate = vi.fn();
  vi.mocked(useInsertTemplateField).mockReturnValue({enqueueInsert, enqueueUpdate});
  return {enqueueInsert, enqueueUpdate};
}

beforeEach(() => {
  vi.clearAllMocks();
  stubInsertQueue();
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

  const sectionActions: TemplateSectionActions = {
    renamingId: null,
    renameValue: '',
    onRenameValueChange: vi.fn(),
    onStartRename: vi.fn(),
    onCommitRename: vi.fn(),
    onCancelRename: vi.fn(),
    onDelete: vi.fn(),
    onAddField: vi.fn(),
  };

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
    expect(mutate).toHaveBeenCalledWith({
      fieldId: 'f1',
      updates: {label: 'Cohort type'},
    });

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

  const sectionActions: TemplateSectionActions = {
    renamingId: null,
    renameValue: '',
    onRenameValueChange: vi.fn(),
    onStartRename: vi.fn(),
    onCommitRename: vi.fn(),
    onCancelRename: vi.fn(),
    onDelete: vi.fn(),
    onAddField: vi.fn(),
  };

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
