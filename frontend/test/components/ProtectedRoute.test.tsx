/**
 * Sign-in return path: a signed-out visit to a protected page comes back to
 * that page (query string included) after sign-in, and only a same-origin
 * relative path is honored as the return target.
 */
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter, Route, Routes, useLocation, type InitialEntry} from 'react-router';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const auth = vi.hoisted(() => ({user: null as {id: string} | null}));

vi.mock('@/contexts/AuthContext', () => ({
    useAuth: () => ({user: auth.user, session: null, loading: false, signOut: vi.fn()}),
}));

vi.mock('@/services/authService', () => ({
    signInWithPassword: vi.fn(async () => {
        auth.user = {id: 'u1'};
        return {ok: true, data: undefined};
    }),
    signUp: vi.fn(async () => {
        auth.user = {id: 'u1'};
        return {ok: true, data: {sessionReady: true}};
    }),
    resetPasswordForEmail: vi.fn(),
}));

vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn()}}));

import {ProtectedRoute} from '@/components/ProtectedRoute';
import Auth from '@/pages/Auth';
import {t} from '@/lib/copy';
import {safeReturnPath} from '@/lib/routes';

function LocationProbe() {
    const location = useLocation();
    return <div data-testid="probe">{`${location.pathname}${location.search}`}</div>;
}

function renderAt(entry: InitialEntry) {
    render(
        <MemoryRouter initialEntries={[entry]}>
            <Routes>
                <Route
                    path="/oauth/consent"
                    element={<ProtectedRoute><LocationProbe/></ProtectedRoute>}
                />
                <Route
                    path="/settings"
                    element={<ProtectedRoute><LocationProbe/></ProtectedRoute>}
                />
                <Route path="/auth" element={<Auth/>}/>
                <Route path="/" element={<div>home</div>}/>
            </Routes>
        </MemoryRouter>,
    );
}

async function signIn() {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(t('auth', 'email')), 'a@example.com');
    await user.type(screen.getByLabelText(t('auth', 'password')), 'Secret123');
    await user.click(screen.getByRole('button', {name: t('auth', 'signIn')}));
}

const HOSTILE: unknown[] = ['//evil.example/x', 'https://evil.example/x', '/\\evil.example', 42, undefined];

describe('sign-in return path', () => {
    beforeEach(() => {
        auth.user = null;
    });

    it('returns to the protected page with its query string after sign-in', async () => {
        renderAt('/oauth/consent?request=abc');

        // Precondition: the signed-out visit was sent to the sign-in form.
        expect(screen.getByLabelText(t('auth', 'email'))).toBeInTheDocument();

        await signIn();

        expect(await screen.findByTestId('probe')).toHaveTextContent('/oauth/consent?request=abc');
    });

    it.each(HOSTILE.map((from) => [String(from), from]))(
        'falls back to / for a hostile return target %s',
        async (_label, from) => {
            renderAt({pathname: '/auth', state: {from}});

            await signIn();

            expect(await screen.findByText('home')).toBeInTheDocument();
        },
    );

    it('returns to the requested page after a sign-up that opens a session', async () => {
        renderAt({pathname: '/auth', state: {from: '/settings'}});
        const user = userEvent.setup();

        await user.click(screen.getByRole('button', {name: t('auth', 'createAccount')}));
        await user.type(screen.getByLabelText(t('auth', 'fullName')), 'Ada Lovelace');
        await user.type(screen.getByLabelText(t('auth', 'email')), 'a@example.com');
        await user.type(screen.getByLabelText(t('auth', 'password')), 'Secret123');
        await user.type(screen.getByLabelText(t('auth', 'confirmPassword')), 'Secret123');
        await user.click(screen.getByRole('button', {name: t('auth', 'createAccountButton')}));

        expect(await screen.findByTestId('probe')).toHaveTextContent('/settings');
    });
});

describe('safeReturnPath', () => {
    it('keeps a same-origin relative path with its query and hash', () => {
        expect(safeReturnPath('/a?b=1#c')).toBe('/a?b=1#c');
    });

    it.each(HOSTILE.map((from) => [String(from), from]))('maps %s to /', (_label, from) => {
        expect(safeReturnPath(from)).toBe('/');
    });

    it.each([
        '/.//evil.example',
        '/%2e//evil.example',
        '/%2E/x',
        '/a/../..//evil',
        '/a/%2e%2e/b',
        '/a/.%2E/b',
        '/a/./b',
        '/a//b',
        '/.\\/evil.example',
        '/./\t/evil.example',
    ])('maps the dot-segment or double-slash path %s to /', (from) => {
        expect(safeReturnPath(from)).toBe('/');
    });

    it('keeps a path whose segments merely contain dots', () => {
        expect(safeReturnPath('/projects/v1.2/..x?q=a.b')).toBe('/projects/v1.2/..x?q=a.b');
    });
});
