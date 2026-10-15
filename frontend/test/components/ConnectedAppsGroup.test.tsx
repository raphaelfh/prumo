import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {TooltipProvider} from '@/components/ui/tooltip';
import {ApiError} from '@/integrations/api/client';
import {t} from '@/lib/copy';

vi.mock('@/services/oauthConnectionsService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/oauthConnectionsService')>()),
  fetchMyConnections: vi.fn(),
  revokeMyConnection: vi.fn(),
}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn()}}));

import {toast} from 'sonner';
import * as svc from '@/services/oauthConnectionsService';
import {ConnectedAppsGroup} from '@/components/user/ConnectedAppsGroup';

const BASE = {
  created_at: '2026-01-01T12:00:00Z',
  expires_at: '2026-04-01T12:00:00Z',
  last_used_at: null,
};
const READ_ONLY = {...BASE, id: 'c-read', client_name: 'Reader app', scope: 'read', status: 'active'} as never;
const READ_WRITE = {
  ...BASE, id: 'c-rw', client_name: 'Editor app', scope: 'read_write', status: 'active', last_used_at: '2025-01-01T12:00:00Z',
} as never;
const REVOKED = {...BASE, id: 'c-revoked', client_name: 'Old app', scope: 'read', status: 'revoked'} as never;
const EXPIRED = {...BASE, id: 'c-expired', client_name: 'Stale app', scope: 'read_write', status: 'expired'} as never;

beforeEach(() => vi.clearAllMocks());

function renderGroup() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}});
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider><ConnectedAppsGroup /></TooltipProvider>
    </QueryClientProvider>,
  );
}

function rowFor(name: string): HTMLElement {
  const row = screen.getByText(name).closest('li');
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

const revokeButtonName = t('connectedApps', 'revokeLabel');

describe('ConnectedAppsGroup', () => {
  it('renders its heading with a hint control', async () => {
    vi.mocked(svc.fetchMyConnections).mockResolvedValue({ok: true, data: []});
    renderGroup();
    expect(screen.getByRole('heading', {level: 2, name: 'Connected apps'})).toBeInTheDocument();
    expect(
      screen.getByRole('button', {name: t('common', 'fieldHintAria').replace('{{label}}', 'Connected apps')}),
    ).toBeInTheDocument();
  });

  it('loading: shows the skeleton list', () => {
    vi.mocked(svc.fetchMyConnections).mockReturnValue(new Promise(() => {}));
    renderGroup();
    expect(screen.getByLabelText(t('connectedApps', 'listLoading'))).toBeInTheDocument();
  });

  it('empty: shows the empty line', async () => {
    vi.mocked(svc.fetchMyConnections).mockResolvedValue({ok: true, data: []});
    renderGroup();
    expect(await screen.findByText('No apps connected')).toBeInTheDocument();
  });

  it('a read row shows only the Read badge, never-used text and a revoke control', async () => {
    vi.mocked(svc.fetchMyConnections).mockResolvedValue({ok: true, data: [READ_ONLY]});
    renderGroup();
    await screen.findByText('Reader app');

    const row = rowFor('Reader app');
    expect(within(row).getByText('Read')).toBeInTheDocument();
    expect(within(row).queryByText('Edits')).not.toBeInTheDocument();
    expect(within(row).getByText(t('connectedApps', 'neverUsed'))).toBeInTheDocument();
    expect(within(row).getByRole('button', {name: revokeButtonName})).toBeInTheDocument();
  });

  it('a read_write row shows the Read and Edits badges and its last use', async () => {
    vi.mocked(svc.fetchMyConnections).mockResolvedValue({ok: true, data: [READ_WRITE]});
    renderGroup();
    await screen.findByText('Editor app');

    const row = rowFor('Editor app');
    expect(within(row).getByText('Read')).toBeInTheDocument();
    expect(within(row).getByText('Edits')).toBeInTheDocument();
    expect(within(row).getByText('Last used 1/1/2025')).toBeInTheDocument();
  });

  it('revoked and expired rows show their status badge, are muted, and offer no revoke', async () => {
    vi.mocked(svc.fetchMyConnections).mockResolvedValue({ok: true, data: [REVOKED, EXPIRED]});
    renderGroup();
    await screen.findByText('Old app');

    const revoked = rowFor('Old app');
    expect(within(revoked).getByText('Revoked')).toBeInTheDocument();
    expect(revoked).toHaveAttribute('data-muted', 'true');
    expect(within(revoked).queryByRole('button', {name: revokeButtonName})).not.toBeInTheDocument();

    const expired = rowFor('Stale app');
    expect(within(expired).getByText('Expired')).toBeInTheDocument();
    expect(expired).toHaveAttribute('data-muted', 'true');
    expect(within(expired).queryByRole('button', {name: revokeButtonName})).not.toBeInTheDocument();
  });

  it('revoke: the confirm calls the service with the row id, disables while pending, then toasts', async () => {
    vi.mocked(svc.fetchMyConnections).mockResolvedValue({ok: true, data: [READ_ONLY, READ_WRITE]});
    let resolveRevoke: (v: {ok: true; data: undefined}) => void = () => {};
    vi.mocked(svc.revokeMyConnection).mockReturnValue(new Promise((resolve) => { resolveRevoke = resolve; }));
    const user = userEvent.setup();
    renderGroup();
    await screen.findByText('Editor app');

    await user.click(within(rowFor('Editor app')).getByRole('button', {name: revokeButtonName}));
    const alert = screen.getByRole('alertdialog');
    expect(within(alert).getByText(/Editor app/)).toBeInTheDocument();

    const confirm = within(alert).getByRole('button', {name: t('connectedApps', 'revokeConfirm')});
    await user.click(confirm);
    expect(svc.revokeMyConnection).toHaveBeenCalledWith('c-rw');
    await waitFor(() => expect(confirm).toBeDisabled());

    resolveRevoke({ok: true, data: undefined});
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(t('connectedApps', 'revoked')));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('revoke: Cancel closes the dialog without revoking', async () => {
    vi.mocked(svc.fetchMyConnections).mockResolvedValue({ok: true, data: [READ_ONLY]});
    const user = userEvent.setup();
    renderGroup();
    await screen.findByText('Reader app');

    await user.click(screen.getByRole('button', {name: revokeButtonName}));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', {name: t('connectedApps', 'revokeCancel')}));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(svc.revokeMyConnection).not.toHaveBeenCalled();
  });

  it('a failing revoke shows the revokeFailed toast and the row stays', async () => {
    vi.mocked(svc.fetchMyConnections).mockResolvedValue({ok: true, data: [READ_ONLY]});
    vi.mocked(svc.revokeMyConnection).mockResolvedValue({
      ok: false, error: new ApiError('INTERNAL_ERROR', 'boom', 500),
    });
    const user = userEvent.setup();
    renderGroup();
    await screen.findByText('Reader app');

    await user.click(screen.getByRole('button', {name: revokeButtonName}));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', {name: t('connectedApps', 'revokeConfirm')}));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(t('connectedApps', 'revokeFailed')));
    expect(toast.success).not.toHaveBeenCalled();
    expect(within(rowFor('Reader app')).getByRole('button', {name: revokeButtonName})).toBeInTheDocument();
  });

  it('load error: shows the error with Retry, which refetches', async () => {
    vi.mocked(svc.fetchMyConnections)
      .mockResolvedValueOnce({ok: false, error: new Error('down')})
      .mockResolvedValue({ok: true, data: [READ_ONLY]});
    const user = userEvent.setup();
    renderGroup();

    expect(await screen.findByText(t('connectedApps', 'listLoadError'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: t('connectedApps', 'retry')}));

    expect(await screen.findByText('Reader app')).toBeInTheDocument();
    expect(svc.fetchMyConnections).toHaveBeenCalledTimes(2);
  });
});
