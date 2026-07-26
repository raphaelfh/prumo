/**
 * A cleared field must LOOK cleared.
 *
 * The QA screen showed the opposite: `displayValue` fell back to the AI
 * suggestion's value whenever the form value was empty, so clearing a domain
 * judgment left the select still showing its old answer. Two things then went
 * wrong at once — the reviewer got no feedback that the clear took effect, and
 * because Radix suppresses `onValueChange` when the picked option already equals
 * the controlled value, re-picking that same option was a silent no-op. The
 * judgment stayed blank, and the computed overall stayed a dash.
 *
 * The fallback is not niche: the backend marks ANY non-reject reviewer decision
 * `accepted`, so a plainly hand-typed value carries `status: 'accepted'` too.
 */

import { render as rtlRender, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';

vi.mock('@/lib/copy', () => ({ t: (_ns: string, key: string) => key }));

import { FieldInput } from './FieldInput';
import type { ExtractionField } from '@/types/extraction';

const render = (ui: React.ReactElement) =>
  rtlRender(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);

// Radix Select drives its listbox through pointer-capture APIs jsdom does not
// implement; without these the trigger never opens and the re-pick cannot be
// exercised at all. Scoped to this file — the assertion under test is the
// re-pick, not the polyfill.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const JUDGMENT: ExtractionField = {
  id: 'f1',
  entity_type_id: 'et',
  name: 'quality_concern',
  label: 'Quality concern',
  description: null,
  field_type: 'select',
  is_required: false,
  validation_schema: null,
  allowed_values: ['Low', 'High', 'Unclear'],
  unit: null,
  allowed_units: null,
  llm_description: null,
  sort_order: 0,
  created_at: '',
} as ExtractionField;

function renderJudgment(value: unknown, suggestionValue: unknown) {
  const onChange = vi.fn();
  render(
    <FieldInput
      field={JUDGMENT}
      instanceId="i1"
      value={value}
      onChange={onChange}
      projectId="p1"
      aiSuggestion={{ id: 'cur', status: 'accepted', value: suggestionValue } as never}
    />,
  );
  return onChange;
}

describe('FieldInput — a cleared judgment does not display a stale value', () => {
  it('shows the placeholder after a clear instead of the accepted suggestion', () => {
    renderJudgment(null, 'Low');
    const trigger = screen.getByRole('combobox');
    expect(trigger).not.toHaveTextContent('Low');
    expect(trigger).toHaveTextContent('selectFieldPlaceholder');
  });

  it('lets the reviewer re-pick the value the field held before the clear', async () => {
    const user = userEvent.setup();
    // The stale display used to make the control think 'Low' was already
    // selected, so Radix swallowed the re-pick and the write never happened.
    const onChange = renderJudgment(null, 'Low');
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'Low' }));
    expect(onChange).toHaveBeenCalledWith('Low');
  });

  it('shows the placeholder when a marker envelope is the accepted suggestion', () => {
    // The exact production shape: the AI proposed "no information", the reviewer
    // cleared it. An envelope OBJECT reaching Radix's controlled `value` is
    // truthy, which suppressed the placeholder and rendered a blank box.
    renderJudgment(null, { value: null, absent_reason: 'no_information' });
    expect(screen.getByRole('combobox')).toHaveTextContent('selectFieldPlaceholder');
  });
});
