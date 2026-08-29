/**
 * "Is this field a domain judgment?" — data-driven, not a name allowlist.
 *
 * The QA form used to key off four hardcoded field names (`risk_of_bias`,
 * `applicability_concerns`, `overall_*`). PROBAST+AI's development part judges
 * *Quality*, not risk of bias, so a name allowlist silently demotes its four
 * domain judgments to ordinary signaling rows.
 *
 * The discriminant is the answer set, and the vocabulary is a hand-mirror of
 * the backend's `_SEVERITY_RANK`
 * (backend/app/services/exports/extraction/appraisal_summary.py) — the same
 * rule `extraction_export_service._is_verdict` applies — so the screen and the
 * exported workbook agree by construction rather than by convention.
 */

/** Casefolded risk-label vocabulary; mirrors the backend `_RISK_LABELS`. */
const JUDGMENT_LABELS: ReadonlySet<string> = new Set([
  "critical",
  "serious",
  "high",
  "some concerns",
  "moderate",
  "unclear",
  "low",
]);

interface JudgmentCandidate {
  field_type: string;
  allowed_values?: unknown;
}

function optionLabels(allowedValues: unknown): string[] {
  const raw = Array.isArray(allowedValues)
    ? allowedValues
    : allowedValues && typeof allowedValues === "object" && "options" in allowedValues
      ? (allowedValues as { options?: unknown }).options
      : undefined;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) =>
      typeof item === "string"
        ? item
        : item && typeof item === "object" && "value" in item
          ? String((item as { value?: unknown }).value ?? "")
          : "",
    )
    .map((label) => label.trim().toLowerCase())
    .filter((label) => label.length > 0);
}

export function isJudgmentField(field: JudgmentCandidate): boolean {
  if (field.field_type !== "select") return false;
  const labels = optionLabels(field.allowed_values);
  return labels.length > 0 && labels.every((label) => JUDGMENT_LABELS.has(label));
}

/**
 * The instrument's signaling answer vocabularies (PROBAST Y/PY/PN/N;
 * PROBAST+AI 2.1.0 adds NI; QUADAS-2 adds a substantive Unclear) — lowercase,
 * mirroring backend `_SIGNALING_MAP` the same way `JUDGMENT_LABELS` mirrors
 * `_RISK_LABELS`.
 *
 * `isSignalingSelect` requires EVERY option to be in this set, so a missing
 * answer does not degrade one question — it silently reclassifies the whole
 * vocabulary as "not signaling", which drops the section header's question
 * count to zero. Keep it in step with the backend map.
 */
const SIGNALING_LABELS: ReadonlySet<string> = new Set(["y", "py", "pn", "n", "ni", "unclear"]);

/**
 * A signaling QUESTION: a select whose every option comes from the signaling
 * vocabulary. `isJudgmentField`'s sibling classifier — same option-shape
 * tolerance (bare arrays and the `{options: [...]}` envelope), different
 * vocabulary — so a Low/High/Unclear judgment or a classification select
 * like `study_type` never counts as one.
 */
export function isSignalingSelect(field: JudgmentCandidate): boolean {
  if (field.field_type !== "select") return false;
  const labels = optionLabels(field.allowed_values);
  return labels.length > 0 && labels.every((label) => SIGNALING_LABELS.has(label));
}
