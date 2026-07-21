// frontend/components/runs/header/__tests__/Worklist.test.tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Worklist } from '@/components/runs/header/Worklist';

vi.mock('@/lib/copy', () => ({ t: (_n: string, k: string) => k }));

// cmdk calls scrollIntoView on the selected item — jsdom doesn't implement it
beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

const articles = [
  { id: 'a1', title: 'Article One' },
  { id: 'a2', title: 'Article Two' },
  { id: 'a3', title: 'Article Three' },
];

describe('RunHeader.Worklist', () => {
  it('renders "2 / 3" trigger when current is middle article', () => {
    render(<Worklist articles={articles} currentId="a2" onNavigate={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'worklistPositionLabel' })).toHaveTextContent('2 / 3');
  });

  it('calls onNavigate with first article id when prev is clicked', async () => {
    const onNavigate = vi.fn();
    render(<Worklist articles={articles} currentId="a2" onNavigate={onNavigate} />);
    await userEvent.click(screen.getByRole('button', { name: 'articlePrevious' }));
    expect(onNavigate).toHaveBeenCalledWith('a1');
  });

  it('calls onNavigate with third article id when next is clicked', async () => {
    const onNavigate = vi.fn();
    render(<Worklist articles={articles} currentId="a2" onNavigate={onNavigate} />);
    await userEvent.click(screen.getByRole('button', { name: 'articleNext' }));
    expect(onNavigate).toHaveBeenCalledWith('a3');
  });

  it('disables prev button when at first article', () => {
    render(<Worklist articles={articles} currentId="a1" onNavigate={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'articlePrevious' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'articleNext' })).not.toBeDisabled();
  });

  it('disables next button when at last article', () => {
    render(<Worklist articles={articles} currentId="a3" onNavigate={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'articleNext' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'articlePrevious' })).not.toBeDisabled();
  });

  it('opens popover and lists all article titles on trigger click', async () => {
    render(<Worklist articles={articles} currentId="a2" onNavigate={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'worklistPositionLabel' }));
    expect(screen.getByText('Article One')).toBeInTheDocument();
    expect(screen.getByText('Article Two')).toBeInTheDocument();
    expect(screen.getByText('Article Three')).toBeInTheDocument();
  });

  it('calls onNavigate with article id when a row in the popover is clicked', async () => {
    const onNavigate = vi.fn();
    render(<Worklist articles={articles} currentId="a2" onNavigate={onNavigate} />);
    await userEvent.click(screen.getByRole('button', { name: 'worklistPositionLabel' }));
    await userEvent.click(screen.getByText('Article One'));
    expect(onNavigate).toHaveBeenCalledWith('a1');
  });
});
