/**
 * useEntryGroup — per-group state for one rendered `EntrySection`.
 *
 * One instance per (group, parent entry), so the SAME nested group renders
 * once under each parent entry and each keeps its own selection. That is the
 * property the old `useModelManagement` never had to have: there was exactly
 * one model container per template, so one hook instance sufficed.
 *
 * Entries are DERIVED from the run view the page already loaded — this hook
 * issues no query of its own. That is what retires `useModelManagement`'s
 * load-generation guard: with no load there is no stale resolution to drop.
 * The one hazard that survives is the restored selection, because the
 * instance list still changes shape on every refetch — covered below.
 */
import {act, renderHook} from '@testing-library/react';
import {beforeEach, describe, expect, it} from 'vitest';

import {useEntryGroup} from '@/hooks/extraction/useEntryGroup';
import type {ExtractionEntityTypeWithFields, ExtractionInstance} from '@/types/extraction';

const GROUP = {
  id: 'et-models',
  name: 'prediction_models',
  label: 'Prediction Models',
  cardinality: 'many',
  parent_entity_type_id: null,
  entry_label: 'model',
  sort_order: 0,
  fields: [],
} as unknown as ExtractionEntityTypeWithFields;

const NESTED = {
  ...GROUP,
  id: 'et-predictors',
  name: 'final_predictors',
  label: 'Final Predictors',
  parent_entity_type_id: 'et-models',
  entry_label: 'predictor',
} as unknown as ExtractionEntityTypeWithFields;

function inst(
  id: string,
  entityTypeId: string,
  parentInstanceId: string | null,
  sortOrder = 0,
): ExtractionInstance {
  return {
    id,
    entity_type_id: entityTypeId,
    parent_instance_id: parentInstanceId,
    label: id,
    sort_order: sortOrder,
  } as unknown as ExtractionInstance;
}

const MODEL_A = inst('m-a', 'et-models', null, 0);
const MODEL_B = inst('m-b', 'et-models', null, 1);
// Same entity type as each other, DIFFERENT parents — the pair that makes the
// parent half of the filter load-bearing.
const PRED_A1 = inst('p-a1', 'et-predictors', 'm-a', 0);
const PRED_B1 = inst('p-b1', 'et-predictors', 'm-b', 0);
// A sibling group's instance, to prove the entity-type half.
const OTHER = inst('o-1', 'et-other', null, 0);

const ALL = [MODEL_A, MODEL_B, PRED_A1, PRED_B1, OTHER];

/**
 * The active-entry map lives ABOVE the hook (the nav rail needs it), so the
 * harness holds it the way the provider does.
 */
function setup(group: ExtractionEntityTypeWithFields, parentInstanceId: string | null) {
  const active: Record<string, string> = {};
  const hook = renderHook(
    (props: {active: Record<string, string>}) =>
      useEntryGroup({
        articleId: 'a-1',
        group,
        parentInstanceId,
        instances: ALL,
        values: {},
        entityTypes: [GROUP, NESTED],
        activeEntries: props.active,
        setActiveEntry: (slot, id) => {
          active[slot] = id;
          hook.rerender({active: {...active}});
        },
      }),
    {initialProps: {active}},
  );
  return hook;
}

beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    /* jsdom without storage — the hook must survive this too */
  }
});

describe('useEntryGroup', () => {
  it('filters by entity type AND parent', () => {
    const {result} = setup(NESTED, 'm-a');

    const ids = result.current.entries.map((e) => e.id);
    // The included one, and BOTH exclusions named: an entity-type-only
    // filter would keep p-b1, a parent-only filter would keep o-1.
    expect(ids).toEqual(['p-a1']);
    expect(ids).not.toContain('p-b1');
    expect(ids).not.toContain('o-1');
  });

  it('keeps independent selections for the same group under different parents', () => {
    const underA = setup(NESTED, 'm-a');
    const underB = setup(NESTED, 'm-b');

    expect(underA.result.current.activeEntryId).toBe('p-a1');
    expect(underB.result.current.activeEntryId).toBe('p-b1');
  });

  it('orders entries by sort_order', () => {
    const {result} = setup(GROUP, null);
    expect(result.current.entries.map((e) => e.id)).toEqual(['m-a', 'm-b']);
  });

  it('restores the stored entry only when it still exists', () => {
    window.localStorage.setItem('active-entry-a-1-et-models-root', 'm-b');
    const restored = setup(GROUP, null);
    expect(restored.result.current.activeEntryId).toBe('m-b');

    window.localStorage.setItem('active-entry-a-1-et-models-root', 'm-gone');
    const stale = setup(GROUP, null);
    // Falls back to the first entry rather than selecting nothing — the
    // instance list changes shape on every run-view refetch, so a stored id
    // outliving its row is the normal case, not an error.
    expect(stale.result.current.activeEntryId).toBe('m-a');
  });

  it('honours an explicit selection even when it is not yet in the list', () => {
    const {result} = setup(GROUP, null);
    act(() => result.current.setActiveEntryId('m-just-created'));
    // The existence check guards the RESTORED id only. Applying it to an
    // explicit set would snap a just-created entry back to the first one
    // until the refetch lands.
    expect(result.current.activeEntryId).toBe('m-just-created');
  });

  it('exposes the group noun, defaulting to "entry"', () => {
    expect(setup(GROUP, null).result.current.noun).toBe('model');
    expect(setup(NESTED, 'm-a').result.current.noun).toBe('predictor');

    const nounless = {...GROUP, entry_label: null} as unknown as ExtractionEntityTypeWithFields;
    // Never "model": the default is the generic noun, not the old vocabulary.
    expect(setup(nounless, null).result.current.noun).toBe('entry');
  });

  it('survives a localStorage that throws', () => {
    const original = window.localStorage.getItem;
    // A private window / blocked site data throws on access; the hook runs
    // once per rendered group, so an unguarded read throws N times per tree.
    Object.defineProperty(window.localStorage, 'getItem', {
      configurable: true,
      value: () => {
        throw new Error('blocked');
      },
    });
    try {
      expect(() => setup(GROUP, null)).not.toThrow();
    } finally {
      Object.defineProperty(window.localStorage, 'getItem', {
        configurable: true,
        value: original,
      });
    }
  });
});
