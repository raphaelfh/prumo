/**
 * Role-based partitioning of extraction entity types.
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
import type {
  ExtractionEntityRole,
  ExtractionEntityType,
} from '@/types/extraction';

export const ENTITY_ROLE: Record<Uppercase<ExtractionEntityRole>, ExtractionEntityRole> = {
  STUDY_SECTION: 'study_section',
  MODEL_CONTAINER: 'model_container',
  MODEL_SECTION: 'model_section',
};

/** True for root entity types rendered as top-level accordions. */
export function isStudySection<T extends { role: ExtractionEntityRole }>(et: T): boolean {
  return et.role === ENTITY_ROLE.STUDY_SECTION;
}

/**
 * True for the (at most one) entity type that drives the model selector.
 * Backed by a partial unique index on the database, so the array
 * ``filter(isModelContainer)`` is at most one element.
 */
export function isModelContainer<T extends { role: ExtractionEntityRole }>(et: T): boolean {
  return et.role === ENTITY_ROLE.MODEL_CONTAINER;
}

/** True for entity types rendered inside the active model. */
export function isModelSection<T extends { role: ExtractionEntityRole }>(et: T): boolean {
  return et.role === ENTITY_ROLE.MODEL_SECTION;
}

export interface EntityTypePartition<T extends { role: ExtractionEntityRole; id: string }> {
  /** Root sections shown above the model selector. */
  studyLevel: T[];
  /**
   * The model container entity type, if the template has one. Undefined
   * for templates with no per-model evaluation (e.g. PROBAST, QUADAS-2).
   */
  modelContainer: T | undefined;
  /** Children of the model container, rendered inside the active model. */
  modelChildren: T[];
}

/**
 * Split entity types into the three regions the form renders.
 *
 * The output order within each list is preserved from the input, so
 * passing rows already sorted by ``sort_order`` is enough to get a
 * stable rendering order.
 */
export function partitionEntityTypes<
  T extends { role: ExtractionEntityRole; id: string },
>(entityTypes: readonly T[]): EntityTypePartition<T> {
  const studyLevel: T[] = [];
  let modelContainer: T | undefined;
  const modelChildren: T[] = [];

  for (const et of entityTypes) {
    if (isModelContainer(et)) {
      modelContainer = et;
    } else if (isModelSection(et)) {
      modelChildren.push(et);
    } else {
      studyLevel.push(et);
    }
  }

  return { studyLevel, modelContainer, modelChildren };
}

/**
 * Re-export the concrete role value type so consumers don't have to
 * reach into ``@/types/extraction`` for it.
 */
export type { ExtractionEntityRole } from '@/types/extraction';

/**
 * Backed by ``ExtractionEntityType``. Exists so the helper is reusable
 * for views that work on lighter projections (e.g. comparison columns)
 * via the generic ``T extends {role, id}`` constraint above, while
 * ``ExtractionEntityType`` remains the canonical type.
 */
export type _CompatExtractionEntityType = ExtractionEntityType;
