import {useState} from 'react';
import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter, useLocation, useNavigate} from 'react-router';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));
const hookState = vi.hoisted(() => ({
  staleFields: [] as string[],
  loadLatest: vi.fn(),
  keepMine: vi.fn(),
}));
// Stateful: an edit through a section's onChange really flips hasUnsavedChanges.
vi.mock('@/hooks/useProjectSettings', () => ({
  useProjectSettings: () => {
    const [dirty, setDirty] = useState(false);
    return {
      project: {id: 'p1', name: 'P'},
      loading: false,
      hasUnsavedChanges: dirty,
      updateProject: () => setDirty(true),
      saveProject: vi.fn(),
      loadProject: vi.fn(),
      staleFields: hookState.staleFields,
      loadLatest: hookState.loadLatest,
      keepMine: hookState.keepMine,
    };
  },
}));
vi.mock('@/hooks/useProjectMemberRole', () => ({
  useProjectMemberRole: () => ({isManager: true}),
}));
// The sections are stubs: this file pins navigation wiring only.
vi.mock('@/components/project/settings/BasicInfoSection', () => ({
  BasicInfoSection: ({onChange}: {onChange: (patch: object) => void}) => (
    <button type="button" data-testid="section-basic" onClick={() => onChange({name: 'edited'})}>
      edit
    </button>
  ),
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

beforeEach(() => {
  vi.clearAllMocks();
  hookState.staleFields = [];
});

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

  it('owns a p-2 gutter and no centred 1920px wrapper (the section owns the width)', () => {
    renderAt('?tab=settings&section=basic');
    const inner = screen.getByRole('main').firstElementChild;
    expect(inner).toHaveClass('p-2');
    for (const old of ['max-w-[1920px]', 'mx-auto', 'px-6', 'py-6', 'lg:px-8', 'lg:py-8']) {
      expect(inner).not.toHaveClass(old);
    }
  });
});

describe('ProjectSettings header (no layout shift on the first edit)', () => {
  const header = (container: HTMLElement) => container.querySelector('[data-slot="page-header"]');

  it('keeps the same header mounted before and after the form becomes dirty', async () => {
    const {container} = renderAt('?tab=settings&section=basic');
    const before = header(container);
    expect(before).not.toBeNull();
    expect(screen.queryByRole('button', {name: /settingsSaveChanges/})).toBeNull();

    await userEvent.click(screen.getByTestId('section-basic'));

    // Same node, not a remount: the header reserved its row from the first paint.
    expect(header(container)).toBe(before);
    expect(within(before as HTMLElement).getByRole('button', {name: /settingsSaveChanges/})).toBeInTheDocument();
  });

  it('renders no title in the header (the breadcrumb names the page, #901)', () => {
    const {container} = renderAt('?tab=settings&section=basic');
    expect(header(container)?.textContent).toBe('');
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

describe('ProjectSettings stale banner', () => {
  it('shows no banner while nothing is stale', () => {
    renderAt('?tab=settings&section=basic');
    expect(screen.queryByTestId('project-settings-stale-banner')).toBeNull();
  });

  it('names the contested fields and wires Load latest / Keep mine', async () => {
    hookState.staleFields = ['name', 'review_keywords'];
    renderAt('?tab=settings&section=basic');

    const banner = screen.getByTestId('project-settings-stale-banner');
    expect(banner).toHaveAttribute('role', 'alert');
    expect(banner).toHaveTextContent('staleBannerMessage');
    expect(banner).toHaveTextContent('basicProjectNameLabel');
    expect(banner).toHaveTextContent('advancedCardKeywordsTitle');

    await userEvent.click(within(banner).getByRole('button', {name: 'staleLoadLatest'}));
    expect(hookState.loadLatest).toHaveBeenCalledTimes(1);
    await userEvent.click(within(banner).getByRole('button', {name: 'staleKeepMine'}));
    expect(hookState.keepMine).toHaveBeenCalledTimes(1);
  });
});
