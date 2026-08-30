/**
 * DispositionRow — the shared ADR-0016 disposition control.
 *
 * These assertions used to live in FieldInput.test.tsx, against one of two
 * hand-kept copies of this row. They now run once, against the component both
 * the extraction form and the consensus override editor render.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/copy', () => ({ t: (_ns: string, key: string) => key }));

import { DispositionRow, type DispositionRowField } from './DispositionRow';

const NO_INFO = { value: null, absent_reason: 'no_information' };

function renderRow(
  field: DispositionRowField,
  value: unknown = '',
  extra: { disabled?: boolean; activeHint?: string } = {},
) {
  const onChange = vi.fn();
  render(<DispositionRow field={field} value={value} onChange={onChange} {...extra} />);
  return onChange;
}

describe('DispositionRow', () => {
  it('offers "No information" by default and writes the coded marker', async () => {
    const user = userEvent.setup();
    const onChange = renderRow({});
    await user.click(screen.getByRole('button', { name: 'dispositionNoInformation' }));
    expect(onChange).toHaveBeenCalledWith(NO_INFO);
  });

  it('does NOT render Not applicable / Not evaluated unless the field opts in', () => {
    renderRow({});
    expect(screen.getByRole('button', { name: 'dispositionNoInformation' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'dispositionNotApplicable' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'dispositionNotEvaluated' })).toBeNull();
  });

  it('hides No information when the field opts OUT (migration 0062)', () => {
    // PROBAST+AI 2.1.0 carries "NI" as the fifth signaling ANSWER. Rendering
    // the marker too would give one answer two encodings on the same control,
    // which the full-envelope consensus compare reads as a divergence.
    renderRow({ allows_no_information: false });
    expect(screen.queryByRole('button', { name: 'dispositionNoInformation' })).toBeNull();
  });

  it('keeps No information when the flag is absent — it was universal pre-0062', () => {
    renderRow({});
    expect(screen.getByRole('button', { name: 'dispositionNoInformation' })).toBeInTheDocument();
  });

  it('renders and writes the opt-in dispositions where enabled', async () => {
    const user = userEvent.setup();
    const onChange = renderRow({ allows_not_applicable: true, allows_not_evaluated: true });
    await user.click(screen.getByRole('button', { name: 'dispositionNotApplicable' }));
    expect(onChange).toHaveBeenCalledWith({ value: null, absent_reason: 'not_applicable' });
    await user.click(screen.getByRole('button', { name: 'dispositionNotEvaluated' }));
    expect(onChange).toHaveBeenCalledWith({ value: null, absent_reason: 'not_evaluated' });
  });

  it('marks the active disposition and toggling it clears back to unresolved', async () => {
    const user = userEvent.setup();
    const onChange = renderRow({}, NO_INFO);
    const btn = screen.getByRole('button', { name: 'dispositionNoInformation' });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    await user.click(btn);
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('the active disposition gets the accepted-style success ring, not just a shade', () => {
    // Consistency with the accepted-suggestion affordance (ring-success +
    // bg-success/10) so "selected" is unmistakable even though the input is blank.
    renderRow({}, NO_INFO);
    const btn = screen.getByRole('button', { name: /dispositionNoInformation/ });
    expect(btn.className).toContain('ring-success');
    expect(btn.className).toContain('bg-success/10');
  });

  it('uses the named button size rather than a hand-rebuilt one', () => {
    // The consensus copy hand-rebuilt `size="xs"` as `size="sm" className="h-6
    // px-2 text-xs"`. That matched on every box metric — the coarse-pointer
    // bump survives a plain `h-*` (different twMerge group) — but inherited the
    // base `[&_svg]:size-4`, so its Check glyph rendered a size larger.
    renderRow({});
    const btn = screen.getByRole('button', { name: 'dispositionNoInformation' });
    expect(btn.className).toContain('[&_svg]:size-3.5');
    expect(btn.className).toContain('[@media(pointer:coarse)]:h-11');
  });

  it('renders the active hint only while a disposition is active', () => {
    renderRow({}, NO_INFO);
    expect(screen.getByText('dispositionActiveHint')).toBeInTheDocument();
  });

  it('shows no active hint when the field is unresolved', () => {
    renderRow({});
    expect(screen.queryByText('dispositionActiveHint')).toBeNull();
  });

  it('lets the caller override the active wording (consensus publishes it)', () => {
    renderRow({}, NO_INFO, { activeHint: 'overrideDispositionRecorded' });
    expect(screen.getByText('overrideDispositionRecorded')).toBeInTheDocument();
    expect(screen.queryByText('dispositionActiveHint')).toBeNull();
  });

  it('renders nothing when the field offers no codes and none is set', () => {
    const { container } = render(
      <DispositionRow
        field={{ allows_no_information: false }}
        value=""
        onChange={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('still surfaces a stray marker on an opted-out field, so it is not silent', () => {
    // Both writers are gated, so this should not arise — but a marker with no
    // chip left to clear must not read as an ordinary blank input.
    renderRow({ allows_no_information: false }, NO_INFO);
    expect(screen.getByText('dispositionActiveHint')).toBeInTheDocument();
  });

  it('disables every chip when disabled', () => {
    renderRow({ allows_not_applicable: true }, '', { disabled: true });
    expect(screen.getByRole('button', { name: 'dispositionNoInformation' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'dispositionNotApplicable' })).toBeDisabled();
  });

  // Radix mirrors tooltip content into an a11y node (assert with *AllBy*) and
  // debounces consecutive open/close in one render — so one fresh render per button.
  it.each([
    ['dispositionNoInformation', 'dispositionNoInformationHint'],
    ['dispositionNotApplicable', 'dispositionNotApplicableHint'],
    ['dispositionNotEvaluated', 'dispositionNotEvaluatedHint'],
  ] as const)('%s describes itself on hover (tooltip)', async (label, hint) => {
    const user = userEvent.setup();
    renderRow({ allows_not_applicable: true, allows_not_evaluated: true });
    await user.hover(screen.getByRole('button', { name: label }));
    expect((await screen.findAllByText(hint)).length).toBeGreaterThan(0);
  });
});
