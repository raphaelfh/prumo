/**
 * Narrow-viewport contract for the article editor's step rail and header.
 *
 * These assert what jsdom can honestly see, and no more. jsdom performs NO
 * layout — `scrollWidth` and `clientWidth` are both 0 on every element, so
 * `scrollWidth <= clientWidth` is vacuously true and would have passed against
 * the unfixed rail. It also does not resolve Tailwind, so `sr-only` and `hidden`
 * are indistinguishable by computed style OR by accessible name; a test written
 * as "the name survives the fold" passes identically on the forbidden `hidden`
 * implementation.
 *
 * What is left that is real: the EMITTED class string (read off className, not
 * via toHaveClass — a cn()/twMerge override that silently lost the merge is a
 * known false-green in this repo), and which nodes exist at all. The actual
 * overflow measurement belongs in a browser and is recorded in the PR.
 */

import {render, screen, within} from '@testing-library/react';
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
import {fetchArticle, fetchArticleFiles} from '@/services/articlesService';

beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    vi.mocked(fetchArticleFiles).mockResolvedValue({ok: true, data: []} as never);
    vi.mocked(fetchArticle).mockResolvedValue({
        ok: true,
        data: {id: 'art-1', title: 'A stored-markdown study', abstract: null, authors: null},
    } as never);
});

function renderAdd() {
    render(
        <MemoryRouter>
            <ArticleForm mode="add" projectId="proj-1" variant="panel" onDismiss={vi.fn()}/>
        </MemoryRouter>,
    );
}

describe('article editor — step rail below lg', () => {
    it('folds every step label to sr-only, never to hidden', async () => {
        renderAdd();
        const rail = await screen.findByRole('navigation', {name: 'formStepsAria'});

        const labels = within(rail)
            .getAllByRole('button')
            .map((b) => b.querySelector('[data-slot="step-label"]'));
        expect(labels).toHaveLength(5);

        for (const label of labels) {
            const emitted = label!.className;
            // The fold itself.
            expect(emitted).toContain('sr-only');
            expect(emitted).toContain('lg:not-sr-only');
            // `hidden` would drop the label out of the accessibility tree and
            // the step would lose its accessible name (.claude/rules/frontend.md).
            expect(emitted).not.toMatch(/(^|\s)hidden(\s|$)/);
        }
    });

    it('keeps each step reachable by its name once folded', async () => {
        renderAdd();
        const rail = await screen.findByRole('navigation', {name: 'formStepsAria'});

        for (const step of ['basicInfo', 'publication', 'identifiersLabel', 'additionalInfo', 'filesLabel']) {
            expect(within(rail).getByRole('button', {name: new RegExp(step)})).toBeInTheDocument();
        }
    });
});

describe('article editor — header identity', () => {
    it('renders the title in add mode and folds only the redundant description', async () => {
        renderAdd();

        expect(await screen.findByText('addArticle')).toBeInTheDocument();
        // addArticleDesc restates the title, so it is what gives way — the
        // title itself must survive at every width.
        expect(screen.queryByText('addArticleDesc')).not.toBeInTheDocument();
    });

    it('keeps the article title in edit mode, where the description is the only identity', async () => {
        render(
            <MemoryRouter>
                <ArticleForm mode="edit" projectId="proj-1" articleId="art-1" variant="panel" onDismiss={vi.fn()}/>
            </MemoryRouter>,
        );

        // Scoped to the header: the title also appears in the title textarea,
        // so an unscoped query would pass even with the header identity gone.
        const header = (await screen.findByText('editArticle')).closest('[data-slot="page-header"]')!;
        // Folding this below sm would leave mobile edit reading "Edit article"
        // with no indication of WHICH article — worse than the bug being fixed.
        expect(within(header as HTMLElement).getByText('A stored-markdown study')).toBeInTheDocument();
    });

    it('folds the Back label but keeps the button named', async () => {
        renderAdd();

        const back = await screen.findByRole('button', {name: 'back'});
        const label = back.querySelector('[data-slot="back-label"]');
        expect(label!.className).toContain('sr-only');
        expect(label!.className).toContain('sm:not-sr-only');
        expect(label!.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    });
});
