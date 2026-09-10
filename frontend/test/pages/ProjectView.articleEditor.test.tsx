/**
 * ProjectView wires the URL's `articleEditor`/`articleId` params into
 * ArticlesSplitShell. `mode` is derived from `articleEditor`, but `articleId`
 * used to be forwarded unconditionally — so `?articleEditor=add&articleId=<x>`
 * produced `mode="add"` WITH a live articleId, letting the Document segment
 * enable and render another article's PDF beside a blank add form.
 */
import {render, screen} from '@testing-library/react';
import {MemoryRouter, Route, Routes} from 'react-router';
import {beforeEach, describe, expect, it, vi} from 'vitest';

// ProjectView's import graph reaches `@/integrations/supabase/client`, which
// calls createClient at MODULE scope and throws without a URL. A developer
// with a local .env never sees this; CI has none, so the failure is CI-only.
// Same guard as the ArticleForm specs.
vi.hoisted(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-anon-key');
});

vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn(), warning: vi.fn()}}));
vi.mock('@/services/projectsService', () => ({
    loadProjectById: vi.fn(),
    loadProjectArticles: vi.fn(),
}));

const splitShellPropsSpy = vi.fn();
vi.mock('@/components/articles/ArticlesSplitShell', () => ({
    ArticlesSplitShell: (props: {mode: string | null; articleId: string | null}) => {
        splitShellPropsSpy(props);
        return <div data-testid="articles-split-shell"/>;
    },
}));

import ProjectView from '@/pages/ProjectView';
import {ProjectProvider} from '@/contexts/ProjectContext';
import {loadProjectArticles, loadProjectById} from '@/services/projectsService';

function renderAt(path: string) {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <ProjectProvider>
                <Routes>
                    <Route path="/projects/:projectId" element={<ProjectView/>}/>
                </Routes>
            </ProjectProvider>
        </MemoryRouter>,
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadProjectById).mockResolvedValue({
        ok: true,
        data: {id: 'p1', name: 'Project', description: null, review_title: null, condition_studied: null},
    } as never);
    vi.mocked(loadProjectArticles).mockResolvedValue({ok: true, data: []} as never);
});

describe('ProjectView article editor URL wiring', () => {
    it('passes articleId through in edit mode', async () => {
        renderAt('/projects/p1?tab=articles&articleEditor=edit&articleId=a1');

        await screen.findByTestId('articles-split-shell');

        expect(splitShellPropsSpy).toHaveBeenLastCalledWith(
            expect.objectContaining({mode: 'edit', articleId: 'a1'}),
        );
    });

    it('does not forward articleId when mode is add, even if the URL carries one', async () => {
        renderAt('/projects/p1?tab=articles&articleEditor=add&articleId=some-other-uuid');

        await screen.findByTestId('articles-split-shell');

        expect(splitShellPropsSpy).toHaveBeenLastCalledWith(
            expect.objectContaining({mode: 'add', articleId: null}),
        );
    });
});
