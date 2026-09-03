/**
 * Entry identity helpers for the run form (identity spec §5.1.1).
 *
 * Every repeating section is an entry group: one entry is identified by the
 * value of its key field (`is_entity_key`), materialized on the instance as
 * `metadata.entity_key`. `normalizeEntryKey` mirrors the backend's
 * `entity_key.normalize_key` (trim, collapse whitespace, casefold) so a
 * human-created entry carries the same identity an AI-created one does — an
 * AI re-run that finds the same key then reuses the row instead of adding a
 * second one beside it. The backend is authoritative for matching; this copy
 * stamps creation and powers the duplicate check in the dialogs.
 */

export function normalizeEntryKey(value: string): string {
  return value.trim().split(/\s+/).join(' ').toLowerCase();
}

/** The materialized identity on an instance, or null for a row that predates it. */
export function entryKeyOf(instance: {metadata?: unknown}): string | null {
  const metadata = instance.metadata;
  if (!metadata || typeof metadata !== 'object') return null;
  const raw = (metadata as Record<string, unknown>).entity_key;
  return typeof raw === 'string' ? raw : null;
}

/** The field declaring a section's identity, if the section declares one. */
export function keyFieldOf<F extends {is_entity_key?: boolean}>(fields: readonly F[]): F | null {
  return fields.find((field) => field.is_entity_key) ?? null;
}

/**
 * What the rename dialog shows as the entry's identity. The stored key is
 * normalized (lower-case), so when it is just the label folded, show the
 * label's own casing; a row with no stored key (pre-identity) shows its
 * label too, so re-keying it is one confirmation away.
 */
export function displayEntryKey(instance: {label: string; metadata?: unknown}): string {
  const stored = entryKeyOf(instance);
  if (stored === null || stored === normalizeEntryKey(instance.label)) return instance.label;
  return stored;
}

/** Case- and whitespace-insensitive duplicate check against the siblings. */
export function isDuplicateEntryKey(value: string, existing: readonly string[]): boolean {
  const wanted = normalizeEntryKey(value);
  return existing.some((other) => normalizeEntryKey(other) === wanted);
}
