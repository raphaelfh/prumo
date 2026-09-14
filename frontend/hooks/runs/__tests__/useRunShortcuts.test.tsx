import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRunShortcuts, type RunShortcutHandlers } from '@/hooks/runs/useRunShortcuts';
import { ARTICLE_NEXT_KEY, ARTICLE_PREV_KEY } from '@/lib/runs/shortcuts';

/** user-event treats `[` as a descriptor opener; `[[` types a literal `[`. */
function typeArticleKey(key: typeof ARTICLE_PREV_KEY | typeof ARTICLE_NEXT_KEY) {
  return userEvent.keyboard(key === ARTICLE_PREV_KEY ? '[[' : ARTICLE_NEXT_KEY);
}

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
  it('] navigates to the next article', async () => {
    const onNavigateToArticle = vi.fn();
    render(<Harness onNavigateToArticle={onNavigateToArticle} />);
    await typeArticleKey(ARTICLE_NEXT_KEY);
    expect(onNavigateToArticle).toHaveBeenCalledWith('a3');
  });

  it('[ navigates to the previous article', async () => {
    const onNavigateToArticle = vi.fn();
    render(<Harness onNavigateToArticle={onNavigateToArticle} />);
    await typeArticleKey(ARTICLE_PREV_KEY);
    expect(onNavigateToArticle).toHaveBeenCalledWith('a1');
  });

  it('does not navigate past the ends', async () => {
    const onNavigateToArticle = vi.fn();
    render(<Harness currentArticleId="a1" onNavigateToArticle={onNavigateToArticle} />);
    await typeArticleKey(ARTICLE_PREV_KEY);
    expect(onNavigateToArticle).not.toHaveBeenCalled();
  });

  it('ignores [ / ] while the user is typing in a field', async () => {
    const onNavigateToArticle = vi.fn();
    const { getByTestId } = render(<Harness onNavigateToArticle={onNavigateToArticle} />);
    (getByTestId('field') as HTMLInputElement).focus();
    await typeArticleKey(ARTICLE_NEXT_KEY);
    expect(onNavigateToArticle).not.toHaveBeenCalled();
  });

  it.each(['Alt', 'Control', 'Meta'])('ignores [ / ] when %s is held', async (modifier) => {
    const onNavigateToArticle = vi.fn();
    render(<Harness onNavigateToArticle={onNavigateToArticle} />);
    await userEvent.keyboard(`{${modifier}>}${ARTICLE_NEXT_KEY}{/${modifier}}`);
    expect(onNavigateToArticle).not.toHaveBeenCalled();
  });

  it('ignores [ / ] while a dialog or popover is open', async () => {
    const onNavigateToArticle = vi.fn();
    render(
      <>
        <Harness onNavigateToArticle={onNavigateToArticle} />
        <div role="dialog" data-state="open" />
      </>,
    );
    await typeArticleKey(ARTICLE_PREV_KEY);
    await typeArticleKey(ARTICLE_NEXT_KEY);
    expect(onNavigateToArticle).not.toHaveBeenCalled();
  });

  it('is inert with fewer than two articles', async () => {
    const onNavigateToArticle = vi.fn();
    render(
      <Harness articles={[{ id: 'a1' }]} currentArticleId="a1" onNavigateToArticle={onNavigateToArticle} />,
    );
    await typeArticleKey(ARTICLE_NEXT_KEY);
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
  // the guard that swallows [ / ].
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
