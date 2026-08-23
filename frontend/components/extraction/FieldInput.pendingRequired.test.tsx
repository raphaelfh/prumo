import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';

vi.mock('@/lib/copy', () => ({ t: (_ns: string, key: string) => key }));

import { FieldInput } from './FieldInput';
import { RunEditabilityProvider } from '@/components/runs/RunEditabilityContext';
import type { ExtractionField } from '@/types/extraction';

function makeField(over: Partial<ExtractionField>): ExtractionField {
  return {
    id: 'f1', entity_type_id: 'et', name: 'x', label: 'Sample size', description: null,
    field_type: 'text', is_required: true, validation_schema: null, allowed_values: null,
    unit: null, allowed_units: null, llm_description: null, sort_order: 0, created_at: '',
    ...over,
  } as ExtractionField;
}

function renderField(props: { field?: Partial<ExtractionField>; value: unknown; readOnly?: boolean }) {
  const ui = (
    <TooltipProvider>
      <FieldInput
        field={makeField(props.field ?? {})}
        instanceId="i1"
        value={props.value}
        onChange={vi.fn()}
        projectId="p1"
      />
    </TooltipProvider>
  );
  return render(
    props.readOnly ? <RunEditabilityProvider stage="finalized">{ui}</RunEditabilityProvider> : ui,
  );
}

const pendingRow = (c: HTMLElement) => c.querySelector('[data-pending-required]');

describe('FieldInput pending-required marker', () => {
  it('marks a required field with no value', () => {
    const { container } = renderField({ value: '' });
    expect(pendingRow(container)).not.toBeNull();
  });

  it('does NOT mark a required field that holds a value', () => {
    const { container } = renderField({ value: 'Cohort' });
    expect(pendingRow(container)).toBeNull();
  });

  it('does NOT mark an optional empty field', () => {
    const { container } = renderField({ field: { is_required: false }, value: '' });
    expect(pendingRow(container)).toBeNull();
  });

  it('does NOT mark a field resolved with an absent_reason marker (ADR-0016)', () => {
    // A recorded "no information" IS an answer — the counters treat it as
    // filled, so the marker must agree or the two signals contradict.
    const { container } = renderField({ value: { value: null, absent_reason: 'no_information' } });
    expect(pendingRow(container)).toBeNull();
  });

  it('DOES mark a field carrying an out-of-vocabulary absent_reason', () => {
    // Guards the oracle: a garbage code is not a resolution.
    const { container } = renderField({ value: { value: null, absent_reason: 'made_up' } });
    expect(pendingRow(container)).not.toBeNull();
  });

  it('does NOT mark a required numeric field holding 0', () => {
    // 0 and false are filled values, not emptiness.
    const { container } = renderField({ field: { field_type: 'number' }, value: 0 });
    expect(pendingRow(container)).toBeNull();
  });

  it('a required number field holding 0 SHOWS the 0 while staying unflagged', () => {
    // The two halves must agree end-to-end. When the editor collapsed 0 to '',
    // this field rendered an empty box that the marker deliberately did not
    // flag (0 is answered) — a blank input nothing pointed at, which is exactly
    // what the accent was built to eliminate.
    const { container } = renderField({ field: { field_type: 'number' }, value: 0 });
    expect(screen.getByRole('spinbutton')).toHaveValue(0);
    expect(pendingRow(container)).toBeNull();
  });

  it('hides the marker on a read-only run', () => {
    // Same rule as the nav rail footer: a fill-completion CTA is noise on a
    // published view.
    const { container } = renderField({ value: '', readOnly: true });
    expect(pendingRow(container)).toBeNull();
  });

  it('accents the empty input itself, not just the row', () => {
    renderField({ value: '' });
    expect(screen.getByRole('textbox').className).toContain('border-warning');
  });

  it('does not accent an input that already holds a value', () => {
    renderField({ value: 'Cohort' });
    expect(screen.getByRole('textbox').className).not.toContain('border-warning');
  });
});
