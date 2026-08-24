/**
 * Display hint from PROBAST+AI's Step-2 classification
 * (``assessment_scope.study_type``): which part of the form applies to the
 * study. NEVER gates input — the instrument leaves the unused part blank,
 * and so do we; the hint only labels the sections a reviewer can skip.
 *
 * The dev_/eval_ prefixes are the seeded section-name convention shared with
 * the derivation spec (docs/reference/templates/probast-ai-instrument.md).
 */
export function isDomainOutOfScope(
  sectionName: string,
  studyType: unknown,
): boolean {
  if (studyType === "development_only") return sectionName.startsWith("eval_");
  if (studyType === "evaluation_only") return sectionName.startsWith("dev_");
  return false;
}
