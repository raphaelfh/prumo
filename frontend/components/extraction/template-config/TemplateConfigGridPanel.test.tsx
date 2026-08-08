/**
 * TemplateConfigGridPanel — search-filter retention (B-5 Task 3).
 *
 * When an inline commit changes a field so it no longer matches the
 * active search, the row must NOT vanish mid-interaction: the panel
 * retains it until the query string changes. The retention lives in the
 * panel's filter application (not in templateTree), so these tests pin
 * both the pure merge helper and the wired behavior.
 */
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));
vi.mock('@/hooks/extraction/useTemplateEntityTypes', () => ({
  useTemplateEntityTypes: vi.fn(),
}));
vi.mock('@/hooks/extraction/useUpdateTemplateField', () => ({
  useUpdateTemplateField: vi.fn(),
}));

import {TooltipProvider} from '@/components/ui/tooltip';
import {useTemplateEntityTypes} from '@/hooks/extraction/useTemplateEntityTypes';
import {useUpdateTemplateField} from '@/hooks/extraction/useUpdateTemplateField';

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
