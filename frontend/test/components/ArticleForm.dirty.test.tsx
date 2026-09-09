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
import {toast} from 'sonner';

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
                    onDismiss={vi.fn()}
                    onDirtyChange={onDirtyChange}
                />
            </MemoryRouter>,
        );

        await screen.findByText('A stored-markdown study');
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
                    onDismiss={vi.fn()}
                    onDirtyChange={onDirtyChange}
                />
            </MemoryRouter>,
        );

        const titleValue = await screen.findByText('A stored-markdown study');
        // Precondition: it must have been clean, or "becomes dirty" is vacuous.
        await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));

        // Title is a Zotero-style row rendered with control='multiline':
        // click to enter edit state, type, then commit with Ctrl+Enter
        // (plain Enter inserts a newline in a multiline row).
        await userEvent.click(titleValue);
        const input = screen.getByRole('textbox', {name: 'titleRequired'});
        await userEvent.type(input, ' revised');
        await userEvent.keyboard('{Control>}{Enter}{/Control}');

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
                    onDismiss={vi.fn()}
                    onComplete={vi.fn()}
                    onDirtyChange={onDirtyChange}
                />
            </MemoryRouter>,
        );

        const titleValue = await screen.findByText('A stored-markdown study');
        await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));

        await userEvent.click(titleValue);
        const input = screen.getByRole('textbox', {name: 'titleRequired'});
        await userEvent.type(input, ' revised');
        await userEvent.keyboard('{Control>}{Enter}{/Control}');
        // Precondition: it must actually go dirty, or "clean after save" proves nothing.
        await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));

        await userEvent.click(screen.getByRole('button', {name: 'save'}));

        await waitFor(() => expect(updateArticle).toHaveBeenCalled());
        await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
    });

    it('does not report dirty when Escape reverts a row edit', async () => {
        const onDirtyChange = vi.fn();
        render(
            <MemoryRouter>
                <ArticleForm
                    mode="edit"
                    projectId="proj-1"
                    articleId="art-1"
                    onDismiss={vi.fn()}
                    onDirtyChange={onDirtyChange}
                />
            </MemoryRouter>,
        );

        const titleValue = await screen.findByText('A stored-markdown study');
        // Precondition: it must have been clean, or "stays clean" is vacuous.
        await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));

        await userEvent.click(titleValue);
        const input = screen.getByRole('textbox', {name: 'titleRequired'});
        await userEvent.type(input, ' revised{Escape}');

        // Give any dirty-reporting effect a chance to run, then confirm it
        // never fired with true.
        await screen.findByText('A stored-markdown study');
        expect(onDirtyChange).not.toHaveBeenCalledWith(true);
    });

    it('reports clean on a fresh add form', async () => {
        const onDirtyChange = vi.fn();
        render(
            <MemoryRouter>
                <ArticleForm
                    mode="add"
                    projectId="proj-1"
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
                    onDismiss={vi.fn()}
                    onComplete={vi.fn()}
                    onArticleCreated={onArticleCreated}
                />
            </MemoryRouter>,
        );

        // Title starts empty: it is a Zotero-style row, so it reads as its
        // (labelled) read-state control until clicked into edit state.
        const titleReadState = await screen.findByLabelText(/titleRequired/);
        await userEvent.click(titleReadState);
        const titleInput = screen.getByRole('textbox', {name: /titleRequired/});
        await userEvent.type(titleInput, 'A new paper{Enter}');
        await userEvent.click(screen.getByRole('button', {name: /createArticle/}));

        await waitFor(() => {
            expect(onArticleCreated).toHaveBeenCalledWith('new-art-9');
        });
        expect(onArticleCreated).toHaveBeenCalledTimes(1);
    });
});

/**
 * Regression tests for the "click Create twice" bug (browser-verified at
 * 1600px, not a jsdom finding): the Title row only commits its value into
 * `formData` on blur/Enter, and mousedown-before-click fires that blur, so a
 * button disabled on `!formData.title.trim()` is briefly still-disabled at
 * mousedown and only re-enables after the commit lands — a REAL browser never
 * activates that click. `userEvent`'s mouse implementation rechecks `disabled`
 * between its synthetic mousedown and click, so it *does* activate it — which
 * is exactly why the old jsdom suite stayed green while the button was
 * unusable in production. Do not "simplify" the Create/Save button back to a
 * disabled-on-invalid-state gate on the strength of a passing test here: the
 * fix is validate-on-click, not a disabled predicate, and only a real browser
 * (or a human) can prove the disabled-gate version is broken.
 */
describe('ArticleForm create-button gating (no disabled-on-empty-title gate)', () => {
    it('does not disable the Create button when the title is empty', async () => {
        render(
            <MemoryRouter>
                <ArticleForm mode="add" projectId="proj-1" onDismiss={vi.fn()}/>
            </MemoryRouter>,
        );

        const createButton = await screen.findByRole('button', {name: /createArticle/});
        expect(createButton).not.toBeDisabled();
    });

    it('does not create the article and surfaces the error when clicked with an empty title', async () => {
        render(
            <MemoryRouter>
                <ArticleForm mode="add" projectId="proj-1" onDismiss={vi.fn()}/>
            </MemoryRouter>,
        );

        const createButton = await screen.findByRole('button', {name: /createArticle/});
        await userEvent.click(createButton);

        expect(insertArticle).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledWith('titleRequiredToast');
        // The requirement is visible on the Title row itself, not only in a toast.
        expect(await screen.findByText('titleRequiredToast')).toBeInTheDocument();
    });

    it('creates the article when clicked with a valid, committed title', async () => {
        vi.mocked(insertArticle).mockResolvedValue({ok: true, data: {id: 'new-art-1'}} as never);

        render(
            <MemoryRouter>
                <ArticleForm mode="add" projectId="proj-1" onDismiss={vi.fn()}/>
            </MemoryRouter>,
        );

        const titleReadState = await screen.findByLabelText(/titleRequired/);
        await userEvent.click(titleReadState);
        const titleInput = screen.getByRole('textbox', {name: /titleRequired/});
        await userEvent.type(titleInput, 'A committed title');
        await userEvent.keyboard('{Control>}{Enter}{/Control}');

        await userEvent.click(screen.getByRole('button', {name: /createArticle/}));

        await waitFor(() => {
            expect(insertArticle).toHaveBeenCalledTimes(1);
        });
    });
});
