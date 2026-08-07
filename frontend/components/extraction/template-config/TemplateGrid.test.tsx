import {render, screen} from '@testing-library/react';
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
    collapsed: new Set<string>(),
    onToggleCollapse: vi.fn(),
    showKeyColumn: false,
    showOptionsColumn: false,
    isFiltering: false,
    ...over,
  };
  // The app mounts TooltipProvider once at the root (App.tsx); the grid's
  // icon-only triggers carry tooltips, so tests must supply it too.
  render(
    <TooltipProvider>
      <TemplateGrid {...props} />
    </TooltipProvider>,
  );
  return props;
}

describe('TemplateGrid accessibility', () => {
  it('does NOT claim role="grid" — it has no arrow-key cell navigation to back it up', () => {
    renderGrid();
    expect(screen.queryByRole('grid')).toBeNull();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('exposes every field as a focusable, named control', async () => {
    // Regression guard: the shell once put a roving tabIndex on the <tr>
    // that evaluated to -1 for every row while nothing was selected, so a
    // keyboard user could not reach a single field.
    const {onSelect} = renderGrid();
    const field = screen.getByRole('button', {name: 'Study design'});
    field.focus();
    expect(document.activeElement).toBe(field);
    await userEvent.click(field);
    expect(onSelect).toHaveBeenCalledWith({kind: 'field', id: 'f1'});
  });

  it('exposes the section label as a focusable control that selects it', async () => {
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
      screen.getByRole('button', {name: /gridRowActions — Study design/}),
    );
    await userEvent.click(screen.getByRole('menuitem', {name: /gridDeleteField/}));
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
