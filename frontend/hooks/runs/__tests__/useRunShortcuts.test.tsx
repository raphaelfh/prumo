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
    ...props,
  });
  return <input data-testid="field" />;
}

// jsdom's userAgent is not a Mac, so `mod` is Control here — the key
// useKeyboardShortcuts binds on that platform.
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

  it.each(['Alt', 'Control', 'Meta'])('ignores J/K when %s is held', async (modifier) => {
    const onNavigateToArticle = vi.fn();
    render(<Harness onNavigateToArticle={onNavigateToArticle} />);
    await userEvent.keyboard(`{${modifier}>}j{/${modifier}}`);
    expect(onNavigateToArticle).not.toHaveBeenCalled();
  });

  it('ignores J/K while a dialog or popover is open', async () => {
    const onNavigateToArticle = vi.fn();
    render(
      <>
        <Harness onNavigateToArticle={onNavigateToArticle} />
        <div role="dialog" data-state="open" />
      </>,
    );
    await userEvent.keyboard('jk');
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

  it('mod+K toggles the palette and Escape closes it', async () => {
    const onTogglePalette = vi.fn();
    const onClosePalette = vi.fn();
    render(<Harness onTogglePalette={onTogglePalette} onClosePalette={onClosePalette} />);
    await userEvent.keyboard('{Control>}k{/Control}');
    expect(onTogglePalette).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Escape}');
    expect(onClosePalette).toHaveBeenCalledTimes(1);
  });

  it('leaves mod+K to a field the user is typing in', async () => {
    const onTogglePalette = vi.fn();
    const { getByTestId } = render(<Harness onTogglePalette={onTogglePalette} />);
    (getByTestId('field') as HTMLInputElement).focus();
    await userEvent.keyboard('{Control>}k{/Control}');
    expect(onTogglePalette).not.toHaveBeenCalled();
  });

  // The palette is itself a dialog, so its own toggle and Escape must get past
  // the guard that swallows J/K.
  it('mod+K and Escape still reach the palette while a dialog is open', async () => {
    const onTogglePalette = vi.fn();
    const onClosePalette = vi.fn();
    render(
      <>
        <Harness onTogglePalette={onTogglePalette} onClosePalette={onClosePalette} />
        <div role="dialog" data-state="open" />
      </>,
    );
    await userEvent.keyboard('{Control>}k{/Control}');
    await userEvent.keyboard('{Escape}');
    expect(onTogglePalette).toHaveBeenCalledTimes(1);
    expect(onClosePalette).toHaveBeenCalledTimes(1);
  });
});
