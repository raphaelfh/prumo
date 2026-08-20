/**
 * useActiveTemplateStructure — B-3b: the ACTIVE snapshot's entity-level
 * `is_required` reaches consumers (progress.ts phantom-slot logic).
 * B-3a shipped this hook with a deliberately inert projection that
 * stripped the flag; this file pins its removal.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {renderHook, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const getActiveTemplateStructure = vi.fn();
vi.mock('@/services/templateStructureService', () => ({
  getActiveTemplateStructure: (...a: unknown[]) => getActiveTemplateStructure(...a),
}));

import {useActiveTemplateStructure} from '@/hooks/extraction/useActiveTemplateStructure';
import {computeRowProgress} from '@/lib/extraction/progress';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {queries: {retry: false}},
  });
  return ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const FIELD = {
  id: 'f-1',
  entity_type_id: 'et-models',
  name: 'model_name',
  label: 'Model name',
  field_type: 'text',
  is_required: true,
  sort_order: 1,
};

function tree() {
  return {
    version_id: 'v-1',
    version: 3,
    entity_types: [
      {
        id: 'et-study',
        name: 'study',
        label: 'Study',
        description: null,
        role: 'study_section',
        cardinality: 'one',
        parent_entity_type_id: null,
        sort_order: 0,
        is_required: false,
        fields: [
          {
            id: 'f-study',
            entity_type_id: 'et-study',
            name: 'title',
            label: 'Title',
            field_type: 'text',
            is_required: true,
            sort_order: 1,
          },
        ],
      },
      {
        id: 'et-models',
        name: 'models',
        label: 'Models',
        description: null,
        role: 'model_container',
        cardinality: 'many',
        parent_entity_type_id: null,
        sort_order: 1,
        is_required: true,
        fields: [FIELD],
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useActiveTemplateStructure (B-3b)', () => {
  it('passes entity-level is_required through to consumers', async () => {
    getActiveTemplateStructure.mockResolvedValue(tree());
    const {result} = renderHook(
      () => useActiveTemplateStructure('p1', 't1'),
      {wrapper: createWrapper()},
    );

    await waitFor(() => expect(result.current.entityTypes).toHaveLength(2));
    const byId = new Map(result.current.entityTypes.map((et) => [et.id, et]));
    expect(byId.get('et-study')?.is_required).toBe(false);
    expect(byId.get('et-models')?.is_required).toBe(true);
    // The B-3a projection fields all survive.
    expect(byId.get('et-models')).toMatchObject({
      name: 'models',
      role: 'model_container',
      cardinality: 'many',
      sort_order: 1,
    });
  });

  it('activates the phantom-slot: a required many-section with zero instances blocks 100%', async () => {
    getActiveTemplateStructure.mockResolvedValue(tree());
    const {result} = renderHook(
      () => useActiveTemplateStructure('p1', 't1'),
      {wrapper: createWrapper()},
    );
    await waitFor(() => expect(result.current.entityTypes).toHaveLength(2));

    // The study section is FULLY filled; only the REQUIRED models
    // section (zero instances) can keep this below 100 — exactly the
    // phantom slot the stripped projection used to disable (pre-B-3b
    // this read 100).
    const pct = computeRowProgress(
      [{id: 'i-study', entity_type_id: 'et-study'}],
      [{instance_id: 'i-study', field_id: 'f-study', value: 'x'}],
      result.current.entityTypes,
    );
    expect(pct).toBeLessThan(100);
    expect(pct).toBeGreaterThan(0);
  });
});
