/**
 * FieldInput ⇄ DispositionRow wiring (ADR-0016).
 *
 * The row's own behaviour — which codes render, the marker envelope, the active
 * ring, the tooltips — is covered once in DispositionRow.test.tsx. What is
 * FieldInput's alone lives here: that every field type gets the control
 * (number/date/text had none before), that the per-field flag reaches it, that a
 * marker never leaks into the typed input, and that setting one clears a
 * standing validation error.
 */

import { render as rtlRender, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';

vi.mock('@/lib/copy', () => ({ t: (_ns: string, key: string) => key }));

import { FieldInput } from './FieldInput';
import type { ExtractionField } from '@/types/extraction';

const render = (ui: React.ReactElement) =>
  rtlRender(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);

function makeField(over: Partial<ExtractionField>): ExtractionField {
  return {
    id: 'f1',
    entity_type_id: 'et',
    name: 'x',
    label: 'X',
    description: null,
    field_type: 'text',
    is_required: false,
    validation_schema: null,
    allowed_values: null,
    unit: null,
    allowed_units: null,
    llm_description: null,
    sort_order: 0,
    created_at: '',
    ...over,
  };
}

function renderField(field: ExtractionField, value: unknown, onChange = vi.fn()) {
  render(
    <FieldInput
      field={field}
      instanceId="i1"
      value={value}
      onChange={onChange}
      projectId="p1"
    />,
  );
  return onChange;
}

const NO_INFO = { value: null, absent_reason: 'no_information' };

describe('FieldInput disposition wiring', () => {
  it.each(['text', 'number', 'date', 'select'] as const)(
    'offers "No information" on a %s field and writes the marker',
    async (fieldType) => {
      const user = userEvent.setup();
      const onChange = renderField(
        makeField({ field_type: fieldType, allowed_values: fieldType === 'select' ? ['Yes', 'No'] : null }),
        '',
      );
      await user.click(screen.getByRole('button', { name: 'dispositionNoInformation' }));
      expect(onChange).toHaveBeenCalledWith(NO_INFO);
    },
  );

  it('threads the per-field flags through to the row', () => {
    // The gate must reach the row from FieldInput's own `field` prop — PR #729
    // wired exactly this, and the consensus copy went ungated because it had no
    // equivalent. Both now read the same flags off the same object.
    renderField(makeField({ allows_no_information: false, allows_not_applicable: true }), '');
    expect(screen.queryByRole('button', { name: 'dispositionNoInformation' })).toBeNull();
    expect(screen.getByRole('button', { name: 'dispositionNotApplicable' })).toBeInTheDocument();
  });

  it('a marker value does not leak into the typed input (no [object Object])', () => {
    renderField(makeField({ field_type: 'text' }), NO_INFO);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('');
  });

  it('setting a disposition clears a standing validation error', async () => {
    // FieldInput-only behaviour: the marker IS a resolved answer, so the
    // "required" complaint it just raised must not survive it.
    const user = userEvent.setup();
    renderField(makeField({ is_required: true, field_type: 'text' }), 'seed');
    await user.clear(screen.getByRole('textbox'));
    expect(screen.getByText('fieldRequired')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'dispositionNoInformation' }));
    expect(screen.queryByText('fieldRequired')).toBeNull();
  });
});
