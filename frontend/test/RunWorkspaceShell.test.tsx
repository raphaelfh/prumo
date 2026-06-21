import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RunWorkspaceShell } from '@/components/runs/RunWorkspaceShell';

vi.mock('@/lib/copy', () => ({ t: (_n: string, k: string) => k }));
vi.mock('@/components/layout/ProjectSidebar', () => ({
  ProjectSidebar: ({ activeTab }: { activeTab: string }) => <aside data-testid="project-sidebar">{activeTab}</aside>,
}));
// The shell now also renders the mobile-nav drawer; stub it so its import graph
// (AuthContext → supabase client, which createClient-throws without env in CI)
// never loads. Same approach as the ProjectSidebar stub above.
vi.mock('@/components/layout/MobileSidebar', () => ({
  MobileSidebar: () => null,
}));
vi.mock('@/hooks/useProjectsList', () => ({ useProjectsList: () => ({ projects: [], loading: false }) }));

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
});
