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

  it('gives both side tracks an equal share so the centre track is centred', () => {
    render(
      <RunHeader value={base}>
        <RunHeader.Left>left</RunHeader.Left>
        <RunHeader.Center>centre</RunHeader.Center>
        <RunHeader.Right>right</RunHeader.Right>
      </RunHeader>,
    );
    const left = screen.getByText('left');
    const centre = screen.getByTestId('run-header-center');
    const right = screen.getByText('right').closest('div')!;

    // Both side tracks grow from a 0 basis with weight 1 — that is what puts
    // the centre track on the geometric centre.
    expect(left).toHaveClass('flex-1', 'min-w-0');
    expect(right).toHaveClass('flex-1', 'justify-end');
    // Right must NOT get min-w-0: its automatic min-content floor is what
    // keeps PrimaryAction from ever being clipped.
    expect(right).not.toHaveClass('min-w-0');
    // ml-auto is gone — it would pin Right and break the even split.
    expect(right).not.toHaveClass('ml-auto');
    expect(centre).toHaveClass('shrink-0');
  });
});
