/**
 * Attaching a file changes `has_pdf` on the screening rows and the article's
 * files list, so both must refetch after the upload (full or partial).
 */
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn(), warning: vi.fn()}}));
vi.mock('@/contexts/AuthContext', () => ({
    useAuth: () => ({user: {id: 'u1'}, session: null, loading: false, signOut: vi.fn()}),
}));
vi.mock('@/services/articlesService', () => ({
    uploadArticleFile: vi.fn(),
    fetchMainFileInfo: vi.fn(),
}));

import {ArticleFileUploadDialogNew} from '@/components/articles/ArticleFileUploadDialogNew';
import {articleKeys} from '@/lib/query-keys';
import {screeningKeys} from '@/lib/query-keys/screening';
import {fetchMainFileInfo, uploadArticleFile} from '@/services/articlesService';
import {createQueryWrapper} from '@/test/helpers/queryClientWrapper';

const PDF = (name: string) => new File(['%PDF'], name, {type: 'application/pdf'});

beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    vi.mocked(fetchMainFileInfo).mockResolvedValue({ok: true, data: null} as never);
});

async function pickAndSubmit(files: File[]) {
    const query = createQueryWrapper();
    const invalidate = vi.spyOn(query.queryClient, 'invalidateQueries');
    const onFileUploaded = vi.fn();
    const user = userEvent.setup();
    render(
        <ArticleFileUploadDialogNew
            open
            onOpenChange={vi.fn()}
            articleId="art-1"
            projectId="proj-1"
            onFileUploaded={onFileUploaded}
        />,
        {wrapper: query.wrapper},
    );
    await user.upload(await screen.findByLabelText(/uploadSelectFiles/), files);
    await user.click(screen.getByRole('button', {name: /uploadSendCount/}));
    return {invalidate, onFileUploaded};
}

describe('ArticleFileUploadDialogNew invalidation', () => {
    it('invalidates the screening family and the article files after an upload', async () => {
        vi.mocked(uploadArticleFile).mockResolvedValue({ok: true, data: undefined} as never);
        const {invalidate, onFileUploaded} = await pickAndSubmit([PDF('a.pdf')]);

        await waitFor(() => expect(onFileUploaded).toHaveBeenCalledTimes(1));
        expect(invalidate).toHaveBeenCalledWith({queryKey: screeningKeys.project('proj-1')});
        expect(invalidate).toHaveBeenCalledWith({queryKey: articleKeys.files('art-1')});
    });

    it('invalidates the screening family and the article files after a partial upload', async () => {
        vi.mocked(uploadArticleFile)
            .mockResolvedValueOnce({ok: true, data: undefined} as never)
            .mockResolvedValueOnce({ok: false, error: {message: 'boom'}} as never);
        const {invalidate, onFileUploaded} = await pickAndSubmit([PDF('a.pdf'), PDF('b.pdf')]);

        await waitFor(() => expect(onFileUploaded).toHaveBeenCalledTimes(1));
        expect(uploadArticleFile).toHaveBeenCalledTimes(2);
        expect(invalidate).toHaveBeenCalledWith({queryKey: screeningKeys.project('proj-1')});
        expect(invalidate).toHaveBeenCalledWith({queryKey: articleKeys.files('art-1')});
    });

    it('invalidates nothing when every upload fails', async () => {
        vi.mocked(uploadArticleFile).mockResolvedValue({ok: false, error: {message: 'boom'}} as never);
        const {invalidate, onFileUploaded} = await pickAndSubmit([PDF('a.pdf')]);

        await waitFor(() => expect(uploadArticleFile).toHaveBeenCalledTimes(1));
        await new Promise((r) => setTimeout(r, 250));
        expect(onFileUploaded).not.toHaveBeenCalled();
        expect(invalidate).not.toHaveBeenCalled();
    });
});
