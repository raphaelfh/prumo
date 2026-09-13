/** Review consensus as a flat settings page (spec 2026-09-13 §4.3, §10). */
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/hooks/useProjectMemberRole', () => ({useProjectMemberRole: vi.fn()}));
vi.mock('@/hooks/useCurrentUser', () => ({useCurrentUser: () => ({userId: 'u1'})}));
vi.mock('@/hooks/shared/useComparisonPermissions', () => ({useComparisonPermissions: vi.fn()}));
vi.mock('@/hooks/hitl/useHitlConfig', () => ({
  useProjectHitlConfig: vi.fn(),
  useUpsertProjectHitlConfig: vi.fn(),
  useClearProjectHitlConfig: vi.fn(),
  useTemplateHitlConfig: vi.fn(),
  useUpsertTemplateHitlConfig: vi.fn(),
  useClearTemplateHitlConfig: vi.fn(),
}));
vi.mock('@/hooks/hitl/useProjectMembers', () => ({useProjectMembers: vi.fn()}));
vi.mock('@/hooks/hitl/useProjectTemplates', () => ({useProjectTemplates: vi.fn()}));
vi.mock('@/services/hitlConfigService', () => ({setManagerReviewVisibility: vi.fn()}));
vi.mock('sonner', () => ({toast: Object.assign(vi.fn(), {success: vi.fn(), error: vi.fn()})}));

import {useProjectMemberRole} from '@/hooks/useProjectMemberRole';
import {useComparisonPermissions} from '@/hooks/shared/useComparisonPermissions';
import * as hitl from '@/hooks/hitl/useHitlConfig';
import {useProjectMembers} from '@/hooks/hitl/useProjectMembers';
import {useProjectTemplates} from '@/hooks/hitl/useProjectTemplates';
import {ReviewConsensusSection} from '@/components/project/settings/ReviewConsensusSection';
import {consensus} from '@/lib/copy/consensus';

const MANAGER = {user_id: 'm1', role: 'manager', user_email: 'm@x.org', user_full_name: 'Maria', user_avatar_url: null};

function config(over: Record<string, unknown> = {}) {
  return {scope_kind: 'system_default', scope_id: null, reviewer_count: 1, consensus_rule: 'unanimous', arbitrator_id: null, inherited: true, ...over};
}

function mockConfig(state: {data?: unknown; isLoading?: boolean; isError?: boolean}) {
  vi.mocked(hitl.useProjectHitlConfig).mockReturnValue({isLoading: false, isError: false, ...state} as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useProjectMemberRole).mockReturnValue({isManager: true} as never);
  vi.mocked(useComparisonPermissions).mockReturnValue({loading: false, canSeeOthers: false, canManageBlindMode: true} as never);
  vi.mocked(hitl.useUpsertProjectHitlConfig).mockReturnValue({mutateAsync: vi.fn(), isPending: false} as never);
  vi.mocked(hitl.useClearProjectHitlConfig).mockReturnValue({mutateAsync: vi.fn(), isPending: false} as never);
  vi.mocked(useProjectMembers).mockReturnValue({data: [MANAGER], isLoading: false} as never);
  vi.mocked(useProjectTemplates).mockReturnValue({data: [], isLoading: false} as never);
  mockConfig({data: config()});
});

describe('ReviewConsensusSection', () => {
  it('states the new-runs-only rule as one intro paragraph, not a callout', () => {
    render(<ReviewConsensusSection projectId="p1" />);
    const title = screen.getByText(consensus.runsBannerTitle);
    expect(title).toHaveClass('text-foreground');
    expect(title.closest('p')).toHaveTextContent(consensus.runsBannerBody);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the Current row only for a loaded, non-project scope', () => {
    const {unmount} = render(<ReviewConsensusSection projectId="p1" />);
    expect(screen.getByText(consensus.currentDefaultLabel)).toBeInTheDocument();
    expect(screen.getByText(consensus.currentSystemDefault)).toHaveClass('text-muted-foreground');
    unmount();

    for (const state of [{data: config({scope_kind: 'project'})}, {isLoading: true}, {isError: true}]) {
      mockConfig(state);
      const view = render(<ReviewConsensusSection projectId="p1" />);
      expect(screen.queryByText(consensus.currentSystemDefault)).toBeNull();
      view.unmount();
    }
  });

  it('renders the project-default skeleton as h-8 rows inside the group', () => {
    mockConfig({isLoading: true});
    render(<ReviewConsensusSection projectId="p1" />);
    const group = screen.getByRole('heading', {level: 2, name: consensus.projectDefaultTitle}).parentElement!.parentElement!;
    const skeletons = group.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
    skeletons.forEach((el) => expect(el).toHaveClass('h-8'));
  });

  it('reports a missing arbitrator as the row error the picker points at', () => {
    mockConfig({data: config({scope_kind: 'project', consensus_rule: 'arbitrator'})});
    render(<ReviewConsensusSection projectId="p1" />);
    const errors = screen.getAllByText(consensus.arbitratorRequired);
    expect(errors.some((el) => el.classList.contains('text-destructive'))).toBe(true);
    const picker = screen.getByLabelText(new RegExp(`^${consensus.arbitratorLabel}`));
    const ids = (picker.getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids.map((id) => document.getElementById(id)?.textContent)).toContain(consensus.arbitratorRequired);
  });

  it('renders the visibility switch as a hinted row, and nothing while permissions load', () => {
    const {unmount} = render(<ReviewConsensusSection projectId="p1" />);
    const sw = screen.getByRole('switch', {name: consensus.managerVisibilityLabel});
    const ids = (sw.getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids.map((id) => document.getElementById(id)?.textContent)).toContain(consensus.managerVisibilityHint);
    unmount();

    vi.mocked(useComparisonPermissions).mockReturnValue({loading: true, canSeeOthers: false, canManageBlindMode: false} as never);
    render(<ReviewConsensusSection projectId="p1" />);
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('a non-manager gets a disabled Save, no Reset, and the visibility row disabled', () => {
    vi.mocked(useProjectMemberRole).mockReturnValue({isManager: false} as never);
    vi.mocked(useComparisonPermissions).mockReturnValue({loading: false, canSeeOthers: false, canManageBlindMode: false} as never);
    // Customized, so a manager WOULD see Reset: its absence is the isManager gate.
    mockConfig({data: config({scope_kind: 'project'})});
    render(<ReviewConsensusSection projectId="p1" />);
    expect(screen.getByRole('button', {name: consensus.saveProjectDefault})).toBeDisabled();
    expect(screen.queryByRole('button', {name: consensus.resetProjectDefault})).toBeNull();
    // Today's rules: rendered once permissions load, disabled unless canManageBlindMode.
    const sw = screen.getByRole('switch', {name: consensus.managerVisibilityLabel});
    expect(sw).toBeDisabled();
    expect(sw.closest('.grid')).toHaveClass('@[36rem]/settings:grid-cols-[11rem_minmax(0,1fr)]');
  });

  it('a manager gets a ghost Reset only when customized, and a primary Save', () => {
    const {unmount} = render(<ReviewConsensusSection projectId="p1" />);
    expect(screen.queryByRole('button', {name: consensus.resetProjectDefault})).toBeNull();
    unmount();

    mockConfig({data: config({scope_kind: 'project'})});
    render(<ReviewConsensusSection projectId="p1" />);
    // ui/button.tsx: ghost → hover:bg-accent, default → bg-primary; size sm → text-[13px]
    // (no call-site text override left to beat it through cn()).
    const reset = screen.getByRole('button', {name: consensus.resetProjectDefault});
    expect(reset).toHaveClass('hover:bg-accent', 'text-[13px]');
    expect(reset).not.toHaveClass('bg-primary');
    const save = screen.getByRole('button', {name: consensus.saveProjectDefault});
    expect(save).toHaveClass('bg-primary', 'text-[13px]');
    expect(save).not.toHaveClass('hover:bg-accent');
    expect(save).toBeEnabled();
  });

  it('carries the corrected tab description', () => {
    expect(consensus.tabConsensusDesc).toBe('Consensus rule and arbitrator');
  });
});

const TEMPLATE = {id: 't1', name: 'CHARMS', framework: 'CHARMS'};

function mockTemplate(over: Record<string, unknown> = {}, isLoading = false) {
  vi.mocked(useProjectTemplates).mockImplementation((({kind}: {kind: string}) =>
    ({data: kind === 'extraction' ? [TEMPLATE] : [], isLoading: false})) as never);
  vi.mocked(hitl.useTemplateHitlConfig).mockReturnValue({
    data: isLoading ? undefined : config({scope_kind: 'template', inherited: true, ...over}),
    isLoading,
  } as never);
  vi.mocked(hitl.useUpsertTemplateHitlConfig).mockReturnValue({mutateAsync: vi.fn(), isPending: false} as never);
  vi.mocked(hitl.useClearTemplateHitlConfig).mockReturnValue({mutateAsync: vi.fn(), isPending: false} as never);
}

describe('ReviewConsensusSection — per-template overrides', () => {
  it('lists overrides as flush row buttons with no frame', () => {
    mockTemplate();
    render(<ReviewConsensusSection projectId="p1" />);
    const list = screen.getByRole('list');
    const row = screen.getByRole('button', {name: /CHARMS/});
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(row).toHaveClass('hover:bg-muted/60');
    for (const el of [list, screen.getByRole('listitem'), row]) {
      expect(el.className).not.toMatch(/(?:^|\s)border(?:\s|$)/);
    }
    expect(row).toHaveTextContent(consensus.templatesInheritsBadge);
  });

  it('expands into rule rows and ghost/primary actions', async () => {
    mockTemplate({inherited: false});
    render(<ReviewConsensusSection projectId="p1" />);
    await userEvent.click(screen.getByRole('button', {name: /CHARMS/}));
    // project default rule + this override's rule
    expect(screen.getAllByText(consensus.ruleLabel)).toHaveLength(2);
    expect(screen.getByRole('button', {name: consensus.templatesRemoveOverride})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: consensus.save})).toBeInTheDocument();
  });

  it('keeps loading and empty states as muted lines inside the group', () => {
    vi.mocked(useProjectTemplates).mockReturnValue({data: undefined, isLoading: true} as never);
    const {unmount} = render(<ReviewConsensusSection projectId="p1" />);
    expect(screen.getByText(consensus.templatesLoading)).toHaveClass('text-[13px]', 'text-muted-foreground');
    unmount();
    vi.mocked(useProjectTemplates).mockReturnValue({data: [], isLoading: false} as never);
    render(<ReviewConsensusSection projectId="p1" />);
    expect(screen.getByText(consensus.templatesEmpty)).toHaveClass('text-[13px]', 'text-muted-foreground');
  });

  it('renders the expanded-body skeleton as h-8 rows', async () => {
    mockTemplate({}, true);
    render(<ReviewConsensusSection projectId="p1" />);
    await userEvent.click(screen.getByRole('button', {name: /CHARMS/}));
    const item = screen.getByRole('listitem');
    const bodySkeletons = [...item.querySelectorAll('.animate-pulse')].filter((el) => !el.closest('button'));
    expect(bodySkeletons.length).toBe(2);
    bodySkeletons.forEach((el) => expect(el).toHaveClass('h-8'));
  });
});
