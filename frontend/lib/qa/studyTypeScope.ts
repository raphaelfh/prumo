/**
 * PROBAST+AI's Step-2 classification decides which part of the instrument
 * applies to the study. The rule is DECLARED DATA — `scope_rules` on the
 * template's `schema` JSONB, sibling of `derived_judgments` — so this module
 * evaluates it by set membership and knows nothing about section naming.
 *
 * Mirrors `scope_classifier_coordinate` / `out_of_scope_sections` in
 * `backend/app/services/derived_judgment_service.py`, which read the same
 * live `schema_` column, so the screen and the payload cannot disagree. The
 * `dev_`/`eval_` prefix convention this replaced agreed with the rules only
 * by coincidence on the seeded template, and disagreed outright on a clone
 * whose `schema` predates them: the badge claimed "out of scope" while the
 * backend, finding no rules, computed a real verdict for the same section.
 *
 * Everything here FAILS OPEN — no rules, unanswered, an absent-reason marker
 * (an article that does not say is not a classification) or an answer the
 * rules do not name all exclude nothing, which is the pre-2.1.0 behaviour.
 *
 * NEVER gates input: the instrument leaves the unused part blank, and a
 * mid-assessment reclassification must be reversible with zero cleanup.
 */
import { unwrapValueEnvelope } from "@/lib/extraction/valueSemantics";

function scopeRules(templateSchema: unknown): Record<string, unknown> {
  if (typeof templateSchema !== "object" || templateSchema === null) return {};
  const rules = (templateSchema as Record<string, unknown>).scope_rules;
  return typeof rules === "object" && rules !== null
    ? (rules as Record<string, unknown>)
    : {};
}

/** The `(section, field)` whose answer decides scope, or null. */
function scopeClassifierCoordinate(
  templateSchema: unknown,
): { section: string; field: string } | null {
  const classifier = scopeRules(templateSchema).classifier;
  if (typeof classifier !== "object" || classifier === null) return null;
  const { section, field } = classifier as { section?: unknown; field?: unknown };
  if (typeof section !== "string" || !section) return null;
  if (typeof field !== "string" || !field) return null;
  return { section, field };
}

/** Section names this run's own classification takes out of play. */
export function outOfScopeSections(
  templateSchema: unknown,
  studyType: unknown,
): Set<string> {
  if (typeof studyType !== "string") return new Set();
  const excludes = scopeRules(templateSchema).excludes;
  if (typeof excludes !== "object" || excludes === null) return new Set();
  const names = (excludes as Record<string, unknown>)[studyType.trim()];
  return Array.isArray(names) ? new Set(names.map(String)) : new Set();
}

/**
 * The classifier's answer as the RUN FORM holds it — `values` keyed by the
 * page's own `keyOf`, instances resolved per entity type.
 */
function resolveStudyType(
  templateSchema: unknown,
  domains: Array<{
    entityType: { id: string; name: string };
    fields: Array<{ id: string; name: string }>;
  }>,
  instancesByEntityType: Record<string, string> | undefined,
  values: Record<string, unknown>,
  keyOf: (instanceId: string, fieldId: string) => string,
): unknown {
  const coord = scopeClassifierCoordinate(templateSchema);
  if (!coord) return null;
  const section = domains.find((d) => d.entityType.name === coord.section);
  const field = section?.fields.find((f) => f.name === coord.field);
  const instanceId = section && instancesByEntityType?.[section.entityType.id];
  if (!section || !field || !instanceId) return null;
  return unwrapValueEnvelope(values[keyOf(instanceId, field.id)]);
}

/**
 * The classifier's answer as the WORKLIST holds it — flat instance and value
 * rows for one article, against the active template's entity types.
 */
function resolveStudyTypeFromRows(
  templateSchema: unknown,
  entityTypes: Array<{
    id: string;
    name: string;
    fields: Array<{ id: string; name: string }>;
  }>,
  instances: Array<{ id: string; entity_type_id: string }>,
  values: Array<{ instance_id: string; field_id: string; value: unknown }>,
): unknown {
  const coord = scopeClassifierCoordinate(templateSchema);
  if (!coord) return null;
  const entityType = entityTypes.find((et) => et.name === coord.section);
  const field = entityType?.fields.find((f) => f.name === coord.field);
  if (!entityType || !field) return null;
  // Scoped by instance: the same field id can only belong to this entity
  // type, but an article carries every section's rows in one flat list.
  const ownInstances = new Set(
    instances.filter((i) => i.entity_type_id === entityType.id).map((i) => i.id),
  );
  const row = values.find(
    (v) => v.field_id === field.id && ownInstances.has(v.instance_id),
  );
  return unwrapValueEnvelope(row?.value);
}

/** Sections out of play on the QA run form, from its own live form state. */
export function outOfScopeSectionsOnForm(
  templateSchema: unknown,
  domains: Array<{
    entityType: { id: string; name: string };
    fields: Array<{ id: string; name: string }>;
  }>,
  instancesByEntityType: Record<string, string> | undefined,
  values: Record<string, unknown>,
  keyOf: (instanceId: string, fieldId: string) => string,
): Set<string> {
  return outOfScopeSections(
    templateSchema,
    resolveStudyType(templateSchema, domains, instancesByEntityType, values, keyOf),
  );
}

/** Sections out of play for ONE worklist article, from its stored rows. */
export function outOfScopeSectionsOnRow(
  templateSchema: unknown,
  entityTypes: Array<{
    id: string;
    name: string;
    fields: Array<{ id: string; name: string }>;
  }>,
  instances: Array<{ id: string; entity_type_id: string }>,
  values: Array<{ instance_id: string; field_id: string; value: unknown }>,
): Set<string> {
  return outOfScopeSections(
    templateSchema,
    resolveStudyTypeFromRows(templateSchema, entityTypes, instances, values),
  );
}
