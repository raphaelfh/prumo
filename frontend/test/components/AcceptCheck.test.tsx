import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';
import {AcceptCheck} from '@/components/extraction/review/AcceptCheck';

/**
 * The check is the one accept control of the review table. Two states used to
 * misread: an in-flight decision showed the global `[aria-disabled]` NOT-ALLOWED
 * cursor (the work reads as forbidden), and a row whose ACCEPTED version is an
 * older one rendered exactly like a row with no decision at all.
 */
describe('AcceptCheck busy affordance', () => {
  it('reads as busy, never as forbidden, while a decision is in flight', async () => {
    const onToggle = vi.fn();
    render(<AcceptCheck accepted={false} saving pending onToggle={onToggle}/>);
    const check = screen.getByRole('button', {name: 'Accept extraction'});
    // The click guard stays: `aria-disabled` is honest about ignoring clicks.
    expect(check).toHaveAttribute('aria-disabled', 'true');
    expect(check).toHaveAttribute('aria-busy', 'true');
    // jsdom computes no Tailwind, so the cursor is asserted as the class that
    // overrides the global `[aria-disabled="true"] {cursor: not-allowed}` rule.
    expect(check.className).toContain('cursor-wait');
    await userEvent.click(check);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('carries no busy cursor once settled', () => {
    render(<AcceptCheck accepted={false} saving={false} onToggle={vi.fn()}/>);
    expect(screen.getByRole('button', {name: 'Accept extraction'}).className).not.toContain('cursor-wait');
  });
});

describe('AcceptCheck accepted-elsewhere state', () => {
  it('distinguishes "an earlier extraction is accepted" from both other states', async () => {
    const user = userEvent.setup();
    const view = render(<AcceptCheck accepted={false} saving={false} acceptedElsewhere onToggle={vi.fn()}/>);
    const check = screen.getByRole('button', {name: 'Accept extraction'});
    // Not pressed — THIS version is not the accepted one — but visibly marked.
    expect(check).toHaveAttribute('aria-pressed', 'false');
    expect(check.className).toContain('ring-success/40');
    expect(check.className).not.toContain('bg-success/10');
    await user.hover(check);
    expect(await screen.findByText('An earlier extraction is accepted')).toBeInTheDocument();

    view.rerender(<AcceptCheck accepted saving={false} onToggle={vi.fn()}/>);
    const settled = screen.getByRole('button', {name: 'Unaccept extraction'});
    expect(settled).toHaveAttribute('aria-pressed', 'true');
    expect(settled.className).toContain('bg-success/10');
    expect(settled.className).not.toContain('ring-success/40');
  });
});
