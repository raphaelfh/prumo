import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/copy', () => ({
  t: (_ns: string, key: string) => key,
}));

import { StatusRing } from '@/components/shared/list/StatusRing';

describe('StatusRing', () => {
  it('not started (0%): empty ring, no number, not-started label', () => {
    render(<StatusRing progress={0} />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'listStatusNotStarted');
    expect(screen.queryByText('0')).toBeNull();
  });

  it('in progress: shows the rounded number and the in-progress label', () => {
    render(<StatusRing progress={52.4} />);
    expect(screen.getByText('52')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'statusInProgressPct');
  });

  it('complete (100%): complete label, no number', () => {
    render(<StatusRing progress={100} />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'listStatusComplete');
    expect(screen.queryByText('100')).toBeNull();
  });

  it('clamps out-of-range progress', () => {
    render(<StatusRing progress={140} />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'listStatusComplete');
  });
});
