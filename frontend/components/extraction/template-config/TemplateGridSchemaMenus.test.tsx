/**
 * B-8 T5 — schema-truth grid menus + the per-group ghost (D8, D9, D12).
 *
 * NEW file by design (the B-6 T7 precedent): TemplateGrid.test.tsx has
 * little ratchet headroom and TemplateConfigGridPanel.test.tsx is frozen
 * at its ceiling. Two layers:
 *
 * 1. Grid contract: the section `＋▾` menu tells the schema's truth —
 *    groups gain "New per-{noun} section" and "Delete repeating group…"
 *    (replacing plain Remove); roots and per-model sections keep the
 *    original set. Each group block closes with a dialog-opening
 *    "＋ New per-{noun} section" ghost, and the template-level ghost is
 *    now a `＋▾` menu whose "Add repeating group…" disables (with a
 *    named-tooltip reason) once a group exists — one container per
 *    template is a DB partial-unique invariant, not a preference.
 * 2. Panel: the new callbacks thread through TemplateConfigGridPanel.
 *
 * Copy is deliberately NOT mocked — the `{{noun}}` interpolation at the
 * render call sites is exactly what these tests pin.
 */
import {act, render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

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
vi.mock('./useMoveFieldTo', () => ({
  useMoveFieldTo: ({tree}: {tree: unknown}) => ({
    moveFieldTo: () => null,
    announcement: null,
    displayTree: tree,
  }),
}));
vi.mock('sonner', () => ({toast: {error: vi.fn(), success: vi.fn()}}));

import {TooltipProvider} from '@/components/ui/tooltip';
import {useInsertTemplateField} from '@/hooks/extraction/useInsertTemplateField';
import {useTemplateEntityTypes} from '@/hooks/extraction/useTemplateEntityTypes';
import {useUpdateTemplateField} from '@/hooks/extraction/useUpdateTemplateField';

import {TemplateConfigGridPanel} from './TemplateConfigGridPanel';
import {TemplateGrid, type TemplateSectionActions} from './TemplateGrid';
import {buildTemplateTree} from './templateTree';

const field = (id: string, entityTypeId: string, name: string, label: string) => ({
  id,
  entity_type_id: entityTypeId,
  name,
  label,
  description: null,
  field_type: 'text',
  is_required: false,
  allowed_values: null,
  llm_description: null,
  sort_order: 1,
});

const entityTypes = [
  {
    id: 'root1',
    name: 'basics',
    label: 'Basics',
    description: null,
    role: 'study_section',
    cardinality: 'one',
    parent_entity_type_id: null,
    entry_label: null,
    sort_order: 1,
  },
  {
    id: 'grp',
    name: 'models',
    label: 'Prediction models',
    description: null,
    role: 'model_container',
    cardinality: 'many',
    parent_entity_type_id: null,
    entry_label: 'algorithm',
    sort_order: 2,
  },
  {
    id: 'child',
    name: 'performance',
    label: 'Performance',
    description: null,
    role: 'model_section',
    cardinality: 'many',
    parent_entity_type_id: 'grp',
    entry_label: null,
    sort_order: 1,
  },
];

const fields = [field('f1', 'root1', 'design', 'Design'), field('cf1', 'child', 'auc', 'AUC')];

const groupTree = buildTemplateTree(entityTypes, fields);
const rootOnlyTree = buildTemplateTree([entityTypes[0]], [fields[0]]);

const makeSectionActions = (): TemplateSectionActions => ({
  onCommitRename: vi.fn(),
  onDelete: vi.fn(),
  onAddPerModelSection: vi.fn(),
});

function renderGrid(over: Partial<Parameters<typeof TemplateGrid>[0]> = {}) {
  const sectionActions = makeSectionActions();
  const props = {
    sections: groupTree,
    selection: null,
    onSelect: vi.fn(),
    onDeleteField: vi.fn(),
    onCommitField: vi.fn(),
    onInsertField: vi.fn(),
    onToggleRequired: vi.fn(),
    onChangeType: vi.fn(),
    onDeepLink: vi.fn(),
    sectionActions,
    onAddSection: vi.fn(),
    onAddGroup: vi.fn(),
    onEscapeEscalate: vi.fn(),
    collapsed: new Set<string>(),
    onToggleCollapse: vi.fn(),
    showKeyColumn: false,
    showOptionsColumn: false,
    isFiltering: false,
    ...over,
  };
  const {container} = render(
    <TooltipProvider>
      <TemplateGrid {...props} />
    </TooltipProvider>,
  );
  return {...props, container};
}

const focusEl = (el: HTMLElement) => act(() => el.focus());

const openSectionMenu = async (label: string) => {
  await userEvent.click(screen.getByRole('button', {name: `Add — ${label}`}));
};

describe('section ＋▾ menu — role-aware items (B-8 D8)', () => {
  it('a GROUP menu offers New field / New per-{noun} section / Edit label / Delete repeating group…', async () => {
    renderGrid();
    await openSectionMenu('Prediction models');
    expect(await screen.findByRole('menuitem', {name: 'New field'})).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', {name: 'New per-algorithm section'}),
    ).toBeInTheDocument();
    expect(screen.getByRole('menuitem', {name: 'Edit label'})).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', {name: 'Delete repeating group…'}),
    ).toBeInTheDocument();
    // The plain Remove item is REPLACED, not duplicated.
    expect(screen.queryByRole('menuitem', {name: 'Remove'})).toBeNull();
  });

  it('a ROOT section menu keeps the original set — no group items', async () => {
    renderGrid();
    await openSectionMenu('Basics');
    expect(await screen.findByRole('menuitem', {name: 'Remove'})).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', {name: /per-algorithm section/})).toBeNull();
    expect(screen.queryByRole('menuitem', {name: /Delete repeating group/})).toBeNull();
  });

  it('a PER-MODEL section menu keeps the original set too', async () => {
    renderGrid();
    await openSectionMenu('Performance');
    expect(await screen.findByRole('menuitem', {name: 'Remove'})).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', {name: /per-algorithm section/})).toBeNull();
    expect(screen.queryByRole('menuitem', {name: /Delete repeating group/})).toBeNull();
  });

  it('New per-{noun} section fires on select with the group section (dialog-opening — no editor claim)', async () => {
    const {sectionActions} = renderGrid();
    await openSectionMenu('Prediction models');
    await userEvent.click(
      await screen.findByRole('menuitem', {name: 'New per-algorithm section'}),
    );
    expect(sectionActions.onAddPerModelSection).toHaveBeenCalledTimes(1);
    expect(sectionActions.onAddPerModelSection).toHaveBeenCalledWith(
      expect.objectContaining({id: 'grp', kind: 'group', entryNoun: 'algorithm'}),
    );
  });

  it('Delete repeating group… routes through the SAME delete action as Remove', async () => {
    const {sectionActions} = renderGrid();
    await openSectionMenu('Prediction models');
    await userEvent.click(
      await screen.findByRole('menuitem', {name: 'Delete repeating group…'}),
    );
    expect(sectionActions.onDelete).toHaveBeenCalledTimes(1);
    expect(sectionActions.onDelete).toHaveBeenCalledWith(
      expect.objectContaining({id: 'grp', kind: 'group'}),
    );
  });

  it('interpolates the noun into the group meta and the per-model repeats meta (D7)', () => {
    renderGrid();
    // child has cardinality 'many' → "repeats per {{noun}}" with the
    // PARENT group's entry_label, not the literal "model".
    expect(screen.getByText(/repeats per algorithm/)).toBeInTheDocument();
    expect(screen.queryByText(/repeats per model\b/)).toBeNull();
  });
});

describe('per-group ghost row (B-8 D9)', () => {
  it('closes the group block with a dialog-opening ghost labelled with the noun', async () => {
    const {sectionActions} = renderGrid();
    const ghost = screen.getByTestId('template-grid-add-child-section-grp');
    expect(ghost).toHaveTextContent('New per-algorithm section');
    await userEvent.click(ghost);
    expect(sectionActions.onAddPerModelSection).toHaveBeenCalledTimes(1);
    expect(sectionActions.onAddPerModelSection).toHaveBeenCalledWith(
      expect.objectContaining({id: 'grp'}),
    );
  });

  it('activates from the keyboard WITHOUT opening an inline editor', async () => {
    const {sectionActions} = renderGrid();
    const ghost = screen.getByTestId('template-grid-add-child-section-grp');
    focusEl(ghost);
    await userEvent.keyboard('{Enter}');
    // Native button activation — the dialog callback fires and no ghost
    // editor mounts (the row is inlineEditor: false).
    expect(sectionActions.onAddPerModelSection).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('textbox', {name: 'New field label'})).toBeNull();
  });

  it('does not render for plain root sections', () => {
    renderGrid();
    expect(screen.queryByTestId('template-grid-add-child-section-root1')).toBeNull();
  });

  it('hides while a search filter is active', () => {
    renderGrid({isFiltering: true});
    expect(screen.queryByTestId('template-grid-add-child-section-grp')).toBeNull();
  });

  it('keeps the one-tab-stop roving invariant with the new rows mounted', () => {
    const {container} = renderGrid();
    expect(container.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  });
});

describe('template-level ＋▾ menu (B-8 D8/D12)', () => {
  it('offers New section (root dialog) from the bottom trigger', async () => {
    const {onAddSection} = renderGrid();
    await userEvent.click(screen.getByTestId('template-grid-add-section'));
    await userEvent.click(await screen.findByRole('menuitem', {name: 'New section'}));
    expect(onAddSection).toHaveBeenCalledTimes(1);
  });

  it('offers Add repeating group… when the tree has NO group yet', async () => {
    const {onAddGroup} = renderGrid({sections: rootOnlyTree});
    await userEvent.click(screen.getByTestId('template-grid-add-section'));
    const item = await screen.findByRole('menuitem', {name: 'Add repeating group…'});
    expect(item).not.toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(item);
    expect(onAddGroup).toHaveBeenCalledTimes(1);
  });

  it('disables Add repeating group… when a group exists, naming it in the tooltip reason', async () => {
    const {onAddGroup} = renderGrid();
    await userEvent.click(screen.getByTestId('template-grid-add-section'));
    const item = await screen.findByRole('menuitem', {name: 'Add repeating group…'});
    expect(item).toHaveAttribute('aria-disabled', 'true');
    // The reason names the existing group so the refusal teaches the rule.
    await userEvent.hover(item.parentElement as HTMLElement);
    expect(
      (await screen.findAllByText(/already has a repeating group/)).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/Prediction models/).length).toBeGreaterThan(1);
    expect(onAddGroup).not.toHaveBeenCalled();
  });

  it('stays hidden while filtering (ghost-row rule unchanged)', () => {
    renderGrid({isFiltering: true});
    expect(screen.queryByTestId('template-grid-add-section')).toBeNull();
  });
});

describe('TemplateConfigGridPanel — new callback threading (B-8 T5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useTemplateEntityTypes).mockReturnValue({
      entityTypes: [
        {...entityTypes[0], fields: [fields[0]]},
        {...entityTypes[1], fields: []},
        {...entityTypes[2], fields: [fields[1]]},
      ] as never,
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useTemplateEntityTypes>);
    vi.mocked(useUpdateTemplateField).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateTemplateField>);
    vi.mocked(useInsertTemplateField).mockReturnValue({
      enqueueInsert: vi.fn(() => ({clientKey: 'pending-1', name: 'x'})),
      enqueueUpdate: vi.fn(),
    } as unknown as ReturnType<typeof useInsertTemplateField>);
  });

  it('threads onAddGroup and onAddPerModelSection through to the grid', async () => {
    const sectionActions = makeSectionActions();
    const onAddGroup = vi.fn();
    render(
      <TooltipProvider>
        <TemplateConfigGridPanel
          projectId="p1"
          templateId="t1"
          onDeleteField={vi.fn()}
          sectionActions={sectionActions}
          onAddSection={vi.fn()}
          onAddGroup={onAddGroup}
        />
      </TooltipProvider>,
    );
    await userEvent.click(screen.getByTestId('template-grid-add-child-section-grp'));
    expect(sectionActions.onAddPerModelSection).toHaveBeenCalledWith(
      expect.objectContaining({id: 'grp'}),
    );
    // A group exists → the bottom menu's group item is disabled.
    await userEvent.click(screen.getByTestId('template-grid-add-section'));
    const menu = await screen.findByRole('menu');
    expect(
      within(menu).getByRole('menuitem', {name: 'Add repeating group…'}),
    ).toHaveAttribute('aria-disabled', 'true');
    expect(onAddGroup).not.toHaveBeenCalled();
  });
});
