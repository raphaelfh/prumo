import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { RunWorkspaceShell } from '@/components/runs/RunWorkspaceShell';
import { RunHeader } from '@/components/runs/header';
import { useSidebar } from '@/contexts/SidebarContext';

vi.mock('@/lib/copy', () => ({ t: (_n: string, k: string) => k }));
vi.mock('@/components/layout/ProjectSidebar', () => ({
  ProjectSidebar: ({ activeTab }: { activeTab: string }) => <aside data-testid="project-sidebar">{activeTab}</aside>,
}));
// The footer pulls in the authed user menu; not under test here.
vi.mock('@/components/layout/SidebarFooter', () => ({ SidebarFooter: () => null }));
vi.mock('@/hooks/useProjectsList', () => ({ useProjectsList: () => ({ projects: [], loading: false }) }));

const headerValue = {
  kind: 'extraction' as const,
  stage: 'review' as const,
  isRevision: false,
  isBlind: false,
  canReveal: false,
  progress: { completed: 0, total: 0, pct: 0 },
  reviewers: { count: 0, required: 0, divergent: 0 },
  transition: null,
};

// Reproduces the focus-page wiring: the compact hamburger lives in the header
// and opens the drawer the shell mounts, via shared SidebarContext state.
function HeaderHarness() {
  const { toggleMobile } = useSidebar();
  return (
    <RunHeader value={headerValue}>
      <RunHeader.Left>
        <RunHeader.MobileNav onOpen={toggleMobile} />
      </RunHeader.Left>
    </RunHeader>
  );
}

describe('RunWorkspaceShell', () => {
  it('renders the app sidebar (with the active tab) around its children', () => {
    render(
      <MemoryRouter initialEntries={['/projects/p1/extraction/a1']}>
        <RunWorkspaceShell projectId="p1" activeTab="extraction">
          <div data-testid="page-body">body</div>
        </RunWorkspaceShell>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('project-sidebar')).toHaveTextContent('extraction');
    expect(screen.getByTestId('page-body')).toBeInTheDocument();
  });

  it('reveals reachable project nav through a mobile drawer when the compact hamburger is tapped', async () => {
    render(
      <MemoryRouter initialEntries={['/projects/p1/extraction/a1']}>
        <RunWorkspaceShell projectId="p1" activeTab="extraction">
          <HeaderHarness />
        </RunWorkspaceShell>
      </MemoryRouter>,
    );

    // Drawer closed: project nav items are not reachable (the desktop sidebar is
    // mocked, and the mobile drawer is unmounted while closed).
    expect(screen.queryByRole('button', { name: 'navArticles' })).not.toBeInTheDocument();

    // Tap the compact-tier hamburger.
    await userEvent.click(screen.getByRole('button', { name: 'ariaOpenMenu' }));

    // Drawer open: project nav items are now reachable.
    expect(await screen.findByRole('button', { name: 'navArticles' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'navQualityAssessment' })).toBeInTheDocument();
  });
});
