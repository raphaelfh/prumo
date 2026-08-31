/**
 * Creating an article with a PDF used to take seven interactions: the files
 * picker was disabled until the row existed, so the user had to create, hunt for
 * the new row in the list, reopen it, and only then attach. These pin the
 * four-interaction flow — add, title, attach, Create — and, more importantly,
 * the three ways it can fail.
 *
 * Two traps shaped these tests:
 *
 * 1. The shared MSW server answers every PostgREST POST with a constant
 *    `{id: 'mock-id'}`, so asserting against a single fixed id proves nothing —
 *    a hardcoded literal in the component would satisfy it. Every case that
 *    cares about identity runs twice with different ids, and checks the storage
 *    key as a second, independently-derived witness.
 * 2. A negative assertion (`upload was not called`) passes just as well when the
 *    file never got staged or the click missed. Each negative is preceded by
 *    proof that the file WAS staged and the create path DID run.
 */

import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter} from 'react-router';
import {beforeEach, describe, expect, it, vi} from 'vitest';

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
import {
    fetchArticleFiles,
    insertArticle,
    updateArticle,
    uploadArticleFile,
} from '@/services/articlesService';

const PDF = () => new File(['%PDF'], 'paper.pdf', {type: 'application/pdf'});

beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    vi.mocked(fetchArticleFiles).mockResolvedValue({ok: true, data: []} as never);
    vi.mocked(uploadArticleFile).mockResolvedValue({ok: true, data: undefined} as never);
    // A retry after a partial failure saves the field values too, so it takes
    // the update path rather than inserting a second row.
    vi.mocked(updateArticle).mockResolvedValue({ok: true, data: undefined} as never);
});

/** Renders add mode, types a title, and stages one PDF through the picker. */
async function stageOnePdf(onDismiss = vi.fn(), onComplete = vi.fn()) {
    const user = userEvent.setup();
    render(
        <MemoryRouter>
            <ArticleForm
                mode="add"
                projectId="proj-SENTINEL"
                variant="panel"
                onDismiss={onDismiss}
                onComplete={onComplete}
            />
        </MemoryRouter>,
    );

    await user.type(screen.getByLabelText(/titleRequired/), 'A staged study');
    await user.click(screen.getByRole('button', {name: /addFiles/}));
    await user.upload(await screen.findByLabelText(/uploadSelectFiles/), PDF());
    await user.click(screen.getByRole('button', {name: /attachToArticle/}));

    // Arrival proof: the file is staged and visible BEFORE anything is created.
    expect(await screen.findByText('paper.pdf')).toBeInTheDocument();
    expect(insertArticle).not.toHaveBeenCalled();
    expect(uploadArticleFile).not.toHaveBeenCalled();

    return {user, onDismiss, onComplete};
}

describe('ArticleForm — staged files', () => {
    // Two ids, because one fixed id can be satisfied by a hardcoded constant.
    it.each(['srv-9f3a', 'srv-4b71'])(
        'uploads staged files against the id the server returned (%s)',
        async (newId) => {
            vi.mocked(insertArticle).mockResolvedValue({ok: true, data: {id: newId}} as never);
            const {user, onComplete, onDismiss} = await stageOnePdf();

            await user.click(screen.getByRole('button', {name: /createArticle/}));

            await waitFor(() => expect(uploadArticleFile).toHaveBeenCalledTimes(1));
            expect(uploadArticleFile).toHaveBeenCalledWith(
                expect.objectContaining({articleId: newId, projectId: 'proj-SENTINEL'}),
            );
            // Second witness, derived through generateStorageKey rather than the
            // call argument: an implementation that threads the new id into the
            // upload but a stale one into the key cannot stay green.
            const {storageKey} = vi.mocked(uploadArticleFile).mock.calls[0][0];
            expect(storageKey).toContain(newId);

            // Everything succeeded, so the sheet closes — that is the whole
            // point of the four-interaction flow.
            await waitFor(() => expect(onComplete).toHaveBeenCalled());
            expect(onDismiss).toHaveBeenCalled();
        },
    );

    it('keeps the sheet open on the created article when an upload fails', async () => {
        vi.mocked(insertArticle).mockResolvedValue({ok: true, data: {id: 'srv-partial'}} as never);
        vi.mocked(uploadArticleFile).mockResolvedValue({
            ok: false,
            error: {message: 'storage unavailable'},
        } as never);
        const {user, onDismiss} = await stageOnePdf();

        await user.click(screen.getByRole('button', {name: /createArticle/}));

        await waitFor(() => expect(uploadArticleFile).toHaveBeenCalledTimes(1));
        // The article persisted, so the sheet must not close — the staged File
        // objects only exist in this tree and cannot be re-fetched.
        expect(onDismiss).not.toHaveBeenCalled();
        expect(screen.getByText('paper.pdf')).toBeInTheDocument();
        expect(await screen.findByText(/stagedUploadFailed/)).toBeInTheDocument();

        // Retrying must not create a second article.
        await user.click(screen.getByRole('button', {name: /createArticle/}));
        await waitFor(() => expect(uploadArticleFile).toHaveBeenCalledTimes(2));
        expect(insertArticle).toHaveBeenCalledTimes(1);
        expect(vi.mocked(uploadArticleFile).mock.calls[1][0]).toEqual(
            expect.objectContaining({articleId: 'srv-partial'}),
        );
    });

    it('attempts no upload when the article could not be created', async () => {
        vi.mocked(insertArticle).mockResolvedValue({
            ok: false,
            error: {message: 'row-level security'},
        } as never);
        const {user, onDismiss} = await stageOnePdf();

        await user.click(screen.getByRole('button', {name: /createArticle/}));

        // The create path really ran and really failed — without this the
        // negative below would pass for the wrong reason.
        await waitFor(() => expect(insertArticle).toHaveBeenCalledTimes(1));
        expect(uploadArticleFile).not.toHaveBeenCalled();
        // The staged file survives so the user can fix the title and retry
        // without re-picking it.
        expect(screen.getByText('paper.pdf')).toBeInTheDocument();
        expect(onDismiss).not.toHaveBeenCalled();
        // And the form is usable again, not stuck behind a spent saving flag.
        expect(screen.getByRole('button', {name: /createArticle/})).toBeEnabled();
    });

    // Two roles, two independent bugs. Staging never reaches handleUpload's
    // `mainFiles.length > 1` guard, so whatever addFiles decides is what the
    // backend gets.
    it('assigns MAIN to only the first of two files picked together', async () => {
        const user = userEvent.setup();
        render(
            <MemoryRouter>
                <ArticleForm mode="add" projectId="proj-1" variant="panel" onDismiss={vi.fn()}/>
            </MemoryRouter>,
        );
        await user.click(screen.getByRole('button', {name: /addFiles/}));
        await user.upload(await screen.findByLabelText(/uploadSelectFiles/), [
            new File(['%PDF'], 'main.pdf', {type: 'application/pdf'}),
            new File(['%PDF'], 'appendix.pdf', {type: 'application/pdf'}),
        ]);
        await user.click(screen.getByRole('button', {name: /attachToArticle/}));

        expect(await screen.findByText('main.pdf')).toBeInTheDocument();
        expect(screen.getByText('MAIN')).toBeInTheDocument();
        expect(screen.getByText('SUPPLEMENT')).toBeInTheDocument();
    });

    it('assigns MAIN to only the first of two files picked separately', async () => {
        const user = userEvent.setup();
        render(
            <MemoryRouter>
                <ArticleForm mode="add" projectId="proj-1" variant="panel" onDismiss={vi.fn()}/>
            </MemoryRouter>,
        );

        // There is no article row, so fetchMainFileInfo cannot report an
        // existing MAIN — the second pick has to notice the first one itself.
        for (const name of ['main.pdf', 'appendix.pdf']) {
            await user.click(screen.getByRole('button', {name: /addFiles/}));
            await user.upload(
                await screen.findByLabelText(/uploadSelectFiles/),
                new File(['%PDF'], name, {type: 'application/pdf'}),
            );
            await user.click(screen.getByRole('button', {name: /attachToArticle/}));
            expect(await screen.findByText(name)).toBeInTheDocument();
        }

        expect(screen.getByText('MAIN')).toBeInTheDocument();
        expect(screen.getByText('SUPPLEMENT')).toBeInTheDocument();
    });
});
