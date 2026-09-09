/**
 * ArticleForm's Zotero-lean rework: no nested card chrome, one column, and
 * a section order that reads top to bottom. Covers all five sections:
 * BasicInfoSection, PublicationSection, IdentifiersSection,
 * AdditionalInfoSection and FilesSection.
 */
import {render, screen, within} from '@testing-library/react';
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

beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
});

function renderForm() {
    return render(
        <MemoryRouter>
            <ArticleForm mode="add" projectId="proj-1" onDismiss={vi.fn()}/>
        </MemoryRouter>,
    );
}

describe('ArticleForm chrome', () => {
    it('has no nested card headings while the section headings remain', () => {
        renderForm();

        // Section headings (SettingsSection) remain, one per section. Scoped
        // to each section's <h2>, since the copy key also labels the rail
        // step (an sr-only span), which is a different element entirely.
        const basicSection = document.getElementById('article-section-basic')!;
        const publicationSection = document.getElementById('article-section-publication')!;
        expect(within(basicSection).getByRole('heading', {level: 2, name: 'basicInfo'})).toBeInTheDocument();
        expect(within(publicationSection).getByRole('heading', {level: 2, name: 'publication'})).toBeInTheDocument();

        // The inner SettingsCard headings that were unique to the now-deleted
        // card wrapper are gone entirely — nothing renders them any more.
        expect(screen.queryByText('articleContentCardTitle')).not.toBeInTheDocument();
        expect(screen.queryByText('publicationDetails')).not.toBeInTheDocument();

        // Identifiers previously reused the same copy key for both the
        // section heading AND the inner card's heading — two elements with
        // that text inside the section itself (the rail nav also uses this
        // key for its own step label, which is a different concern and is
        // excluded by scoping to the section element).
        const identifiersSection = document.getElementById('article-section-identifiers')!;
        expect(within(identifiersSection).getAllByText('identifiersLabel')).toHaveLength(1);
    });

    it('renders every section in a single column', () => {
        renderForm();

        // Applies to the whole form now that all five sections are
        // converted. This deliberately does not flag ArticleAuthorsField's
        // own internal, non-responsive `grid-cols-2` (last name / first name
        // pair within one author row) — that is a compound-field layout, not
        // section chrome.
        for (const id of [
            'article-section-basic',
            'article-section-publication',
            'article-section-identifiers',
            'article-section-additional',
            'article-section-files',
        ]) {
            const section = document.getElementById(id);
            expect(section).not.toBeNull();
            const gridOffenders = section!.querySelectorAll('[class*="sm:grid-cols-2"], [class*="sm:grid-cols-3"]');
            expect(gridOffenders).toHaveLength(0);
        }
    });

    it('renders a dense row list, not a card-spaced one (SettingsSection space-y-6)', () => {
        renderForm();

        for (const id of [
            'article-section-basic',
            'article-section-publication',
            'article-section-identifiers',
            'article-section-additional',
            'article-section-files',
        ]) {
            const section = document.getElementById(id)!;
            // SettingsSection's root is the section's sole direct child; its
            // default space-y-6 was sized for cards, not 4px-tall field rows.
            const rowContainer = section.firstElementChild!;
            expect(rowContainer.className).not.toMatch(/\bspace-y-6\b/);
        }
    });

    it('renders the section anchors in rail order: basic, publication, identifiers, additional, files', () => {
        renderForm();

        const anchors = Array.from(document.querySelectorAll('[id^="article-section-"]')).map((el) => el.id);

        expect(anchors).toEqual([
            'article-section-basic',
            'article-section-publication',
            'article-section-identifiers',
            'article-section-additional',
            'article-section-files',
        ]);
    });
});
