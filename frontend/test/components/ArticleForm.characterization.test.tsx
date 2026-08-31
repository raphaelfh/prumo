/**
 * Characterization tests for ``ArticleForm``.
 *
 * Written BEFORE the files-card extraction and deliberately phrased against
 * what the user sees, never against where the JSX lives — so they pass
 * unchanged after the move and are what makes the move verifiable at all.
 * Before this file the component had no test of any kind, so "a pure move
 * verified by the existing suite staying green" would have been verification
 * by an empty set.
 *
 * The service module is mocked PARTIALLY (importOriginal): ArticleForm reaches
 * five of its exports and the upload dialog a sixth, and a whole-module factory
 * would leave the rest undefined, crash the tree into the ErrorBoundary, and
 * leave assertions passing against a rendered error card.
 */

import {render, screen, waitFor, within} from '@testing-library/react';
import {MemoryRouter} from 'react-router';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/lib/copy', () => ({
    t: (_ns: string, key: string) => key,
}));

vi.mock('sonner', () => ({
    toast: {success: vi.fn(), error: vi.fn(), warning: vi.fn()},
}));

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
    deleteArticleFile,
    fetchArticle,
    fetchArticleFiles,
} from '@/services/articlesService';

// ArticleForm calls useNavigate() for the page-variant back button.
function renderForm(ui: React.ReactElement) {
    return render(<MemoryRouter>{ui}</MemoryRouter>);
}

const ARTICLE = {
    id: 'art-1',
    title: 'A stored-markdown study',
    abstract: null,
    authors: null,
};

const MAIN_FILE = {
    id: 'file-1',
    file_type: 'application/pdf',
    file_role: 'MAIN',
    storage_key: 'proj-1/art-1/paper.pdf',
    original_filename: 'paper.pdf',
    bytes: 2 * 1024 * 1024,
};

beforeEach(() => {
    vi.clearAllMocks();
    // jsdom implements no layout; the step rail scrolls on click.
    Element.prototype.scrollIntoView = vi.fn();
    vi.mocked(fetchArticle).mockResolvedValue({ok: true, data: ARTICLE} as never);
    vi.mocked(fetchArticleFiles).mockResolvedValue({ok: true, data: [MAIN_FILE]} as never);
});

describe('ArticleForm — add mode', () => {
    it('renders the whole step rail and the required title field', async () => {
        renderForm(<ArticleForm mode="add" projectId="proj-1" variant="panel" onDismiss={vi.fn()}/>);

        const rail = await screen.findByRole('navigation', {name: 'formStepsAria'});
        for (const step of ['basicInfo', 'publication', 'identifiersLabel', 'additionalInfo', 'filesLabel']) {
            expect(within(rail).getByRole('button', {name: new RegExp(step)})).toBeInTheDocument();
        }
        expect(screen.getByLabelText(/titleRequired/)).toBeInTheDocument();
    });

    it('does not load an article or its files when there is no id yet', async () => {
        renderForm(<ArticleForm mode="add" projectId="proj-1" variant="panel" onDismiss={vi.fn()}/>);

        await screen.findByRole('navigation', {name: 'formStepsAria'});
        expect(fetchArticle).not.toHaveBeenCalled();
        expect(fetchArticleFiles).not.toHaveBeenCalled();
    });
});

describe('ArticleForm — edit mode', () => {
    it('lists each stored file with its role and size', async () => {
        renderForm(
            <ArticleForm mode="edit" projectId="proj-1" articleId="art-1" variant="panel" onDismiss={vi.fn()}/>,
        );

        expect(await screen.findByText('paper.pdf')).toBeInTheDocument();
        expect(screen.getByText('MAIN')).toBeInTheDocument();
        expect(screen.getByText('2.00 MB')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: /formViewPdf/})).toBeInTheDocument();
        expect(screen.getByRole('button', {name: /formDownloadPdf/})).toBeInTheDocument();
    });

    it('deletes a file only after the confirmation is accepted', async () => {
        const user = userEvent.setup();
        vi.mocked(deleteArticleFile).mockResolvedValue({ok: true, data: undefined} as never);
        renderForm(
            <ArticleForm mode="edit" projectId="proj-1" articleId="art-1" variant="panel" onDismiss={vi.fn()}/>,
        );
        await screen.findByText('paper.pdf');

        await user.click(screen.getByRole('button', {name: 'removeFile'}));

        // The dialog is open and nothing has been deleted yet.
        expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
        expect(deleteArticleFile).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', {name: 'remove'}));

        await waitFor(() =>
            expect(deleteArticleFile).toHaveBeenCalledWith('file-1', 'proj-1/art-1/paper.pdf'),
        );
        // The list is reloaded so the row disappears without a full remount.
        await waitFor(() => expect(fetchArticleFiles).toHaveBeenCalledTimes(2));
    });
});
