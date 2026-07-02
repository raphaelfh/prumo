import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AIActions } from '../AIActions';

vi.mock('@/lib/copy', () => ({ t: (_n: string, k: string) => k }));

function renderAI(props: Partial<Parameters<typeof AIActions>[0]>) {
  return render(
    <TooltipProvider>
      <AIActions pendingCount={0} canExtract={false} onExtract={() => {}} {...props} />
    </TooltipProvider>,
  );
}

describe('AIActions menu', () => {
  it('renders nothing with no available action', () => {
    const { container } = renderAI({});
    expect(container.querySelector('button')).toBeNull();
  });
  it('extract action runs from the menu', async () => {
    const onExtract = vi.fn();
    renderAI({ canExtract: true, onExtract });
    await userEvent.click(screen.getByTestId('run-ai-actions'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'extractWithAI' }));
    expect(onExtract).toHaveBeenCalledOnce();
  });
  it('review item shows the count and calls onOpenSuggestions', async () => {
    const onOpenSuggestions = vi.fn();
    renderAI({ pendingCount: 12, onOpenSuggestions });
    const trigger = screen.getByTestId('run-ai-actions');
    expect(trigger).toHaveTextContent('12');
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole('menuitem', { name: /reviewPendingSuggestions/ }));
    expect(onOpenSuggestions).toHaveBeenCalledOnce();
  });
  it('pending count without a real handler renders no review item', async () => {
    renderAI({ canExtract: true, pendingCount: 5, onOpenSuggestions: undefined });
    await userEvent.click(screen.getByTestId('run-ai-actions'));
    expect(await screen.findByRole('menuitem', { name: 'extractWithAI' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /reviewPendingSuggestions/ })).toBeNull();
  });
  it('extracting state disables the extract item', async () => {
    renderAI({ canExtract: true, extracting: true });
    await userEvent.click(screen.getByTestId('run-ai-actions'));
    const item = await screen.findByRole('menuitem', { name: 'extractingWithAI' });
    expect(item).toHaveAttribute('data-disabled');
  });
});
