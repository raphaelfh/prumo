/**
 * The sidebar writes the URL; ProjectContext follows (spec §3.2 / §8).
 *
 * The harness mirrors AppShell exactly minus chrome: the sidebar is a sibling
 * of ProjectProvider, not a child, because the shell renders above the
 * provider — so this also pins that the provider's mount-time `?tab=` write
 * does not clobber a section the sidebar just pushed.
 */
import {describe, expect, it, vi} from 'vitest';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter, Route, Routes} from 'react-router';
import {SidebarProvider} from '@/contexts/SidebarContext';
import {TooltipProvider} from '@/components/ui/tooltip';
import {ProjectProvider, useProject} from '@/contexts/ProjectContext';
import {ProjectSidebar} from '@/components/layout/ProjectSidebar';
import {useShellLocation} from '@/hooks/useShellLocation';

vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));
vi.mock('@/components/layout/SidebarFooter', () => ({SidebarFooter: () => null}));
vi.mock('@/components/layout/SidebarHeader', () => ({SidebarHeader: () => null}));

function SectionProbe() {
  const {activeTab} = useProject();
  return <output data-testid="section">{activeTab}</output>;
}

function ShellLike() {
  const {projectId, activeSection} = useShellLocation();
  return (
    <>
      <ProjectSidebar projectId={projectId} activeTab={activeSection ?? ''} />
      <ProjectProvider>
        <SectionProbe />
      </ProjectProvider>
    </>
  );
}

function renderProjectRoute() {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={['/projects/p1?tab=articles']}>
        <SidebarProvider>
          <Routes>
            <Route path="/projects/:projectId" element={<ShellLike />} />
          </Routes>
        </SidebarProvider>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

describe('sidebar navigation reaches ProjectContext', () => {
  it('starts on the section the URL names', () => {
    renderProjectRoute();
    // Precondition for the next test: the probe is live and reads 'articles',
    // so a later 'extraction' cannot be a coincidence of an empty render.
    expect(screen.getByTestId('section')).toHaveTextContent('articles');
  });

  it('a section click changes the section ProjectContext reports', async () => {
    renderProjectRoute();

    await userEvent.click(screen.getByRole('button', {name: 'navDataExtraction'}));

    expect(await screen.findByTestId('section')).toHaveTextContent('extraction');
  });
});
