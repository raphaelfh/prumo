// frontend/components/runs/header/__tests__/Worklist.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Worklist } from '@/components/runs/header/Worklist';

vi.mock('@/lib/copy', () => ({ t: (_n: string, k: string) => k }));

const articles = [
  { id: 'a1', title: 'Article One' },
  { id: 'a2', title: 'Article Two' },
  { id: 'a3', title: 'Article Three' },
];

function renderWorklist(props: Partial<React.ComponentProps<typeof Worklist>> = {}) {
  return render(
    <TooltipProvider>
      <Worklist articles={articles} currentId="a2" onNavigate={vi.fn()} {...props} />
    </TooltipProvider>,
  );
}

describe('RunHeader.Worklist', () => {
  it('renders exactly two buttons — the counter is not interactive', () => {
    renderWorklist();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('shows the position as text', () => {
    renderWorklist();
    expect(screen.getByRole('navigation')).toHaveTextContent('2 / 3');
  });

  it('names the nav with the position for assistive tech', () => {
    renderWorklist();
    expect(screen.getByRole('navigation', { name: 'worklistPositionLabel' })).toBeInTheDocument();
  });

  it('calls onNavigate with the previous article id', async () => {
    const onNavigate = vi.fn();
    renderWorklist({ onNavigate });
    await userEvent.click(screen.getByRole('button', { name: 'articlePrevious' }));
    expect(onNavigate).toHaveBeenCalledWith('a1');
  });

  it('calls onNavigate with the next article id', async () => {
    const onNavigate = vi.fn();
    renderWorklist({ onNavigate });
    await userEvent.click(screen.getByRole('button', { name: 'articleNext' }));
    expect(onNavigate).toHaveBeenCalledWith('a3');
  });

  it('disables prev at the first article without removing it', () => {
    renderWorklist({ currentId: 'a1' });
    expect(screen.getByRole('button', { name: 'articlePrevious' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'articleNext' })).not.toBeDisabled();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('disables next at the last article without removing it', () => {
    renderWorklist({ currentId: 'a3' });
    expect(screen.getByRole('button', { name: 'articleNext' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'articlePrevious' })).not.toBeDisabled();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('renders nothing for a single-article worklist', () => {
    const { container } = render(
      <TooltipProvider>
        <Worklist articles={[articles[0]]} currentId="a1" onNavigate={vi.fn()} />
      </TooltipProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the current article is not in the worklist', () => {
    const { container } = render(
      <TooltipProvider>
        <Worklist articles={articles} currentId="missing" onNavigate={vi.fn()} />
      </TooltipProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
