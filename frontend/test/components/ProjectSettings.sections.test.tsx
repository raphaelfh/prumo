import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter, useLocation, useNavigate} from 'react-router';
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
vi.mock('@/components/project/settings/ReviewQuestionSection', () => ({
  ReviewQuestionSection: ({onDirtyChange}: {onDirtyChange: (d: boolean) => void}) => (
    <button type="button" data-testid="section-review-question" onClick={() => onDirtyChange(true)}>
      dirty
    </button>
  ),
}));

import {ProjectSettings} from '@/components/project/ProjectSettings';

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="search">{location.search}</output>;
}

/** Mimics the sidebar's `/projects/${id}?tab=${item.id}` link: navigates WITHOUT `section`. */
function NavigateToConfigTab() {
  const navigate = useNavigate();
  return (
    <button type="button" data-testid="sidebar-configuration-link" onClick={() => navigate('/projects/p1?tab=settings')}>
      sidebar
    </button>
  );
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

describe('ProjectSettings unsaved review question', () => {
  it('asks before leaving a dirty review question, and Cancel stays', async () => {
    renderAt('?tab=settings&section=review-question');
    await userEvent.click(screen.getByTestId('section-review-question'));
    await userEvent.click(screen.getByRole('button', {name: 'tabTeam'}));

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', {name: 'settingsDiscardCancel'}));
    expect(screen.getByTestId('section-review-question')).toBeInTheDocument();
  });

  it('Discard switches to the section that was clicked', async () => {
    renderAt('?tab=settings&section=review-question');
    await userEvent.click(screen.getByTestId('section-review-question'));
    await userEvent.click(screen.getByRole('button', {name: 'tabTeam'}));
    await userEvent.click(screen.getByRole('button', {name: 'settingsDiscardConfirm'}));

    expect(screen.getByTestId('section-team')).toBeInTheDocument();
  });

  it('switches without asking while the review question is clean', async () => {
    renderAt('?tab=settings&section=review-question');
    await userEvent.click(screen.getByRole('button', {name: 'tabTeam'}));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByTestId('section-team')).toBeInTheDocument();
  });

  it('resets the dirty flag when the section changes outside the rail (sidebar link)', async () => {
    render(
      <MemoryRouter initialEntries={['/projects/p1?tab=settings&section=review-question']}>
        <ProjectSettings projectId="p1" />
        <NavigateToConfigTab />
        <LocationProbe />
      </MemoryRouter>,
    );

    // Make review-question dirty.
    await userEvent.click(screen.getByTestId('section-review-question'));

    // Sidebar-style navigation: rewrites the query WITHOUT `section`.
    await userEvent.click(screen.getByTestId('sidebar-configuration-link'));
    expect(screen.getByTestId('section-basic')).toBeInTheDocument();

    // Reopen review question (clean — do not click the dirty stub again).
    await userEvent.click(screen.getByRole('button', {name: 'tabReviewQuestion'}));
    expect(screen.getByTestId('section-review-question')).toBeInTheDocument();

    // Now navigate away via the rail: must NOT prompt to discard.
    await userEvent.click(screen.getByRole('button', {name: 'tabTeam'}));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByTestId('section-team')).toBeInTheDocument();
  });
});
