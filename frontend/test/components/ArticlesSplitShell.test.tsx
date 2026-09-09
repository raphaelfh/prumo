/**
 * The Articles tab's split layout: table left, article panel right.
 *
 * NOTE ON matchMedia: frontend/test/setup.ts stubs it to `matches: false` for
 * every query, so without an override every test here would silently exercise
 * the below-lg Sheet path. setDesktop()/setNarrow() make the choice explicit.
 */
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/components/articles/ArticleSidePanel', () => ({
    ArticleSidePanel: ({articleId, view}: {articleId?: string; view: string}) => (
        <div data-testid="article-side-panel">{`${articleId ?? 'none'}:${view}`}</div>
    ),
}));
vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));

import {ArticlesSplitShell} from '@/components/articles/ArticlesSplitShell';

function setMatches(matches: boolean) {
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: (query: string) => ({
            matches,
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

/** (min-width: 1024px) matches ⇒ desktop ⇒ docked split. */
const setDesktop = () => setMatches(true);
const setNarrow = () => setMatches(false);

const baseProps = {
    projectId: 'p1',
    view: 'details' as const,
    onViewChange: vi.fn(),
    onSelectArticle: vi.fn(),
    onDismiss: vi.fn(),
    onComplete: vi.fn(),
};

function renderShell(overrides: Partial<Parameters<typeof ArticlesSplitShell>[0]> = {}) {
    const onSelectArticle = vi.fn();
    const utils = render(
        <ArticlesSplitShell
            {...baseProps}
            mode={null}
            articleId={null}
            onSelectArticle={onSelectArticle}
            list={({onArticleClick, panelOpen, onTogglePanel}) => (
                <div>
                    <button onClick={() => onArticleClick('a1')}>row a1</button>
                    <button onClick={() => onArticleClick('a2')}>row a2</button>
                    <button onClick={onTogglePanel}>toggle</button>
                    <span data-testid="panel-open">{String(panelOpen)}</span>
                </div>
            )}
            {...overrides}
        />,
    );
    return {onSelectArticle, ...utils};
}

beforeEach(() => {
    vi.clearAllMocks();
    setDesktop();
});

describe('ArticlesSplitShell', () => {
    it('starts with the panel closed when the URL carries no selection', () => {
        renderShell();

        expect(screen.getByTestId('panel-open')).toHaveTextContent('false');
        expect(screen.queryByTestId('article-side-panel')).not.toBeInTheDocument();
    });

    it('starts open when the URL already carries a selection', () => {
        renderShell({mode: 'edit', articleId: 'a1'});

        expect(screen.getByTestId('article-side-panel')).toHaveTextContent('a1:details');
    });

    it('opens the panel and reports the selection on a row click', async () => {
        const {onSelectArticle} = renderShell();

        await userEvent.click(screen.getByRole('button', {name: 'row a1'}));

        expect(onSelectArticle).toHaveBeenCalledWith('a1');
        expect(screen.getByTestId('panel-open')).toHaveTextContent('true');
    });

    it('collapses and re-expands from the list toggle without losing the selection', async () => {
        renderShell({mode: 'edit', articleId: 'a1'});

        await userEvent.click(screen.getByRole('button', {name: 'toggle'}));
        expect(screen.queryByTestId('article-side-panel')).not.toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', {name: 'toggle'}));
        expect(screen.getByTestId('article-side-panel')).toHaveTextContent('a1:details');
    });

    it('shows the placeholder when open with no selection', async () => {
        renderShell();

        await userEvent.click(screen.getByRole('button', {name: 'toggle'}));

        expect(screen.getByText('panelPlaceholderTitle')).toBeInTheDocument();
        expect(screen.queryByTestId('article-side-panel')).not.toBeInTheDocument();
    });

    it('docks the panel beside the list above lg', () => {
        renderShell({mode: 'edit', articleId: 'a1'});

        expect(document.querySelector('[data-testid="articles-shell-panel"]')).not.toBeNull();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('falls back to the overlay sheet below lg', () => {
        setNarrow();
        renderShell({mode: 'edit', articleId: 'a1'});

        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(document.querySelector('[data-testid="articles-shell-panel"]')).toBeNull();
    });

    // Controller ruling: `panelOpen` must react to hasSelection transitioning
    // false -> true even when no row click ever fires (e.g. "Add article"
    // routes straight to mode=add via the URL, bypassing onArticleClick).
    it('opens the panel when a selection appears via props, without a row click', () => {
        const {rerender} = renderShell({mode: null, articleId: null});

        expect(screen.queryByTestId('article-side-panel')).not.toBeInTheDocument();

        rerender(
            <ArticlesSplitShell
                {...baseProps}
                mode="edit"
                articleId="a1"
                onSelectArticle={vi.fn()}
                list={({onArticleClick, panelOpen, onTogglePanel}) => (
                    <div>
                        <button onClick={() => onArticleClick('a1')}>row a1</button>
                        <button onClick={onTogglePanel}>toggle</button>
                        <span data-testid="panel-open">{String(panelOpen)}</span>
                    </div>
                )}
            />,
        );

        expect(screen.getByTestId('article-side-panel')).toHaveTextContent('a1:details');
    });

    it('does not re-open a panel the user just collapsed while the selection is unchanged', async () => {
        const {rerender} = renderShell({mode: 'edit', articleId: 'a1'});

        await userEvent.click(screen.getByRole('button', {name: 'toggle'}));
        expect(screen.queryByTestId('article-side-panel')).not.toBeInTheDocument();

        // Re-render with the SAME selection (no false->true transition): an
        // unconditional "open when hasSelection" effect would re-open here,
        // clobbering the collapse the user just performed.
        rerender(
            <ArticlesSplitShell
                {...baseProps}
                mode="edit"
                articleId="a1"
                onSelectArticle={vi.fn()}
                list={({onArticleClick, panelOpen, onTogglePanel}) => (
                    <div>
                        <button onClick={() => onArticleClick('a1')}>row a1</button>
                        <button onClick={onTogglePanel}>toggle</button>
                        <span data-testid="panel-open">{String(panelOpen)}</span>
                    </div>
                )}
            />,
        );

        expect(screen.queryByTestId('article-side-panel')).not.toBeInTheDocument();
    });
});
