import { describe, expect, it } from 'vitest';
import {
  buildSectionRegistry,
  globalProgressFromRegistry,
  type BuildSectionRegistryArgs,
} from '@/lib/extraction/sectionRegistry';
import { entrySlotKey } from '@/lib/extraction/entrySlots';
import type { ExtractionEntityTypeWithFields, ExtractionInstance } from '@/types/extraction';

function field(id: string, required: boolean) {
  return {
    id, entity_type_id: 'et', name: id, label: id, description: null,
    field_type: 'text' as const, is_required: required, validation_schema: null,
    allowed_values: null, unit: null, allowed_units: null, llm_description: null,
    sort_order: 0, created_at: '',
  };
}
function entity(id: string, cardinality: 'one' | 'many', fields: ReturnType<typeof field>[], parent: string | null = null): ExtractionEntityTypeWithFields {
  return {
    id, template_id: 't', name: id, label: `Label ${id}`, description: null,
    parent_entity_type_id: parent, cardinality, sort_order: 0,
    is_required: true, entry_label: null, created_at: '',
    fields: fields.map(f => ({ ...f, entity_type_id: id })),
  };
}
function instance(id: string, entity_type_id: string, parent_instance_id: string | null = null): ExtractionInstance {
  return {
    id, project_id: 'p', article_id: 'a', template_id: 't', entity_type_id,
    parent_instance_id, label: id, sort_order: 0,
    metadata: null, created_by: 'u', created_at: '', updated_at: '',
  };
}

/**
 * The selection map as the form writes it: keyed by `entrySlotKey`, like
 * `useEntryGroup`. A registry that built the key any other way would miss the
 * selection and describe the first entry, which these tests would catch.
 */
function showing(entryId: string): Record<string, string> {
  return { [entrySlotKey('a1', 'mc', null)]: entryId };
}

describe('buildSectionRegistry', () => {
  it('marks a study section complete when all required fields are filled', () => {
    const et = entity('s1', 'one', [field('f1', true), field('f2', true)]);
    const args: BuildSectionRegistryArgs = {
      roots: [et], entityTypes: [et], articleId: 'a1', instances: [instance('i1', 's1')],
      values: { i1_f1: 'x', i1_f2: 'y' }, activeEntries: {},
    };
    const [item] = buildSectionRegistry(args);
    expect(item).toMatchObject({ id: 's1', label: 'Label s1', requiredTotal: 2, requiredFilled: 2, state: 'complete', level: 0 });
  });

  it('marks in_progress when partially filled and empty when none filled', () => {
    const et = entity('s1', 'one', [field('f1', true), field('f2', true)]);
    const partial = buildSectionRegistry({ roots: [et], entityTypes: [et], articleId: 'a1', instances: [instance('i1', 's1')], values: { i1_f1: 'x' }, activeEntries: {}})[0];
    const empty = buildSectionRegistry({ roots: [et], entityTypes: [et], articleId: 'a1', instances: [instance('i1', 's1')], values: {}, activeEntries: {}})[0];
    expect(partial.state).toBe('in_progress');
    expect(empty.state).toBe('empty');
  });

  it('omits a nested row while the group has no entries', () => {
    const study = entity('s1', 'one', [field('f1', true)]);
    const group = entity('mc', 'many', []);
    const child = entity('cs', 'many', [field('cf', true)], 'mc');
    const items = buildSectionRegistry({
      roots: [study, group], entityTypes: [study, group, child], articleId: 'a1',
      // No instance of the group, so there is no entry to scope a child to.
      instances: [instance('i1', 's1')],
      values: {}, activeEntries: {},
    });
    expect(items.map(i => [i.id, i.level])).toEqual([['s1', 0], ['mc', 0]]);
    expect(items.some(i => i.level === 1)).toBe(false);
  });

  it('scopes a nested row to the entry the form is showing', () => {
    const study = entity('s1', 'one', [field('f1', true)]);
    const group = entity('mc', 'many', []);
    const child = entity('cs', 'many', [field('cf', true)], 'mc');
    const instances = [
      instance('i1', 's1'),
      instance('m1', 'mc'), instance('m2', 'mc'),
      // m1 holds TWO child entries, m2 holds one. The required-slot count is
      // what makes the scope observable.
      instance('c1', 'cs', 'm1'), instance('c1b', 'cs', 'm1'),
      instance('c2', 'cs', 'm2'),
    ];
    const args = {
      roots: [study, group], entityTypes: [study, group, child], articleId: 'a1',
      instances, values: {},
    };

    // No stored selection → the first entry, which has two child entries.
    const first = buildSectionRegistry({ ...args, activeEntries: {} });
    expect(first.map(i => [i.id, i.level])).toEqual([['s1', 0], ['mc', 0], ['cs', 1]]);
    expect(first.find(i => i.id === 'cs')).toMatchObject({ requiredTotal: 2 });

    // Switch: the SAME nested section now describes m2's single entry. A
    // registry that ignored the active entry would report 3 (all of them)
    // or 2 (still m1's) either way.
    const second = buildSectionRegistry({
      ...args,
      activeEntries: showing('m2'),
    });
    expect(second.find(i => i.id === 'cs')).toMatchObject({ requiredTotal: 1 });
  });

  it('counts filled values from the scoped entry ONLY', () => {
    // Inverted from the behaviour this test used to pin. The scoping lives in
    // `computeRequiredFieldProgress` (shared with the article list and the
    // dashboard), not in the registry: `instanceIdsByEntityType` used to narrow
    // the DENOMINATOR only, while the completed loop walked every value and
    // checked the field's entity type alone — so a section could read complete
    // while the entry on screen was empty, and `requiredFilled` could exceed
    // `requiredTotal`. It now narrows both sides.
    const group = entity('mc', 'many', []);
    const child = entity('cs', 'many', [field('cf', true)], 'mc');
    const args = {
      roots: [group], entityTypes: [group, child], articleId: 'a1',
      instances: [
        instance('m1', 'mc'), instance('m2', 'mc'),
        instance('c1', 'cs', 'm1'), instance('c2', 'cs', 'm2'),
      ],
      // Only m1's child is filled.
      values: { c1_cf: 'done' },
    };

    // m2 is the active entry: its own child entry is empty.
    const onM2 = buildSectionRegistry({
      ...args,
      activeEntries: showing('m2'),
    });
    expect(onM2.find(i => i.id === 'cs')).toMatchObject({
      requiredTotal: 1, requiredFilled: 0, state: 'empty',
    });

    // Switching back to m1 shows the value that IS in scope — the guard against
    // a fix that simply stopped counting nested values altogether.
    const onM1 = buildSectionRegistry({
      ...args,
      activeEntries: showing('m1'),
    });
    expect(onM1.find(i => i.id === 'cs')).toMatchObject({
      requiredTotal: 1, requiredFilled: 1, state: 'complete',
    });
  });

  it('walks deeper than two levels', () => {
    // The old builder was typed `level: 0 | 1`. Depth three is what B5's
    // schema change makes representable; the registry is ready for it.
    const group = entity('g1', 'many', []);
    const nested = entity('g2', 'many', [], 'g1');
    const leaf = entity('leaf', 'one', [field('lf', true)], 'g2');
    const items = buildSectionRegistry({
      roots: [group], entityTypes: [group, nested, leaf], articleId: 'a1',
      instances: [instance('e1', 'g1'), instance('e2', 'g2', 'e1'), instance('l1', 'leaf', 'e2')],
      values: {}, activeEntries: {},
    });
    expect(items.map(i => [i.id, i.level])).toEqual([['g1', 0], ['g2', 1], ['leaf', 2]]);
  });

  it('globalProgressFromRegistry sums required and computes left + percentage', () => {
    const items = [
      { id: 'a', label: 'A', requiredTotal: 2, requiredFilled: 2, state: 'complete' as const, level: 0 as const },
      { id: 'b', label: 'B', requiredTotal: 6, requiredFilled: 0, state: 'empty' as const, level: 0 as const },
    ];
    expect(globalProgressFromRegistry(items)).toEqual({ requiredFilled: 2, requiredTotal: 8, requiredLeft: 6, percentage: 25 });
  });
});
