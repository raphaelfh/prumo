import { extractValueFromDb } from '@/lib/validations/selectOther';
import {
  unwrapValueEnvelope,
  valueAbsentReason,
} from '@/lib/extraction/valueSemantics';
import type {
  PublishedStateResponse,
  RunViewCurrentValue,
} from '@/hooks/runs/types';

/**
 * The generic envelope → form-value peel, applied to every NON-marker row by
 * `envelopeRowToFieldValue` (its only caller): peel the outer envelope, sniff
 * the double-wrapped unit ({value:{value,unit}} — the only unit shape writers
 * produce), normalize via extractValueFromDb. Module-private: callers hydrate
 * through `envelopeRowToFieldValue` (or the map builders) so a marker envelope
 * is preserved instead of collapsed — routing a row straight through here would
 * flatten `{value:null, absent_reason}` to null.
 */
function envelopeToFieldValue(raw: unknown): unknown {
  const unwrapped = unwrapValueEnvelope(raw) ?? null;
  const unit =
    typeof unwrapped === 'object' && unwrapped !== null && 'unit' in unwrapped
      ? ((unwrapped as { unit: string | null }).unit ?? null)
      : null;
  return extractValueFromDb({ value: unwrapped, unit });
}

/** The shared per-row conversion: marker envelopes (`{value: null,
 *  absent_reason}`) verbatim — FieldInput derives the disposition label from
 *  the raw envelope, and the generic peel would collapse the marker to null —
 *  everything else through `envelopeToFieldValue`. */
function envelopeRowToFieldValue(raw: unknown): unknown {
  return valueAbsentReason(raw) !== null ? raw : envelopeToFieldValue(raw);
}

/**
 * Resolve `runDetail.published_states` into the `${instanceId}_${fieldId}`
 * values map both session forms consume (spec 2026-07-02 D3). Published-only,
 * no reviewer-state fallback: a coord without a published row stays absent.
 */
export function publishedStatesToValuesMap(
  rows: readonly PublishedStateResponse[] | undefined,
): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  for (const row of rows ?? []) {
    map[`${row.instance_id}_${row.field_id}`] = envelopeRowToFieldValue(row.value);
  }
  return map;
}

/**
 * Resolve `runDetail.current_values` (the caller-scoped decision/proposal
 * resolution, D8) into the `${instanceId}_${fieldId}` values map — the QA
 * screen hydrates AND baselines its autosave from this one map so a hydrated
 * coord is never re-POSTed on mount. Same envelope contract as
 * `publishedStatesToValuesMap`: marker envelopes preserved verbatim, `reject`
 * rows skipped (the audit row stays; the form coord clears).
 */
export function currentValuesToValuesMap(
  rows: readonly RunViewCurrentValue[] | undefined,
): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  for (const row of rows ?? []) {
    if (row.decision === 'reject') continue;
    map[`${row.instance_id}_${row.field_id}`] = envelopeRowToFieldValue(row.value);
  }
  return map;
}
