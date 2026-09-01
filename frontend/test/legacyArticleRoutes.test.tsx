/**
 * The legacy `/articles/add` and `/articles/:articleId/edit` routes are retired.
 * They were pure redirects into `?tab=articles&articleEditor=...`, which is now
 * the only way in — the sheet is URL-driven, so nothing lost addressability.
 *
 * Both paths must fall through to the `path="*"` NotFound route. Asserting only
 * "NotFound is shown" would also pass if the route table were gutted, if
 * ProtectedRoute broke (every real route is wrapped; `*` is not), or if App threw
 * and the outer ErrorBoundary swallowed it — so this file carries a positive
 * control on a live route, and asserts the 404 renders AT the requested URL
 * rather than after a redirect somewhere else that happens to 404 too.
 */

import {render, screen} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

// The App module graph statically reaches the Supabase client, which throws at
// import time without a URL. CI runs vitest with no .env.
vi.hoisted(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-anon-key');
});

vi.mock('@/contexts/AuthContext', () => ({
    AuthProvider: ({children}: {children: React.ReactNode}) => <>{children}</>,
    useAuth: () => ({user: {id: 'u1'}, session: null, loading: false, signOut: vi.fn()}),
}));

vi.mock('@/components/layout/AppLayout', () => ({
    ProjectLayout: ({children}: {children: React.ReactNode}) => <>{children}</>,
}));

vi.mock('@/pages/ProjectView', () => ({
    default: () => <div>project view</div>,
}));

import App from '@/App';

function renderAt(path: string) {
    window.history.pushState({}, '', path);
    render(<App/>);
}

describe('legacy article routes', () => {
    beforeEach(() => {
        window.history.pushState({}, '', '/');
    });

    // Positive control: same file, same mocks, same render path. If this fails,
    // the two assertions below prove nothing about route retirement.
    it('positive control — a live route still renders its page', async () => {
        renderAt('/projects/p1');

        expect(await screen.findByText('project view')).toBeInTheDocument();
    });

    it('/articles/add no longer resolves', async () => {
        renderAt('/projects/p1/articles/add');

        expect(await screen.findByRole('heading', {name: '404'})).toBeInTheDocument();
        // The load-bearing assertion: separates "route retired" from "route still
        // redirects, and the destination happens to 404".
        expect(window.location.pathname).toBe('/projects/p1/articles/add');
    });

    it('/articles/:articleId/edit no longer resolves', async () => {
        renderAt('/projects/p1/articles/a9/edit');

        expect(await screen.findByRole('heading', {name: '404'})).toBeInTheDocument();
        expect(window.location.pathname).toBe('/projects/p1/articles/a9/edit');
    });
});
