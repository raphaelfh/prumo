/**
 * The `role` enum values.
 *
 * The partition half of this module (`partitionEntityTypes`,
 * `useEntityTypePartition`, `isModelContainer`, `isModelSection`) went with
 * the run form's model shape in trees B3 — the form derives structure from
 * `parent_entity_type_id` + `cardinality` now, so there is nothing left to
 * partition by role. The constant survives for `templateTree.ts`, the last
 * reader, and B5 deletes the file with it.
 */
import {describe, expect, it} from 'vitest';

import {ENTITY_ROLE} from '@/lib/extraction/entityTypeRoles';

describe('ENTITY_ROLE', () => {
  it('names every role the database enum carries', () => {
    // Pinned so a value renamed on one side cannot drift silently: the
    // strings are the Postgres `extraction_entity_role` labels.
    expect(ENTITY_ROLE).toEqual({
      STUDY_SECTION: 'study_section',
      MODEL_CONTAINER: 'model_container',
      MODEL_SECTION: 'model_section',
    });
  });
});
