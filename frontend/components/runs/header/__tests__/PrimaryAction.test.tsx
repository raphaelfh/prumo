import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RunHeader } from '@/components/runs/header';
vi.mock('@/lib/copy', () => ({ t: (_n: string, k: string) => k }));

const base = {
  kind: 'extraction' as const, stage: 'review' as const, isRevision: false,
  role: 'manager' as const, isBlind: false, canReveal: false,
  progress: { completed: 3, total: 30, pct: 10 }, reviewers: { count: 0, required: 0, divergent: 0 },
};

describe('RunHeader.PrimaryAction', () => {
  it('labels only the verb and advances when the gate is open', async () => {
    const onAdvance = vi.fn();
    render(<RunHeader value={{ ...base, transition: { to: 'consensus', label: 'Reconcile', gate: { ok: true }, onAdvance } }}>
      <RunHeader.Right><RunHeader.PrimaryAction /></RunHeader.Right>
    </RunHeader>);
    const btn = screen.getByRole('button', { name: 'Reconcile' });
    expect(btn).not.toBeDisabled();
    await userEvent.click(btn);
    expect(onAdvance).toHaveBeenCalledOnce();
  });
  it('when gated, shows the remaining helper, is aria-disabled, and still runs onAdvance (guide-me) on click', async () => {
    const onAdvance = vi.fn();
    render(<RunHeader value={{ ...base, transition: { to: 'consensus', label: 'Reconcile', gate: { ok: false, reason: 'r', remaining: 27 }, onAdvance } }}>
      <RunHeader.Right><RunHeader.PrimaryAction /></RunHeader.Right>
    </RunHeader>);
    const btn = screen.getByRole('button', { name: /Reconcile/ });
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('runHeaderRequiredOfTotal')).toBeInTheDocument();
    await userEvent.click(btn);
    expect(onAdvance).toHaveBeenCalledOnce();
  });
  it('renders nothing when there is no transition', () => {
    const { container } = render(<RunHeader value={{ ...base, transition: null }}><RunHeader.Right><RunHeader.PrimaryAction /></RunHeader.Right></RunHeader>);
    expect(container.querySelector('button')).toBeNull();
  });
});
