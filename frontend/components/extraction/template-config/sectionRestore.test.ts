/**
 * Capturing and replaying a deleted section subtree (B-9d part 2).
 *
 * Deleting a section CASCADES: `extraction_fields_entity_type_id_fkey` and
 * `extraction_entity_types_parent_entity_type_id_fkey` are both ON DELETE
 * CASCADE, so removing a repeating group destroys its child sections and
 * every field beneath them. There is no soft-delete and no tombstone, so
 * Undo has to replay the whole subtree from a snapshot taken BEFORE the
 * delete — which is what makes these tests the load-bearing ones: a
 * snapshot that drops a property is a silent data loss the user asked to
 * reverse.
 */
import {describe, expect, it, vi} from 'vitest';

import {captureSection, replaySection} from './sectionRestore';
import type {TemplateEntityTypeWithFields} from '@/hooks/extraction/useTemplateEntityTypes';

const GROUP = {
  id: 'grp',
  name: 'models',
  label: 'Models',
  description: 'the group',
  role: 'model_container',
  cardinality: 'many',
  is_required: true,
  parent_entity_type_id: null,
  entry_label: 'model',
  sort_order: 0,
  fields: [
    {
      id: 'f-grp',
      entity_type_id: 'grp',
      name: 'model_name',
      label: 'Model name',
      description: null,
      field_type: 'text',
      is_required: true,
      allowed_values: null,
      unit: null,
      allowed_units: null,
      // Non-defaults for every property the first B-9d ship dropped: a
      // capture that loses any of these is a lossy undo.
      llm_description: 'Quote the model name verbatim from the abstract',
      allow_other: true,
      other_label: 'Other model',
      other_placeholder: 'Name the model',
      allows_not_applicable: true,
      allows_not_evaluated: true,
      validation_schema: {minLength: 2},
      sort_order: 0,
    },
  ],
} as unknown as TemplateEntityTypeWithFields;

const CHILD = {
  id: 'child',
  name: 'performance',
  label: 'Performance',
  description: null,
  role: 'model_section',
  cardinality: 'one',
  is_required: false,
  parent_entity_type_id: 'grp',
  entry_label: null,
  sort_order: 1,
  fields: [
    {
      id: 'f-child',
      entity_type_id: 'child',
      name: 'auc',
      label: 'AUC',
      description: null,
      field_type: 'number',
      is_required: false,
      allowed_values: null,
      unit: null,
      allowed_units: null,
      sort_order: 0,
    },
  ],
} as unknown as TemplateEntityTypeWithFields;

const UNRELATED = {
  id: 'other',
  name: 'other',
  label: 'Other',
  role: 'study_section',
  cardinality: 'one',
  is_required: false,
  parent_entity_type_id: null,
  entry_label: null,
  sort_order: 2,
  fields: [],
} as unknown as TemplateEntityTypeWithFields;

// A THIRD level: a repeating group's child can itself own a subsection,
// and a two-level fixture cannot tell breadth-first from depth-first.
const GRANDCHILD = {
  id: 'gchild',
  name: 'calibration',
  label: 'Calibration',
  description: null,
  role: 'model_section',
  cardinality: 'one',
  is_required: false,
  parent_entity_type_id: 'child',
  entry_label: null,
  sort_order: 0,
  fields: [],
} as unknown as TemplateEntityTypeWithFields;

const TREE = [GROUP, CHILD, GRANDCHILD, UNRELATED];

describe('captureSection', () => {
  it('captures the section, its descendants and every field', () => {
    const snapshot = captureSection(TREE, 'grp');

    expect(snapshot).not.toBeNull();
    expect(snapshot!.sections.map((s) => s.id)).toEqual(['grp', 'child', 'gchild']);
    expect(snapshot!.sections[0]!.fields.map((f) => f.name)).toEqual(['model_name']);
    expect(snapshot!.sections[1]!.fields.map((f) => f.name)).toEqual(['auc']);
  });

  it('never captures a sibling the cascade would not have touched', () => {
    const snapshot = captureSection(TREE, 'grp');
    expect(snapshot!.sections.map((s) => s.id)).not.toContain('other');
  });

  it('captures is_required — the property the tree read used to drop', () => {
    // A replay that defaults this to false silently downgrades a required
    // section, which is exactly the "lossy undo" this slice refused to
    // ship until the read carried the column.
    const snapshot = captureSection(TREE, 'grp');
    expect(snapshot!.sections[0]!.isRequired).toBe(true);
    expect(snapshot!.sections[1]!.isRequired).toBe(false);
  });

  it('returns null for an unknown id rather than an empty snapshot', () => {
    // An empty snapshot would "restore" nothing and report success.
    expect(captureSection(TREE, 'ghost')).toBeNull();
  });

  it('captures the AI instruction, other-option, disposition flags and validation schema', () => {
    // All seven are present on the raw row at capture time and accepted by
    // the create endpoint — dropping any of them makes the restore lossy
    // while still reporting success.
    const snapshot = captureSection(TREE, 'grp');
    expect(snapshot!.sections[0]!.fields[0]).toMatchObject({
      aiInstruction: 'Quote the model name verbatim from the abstract',
      allowOther: true,
      otherLabel: 'Other model',
      otherPlaceholder: 'Name the model',
      allowsNotApplicable: true,
      allowsNotEvaluated: true,
      validationSchema: {minLength: 2},
    });
    // A row that never set them captures the server defaults, not undefined.
    expect(snapshot!.sections[1]!.fields[0]).toMatchObject({
      aiInstruction: null,
      allowOther: false,
      otherLabel: null,
      otherPlaceholder: null,
      allowsNotApplicable: false,
      allowsNotEvaluated: false,
      validationSchema: {},
    });
  });
});

describe('replaySection', () => {
  function deps(overrides: Partial<Parameters<typeof replaySection>[1]> = {}) {
    return {
      createSection: vi.fn(async (_params: {parentEntityTypeId?: string | null}) => ({
        ok: true as const,
        data: {id: `new-${Math.random().toString(36).slice(2, 7)}`},
      })),
      insertField: vi.fn(async () => ({ok: true as const, data: {id: 'nf'}})),
      ...overrides,
    } as Parameters<typeof replaySection>[1];
  }

  it('recreates parents BEFORE children, re-parenting onto the new ids', async () => {
    // The child's captured parent id is dead — the cascade took it. It has
    // to be rewritten to the id the replayed parent just received.
    const snapshot = captureSection(TREE, 'grp')!;
    const d = deps();
    const created: string[] = [];
    vi.mocked(d.createSection).mockImplementation(async (params) => {
      created.push(`${params.name}:${params.parentEntityTypeId ?? 'root'}`);
      return {ok: true, data: {id: `new-${params.name}`}};
    });

    const ok = await replaySection(snapshot, d);

    expect(ok).toBe(true);
    expect(created).toEqual([
      'models:root',
      'performance:new-models',
      'calibration:new-performance',
    ]);
  });

  it('inserts each field into its OWN replayed section', async () => {
    const snapshot = captureSection(TREE, 'grp')!;
    const d = deps();
    vi.mocked(d.createSection).mockImplementation(async (params) => ({
      ok: true,
      data: {id: `new-${params.name}`},
    }));

    await replaySection(snapshot, d);

    const targets = vi
      .mocked(d.insertField)
      .mock.calls.map((call) => `${call[0].name}->${call[0].entity_type_id}`);
    expect(targets).toEqual(['model_name->new-models', 'auc->new-performance']);
  });

  it('hands insertField the FULL captured payload — nothing silently dropped', async () => {
    const snapshot = captureSection(TREE, 'grp')!;
    const d = deps();
    vi.mocked(d.createSection).mockImplementation(async (params) => ({
      ok: true,
      data: {id: `new-${params.name}`},
    }));

    await replaySection(snapshot, d);

    expect(d.insertField).toHaveBeenCalledWith({
      entity_type_id: 'new-models',
      name: 'model_name',
      label: 'Model name',
      description: null,
      field_type: 'text',
      is_required: true,
      allowed_values: null,
      unit: null,
      allowed_units: null,
      llm_description: 'Quote the model name verbatim from the abstract',
      allow_other: true,
      other_label: 'Other model',
      other_placeholder: 'Name the model',
      allows_not_applicable: true,
      allows_not_evaluated: true,
      validation_schema: {minLength: 2},
      sort_order: 0,
    });
  });

  it('stops and reports failure when a section cannot be recreated', async () => {
    // Reporting success on a partial replay would leave the user believing
    // their subtree came back.
    const snapshot = captureSection(TREE, 'grp')!;
    const d = deps();
    vi.mocked(d.createSection).mockResolvedValueOnce({
      ok: false,
      error: new Error('nope'),
    } as never);

    expect(await replaySection(snapshot, d)).toBe(false);
    expect(d.insertField).not.toHaveBeenCalled();
  });

  it('reports failure when a field cannot be restored', async () => {
    const snapshot = captureSection(TREE, 'grp')!;
    const d = deps();
    vi.mocked(d.insertField).mockResolvedValueOnce({
      ok: false,
      error: new Error('nope'),
    } as never);

    expect(await replaySection(snapshot, d)).toBe(false);
  });
});
