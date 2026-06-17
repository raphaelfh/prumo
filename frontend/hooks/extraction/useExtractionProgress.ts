/**
 * Hook to compute extraction progress.
 *
 * Thin memoized wrapper over the canonical `computeRequiredFieldProgress`
 * (`frontend/lib/extraction/progress.ts`) — the single source of truth shared
 * with the article list, the extraction table and the dashboard, so the same
 * article never reports a different percentage in different views. The formula
 * (required `(instance × field)` pairs filled) lives in one place now; this
 * hook only adds memoization and a stable call-site signature.
 *
 * @hook
 */

import {
  type ProgressEntityProjection,
  type RequiredFieldProgress,
  computeRequiredFieldProgress,
} from '@/lib/extraction/progress';

export type UseExtractionProgressReturn = RequiredFieldProgress;

/** Minimal projection of a materialized instance the metric needs. */
export interface ProgressInstanceProjection {
  id: string;
  entity_type_id: string;
}

export function useExtractionProgress(
  values: Record<string, any>,
  entityTypes: ProgressEntityProjection[],
  instances?: ProgressInstanceProjection[],
): UseExtractionProgressReturn {
  // When the materialized instances are known, pass the TRUE instance set so the
  // denominator reflects reality: an optional cardinality='many' entity (e.g.
  // "Prediction Models" with zero models added) and its child sections add no
  // required-field slots, so a fully-filled form is not stranded below 100%.
  // Without instances (e.g. mid-load) we fall back to the value-key heuristic.
  let instanceIdsByEntityType: Map<string, Set<string>> | undefined;
  if (instances && instances.length > 0) {
    instanceIdsByEntityType = new Map<string, Set<string>>();
    for (const inst of instances) {
      let set = instanceIdsByEntityType.get(inst.entity_type_id);
      if (!set) {
        set = new Set();
        instanceIdsByEntityType.set(inst.entity_type_id, set);
      }
      set.add(inst.id);
    }
  }
  return computeRequiredFieldProgress(values, entityTypes, instanceIdsByEntityType);
}
