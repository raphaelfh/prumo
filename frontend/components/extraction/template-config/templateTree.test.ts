import {describe, expect, it} from 'vitest';

import {
  buildTemplateTree,
  deriveMoveTargets,
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

  it('carries sort_order onto GridField — move/reorder writes renumber from it (B-6)', () => {
    const tree = buildTemplateTree(
      [section({id: 'a', sort_order: 1})],
      [
        field({id: 'f1', entity_type_id: 'a', sort_order: 3}),
        field({id: 'f2', entity_type_id: 'a'}),
      ],
    );

    expect(tree[0].fields.map((f) => f.sortOrder)).toEqual([0, 3]);
  });

  it('nests model sections under the repeating group and keeps them out of the roots', () => {
    const tree = buildTemplateTree(
      [
        section({id: 'root', label: 'Source of Data', sort_order: 1}),
        section({
          id: 'grp',
          label: 'Prediction Models',
          cardinality: 'many',
          sort_order: 2,
        }),
        section({
          id: 'child',
          label: 'Model Development',
          parent_entity_type_id: 'grp',
          sort_order: 3,
        }),
      ],
      [field({id: 'f', entity_type_id: 'grp', label: 'Model name'})],
    );

    expect(tree.map((s) => s.id)).toEqual(['root', 'grp']);
    const group = tree[1];
    expect(group.repeats).toBe(true);
    expect(group.ownsChildren).toBe(true);
    expect(group.depth).toBe(0);
    expect(group.fields.map((f) => f.label)).toEqual(['Model name']);
    expect(group.children.map((c) => c.label)).toEqual(['Model Development']);
    expect(group.children[0].depth).toBe(1);
    expect(group.children[0].ownsChildren).toBe(false);
  });

  it('labels only non-default metadata (one-per-article stays silent)', () => {
    const tree = buildTemplateTree(
      [
        section({id: 'plain', sort_order: 1}),
        section({id: 'repeating', cardinality: 'many', sort_order: 2}),
        section({
          id: 'grp',
          cardinality: 'many',
          sort_order: 3,
        }),
        section({
          id: 'childOnce',
          parent_entity_type_id: 'grp',
          sort_order: 4,
        }),
        section({
          id: 'childMany',
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
    expect(tree[2].children[1].metaKeys).toEqual(['sectionMetaRepeatsPerEntry']);
  });

  it('projects cardinality onto every section (the inspector edits it)', () => {
    const tree = buildTemplateTree(
      [
        section({id: 'plain', sort_order: 1}),
        section({id: 'grp', cardinality: 'many', sort_order: 2}),
        section({
          id: 'childOnce',
          parent_entity_type_id: 'grp',
          sort_order: 3,
        }),
      ],
      [],
    );

    expect(tree[0].cardinality).toBe('one');
    expect(tree[1].cardinality).toBe('many');
    expect(tree[1].children[0].cardinality).toBe('one');
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
        section({id: 'grp', cardinality: 'many'}),
        section({id: 'child', parent_entity_type_id: 'grp'}),
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

  it('resolves entryNoun from the own entry_label and children inherit it as scopeNoun (B-8 D7)', () => {
    const tree = buildTemplateTree(
      [
        section({
          id: 'grp',
          cardinality: 'many',
          entry_label: 'algorithm',
          sort_order: 1,
        }),
        section({
          id: 'child',
          parent_entity_type_id: 'grp',
          sort_order: 2,
        }),
      ],
      [],
    );

    expect(tree[0].entryNoun).toBe('algorithm');
    expect(tree[0].scopeNoun).toBeNull();
    // The child sits INSIDE one algorithm — that is its scope, not its own
    // noun. Two levels could conflate the two because a section was never
    // both a group and a child; 0069 makes it both.
    expect(tree[0].children[0].scopeNoun).toBe('algorithm');
    expect(tree[0].children[0].entryNoun).toBe('entry');
  });

  it('carries each section OWN entry_label separately from the inherited group noun', () => {
    // Entry-group train: a repeating child names its own entries ("validation")
    // while still repeating per the parent's noun ("algorithm"). Both must be
    // available — one word cannot play both parts.
    const tree = buildTemplateTree(
      [
        section({
          id: 'grp',
          cardinality: 'many',
          entry_label: 'algorithm',
          sort_order: 1,
        }),
        section({
          id: 'perf',
          parent_entity_type_id: 'grp',
          cardinality: 'many',
          entry_label: 'validation',
          sort_order: 2,
        }),
        section({id: 'arms', cardinality: 'many', entry_label: 'arm', sort_order: 3}),
        section({id: 'plain', sort_order: 4}),
      ],
      [],
    );

    expect(tree[0].ownEntryLabel).toBe('algorithm');
    expect(tree[0].children[0].scopeNoun).toBe('algorithm');
    expect(tree[0].children[0].entryNoun).toBe('validation');
    expect(tree[0].children[0].ownEntryLabel).toBe('validation');
    expect(tree[1].ownEntryLabel).toBe('arm');
    expect(tree[2].ownEntryLabel).toBeNull();
  });

  it('falls back entryNoun to "entry" when entry_label is null or absent', () => {
    const tree = buildTemplateTree(
      [
        section({
          id: 'grpNull',
          cardinality: 'many',
          entry_label: null,
          sort_order: 1,
        }),
        section({
          id: 'grpAbsent',
          cardinality: 'many',
          sort_order: 2,
        }),
        section({
          id: 'child',
          parent_entity_type_id: 'grpNull',
          sort_order: 3,
        }),
      ],
      [],
    );

    expect(tree[0].entryNoun).toBe('entry');
    expect(tree[0].children[0].entryNoun).toBe('entry');
    expect(tree[1].entryNoun).toBe('entry');
  });

  it('gives root sections the total fallback entryNoun "entry" (unused but total)', () => {
    const tree = buildTemplateTree(
      [section({id: 'root', entry_label: null, sort_order: 1})],
      [],
    );

    expect(tree[0].entryNoun).toBe('entry');
  });

  it('treats an orphaned child (parent missing) as a root rather than dropping it', () => {
    const tree = buildTemplateTree(
      [section({id: 'lost', parent_entity_type_id: 'gone'})],
      [],
    );
    expect(tree.map((s) => s.id)).toEqual(['lost']);
  });
});

describe('buildTemplateTree — depth (trees B5b)', () => {
  it('nests a group under a group, at any depth, and stamps depth on each level', () => {
    const tree = buildTemplateTree(
      [
        section({id: 'root', cardinality: 'many', entry_label: 'model', sort_order: 1}),
        section({
          id: 'middle',
          parent_entity_type_id: 'root',
          cardinality: 'many',
          entry_label: 'validation',
          sort_order: 1,
        }),
        section({id: 'leaf', parent_entity_type_id: 'middle', sort_order: 1}),
      ],
      [field({id: 'f', entity_type_id: 'leaf'})],
    );

    expect(tree).toHaveLength(1);
    const [root] = tree;
    expect(root.depth).toBe(0);
    expect(root.repeats).toBe(true);
    expect(root.ownsChildren).toBe(true);

    const [middle] = root.children;
    expect(middle.id).toBe('middle');
    expect(middle.depth).toBe(1);
    expect(middle.ownsChildren).toBe(true);

    // The level 0069 made representable and the two-level builder dropped.
    const [leaf] = middle.children;
    expect(leaf.id).toBe('leaf');
    expect(leaf.depth).toBe(2);
    expect(leaf.repeats).toBe(false);
    expect(leaf.ownsChildren).toBe(false);
    expect(leaf.fields.map((f) => f.id)).toEqual(['f']);
  });

  it('counts a grandchild\'s fields in an ancestor\'s totalFieldCount', () => {
    const tree = buildTemplateTree(
      [
        section({id: 'root', cardinality: 'many', entry_label: 'model'}),
        section({
          id: 'middle',
          parent_entity_type_id: 'root',
          cardinality: 'many',
          entry_label: 'run',
        }),
        section({id: 'leaf', parent_entity_type_id: 'middle'}),
      ],
      [
        field({id: 'a', entity_type_id: 'root'}),
        field({id: 'b', entity_type_id: 'middle'}),
        field({id: 'c', entity_type_id: 'leaf'}),
      ],
    );

    expect(tree[0].fieldCount).toBe(1);
    expect(tree[0].totalFieldCount).toBe(3);
  });

  it('offers a grandchild as a move destination', () => {
    // The two-level flatten dropped it, so a field could not be moved INTO
    // a nested group's child at all.
    const tree = buildTemplateTree(
      [
        section({id: 'root', cardinality: 'many', entry_label: 'model', sort_order: 1}),
        section({
          id: 'middle',
          parent_entity_type_id: 'root',
          cardinality: 'many',
          entry_label: 'run',
          sort_order: 1,
        }),
        section({id: 'leaf', parent_entity_type_id: 'middle', sort_order: 1}),
      ],
      [],
    );

    expect(deriveMoveTargets(tree)).toEqual([
      {id: 'root', label: 'root', depth: 0, fieldCount: 0},
      {id: 'middle', label: 'middle', depth: 1, fieldCount: 0},
      {id: 'leaf', label: 'leaf', depth: 2, fieldCount: 0},
    ]);
  });

  it('terminates on a parent cycle instead of recursing forever', () => {
    // Unreachable through the API (the FK plus the parent-repeats trigger),
    // but a builder that trusts the data hangs the whole Config tab, and a
    // hung tab is indistinguishable from a crashed one.
    const tree = buildTemplateTree(
      [
        section({id: 'a', parent_entity_type_id: 'b', cardinality: 'many', entry_label: 'x'}),
        section({id: 'b', parent_entity_type_id: 'a', cardinality: 'many', entry_label: 'y'}),
      ],
      [],
    );

    expect(tree.map((s) => s.id).sort()).toEqual(['a']);
  });
});

describe('deriveMoveTargets (B-6 T4)', () => {
  it('flattens EVERY section as a destination — group children right after their group, own fieldCount carried', () => {
    const tree = buildTemplateTree(
      [
        section({id: 'root1', sort_order: 1}),
        section({
          id: 'grp',
          cardinality: 'many',
          sort_order: 2,
        }),
        section({
          id: 'child',
          parent_entity_type_id: 'grp',
          sort_order: 3,
        }),
        section({id: 'root2', sort_order: 4}),
      ],
      [
        field({id: 'f1', entity_type_id: 'root1'}),
        field({id: 'f2', entity_type_id: 'child'}),
        field({id: 'f3', entity_type_id: 'child', sort_order: 2}),
      ],
    );

    expect(deriveMoveTargets(tree)).toEqual([
      {id: 'root1', label: 'root1', depth: 0, fieldCount: 1},
      {id: 'grp', label: 'grp', depth: 0, fieldCount: 0},
      {id: 'child', label: 'child', depth: 1, fieldCount: 2},
      {id: 'root2', label: 'root2', depth: 0, fieldCount: 0},
    ]);
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
        cardinality: 'many',
        sort_order: 3,
      }),
      section({
        id: 'child',
        label: 'Model Development',
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
