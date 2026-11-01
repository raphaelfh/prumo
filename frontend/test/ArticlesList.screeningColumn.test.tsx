/**
 * The Articles list's Screening column: one chip per row from ONE phase-less
 * records read (real hook, MSW). Blank wherever the stage is unknown.
 */
import {describe, expect, it, vi} from 'vitest';
import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {http, HttpResponse} from 'msw';
import {MemoryRouter} from 'react-router';
import {ArticlesList} from '@/components/articles/ArticlesList';
import {createQueryWrapper} from '@/test/helpers/queryClientWrapper';
import {server} from '@/test/mocks/server';
import type {Article} from '@/types/article';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getSession: async () => ({data: {session: {access_token: 'test-token'}}})}},
}));
vi.mock('@/services/articlesService', () => ({
  fetchArticleIdsWithMainFile: vi.fn(async () => ({ok: true, data: [] as string[]})),
  fetchArticlePdfSignedUrl: vi.fn(),
}));
vi.mock('@/hooks/useZoteroIntegration', () => ({useZoteroIntegration: () => ({isConfigured: true})}));
vi.mock('@/hooks/useProjectMemberRole', () => ({
  useProjectMemberRole: () => ({role: 'reviewer', isManager: false, loading: false}),
}));
vi.mock('sonner', () => ({toast: {error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn()}}));

const A1 = '00000000-0000-0000-0000-0000000000a1';
const A2 = '00000000-0000-0000-0000-0000000000a2';
const A3 = '00000000-0000-0000-0000-0000000000a3';

const article = (id: string, title: string): Article => ({id, title, project_id: 'p1'}) as Article;
const ARTICLES = [article(A1, 'First paper'), article(A2, 'Second paper'), article(A3, 'Third paper')];

const config = (reviewerCount: number | null) => ({
  can_arbitrate: false,
  can_manage: false,
  can_review: true,
  enrolled: 1,
  exclusion_reasons: [],
  full_text_count_locked: false,
  full_text_enrolled: 0,
  full_text_ready: 0,
  full_text_reviewer_count: null,
  not_enrolled: 1,
  reviewer_capable: 1,
  reviewer_count: reviewerCount,
  reviewer_count_locked: false,
});

const row = (articleId: string, status: string) => ({
  article_id: articleId,
  assignment_id: null,
  phase: 'title_abstract',
  status,
  title: 'x',
});

function useConfig(reviewerCount: number | null) {
  server.use(
    http.get('*/api/v1/projects/p1/screening/config', () =>
      HttpResponse.json({ok: true, data: config(reviewerCount)}),
    ),
  );
}

function renderList() {
  render(
    <MemoryRouter>
      <ArticlesList
        articles={ARTICLES}
        projectId="p1"
        onOpenZoteroDialog={vi.fn()}
        onOpenRisDialog={vi.fn()}
        onOpenAddArticle={vi.fn()}
        onArticlesChange={vi.fn()}
        onArticleClick={vi.fn()}
      />
    </MemoryRouter>,
    {wrapper: createQueryWrapper().wrapper},
  );
}

const rowOf = (title: string) => screen.getByText(title).closest('tr') as HTMLElement;

describe('ArticlesList screening column', () => {
  it('shows a Screening column header and a chip per row', async () => {
    useConfig(1);
    server.use(
      http.get('*/api/v1/projects/p1/screening/records', () =>
        HttpResponse.json({
          ok: true,
          data: {
            exclusion_reasons: [],
            inclusion_criteria: [],
            phase: null,
            removed_duplicate_ids: [],
            reviewer_count: 1,
            rows: [row(A1, 'not_enrolled'), row(A2, 'to_screen')],
          },
        }),
      ),
    );
    renderList();

    expect(screen.getByRole('columnheader', {name: /Screening/})).toBeInTheDocument();
    expect(await within(rowOf('First paper')).findByText('Not enrolled')).toBeInTheDocument();
    expect(await within(rowOf('Second paper')).findByText('Title/abstract · To screen')).toBeInTheDocument();
  });

  it('renders nothing when screening is not configured', async () => {
    useConfig(null);
    const records = vi.fn();
    server.use(
      http.get('*/api/v1/projects/p1/screening/records', () => {
        records();
        return HttpResponse.json({ok: true, data: {}});
      }),
    );
    renderList();

    expect(screen.getByRole('columnheader', {name: /Screening/})).toBeInTheDocument();
    expect(await screen.findByText('First paper')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('Not enrolled')).not.toBeInTheDocument();
    expect(records).not.toHaveBeenCalled();
  });

  it('renders nothing on a records error', async () => {
    useConfig(1);
    const {toast} = await import('sonner');
    server.use(
      http.get('*/api/v1/projects/p1/screening/records', () =>
        HttpResponse.json({ok: false, error: {code: 'INTERNAL', message: 'boom'}}, {status: 500}),
      ),
    );
    renderList();

    expect(await screen.findByText('First paper')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByText('Not enrolled')).not.toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('renders nothing for an article absent from the read', async () => {
    useConfig(1);
    server.use(
      http.get('*/api/v1/projects/p1/screening/records', () =>
        HttpResponse.json({
          ok: true,
          data: {
            exclusion_reasons: [],
            inclusion_criteria: [],
            phase: null,
            removed_duplicate_ids: [],
            reviewer_count: 1,
            rows: [row(A1, 'not_enrolled')],
          },
        }),
      ),
    );
    renderList();

    expect(await within(rowOf('First paper')).findByText('Not enrolled')).toBeInTheDocument();
    expect(within(rowOf('Third paper')).queryByText(/Not enrolled|To screen|Duplicate/)).not.toBeInTheDocument();
  });

  it('the column can be hidden from Display properties', async () => {
    useConfig(null);
    renderList();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', {name: 'Display options'}));
    await user.click(await screen.findByRole('button', {name: 'Screening'}));

    expect(screen.queryByRole('columnheader', {name: /Screening/})).not.toBeInTheDocument();
  });
});
