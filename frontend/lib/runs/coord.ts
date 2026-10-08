/**
 * A run coordinate — one (instance, field) cell of a run's form — and its ONE
 * string encoding. Every map keyed by coordinate (form values, AI suggestions,
 * reviewer decisions, consensus rows, DOM ids) builds its key here, so the
 * encoding never leaks into a caller. Instance and field ids are UUIDs (no
 * underscore), so the first `_` splits a key unambiguously.
 */

export interface Coord {
  instanceId: string;
  fieldId: string;
}

export function coordKey(instanceId: string, fieldId: string): string {
  return `${instanceId}_${fieldId}`;
}

export function parseCoordKey(key: string): Coord {
  const sep = key.indexOf('_');
  if (sep < 0) return { instanceId: key, fieldId: '' };
  return { instanceId: key.slice(0, sep), fieldId: key.slice(sep + 1) };
}
