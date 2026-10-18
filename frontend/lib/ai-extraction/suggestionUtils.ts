/**
 * Utilities for formatting and handling AI suggestions
 *
 * Pure functions for formatting suggestion values for UI display.
 */

import type {AISuggestion} from '@/types/ai-extraction';
import {valueAbsentReason} from '@/lib/extraction/valueSemantics';
import {optionLabelMap} from '@/lib/extraction/options';
import {absentReasonLabel} from '@/lib/extraction/absentReasonLabel';
import {t} from '@/lib/copy';

/**
 * Field context needed to resolve a select/multiselect option CODE to its human
 * label. Optional everywhere — callers without a select field omit it and the
 * formatters fall back to the raw value (today's behaviour).
 */
export interface SuggestionFieldContext {
  fieldType?: string | null;
  allowedValues?: unknown;
}

/**
 * Resolve a select/multiselect coded value to human labels. Returns `undefined`
 * for non-select fields so the caller keeps its default formatting; for a
 * select/multiselect it always resolves (comma-joining arrays), falling back to
 * the raw code per item — matching backend `value_str_for_claim`.
 */
function resolveOptionLabels(value: unknown, field?: SuggestionFieldContext): string | undefined {
  if (!field || (field.fieldType !== 'select' && field.fieldType !== 'multiselect')) {
    return undefined;
  }
  const labelMap = optionLabelMap(field.allowedValues);
  const resolveOne = (v: unknown): string => labelMap.get(String(v)) ?? String(v);
  if (Array.isArray(value)) {
    return value.map(resolveOne).join(', ');
  }
  return resolveOne(value);
}

/**
 * Calculates formatted confidence percentage
 *
 * @param confidence - Confidence value (0-1)
 * @returns Rounded percentage (0-100)
 */
export function calculateConfidencePercent(confidence: number): number {
  return Math.round(confidence * 100);
}

/**
 * Formats suggestion value for display
 *
 * Converts values to readable string, truncating if needed.
 *
 * @param value - Value to format
 * @param maxLength - Max length (default: 40)
 * @returns Formatted string
 */
export function formatSuggestionValue(
  value: any,
  maxLength: number = 40,
  field?: SuggestionFieldContext,
): string {
    // Empty string is also a valid value; show "(empty)" only for null/undefined
  if (value === null || value === undefined) {
      return '(empty)';
  }

  if (value === '') {
      return '(empty)';
  }

  if (typeof value === 'boolean') {
      return value ? 'Yes' : 'No';
  }

  // Resolve a select/multiselect option CODE ("Y") to its human label ("Yes")
  // so the card matches what the user picked. No-op for non-select fields.
  const resolved = resolveOptionLabels(value, field);
  if (resolved !== undefined) {
    return resolved.length > maxLength ? `${resolved.substring(0, maxLength)}...` : resolved;
  }

  if (typeof value === 'number') {
    return String(value);
  }

  if (typeof value === 'object') {
    const str = JSON.stringify(value);
    return str.length > maxLength
      ? `${str.substring(0, maxLength)}...`
      : str;
  }

  const str = String(value);
  return str.length > maxLength
    ? `${str.substring(0, maxLength)}...`
    : str;
}

/**
 * Gets full formatted value for tooltip/expanded display
 *
 * @param value - Value to format
 * @returns Full string of value
 */
export function formatFullSuggestionValue(value: any, field?: SuggestionFieldContext): string {
  if (value === null || value === undefined) {
      return '(empty)';
  }

  // Resolve a select/multiselect option CODE to its human label (no-op for
  // non-select fields), matching the inline card.
  const resolved = resolveOptionLabels(value, field);
  if (resolved !== undefined) {
    return resolved;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number') {
    return String(value);
  }

  return JSON.stringify(value);
}

/**
 * The two proposal shapes that carry NO value to show, as one discriminated
 * outcome; `null` for an ordinary value. This is the ONE predicate the quiet
 * rendering, the copy choice, and the bulk-accept exclusion all key off — a
 * caller that recognized only one shape would reintroduce the loud
 * "(empty) · 0%" the quiet branch exists to prevent, and nothing would go red.
 *
 * · `'marker'` — a resolved `absent_reason` disposition (`{value:null,
 *   absent_reason}`): the affirmative "no information" / "not applicable" /
 *   "not evaluated" answer (ADR-0016 Phase 3, narrowed to the pure marker
 *   shape). Accepting it fills the coordinate.
 * · `'unmarked'` — a bare null with no marker: what the backend records when
 *   the field opts OUT of the marker (`allows_no_information = false`,
 *   migration 0062) or on a `status='ambiguous'` verdict. Stamping a marker on
 *   an opted-out field would fabricate an instrument answer (§IX), so the
 *   honest record is `{value: null}` plus its rationale — and the coordinate
 *   stays empty.
 *
 * An empty STRING is deliberately NEITHER: it is a genuine extracted value and
 * keeps the ordinary loud rendering, so a real value can never masquerade as an
 * abstention. That distinction survives only because
 * `valueSemantics.unwrapProposedValue` preserves the bare-null envelope instead of
 * collapsing it to ''; pass this a RAW `proposed_value` and it will not hold.
 */
export type ValuelessProposal = 'marker' | 'unmarked';

export function valuelessProposalKind(value: unknown): ValuelessProposal | null {
  if (valueAbsentReason(value) !== null) return 'marker';
  // A marker is an object, so the two branches are disjoint by construction.
  if (value === null || value === undefined) return 'unmarked';
  return null;
}

/**
 * What a review surface shows for a valueless AI proposal, or `null` for an
 * ordinary value. A `no_information` marker keeps the AI wording ("No
 * information found"); any other marker reads as its disposition label ("Not
 * applicable"), so an AI `not_applicable` answer never claims the article was
 * silent; a bare null reads "No value proposed".
 */
export function valuelessProposalLabel(value: unknown): string | null {
  const kind = valuelessProposalKind(value);
  if (kind === null) return null;
  if (kind === 'unmarked') return t('extraction', 'reviewNoValue');
  if (valueAbsentReason(value) === 'no_information') return t('extraction', 'reviewNoInformation');
  return absentReasonLabel(value);
}

/**
 * Count of UNRESOLVED AI proposals awaiting a human decision — the ONE shared
 * "actionable pending" header metric for BOTH the extraction and QA screens
 * (ADR-0016 Phase 4). An unresolved abstention (`no_information`) proposal IS
 * actionable — it needs a human accept — so it counts like any pending proposal;
 * what differs for an abstention is its rendering (quiet, no confidence badge)
 * and bulk-accept handling (excluded), NOT the count. Already-resolved proposals
 * (accepted/rejected, retained in the map with a flipped status) are excluded, so
 * the badge reflects remaining work rather than the total ever seen.
 */
export function countActionableSuggestions(
  suggestions: Record<string, AISuggestion> | AISuggestion[],
): number {
  const list = Array.isArray(suggestions) ? suggestions : Object.values(suggestions);
  return list.filter(isSuggestionPending).length;
}

/**
 * Checks if a suggestion was accepted
 *
 * @param suggestion - Suggestion to check
 * @returns true if suggestion has status 'accepted'
 */
export function isSuggestionAccepted(suggestion: AISuggestion): boolean {
  return suggestion.status === 'accepted';
}

/**
 * Checks if a suggestion is pending
 *
 * @param suggestion - Suggestion to check
 * @returns true if suggestion has status 'pending'
 */
export function isSuggestionPending(suggestion: AISuggestion): boolean {
  return suggestion.status === 'pending';
}
