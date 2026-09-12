/**
 * entrySlotsShowing — the entry selections that put one instance on screen.
 *
 * The fixture is CHARMS one level deeper than it ships: models own predictors,
 * and each predictor owns a singleton detail section.
 */
import {describe, expect, it} from 'vitest';

import {entrySlotKey, entrySlotsShowing} from '@/lib/extraction/entrySlots';
import type {ExtractionEntityTypeWithFields, ExtractionInstance} from '@/types/extraction';

function section(id: string, cardinality: 'one' | 'many', parent: string | null): ExtractionEntityTypeWithFields {
  return {id, cardinality, parent_entity_type_id: parent} as unknown as ExtractionEntityTypeWithFields;
}

function inst(id: string, entityTypeId: string, parent: string | null): ExtractionInstance {
  return {id, entity_type_id: entityTypeId, parent_instance_id: parent} as unknown as ExtractionInstance;
}

const TYPES = [
  section('et-models', 'many', null),
  section('et-predictors', 'many', 'et-models'),
  // A singleton under a predictor: on the path, with no entries to select.
  section('et-detail', 'one', 'et-predictors'),
];

const INSTANCES = [
  inst('m-a', 'et-models', null),
  inst('m-b', 'et-models', null),
  inst('p-b1', 'et-predictors', 'm-b'),
  inst('d-b1', 'et-detail', 'p-b1'),
];

describe('entrySlotsShowing', () => {
  it('selects every entry on the path, each in the slot its group renders in', () => {
    expect(entrySlotsShowing('a-1', 'd-b1', INSTANCES, TYPES)).toEqual([
      [entrySlotKey('a-1', 'et-predictors', 'm-b'), 'p-b1'],
      [entrySlotKey('a-1', 'et-models', null), 'm-b'],
    ]);
  });

  it('selects the instance itself when it is an entry', () => {
    // A suggestion on a group's own field: those fields bind to the active entry.
    expect(entrySlotsShowing('a-1', 'm-b', INSTANCES, TYPES)).toEqual([
      [entrySlotKey('a-1', 'et-models', null), 'm-b'],
    ]);
  });

  it('stops on a parent cycle', () => {
    const loop = [inst('p-x', 'et-predictors', 'p-y'), inst('p-y', 'et-predictors', 'p-x')];

    expect(entrySlotsShowing('a-1', 'p-x', loop, TYPES)).toHaveLength(2);
  });
});
