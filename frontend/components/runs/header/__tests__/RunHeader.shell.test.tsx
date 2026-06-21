import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RunHeader } from '../RunHeader';
import type { RunHeaderValue } from '../RunHeaderContext';

// Minimal valid header value — Task 7 only cares that the root renders through
// HeaderShell, so the slot leaves are intentionally empty.
const base: RunHeaderValue = {
  kind: 'qa',
  stage: 'extract',
  isRevision: false,
  role: 'reviewer',
  isBlind: false,
  canReveal: false,
  progress: { completed: 0, total: 0, pct: 0 },
  reviewers: { count: 0, required: 0, divergent: 0 },
  transition: null,
};

describe('RunHeader through HeaderShell', () => {
  it('renders the header inside a self-declared @container/headerbar with frosted chrome', () => {
    render(
      <RunHeader value={base}>
        <RunHeader.Left>
          <span>L</span>
        </RunHeader.Left>
      </RunHeader>,
    );
    const header = screen.getByText('L').closest('header');
    expect(header).not.toBeNull();
    expect(header!.className).toContain('@container/headerbar');
    expect(header!.className).toContain('frosted-header');
    // position="relative" (run pages don't scroll the header out), not sticky.
    expect(header!.className).toContain('relative');
  });
});
