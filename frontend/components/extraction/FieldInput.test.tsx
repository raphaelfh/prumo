/**
 * FieldInput — the ADR-0016 runtime disposition control.
 *
 * Every field type gets a "No information" affordance (number/date/text had none
 * before); the opt-in Not applicable / Not evaluated render only where the field
 * enables them. Activating writes the coded marker {value:null, absent_reason};
 * toggling the active one clears back to unresolved.
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

describe('FieldInput disposition control', () => {
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

  it('does NOT render Not applicable / Not evaluated unless the field opts in', () => {
    renderField(makeField({}), '');
    expect(screen.getByRole('button', { name: 'dispositionNoInformation' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'dispositionNotApplicable' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'dispositionNotEvaluated' })).toBeNull();
  });

  it('renders and writes the opt-in dispositions where enabled', async () => {
    const user = userEvent.setup();
    const onChange = renderField(
      makeField({ allows_not_applicable: true, allows_not_evaluated: true }),
      '',
    );
    await user.click(screen.getByRole('button', { name: 'dispositionNotApplicable' }));
    expect(onChange).toHaveBeenCalledWith({ value: null, absent_reason: 'not_applicable' });
    await user.click(screen.getByRole('button', { name: 'dispositionNotEvaluated' }));
    expect(onChange).toHaveBeenCalledWith({ value: null, absent_reason: 'not_evaluated' });
  });

  it('marks the active disposition and toggling it clears back to unresolved', async () => {
    const user = userEvent.setup();
    const onChange = renderField(makeField({}), NO_INFO);
    const btn = screen.getByRole('button', { name: 'dispositionNoInformation' });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    await user.click(btn);
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('a marker value does not leak into the typed input (no [object Object])', () => {
    renderField(makeField({ field_type: 'text' }), NO_INFO);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('');
  });

  it('the active disposition gets the accepted-style success ring, not just a shade', () => {
    // Consistency with the accepted-suggestion affordance (ring-success +
    // bg-success/10) so "selected" is unmistakable even though the input is blank.
    renderField(makeField({}), NO_INFO);
    const btn = screen.getByRole('button', { name: /dispositionNoInformation/ });
    expect(btn.className).toContain('ring-success');
    expect(btn.className).toContain('bg-success/10');
  });

  it('renders the "recorded as a resolved answer" hint only while a disposition is active', () => {
    renderField(makeField({}), NO_INFO);
    expect(screen.getByText('dispositionActiveHint')).toBeInTheDocument();
  });

  it('shows no active hint when the field is unresolved', () => {
    renderField(makeField({}), '');
    expect(screen.queryByText('dispositionActiveHint')).toBeNull();
  });

  // Radix mirrors tooltip content into an a11y node (assert with *AllBy*) and
  // debounces consecutive open/close in one render — so one fresh render per button.
  it.each([
    ['dispositionNoInformation', 'dispositionNoInformationHint'],
    ['dispositionNotApplicable', 'dispositionNotApplicableHint'],
    ['dispositionNotEvaluated', 'dispositionNotEvaluatedHint'],
  ] as const)('%s describes itself on hover (tooltip)', async (label, hint) => {
    const user = userEvent.setup();
    renderField(makeField({ allows_not_applicable: true, allows_not_evaluated: true }), '');
    await user.hover(screen.getByRole('button', { name: label }));
    expect((await screen.findAllByText(hint)).length).toBeGreaterThan(0);
  });
});
