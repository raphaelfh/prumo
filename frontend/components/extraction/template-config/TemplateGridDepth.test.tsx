/**
 * TemplateGrid at depth — the rows 0069 made representable.
 *
 * Its own file because the main grid suite already sits at the file-size
 * ceiling, and these cases share nothing with it but the render harness.
 */
import {render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));

import {TooltipProvider} from '@/components/ui/tooltip';

import {TemplateGrid, type TemplateSectionActions} from './TemplateGrid';
import {buildTemplateTree} from './templateTree';

function renderGrid(over: Partial<Parameters<typeof TemplateGrid>[0]> = {}) {
  const sectionActions: TemplateSectionActions = {
    onCommitRename: vi.fn(),
    onDelete: vi.fn(),
    onAddPerGroupSection: vi.fn(),
  };
  const props = {
    sections: [],
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

describe('TemplateGrid — depth (trees B5b)', () => {
  const deepTree = buildTemplateTree(
    [
      {
        id: 'grp',
        name: 'models',
        label: 'Prediction models',
        cardinality: 'many',
        entry_label: 'algorithm',
        parent_entity_type_id: null,
        sort_order: 1,
      },
      {
        id: 'nested',
        name: 'validations',
        label: 'Validations',
        cardinality: 'many',
        entry_label: 'validation',
        parent_entity_type_id: 'grp',
        sort_order: 1,
      },
      {
        id: 'leaf',
        name: 'metrics',
        label: 'Metrics',
        cardinality: 'one',
        parent_entity_type_id: 'nested',
        sort_order: 1,
      },
    ],
    [
      {
        id: 'lf',
        entity_type_id: 'leaf',
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

  it('renders a grandchild section, its field and its add-field ghost', () => {
    // The two-level builder dropped it entirely: not a root, and not a
    // child of one, so it appeared nowhere on the Config tab.
    renderGrid({sections: deepTree});

    expect(screen.getByText('Metrics')).toBeInTheDocument();
    expect(screen.getByText('AUC')).toBeInTheDocument();
    expect(screen.getByTestId('template-grid-add-field-leaf')).toBeInTheDocument();
  });

  it('offers the add-child ghost under a NESTED repeating section too', () => {
    renderGrid({sections: deepTree});

    expect(screen.getByTestId('template-grid-add-child-section-grp')).toBeInTheDocument();
    expect(screen.getByTestId('template-grid-add-child-section-nested')).toBeInTheDocument();
  });

  it('indents each level further than its parent', () => {
    renderGrid({sections: deepTree});
    // Read the padding off the add-field ghost cell of each level: it is
    // the one row every section has, at every depth. Depth has to be
    // VISIBLE — three levels sharing one indentation is a flat list
    // wearing a tree's data.
    const paddingOf = (sectionId: string) =>
      screen.getByTestId(`template-grid-add-field-${sectionId}`).closest('td')?.className ?? '';

    const classes = ['grp', 'nested', 'leaf'].map(paddingOf);
    expect(classes.every((c) => c !== '')).toBe(true);
    expect(new Set(classes).size).toBe(3);
  });
});
