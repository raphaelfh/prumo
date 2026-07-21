import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/copy', () => ({ t: (_ns: string, key: string) => key }));

import SectionNavRail from './SectionNavRail';
import { RunEditabilityProvider } from '@/components/runs/RunEditabilityContext';

const items = [
  {
    id: 's1',
    label: 'Participants',
    requiredTotal: 3,
    requiredFilled: 1,
    state: 'in_progress' as const,
    level: 0 as const,
  },
];

describe('SectionNavRail under a read-only run', () => {
  it('hides the required-left progress footer but keeps navigation', () => {
    render(
      <RunEditabilityProvider stage="finalized">
        <SectionNavRail items={items} activeId={null} onSelect={vi.fn()} />
      </RunEditabilityProvider>,
    );
    expect(screen.queryByText(/sectionNavRequiredLeft/)).not.toBeInTheDocument();
    // Navigation stays.
    expect(screen.getByRole('button', { name: /Participants/ })).toBeInTheDocument();
  });

  it('positive control: editable render shows the footer', () => {
    render(<SectionNavRail items={items} activeId={null} onSelect={vi.fn()} />);
    expect(screen.getByText(/sectionNavRequiredLeft/)).toBeInTheDocument();
  });
});
