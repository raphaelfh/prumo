/**
 * One browser tab, two accounts: no background job may cross the boundary.
 *
 * `useBackgroundJobs` is a module-scope zustand store persisted to
 * `localStorage` under a fixed key, and sign-out is a client-side
 * `navigate("/auth")` that tears down no state. So after A signs out and B
 * signs in in the same browser, the bell renders A's rows to B — job type,
 * phase messages, `currentFile`, counts, and, for a Zotero import, the
 * collection and project A was importing into.
 *
 * Remounting does not reach this. The query-cache leak is fixed partly by
 * keying the protected subtree on `user.id`, but a zustand store is global
 * to the module, not to the tree: a remounted `NotificationCenter` re-reads
 * the very same jobs. The store itself has to be told the account changed.
 *
 * The boundary has to distinguish two things that look identical from
 * inside `AuthProvider`, which is why these tests come in pairs:
 *
 *   1. A DIFFERENT account is now here — drop the jobs. Two shapes: sign-out
 *      then sign-in, and a bare `SIGNED_IN` for somebody else with no
 *      sign-out in between (auth-js opens a BroadcastChannel on the storage
 *      key, so a second tab signing in relays `SIGNED_IN` straight into this
 *      one; `_recoverAndRefresh()` on visibilitychange does the same).
 *
 *   2. The SAME account is here again — keep them. Surviving a reload is the
 *      entire reason these jobs are persisted, and auth-js re-announces the
 *      same user on boot, on every token refresh, on visibilitychange and on
 *      every broadcast from another tab. A boundary that resets on each of
 *      those would throw away the user's own in-flight import.
 *
 * That second half is what rules out tracking the identity in a ref beside
 * the one that guards the query cache: a ref starts null on every page load,
 * so "same account, new page" would be indistinguishable from "new account".
 * The comparison has to run against a value that survives the reload, i.e.
 * the persisted `ownerId`.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
vi.mock('sonner', () => ({
  toast: {success: vi.fn(), info: vi.fn(), error: vi.fn()},
}));
// The bell polls in-flight EXPORT jobs on mount. These tests use Zotero
// imports, which it never polls, but the imports still have to resolve.
vi.mock('@/services/articlesExportService', () => ({
  getExportStatus: vi.fn().mockResolvedValue({job_id: 'x', status: 'completed'}),
}));
vi.mock('@/services/extractionExportService', () => ({
  getExportStatus: vi.fn().mockResolvedValue({job_id: 'x', status: 'completed'}),
}));

import {AuthProvider} from '@/contexts/AuthContext';
import {ProtectedRoute} from '@/components/ProtectedRoute';
import {NotificationCenter} from '@/components/navigation/NotificationCenter';
import {useBackgroundJobs} from '@/stores/useBackgroundJobs';
import {createZoteroImportJob} from '@/types/background-jobs';

const PERSIST_KEY = 'review-hub-background-jobs';

/** Private to A: the collection name renders verbatim in the job row. */
const A_COLLECTION = "A's private collection";

// A session with no access_token short-circuits validateSessionForEnv, which
// is not what these tests are about.
const sessionFor = (id: string) => ({user: {id}});

function completedImportJob(collectionName: string) {
  return {
    ...createZoteroImportJob(
      '11111111-1111-1111-1111-111111111111',
      'COLLKEY',
      {downloadPdfs: false, updateExisting: false, importTags: false},
      {collectionName, projectName: 'A-project'},
    ),
    status: 'completed' as const,
    completedAt: Date.now(),
  };
}

/**
 * Mount the tab and let `getSession()` settle. `AuthProvider` learns the
 * identity from two places, and `getSession()`'s promise resolves after the
 * listener is registered — emit into the listener before it lands and the
 * boot read overwrites what was emitted.
 */
async function boot() {
  // AuthProvider also empties the query cache at this boundary (the sibling
  // half of the same fix); nothing here queries, but it needs a client.
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AuthProvider>
          <ProtectedRoute>
            <NotificationCenter />
          </ProtectedRoute>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await act(async () => {});
}

const emit = async (event: string, session: unknown) => {
  // Guard the precondition: with no captured callback every assertion below
  // would pass vacuously.
  expect(hoisted.authCallback).not.toBeNull();
  await act(async () => {
    hoisted.authCallback!(event, session);
  });
};

/** The bell only exists once ProtectedRoute has let the subtree through. */
const bell = () => screen.queryByRole('button', {name: /notification/i});

async function signInAs(id: string) {
  await emit('SIGNED_IN', sessionFor(id));
  await waitFor(() => expect(bell()).not.toBeNull());
}

/** Open the dropdown so the job rows render. */
async function openBell() {
  // Radix locks pointer events on <body> while a menu is open, which the
  // default pointer-events check reads as "not clickable" on a reopen.
  const user = userEvent.setup({pointerEventsCheck: 0});
  await user.click(bell()!);
  await screen.findByRole('menu');
}

/** Close it again, so the next open starts from a clean body. */
async function closeBell() {
  const user = userEvent.setup({pointerEventsCheck: 0});
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
}

describe('background jobs are scoped to one identity', () => {
  beforeEach(() => {
    hoisted.authCallback = null;
    hoisted.storedSession = null;
    localStorage.clear();
    act(() => {
      useBackgroundJobs.setState({jobs: [], lastReadAt: Date.now(), ownerId: null});
    });
    vi.clearAllMocks();
  });

  it("does not show one account's jobs to the next account in the browser", async () => {
    await boot();
    expect(bell()).toBeNull();
    await signInAs('u1');

    act(() => {
      useBackgroundJobs.getState().addJob(completedImportJob(A_COLLECTION));
    });
    await openBell();
    // Precondition: A really can see their own job, so a later absence is
    // the reset and not a bell that never renders rows.
    expect(screen.getByText(new RegExp(A_COLLECTION))).toBeInTheDocument();
    await closeBell();

    await emit('SIGNED_OUT', null);
    expect(bell()).toBeNull();

    await signInAs('u2');
    await openBell();

    expect(screen.queryByText(new RegExp(A_COLLECTION))).not.toBeInTheDocument();
    expect(screen.getByText(/no notifications/i)).toBeInTheDocument();
    // And it is gone from storage, so B's next reload cannot resurrect it.
    expect(localStorage.getItem(PERSIST_KEY)).not.toContain('private collection');
  });

  it("does not keep showing one account's jobs when another tab signs in", async () => {
    await boot();
    expect(bell()).toBeNull();
    await signInAs('u1');

    act(() => {
      useBackgroundJobs.getState().addJob(completedImportJob(A_COLLECTION));
    });
    await openBell();
    expect(screen.getByText(new RegExp(A_COLLECTION))).toBeInTheDocument();
    await closeBell();

    // Exactly what the BroadcastChannel relays: SIGNED_IN for a different
    // user, no SIGNED_OUT, while the bell stays mounted.
    await emit('SIGNED_IN', sessionFor('u2'));

    // Re-open before asserting. ProtectedRoute keys the subtree on user.id,
    // so this remounts NotificationCenter and resets its `open` state — the
    // row leaves the DOM whether or not anything was reset, and an assertion
    // on the closed menu would pass against no fix at all.
    await openBell();
    expect(screen.queryByText(new RegExp(A_COLLECTION))).not.toBeInTheDocument();
    expect(useBackgroundJobs.getState().jobs).toHaveLength(0);
  });

  it('drops jobs persisted before the store recorded an owner', async () => {
    // Upgrade path: state written by the version without `ownerId` rehydrates
    // with `ownerId: null`. It cannot be shown to belong to whoever signs in
    // next, so it goes.
    act(() => {
      useBackgroundJobs.setState({
        jobs: [completedImportJob(A_COLLECTION)],
        lastReadAt: Date.now(),
        ownerId: null,
      });
    });

    await boot();
    expect(bell()).toBeNull();
    await signInAs('u1');
    await openBell();

    expect(screen.queryByText(new RegExp(A_COLLECTION))).not.toBeInTheDocument();
  });

  it('keeps the jobs the account it booted into left behind', async () => {
    // The guard against over-resetting. A reload re-creates the store from
    // localStorage and re-announces the same user from two paths — the
    // listener's INITIAL_SESSION and getSession(). Neither is a change of
    // account, and wiping there would drop the import the user is watching.
    hoisted.storedSession = sessionFor('u1');
    act(() => {
      useBackgroundJobs.setState({
        jobs: [completedImportJob(A_COLLECTION)],
        lastReadAt: Date.now(),
        ownerId: 'u1',
      });
    });

    await boot();
    await waitFor(() => expect(bell()).not.toBeNull());
    await emit('INITIAL_SESSION', sessionFor('u1'));

    expect(useBackgroundJobs.getState().jobs).toHaveLength(1);
    await openBell();
    expect(screen.getByText(new RegExp(A_COLLECTION))).toBeInTheDocument();
  });

  it('keeps the jobs across a token refresh for the same account', async () => {
    // auth-js re-emits for the SAME user on every refresh, on visibilitychange
    // and on every broadcast from another tab.
    await boot();
    expect(bell()).toBeNull();
    await signInAs('u1');

    act(() => {
      useBackgroundJobs.getState().addJob(completedImportJob(A_COLLECTION));
    });
    await emit('TOKEN_REFRESHED', sessionFor('u1'));

    expect(useBackgroundJobs.getState().jobs).toHaveLength(1);
    await openBell();
    expect(screen.getByText(new RegExp(A_COLLECTION))).toBeInTheDocument();
  });
});
