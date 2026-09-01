/**
 * B-6 T7 — the row ⋯ menu's move items + the "Move to section…" command
 * dialog (panel decisions 5 and 9).
 *
 * NEW file by design (decision 10) — TemplateGrid.test.tsx and
 * TemplateConfigGridPanel.test.tsx are frozen at their ratchet ceilings,
 * and TemplateGridMove.test.tsx has too little headroom. Two layers:
 *
 * 1. Grid contract: the FieldRow menu's "Move up"/"Move down" reuse the
 *    chord's boundary-aware slot (`nextMoveSlot`) and its disabled
 *    matrix (template edges, filtering, pending rows); "Move to
 *    section…" requests the panel-hosted dialog through the
 *    menuClaimedFocus/onCloseAutoFocus hand-off (opening a
 *    focus-trapping dialog straight from onSelect is the documented
 *    failure — the menu's FocusScope would fight the dialog's).
 * 2. Panel: ONE dialog instance for the whole grid; a pick moves to the
 *    destination's END through `moveFieldToSectionEnd` (announcement +
 *    single-slot Undo ride along); ⌘⇧M opens it for the focused field
 *    row; Esc closes with focus returned to the field's cell.
 *
 * Copy is deliberately NOT mocked — the tests pin the real strings.
 */
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

// The panel mounts TemplateInspector, whose section pane reaches
// templateService -> apiClient -> the supabase client, which throws on
// import when env is absent (CI). Mocking the service keeps the module
// tree out of these grid tests.
vi.mock('@/services/templateService', () => ({updateSection: vi.fn()}));
vi.mock('@/hooks/extraction/useTemplateEntityTypes', () => ({
  useTemplateEntityTypes: vi.fn(),
}));
vi.mock('@/hooks/extraction/useUpdateTemplateField', () => ({
  useUpdateTemplateField: vi.fn(),
}));
vi.mock('@/hooks/extraction/useInsertTemplateField', () => ({
  useInsertTemplateField: vi.fn(),
}));
vi.mock('@/hooks/extraction/useMoveTemplateField', () => ({
  useMoveTemplateField: vi.fn(),
}));
vi.mock('@/hooks/extraction/useReorderTemplateFields', () => ({
  useReorderTemplateFields: vi.fn(),
}));
vi.mock('@/hooks/extraction/useTemplateRepublish', () => ({
  useTemplateConfigCaches: vi.fn(),
}));
vi.mock('@/hooks/shared/useContainerNarrow', () => ({
  useContainerNarrow: vi.fn(() => false),
}));
vi.mock('@/services/extractionFieldService', () => ({
  validateFieldImpact: vi.fn(),
}));
// Callable: T5's undo wrapper toasts on every settled move dispatch.
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {error: vi.fn(), success: vi.fn(), info: vi.fn()}),
}));


import {TooltipProvider} from '@/components/ui/tooltip';
import {useInsertTemplateField} from '@/hooks/extraction/useInsertTemplateField';
import {useMoveTemplateField} from '@/hooks/extraction/useMoveTemplateField';
import {useReorderTemplateFields} from '@/hooks/extraction/useReorderTemplateFields';
import {useTemplateEntityTypes} from '@/hooks/extraction/useTemplateEntityTypes';
import {useTemplateConfigCaches} from '@/hooks/extraction/useTemplateRepublish';
import {useUpdateTemplateField} from '@/hooks/extraction/useUpdateTemplateField';

import {TemplateConfigGridPanel} from './TemplateConfigGridPanel';
import {TemplateGrid, type TemplateSectionActions} from './TemplateGrid';
import {buildTemplateTree} from './templateTree';
import {stubStructuralHistory} from '@/test/helpers/structuralHistoryStub';

// cmdk scrolls the selected option into view; jsdom has no layout.
Element.prototype.scrollIntoView = vi.fn();

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

const sectionActions: TemplateSectionActions = {
  onCommitRename: vi.fn(),
  onDelete: vi.fn(),
  onAddPerModelSection: vi.fn(),
};

/** DOM .focus() runs the grid's focusin sync — act-wrap outside userEvent. */
const focusEl = (el: HTMLElement) => act(() => el.focus());

/** Flush pending microtasks (the dispatcher's promise chain). */
const flush = () => act(async () => {});

const openRowMenu = async (label: string) => {
  await userEvent.click(
    screen.getByRole('button', {name: `Actions for field ${label}`}),
  );
};

const menuItem = (name: RegExp) => screen.findByRole('menuitem', {name});

// ---------------------------------------------------------------------------
// Layer 1 — grid contract (TemplateGrid + mocked callbacks)
// ---------------------------------------------------------------------------

const gridTree = buildTemplateTree(
  [
    {id: 'sec1', name: 'basics', label: 'Basics', sort_order: 1},
    {id: 'sec2', name: 'outcomes', label: 'Outcomes', sort_order: 2},
  ],
  [
    field('f1', 'sec1', 'k_alpha', 'Alpha', 1),
    field('f2', 'sec1', 'k_beta', 'Beta', 2),
    field('f3', 'sec1', 'k_gamma', 'Gamma', 3),
    field('f4', 'sec2', 'k_delta', 'Delta', 1),
  ],
);

function renderGrid(over: Partial<Parameters<typeof TemplateGrid>[0]> = {}) {
  const props = {
    sections: gridTree,
    selection: null,
    onSelect: vi.fn(),
    onDeleteField: vi.fn(),
    onCommitField: vi.fn(),
    onInsertField: vi.fn(),
    onToggleRequired: vi.fn(),
    onChangeType: vi.fn(),
    onDeepLink: vi.fn(),
    onMoveField: vi.fn(() => null),
    onOpenMoveDialog: vi.fn(),
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
  render(
    <TooltipProvider>
      <TemplateGrid {...props} />
    </TooltipProvider>,
  );
  return props;
}

describe('FieldRow ⋯ menu — move items (T7)', () => {
  it('shows the move items with their chord hints (the visible affordance)', async () => {
    renderGrid();
    await openRowMenu('Beta');
    expect(await menuItem(/Move up/)).toHaveTextContent('⌘⇧↑');
    expect(await menuItem(/Move down/)).toHaveTextContent('⌘⇧↓');
    expect(await menuItem(/Move to section/)).toHaveTextContent('⌘⇧M');
  });

  it('Move down dispatches through the chord boundary-aware slot', async () => {
    const {onMoveField} = renderGrid();
    await openRowMenu('Beta');
    await userEvent.click(await menuItem(/Move down/));
    expect(onMoveField).toHaveBeenCalledTimes(1);
    expect(onMoveField).toHaveBeenCalledWith(
      expect.objectContaining({id: 'f2'}),
      'sec1',
      2,
    );
  });

  it('Move up from a section first field targets the previous section END', async () => {
    const {onMoveField} = renderGrid();
    await openRowMenu('Delta');
    await userEvent.click(await menuItem(/Move up/));
    expect(onMoveField).toHaveBeenCalledWith(
      expect.objectContaining({id: 'f4'}),
      'sec1',
      3,
    );
  });

  it('template edges disable exactly the impossible direction', async () => {
    renderGrid();
    await openRowMenu('Alpha'); // template-first field
    expect(await menuItem(/Move up/)).toHaveAttribute('aria-disabled', 'true');
    expect(await menuItem(/Move down/)).not.toHaveAttribute('aria-disabled');
    await userEvent.keyboard('{Escape}');
    await openRowMenu('Delta'); // template-last field
    expect(await menuItem(/Move up/)).not.toHaveAttribute('aria-disabled');
    expect(await menuItem(/Move down/)).toHaveAttribute('aria-disabled', 'true');
  });

  it('filtering disables the step items but keeps Move to section… live', async () => {
    // Visible indices lie under a filter; end-of-destination does not
    // (panel decision 4's combobox rule applies to the dialog too).
    renderGrid({isFiltering: true});
    await openRowMenu('Beta');
    expect(await menuItem(/Move up/)).toHaveAttribute('aria-disabled', 'true');
    expect(await menuItem(/Move down/)).toHaveAttribute('aria-disabled', 'true');
    expect(await menuItem(/Move to section/)).not.toHaveAttribute('aria-disabled');
  });

  it('a pending row disables all three move items', async () => {
    renderGrid({pendingRowIds: new Set(['f2'])});
    await openRowMenu('Beta');
    expect(await menuItem(/Move up/)).toHaveAttribute('aria-disabled', 'true');
    expect(await menuItem(/Move down/)).toHaveAttribute('aria-disabled', 'true');
    expect(await menuItem(/Move to section/)).toHaveAttribute('aria-disabled', 'true');
  });

  it('"Move to section…" requests the panel dialog for the row field', async () => {
    const {onOpenMoveDialog} = renderGrid();
    await openRowMenu('Beta');
    await userEvent.click(await menuItem(/Move to section/));
    await waitFor(() => expect(onOpenMoveDialog).toHaveBeenCalledTimes(1));
    expect(onOpenMoveDialog).toHaveBeenCalledWith(
      expect.objectContaining({id: 'f2'}),
    );
  });
});

// ---------------------------------------------------------------------------
// Layer 2 — the panel-hosted dialog (mocked write hooks)
// ---------------------------------------------------------------------------

const entityTypes = [
  {
    id: 'sec1',
    name: 'basics',
    label: 'Basics',
    description: null,
    role: 'study_section',
    cardinality: 'one',
    parent_entity_type_id: null,
    sort_order: 1,
    fields: [
      field('f1', 'sec1', 'k_alpha', 'Alpha', 1),
      field('f2', 'sec1', 'k_beta', 'Beta', 2),
      field('f3', 'sec1', 'k_gamma', 'Gamma', 3),
    ],
  },
  {
    id: 'sec2',
    name: 'outcomes',
    label: 'Outcomes',
    description: null,
    role: 'study_section',
    cardinality: 'one',
    parent_entity_type_id: null,
    sort_order: 2,
    fields: [field('f4', 'sec2', 'k_delta', 'Delta', 1)],
  },
];

let moveMutateAsync: ReturnType<typeof vi.fn>;
let reorderMutateAsync: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  moveMutateAsync = vi.fn(async () => ({}) as never);
  reorderMutateAsync = vi.fn(async () => undefined);
  vi.mocked(useMoveTemplateField).mockReturnValue({
    mutateAsync: moveMutateAsync,
  } as unknown as ReturnType<typeof useMoveTemplateField>);
  vi.mocked(useReorderTemplateFields).mockReturnValue({
    mutateAsync: reorderMutateAsync,
  } as unknown as ReturnType<typeof useReorderTemplateFields>);
  vi.mocked(useTemplateConfigCaches).mockReturnValue({
    invalidateStructure: vi.fn(async () => undefined),
    invalidateAll: vi.fn(async () => undefined),
    invalidateAfterDiscard: vi.fn(async () => undefined),
    invalidateAfterImport: vi.fn(async () => undefined),
  });
  vi.mocked(useTemplateEntityTypes).mockReturnValue({
    entityTypes: entityTypes as never,
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

function renderPanel() {
  const history = stubStructuralHistory();
  return {
    history,
    ...render(
    <TooltipProvider>
      <TemplateConfigGridPanel
        projectId="p1"
        templateId="t1"
        onDeleteField={vi.fn()}
        history={history}
        sectionActions={sectionActions}
        onAddSection={vi.fn()}
        onAddGroup={vi.fn()}
      />
    </TooltipProvider>,
    ),
  };
}

const chordM = (el: Element) =>
  fireEvent.keyDown(el, {key: 'M', metaKey: true, shiftKey: true});

describe('TemplateConfigGridPanel — Move-to-section dialog (T7)', () => {
  it('menu entry opens THE panel dialog with focus in its input (hand-off)', async () => {
    renderPanel();
    await openRowMenu('Beta');
    await userEvent.click(await menuItem(/Move to section/));
    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByPlaceholderText(/Move Beta to/);
    // The claimed-focus hand-off: the menu's FocusScope tore down before
    // the dialog mounted, so the dialog's own trap owns focus cleanly.
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it('picking a section moves the field to its END through the dispatcher', async () => {
    const {container, history} = renderPanel();
    await openRowMenu('Beta');
    await userEvent.click(await menuItem(/Move to section/));
    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('option', {name: 'Outcomes'}));
    await flush();
    // END of Outcomes: one existing field -> sort_order 2, plus the
    // renumbers of both touched sections.
    expect(moveMutateAsync).toHaveBeenCalledTimes(1);
    expect(moveMutateAsync).toHaveBeenCalledWith({
      fieldId: 'f2',
      entityTypeId: 'sec2',
      sortOrder: 2,
    });
    expect(reorderMutateAsync).toHaveBeenCalledWith({
      updates: [
        {id: 'f1', sort_order: 1},
        {id: 'f3', sort_order: 2},
        {id: 'f4', sort_order: 1},
      ],
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    // The pick entered through moveFieldWithUndo: the announcement and the
    // Undo step ride along automatically (the slot raises the toast).
    await waitFor(() =>
      expect(within(container).getByRole('status')).toHaveTextContent(
        'Moved Beta to Outcomes, position 2 of 2',
      ),
    );
    await waitFor(() =>
      expect(history.push).toHaveBeenCalledWith(
        expect.objectContaining({label: 'Moved Beta'}),
      ),
    );
  });

  it('the field OWN section is absent from the dialog list (a pick there would silently reorder-to-end)', async () => {
    renderPanel();
    await openRowMenu('Beta');
    await userEvent.click(await menuItem(/Move to section/));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('option', {name: 'Basics'})).toBeNull();
    expect(within(dialog).getByRole('option', {name: 'Outcomes'})).toBeInTheDocument();
  });

  it('⌘⇧M ignores the ⌥ variant — an altKey chord is a different shortcut', async () => {
    renderPanel();
    const beta = screen.getByRole('button', {name: 'Beta'});
    focusEl(beta);
    fireEvent.keyDown(beta, {key: 'M', metaKey: true, shiftKey: true, altKey: true});
    await flush();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('⌘⇧M opens the dialog for the FOCUSED field row', async () => {
    renderPanel();
    const beta = screen.getByRole('button', {name: 'Beta'});
    focusEl(beta);
    chordM(beta);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByPlaceholderText(/Move Beta to/)).toBeInTheDocument();
  });

  it('⌘⇧M no-ops without a focused or selected field row', async () => {
    renderPanel();
    const search = screen.getByRole('textbox', {name: /search/i});
    focusEl(search);
    chordM(search);
    await flush();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Esc closes the dialog and focus returns to the field cell', async () => {
    renderPanel();
    const beta = screen.getByRole('button', {name: 'Beta'});
    focusEl(beta);
    chordM(beta);
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // The panel's focusGridCellSoon puts focus back on the roving cell —
    // the field's cell the chord was pressed on.
    await waitFor(() => expect(document.activeElement).toBe(beta));
  });
});
