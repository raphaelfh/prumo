import {afterEach, describe, expect, it, vi} from 'vitest';
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {TooltipProvider} from '@/components/ui/tooltip';
import {PgError} from '@/lib/error-utils';
import {t} from '@/lib/copy';
import type {ProjectMemberRow} from '@/services/projectSettingsService';

const {getMembersMock, removeMock, updateMock} = vi.hoisted(() => ({
  getMembersMock: vi.fn(),
  removeMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock('@/services/projectSettingsService', () => ({
  getProjectMembers: getMembersMock,
  removeProjectMember: removeMock,
  updateMemberRole: updateMock,
  findUserIdByEmail: vi.fn(),
  insertProjectMember: vi.fn(),
}));

const {toastErrorMock, toastSuccessMock} = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));
vi.mock('sonner', () => ({toast: {error: toastErrorMock, success: toastSuccessMock}}));

import {TeamMembersSection} from './TeamMembersSection';

function member(over: Partial<ProjectMemberRow>): ProjectMemberRow {
  return {
    id: 'm1',
    user_id: 'u1',
    role: 'manager',
    user_email: 'alice@example.com',
    user_full_name: 'Alice',
    user_avatar_url: null,
    ...over,
  };
}

function renderSection() {
  return render(
    <TooltipProvider>
      <TeamMembersSection projectId="p1" />
    </TooltipProvider>,
  );
}

const REMOVE_LABEL = t('project', 'teamAriaRemoveMember');
const GUARD_COPY = t('project', 'teamLastManagerGuard');

afterEach(() => {
  vi.clearAllMocks();
});

describe('TeamMembersSection — min-one-manager affordances', () => {
  it('disables Remove for the sole manager', async () => {
    getMembersMock.mockResolvedValue({ok: true, data: [member({})]});
    renderSection();
    const removeBtn = await screen.findByLabelText(REMOVE_LABEL);
    expect(removeBtn).toBeDisabled();
  });

  it('keeps Remove enabled for both when there are two managers', async () => {
    getMembersMock.mockResolvedValue({
      ok: true,
      data: [
        member({id: 'm1', user_id: 'u1'}),
        member({id: 'm2', user_id: 'u2', user_full_name: 'Bob', user_email: 'bob@example.com'}),
      ],
    });
    renderSection();
    await screen.findByText('Alice');
    const removeButtons = screen.getAllByLabelText(REMOVE_LABEL);
    expect(removeButtons).toHaveLength(2);
    for (const btn of removeButtons) expect(btn).toBeEnabled();
  });

  it('toasts the dedicated guard copy when a remove hits PM001 (stale-UI race)', async () => {
    // Two managers => the button is enabled; the DB still rejects (a peer
    // demoted the other manager first), returning PM001 through the service.
    getMembersMock.mockResolvedValue({
      ok: true,
      data: [
        member({id: 'm1', user_id: 'u1'}),
        member({id: 'm2', user_id: 'u2', user_full_name: 'Bob', user_email: 'bob@example.com'}),
      ],
    });
    removeMock.mockResolvedValue({
      ok: false,
      error: new PgError('a project must retain at least one manager', 'PM001'),
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderSection();
    await screen.findByText('Alice');
    await userEvent.click(screen.getAllByLabelText(REMOVE_LABEL)[0]);

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith(GUARD_COPY));
  });

  it('toasts the dedicated guard copy when a role save hits PM001', async () => {
    getMembersMock.mockResolvedValue({
      ok: true,
      data: [
        member({id: 'm1', user_id: 'u1'}),
        member({id: 'm2', user_id: 'u2', user_full_name: 'Bob', user_email: 'bob@example.com'}),
      ],
    });
    updateMock.mockResolvedValue({
      ok: false,
      error: new PgError('a project must retain at least one manager', 'PM001'),
    });

    renderSection();
    await screen.findByText('Alice');
    // Enter edit mode on the first row, then save (role unchanged is fine —
    // the service is mocked to reject with PM001 regardless).
    await userEvent.click(screen.getAllByLabelText(t('project', 'teamAriaEditRole'))[0]);
    await userEvent.click(await screen.findByLabelText(t('project', 'teamAriaSaveChange')));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith(GUARD_COPY));
  });
});

// NOTE: the sole-manager role-Select's disabled non-manager <SelectItem>s are
// intentionally not asserted here. Radix Select renders its items in a portal
// only after a pointer-driven open, which this jsdom setup (no
// hasPointerCapture / scrollIntoView polyfills) cannot drive reliably. The
// `isSoleManager` guard that disables those items is the same expression that
// disables the Remove button (asserted above), and the DB PM001 backstop is
// covered by the backend guard tests + the service-boundary test.
