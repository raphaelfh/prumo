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

// ArticleForm's static import graph reaches the Supabase client, which calls
// createClient at module scope and throws without a URL. CI runs vitest with no
// .env, so this stub is what keeps these specs from dying at import — a local
// .env makes the failure invisible until CI. Same guard as legacyArticleRoutes.
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
            // The fold itself. The panel variant is compact, so the fold is
            // unconditional here — no `lg:not-sr-only` escape hatch (see the
            // "compact section rail in the panel" describe block below).
            expect(emitted).toContain('sr-only');
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

describe('article editor — header identity (page variant)', () => {
    function renderPageAdd() {
        render(
            <MemoryRouter>
                <ArticleForm mode="add" projectId="proj-1" variant="page" onDismiss={vi.fn()}/>
            </MemoryRouter>,
        );
    }

    it('renders the title in add mode and folds only the redundant description', async () => {
        renderPageAdd();

        expect(await screen.findByText('addArticle')).toBeInTheDocument();
        // addArticleDesc restates the title, so it is what gives way — the
        // title itself must survive at every width.
        expect(screen.queryByText('addArticleDesc')).not.toBeInTheDocument();
    });

    it('keeps the article title in edit mode, where the description is the only identity', async () => {
        render(
            <MemoryRouter>
                <ArticleForm mode="edit" projectId="proj-1" articleId="art-1" variant="page" onDismiss={vi.fn()}/>
            </MemoryRouter>,
        );

        // Scoped to the header: the title also appears in the title textarea,
        // so an unscoped query would pass even with the header identity gone.
        const header = (await screen.findByText('editArticle')).closest('[data-slot="page-header"]')!;
        expect(within(header as HTMLElement).getByText('A stored-markdown study')).toBeInTheDocument();
    });

    it('folds the Back label but keeps the button named', async () => {
        renderPageAdd();

        const back = await screen.findByRole('button', {name: 'back'});
        const label = back.querySelector('[data-slot="back-label"]');
        expect(label!.className).toContain('sr-only');
        expect(label!.className).toContain('sm:not-sr-only');
        expect(label!.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    });
});

describe('article editor — panel variant has no header', () => {
    it('renders the actions without the page header, title or back button', async () => {
        renderAdd(); // panel variant

        // Precondition: the form actually rendered, so the absences below mean
        // "the header is gone", not "nothing mounted".
        expect(await screen.findByTestId('article-form-actions')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: /createArticle/})).toBeInTheDocument();

        expect(screen.queryByText('addArticle')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', {name: 'back'})).not.toBeInTheDocument();
        expect(document.querySelector('[data-slot="page-header"]')).toBeNull();
    });
});

describe('article editor — compact section rail in the panel', () => {
    it('keeps every step label sr-only in the panel, whatever the viewport', async () => {
        renderAdd(); // panel variant

        const rail = await screen.findByRole('navigation', {name: 'formStepsAria'});
        // Precondition: the rail actually rendered all five steps.
        const buttons = within(rail).getAllByRole('button');
        expect(buttons).toHaveLength(5);

        for (const button of buttons) {
            const label = button.querySelector('[data-slot="step-label"]');
            // sr-only, never `hidden` — `hidden` would strip the accessible name.
            expect(label!.className).toContain('sr-only');
            expect(label!.className).not.toMatch(/(^|\s)hidden(\s|$)/);
            // The lg: escape hatch must NOT be present in compact mode: inside
            // the panel the viewport is wide while the container is not, so a
            // viewport-keyed un-fold is exactly the bug being fixed.
            expect(label!.className).not.toContain('lg:not-sr-only');
        }
    });

    it('still un-folds the labels at lg in the page variant', async () => {
        render(
            <MemoryRouter>
                <ArticleForm mode="add" projectId="proj-1" variant="page" onDismiss={vi.fn()}/>
            </MemoryRouter>,
        );

        const rail = await screen.findByRole('navigation', {name: 'formStepsAria'});
        const label = within(rail).getAllByRole('button')[0].querySelector('[data-slot="step-label"]');
        expect(label!.className).toContain('lg:not-sr-only');
    });

    it('keeps the compact rail a horizontal strip below lg and a column at lg+', async () => {
        renderAdd(); // panel variant, compact rail

        const rail = await screen.findByRole('navigation', {name: 'formStepsAria'});
        // Precondition: the rail actually rendered all five steps, so the
        // direction assertion below cannot pass vacuously against an empty nav.
        expect(within(rail).getAllByRole('button')).toHaveLength(5);

        const emitted = rail.className;
        // Below lg the surrounding ArticleForm container is already a column
        // (`flex-col … lg:flex-row`), so the compact rail must render as a
        // horizontal icon strip across the top — not a tall stack of icons.
        expect(emitted).toMatch(/(^|\s)flex-row(\s|$)/);
        // At lg+ it folds back into the narrow icon column.
        expect(emitted).toContain('lg:flex-col');
    });
});

describe('article editor — rail placement in the side-by-side (lg+) layout', () => {
    it('puts the panel rail on the right: split container reverses, rail borders its left edge', async () => {
        renderAdd(); // panel variant

        const rail = await screen.findByRole('navigation', {name: 'formStepsAria'});
        const aside = rail.closest('aside')!;
        const splitContainer = aside.parentElement!;

        // Icons before fields in source order + row-reverse at lg+ is what
        // lands the rail on the right edge, Zotero-style.
        expect(splitContainer.className).toContain('lg:flex-row-reverse');
        // Sitting on the right, its divider belongs on its LEFT edge now.
        expect(aside.className).toContain('lg:border-l');
        expect(aside.className).not.toMatch(/(^|\s)lg:border-r(\s|$)/);
    });

    it('leaves the page-variant rail on the left, unchanged', async () => {
        render(
            <MemoryRouter>
                <ArticleForm mode="add" projectId="proj-1" variant="page" onDismiss={vi.fn()}/>
            </MemoryRouter>,
        );

        const rail = await screen.findByRole('navigation', {name: 'formStepsAria'});
        const aside = rail.closest('aside')!;
        const splitContainer = aside.parentElement!;

        expect(splitContainer.className).not.toContain('lg:flex-row-reverse');
        expect(aside.className).toContain('lg:border-r');
        expect(aside.className).not.toMatch(/(^|\s)lg:border-l(\s|$)/);
    });
});
