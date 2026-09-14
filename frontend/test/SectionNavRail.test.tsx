// frontend/test/SectionNavRail.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  it('in compact mode keeps only status dots, hiding labels and the footer', () => {
    render(<SectionNavRail compact items={items} activeId="s2" onSelect={() => {}} />);
    expect(screen.queryByText('Source of data')).not.toBeInTheDocument();
    expect(screen.queryByText('3/12')).not.toBeInTheDocument();
    expect(screen.queryByText('sectionNavRequiredLeft')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Participants 3/12' })).toHaveAttribute('aria-current', 'true');
  });

  it('shows the label and count in a tooltip when a dot takes focus', async () => {
    render(<SectionNavRail compact items={items} activeId="s1" onSelect={() => {}} />);
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Source of data 1/1' })).toHaveFocus();
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('Source of data');
    expect(tooltip).toHaveTextContent('1/1');
  });

  it('shows the label and count in a tooltip when a dot is hovered', async () => {
    render(<SectionNavRail compact items={items} activeId="s1" onSelect={() => {}} />);
    const dot = screen.getByRole('button', { name: 'Participants 3/12' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    await userEvent.hover(dot);
    expect(dot).not.toHaveFocus();
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('Participants');
    expect(tooltip).toHaveTextContent('3/12');
  });

  it('clicking a compact dot selects that section', () => {
    const onSelect = vi.fn();
    render(<SectionNavRail compact items={items} activeId="s1" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Predictors 0/6' }));
    expect(onSelect).toHaveBeenCalledWith('cs');
  });
});
