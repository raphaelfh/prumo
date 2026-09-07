/**
 * One chrome, two states (spec §4). The no-project assertions also assert
 * their PRECONDITION — that `projectId` really was null — via the positive
 * control below: the same render path with a project id must produce the
 * project rail, so an empty render cannot pass either group vacuously.
 */
import {describe, expect, it, vi} from 'vitest';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter, Route, Routes, useLocation} from 'react-router';
import {SidebarProvider} from '@/contexts/SidebarContext';
import {TooltipProvider} from '@/components/ui/tooltip';
import {ProjectSidebar} from './ProjectSidebar';

vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));
// The footer pulls in the authed user menu; not under test here.
vi.mock('./SidebarFooter', () => ({SidebarFooter: () => <div data-testid="sidebar-footer" />}));
vi.mock('./SidebarHeader', () => ({
  SidebarHeader: ({projectName}: {projectName?: string}) => (
    <div data-testid="project-switcher">{projectName}</div>
  ),
}));

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="url">{`${location.pathname}${location.search}`}</output>;
}

function renderSidebar(projectId: string | null, path = '/') {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={[path]}>
        <SidebarProvider>
          <Routes>
            <Route
              path="*"
              element={
                <>
                  <ProjectSidebar projectId={projectId} activeTab="articles" projectName="Alpha" />
                  <LocationProbe />
                </>
              }
            />
          </Routes>
        </SidebarProvider>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

describe('ProjectSidebar', () => {
  it('positive control — with a project id it renders the project rail', () => {
    renderSidebar('p1', '/projects/p1');
    expect(screen.getByTestId('project-switcher')).toHaveTextContent('Alpha');
    expect(screen.getByRole('button', {name: 'navArticles'})).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'projects'})).toBeNull();
  });

  it('with no project id it renders brand + WORKSPACE, not the switcher', () => {
    renderSidebar(null, '/');
    expect(screen.queryByTestId('project-switcher')).toBeNull();
    expect(screen.getByText('topbarBrandFull')).toBeInTheDocument();
    expect(screen.getByText('sectionWorkspace')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'projects'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'settings'})).toBeInTheDocument();
    // Project nav is genuinely absent, not merely unrendered chrome.
    expect(screen.queryByRole('button', {name: 'navArticles'})).toBeNull();
  });

  it('keeps the footer in both states', () => {
    renderSidebar(null, '/');
    expect(screen.getByTestId('sidebar-footer')).toBeInTheDocument();
  });

  it('marks the current workspace destination', () => {
    renderSidebar(null, '/settings');
    expect(screen.getByRole('button', {name: 'settings'})).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', {name: 'projects'})).not.toHaveAttribute('aria-current');
  });

  it('navigates a project section by writing the URL', async () => {
    renderSidebar('p1', '/projects/p1?tab=articles');
    await userEvent.click(screen.getByRole('button', {name: 'navDataExtraction'}));
    expect(screen.getByTestId('url')).toHaveTextContent('/projects/p1?tab=extraction');
  });

  it('navigates a workspace destination by writing the URL', async () => {
    renderSidebar(null, '/');
    await userEvent.click(screen.getByRole('button', {name: 'settings'}));
    expect(screen.getByTestId('url')).toHaveTextContent('/settings');
  });
});
