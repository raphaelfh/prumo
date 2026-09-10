/**
 * ArticleSidePanel must remount ArticleForm's identity (not just its props)
 * whenever the article being edited changes, or the form's own state (its
 * title field, its dirty baseline, its staged files) leaks from one article
 * to the next. ArticleForm has no effect that resets on articleId/mode
 * changing — the reset has to come from a `key` at the call site.
 *
 * This spec deliberately renders the REAL ArticleForm (unlike
 * ArticleSidePanel.test.tsx, which stubs it) — a mocked form can't prove
 * whether its internal state survived a swap.
 */
import {render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.hoisted(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-anon-key');
});

vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn(), warning: vi.fn()}}));
vi.mock('@/contexts/AuthContext', () => ({
    useAuth: () => ({user: {id: 'u1'}, session: null, loading: false, signOut: vi.fn()}),
}));
vi.mock('@/services/articlesService', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/services/articlesService')>()),
    fetchArticle: vi.fn(),
    fetchArticleFiles: vi.fn(),
    insertArticle: vi.fn(),
    updateArticle: vi.fn(),
    downloadFileBlob: vi.fn(),
    deleteArticleFile: vi.fn(),
    fetchMainFileInfo: vi.fn(),
    uploadArticleFile: vi.fn(),
}));
vi.mock('@/components/runs/RunPdfContent', () => ({
    RunPdfContent: () => <div data-testid="run-pdf-content"/>,
}));
vi.mock('@/components/articles/ArticleFileUploadDialogNew', () => ({
    ArticleFileUploadDialogNew: () => null,
}));

const documentsMock = vi.fn();
vi.mock('@/hooks/extraction/useArticleDocuments', () => ({
    useArticleDocuments: (id: string | null | undefined) => documentsMock(id),
}));

import {ArticleSidePanel} from '@/components/articles/ArticleSidePanel';
import {fetchArticle, fetchArticleFiles} from '@/services/articlesService';

const baseProps = {
    projectId: 'p1',
    view: 'details' as const,
    onViewChange: vi.fn(),
    onCollapse: vi.fn(),
    onDismiss: vi.fn(),
    onComplete: vi.fn(),
};

beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    documentsMock.mockReturnValue({files: [], filesLoading: false});
    vi.mocked(fetchArticleFiles).mockResolvedValue({ok: true, data: []} as never);
});

function mockArticle(id: string, title: string) {
    vi.mocked(fetchArticle).mockImplementation(async (requestedId: string) => {
        if (requestedId !== id) {
            throw new Error(`unexpected fetchArticle(${requestedId}), test only stubbed ${id}`);
        }
        return {ok: true, data: {id, title, abstract: null, authors: null}} as never;
    });
}

describe('ArticleSidePanel article identity', () => {
    it('resets the form when swapping from one article to another', async () => {
        mockArticle('art-a', 'Article A title');
        const {rerender} = render(
            <MemoryRouter>
                <ArticleSidePanel {...baseProps} mode="edit" articleId="art-a"/>
            </MemoryRouter>,
        );

        // Precondition: article A's title is actually in the field.
        await screen.findByText('Article A title');

        mockArticle('art-b', 'Article B title');
        rerender(
            <MemoryRouter>
                <ArticleSidePanel {...baseProps} mode="edit" articleId="art-b"/>
            </MemoryRouter>,
        );

        await screen.findByText('Article B title');
        expect(screen.queryByText('Article A title')).not.toBeInTheDocument();
    });

    it('clears the title field when switching from editing an article to adding one', async () => {
        mockArticle('art-a', 'Article A title');
        const {rerender} = render(
            <MemoryRouter>
                <ArticleSidePanel {...baseProps} mode="edit" articleId="art-a"/>
            </MemoryRouter>,
        );

        // Precondition: article A's title is actually loaded before the swap.
        await screen.findByText('Article A title');

        rerender(
            <MemoryRouter>
                <ArticleSidePanel {...baseProps} mode="add" articleId={undefined}/>
            </MemoryRouter>,
        );

        // The duplicate-insert path: without the key, formData still holds
        // article A and the title field would still show it.
        await waitFor(() => {
            expect(screen.queryByText('Article A title')).not.toBeInTheDocument();
        });
        // Title is a Zotero-style row: an empty value reads as the row's
        // placeholder text, not an empty input value.
        const title = screen.getByLabelText(/titleRequired/);
        expect(title).toHaveTextContent('fieldRowEmptyPlaceholder');
    });
});
