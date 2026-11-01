/**
 * ProjectView renders the Screening and PRISMA tabs themselves, no longer
 * the coming-soon placeholder.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter, Route, Routes} from 'react-router';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn(), warning: vi.fn()}}));
vi.mock('@/services/projectsService', () => ({
    loadProjectById: vi.fn(),
    loadProjectArticles: vi.fn(),
}));
vi.mock('@/components/screening/ScreeningTab', () => ({
    ScreeningTab: ({projectId}: {projectId: string}) => <div data-testid="screening-tab" data-project-id={projectId}/>,
}));
// Each import dialog reports completion through `onImportComplete`; the stub
// exposes that callback as a button so a test can fire it.
vi.mock('@/components/articles/ZoteroImportDialog', () => ({
    ZoteroImportDialog: ({onImportComplete}: {onImportComplete: () => void}) => (
        <button type="button" onClick={onImportComplete}>zotero import complete</button>
    ),
}));
vi.mock('@/components/articles/RISImportDialog', () => ({
    RISImportDialog: ({onImportComplete}: {onImportComplete: () => void}) => (
        <button type="button" onClick={onImportComplete}>ris import complete</button>
    ),
}));
vi.mock('@/components/prisma/PrismaCountsPanel', () => ({
    PrismaCountsPanel: ({projectId}: {projectId: string}) => <div data-testid="prisma-panel" data-project-id={projectId}/>,
}));

import ProjectView from '@/pages/ProjectView';
import {ProjectProvider} from '@/contexts/ProjectContext';
import {loadProjectArticles, loadProjectById} from '@/services/projectsService';
import {screeningKeys} from '@/lib/query-keys/screening';

function renderAt(path: string) {
    // ProjectView polls a tracked PubMed import run through TanStack Query.
    const client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0}}});
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const view = render(
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[path]}>
                <ProjectProvider>
                    <Routes>
                        <Route path="/projects/:projectId" element={<ProjectView/>}/>
                    </Routes>
                </ProjectProvider>
            </MemoryRouter>
        </QueryClientProvider>,
    );
    return {...view, invalidate};
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadProjectById).mockResolvedValue({
        ok: true,
        data: {id: 'p1', name: 'Project', description: null, review_title: null, condition_studied: null},
    } as never);
    vi.mocked(loadProjectArticles).mockResolvedValue({ok: true, data: []} as never);
});

describe('ProjectView screening tab', () => {
    it('renders the screening tab for ?tab=screening', async () => {
        renderAt('/projects/p1?tab=screening');

        const tab = await screen.findByTestId('screening-tab');
        expect(tab).toHaveAttribute('data-project-id', 'p1');
        expect(screen.queryByText('Coming soon')).toBeNull();
    });

    it('renders the PRISMA counts for ?tab=prisma', async () => {
        renderAt('/projects/p1?tab=prisma');

        const panel = await screen.findByTestId('prisma-panel');
        expect(panel).toHaveAttribute('data-project-id', 'p1');
        expect(screen.queryByText('Coming soon')).toBeNull();
    });
});

describe('ProjectView article imports', () => {
    it.each(['zotero import complete', 'ris import complete'])(
        'reloads the articles and invalidates the screening reads after %s',
        async (button) => {
            const user = userEvent.setup();
            const {invalidate} = renderAt('/projects/p1?tab=screening');
            await screen.findByTestId('screening-tab');
            expect(loadProjectArticles).toHaveBeenCalledTimes(1);

            await user.click(screen.getByRole('button', {name: button}));

            await waitFor(() => expect(loadProjectArticles).toHaveBeenCalledTimes(2));
            expect(invalidate).toHaveBeenCalledWith({queryKey: screeningKeys.project('p1')});
        },
    );
});
