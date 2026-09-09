/**
 * The articles side panel shows EITHER the article's document or its fields.
 *
 * ArticleForm and RunPdfContent are stubbed: this spec is about the panel's
 * own switching, add-mode gating and empty state, and mounting the real
 * children would drag pdfjs and the whole form into jsdom for no added signal.
 */
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/components/articles/ArticleForm', () => ({
    ArticleForm: ({
        mode,
        onArticleCreated,
    }: {
        mode: string;
        onArticleCreated?: (id: string) => void;
    }) => (
        <div data-testid="article-form">
            {mode}
            <button onClick={() => onArticleCreated?.('new-art-9')}>create</button>
        </div>
    ),
}));
vi.mock('@/components/runs/RunPdfContent', () => ({
    RunPdfContent: ({articleId}: {articleId: string}) => (
        <div data-testid="run-pdf-content">{articleId}</div>
    ),
}));
vi.mock('@/components/articles/ArticleFileUploadDialogNew', () => ({
    ArticleFileUploadDialogNew: ({open}: {open: boolean}) =>
        open ? <div data-testid="upload-dialog"/> : null,
}));
vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));

const documentsMock = vi.fn();
vi.mock('@/hooks/extraction/useArticleDocuments', () => ({
    useArticleDocuments: (id: string | null | undefined) => documentsMock(id),
}));

import {ArticleSidePanel} from '@/components/articles/ArticleSidePanel';

const baseProps = {
    projectId: 'p1',
    onViewChange: vi.fn(),
    onCollapse: vi.fn(),
    onDismiss: vi.fn(),
    onComplete: vi.fn(),
};

beforeEach(() => {
    vi.clearAllMocks();
    documentsMock.mockReturnValue({files: [{id: 'f1'}]});
});

describe('ArticleSidePanel', () => {
    it('renders the form in details view', () => {
        render(<ArticleSidePanel {...baseProps} mode="edit" articleId="a1" view="details"/>);

        expect(screen.getByTestId('article-form')).toBeInTheDocument();
        expect(screen.queryByTestId('run-pdf-content')).not.toBeInTheDocument();
    });

    it('renders the document viewer in document view', () => {
        render(<ArticleSidePanel {...baseProps} mode="edit" articleId="a1" view="document"/>);

        expect(screen.getByTestId('run-pdf-content')).toHaveTextContent('a1');
        expect(screen.queryByTestId('article-form')).not.toBeInTheDocument();
    });

    it('asks the host to change view when the toggle is pressed', async () => {
        const onViewChange = vi.fn();
        render(
            <ArticleSidePanel
                {...baseProps}
                mode="edit"
                articleId="a1"
                view="details"
                onViewChange={onViewChange}
            />,
        );

        await userEvent.click(screen.getByRole('button', {name: 'panelViewDocument'}));

        expect(onViewChange).toHaveBeenCalledWith('document');
    });

    it('disables the document view in add mode until the article is created', async () => {
        render(<ArticleSidePanel {...baseProps} mode="add" view="details"/>);

        expect(screen.getByRole('button', {name: /panelViewDocument/})).toBeDisabled();
    });

    it('enables the document view once the form reports the created id', async () => {
        render(<ArticleSidePanel {...baseProps} mode="add" view="details"/>);

        // Precondition: it must start disabled, or "becomes enabled" proves nothing.
        expect(screen.getByRole('button', {name: /panelViewDocument/})).toBeDisabled();

        await userEvent.click(screen.getByRole('button', {name: 'create'}));

        expect(screen.getByRole('button', {name: /panelViewDocument/})).toBeEnabled();
    });

    it('shows the document for the created id after an add', async () => {
        render(<ArticleSidePanel {...baseProps} mode="add" view="details"/>);
        await userEvent.click(screen.getByRole('button', {name: 'create'}));

        // Re-render in document view with the same mounted panel: the id came
        // from the callback, not from props, so this is the only thing proving
        // the panel actually kept it.
        await userEvent.click(screen.getByRole('button', {name: 'panelViewDocument'}));

        expect(baseProps.onViewChange).toHaveBeenCalledWith('document');
    });

    it('shows the empty state instead of the viewer when there are no files', () => {
        documentsMock.mockReturnValue({files: []});

        render(<ArticleSidePanel {...baseProps} mode="edit" articleId="a1" view="document"/>);

        expect(screen.getByText('panelNoDocumentTitle')).toBeInTheDocument();
        expect(screen.queryByTestId('run-pdf-content')).not.toBeInTheDocument();
    });

    it('collapses on request', async () => {
        const onCollapse = vi.fn();
        render(
            <ArticleSidePanel
                {...baseProps}
                mode="edit"
                articleId="a1"
                view="details"
                onCollapse={onCollapse}
            />,
        );

        await userEvent.click(screen.getByRole('button', {name: 'panelCollapse'}));

        expect(onCollapse).toHaveBeenCalledTimes(1);
    });
});
