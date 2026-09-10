/**
 * Swapping the article under a dirty panel must ask first (design spec §8).
 *
 * The stub panel exposes a button that fires onDirtyChange(true), so each test
 * can assert the PRECONDITION — the shell was actually told the form is dirty —
 * before asserting the dialog. Without that, a shell that never wires
 * onDirtyChange would pass "no dialog when clean" and fail nothing.
 */
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/components/articles/ArticleSidePanel', () => ({
    ArticleSidePanel: ({
        articleId,
        onDirtyChange,
        onCollapse,
    }: {
        articleId?: string;
        onDirtyChange?: (d: boolean) => void;
        onCollapse?: () => void;
    }) => (
        <div data-testid="article-side-panel">
            {articleId ?? 'none'}
            <button onClick={() => onDirtyChange?.(true)}>make dirty</button>
            <button onClick={() => onCollapse?.()}>strip collapse</button>
        </div>
    ),
}));
vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));

import {ArticlesSplitShell} from '@/components/articles/ArticlesSplitShell';
import {HeaderActionsProvider, useHeaderActions} from '@/contexts/HeaderActionsContext';

/** Renders whatever the current page filled into the header-actions slot —
 *  stands in for the real Topbar's `{headerActions}`. */
function HeaderActionsOutlet() {
    return <>{useHeaderActions()}</>;
}

/** The header slot's toggle: `t()` is mocked to the raw key, so its
 *  accessible name is the `articles.panelToggle` key. `hidden: true` because
 *  several assertions read it while Radix's alert dialog has marked the rest
 *  of the tree `aria-hidden` — that hides it from the a11y tree, not from the
 *  DOM state this test is actually checking. */
const getToggle = () => screen.getByRole('button', {name: 'panelToggle', hidden: true});

function setDesktop() {
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: (query: string) => ({
            matches: true,
            media: query,
            onchange: null,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => {},
        }),
    });
}

function renderShell(overrides: Partial<Parameters<typeof ArticlesSplitShell>[0]> = {}) {
    const onSelectArticle = vi.fn();
    const props: Parameters<typeof ArticlesSplitShell>[0] = {
        projectId: 'p1',
        mode: 'edit',
        articleId: 'a1',
        view: 'details',
        onViewChange: vi.fn(),
        onSelectArticle,
        onDismiss: vi.fn(),
        onComplete: vi.fn(),
        list: ({onArticleClick}) => (
            <>
                <button onClick={() => onArticleClick('a1')}>row a1</button>
                <button onClick={() => onArticleClick('a2')}>row a2</button>
            </>
        ),
        ...overrides,
    };
    const {rerender} = render(
        <HeaderActionsProvider>
            <ArticlesSplitShell {...props} />
            <HeaderActionsOutlet />
        </HeaderActionsProvider>,
    );
    const rerenderShell = (nextOverrides: Partial<Parameters<typeof ArticlesSplitShell>[0]> = {}) => {
        rerender(
            <HeaderActionsProvider>
                <ArticlesSplitShell {...props} {...nextOverrides} />
                <HeaderActionsOutlet />
            </HeaderActionsProvider>,
        );
    };
    return {onSelectArticle, rerenderShell};
}

beforeEach(() => {
    vi.clearAllMocks();
    setDesktop();
});

describe('ArticlesSplitShell dirty guard', () => {
    it('swaps without asking while the panel is clean', async () => {
        const {onSelectArticle} = renderShell();

        await userEvent.click(screen.getByRole('button', {name: 'row a2'}));

        expect(onSelectArticle).toHaveBeenCalledWith('a2');
        expect(screen.queryByText('panelDiscardTitle')).not.toBeInTheDocument();
    });

    it('asks before swapping when the panel reported dirty', async () => {
        const {onSelectArticle} = renderShell();

        await userEvent.click(screen.getByRole('button', {name: 'make dirty'}));
        await userEvent.click(screen.getByRole('button', {name: 'row a2'}));

        expect(await screen.findByText('panelDiscardTitle')).toBeInTheDocument();
        expect(onSelectArticle).not.toHaveBeenCalled();
    });

    it('keeps the current article when the swap is declined', async () => {
        const {onSelectArticle} = renderShell();

        await userEvent.click(screen.getByRole('button', {name: 'make dirty'}));
        await userEvent.click(screen.getByRole('button', {name: 'row a2'}));
        await userEvent.click(await screen.findByRole('button', {name: 'panelDiscardCancel'}));

        expect(onSelectArticle).not.toHaveBeenCalled();
        expect(screen.getByTestId('article-side-panel')).toHaveTextContent('a1');
    });

    it('swaps when the changes are discarded', async () => {
        const {onSelectArticle} = renderShell();

        await userEvent.click(screen.getByRole('button', {name: 'make dirty'}));
        await userEvent.click(screen.getByRole('button', {name: 'row a2'}));
        await userEvent.click(await screen.findByRole('button', {name: 'panelDiscardConfirm'}));

        expect(onSelectArticle).toHaveBeenCalledWith('a2');
    });

    it('does not ask when the same article is clicked again', async () => {
        const {onSelectArticle} = renderShell();

        await userEvent.click(screen.getByRole('button', {name: 'make dirty'}));
        // Re-clicking the SAME (currently open) row is not a swap and must not nag.
        await userEvent.click(screen.getByRole('button', {name: 'row a1'}));

        expect(screen.queryByText('panelDiscardTitle')).not.toBeInTheDocument();
        // The click still flows through (proving it wasn't just swallowed).
        expect(onSelectArticle).toHaveBeenCalledWith('a1');
    });

    it('asks before collapsing via the strip control when the panel reported dirty', async () => {
        renderShell();

        await userEvent.click(screen.getByRole('button', {name: 'make dirty'}));
        // Precondition: the shell was actually told the form is dirty, or a
        // shell that never wires onDirtyChange would pass this test vacuously.
        expect(screen.getByTestId('article-side-panel')).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', {name: 'strip collapse'}));

        expect(await screen.findByText('panelDiscardTitle')).toBeInTheDocument();
        expect(screen.getByTestId('article-side-panel')).toBeInTheDocument();
        expect(getToggle()).toHaveAttribute('aria-pressed', 'true');
    });

    it('collapses when the collapse is confirmed', async () => {
        renderShell();

        await userEvent.click(screen.getByRole('button', {name: 'make dirty'}));
        await userEvent.click(screen.getByRole('button', {name: 'strip collapse'}));
        await userEvent.click(await screen.findByRole('button', {name: 'panelDiscardConfirm'}));

        expect(screen.queryByTestId('article-side-panel')).not.toBeInTheDocument();
        expect(getToggle()).toHaveAttribute('aria-pressed', 'false');
    });

    it('keeps the panel open when the collapse is declined', async () => {
        renderShell();

        await userEvent.click(screen.getByRole('button', {name: 'make dirty'}));
        await userEvent.click(screen.getByRole('button', {name: 'strip collapse'}));
        await userEvent.click(await screen.findByRole('button', {name: 'panelDiscardCancel'}));

        expect(screen.getByTestId('article-side-panel')).toBeInTheDocument();
        expect(getToggle()).toHaveAttribute('aria-pressed', 'true');
    });

    it('collapses immediately with no dialog while the panel is clean', async () => {
        renderShell();

        await userEvent.click(screen.getByRole('button', {name: 'strip collapse'}));

        expect(screen.queryByText('panelDiscardTitle')).not.toBeInTheDocument();
        expect(screen.queryByTestId('article-side-panel')).not.toBeInTheDocument();
        expect(getToggle()).toHaveAttribute('aria-pressed', 'false');
    });

    it('never guards toggling the panel open', async () => {
        renderShell({mode: null, articleId: null});

        // No selection: the panel starts closed, so there is nothing dirty to lose.
        expect(getToggle()).toHaveAttribute('aria-pressed', 'false');

        await userEvent.click(getToggle());

        expect(screen.queryByText('panelDiscardTitle')).not.toBeInTheDocument();
        expect(getToggle()).toHaveAttribute('aria-pressed', 'true');
    });

    it('resets dirty when the selection clears, so toggling afterward does not nag over an empty panel', async () => {
        const {rerenderShell} = renderShell();

        await userEvent.click(screen.getByRole('button', {name: 'make dirty'}));
        // Precondition: the shell was actually told the form is dirty, or a
        // shell that never wires onDirtyChange (or that already resets it too
        // early) would pass the rest of this test vacuously. Prove it via the
        // existing swap guard, then decline the swap so the article stays put.
        await userEvent.click(screen.getByRole('button', {name: 'row a2'}));
        expect(await screen.findByText('panelDiscardTitle')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', {name: 'panelDiscardCancel'}));
        expect(screen.queryByText('panelDiscardTitle')).not.toBeInTheDocument();

        // Simulate Cancel clearing the URL: ProjectView drops mode/articleId,
        // unmounting ArticleSidePanel and swapping in the placeholder -- while
        // the shell's `dirty` must reset even though nothing explicitly told it
        // to (ArticleSidePanel is gone, so it cannot call onDirtyChange(false)).
        rerenderShell({mode: null, articleId: null});
        expect(screen.queryByTestId('article-side-panel')).not.toBeInTheDocument();

        await userEvent.click(getToggle());

        expect(screen.queryByText('panelDiscardTitle')).not.toBeInTheDocument();
    });
});
