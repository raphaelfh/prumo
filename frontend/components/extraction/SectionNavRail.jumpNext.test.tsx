import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/copy', () => ({ t: (_ns: string, key: string) => key }));

import SectionNavRail from './SectionNavRail';
import { RunEditabilityProvider } from '@/components/runs/RunEditabilityContext';

const incomplete = [
  { id: 's1', label: 'Participants', requiredTotal: 3, requiredFilled: 1, state: 'in_progress' as const, level: 0 as const },
];
const complete = [
  { id: 's1', label: 'Participants', requiredTotal: 3, requiredFilled: 3, state: 'complete' as const, level: 0 as const },
];

describe('SectionNavRail jump-to-next-unfilled', () => {
  it('offers the jump control while required fields remain', () => {
    render(<SectionNavRail items={incomplete} activeId={null} onSelect={vi.fn()} onJumpToNextPending={vi.fn()} />);
    expect(screen.getByRole('button', { name: /sectionNavJumpNext/ })).toBeInTheDocument();
  });

  it('invokes the callback on click', async () => {
    const onJump = vi.fn();
    render(<SectionNavRail items={incomplete} activeId={null} onSelect={vi.fn()} onJumpToNextPending={onJump} />);
    await userEvent.click(screen.getByRole('button', { name: /sectionNavJumpNext/ }));
    expect(onJump).toHaveBeenCalledTimes(1);
  });

  it('hides the jump control once every required field is filled', () => {
    render(<SectionNavRail items={complete} activeId={null} onSelect={vi.fn()} onJumpToNextPending={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /sectionNavJumpNext/ })).not.toBeInTheDocument();
  });

  it('hides the jump control on a read-only run', () => {
    render(
      <RunEditabilityProvider stage="finalized">
        <SectionNavRail items={incomplete} activeId={null} onSelect={vi.fn()} onJumpToNextPending={vi.fn()} />
      </RunEditabilityProvider>,
    );
    expect(screen.queryByRole('button', { name: /sectionNavJumpNext/ })).not.toBeInTheDocument();
  });

  it('omits the control entirely when no handler is wired', () => {
    render(<SectionNavRail items={incomplete} activeId={null} onSelect={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /sectionNavJumpNext/ })).not.toBeInTheDocument();
  });

  it('keeps the control reachable and labelled when the rail is collapsed', () => {
    // Collapsed rail (PDF panel open) drops the labels — the jump control must
    // survive as an icon button with an accessible name, not disappear.
    render(
      <SectionNavRail items={incomplete} activeId={null} onSelect={vi.fn()} onJumpToNextPending={vi.fn()} collapsed />,
    );
    expect(screen.getByRole('button', { name: /sectionNavJumpNext/ })).toBeInTheDocument();
  });
});
