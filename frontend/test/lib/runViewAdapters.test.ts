/**
 * Unit tests for runViewAdapters — pure functions that map a RunViewResponse
 * onto the extraction form's types (ExtractionEntityTypeWithFields[] and
 * ExtractionInstance[]).
 *
 * Step 1 (RED): module is absent — these tests should fail at import.
 * Step 2 (GREEN): implement the adapters.
 */
import {describe, expect, it} from 'vitest';

import type {RunViewResponse} from '@/hooks/runs/types';
import {entityTypesFromRunView, instancesFromRunView} from '@/lib/extraction/runViewAdapters';

// ---------------------------------------------------------------------------
// Minimal fixture factory
// ---------------------------------------------------------------------------

function makeRunViewResponse(
  overrides: Partial<RunViewResponse> = {},
): RunViewResponse {
  const run = {
    id: 'run-1',
    project_id: 'proj-1',
    article_id: 'art-1',
    template_id: 'tmpl-1',
    kind: 'extraction',
    version_id: 'ver-1',
    stage: 'review',
    status: 'in_progress',
    hitl_config_snapshot: {},
    parameters: {},
    results: {},
    created_at: '2024-01-01T00:00:00Z',
    created_by: 'user-1',
  };

  const entityTypes = [
    {
      id: 'et-1',
      name: 'study',
      label: 'Study',
      description: 'Top-level study entity',
      parent_entity_type_id: null,
      cardinality: 'one' as const,
      role: 'study_section' as const,
      sort_order: 0,
      is_required: true,
      fields: [
        {
          id: 'f-1',
          name: 'title',
          label: 'Title',
          description: 'Article title',
          field_type: 'text' as const,
          is_required: true,
          validation_schema: null,
          allowed_values: null,
          unit: null,
          allowed_units: null,
          sort_order: 0,
          llm_description: null,
          allow_other: false,
          other_label: null,
          other_placeholder: null,
        },
      ],
    },
  ];

  const instances = [
    {
      id: 'inst-1',
      entity_type_id: 'et-1',
      parent_instance_id: null,
      label: 'Main Study',
      sort_order: 0,
      status: 'pending' as const,
      metadata: {},
      project_id: 'proj-1',
      article_id: null, // deliberately null to test fallback
      template_id: 'tmpl-1',
      created_by: 'user-1',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    },
  ];

  return {
    run,
    proposals: [],
    decisions: [],
    consensus_decisions: [],
    published_states: [],
    entity_types: entityTypes,
    current_values: [],
    instances,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// entityTypesFromRunView
// ---------------------------------------------------------------------------

describe('entityTypesFromRunView', () => {
  it('injects template_id from run onto each entity type', () => {
    const view = makeRunViewResponse();
    const [et] = entityTypesFromRunView(view);
    expect(et.template_id).toBe('tmpl-1');
  });

  it('maps core entity type fields through correctly', () => {
    const view = makeRunViewResponse();
    const [et] = entityTypesFromRunView(view);
    expect(et.id).toBe('et-1');
    expect(et.name).toBe('study');
    expect(et.label).toBe('Study');
    expect(et.description).toBe('Top-level study entity');
    expect(et.parent_entity_type_id).toBeNull();
    expect(et.is_required).toBe(true);
    expect(et.sort_order).toBe(0);
  });

  it('casts cardinality and role through', () => {
    const view = makeRunViewResponse();
    const [et] = entityTypesFromRunView(view);
    expect(et.cardinality).toBe('one');
    expect(et.role).toBe('study_section');
  });

  it('injects entity_type_id onto each field', () => {
    const view = makeRunViewResponse();
    const [et] = entityTypesFromRunView(view);
    expect(et.fields).toHaveLength(1);
    expect(et.fields[0].entity_type_id).toBe('et-1');
  });

  it('maps field properties correctly', () => {
    const view = makeRunViewResponse();
    const [et] = entityTypesFromRunView(view);
    const f = et.fields[0];
    expect(f.id).toBe('f-1');
    expect(f.name).toBe('title');
    expect(f.label).toBe('Title');
    expect(f.field_type).toBe('text');
    expect(f.is_required).toBe(true);
    expect(f.sort_order).toBe(0);
    expect(f.allow_other).toBe(false);
    expect(f.other_label).toBeNull();
    expect(f.other_placeholder).toBeNull();
  });

  it('sets created_at placeholder from run.created_at on entity type', () => {
    const view = makeRunViewResponse();
    const [et] = entityTypesFromRunView(view);
    expect(et.created_at).toBe('2024-01-01T00:00:00Z');
  });

  it('sets created_at placeholder from run.created_at on fields', () => {
    const view = makeRunViewResponse();
    const [et] = entityTypesFromRunView(view);
    expect(et.fields[0].created_at).toBe('2024-01-01T00:00:00Z');
  });

  it('returns empty array when entity_types is empty', () => {
    const view = makeRunViewResponse({entity_types: []});
    expect(entityTypesFromRunView(view)).toEqual([]);
  });

  it('handles multiple entity types', () => {
    const view = makeRunViewResponse();
    view.entity_types = [
      ...view.entity_types,
      {
        id: 'et-2',
        name: 'models',
        label: 'Models',
        description: null,
        parent_entity_type_id: 'et-1',
        cardinality: 'many',
        role: 'model_container',
        sort_order: 1,
        is_required: false,
        fields: [],
      },
    ];
    const ets = entityTypesFromRunView(view);
    expect(ets).toHaveLength(2);
    expect(ets[1].template_id).toBe('tmpl-1');
    expect(ets[1].cardinality).toBe('many');
    expect(ets[1].role).toBe('model_container');
    expect(ets[1].fields).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// instancesFromRunView
// ---------------------------------------------------------------------------

describe('instancesFromRunView', () => {
  it('falls back to run.article_id when instance article_id is null', () => {
    const view = makeRunViewResponse();
    // fixture has article_id: null on the instance
    const [inst] = instancesFromRunView(view);
    expect(inst.article_id).toBe('art-1');
  });

  it('uses instance article_id when it is not null', () => {
    const view = makeRunViewResponse();
    view.instances[0] = {...view.instances[0], article_id: 'art-override'};
    const [inst] = instancesFromRunView(view);
    expect(inst.article_id).toBe('art-override');
  });

  it('maps label through (string)', () => {
    const view = makeRunViewResponse();
    const [inst] = instancesFromRunView(view);
    expect(inst.label).toBe('Main Study');
  });

  it('uses empty string when label is not provided (null-like)', () => {
    // RunViewInstanceResponse.label is string (not nullable in interface), but test the default
    const view = makeRunViewResponse();
    // Force a falsy label to confirm the ?? '' guard
    (view.instances[0] as unknown as Record<string, unknown>).label = null;
    const [inst] = instancesFromRunView(view);
    expect(inst.label).toBe('');
  });

  it('passes status through as typed value', () => {
    const view = makeRunViewResponse();
    const [inst] = instancesFromRunView(view);
    expect(inst.status).toBe('pending');
  });

  it('maps all remaining scalar fields 1:1', () => {
    const view = makeRunViewResponse();
    const [inst] = instancesFromRunView(view);
    expect(inst.id).toBe('inst-1');
    expect(inst.entity_type_id).toBe('et-1');
    expect(inst.parent_instance_id).toBeNull();
    expect(inst.sort_order).toBe(0);
    expect(inst.project_id).toBe('proj-1');
    expect(inst.template_id).toBe('tmpl-1');
    expect(inst.created_by).toBe('user-1');
    expect(inst.created_at).toBe('2024-01-01T00:00:00Z');
    expect(inst.updated_at).toBe('2024-01-01T00:00:00Z');
  });

  it('returns empty array when instances is undefined', () => {
    const view = makeRunViewResponse();
    (view as unknown as Record<string, unknown>).instances = undefined;
    expect(instancesFromRunView(view)).toEqual([]);
  });

  it('returns empty array when instances is empty', () => {
    const view = makeRunViewResponse({instances: []});
    expect(instancesFromRunView(view)).toEqual([]);
  });
});
