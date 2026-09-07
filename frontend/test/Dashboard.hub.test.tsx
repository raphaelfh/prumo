/**
 * The hub's management surface. jsdom sees no layout and no Tailwind, so
 * nothing here asserts density, the responsive tier or the hover reveal — the
 * `⋯` menu is reached by role, which is what assistive tech does too. Visual
 * fidelity goes through the design-review loop.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {MemoryRouter} from 'react-router';

// Dashboard reaches the Supabase client through projectsService (createProject),
// and that client throws at import time without a URL. CI runs vitest with no .env.
vi.hoisted(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-anon-key');
});

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({user: {id: 'u1'}, session: null, loading: false, signOut: vi.fn()}),
}));

const mutate = vi.fn();
vi.mock('@/hooks/useArchiveProject', () => ({useArchiveProject: () => ({mutate})}));

let queryState: Record<string, unknown>;
vi.mock('@/hooks/useProjectsQuery', () => ({useProjectsQuery: () => queryState}));

import Dashboard from '@/pages/Dashboard';

function project(over: Record<string, unknown>) {
  return {
    id: 'p1',
    name: 'Alpha',
    description: 'First review',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-09-07T11:59:30.000Z',
    is_active: true,
    review_title: null,
    // The caller's own membership row — `isProjectManager` checks `user_id`.
    project_members: [{user_id: 'u1', role: 'manager'}],
    ...over,
  };
}

function renderHub(projects: unknown[]) {
  queryState = {data: projects, isLoading: false, isError: false, refetch: vi.fn()};
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Dashboard/>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('projects hub', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists active projects and hides archived ones by default', () => {
    renderHub([project({}), project({id: 'p2', name: 'Beta', is_active: false})]);
    expect(screen.getByRole('link', {name: 'Alpha'})).toBeInTheDocument();
    expect(screen.queryByRole('link', {name: 'Beta'})).toBeNull();
  });

  it('shows archived projects behind the Archived filter, with a badge', async () => {
    renderHub([project({}), project({id: 'p2', name: 'Beta', is_active: false})]);
    await userEvent.click(screen.getByRole('tab', {name: 'Archived'}));
    expect(screen.getByRole('link', {name: 'Beta'})).toBeInTheDocument();
    expect(screen.getByText('Archived', {selector: 'span'})).toBeInTheDocument();
    expect(screen.queryByRole('link', {name: 'Alpha'})).toBeNull();
  });

  it('filters by search term', async () => {
    renderHub([project({}), project({id: 'p2', name: 'Beta'})]);
    await userEvent.type(screen.getByPlaceholderText('Search projects…'), 'bet');
    expect(screen.getByRole('link', {name: 'Beta'})).toBeInTheDocument();
    expect(screen.queryByRole('link', {name: 'Alpha'})).toBeNull();
  });

  it('defaults to Updated descending and re-sorts by name', async () => {
    renderHub([
      project({id: 'p1', name: 'Zeta', updated_at: '2026-09-01T00:00:00.000Z'}),
      project({id: 'p2', name: 'Alpha', updated_at: '2026-09-05T00:00:00.000Z'}),
    ]);
    const names = () => screen.getAllByRole('link').map((el) => el.textContent);
    expect(names()).toEqual(['Alpha', 'Zeta']);

    await userEvent.click(screen.getByRole('button', {name: 'Sort options'}));
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(screen.getByRole('option', {name: 'Name'}));
    expect(names()).toEqual(['Zeta', 'Alpha']);
  });

  it('shows the first-project empty state when there are no projects at all', () => {
    renderHub([]);
    expect(screen.getByText('Start with your first project')).toBeInTheDocument();
  });

  it('shows a search empty state when a term matches nothing', async () => {
    renderHub([project({})]);
    await userEvent.type(screen.getByPlaceholderText('Search projects…'), 'zzz');
    expect(screen.getByText('No projects match your search')).toBeInTheDocument();
  });

  it('shows an archived empty state when nothing is archived', async () => {
    renderHub([project({})]);
    await userEvent.click(screen.getByRole('tab', {name: 'Archived'}));
    expect(screen.getByText('No archived projects')).toBeInTheDocument();
  });

  it('shows an active empty state — not the archived one — when every project is archived', () => {
    // The Active tab is selected by default; a project existing only under
    // Archived must not be reported through the Archived-tab copy while the
    // Active tab is what's on screen (final-review Finding 1).
    renderHub([project({is_active: false})]);
    expect(screen.getByRole('tab', {name: 'Active'})).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('No active projects')).toBeInTheDocument();
    expect(screen.queryByText('No archived projects')).toBeNull();
  });

  it('offers Archive to managers and fires the mutation', async () => {
    renderHub([project({})]);
    await userEvent.click(screen.getByRole('button', {name: 'Project actions'}));
    await userEvent.click(await screen.findByRole('menuitem', {name: 'Archive'}));
    expect(mutate).toHaveBeenCalledWith(
      {projectId: 'p1', archived: true},
      expect.anything(),
    );
  });

  it('does not offer the row menu to non-managers', () => {
    renderHub([project({project_members: [{user_id: 'u1', role: 'reviewer'}]})]);
    expect(screen.queryByRole('button', {name: 'Project actions'})).toBeNull();
  });

  it('does not offer the row menu on someone else\'s manager row', () => {
    // If the embed filter ever stopped narrowing, the whole roster would
    // arrive; the affordance must still answer for the caller alone.
    renderHub([
      project({
        project_members: [
          {user_id: 'someone-else', role: 'manager'},
          {user_id: 'u1', role: 'viewer'},
        ],
      }),
    ]);
    expect(screen.queryByRole('button', {name: 'Project actions'})).toBeNull();
  });

  it('renders relative update metadata, not a creation date', () => {
    renderHub([project({})]);
    const row = screen.getByRole('link', {name: 'Alpha'}).closest('div.group') as HTMLElement;
    expect(within(row).getByText('Updated')).toBeInTheDocument();
    expect(within(row).queryByText('Created')).toBeNull();
  });
});
