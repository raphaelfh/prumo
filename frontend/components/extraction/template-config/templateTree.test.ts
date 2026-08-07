import {describe, expect, it} from 'vitest';

import {
  buildTemplateTree,
  filterTemplateTree,
  normalizeForSearch,
  type TemplateEntityTypeInput,
  type TemplateFieldInput,
} from './templateTree';

const section = (
  over: Partial<TemplateEntityTypeInput> & {id: string},
): TemplateEntityTypeInput => ({
  name: over.id,
  label: over.id,
  description: null,
  role: 'study_section',
  cardinality: 'one',
  parent_entity_type_id: null,
  sort_order: 0,
  ...over,
});

const field = (
  over: Partial<TemplateFieldInput> & {id: string; entity_type_id: string},
): TemplateFieldInput => ({
  name: over.id,
  label: over.id,
  description: null,
  field_type: 'text',
  is_required: false,
  allowed_values: null,
  llm_description: null,
  sort_order: 0,
  ...over,
});

describe('buildTemplateTree', () => {
  it('orders root sections by sort_order and attaches their fields', () => {
    const tree = buildTemplateTree(
      [
        section({id: 'b', label: 'Participants', sort_order: 2}),
        section({id: 'a', label: 'Source of Data', sort_order: 1}),
      ],
      [
        field({id: 'f2', entity_type_id: 'a', label: 'Data source', sort_order: 2}),
        field({id: 'f1', entity_type_id: 'a', label: 'Study design', sort_order: 1}),
      ],
    );

    expect(tree.map((s) => s.label)).toEqual(['Source of Data', 'Participants']);
    expect(tree[0].fields.map((f) => f.label)).toEqual(['Study design', 'Data source']);
    expect(tree[0].fieldCount).toBe(2);
  });

  it('nests model sections under the repeating group and keeps them out of the roots', () => {
    const tree = buildTemplateTree(
      [
        section({id: 'root', label: 'Source of Data', sort_order: 1}),
        section({
          id: 'grp',
          label: 'Prediction Models',
          role: 'model_container',
          cardinality: 'many',
          sort_order: 2,
        }),
        section({
          id: 'child',
          label: 'Model Development',
          role: 'model_section',
          parent_entity_type_id: 'grp',
          sort_order: 3,
        }),
      ],
      [field({id: 'f', entity_type_id: 'grp', label: 'Model name'})],
    );

    expect(tree.map((s) => s.id)).toEqual(['root', 'grp']);
    const group = tree[1];
    expect(group.kind).toBe('group');
    expect(group.fields.map((f) => f.label)).toEqual(['Model name']);
    expect(group.children.map((c) => c.label)).toEqual(['Model Development']);
    expect(group.children[0].kind).toBe('groupChild');
  });

  it('labels only non-default metadata (one-per-article stays silent)', () => {
    const tree = buildTemplateTree(
      [
        section({id: 'plain', sort_order: 1}),
        section({id: 'repeating', cardinality: 'many', sort_order: 2}),
        section({
          id: 'grp',
          role: 'model_container',
          cardinality: 'many',
          sort_order: 3,
        }),
        section({
          id: 'childOnce',
          role: 'model_section',
          parent_entity_type_id: 'grp',
          sort_order: 4,
        }),
        section({
          id: 'childMany',
          role: 'model_section',
          cardinality: 'many',
          parent_entity_type_id: 'grp',
          sort_order: 5,
        }),
      ],
      [],
    );

    // Copy tokens, not strings: this module stays i18n-free and the
    // component resolves them through lib/copy.
    expect(tree[0].metaKeys).toEqual([]);
    expect(tree[1].metaKeys).toEqual(['sectionMetaRepeatsPerArticle']);
    expect(tree[2].metaKeys).toEqual(['sectionMetaRepeatingGroup']);
    expect(tree[2].children[0].metaKeys).toEqual([]);
    expect(tree[2].children[1].metaKeys).toEqual(['sectionMetaRepeatsPerModel']);
  });

  it('flags a description dot and an AI instruction per field', () => {
    const tree = buildTemplateTree(
      [section({id: 'a', description: 'Where the data came from'})],
      [
        field({id: 'withAi', entity_type_id: 'a', llm_description: 'Classify strictly'}),
        field({id: 'plain', entity_type_id: 'a', sort_order: 2}),
      ],
    );

    expect(tree[0].hasDescription).toBe(true);
    expect(tree[0].fields[0].hasAiInstruction).toBe(true);
    expect(tree[0].fields[1].hasAiInstruction).toBe(false);
  });

  it('counts a group total across its identity fields and child sections', () => {
    const tree = buildTemplateTree(
      [
        section({id: 'grp', role: 'model_container', cardinality: 'many'}),
        section({id: 'child', role: 'model_section', parent_entity_type_id: 'grp'}),
      ],
      [
        field({id: 'f1', entity_type_id: 'grp'}),
        field({id: 'f2', entity_type_id: 'child'}),
        field({id: 'f3', entity_type_id: 'child', sort_order: 2}),
      ],
    );

    expect(tree[0].fieldCount).toBe(1);
    expect(tree[0].totalFieldCount).toBe(3);
  });

  it('treats an orphaned child (parent missing) as a root rather than dropping it', () => {
    const tree = buildTemplateTree(
      [section({id: 'lost', role: 'model_section', parent_entity_type_id: 'gone'})],
      [],
    );
    expect(tree.map((s) => s.id)).toEqual(['lost']);
  });
});

describe('normalizeForSearch', () => {
  it('is case- and diacritic-insensitive', () => {
    expect(normalizeForSearch('Predição ÁGIL')).toBe('predicao agil');
  });
});

describe('filterTemplateTree', () => {
  const tree = buildTemplateTree(
    [
      section({id: 'a', label: 'Source of Data', sort_order: 1}),
      section({id: 'b', label: 'Participants', sort_order: 2}),
      section({
        id: 'grp',
        label: 'Prediction Models',
        role: 'model_container',
        cardinality: 'many',
        sort_order: 3,
      }),
      section({
        id: 'child',
        label: 'Model Development',
        role: 'model_section',
        parent_entity_type_id: 'grp',
        sort_order: 4,
      }),
    ],
    [
      field({id: 'f1', entity_type_id: 'a', label: 'Study design', name: 'study_design'}),
      field({id: 'f2', entity_type_id: 'a', label: 'Country', sort_order: 2}),
      field({
        id: 'f3',
        entity_type_id: 'b',
        label: 'Age',
        llm_description: 'Report the mean age in years',
      }),
      field({id: 'f4', entity_type_id: 'child', label: 'Modelling method'}),
    ],
  );

  it('returns everything with counts when the query is empty', () => {
    const r = filterTemplateTree(tree, '');
    expect(r.isFiltering).toBe(false);
    expect(r.matchCount).toBe(4);
    expect(r.totalCount).toBe(4);
    expect(r.sections).toHaveLength(3);
  });

  it('keeps only matching fields when a field label matches', () => {
    const r = filterTemplateTree(tree, 'study');
    expect(r.matchCount).toBe(1);
    expect(r.sections.map((s) => s.id)).toEqual(['a']);
    expect(r.sections[0].fields.map((f) => f.label)).toEqual(['Study design']);
  });

  it('matches the hidden key column and reports why', () => {
    const r = filterTemplateTree(tree, 'study_design');
    expect(r.sections[0].fields[0].label).toBe('Study design');
    expect(r.sections[0].fields[0].matchHint).toBe('key');
  });

  it('matches an AI instruction and reports the hint', () => {
    const r = filterTemplateTree(tree, 'mean age');
    expect(r.matchCount).toBe(1);
    expect(r.sections[0].fields[0].matchHint).toBe('aiInstruction');
  });

  it('shows a self-matching section whole when nothing inside it matches', () => {
    const r = filterTemplateTree(tree, 'source of data');
    expect(r.sections.map((s) => s.id)).toEqual(['a']);
    expect(r.sections[0].fields).toHaveLength(2);
  });

  it('still narrows to the matching fields when the section ALSO matches', () => {
    // 'study' hits the section key/title haystack of neither section but
    // does hit one field; a section that matched broadly must not inflate
    // the count with rows the user did not ask for.
    const wide = buildTemplateTree(
      [section({id: 'perf', label: 'Model Performance', description: 'calibration and discrimination'})],
      [
        field({id: 'cal', entity_type_id: 'perf', label: 'Calibration slope'}),
        field({id: 'cstat', entity_type_id: 'perf', label: 'C-statistic', sort_order: 2}),
      ],
    );
    const r = filterTemplateTree(wide, 'calibration');
    expect(r.sections[0].fields.map((f) => f.label)).toEqual(['Calibration slope']);
    expect(r.matchCount).toBe(1);
  });

  it('ANDs whitespace-separated terms', () => {
    expect(filterTemplateTree(tree, 'study design').matchCount).toBe(1);
    expect(filterTemplateTree(tree, 'study country').matchCount).toBe(0);
  });

  it('keeps a group when only a child section matches, and prunes the rest', () => {
    const r = filterTemplateTree(tree, 'modelling');
    expect(r.sections.map((s) => s.id)).toEqual(['grp']);
    expect(r.sections[0].fields).toHaveLength(0);
    expect(r.sections[0].children.map((c) => c.id)).toEqual(['child']);
    expect(r.matchCount).toBe(1);
  });

  it('is diacritic-insensitive on both sides', () => {
    const accented = buildTemplateTree(
      [section({id: 'a', label: 'Predição'})],
      [field({id: 'f', entity_type_id: 'a', label: 'Modelo Ágil'})],
    );
    expect(filterTemplateTree(accented, 'agil').matchCount).toBe(1);
    expect(filterTemplateTree(accented, 'ÁGIL').matchCount).toBe(1);
  });

  it('reports no matches without throwing', () => {
    const r = filterTemplateTree(tree, 'zzz');
    expect(r.matchCount).toBe(0);
    expect(r.sections).toEqual([]);
  });
});
