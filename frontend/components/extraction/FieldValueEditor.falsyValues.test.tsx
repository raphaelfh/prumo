/**
 * Falsy-but-real stored values must still render.
 *
 * `0` is a legitimate answer ("0 events observed", "0 months follow-up"), but
 * the editor bound its inputs with `value={x || ''}`, so every falsy value
 * collapsed to an empty box. That reads as unanswered while the emptiness
 * oracle (`isValueEmpty`) correctly counts it as answered — so the field also
 * escapes the pending-required accent, and the user sees a blank input that
 * nothing flags.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/copy', () => ({ t: (_ns: string, key: string) => key }));

import { FieldValueEditor, type FieldValueEditorField } from './FieldValueEditor';

const base = (over: Partial<FieldValueEditorField>): FieldValueEditorField => ({
  id: 'f1',
  label: 'Events observed',
  field_type: 'text',
  ...over,
});

const renderValue = (field: Partial<FieldValueEditorField>, value: unknown) =>
  render(<FieldValueEditor field={base(field)} value={value} onChange={() => {}} />);

describe('FieldValueEditor renders falsy-but-real values', () => {
  it('number: renders a stored 0', () => {
    renderValue({ field_type: 'number' }, 0);
    expect(screen.getByRole('spinbutton')).toHaveValue(0);
  });

  it('number: renders a 0 carried in a {value, unit} envelope', () => {
    renderValue({ field_type: 'number', unit: 'months', allowed_units: ['months', 'years'] }, {
      value: 0,
      unit: 'months',
    });
    expect(screen.getByRole('spinbutton')).toHaveValue(0);
  });

  it('number: a genuinely empty value still renders blank', () => {
    renderValue({ field_type: 'number' }, null);
    expect(screen.getByRole('spinbutton')).toHaveValue(null);
  });

  it('number: a resolved absent_reason marker renders blank, not 0', () => {
    // The marker peels to null — it is "no value on purpose", not zero.
    renderValue({ field_type: 'number' }, { value: null, absent_reason: 'no_information' });
    expect(screen.getByRole('spinbutton')).toHaveValue(null);
  });

  it('number: renders a stored numeric string "0"', () => {
    renderValue({ field_type: 'number' }, '0');
    expect(screen.getByRole('spinbutton')).toHaveValue(0);
  });

  it('text: renders a stored 0 that arrived as a number', () => {
    // Reachable after a template field type-change leaves a numeric value
    // behind a text-typed field.
    renderValue({}, 0);
    expect(screen.getByRole('textbox')).toHaveValue('0');
  });

  it('text: an object value does not leak "[object Object]" into the input', () => {
    renderValue({}, { value: null, absent_reason: 'no_information' });
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('textarea: renders a stored 0', () => {
    renderValue({ label: 'Description of results' }, 0);
    expect(screen.getByRole('textbox')).toHaveValue('0');
  });

  it('boolean: false renders as an unchecked switch labelled no', () => {
    renderValue({ field_type: 'boolean' }, false);
    expect(screen.getByRole('switch')).not.toBeChecked();
    expect(screen.getByText('no')).toBeInTheDocument();
  });

  it('boolean: true renders as a checked switch labelled yes', () => {
    renderValue({ field_type: 'boolean' }, true);
    expect(screen.getByRole('switch')).toBeChecked();
    expect(screen.getByText('yes')).toBeInTheDocument();
  });

  it('multiselect fallback: renders a stored 0', () => {
    renderValue({ field_type: 'multiselect' }, 0);
    expect(screen.getByRole('textbox')).toHaveValue('0');
  });

  it('unknown type: renders a stored 0', () => {
    renderValue({ field_type: 'mystery' }, 0);
    expect(screen.getByRole('textbox')).toHaveValue('0');
  });
});
