// frontend/components/runs/header/__tests__/StageRail.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RunHeader } from '@/components/runs/header';
vi.mock('@/lib/copy', () => ({ t: (_n: string, k: string) => k }));

const value = {
  kind: 'extraction' as const, stage: 'extract' as const, isRevision: true,
  role: 'manager' as const, isBlind: true, canReveal: true,
  progress: { completed: 3, total: 30, pct: 10 },
  reviewers: { count: 2, required: 3, divergent: 0 }, transition: null,
};

describe('RunHeader.StageRail (3-node)', () => {
  it('renders three nodes, marks Extract current for review, shows revision tag', () => {
    render(
      <RunHeader value={value}>
        <RunHeader.Left><RunHeader.StageRail /></RunHeader.Left>
      </RunHeader>,
    );
    ['stageExtract', 'stageConsensus', 'stageFinalized'].forEach((l) =>
      expect(screen.getByText(l)).toBeInTheDocument());
    expect(screen.queryByText('stageProposal')).toBeNull();
    expect(screen.queryByText('stageReview')).toBeNull();
    // The current node (Extract, since DB stage is `review`) carries the testid.
    expect(screen.getByTestId('run-stage-current')).toHaveTextContent('stageExtract');
    expect(screen.getByLabelText('Run stage')).toBeInTheDocument();
    expect(screen.getByText('revision')).toBeInTheDocument();
  });

  it('announces each node\'s state to assistive tech (not just the stage word)', () => {
    render(
      <RunHeader value={value}>
        <RunHeader.Left><RunHeader.StageRail /></RunHeader.Left>
      </RunHeader>,
    );
    // stage='extract' → extract is current, consensus upcoming, finalized locked.
    expect(screen.getByText(/stageStateCurrent/)).toBeInTheDocument();
    expect(screen.getByText(/stageStateUpcoming/)).toBeInTheDocument();
    expect(screen.getByText(/stageStateLocked/)).toBeInTheDocument();
  });

  it('does not render a gate-remaining chip in the rail', () => {
    render(
      <RunHeader value={{ ...value, transition: { to: 'consensus', label: 'x', gate: { ok: false, reason: 'r', remaining: 27 }, onAdvance: () => {} } }}>
        <RunHeader.Left><RunHeader.StageRail /></RunHeader.Left>
      </RunHeader>,
    );
    expect(screen.queryByText('gateRemaining')).toBeNull();
  });
});
