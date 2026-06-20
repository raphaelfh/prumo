// frontend/test/SectionNavRail.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SectionNavRail from '@/components/extraction/SectionNavRail';
import type { SectionNavItem } from '@/lib/extraction/sectionRegistry';

vi.mock('@/lib/copy', () => ({ t: (_ns: string, key: string) => key }));

const items: SectionNavItem[] = [
  { id: 's1', label: 'Source of data', requiredTotal: 1, requiredFilled: 1, state: 'complete', level: 0 },
  { id: 's2', label: 'Participants', requiredTotal: 12, requiredFilled: 3, state: 'in_progress', level: 0 },
  { id: 'cs', label: 'Predictors', requiredTotal: 6, requiredFilled: 0, state: 'empty', level: 1 },
];

describe('SectionNavRail', () => {
  it('renders one row per section with its count and marks the active row', () => {
    render(<SectionNavRail items={items} activeId="s2" onSelect={() => {}} />);
    expect(screen.getByText('Source of data')).toBeInTheDocument();
    expect(screen.getByText('3/12')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Participants/ })).toHaveAttribute('aria-current', 'true');
  });

  it('calls onSelect with the section id when a row is clicked', () => {
    const onSelect = vi.fn();
    render(<SectionNavRail items={items} activeId="s1" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /Predictors/ }));
    expect(onSelect).toHaveBeenCalledWith('cs');
  });

  it('shows global required-left in the footer', () => {
    render(<SectionNavRail items={items} activeId="s1" onSelect={() => {}} />);
    expect(screen.getByText('sectionNavRequiredLeft')).toBeInTheDocument();
  });
});
