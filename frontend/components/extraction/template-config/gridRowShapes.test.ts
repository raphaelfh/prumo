/**
 * gridRowShapes — the row-shape mirror of TemplateGrid's JSX (B-6 T7
 * contract, extended in B-8 T5 with the per-group dialog-opening ghost).
 *
 * The mirror discipline is the roving-focus invariant's foundation: a row
 * emitted here but not rendered (or vice versa) desyncs the model from
 * the DOM. The B-8 rows are DIALOG-opening ghosts (`inlineEditor: false`)
 * — landing on them must never auto-enter edit mode (no editor exists to
 * mount; gridCellModel owns that guard).
 */
import {describe, expect, it} from 'vitest';

import {
  ADD_SECTION_ROW_ID,
  buildRowShapes,
  ghostRowId,
  groupChildGhostRowId,
} from '@/components/extraction/template-config/gridRowShapes';
import {buildTemplateTree} from '@/components/extraction/template-config/templateTree';

const groupTree = buildTemplateTree(
  [
    {
      id: 'root1',
      name: 'basics',
      label: 'Basics',
      cardinality: 'one',
      parent_entity_type_id: null,
      sort_order: 1,
    },
    {
      id: 'grp',
      name: 'models',
      label: 'Prediction models',
      cardinality: 'many',
      entry_label: 'algorithm',
      parent_entity_type_id: null,
      sort_order: 2,
    },
    {
      id: 'child',
      name: 'performance',
      label: 'Performance',
      cardinality: 'one',
      parent_entity_type_id: 'grp',
      sort_order: 1,
    },
  ],
  [
    {
      id: 'f1',
      entity_type_id: 'root1',
      name: 'design',
      label: 'Design',
      field_type: 'text',
      sort_order: 1,
    },
    {
      id: 'cf1',
      entity_type_id: 'child',
      name: 'auc',
      label: 'AUC',
      field_type: 'number',
      sort_order: 1,
    },
  ],
);

const none = new Set<string>();

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
  [{id: 'lf', entity_type_id: 'leaf', name: 'auc', label: 'AUC', field_type: 'number', sort_order: 1}],
);

describe('buildRowShapes — depth (trees B5b)', () => {
  it('emits the grandchild section, its fields and its ghost, in tree order', () => {
    const rows = buildRowShapes(deepTree, none, false).map((r) => r.rowId);

    expect(rows.indexOf('leaf')).toBeGreaterThan(rows.indexOf('nested'));
    expect(rows).toContain('lf');
    expect(rows).toContain(ghostRowId('leaf'));
  });

  it('closes EVERY repeating section with its add-child ghost, not only a group', () => {
    // The nested group is repeating and owns a child; the check used to be
    // "is a group", which also meant a repeating section with NO children
    // never offered the ghost — so its first child could not be created.
    const rows = buildRowShapes(deepTree, none, false).map((r) => r.rowId);

    expect(rows).toContain(groupChildGhostRowId('grp'));
    expect(rows).toContain(groupChildGhostRowId('nested'));

    const childless = buildTemplateTree(
      [
        {
          id: 'lonely',
          name: 'arms',
          label: 'Arms',
          cardinality: 'many',
          entry_label: 'arm',
          parent_entity_type_id: null,
          sort_order: 1,
        },
      ],
      [],
    );
    expect(buildRowShapes(childless, none, false).map((r) => r.rowId)).toContain(
      groupChildGhostRowId('lonely'),
    );
  });

  it('a collapsed middle section hides its whole subtree', () => {
    const rows = buildRowShapes(deepTree, new Set(['nested']), false).map((r) => r.rowId);

    expect(rows).toContain('nested');
    expect(rows).not.toContain('leaf');
    expect(rows).not.toContain('lf');
  });
});

describe('buildRowShapes — per-group ghost (B-8 D9)', () => {
  it('emits the per-group ghost AFTER the group children block, dialog-opening', () => {
    const rows = buildRowShapes(groupTree, none, false);
    const ids = rows.map((r) => r.rowId);
    expect(ids).toEqual([
      'root1',
      'f1',
      ghostRowId('root1'),
      'grp',
      ghostRowId('grp'),
      'child',
      'cf1',
      ghostRowId('child'),
      groupChildGhostRowId('grp'),
      ADD_SECTION_ROW_ID,
    ]);
    const perGroup = rows.find((r) => r.rowId === groupChildGhostRowId('grp'));
    expect(perGroup).toEqual({
      rowId: 'ghost:group-child:grp',
      kind: 'ghost',
      sectionId: 'grp',
      inlineEditor: false,
    });
  });

  it('marks field ghosts inlineEditor: true and the add-section ghost false', () => {
    const rows = buildRowShapes(groupTree, none, false);
    expect(rows.find((r) => r.rowId === ghostRowId('root1'))?.inlineEditor).toBe(true);
    expect(rows.find((r) => r.rowId === ghostRowId('child'))?.inlineEditor).toBe(true);
    expect(rows.find((r) => r.rowId === ADD_SECTION_ROW_ID)?.inlineEditor).toBe(false);
  });

  it('does NOT emit a per-group ghost for plain root sections', () => {
    const rows = buildRowShapes(groupTree, none, false);
    expect(rows.some((r) => r.rowId === groupChildGhostRowId('root1'))).toBe(false);
  });

  it('collapse hides the per-group ghost with the rest of the group block', () => {
    const rows = buildRowShapes(groupTree, new Set(['grp']), false);
    expect(rows.some((r) => r.rowId === groupChildGhostRowId('grp'))).toBe(false);
    // The header row itself survives collapse.
    expect(rows.some((r) => r.rowId === 'grp')).toBe(true);
  });

  it('filtering hides every ghost, the per-group one included', () => {
    const rows = buildRowShapes(groupTree, none, true);
    expect(rows.filter((r) => r.kind === 'ghost')).toEqual([]);
  });
});
