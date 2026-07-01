/**
 * suggestionUtils — select/multiselect option CODE → human LABEL resolution.
 *
 * The extraction output stores the option CODE ("Y"), so the AI-suggestion card
 * and history must resolve it to the human label ("Yes") to match what the user
 * picked — mirroring the backend `value_str_for_claim` / `option_label_map`
 * (backend/app/llm/claim_value.py). Resolution is a safe no-op when there is no
 * field context, no distinct label, or the value is free text (`allow_other`).
 */

import { describe, expect, it } from 'vitest';
import type { AISuggestion } from '@/types/ai-extraction';
import {
  countNonAbstentionSuggestions,
  formatFullSuggestionValue,
  formatSuggestionValue,
  isAbstention,
} from '@/lib/ai-extraction/suggestionUtils';

const YES_NO = [
  { value: 'Y', label: 'Yes' },
  { value: 'N', label: 'No' },
];

describe('formatSuggestionValue — select/multiselect label resolution', () => {
  it('resolves a select option code to its human label', () => {
    expect(
      formatSuggestionValue('Y', 40, { fieldType: 'select', allowedValues: YES_NO }),
    ).toBe('Yes');
  });

  it('joins a multiselect array of codes into resolved labels', () => {
    expect(
      formatSuggestionValue(['Y', 'N'], 40, { fieldType: 'multiselect', allowedValues: YES_NO }),
    ).toBe('Yes, No');
  });

  it('tolerates the {options: [...]} allowed_values shape', () => {
    expect(
      formatSuggestionValue('Y', 40, {
        fieldType: 'select',
        allowedValues: { options: YES_NO, allow_other: true },
      }),
    ).toBe('Yes');
  });

  it('falls back to the raw code when the code is absent from the option map', () => {
    expect(
      formatSuggestionValue('Z', 40, { fieldType: 'select', allowedValues: YES_NO }),
    ).toBe('Z');
  });

  it('passes through allow_other free text unchanged (no matching code)', () => {
    expect(
      formatSuggestionValue('Custom answer', 40, {
        fieldType: 'select',
        allowedValues: { options: YES_NO, allow_other: true },
      }),
    ).toBe('Custom answer');
  });

  it('renders plain-string options as themselves (no distinct label)', () => {
    expect(
      formatSuggestionValue('RCT', 40, {
        fieldType: 'select',
        allowedValues: ['RCT', 'Cohort'],
      }),
    ).toBe('RCT');
  });

  it('does not resolve for non-select field types', () => {
    expect(
      formatSuggestionValue('Y', 40, { fieldType: 'text', allowedValues: YES_NO }),
    ).toBe('Y');
  });

  it('does not resolve without field context (backward compatible)', () => {
    expect(formatSuggestionValue('Y')).toBe('Y');
  });

  it('still shows (empty) for null/empty even with field context', () => {
    expect(
      formatSuggestionValue(null, 40, { fieldType: 'select', allowedValues: YES_NO }),
    ).toBe('(empty)');
    expect(
      formatSuggestionValue('', 40, { fieldType: 'select', allowedValues: YES_NO }),
    ).toBe('(empty)');
  });

  it('comma-joins multiselect codes even when no option labels are available', () => {
    expect(
      formatSuggestionValue(['Y', 'N'], 40, { fieldType: 'multiselect', allowedValues: null }),
    ).toBe('Y, N');
  });
});

describe('isAbstention — transitional union predicate (Phase 0 behaviour-neutral)', () => {
  // The call sites pass the already-unwrapped scalar suggestion.value, so this
  // must collapse to the old isNoInfoValue truth table (no markers exist yet).
  it('legacy-empty scalars are abstentions', () => {
    expect(isAbstention(null)).toBe(true);
    expect(isAbstention(undefined)).toBe(true);
    expect(isAbstention('')).toBe(true);
  });

  it('substantive scalars are NOT abstentions (incl. 0 and false)', () => {
    expect(isAbstention('x')).toBe(false);
    expect(isAbstention(0)).toBe(false);
    expect(isAbstention(false)).toBe(false);
    expect(isAbstention('No information')).toBe(false); // legacy in-band select value
  });

  it('forward-looking: a resolved marker envelope is an abstention; a garbage code is not', () => {
    expect(isAbstention({ value: null, absent_reason: 'no_information' })).toBe(true);
    expect(isAbstention({ value: null, absent_reason: 'garbage' })).toBe(false);
  });
});

describe('countNonAbstentionSuggestions — the actionable-pending header metric', () => {
  const sug = (value: unknown) => ({ value }) as AISuggestion;

  it('excludes abstentions, counts substantive values (array form)', () => {
    expect(
      countNonAbstentionSuggestions([sug('x'), sug(null), sug(''), sug('y'), sug(0)]),
    ).toBe(3);
  });

  it('accepts the keyed record the screen holds', () => {
    expect(
      countNonAbstentionSuggestions({ a: sug('x'), b: sug(null), c: sug('') }),
    ).toBe(1);
  });

  it('empty input is zero', () => {
    expect(countNonAbstentionSuggestions([])).toBe(0);
    expect(countNonAbstentionSuggestions({})).toBe(0);
  });
});

describe('formatFullSuggestionValue — select/multiselect label resolution', () => {
  it('resolves a select code to its label (untruncated)', () => {
    expect(
      formatFullSuggestionValue('Y', { fieldType: 'select', allowedValues: YES_NO }),
    ).toBe('Yes');
  });

  it('joins a multiselect array into resolved labels', () => {
    expect(
      formatFullSuggestionValue(['Y', 'N'], { fieldType: 'multiselect', allowedValues: YES_NO }),
    ).toBe('Yes, No');
  });

  it('falls back to raw JSON / string without field context (backward compatible)', () => {
    expect(formatFullSuggestionValue('Y')).toBe('Y');
    expect(formatFullSuggestionValue(['Y', 'N'])).toBe('["Y","N"]');
  });
});
