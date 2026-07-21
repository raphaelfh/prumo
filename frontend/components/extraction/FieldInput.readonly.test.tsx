import { render as rtlRender, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';

vi.mock('@/lib/copy', () => ({ t: (_ns: string, key: string) => key }));

import { FieldInput } from './FieldInput';
import { RunEditabilityProvider } from '@/components/runs/RunEditabilityContext';
import type { ExtractionField } from '@/types/extraction';
import type { AISuggestion } from '@/types/ai-extraction';

function makeField(over: Partial<ExtractionField>): ExtractionField {
  return {
    id: 'f1', entity_type_id: 'et', name: 'x', label: 'X', description: null,
    field_type: 'text', is_required: false, validation_schema: null, allowed_values: null,
    unit: null, allowed_units: null, llm_description: null, sort_order: 0, created_at: '',
    ...over,
  } as ExtractionField;
}

const PENDING_SUGGESTION = {
  id: 'p1',
  status: 'pending',
  value: 'suggested',
  confidence: 0.9,
} as unknown as AISuggestion;

function renderReadOnly(ui: React.ReactElement) {
  return rtlRender(
    <TooltipProvider>
      <RunEditabilityProvider stage="finalized">{ui}</RunEditabilityProvider>
    </TooltipProvider>,
  );
}

describe('FieldInput under a read-only run', () => {
  it('disables the text input', () => {
    renderReadOnly(
      <FieldInput field={makeField({})} instanceId="i1" value="v" onChange={vi.fn()} projectId="p1" />,
    );
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it('disables the disposition buttons', () => {
    renderReadOnly(
      <FieldInput field={makeField({})} instanceId="i1" value="" onChange={vi.fn()} projectId="p1" />,
    );
    expect(screen.getByRole('button', { name: 'dispositionNoInformation' })).toBeDisabled();
  });

  it('renders a published marker as an active (but disabled) disposition', () => {
    renderReadOnly(
      <FieldInput
        field={makeField({})}
        instanceId="i1"
        value={{ value: null, absent_reason: 'no_information' }}
        onChange={vi.fn()}
        projectId="p1"
      />,
    );
    const btn = screen.getByRole('button', { name: 'dispositionNoInformation' });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(btn).toBeDisabled();
  });

  it('hides the pending-suggestion strip', () => {
    // Content-based assertion (the strip has no testid — a testid query
    // would pass vacuously). The positive control below proves this
    // assertion actually detects the strip.
    renderReadOnly(
      <FieldInput
        field={makeField({})} instanceId="i1" value="" onChange={vi.fn()} projectId="p1"
        aiSuggestion={PENDING_SUGGESTION} onAcceptAI={vi.fn()} onRejectAI={vi.fn()}
      />,
    );
    expect(screen.queryByText('suggested')).not.toBeInTheDocument();
  });

  it('positive control: the strip DOES render without a provider', () => {
    rtlRender(
      <TooltipProvider>
        <FieldInput
          field={makeField({})} instanceId="i1" value="" onChange={vi.fn()} projectId="p1"
          aiSuggestion={PENDING_SUGGESTION} onAcceptAI={vi.fn()} onRejectAI={vi.fn()}
        />
      </TooltipProvider>,
    );
    expect(screen.getByText('suggested')).toBeInTheDocument();
  });

  it('stays editable without a provider (default)', () => {
    rtlRender(
      <TooltipProvider>
        <FieldInput field={makeField({})} instanceId="i1" value="v" onChange={vi.fn()} projectId="p1" />
      </TooltipProvider>,
    );
    expect(screen.getByRole('textbox')).toBeEnabled();
  });
});
