/**
 * Snake_case key generation for template structure (fields + sections).
 *
 * Extracted from the late add-field dialog (B-5 Task 4) so the
 * ghost-row insert queue and AddSectionDialog share ONE implementation.
 *
 * @module lib/extraction/slug
 */

/** Generate a snake_case name from a human label. */
export function generateSnakeCaseName(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFD') // Normalize to decompose accents
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^a-z0-9]+/g, '_') // Replace non-alphanumeric with _
    .replace(/^_+|_+$/g, '') // Remove leading/trailing _
    .replace(/_+/g, '_'); // Collapse consecutive _
}

/** Room for a collision suffix (`_99`) inside the 50-char schema cap. */
const FIELD_KEY_BASE_MAX = 46;

/**
 * Field key for a ghost insert: slug + validity guard + collision suffix.
 *
 * The guard keeps the key inside `ExtractionFieldSchema`'s
 * `/^[a-z][a-z0-9_]*$/` + length rules so a chain never dead-ends on a
 * digit-leading or too-short label. The suffix walks `_2`, `_3`, … past
 * every name in `taken` — the caller must include IN-QUEUE names, not
 * just committed ones: there is NO DB unique constraint on
 * `(entity_type_id, name)`, so a stale set inserts duplicates silently.
 */
export function uniqueFieldKey(label: string, taken: ReadonlySet<string>): string {
  let base = generateSnakeCaseName(label);
  if (!/^[a-z]/.test(base)) base = base ? `field_${base}` : 'field';
  if (base.length < 2) base = `${base}_field`;
  base = base.slice(0, FIELD_KEY_BASE_MAX).replace(/_+$/, '');
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
