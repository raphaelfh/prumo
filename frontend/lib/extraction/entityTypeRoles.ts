/**
 * The `role` enum values, as the frontend names them.
 *
 * Single source of truth for "which entity type plays which role in the
 * form". Before migration ``0016_entity_role_column`` this knowledge was
 * scattered across the codebase as ``name === 'prediction_models'``
 * checks; the role column promotes it to a structural discriminant on
 * the backend, and this module is the corresponding frontend boundary.
 *
 * Touch this file (or its constant) — not the consumers — when the
 * convention changes.
 */

import type {ExtractionEntityRole} from '@/types/extraction';

export const ENTITY_ROLE: Record<Uppercase<ExtractionEntityRole>, ExtractionEntityRole> = {
  STUDY_SECTION: 'study_section',
  MODEL_CONTAINER: 'model_container',
  MODEL_SECTION: 'model_section',
};


/**
 * Re-export the concrete role value type so consumers don't have to reach
 * into ``@/types/extraction`` for it.
 */
export type {ExtractionEntityRole} from '@/types/extraction';
