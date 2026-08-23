import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRunShortcuts, type RunShortcutHandlers } from '@/hooks/runs/useRunShortcuts';

const ARTICLES = [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }];

function Harness(props: Partial<RunShortcutHandlers>) {
  useRunShortcuts({
    articles: ARTICLES,
    currentArticleId: 'a2',
    onNavigateToArticle: vi.fn(),
    onTogglePanel: vi.fn(),
    ...props,
  });
  return <input data-testid="field" />;
}

describe('useRunShortcuts', () => {
  it('J navigates to the next article', async () => {
    const onNavigateToArticle = vi.fn();
    render(<Harness onNavigateToArticle={onNavigateToArticle} />);
    await userEvent.keyboard('j');
    expect(onNavigateToArticle).toHaveBeenCalledWith('a3');
  });

  it('K navigates to the previous article', async () => {
    const onNavigateToArticle = vi.fn();
    render(<Harness onNavigateToArticle={onNavigateToArticle} />);
    await userEvent.keyboard('k');
    expect(onNavigateToArticle).toHaveBeenCalledWith('a1');
  });

  it('is case-insensitive', async () => {
    const onNavigateToArticle = vi.fn();
    render(<Harness onNavigateToArticle={onNavigateToArticle} />);
    await userEvent.keyboard('J');
    expect(onNavigateToArticle).toHaveBeenCalledWith('a3');
  });

  it('does not navigate past the ends', async () => {
    const onNavigateToArticle = vi.fn();
    render(<Harness currentArticleId="a1" onNavigateToArticle={onNavigateToArticle} />);
    await userEvent.keyboard('k');
    expect(onNavigateToArticle).not.toHaveBeenCalled();
  });

  it('ignores J/K while the user is typing in a field', async () => {
    const onNavigateToArticle = vi.fn();
    const { getByTestId } = render(<Harness onNavigateToArticle={onNavigateToArticle} />);
    (getByTestId('field') as HTMLInputElement).focus();
    await userEvent.keyboard('j');
    expect(onNavigateToArticle).not.toHaveBeenCalled();
  });

  it('ignores J/K when a modifier is held', async () => {
    const onNavigateToArticle = vi.fn();
    render(<Harness onNavigateToArticle={onNavigateToArticle} />);
    await userEvent.keyboard('{Alt>}j{/Alt}');
    expect(onNavigateToArticle).not.toHaveBeenCalled();
  });

  it('is inert with fewer than two articles', async () => {
    const onNavigateToArticle = vi.fn();
    render(
      <Harness articles={[{ id: 'a1' }]} currentArticleId="a1" onNavigateToArticle={onNavigateToArticle} />,
    );
    await userEvent.keyboard('j');
    expect(onNavigateToArticle).not.toHaveBeenCalled();
  });

  it('backslash toggles the source panel', async () => {
    const onTogglePanel = vi.fn();
    render(<Harness onTogglePanel={onTogglePanel} />);
    await userEvent.keyboard('\\');
    expect(onTogglePanel).toHaveBeenCalledTimes(1);
  });

  it('mod+K toggles the palette and Escape closes it', async () => {
    const onTogglePalette = vi.fn();
    const onClosePalette = vi.fn();
    render(<Harness onTogglePalette={onTogglePalette} onClosePalette={onClosePalette} />);
    await userEvent.keyboard('{Meta>}k{/Meta}');
    expect(onTogglePalette).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Escape}');
    expect(onClosePalette).toHaveBeenCalledTimes(1);
  });
});
