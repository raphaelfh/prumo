/**
 * One browser tab, two accounts: no cached row may cross the boundary.
 *
 * The `QueryClient` is built at module scope (`App.tsx`), so one cache serves
 * the tab for as long as it is open, and sign-out is a client-side
 * `navigate("/auth")` that tears down no state. TanStack serves a cache hit
 * synchronously during render, and every query here carries a `staleTime`
 * (5 min by default, 30 s on the project list), so the next account paints the
 * previous account's rows and no refetch corrects them until that elapses.
 *
 * Keying one family by user id narrows that one family. These tests pin the
 * cause, and they cover the two shapes the boundary actually takes — which are
 * NOT the same defect and are not fixed by the same thing:
 *
 *   1. Sign-out, then sign-in. `user` goes falsy, so ProtectedRoute swaps the
 *      subtree for <Navigate> and every query hook unmounts. The rows survive
 *      as inactive cache entries and the next account's FRESH observers read
 *      them on mount. Emptying the cache fixes this one.
 *
 *   2. Sign-in as somebody else with no sign-out in between, while the subtree
 *      stays mounted. Reachable without any exotic setup: auth-js opens a
 *      BroadcastChannel on the storage key (GoTrueClient), so a second tab
 *      signing in as B relays SIGNED_IN straight into this tab's subscribers —
 *      no SIGNED_OUT, no unmount. `_recoverAndRefresh()` on visibilitychange
 *      does the same. Emptying the cache does NOT fix this one: an already
 *      mounted observer holds its own last result and is never notified that
 *      its query was removed, so it renders A's rows indefinitely.
 *
 * The probe uses an identity-free key (`projectKeys.members`) — the shape of
 * nearly every key in the app, and the reason per-key scoping does not
 * generalise — and `staleTime: Infinity`, which makes a leak permanent rather
 * than a race so a failure here is unambiguous. It is mounted through the real
 * `ProtectedRoute`, so the test cannot pass by mimicking that gate wrongly.
 */
import {QueryClient, QueryClientProvider, useQuery} from '@tanstack/react-query';
import {act, render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const hoisted = vi.hoisted(() => ({
  authCallback: null as null | ((event: string, session: unknown) => void),
  // What the tab finds in storage at boot — null unless a test signs in first.
  storedSession: null as unknown,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        hoisted.authCallback = cb;
        return {data: {subscription: {unsubscribe: () => {}}}};
      },
      getSession: () => Promise.resolve({data: {session: hoisted.storedSession}, error: null}),
      signOut: () => Promise.resolve({error: null}),
    },
  },
}));

import {AuthProvider} from '@/contexts/AuthContext';
import {ProtectedRoute} from '@/components/ProtectedRoute';
import {projectKeys} from '@/lib/query-keys';

/** What the project-members read returns for whoever is signed in right now. */
let membersPayload = 'A-members';
const fetchMembers = vi.fn(async () => membersPayload);

// A session with no access_token short-circuits validateSessionForEnv, which
// is not what these tests are about.
const sessionFor = (id: string) => ({user: {id}});

function MembersProbe() {
  const {data} = useQuery({
    queryKey: projectKeys.members('p1'),
    queryFn: fetchMembers,
    staleTime: Infinity,
  });
  return <span data-testid="members">{data ?? 'fetching'}</span>;
}

function renderApp() {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  return {
    queryClient,
    ...render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AuthProvider>
          <ProtectedRoute>
            <MembersProbe />
          </ProtectedRoute>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
    ),
  };
}

const emit = async (event: string, session: unknown) => {
  // Guard the precondition: with no captured callback every assertion below
  // would pass vacuously.
  expect(hoisted.authCallback).not.toBeNull();
  await act(async () => {
    hoisted.authCallback!(event, session);
  });
};

/** null while ProtectedRoute is showing the loader or redirecting. */
const members = () => screen.queryByTestId('members')?.textContent ?? null;

/** Boot the tab and settle getSession()'s "no session" resolution. */
async function bootSignedOut() {
  const rendered = renderApp();
  await waitFor(() => expect(members()).toBeNull());
  return rendered;
}

async function signInAs(id: string) {
  await emit('SIGNED_IN', sessionFor(id));
  await waitFor(() => expect(members()).not.toBeNull());
}

describe('the query cache is scoped to one identity', () => {
  beforeEach(() => {
    hoisted.authCallback = null;
    hoisted.storedSession = null;
    membersPayload = 'A-members';
    vi.clearAllMocks();
  });

  it('does not serve one account\'s cached rows to the next account in the tab', async () => {
    await bootSignedOut();

    await signInAs('u1');
    await waitFor(() => expect(members()).toBe('A-members'));
    expect(fetchMembers).toHaveBeenCalledTimes(1);

    membersPayload = 'B-members';
    await emit('SIGNED_OUT', null);
    // Precondition for what this case is about: the subtree really did unmount,
    // so what leaks is the cache entry and not a live observer.
    expect(members()).toBeNull();

    await signInAs('u2');

    expect(members()).not.toBe('A-members');
    await waitFor(() => expect(members()).toBe('B-members'));
  });

  it('does not keep showing one account\'s rows when another tab signs in', async () => {
    await bootSignedOut();

    await signInAs('u1');
    await waitFor(() => expect(members()).toBe('A-members'));

    // Exactly what the BroadcastChannel relays: SIGNED_IN for a different user
    // with no SIGNED_OUT, while A's query is still mounted.
    membersPayload = 'B-members';
    await emit('SIGNED_IN', sessionFor('u2'));

    expect(members()).not.toBe('A-members');
    await waitFor(() => expect(members()).toBe('B-members'));
  });

  it('does not wipe what the account it booted into has already fetched', async () => {
    // The reset must not race a fresh sign-in's first queries. A tab that
    // opens already signed in learns its identity twice — getSession() reads
    // storage and the listener echoes the same session as INITIAL_SESSION —
    // and the queries the first one unblocks are in flight by the time the
    // second arrives. Adopting the same account again must be a no-op.
    hoisted.storedSession = sessionFor('u1');

    const {queryClient} = renderApp();
    await waitFor(() => expect(members()).toBe('A-members'));

    membersPayload = 'would-refetch';
    await emit('INITIAL_SESSION', sessionFor('u1'));

    expect(queryClient.getQueryData(projectKeys.members('p1'))).toBe('A-members');
    expect(fetchMembers).toHaveBeenCalledTimes(1);
  });

  it('keeps the cache across a token refresh for the same account', async () => {
    // The guard against over-clearing: auth-js re-emits for the SAME user on
    // every refresh, on visibilitychange, and on every broadcast from another
    // tab. Dropping the cache there would refetch every screen the user opens
    // next, behind their back.
    //
    // This has to read the cache, not the DOM. An over-clear is INVISIBLE
    // from the rendered output: a mounted observer keeps serving its own last
    // result and is never told its query was removed — the same property that
    // makes the cross-tab case above a real defect. Asserting on the rendered
    // rows alone made this test pass against a version that cleared on every
    // single auth event.
    const {queryClient} = await bootSignedOut();

    await signInAs('u1');
    await waitFor(() => expect(members()).toBe('A-members'));

    membersPayload = 'would-refetch';
    await emit('TOKEN_REFRESHED', sessionFor('u1'));

    expect(queryClient.getQueryData(projectKeys.members('p1'))).toBe('A-members');
    expect(members()).toBe('A-members');
    expect(fetchMembers).toHaveBeenCalledTimes(1);
  });
});
