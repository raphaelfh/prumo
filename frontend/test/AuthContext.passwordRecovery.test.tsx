import {describe, expect, it, vi, beforeEach} from 'vitest';
import {act, render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter, useLocation} from 'react-router';

/**
 * A recovery link must land the user on the password form, even when GoTrue
 * redirected them somewhere else.
 *
 * GoTrue honours `redirect_to` only when it matches the project's Redirect
 * URLs allow list; on a miss it silently falls back to the Site URL. The PKCE
 * exchange still succeeds, because auth-js reads the recovery type from the
 * verifier it stored in localStorage rather than from the URL
 * (GoTrueClient `_exchangeCodeForSession`), so `PASSWORD_RECOVERY` fires
 * wherever the user lands. Without a global handler the user is then silently
 * signed in on the dashboard and never asked for a new password.
 */

const hoisted = vi.hoisted(() => ({
  authCallback: null as null | ((event: string, session: unknown) => void),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        hoisted.authCallback = cb;
        return {data: {subscription: {unsubscribe: () => {}}}};
      },
      getSession: () => Promise.resolve({data: {session: null}, error: null}),
      signOut: () => Promise.resolve({error: null}),
    },
  },
}));

import {AuthProvider} from '@/contexts/AuthContext';

function LocationProbe() {
  const {pathname} = useLocation();
  return <span data-testid="path">{pathname}</span>;
}

// A session with no access_token skips the issuer/alg check in
// validateSessionForEnv, which is not what this test is about.
const recoverySession = {user: {id: 'u1'}};

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <LocationProbe />
      </AuthProvider>
    </MemoryRouter>,
  );

const emit = async (event: string) => {
  // Guard the precondition: without a captured callback every assertion below
  // would pass vacuously.
  expect(hoisted.authCallback).not.toBeNull();
  await act(async () => {
    hoisted.authCallback!(event, recoverySession);
  });
};

describe('AuthProvider — password recovery', () => {
  beforeEach(() => {
    hoisted.authCallback = null;
  });

  it('routes to the reset form when recovery fires on the dashboard', async () => {
    renderAt('/');
    expect(screen.getByTestId('path').textContent).toBe('/');

    await emit('PASSWORD_RECOVERY');

    await waitFor(() =>
      expect(screen.getByTestId('path').textContent).toBe('/auth/reset-password'),
    );
  });

  it('stays put when recovery fires on the reset form itself', async () => {
    renderAt('/auth/reset-password');

    await emit('PASSWORD_RECOVERY');

    expect(screen.getByTestId('path').textContent).toBe('/auth/reset-password');
  });

  it('leaves an ordinary sign-in where it is', async () => {
    renderAt('/');

    await emit('SIGNED_IN');

    expect(screen.getByTestId('path').textContent).toBe('/');
  });
});
