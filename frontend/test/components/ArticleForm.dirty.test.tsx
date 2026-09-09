/**
 * ArticleForm reports whether it holds unsaved edits, so the articles side
 * panel can guard a row swap (see the side-panel design spec §8).
 *
 * The fingerprint deliberately compares authorsFromRows(), not the rows
 * themselves: AuthorFormRow.id is a uuidv4, so an object compare would report
 * dirty forever and the guard would fire on every single row click.
 */
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

import {ArticleForm} from '@/components/articles/ArticleForm';
import {fetchArticle, fetchArticleFiles, insertArticle, updateArticle} from '@/services/articlesService';

beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    vi.mocked(fetchArticleFiles).mockResolvedValue({ok: true, data: []} as never);
    vi.mocked(fetchArticle).mockResolvedValue({
        ok: true,
        data: {
            id: 'art-1',
            title: 'A stored-markdown study',
            abstract: null,
            authors: ['Doe, Jane'],
        },
    } as never);
});

describe('ArticleForm dirty reporting', () => {
    it('reports clean after the article loads', async () => {
        const onDirtyChange = vi.fn();
        render(
            <MemoryRouter>
                <ArticleForm
                    mode="edit"
                    projectId="proj-1"
                    articleId="art-1"
                    variant="panel"
                    onDismiss={vi.fn()}
                    onDirtyChange={onDirtyChange}
                />
            </MemoryRouter>,
        );

        await screen.findByDisplayValue('A stored-markdown study');
        // The uuid trap: rowsFromAuthorsArray mints fresh ids on load, so a
        // row-object compare would already be reporting dirty here.
        await waitFor(() => {
            expect(onDirtyChange).toHaveBeenLastCalledWith(false);
        });
    });

    it('reports dirty after a field edit', async () => {
        const onDirtyChange = vi.fn();
        render(
            <MemoryRouter>
                <ArticleForm
                    mode="edit"
                    projectId="proj-1"
                    articleId="art-1"
                    variant="panel"
                    onDismiss={vi.fn()}
                    onDirtyChange={onDirtyChange}
                />
            </MemoryRouter>,
        );

        const title = await screen.findByDisplayValue('A stored-markdown study');
        // Precondition: it must have been clean, or "becomes dirty" is vacuous.
        await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));

        await userEvent.type(title, ' revised');

        await waitFor(() => {
            expect(onDirtyChange).toHaveBeenLastCalledWith(true);
        });
    });

    it('reports clean again after a successful edit-mode save', async () => {
        vi.mocked(updateArticle).mockResolvedValue({ok: true, data: {id: 'art-1'}} as never);
        const onDirtyChange = vi.fn();
        render(
            <MemoryRouter>
                <ArticleForm
                    mode="edit"
                    projectId="proj-1"
                    articleId="art-1"
                    variant="panel"
                    onDismiss={vi.fn()}
                    onComplete={vi.fn()}
                    onDirtyChange={onDirtyChange}
                />
            </MemoryRouter>,
        );

        const title = await screen.findByDisplayValue('A stored-markdown study');
        await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));

        await userEvent.type(title, ' revised');
        // Precondition: it must actually go dirty, or "clean after save" proves nothing.
        await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));

        await userEvent.click(screen.getByRole('button', {name: 'save'}));

        await waitFor(() => expect(updateArticle).toHaveBeenCalled());
        await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
    });

    it('reports clean on a fresh add form', async () => {
        const onDirtyChange = vi.fn();
        render(
            <MemoryRouter>
                <ArticleForm
                    mode="add"
                    projectId="proj-1"
                    variant="panel"
                    onDismiss={vi.fn()}
                    onDirtyChange={onDirtyChange}
                />
            </MemoryRouter>,
        );

        await waitFor(() => {
            expect(onDirtyChange).toHaveBeenLastCalledWith(false);
        });
    });
});

describe('ArticleForm create reporting', () => {
    it('reports the new id after an add-mode save', async () => {
        vi.mocked(insertArticle).mockResolvedValue({
            ok: true,
            data: {id: 'new-art-9'},
        } as never);

        const onArticleCreated = vi.fn();
        render(
            <MemoryRouter>
                <ArticleForm
                    mode="add"
                    projectId="proj-1"
                    variant="panel"
                    onDismiss={vi.fn()}
                    onComplete={vi.fn()}
                    onArticleCreated={onArticleCreated}
                />
            </MemoryRouter>,
        );

        await userEvent.type(await screen.findByLabelText(/titleRequired/), 'A new paper');
        await userEvent.click(screen.getByRole('button', {name: /createArticle/}));

        await waitFor(() => {
            expect(onArticleCreated).toHaveBeenCalledWith('new-art-9');
        });
        expect(onArticleCreated).toHaveBeenCalledTimes(1);
    });
});
