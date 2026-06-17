import type { ExtractionField } from '@/types/extraction';

/**
 * Minimal projection of an entity type needed for progress computation.
 *
 * `is_required` is the template's own signal (it varies per template / per
 * user): a `cardinality='many'` entity with zero instances only blocks
 * completion when the template marks it required. Defaults to optional when
 * omitted, so a caller that doesn't thread it never over-counts.
 */
export interface ProgressEntityProjection {
  id: string;
  fields: ExtractionField[];
  is_required?: boolean;
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
 * When the authoritative set IS supplied, an entity type with **no instances**
 * contributes to the denominator only if the template marks it `is_required`:
 * an optional `cardinality='many'` entity (e.g. "Prediction Models" with
 * `is_required=false` and zero models added) — and its child sections — reach
 * 100% instead of stranding the form below the finalize gate (the "40%, can't
 * submit" bug); a required entity keeps a phantom slot so the form stays below
 * 100% until at least one instance is added. This is template-driven, so the
 * behaviour adapts to each user's template, not just CHARMS. The value-key
 * fallback keeps the historical phantom-1 so a not-yet-typed singleton is still
 * represented when no explicit set is available.
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
  //
  // The set is "authoritative" only when the caller passed it: then an entity
  // type absent from it genuinely has zero instances and contributes no
  // required-field slots. When derived from value keys we cannot tell "no
  // instance" from "instance with no values typed yet", so we keep the
  // phantom-1 fallback for that path.
  const authoritative = instanceIdsByEntityType !== undefined;
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
    const observed = observedInstances.get(et.id)?.size;
    let instanceCount: number;
    if (observed !== undefined) {
      instanceCount = observed;
    } else if (authoritative) {
      // No instances: honor the template. A required entity keeps a phantom-1
      // (form stays below 100% until one is added); an optional entity (e.g.
      // CHARMS prediction models, is_required=false) contributes nothing.
      instanceCount = et.is_required ? 1 : 0;
    } else {
      // Value-key fallback: represent a not-yet-typed singleton.
      instanceCount = 1;
    }
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

export interface ProgressInstanceRow {
  id: string;
  entity_type_id: string;
  /** Optional — some list views don't fetch instance status. */
  status?: string;
}

export interface ProgressValueRow {
  instance_id: string;
  field_id: string;
  value: unknown;
}

/**
 * Article/row-level completion % for the list views and dashboard. The single
 * helper both extraction and QA article tables use, so the same article shows
 * the same percentage everywhere. Wraps `computeRequiredFieldProgress` with the
 * list-specific shortcuts:
 *
 * - no instances → 0%;
 * - every instance `status === 'completed'` → 100% (terminal; skipped when the
 *   rows carry no status — the field metric still reaches 100% when complete);
 * - templates with no required fields (e.g. some QA tools) fall back to
 *   instance-based progress so they don't flatline at 0%.
 *
 * It builds the `${instanceId}_${fieldId}` value map (unwrapping `{value}`
 * envelopes, treating empty as unfilled) and the true instance set per entity
 * type, so empty `cardinality='many'` instances still count in the denominator.
 */
export function computeRowProgress(
  instances: ProgressInstanceRow[],
  values: ProgressValueRow[],
  entityTypes: ProgressEntityProjection[],
): number {
  if (instances.length === 0) return 0;
  if (instances.every((i) => i.status === 'completed')) return 100;

  const hasRequired = entityTypes.some((et) => et.fields.some((f) => f.is_required));
  if (!hasRequired) {
    const filled = instances.filter((inst) =>
      values.some((v) => v.instance_id === inst.id),
    ).length;
    return Math.round((filled / instances.length) * 100);
  }

  const valueMap: Record<string, unknown> = {};
  for (const v of values) {
    const raw = v.value;
    const unwrapped =
      raw && typeof raw === 'object' && 'value' in (raw as Record<string, unknown>)
        ? (raw as { value: unknown }).value
        : raw;
    valueMap[`${v.instance_id}_${v.field_id}`] = unwrapped;
  }
  const instanceIdsByEntityType = new Map<string, Set<string>>();
  for (const inst of instances) {
    let set = instanceIdsByEntityType.get(inst.entity_type_id);
    if (!set) {
      set = new Set();
      instanceIdsByEntityType.set(inst.entity_type_id, set);
    }
    set.add(inst.id);
  }
  return computeRequiredFieldProgress(valueMap, entityTypes, instanceIdsByEntityType)
    .completionPercentage;
}
