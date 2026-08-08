import {act, fireEvent, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));

import {TooltipProvider} from '@/components/ui/tooltip';

import {TemplateGrid, type TemplateSectionActions} from './TemplateGrid';
import {buildTemplateTree} from './templateTree';

const tree = buildTemplateTree(
  [
    {
      id: 'sec',
      name: 'source_of_data',
      label: 'Source of Data',
      description: 'Where the data came from',
      role: 'study_section',
      cardinality: 'one',
      parent_entity_type_id: null,
      sort_order: 1,
    },
  ],
  [
    {
      id: 'f1',
      entity_type_id: 'sec',
      name: 'study_design',
      label: 'Study design',
      description: null,
      field_type: 'select',
      is_required: true,
      allowed_values: ['Cohort', 'RCT'],
      llm_description: null,
      sort_order: 1,
    },
  ],
);

function renderGrid(over: Partial<Parameters<typeof TemplateGrid>[0]> = {}) {
  // Task 6: the row owns the rename draft — the parent only gets the
  // single commit (plus delete).
  const sectionActions: TemplateSectionActions = {
    onCommitRename: vi.fn(),
    onDelete: vi.fn(),
  };
  const props = {
    sections: tree,
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
    onEscapeEscalate: vi.fn(),
    collapsed: new Set<string>(),
    onToggleCollapse: vi.fn(),
    showKeyColumn: false,
    showOptionsColumn: false,
    isFiltering: false,
    ...over,
  };
  // The app mounts TooltipProvider once at the root (App.tsx); the grid's
  // icon-only triggers carry tooltips, so tests must supply it too.
  const {container} = render(
    <TooltipProvider>
      <TemplateGrid {...props} />
    </TooltipProvider>,
  );
  return {...props, container};
}

/** DOM .focus() runs the grid's focusin sync (a state update), so it must
 * be act-wrapped when called outside a userEvent interaction. */
function focusEl(el: HTMLElement) {
  act(() => el.focus());
}

describe('TemplateGrid accessibility', () => {
  it('claims role="grid" — arrow-key cell navigation now backs the promise', () => {
    renderGrid();
    expect(screen.getByRole('grid')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getAllByRole('gridcell').length).toBeGreaterThan(0);
  });

  it('keeps EXACTLY ONE tabindex="0", defaulting to the first cell', () => {
    // Regression guard (B-1): the shell once put a roving tabIndex on the
    // <tr> that evaluated to -1 for every row while nothing was selected,
    // so a keyboard user could not reach a single field. The invariant is
    // empirical: exactly one tab stop, and it exists BEFORE any focus.
    const {container} = renderGrid();
    const stops = container.querySelectorAll('[tabindex="0"]');
    expect(stops).toHaveLength(1);
    // The default entry point is the first row's first cell target — the
    // first section header's collapse control.
    expect(stops[0]).toHaveAccessibleName(/gridCollapseSection — Source of Data/);
  });

  it('keeps exactly one tabindex="0" after arrow moves, and the rover follows', async () => {
    const {container} = renderGrid();
    const entry = container.querySelector<HTMLElement>('[tabindex="0"]');
    focusEl(entry!);
    await userEvent.keyboard('{ArrowDown}');
    expect(container.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    const field = screen.getByRole('button', {name: 'Study design'});
    expect(document.activeElement).toBe(field);
    expect(field).toHaveAttribute('tabindex', '0');
    await userEvent.keyboard('{ArrowRight}');
    expect(container.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    expect(document.activeElement).toHaveAttribute('data-cell-cols', 'type');
  });

  it('Tab exits the grid — inner controls are not tab stops (APG one-stop)', async () => {
    renderGrid();
    const field = screen.getByRole('button', {name: 'Study design'});
    focusEl(field);
    await userEvent.tab();
    expect(screen.getByRole('grid').contains(document.activeElement)).toBe(false);
  });

  it('paints the focus ring on the whole cell from MODEL state — mouse clicks included', async () => {
    renderGrid();
    const field = screen.getByRole('button', {name: 'Study design'});
    await userEvent.click(field);
    expect(field.closest('td')?.className).toContain('outline-ring');
  });

  it('syncs the roving coordinate when focus arrives by other means', async () => {
    const {container} = renderGrid();
    const trigger = screen.getByRole('button', {name: /actionsForFieldAria/});
    focusEl(trigger); // not reachable by Tab or arrows-from-default alone
    expect(trigger).toHaveAttribute('tabindex', '0');
    expect(container.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    // …and roving continues FROM the synced coordinate.
    await userEvent.keyboard('{ArrowLeft}');
    expect(document.activeElement).toHaveAttribute('data-cell-cols', 'sparkle');
  });

  it('follows focus back to the trigger when the row menu closes', async () => {
    const {container, onEscapeEscalate} = renderGrid();
    const trigger = screen.getByRole('button', {name: /actionsForFieldAria/});
    await userEvent.click(trigger); // menu opens; focus moves to the portal
    await userEvent.keyboard('{Escape}'); // Radix closes and refocuses the trigger
    expect(onEscapeEscalate).not.toHaveBeenCalled(); // the portal Esc is the menu's
    expect(trigger).toHaveAttribute('tabindex', '0');
    expect(container.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  });

  it('routes Esc in focus mode to the central dispatcher (rungs 2-3)', async () => {
    const {onEscapeEscalate} = renderGrid();
    focusEl(screen.getByRole('button', {name: 'Study design'}));
    await userEvent.keyboard('{Escape}');
    expect(onEscapeEscalate).toHaveBeenCalledTimes(1);
  });

  it('Enter on the actions cell opens the row menu (capability parity)', async () => {
    renderGrid();
    focusEl(screen.getByRole('button', {name: /actionsForFieldAria/}));
    await userEvent.keyboard('{Enter}');
    expect(
      await screen.findByRole('menuitem', {name: /deleteField/}),
    ).toBeInTheDocument();
  });

  it('keeps collapse working from the keyboard: Enter on the collapse cell toggles', async () => {
    const {onToggleCollapse} = renderGrid();
    focusEl(
      screen.getByRole('button', {name: /gridCollapseSection — Source of Data/}),
    );
    await userEvent.keyboard('{Enter}');
    expect(onToggleCollapse).toHaveBeenCalledWith('sec');
  });

  it('still selects a field on click, with the label control named', async () => {
    const {onSelect} = renderGrid();
    const field = screen.getByRole('button', {name: 'Study design'});
    await userEvent.click(field);
    expect(onSelect).toHaveBeenCalledWith({kind: 'field', id: 'f1'});
  });

  it('exposes the section label as a control that selects it', async () => {
    const {onSelect} = renderGrid();
    await userEvent.click(screen.getByRole('button', {name: 'Source of Data'}));
    expect(onSelect).toHaveBeenCalledWith({kind: 'section', id: 'sec'});
  });

  it('names the collapse control by what it does, not just by the section', () => {
    renderGrid();
    expect(
      screen.getByRole('button', {name: /gridCollapseSection — Source of Data/}),
    ).toBeInTheDocument();
  });

  it('says expand — not collapse — when the section is already collapsed', () => {
    renderGrid({collapsed: new Set(['sec'])});
    expect(
      screen.getByRole('button', {name: /gridExpandSection — Source of Data/}),
    ).toBeInTheDocument();
  });

  it('keeps the section actions menu reachable by name', () => {
    renderGrid();
    expect(
      screen.getByRole('button', {name: /gridAddMenu — Source of Data/}),
    ).toBeInTheDocument();
  });

  it('keeps field deletion reachable — the accordion had it and the grid must too', async () => {
    const {onDeleteField} = renderGrid();
    await userEvent.click(
      screen.getByRole('button', {name: /actionsForFieldAria/}),
    );
    await userEvent.click(screen.getByRole('menuitem', {name: /deleteField/}));
    expect(onDeleteField).toHaveBeenCalledWith(
      expect.objectContaining({id: 'f1'}),
    );
  });

  it('exposes the required state as a real named checkbox (sr-only text gone)', () => {
    // Task 5 made the required cell a real checkbox: role + checked state
    // announce what the sr-only text used to duplicate.
    renderGrid();
    const checkbox = screen.getByRole('checkbox', {
      name: /gridRequiredToggleAria/,
    });
    expect(checkbox).toBeChecked();
    expect(screen.queryByText('inspectorRequiredYes')).toBeNull();
  });

  it('hides ghost add-rows while a search filter is active', () => {
    renderGrid({isFiltering: true});
    expect(screen.queryByTestId('template-grid-add-section')).toBeNull();
    expect(screen.queryByTestId('template-grid-add-field-sec')).toBeNull();
  });
});

describe('TemplateGrid inline text editing (B-5 Task 3)', () => {
  const labelEditor = () =>
    screen.getByRole<HTMLInputElement>('textbox', {name: 'gridEditLabelAria'});

  it('Enter opens the label editor seeded with the current value, text selected, height-capped', async () => {
    renderGrid();
    focusEl(screen.getByRole('button', {name: 'Study design'}));
    await userEvent.keyboard('{Enter}');
    const editor = labelEditor();
    expect(editor).toHaveValue('Study design');
    expect(document.activeElement).toBe(editor);
    // focus-then-edit selects everything, so typing replaces.
    expect(editor.selectionStart).toBe(0);
    expect(editor.selectionEnd).toBe('Study design'.length);
    // 30px rows: editors are capped like the h-6 rename input.
    expect(editor.className).toContain('h-6');
  });

  it('typing on the focused label cell opens the editor seeded with the typed key (typing replaces)', async () => {
    renderGrid();
    focusEl(screen.getByRole('button', {name: 'Study design'}));
    await userEvent.keyboard('x');
    expect(labelEditor()).toHaveValue('x');
  });

  it('a second click inline-edits the label in place', async () => {
    renderGrid();
    const label = screen.getByRole('button', {name: 'Study design'});
    await userEvent.click(label);
    await userEvent.click(label);
    expect(labelEditor()).toHaveValue('Study design');
  });

  it('commit on Enter fires exactly one write and advances focus DOWN', async () => {
    const {onCommitField} = renderGrid();
    focusEl(screen.getByRole('button', {name: 'Study design'}));
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('Renamed field');
    await userEvent.keyboard('{Enter}');
    expect(onCommitField).toHaveBeenCalledTimes(1);
    expect(onCommitField).toHaveBeenCalledWith(
      expect.objectContaining({id: 'f1'}),
      'label',
      'Renamed field',
    );
    // The row below f1 is the section's ghost row — the chain opens its
    // EDITOR (Task 4), not the button.
    expect(document.activeElement).toBe(
      screen.getByRole('textbox', {name: 'gridNewFieldAria'}),
    );
  });

  it('blur commits the draft exactly once', async () => {
    const {onCommitField} = renderGrid();
    focusEl(screen.getByRole('button', {name: 'Study design'}));
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('Blurred value');
    await userEvent.tab();
    expect(onCommitField).toHaveBeenCalledTimes(1);
    expect(onCommitField).toHaveBeenCalledWith(
      expect.objectContaining({id: 'f1'}),
      'label',
      'Blurred value',
    );
    expect(screen.queryByRole('textbox', {name: 'gridEditLabelAria'})).toBeNull();
  });

  it('Esc reverts without a write and focus stays on the cell', async () => {
    const {onCommitField, onEscapeEscalate} = renderGrid();
    focusEl(screen.getByRole('button', {name: 'Study design'}));
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('zzz');
    await userEvent.keyboard('{Escape}');
    expect(onCommitField).not.toHaveBeenCalled();
    // Rung 1 resolved in the editor: the panel rungs must not fire.
    expect(onEscapeEscalate).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', {name: 'gridEditLabelAria'})).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole('button', {name: 'Study design'}),
    );
  });

  it('a no-change commit fires NO write but still advances into the ghost editor', async () => {
    const {onCommitField} = renderGrid();
    focusEl(screen.getByRole('button', {name: 'Study design'}));
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('{Enter}');
    expect(onCommitField).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(
      screen.getByRole('textbox', {name: 'gridNewFieldAria'}),
    );
  });

  it('a REFUSED commit (onCommitField → false) keeps the editor open with the draft', async () => {
    // The panel refuses invalid key commits (schema rules + sibling
    // uniqueness); the grid's side of the contract is to stay in edit
    // mode so the user can fix the value in place.
    renderGrid({onCommitField: vi.fn(() => false)});
    focusEl(screen.getByRole('button', {name: 'Study design'}));
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('Rejected value');
    await userEvent.keyboard('{Enter}');
    const editor = labelEditor();
    expect(editor).toHaveValue('Rejected value');
    expect(document.activeElement).toBe(editor);
  });

  it('edits the key cell when the column is shown, committing the key', async () => {
    const {container, onCommitField} = renderGrid({showKeyColumn: true});
    const keyCell = container.querySelector<HTMLElement>(
      '[data-cell-row="f1"][data-cell-cols="key"]',
    );
    focusEl(keyCell!);
    await userEvent.keyboard('{Enter}');
    const editor = screen.getByRole<HTMLInputElement>('textbox', {
      name: 'gridEditKeyAria',
    });
    expect(editor).toHaveValue('study_design');
    await userEvent.keyboard('new_key');
    await userEvent.keyboard('{Enter}');
    expect(onCommitField).toHaveBeenCalledTimes(1);
    expect(onCommitField).toHaveBeenCalledWith(
      expect.objectContaining({id: 'f1'}),
      'key',
      'new_key',
    );
  });
});

describe('TemplateGrid keydown fired ON the roving button target (real-browser contract)', () => {
  // Regression pins for the B-5 manual pass: in a real browser the
  // keydown's target is the focused inner BUTTON (not the table or a
  // td), and the grid must open the editor from there — preventDefault
  // BEFORE the button's native Enter activation (a keyboard-activated
  // click fires no mousedown, so the second-click path could never
  // promote to edit). fireEvent dispatches the raw DOM event with no
  // user-event activation simulation — the closest jsdom gets to the
  // browser's sequencing. (Verified against real Chrome: Enter/F2/
  // printables all mount the editor from the button target.)
  it('Enter on the label BUTTON opens the editor and preventDefaults native activation', () => {
    renderGrid();
    const button = screen.getByRole('button', {name: 'Study design'});
    focusEl(button);
    const notPrevented = fireEvent.keyDown(button, {key: 'Enter'});
    expect(notPrevented).toBe(false); // preventDefault beat native activation
    expect(
      screen.getByRole('textbox', {name: 'gridEditLabelAria'}),
    ).toHaveValue('Study design');
  });

  it('F2 on the label BUTTON opens the editor', () => {
    renderGrid();
    const button = screen.getByRole('button', {name: 'Study design'});
    focusEl(button);
    fireEvent.keyDown(button, {key: 'F2'});
    expect(
      screen.getByRole('textbox', {name: 'gridEditLabelAria'}),
    ).toHaveValue('Study design');
  });

  it('a printable on the label BUTTON opens the editor seeded (typing replaces)', () => {
    renderGrid();
    const button = screen.getByRole('button', {name: 'Study design'});
    focusEl(button);
    const notPrevented = fireEvent.keyDown(button, {key: 'x'});
    expect(notPrevented).toBe(false); // the char must not ALSO land natively
    expect(screen.getByRole('textbox', {name: 'gridEditLabelAria'})).toHaveValue('x');
  });

  it('Enter on the ghost BUTTON opens the ghost editor', () => {
    renderGrid();
    const button = screen.getByTestId('template-grid-add-field-sec');
    focusEl(button);
    const notPrevented = fireEvent.keyDown(button, {key: 'Enter'});
    expect(notPrevented).toBe(false);
    expect(
      screen.getByRole('textbox', {name: 'gridNewFieldAria'}),
    ).toBeInTheDocument();
  });
});

describe('TemplateGrid ghost-row Enter-chain (B-5 Task 4)', () => {
  const ghostEditor = () =>
    screen.getByRole<HTMLInputElement>('textbox', {name: 'gridNewFieldAria'});
  const queryGhostEditor = () =>
    screen.queryByRole<HTMLInputElement>('textbox', {name: 'gridNewFieldAria'});

  /** Group + child tree: child sections get ghost rows too in Task 4. */
  const groupTree = buildTemplateTree(
    [
      {
        id: 'grp',
        name: 'models',
        label: 'Models',
        description: null,
        role: 'model_container',
        cardinality: 'one',
        parent_entity_type_id: null,
        sort_order: 1,
      },
      {
        id: 'child',
        name: 'model_a',
        label: 'Model A',
        description: null,
        role: 'model_section',
        cardinality: 'one',
        parent_entity_type_id: 'grp',
        sort_order: 1,
      },
    ],
    [
      {
        id: 'cf1',
        entity_type_id: 'child',
        name: 'auc',
        label: 'AUC',
        description: null,
        field_type: 'number',
        is_required: false,
        allowed_values: null,
        llm_description: null,
        sort_order: 1,
      },
    ],
  );

  it('renders a ghost row for CHILD sections too', () => {
    renderGrid({sections: groupTree});
    expect(screen.getByTestId('template-grid-add-field-grp')).toBeInTheDocument();
    expect(screen.getByTestId('template-grid-add-field-child')).toBeInTheDocument();
  });

  it('clicking the ghost row opens its editor on the FIRST click', async () => {
    renderGrid();
    await userEvent.click(screen.getByTestId('template-grid-add-field-sec'));
    expect(document.activeElement).toBe(ghostEditor());
    expect(ghostEditor()).toHaveValue('');
  });

  it('typing on the focused ghost row opens the editor seeded (typing replaces)', async () => {
    renderGrid();
    focusEl(screen.getByTestId('template-grid-add-field-sec'));
    await userEvent.keyboard('a');
    expect(ghostEditor()).toHaveValue('a');
  });

  it('ghost Enter inserts the field and keeps the chain open with a cleared editor', async () => {
    const {onInsertField} = renderGrid();
    await userEvent.click(screen.getByTestId('template-grid-add-field-sec'));
    await userEvent.keyboard('Peso');
    await userEvent.keyboard('{Enter}');
    expect(onInsertField).toHaveBeenCalledTimes(1);
    expect(onInsertField).toHaveBeenCalledWith('sec', 'Peso');
    // The chain reopens the SAME ghost editor, emptied, still focused.
    expect(ghostEditor()).toHaveValue('');
    expect(document.activeElement).toBe(ghostEditor());
  });

  it('Enter on an EMPTY ghost exits the chain back to the ghost button', async () => {
    const {onInsertField} = renderGrid();
    await userEvent.click(screen.getByTestId('template-grid-add-field-sec'));
    await userEvent.keyboard('{Enter}');
    expect(onInsertField).not.toHaveBeenCalled();
    expect(queryGhostEditor()).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByTestId('template-grid-add-field-sec'),
    );
  });

  it('a never-typed ghost auto-discards on blur', async () => {
    const {onInsertField} = renderGrid();
    await userEvent.click(screen.getByTestId('template-grid-add-field-sec'));
    expect(ghostEditor()).toBeInTheDocument();
    await userEvent.tab();
    expect(onInsertField).not.toHaveBeenCalled();
    expect(queryGhostEditor()).toBeNull();
  });

  it('blur on a TYPED ghost commits the insert in place', async () => {
    const {onInsertField} = renderGrid();
    await userEvent.click(screen.getByTestId('template-grid-add-field-sec'));
    await userEvent.keyboard('Altura');
    await userEvent.tab();
    expect(onInsertField).toHaveBeenCalledTimes(1);
    expect(onInsertField).toHaveBeenCalledWith('sec', 'Altura');
    expect(queryGhostEditor()).toBeNull();
  });

  it('Esc on the ghost editor discards without an insert, focus back on the ghost', async () => {
    const {onInsertField} = renderGrid();
    await userEvent.click(screen.getByTestId('template-grid-add-field-sec'));
    await userEvent.keyboard('zzz');
    await userEvent.keyboard('{Escape}');
    expect(onInsertField).not.toHaveBeenCalled();
    expect(queryGhostEditor()).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByTestId('template-grid-add-field-sec'),
    );
  });

  it('the ＋ ▾ New-field item opens the section ghost editor', async () => {
    renderGrid();
    await userEvent.click(
      screen.getByRole('button', {name: /gridAddMenu — Source of Data/}),
    );
    await userEvent.click(
      await screen.findByRole('menuitem', {name: /gridNewField/}),
    );
    expect(ghostEditor()).toBeInTheDocument();
  });

  it('the ＋ ▾ New-field item is disabled while filtering (ghosts are hidden)', async () => {
    renderGrid({isFiltering: true});
    await userEvent.click(
      screen.getByRole('button', {name: /gridAddMenu — Source of Data/}),
    );
    const item = await screen.findByRole('menuitem', {name: /gridNewField/});
    expect(item).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('TemplateGrid control cells (B-5 Task 5)', () => {
  const requiredCheckbox = () =>
    screen.getByRole('checkbox', {name: /gridRequiredToggleAria/});

  it('toggles Required on the FIRST click with exactly one write', async () => {
    const {onToggleRequired, container} = renderGrid();
    await userEvent.click(requiredCheckbox());
    expect(onToggleRequired).toHaveBeenCalledTimes(1);
    expect(onToggleRequired).toHaveBeenCalledWith(
      expect.objectContaining({id: 'f1'}),
      false, // f1 is required today; the first click un-requires it
    );
    // The checkbox joined the roving order without breaking the one-stop rule.
    expect(container.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  });

  it('toggles Required from the keyboard: Enter interprets activateControl', async () => {
    const {onToggleRequired} = renderGrid();
    focusEl(requiredCheckbox());
    await userEvent.keyboard('{Enter}');
    expect(onToggleRequired).toHaveBeenCalledTimes(1);
    expect(onToggleRequired).toHaveBeenCalledWith(
      expect.objectContaining({id: 'f1'}),
      false,
    );
  });

  it('opens the type menu on the FIRST click and routes the pick to onChangeType', async () => {
    const {onChangeType} = renderGrid();
    await userEvent.click(
      screen.getByRole('button', {name: /gridTypeMenuAria/}),
    );
    const item = await screen.findByRole('menuitemradio', {
      name: 'fieldTypeNumber',
    });
    await userEvent.click(item);
    expect(onChangeType).toHaveBeenCalledTimes(1);
    expect(onChangeType).toHaveBeenCalledWith(
      expect.objectContaining({id: 'f1'}),
      'number',
    );
  });

  it('marks the current type as checked in the menu', async () => {
    renderGrid();
    await userEvent.click(
      screen.getByRole('button', {name: /gridTypeMenuAria/}),
    );
    const current = await screen.findByRole('menuitemradio', {
      name: 'fieldTypeSelect',
    });
    expect(current).toHaveAttribute('aria-checked', 'true');
  });

  it('deep-links the ✨ cell to the AI group on click', async () => {
    const {onDeepLink} = renderGrid();
    await userEvent.click(screen.getByRole('button', {name: /gridAiCellAria/}));
    expect(onDeepLink).toHaveBeenCalledTimes(1);
    expect(onDeepLink).toHaveBeenCalledWith(
      expect.objectContaining({id: 'f1'}),
      'ai',
    );
  });

  it('deep-links the ✨ cell exactly once from the keyboard', async () => {
    const {onDeepLink} = renderGrid();
    focusEl(screen.getByRole('button', {name: /gridAiCellAria/}));
    await userEvent.keyboard('{Enter}');
    expect(onDeepLink).toHaveBeenCalledTimes(1);
    expect(onDeepLink).toHaveBeenCalledWith(
      expect.objectContaining({id: 'f1'}),
      'ai',
    );
  });

  it('deep-links the Options cell to the options group', async () => {
    const {onDeepLink} = renderGrid({showOptionsColumn: true});
    await userEvent.click(
      screen.getByRole('button', {name: /gridOptionsCellAria/}),
    );
    expect(onDeepLink).toHaveBeenCalledTimes(1);
    expect(onDeepLink).toHaveBeenCalledWith(
      expect.objectContaining({id: 'f1'}),
      'options',
    );
  });
});

describe('TemplateGrid section rename (B-5 Task 6)', () => {
  const renameEditor = () =>
    screen.getByRole<HTMLInputElement>('textbox', {name: 'gridRenameSectionAria'});
  const queryRenameEditor = () =>
    screen.queryByRole('textbox', {name: 'gridRenameSectionAria'});

  /** Open the rename editor through the section `＋ ▾` menu. */
  async function startRename() {
    await userEvent.click(
      screen.getByRole('button', {name: /gridAddMenu — Source of Data/}),
    );
    await userEvent.click(
      await screen.findByRole('menuitem', {name: /editLabelButton/}),
    );
  }

  it('opens the rename editor from the menu, seeded with the label and focused', async () => {
    renderGrid();
    await startRename();
    const editor = renameEditor();
    expect(editor).toHaveValue('Source of Data');
    // The menu's close must NOT yank focus back to its trigger — the
    // editor keeps it (an immediate blur would be an instant commit-exit).
    expect(document.activeElement).toBe(editor);
  });

  it('Enter commits the changed draft exactly once and focus returns to the label', async () => {
    const {sectionActions} = renderGrid();
    await startRename();
    await userEvent.clear(renameEditor());
    await userEvent.type(renameEditor(), 'Data Sources');
    await userEvent.keyboard('{Enter}');
    expect(sectionActions.onCommitRename).toHaveBeenCalledTimes(1);
    expect(sectionActions.onCommitRename).toHaveBeenCalledWith('sec', 'Data Sources');
    // The editor unmounts while focused (no blur-commit can double-fire)
    // and focus lands back on the section label control.
    expect(queryRenameEditor()).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole('button', {name: 'Source of Data'}),
    );
  });

  it('Esc reverts without a write and focus stays on the section label', async () => {
    const {sectionActions, onEscapeEscalate} = renderGrid();
    await startRename();
    await userEvent.type(renameEditor(), ' zzz');
    await userEvent.keyboard('{Escape}');
    expect(sectionActions.onCommitRename).not.toHaveBeenCalled();
    // Rung 1 resolved in the editor: the ladder must not advance.
    expect(onEscapeEscalate).not.toHaveBeenCalled();
    expect(queryRenameEditor()).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole('button', {name: 'Source of Data'}),
    );
  });

  it('blur commits a changed draft exactly once', async () => {
    const {sectionActions} = renderGrid();
    await startRename();
    await userEvent.clear(renameEditor());
    await userEvent.type(renameEditor(), 'Data Sources');
    await userEvent.tab();
    expect(sectionActions.onCommitRename).toHaveBeenCalledTimes(1);
    expect(sectionActions.onCommitRename).toHaveBeenCalledWith('sec', 'Data Sources');
    expect(queryRenameEditor()).toBeNull();
  });

  it('a no-change blur exits rename mode without a write', async () => {
    const {sectionActions} = renderGrid();
    await startRename();
    await userEvent.tab();
    expect(sectionActions.onCommitRename).not.toHaveBeenCalled();
    expect(queryRenameEditor()).toBeNull();
  });

  it('an emptied draft reverts on Enter instead of committing a blank label', async () => {
    const {sectionActions} = renderGrid();
    await startRename();
    await userEvent.clear(renameEditor());
    await userEvent.keyboard('{Enter}');
    expect(sectionActions.onCommitRename).not.toHaveBeenCalled();
    expect(queryRenameEditor()).toBeNull();
  });
});
