import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RunHeader } from '@/components/runs/header';
import { useRunHeader, type StageTransition } from '@/components/runs/header/RunHeaderContext';

function Probe() {
  const ctx = useRunHeader();
  return <span data-testid="probe">{ctx.kind}:{ctx.stage}</span>;
}

const baseValue = {
  kind: 'extraction' as const, stage: 'review' as const, isRevision: false,
  role: 'manager' as const, isBlind: true, canReveal: true,
  progress: { completed: 3, total: 30, pct: 10 },
  reviewers: { count: 2, required: 3, divergent: 1 }, transition: null,
};

describe('RunHeader shell', () => {
  it('renders the bar and provides context to slots', () => {
    render(
      <RunHeader value={baseValue}>
        <RunHeader.Left><Probe /></RunHeader.Left>
      </RunHeader>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('extraction:review');
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  it('StageTransition accepts a non-extraction stage string in to (widened type)', () => {
    // 'published' is NOT in ExtractionRunStage; this only compiles if to: string
    const transition: StageTransition = {
      to: 'published',
      label: 'Publish',
      gate: { ok: true },
      onAdvance: () => {},
    };
    render(
      <RunHeader value={{ ...baseValue, transition }}>
        <RunHeader.Right><RunHeader.PrimaryAction /></RunHeader.Right>
      </RunHeader>,
    );
    expect(screen.getByRole('button', { name: 'Publish' })).toBeInTheDocument();
  });
});
