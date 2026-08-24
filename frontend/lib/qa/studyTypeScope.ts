/**
 * Display hint from PROBAST+AI's Step-2 classification
 * (``assessment_scope.study_type``): which part of the form applies to the
 * study. NEVER gates input — the instrument leaves the unused part blank,
 * and so do we; the hint only labels the sections a reviewer can skip.
 *
 * The dev_/eval_ prefixes are the seeded section-name convention shared with
 * the derivation spec (docs/reference/templates/probast-ai-instrument.md).
 */
/**
 * Read the classified study type off the QA form state. The other half of
 * the same seeded convention as the prefixes below: the scope section is
 * named ``assessment_scope`` and its classifier ``study_type``.
 */
export function resolveStudyType(
  domains: Array<{
    entityType: { id: string; name: string };
    fields: Array<{ id: string; name: string }>;
  }>,
  instancesByEntityType: Record<string, string> | undefined,
  values: Record<string, unknown>,
  keyOf: (instanceId: string, fieldId: string) => string,
  unwrap: (raw: unknown) => unknown,
): unknown {
  const scope = domains.find((d) => d.entityType.name === "assessment_scope");
  const field = scope?.fields.find((f) => f.name === "study_type");
  const scopeInstanceId = scope && instancesByEntityType?.[scope.entityType.id];
  if (!scope || !field || !scopeInstanceId) return null;
  return unwrap(values[keyOf(scopeInstanceId, field.id)]);
}

export function isDomainOutOfScope(
  sectionName: string,
  studyType: unknown,
): boolean {
  if (studyType === "development_only") return sectionName.startsWith("eval_");
  if (studyType === "evaluation_only") return sectionName.startsWith("dev_");
  return false;
}
