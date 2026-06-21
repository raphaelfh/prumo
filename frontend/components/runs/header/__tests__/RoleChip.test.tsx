// frontend/components/runs/header/__tests__/RoleChip.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RunHeader } from '@/components/runs/header';
vi.mock('@/lib/copy', () => ({ t: (_n: string, k: string) => k }));

const base = {
  kind: 'extraction' as const, stage: 'extract' as const, isRevision: false,
  progress: { completed: 0, total: 0, pct: 0 }, reviewers: { count: 0, required: 0, divergent: 0 }, transition: null,
};

describe('RunHeader.RoleChip', () => {
  it('shows the role with a blind suffix and reveals via the popover action', async () => {
    const onReveal = vi.fn();
    render(<RunHeader value={{ ...base, role: 'manager', isBlind: true, canReveal: true, onReveal }}>
      <RunHeader.Center><RunHeader.RoleChip /></RunHeader.Center>
    </RunHeader>);
    expect(screen.getByText(/manager/i)).toBeInTheDocument();
    expect(screen.getByText('blindSuffix')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /manager/i }));
    await userEvent.click(screen.getByRole('button', { name: 'reveal' }));
    expect(onReveal).toHaveBeenCalledOnce();
  });
  it('renders a plain non-interactive chip for a reviewer', () => {
    render(<RunHeader value={{ ...base, role: 'reviewer', isBlind: true, canReveal: false }}>
      <RunHeader.Center><RunHeader.RoleChip /></RunHeader.Center>
    </RunHeader>);
    expect(screen.queryByRole('button', { name: /reviewer/i })).toBeNull();
    expect(screen.getByText(/reviewer/i)).toBeInTheDocument();
  });
});
