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
import {
  formatFullSuggestionValue,
  formatSuggestionValue,
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
