import { extractValueFromDb } from '@/lib/validations/selectOther';
import {
  unwrapValueEnvelope,
  valueAbsentReason,
} from '@/lib/extraction/valueSemantics';
import type { PublishedStateResponse } from '@/hooks/runs/types';

/**
 * Resolve `runDetail.published_states` into the `${instanceId}_${fieldId}`
 * values map both session forms consume (spec 2026-07-02 D3). Published-only,
 * no reviewer-state fallback: a coord without a published row stays absent.
 *
 * Marker envelopes (`{value: null, absent_reason}`) are preserved verbatim —
 * FieldInput derives the disposition label from the raw envelope, and the
 * generic unwrap would collapse the marker to null.
 *
 * Unit handling mirrors the reviewer-state loop in useExtractedValues: every
 * writer publishes units double-wrapped ({value:{value,unit}}), so one peel
 * exposes the {value,unit} inner envelope for the unit sniff.
 */
export function publishedStatesToValuesMap(
  rows: readonly PublishedStateResponse[] | undefined,
): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  for (const row of rows ?? []) {
    const key = `${row.instance_id}_${row.field_id}`;
    const raw: unknown = row.value;
    if (valueAbsentReason(raw) !== null) {
      map[key] = raw;
      continue;
    }
    const unwrapped = unwrapValueEnvelope(raw) ?? null;
    const unit =
      typeof unwrapped === 'object' && unwrapped !== null && 'unit' in unwrapped
        ? ((unwrapped as { unit: string | null }).unit ?? null)
        : null;
    map[key] = extractValueFromDb({ value: unwrapped, unit });
  }
  return map;
}
