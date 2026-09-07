/**
 * The project switcher's FOUR states, kept distinct.
 *
 * Migrating the list onto the shared query deletes the hook's toast — the
 * read's only error surface today (`useProjectsList.ts:24`). With nothing in
 * its place a failed read renders as an empty menu, indistinguishable from an
 * account with no projects, on every route the sidebar is mounted on. On
 * `/projects/:id` the hub's own ErrorState is not mounted either, so nothing
 * anywhere would say the read failed.
 *
 * `open` is a controlled prop, so the menu is rendered without depending on
 * Radix pointer behaviour in jsdom.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {MemoryRouter} from 'react-router';

// SidebarHeader reaches the Supabase client through projectsService
// (createProject), and that client throws at import time without a URL.
// CI runs vitest with no .env.
vi.hoisted(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-anon-key');
});

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({user: {id: 'u1'}, session: null, loading: false, signOut: vi.fn()}),
}));

const retry = vi.fn();
let listState: {projects: Array<{id: string; name: string}>; loading: boolean; isError: boolean};
vi.mock('@/hooks/useProjectsList', () => ({
  useProjectsList: () => ({...listState, retry, switchProject: vi.fn()}),
}));

import {SidebarHeader} from '@/components/layout/SidebarHeader';

const ALPHA = {id: 'p1', name: 'Alpha'};

function renderSwitcher(state: typeof listState) {
  listState = state;
  // The component calls `useQueryClient()` for its post-create invalidation,
  // which throws outside a provider even though nothing here creates a project.
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SidebarHeader open onOpenChange={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return screen.getByRole('menu');
}

describe('SidebarHeader project switcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolved — lists the projects, and claims neither failure nor emptiness', () => {
    const menu = renderSwitcher({projects: [ALPHA], loading: false, isError: false});

    expect(within(menu).getByText('Alpha')).toBeInTheDocument();
    expect(within(menu).queryByRole('alert')).toBeNull();
    expect(within(menu).queryByText('No projects yet')).toBeNull();
  });

  it('loading — names the wait instead of showing an unlabelled spinner', () => {
    const menu = renderSwitcher({projects: [], loading: true, isError: false});

    expect(within(menu).getByText('Loading projects…')).toBeInTheDocument();
    expect(within(menu).queryByRole('alert')).toBeNull();
    expect(within(menu).queryByText('No projects yet')).toBeNull();
  });

  it('failed — says so, offers a retry, and does not read as an empty account', async () => {
    const menu = renderSwitcher({projects: [], loading: false, isError: true});

    expect(within(menu).getByRole('alert')).toHaveTextContent('Could not load projects.');
    expect(within(menu).queryByText('No projects yet')).toBeNull();

    await userEvent.click(within(menu).getByRole('menuitem', {name: 'Try again'}));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('empty — says the account has no projects, and does not read as a failure', () => {
    const menu = renderSwitcher({projects: [], loading: false, isError: false});

    expect(within(menu).getByText('No projects yet')).toBeInTheDocument();
    expect(within(menu).queryByRole('alert')).toBeNull();
    expect(within(menu).queryByRole('menuitem', {name: 'Try again'})).toBeNull();
  });

  it('keeps Create and Back reachable while the read is failing', () => {
    const menu = renderSwitcher({projects: [], loading: false, isError: true});

    expect(within(menu).getByRole('menuitem', {name: 'Create new project'})).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', {name: 'Back to projects'})).toBeInTheDocument();
  });
});
