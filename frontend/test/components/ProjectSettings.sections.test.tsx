import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter, useLocation} from 'react-router';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));
vi.mock('@/hooks/useProjectSettings', () => ({
  useProjectSettings: () => ({
    project: {id: 'p1', name: 'P'},
    loading: false,
    hasUnsavedChanges: false,
    updateProject: vi.fn(),
    saveProject: vi.fn(),
  }),
}));
vi.mock('@/hooks/useProjectMemberRole', () => ({
  useProjectMemberRole: () => ({isManager: true}),
}));
// The sections are stubs: this file pins navigation wiring only.
vi.mock('@/components/project/settings/BasicInfoSection', () => ({
  BasicInfoSection: () => <div data-testid="section-basic" />,
}));
vi.mock('@/components/project/settings/ReviewDetailsSection', () => ({
  ReviewDetailsSection: () => <div data-testid="section-review" />,
}));
vi.mock('@/components/project/settings/AiEngineSection', () => ({
  AiEngineSection: () => <div data-testid="section-ai-engine" />,
}));
vi.mock('@/components/project/settings/TeamMembersSection', () => ({
  TeamMembersSection: () => <div data-testid="section-team" />,
}));
vi.mock('@/components/project/settings/ReviewConsensusSection', () => ({
  ReviewConsensusSection: () => <div data-testid="section-consensus" />,
}));
vi.mock('@/components/project/settings/AdvancedSettingsSection', () => ({
  AdvancedSettingsSection: () => <div data-testid="section-advanced" />,
}));

import {ProjectSettings} from '@/components/project/ProjectSettings';

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="search">{location.search}</output>;
}

function renderAt(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/projects/p1${search}`]}>
      <ProjectSettings projectId="p1" />
      <LocationProbe />
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('ProjectSettings sections', () => {
  it('renders the section named in the URL', () => {
    renderAt('?tab=settings&section=ai-engine');
    expect(screen.getByTestId('section-ai-engine')).toBeInTheDocument();
    expect(screen.queryByTestId('section-review')).toBeNull();
  });

  it('falls back to basic for a missing or unknown section', () => {
    renderAt('?tab=settings&section=nope');
    expect(screen.getByTestId('section-basic')).toBeInTheDocument();
  });

  it('writes the section on a rail click and keeps the other params', async () => {
    renderAt('?tab=settings');
    await userEvent.click(screen.getByRole('button', {name: 'tabAiEngine'}));
    expect(screen.getByTestId('section-ai-engine')).toBeInTheDocument();
    const params = new URLSearchParams(screen.getByTestId('search').textContent ?? '');
    expect(params.get('section')).toBe('ai-engine');
    expect(params.get('tab')).toBe('settings');
  });

  it('no longer stacks the AI engine under review details', () => {
    renderAt('?tab=settings&section=review');
    expect(screen.getByTestId('section-review')).toBeInTheDocument();
    expect(screen.queryByTestId('section-ai-engine')).toBeNull();
  });
});
