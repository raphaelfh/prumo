/**
 * Topbar is global — it renders on every page — so a page-specific control
 * (the Articles panel toggle) cannot be wired in as a prop without coupling
 * the global shell to one feature. Instead Topbar exposes a generic
 * header-actions SLOT (`HeaderActionsContext`) that any page can fill via
 * `useSetHeaderActions`; Topbar itself only reads the slot, never a feature
 * name.
 *
 * Two things must hold: a page that fills the slot sees its action appear to
 * the right of the notification icon, and a page that fills nothing leaves
 * Topbar rendering exactly what it renders today.
 */
import {describe, expect, it, vi} from 'vitest';
import {render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {Topbar} from '@/components/navigation/Topbar';
import {SidebarProvider} from '@/contexts/SidebarContext';
import {HeaderActionsProvider, useSetHeaderActions} from '@/contexts/HeaderActionsContext';

vi.mock('@/hooks/useNavigation', () => ({
    useUserProfile: () => ({
        user: {id: 'u1', name: 'Test User', email: 't@example.com', initials: 'T'},
        isLoading: false,
        error: null,
        refreshProfile: vi.fn(),
    }),
}));

vi.mock('@/components/navigation/NotificationCenter', () => ({
    NotificationCenter: () => <div data-testid="notification-center" />,
}));

vi.mock('@/hooks/useProjectsQuery', () => ({
    useProjectsQuery: () => ({data: [], isLoading: false, isError: false, refetch: vi.fn()}),
}));

vi.mock('@/hooks/useProjectMemberRole', () => ({
    useProjectMemberRole: () => ({role: 'reviewer', isManager: false, loading: false}),
}));

function Harness({children}: {children?: React.ReactNode}) {
    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
    return (
        <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={['/']}>
                <SidebarProvider>
                    <HeaderActionsProvider>
                        <Topbar />
                        {children}
                    </HeaderActionsProvider>
                </SidebarProvider>
            </MemoryRouter>
        </QueryClientProvider>
    );
}

function PageFillingSlot() {
    useSetHeaderActions(<button aria-label="Test page action">Test page action</button>);
    return null;
}

describe('Topbar header-actions slot', () => {
    it('renders unchanged when no page fills the slot', () => {
        render(<Harness />);

        expect(screen.getByTestId('notification-center')).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: 'Test page action'})).not.toBeInTheDocument();
    });

    it('renders a page-provided action to the right of the notification icon', () => {
        render(
            <Harness>
                <PageFillingSlot />
            </Harness>,
        );

        const notificationCenter = screen.getByTestId('notification-center');
        const action = screen.getByRole('button', {name: 'Test page action'});
        expect(action).toBeInTheDocument();
        // "immediately to the right of the notification icon": the action's DOM
        // position follows the notification center within their shared container.
        expect(
            notificationCenter.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
    });
});
