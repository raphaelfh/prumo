// frontend/components/runs/header/__tests__/StageRail.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RunHeader } from '@/components/runs/header';
import { vi } from 'vitest';
vi.mock('@/lib/copy', () => ({ t: (_n: string, k: string) => k }));

const value = {
  kind: 'extraction' as const, stage: 'review' as const, isRevision: true,
  role: 'manager' as const, isBlind: true, canReveal: true,
  progress: { completed: 3, total: 30, pct: 10 },
  reviewers: { count: 2, required: 3, divergent: 0 }, transition: null,
};

describe('RunHeader.StageRail', () => {
  it('renders four nodes, marks the current stage, and shows the revision tag + gate count', () => {
    render(<RunHeader value={{ ...value, transition: { to: 'consensus', label: 'Reconcile', gate: { ok: false, reason: 'x', remaining: 27 }, onAdvance: () => {} } }}>
      <RunHeader.Left><RunHeader.StageRail /></RunHeader.Left>
    </RunHeader>);
    ['stageProposal', 'stageReview', 'stageConsensus', 'stageFinalized'].forEach((l) => expect(screen.getByText(l)).toBeInTheDocument());
    expect(screen.getByText('stageReview').closest('[data-state]')).toHaveAttribute('data-state', 'current');
    expect(screen.getByText('revision')).toBeInTheDocument();
    expect(screen.getByText('gateRemaining')).toBeInTheDocument();
  });
});
