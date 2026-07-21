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
  countActionableSuggestions,
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

describe('isAbstention — pure marker predicate (Phase 3, narrowed)', () => {
  const NO_INFO = { value: null, absent_reason: 'no_information' };

  it('only a resolved marker envelope is an abstention', () => {
    expect(isAbstention(NO_INFO)).toBe(true);
    expect(isAbstention({ value: null, absent_reason: 'not_applicable' })).toBe(true);
  });

  it('bare null/undefined/"" are UNRESOLVED, not abstentions (narrowed truth table)', () => {
    expect(isAbstention(null)).toBe(false);
    expect(isAbstention(undefined)).toBe(false);
    expect(isAbstention('')).toBe(false);
  });

  it('substantive scalars and a bare disposition string are NOT abstentions', () => {
    expect(isAbstention('x')).toBe(false);
    expect(isAbstention(0)).toBe(false);
    expect(isAbstention(false)).toBe(false);
    expect(isAbstention('No information')).toBe(false); // a scalar string is not a marker
    expect(isAbstention({ value: null, absent_reason: 'garbage' })).toBe(false);
  });
});

describe('countActionableSuggestions — the actionable-pending header metric', () => {
  const sug = (value: unknown, status: AISuggestion['status'] = 'pending') =>
    ({ value, status }) as AISuggestion;
  const NO_INFO = { value: null, absent_reason: 'no_information' };

  it('counts every UNRESOLVED (pending) proposal, abstention INCLUDED', () => {
    // ADR-0016 Phase 4 reversal: a pending abstention needs a human accept, so it
    // IS actionable and counts — the Phase-0 helper excluded it. Bare null/"" are
    // also unresolved-pending and count.
    expect(
      countActionableSuggestions([sug('x'), sug(NO_INFO), sug(''), sug('y'), sug(0)]),
    ).toBe(5);
  });

  it('excludes already-resolved (accepted/rejected) proposals', () => {
    // The map retains accepted/rejected with a flipped status; they are no longer
    // "awaiting a human decision", so the pending badge drops them.
    expect(
      countActionableSuggestions([
        sug('x', 'pending'),
        sug('y', 'accepted'),
        sug(NO_INFO, 'pending'),
        sug('z', 'rejected'),
      ]),
    ).toBe(2);
  });

  it('accepts the keyed record the screen holds', () => {
    expect(
      countActionableSuggestions({
        a: sug('x'),
        b: sug(NO_INFO, 'accepted'),
        c: sug('z'),
      }),
    ).toBe(2);
  });

  it('empty input is zero', () => {
    expect(countActionableSuggestions([])).toBe(0);
    expect(countActionableSuggestions({})).toBe(0);
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
