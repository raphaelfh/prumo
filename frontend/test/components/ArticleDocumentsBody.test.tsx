/** The documents body shared by the Articles panel and the full-text panel. */
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));
vi.mock('@/components/articles/ArticleFileUploadDialogNew', () => ({
    ArticleFileUploadDialogNew: ({open}: {open: boolean}) =>
        open ? <div data-testid="upload-dialog"/> : null,
}));

const documentsMock = vi.fn();
vi.mock('@/hooks/extraction/useArticleDocuments', () => ({
    useArticleDocuments: (id: string | null | undefined) => documentsMock(id),
}));

import {ArticleDocumentsBody} from '@/components/articles/ArticleDocumentsBody';

const MAIN = {id: 'f1', fileRole: 'MAIN'};
const SUPP = {id: 'f2', fileRole: 'SUPPLEMENT'};

function setHook(over: Record<string, unknown> = {}) {
    documentsMock.mockReturnValue({
        files: [],
        filesLoading: false,
        filesError: false,
        refetchFiles: vi.fn(),
        ...over,
    });
}

function renderBody(props: {canAttach?: boolean; mainOnly?: boolean} = {}) {
    return render(
        <ArticleDocumentsBody projectId="p1" articleId="a1" canAttach={props.canAttach ?? true} mainOnly={props.mainOnly}>
            {(files) => <div data-testid="children">{files.map((f) => f.id).join(',')}</div>}
        </ArticleDocumentsBody>,
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    setHook();
});

describe('ArticleDocumentsBody', () => {
    it('shows the loading spinner while files load', () => {
        setHook({filesLoading: true});
        renderBody();
        expect(screen.getByText('panelDocumentLoading')).toBeInTheDocument();
        expect(screen.queryByTestId('children')).not.toBeInTheDocument();
    });

    it('shows an error with retry when the files read fails', async () => {
        const refetchFiles = vi.fn();
        setHook({filesError: true, refetchFiles});
        renderBody();

        expect(screen.queryByText('panelNoDocumentTitle')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', {name: 'panelAddFile'})).not.toBeInTheDocument();
        await userEvent.setup().click(screen.getByRole('button', {name: /errorTryAgain/}));
        expect(refetchFiles).toHaveBeenCalledTimes(1);
    });

    it('shows the empty state with Attach when canAttach', async () => {
        renderBody({canAttach: true});
        expect(screen.getByText('panelNoDocumentTitle')).toBeInTheDocument();
        await userEvent.setup().click(screen.getByRole('button', {name: 'panelAddFile'}));
        expect(screen.getByTestId('upload-dialog')).toBeInTheDocument();
    });

    it('hides Attach when not canAttach', () => {
        renderBody({canAttach: false});
        expect(screen.getByText('panelNoDocumentTitle')).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: 'panelAddFile'})).not.toBeInTheDocument();
    });

    it('renders children with the files', () => {
        setHook({files: [MAIN, SUPP]});
        renderBody();
        expect(screen.getByTestId('children')).toHaveTextContent('f1,f2');
    });

    it('mainOnly ignores a supplement-only article', () => {
        setHook({files: [SUPP]});
        renderBody({mainOnly: true});
        expect(screen.queryByTestId('children')).not.toBeInTheDocument();
        expect(screen.getByText('panelNoDocumentTitle')).toBeInTheDocument();
    });

    it('mainOnly passes only MAIN files to children', () => {
        setHook({files: [MAIN, SUPP]});
        renderBody({mainOnly: true});
        expect(screen.getByTestId('children')).toHaveTextContent(/^f1$/);
    });
});
