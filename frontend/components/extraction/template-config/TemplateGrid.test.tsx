import {act, render, screen} from '@testing-library/react';
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
  const props = {
    sections: tree,
    selection: null,
    onSelect: vi.fn(),
    onEditField: vi.fn(),
    onDeleteField: vi.fn(),
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

  it('announces the required state, which the checkbox alone cannot', () => {
    renderGrid();
    expect(screen.getByText('inspectorRequiredYes')).toBeInTheDocument();
  });

  it('hides ghost add-rows while a search filter is active', () => {
    renderGrid({isFiltering: true});
    expect(screen.queryByTestId('template-grid-add-section')).toBeNull();
  });
});
