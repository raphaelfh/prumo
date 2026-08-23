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

  it('exposes the position via a visually-hidden polite live region, so a J/K move is announced', () => {
    renderWorklist({ currentId: 'a3' });
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('worklistPositionLabel');
    expect(status).toHaveClass('sr-only');
    expect(status).toHaveAttribute('aria-live', 'polite');
    // The visible counter stays aria-hidden so the position is not announced
    // twice (once by the live region, once by the visible text).
    expect(screen.getByText('3 / 3')).toHaveAttribute('aria-hidden', 'true');
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

  it('marks prev aria-disabled at the first article without removing or unfocusing it', async () => {
    const onNavigate = vi.fn();
    renderWorklist({ currentId: 'a1', onNavigate });
    const prev = screen.getByRole('button', { name: 'articlePrevious' });
    // `aria-disabled`, not the native `disabled` attribute: the button stays
    // in the tab order (a real `disabled` button cannot receive focus, which
    // is exactly what strands keyboard focus on `<body>` when the arrow
    // becomes disabled right under the click that landed on it).
    expect(prev).toHaveAttribute('aria-disabled', 'true');
    expect(prev).not.toBeDisabled();
    prev.focus();
    expect(prev).toHaveFocus();
    expect(screen.getByRole('button', { name: 'articleNext' })).not.toHaveAttribute('aria-disabled');
    expect(screen.getAllByRole('button')).toHaveLength(2);
    // Guarded click: still wired to a handler, but it must not navigate.
    await userEvent.click(prev);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('marks next aria-disabled at the last article without removing or unfocusing it', async () => {
    const onNavigate = vi.fn();
    renderWorklist({ currentId: 'a3', onNavigate });
    const next = screen.getByRole('button', { name: 'articleNext' });
    expect(next).toHaveAttribute('aria-disabled', 'true');
    expect(next).not.toBeDisabled();
    next.focus();
    expect(next).toHaveFocus();
    expect(screen.getByRole('button', { name: 'articlePrevious' })).not.toHaveAttribute('aria-disabled');
    expect(screen.getAllByRole('button')).toHaveLength(2);
    await userEvent.click(next);
    expect(onNavigate).not.toHaveBeenCalled();
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
