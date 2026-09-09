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

        // aria-disabled, not the `disabled` attribute — see the a11y test below
        // for why: the button must stay focusable to announce the reason.
        expect(screen.getByRole('button', {name: /panelViewDocument/})).toHaveAttribute(
            'aria-disabled',
            'true',
        );
    });

    it('enables the document view once the form reports the created id', async () => {
        render(<ArticleSidePanel {...baseProps} mode="add" view="details"/>);

        // Precondition: it must start disabled, or "becomes enabled" proves nothing.
        expect(screen.getByRole('button', {name: /panelViewDocument/})).toHaveAttribute(
            'aria-disabled',
            'true',
        );

        await userEvent.click(screen.getByRole('button', {name: 'create'}));

        expect(screen.getByRole('button', {name: /panelViewDocument/})).not.toHaveAttribute(
            'aria-disabled',
            'true',
        );
    });

    it('asks the host to change view again after an add (created id enables the toggle)', async () => {
        render(<ArticleSidePanel {...baseProps} mode="add" view="details"/>);
        await userEvent.click(screen.getByRole('button', {name: 'create'}));

        // Renamed from "shows the document for the created id after an add":
        // clicking the (now-enabled) toggle only calls onViewChange — the panel's
        // own view is controlled by the `view` prop, which this test never
        // changes, so it never actually renders RunPdfContent. This assertion is
        // exactly what the click proves; see the next test for the render itself.
        await userEvent.click(screen.getByRole('button', {name: 'panelViewDocument'}));

        expect(baseProps.onViewChange).toHaveBeenCalledWith('document');
    });

    it('renders the document viewer for the created id once the host flips view', async () => {
        const {rerender} = render(<ArticleSidePanel {...baseProps} mode="add" view="details"/>);
        await userEvent.click(screen.getByRole('button', {name: 'create'}));

        // The created id lives in the panel's own state (mode="add" never gets
        // an articleId prop), so re-rendering with view="document" is the only
        // way to prove the panel actually kept it.
        rerender(<ArticleSidePanel {...baseProps} mode="add" view="document"/>);

        expect(screen.getByTestId('run-pdf-content')).toHaveTextContent('new-art-9');
    });

    it('exposes the disabled-toggle reason to assistive tech and ignores clicks on it', async () => {
        const onViewChange = vi.fn();
        render(<ArticleSidePanel {...baseProps} mode="add" view="details" onViewChange={onViewChange}/>);

        const toggle = screen.getByRole('button', {name: /panelViewDocument/});
        expect(toggle).toHaveAttribute('aria-disabled', 'true');
        expect(toggle).not.toHaveAttribute('disabled');

        const describedBy = toggle.getAttribute('aria-describedby');
        expect(describedBy).toBeTruthy();
        expect(document.getElementById(describedBy as string)).toHaveTextContent(
            'panelViewDocumentAfterSave',
        );

        await userEvent.click(toggle);

        expect(onViewChange).not.toHaveBeenCalled();
    });

    it('renders the details body in add mode with no article id, even when view is document', () => {
        render(<ArticleSidePanel {...baseProps} mode="add" view="document"/>);

        // Precondition: the panel actually mounted, so the absence below isn't vacuous.
        expect(screen.getByTestId('article-side-panel')).toBeInTheDocument();

        expect(screen.getByTestId('article-form')).toBeInTheDocument();
        expect(screen.queryByText('panelNoDocumentTitle')).not.toBeInTheDocument();
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
