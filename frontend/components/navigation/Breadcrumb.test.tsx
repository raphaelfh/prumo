/**
 * The breadcrumb's FOUR states on a project route.
 *
 * `nav[aria-label="Breadcrumb"]` is a landmark. Whatever the shared list read
 * did, it must never render as markup with no accessible content — and
 * `project?.name` being `undefined` covers three genuinely different outcomes:
 *
 *   - the read is still in flight;
 *   - the read FAILED (and on `/projects/:id` the hub's ErrorState is not
 *     mounted, so nothing else on screen would say so);
 *   - the read succeeded and this id is simply not in the caller's list — a
 *     stale bookmark, a revoked membership, or a project the filtered list
 *     does not carry. That is an ordinary outcome, NOT an error, and must not
 *     be dressed as one.
 *
 * The last state is reachable on demand, not hypothetical: Task 14's E2E
 * navigates to `/projects/00000000-0000-0000-0000-000000000000`.
 */
import {cleanup, render, screen} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {MemoryRouter} from 'react-router';

let queryState: {data: unknown; isError: boolean};
vi.mock('@/hooks/useProjectsQuery', () => ({useProjectsQuery: () => queryState}));

import {AppBreadcrumb} from '@/components/navigation/Breadcrumb';

const ALPHA = {
    id: 'p1',
    name: 'Alpha',
    description: null,
    created_at: '2026-01-01T00:00:00.000Z',
    is_active: true,
    review_title: null,
};

const IN_FLIGHT = {data: undefined, isError: false};
const FAILED = {data: undefined, isError: true};
const RESOLVED = {data: [ALPHA], isError: false};
const NOT_IN_LIST = {data: [], isError: false};

function renderAt(path: string, state: {data: unknown; isError: boolean}) {
    queryState = state;
    render(
        <MemoryRouter initialEntries={[path]}>
            <AppBreadcrumb/>
        </MemoryRouter>,
    );
    return screen.getByRole('navigation', {name: 'Breadcrumb'});
}

describe('AppBreadcrumb', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('resolved — names the project', () => {
        expect(renderAt('/projects/p1', RESOLVED)).toHaveTextContent('Alpha');
    });

    it('in flight — the landmark carries text, not just an aria-hidden shimmer', () => {
        const crumbs = renderAt('/projects/p1', IN_FLIGHT);

        expect(crumbs).toHaveTextContent('Loading projects…');
        expect(crumbs.querySelector('.animate-pulse')).toHaveAttribute('aria-hidden', 'true');
    });

    it('failed — says the breadcrumb itself could not resolve a name, and stops shimmering', () => {
        const crumbs = renderAt('/projects/p1', FAILED);

        expect(crumbs).toHaveTextContent('Project name unavailable');
        expect(crumbs.querySelector('.animate-pulse')).toBeNull();
    });

    it('not in the caller\'s list — an unknown project, not a failure', () => {
        const crumbs = renderAt('/projects/p1', NOT_IN_LIST);

        expect(crumbs).toHaveTextContent('Unknown project');
        expect(crumbs).not.toHaveTextContent('Project name unavailable');
        expect(crumbs.querySelector('.animate-pulse')).toBeNull();
    });

    it('the four states render four different strings', () => {
        // The guard that makes the four assertions above non-vacuous: a
        // refactor folding two branches together would keep every one of them
        // green if both branches happened to render the same text. Same URL
        // throughout, so the section crumb is constant and the root is the
        // only thing that varies.
        const seen = new Set<string>();
        for (const state of [RESOLVED, IN_FLIGHT, FAILED, NOT_IN_LIST]) {
            seen.add(renderAt('/projects/p1', state).textContent ?? '');
            cleanup();
        }
        expect(seen.size).toBe(4);
    });

    it('names the hub and settings, where there is no project to resolve', () => {
        expect(renderAt('/', RESOLVED)).toHaveTextContent('Projects');
        cleanup();
        expect(renderAt('/settings', RESOLVED)).toHaveTextContent('Settings');
    });
});
