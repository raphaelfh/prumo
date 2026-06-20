import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ProjectContext } from '@/contexts/ProjectContext';

vi.mock('@/lib/copy', () => ({ t: (_ns: string, key: string) => key }));

const roleMock = vi.fn();
vi.mock('@/hooks/useProjectMemberRole', () => ({
  useProjectMemberRole: () => roleMock(),
}));

import { SectionViewSwitcher } from '@/components/navigation/SectionViewSwitcher';

function renderWith(activeTab: string, initialEntries = ['/projects/p1?tab=extraction']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ProjectContext.Provider
        value={{ project: { id: 'p1' } as never, setProject: vi.fn(), activeTab, changeTab: vi.fn() } as never}
      >
        <SectionViewSwitcher />
      </ProjectContext.Provider>
    </MemoryRouter>,
  );
}

describe('SectionViewSwitcher', () => {
  it('renders nothing for a section without views', () => {
    roleMock.mockReturnValue({ isManager: false, role: null, loading: false });
    const { container } = renderWith('articles');
    expect(container).toBeEmptyDOMElement();
  });

  it('renders Worklist/Dashboard for non-managers (no Configuration)', () => {
    roleMock.mockReturnValue({ isManager: false, role: 'extractor', loading: false });
    renderWith('extraction');
    expect(screen.getByRole('tab', { name: 'tabWorklist' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'tabDashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'tabConfiguration' })).toBeNull();
  });

  it('shows Configuration for managers', () => {
    roleMock.mockReturnValue({ isManager: true, role: 'manager', loading: false });
    renderWith('extraction');
    expect(screen.getByRole('tab', { name: 'tabConfiguration' })).toBeInTheDocument();
  });

  it('preserves the QA data-testid', () => {
    roleMock.mockReturnValue({ isManager: false, role: 'reviewer', loading: false });
    renderWith('quality', ['/projects/p1?tab=quality']);
    expect(screen.getByTestId('hitl-quality_assessment-tab-assessment')).toBeInTheDocument();
  });
});
