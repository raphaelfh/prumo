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
function entity(id: string, role: ExtractionEntityTypeWithFields['role'], cardinality: 'one' | 'many', fields: ReturnType<typeof field>[]): ExtractionEntityTypeWithFields {
  return {
    id, template_id: 't', name: id, label: `Label ${id}`, description: null,
    parent_entity_type_id: null, cardinality, role, sort_order: 0,
    is_required: true, created_at: '', fields: fields.map(f => ({ ...f, entity_type_id: id })),
  };
}
function instance(id: string, entity_type_id: string, parent_instance_id: string | null = null): ExtractionInstance {
  return {
    id, project_id: 'p', article_id: 'a', template_id: 't', entity_type_id,
    parent_instance_id, label: id, sort_order: 0, status: 'pending',
    metadata: null, created_by: 'u', created_at: '', updated_at: '',
  };
}

describe('buildSectionRegistry', () => {
  it('marks a study section complete when all required fields are filled', () => {
    const et = entity('s1', 'study_section', 'one', [field('f1', true), field('f2', true)]);
    const args: BuildSectionRegistryArgs = {
      studyLevelSections: [et], modelChildSections: [], instances: [instance('i1', 's1')],
      values: { i1_f1: 'x', i1_f2: 'y' }, activeModelId: null,
    };
    const [item] = buildSectionRegistry(args);
    expect(item).toMatchObject({ id: 's1', label: 'Label s1', requiredTotal: 2, requiredFilled: 2, state: 'complete', level: 0 });
  });

  it('marks in_progress when partially filled and empty when none filled', () => {
    const et = entity('s1', 'study_section', 'one', [field('f1', true), field('f2', true)]);
    const partial = buildSectionRegistry({ studyLevelSections: [et], modelChildSections: [], instances: [instance('i1', 's1')], values: { i1_f1: 'x' }, activeModelId: null })[0];
    const empty = buildSectionRegistry({ studyLevelSections: [et], modelChildSections: [], instances: [instance('i1', 's1')], values: {}, activeModelId: null })[0];
    expect(partial.state).toBe('in_progress');
    expect(empty.state).toBe('empty');
  });

  it('emits model container at level 0 and model children at level 1, scoped to the active model', () => {
    const study = entity('s1', 'study_section', 'one', [field('f1', true)]);
    const container = entity('mc', 'model_container', 'many', []);
    const child = entity('cs', 'model_section', 'many', [field('cf', true)]);
    const items = buildSectionRegistry({
      studyLevelSections: [study], modelParentEntityType: container, modelChildSections: [child],
      instances: [instance('i1', 's1'), instance('m1', 'mc'), instance('ci', 'cs', 'm1')],
      values: { ci_cf: 'done' }, activeModelId: 'm1',
    });
    expect(items.map(i => [i.id, i.level])).toEqual([['s1', 0], ['mc', 0], ['cs', 1]]);
    expect(items.find(i => i.id === 'cs')).toMatchObject({ requiredTotal: 1, requiredFilled: 1, state: 'complete' });
  });

  it('globalProgressFromRegistry sums required and computes left + percentage', () => {
    const items = [
      { id: 'a', label: 'A', requiredTotal: 2, requiredFilled: 2, state: 'complete' as const, level: 0 as const },
      { id: 'b', label: 'B', requiredTotal: 6, requiredFilled: 0, state: 'empty' as const, level: 0 as const },
    ];
    expect(globalProgressFromRegistry(items)).toEqual({ requiredFilled: 2, requiredTotal: 8, requiredLeft: 6, percentage: 25 });
  });
});
