import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RunHeader } from '@/components/runs/header';
vi.mock('@/lib/copy', () => ({ t: (_n: string, k: string) => k }));

const base = {
  kind: 'extraction' as const, isRevision: false, role: 'manager' as const, isBlind: false,
  canReveal: false, progress: { completed: 0, total: 0, pct: 0 }, transition: null,
};

describe('RunHeader.Reviewers', () => {
  it('renders nothing when there are no reviewers', () => {
    const { container } = render(<RunHeader value={{ ...base, stage: 'extract', reviewers: { count: 0, required: 3, divergent: 0 } }}><RunHeader.Center><RunHeader.Reviewers /></RunHeader.Center></RunHeader>);
    expect(container.querySelector('[data-testid="run-reviewers"]')).toBeNull();
  });
  it('renders avatars + a divergence chip in extract when reviewers exist', () => {
    render(<RunHeader value={{ ...base, stage: 'extract', reviewers: { count: 2, required: 3, divergent: 3 } }}><RunHeader.Center><RunHeader.Reviewers /></RunHeader.Center></RunHeader>);
    expect(screen.getByTestId('run-reviewers')).toBeInTheDocument();
    expect(screen.getByText('reviewersDiffer')).toBeInTheDocument();
  });
});
