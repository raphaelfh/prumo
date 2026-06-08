import type { ExtractionField } from '@/types/extraction';

/**
 * Minimal projection of an entity type needed for progress computation.
 */
export interface ProgressEntityProjection {
  id: string;
  fields: ExtractionField[];
}

export interface RequiredFieldProgress {
  completedFields: number;
  totalFields: number;
  completionPercentage: number;
  isComplete: boolean;
}

/**
 * THE canonical extraction-progress metric — the single source of truth for
 * "how much of the form is done", shared by the form header, the HITL article
 * list, the extraction table and the dashboard so the same article never shows
 * a different percentage in different views.
 *
 * Metric: count of `(instance × required_field)` coordinates that hold a
 * non-empty value, over a denominator of `Σ required_field_count ×
 * instanceCount` per entity type. Only **required** fields count (matches the
 * finalize gate, i.e. the user-facing definition of "complete"); optional
 * fields are ignored in both numerator and denominator.
 *
 * `instanceIdsByEntityType` (optional) supplies the TRUE instance set per
 * entity type. Callers with `cardinality='many'` entities (e.g. several
 * prediction models) MUST pass it: otherwise the denominator is derived only
 * from filled value keys and an article with 3 empty model instances + 1
 * filled reads 100% (regression #55). When omitted, the instance set is
 * derived from the value keys — the header's historical behaviour, preserved
 * unchanged because the form holds every instance's keys already.
 *
 * `values` is keyed `${instanceId}_${fieldId}` → value (the shape the form and
 * both tables build).
 */
export function computeRequiredFieldProgress(
  values: Record<string, unknown>,
  entityTypes: ProgressEntityProjection[],
  instanceIdsByEntityType?: Map<string, Set<string>>,
): RequiredFieldProgress {
  const fieldToEntityType = new Map<string, string>();
  const requiredFieldIdsByEntityType = new Map<string, Set<string>>();
  for (const et of entityTypes) {
    const required = new Set<string>();
    for (const field of et.fields) {
      fieldToEntityType.set(field.id, et.id);
      if (field.is_required) required.add(field.id);
    }
    requiredFieldIdsByEntityType.set(et.id, required);
  }

  // Observed instances per entity type: prefer the explicit set (true count,
  // so empty cardinality='many' instances still count in the denominator);
  // else derive from filled value keys.
  let observedInstances: Map<string, Set<string>>;
  if (instanceIdsByEntityType) {
    observedInstances = instanceIdsByEntityType;
  } else {
    observedInstances = new Map<string, Set<string>>();
    for (const key of Object.keys(values)) {
      const sep = key.indexOf('_');
      if (sep < 0) continue;
      const instanceId = key.slice(0, sep);
      const fieldId = key.slice(sep + 1);
      const etId = fieldToEntityType.get(fieldId);
      if (!etId) continue;
      let set = observedInstances.get(etId);
      if (!set) {
        set = new Set();
        observedInstances.set(etId, set);
      }
      set.add(instanceId);
    }
  }

  let totalRequired = 0;
  for (const et of entityTypes) {
    const reqCount = requiredFieldIdsByEntityType.get(et.id)?.size ?? 0;
    if (reqCount === 0) continue;
    // An entity type with no observed instances contributes one "phantom"
    // instance so the entity is still represented in the denominator.
    const instanceCount = observedInstances.get(et.id)?.size ?? 1;
    totalRequired += reqCount * instanceCount;
  }

  let completedRequired = 0;
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined || value === '') continue;
    const sep = key.indexOf('_');
    if (sep < 0) continue;
    const fieldId = key.slice(sep + 1);
    const etId = fieldToEntityType.get(fieldId);
    if (!etId) continue;
    if (requiredFieldIdsByEntityType.get(etId)?.has(fieldId)) {
      completedRequired += 1;
    }
  }

  const percentage =
    totalRequired > 0 ? Math.round((completedRequired / totalRequired) * 100) : 0;

  return {
    completedFields: completedRequired,
    totalFields: totalRequired,
    completionPercentage: percentage,
    isComplete: totalRequired > 0 && completedRequired >= totalRequired,
  };
}
