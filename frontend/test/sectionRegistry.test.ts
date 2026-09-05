import { describe, expect, it } from 'vitest';
import {
  buildSectionRegistry,
  globalProgressFromRegistry,
  type BuildSectionRegistryArgs,
} from '@/lib/extraction/sectionRegistry';
import type { ExtractionEntityTypeWithFields, ExtractionInstance } from '@/types/extraction';

function field(id: string, required: boolean) {
  return {
    id, entity_type_id: 'et', name: id, label: id, description: null,
    field_type: 'text' as const, is_required: required, validation_schema: null,
    allowed_values: null, unit: null, allowed_units: null, llm_description: null,
    sort_order: 0, created_at: '',
  };
}
function entity(id: string, role: ExtractionEntityTypeWithFields['role'], cardinality: 'one' | 'many', fields: ReturnType<typeof field>[], parent: string | null = null): ExtractionEntityTypeWithFields {
  return {
    id, template_id: 't', name: id, label: `Label ${id}`, description: null,
    parent_entity_type_id: parent, cardinality, role, sort_order: 0,
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

describe('buildSectionRegistry', () => {
  it('marks a study section complete when all required fields are filled', () => {
    const et = entity('s1', 'study_section', 'one', [field('f1', true), field('f2', true)]);
    const args: BuildSectionRegistryArgs = {
      roots: [et], entityTypes: [et], articleId: 'a1', instances: [instance('i1', 's1')],
      values: { i1_f1: 'x', i1_f2: 'y' }, activeEntries: {},
    };
    const [item] = buildSectionRegistry(args);
    expect(item).toMatchObject({ id: 's1', label: 'Label s1', requiredTotal: 2, requiredFilled: 2, state: 'complete', level: 0 });
  });

  it('marks in_progress when partially filled and empty when none filled', () => {
    const et = entity('s1', 'study_section', 'one', [field('f1', true), field('f2', true)]);
    const partial = buildSectionRegistry({ roots: [et], entityTypes: [et], articleId: 'a1', instances: [instance('i1', 's1')], values: { i1_f1: 'x' }, activeEntries: {}})[0];
    const empty = buildSectionRegistry({ roots: [et], entityTypes: [et], articleId: 'a1', instances: [instance('i1', 's1')], values: {}, activeEntries: {}})[0];
    expect(partial.state).toBe('in_progress');
    expect(empty.state).toBe('empty');
  });

  it('omits a nested row while the group has no entries', () => {
    const study = entity('s1', 'study_section', 'one', [field('f1', true)]);
    const group = entity('mc', 'model_container', 'many', []);
    const child = entity('cs', 'model_section', 'many', [field('cf', true)], 'mc');
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
    const study = entity('s1', 'study_section', 'one', [field('f1', true)]);
    const group = entity('mc', 'model_container', 'many', []);
    const child = entity('cs', 'model_section', 'many', [field('cf', true)], 'mc');
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
      activeEntries: { 'active-entry-a1-mc-root': 'm2' },
    });
    expect(second.find(i => i.id === 'cs')).toMatchObject({ requiredTotal: 1 });
  });

  it('counts filled values from EVERY entry, not just the scoped one', () => {
    // Pre-existing behaviour of the shared metric, pinned here because it is
    // surprising and because the fix belongs to `computeRequiredFieldProgress`
    // (shared with the article list and the dashboard), not to the registry:
    // `instanceIdsByEntityType` narrows the DENOMINATOR only, while the
    // completed loop (progress.ts) walks every value and checks the field's
    // entity type alone. The two-level registry had the same behaviour.
    const group = entity('mc', 'model_container', 'many', []);
    const child = entity('cs', 'model_section', 'many', [field('cf', true)], 'mc');
    const items = buildSectionRegistry({
      roots: [group], entityTypes: [group, child], articleId: 'a1',
      instances: [
        instance('m1', 'mc'), instance('m2', 'mc'),
        instance('c1', 'cs', 'm1'), instance('c2', 'cs', 'm2'),
      ],
      // Only m1's child is filled, but m2 is the active entry.
      values: { c1_cf: 'done' },
      activeEntries: { 'active-entry-a1-mc-root': 'm2' },
    });
    const cs = items.find(i => i.id === 'cs');
    expect(cs).toMatchObject({ requiredTotal: 1, requiredFilled: 1 });
  });

  it('walks deeper than two levels', () => {
    // The old builder was typed `level: 0 | 1`. Depth three is what B5's
    // schema change makes representable; the registry is ready for it.
    const group = entity('g1', 'model_container', 'many', []);
    const nested = entity('g2', 'model_section', 'many', [], 'g1');
    const leaf = entity('leaf', 'model_section', 'one', [field('lf', true)], 'g2');
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
