import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {TooltipProvider} from '@/components/ui/tooltip';
import {ApiError} from '@/integrations/api/client';
import {t} from '@/lib/copy';

vi.mock('@/services/personalAccessTokenService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/personalAccessTokenService')>()),
  fetchMyTokens: vi.fn(),
  createMyToken: vi.fn(),
  revokeMyToken: vi.fn(),
}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn()}}));

import {toast} from 'sonner';
import * as svc from '@/services/personalAccessTokenService';
import {PersonalAccessTokensGroup} from '@/components/user/PersonalAccessTokensGroup';

const ACTIVE = {
  id: 'active-1', name: 'Claude Code', token_prefix: 'prumo_pat_abc123', scope: 'read', status: 'active',
  expires_at: '2026-12-01T12:00:00Z', last_used_at: null, revoked_at: null, created_at: '2026-01-01T00:00:00Z',
} as never;
const EXPIRED = {
  id: 'expired-1', name: 'Old agent', token_prefix: 'prumo_pat_old999', scope: 'read', status: 'expired',
  expires_at: '2026-01-02T12:00:00Z', last_used_at: null, revoked_at: null, created_at: '2025-10-01T00:00:00Z',
} as never;
const REVOKED = {
  id: 'revoked-1', name: 'Retired agent', token_prefix: 'prumo_pat_rev777', scope: 'read_write', status: 'revoked',
  expires_at: '2026-06-01T12:00:00Z', last_used_at: null, revoked_at: '2026-02-03T12:00:00Z', created_at: '2025-11-01T00:00:00Z',
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_API_URL', 'https://api.test');
});
afterEach(() => vi.stubEnv('VITE_API_URL', ''));

function renderGroup() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}});
  const view = render(
    <QueryClientProvider client={client}>
      <TooltipProvider><PersonalAccessTokensGroup /></TooltipProvider>
    </QueryClientProvider>,
  );
  return {client, ...view};
}

async function openCreateDialog() {
  await userEvent.click(screen.getByRole('button', {name: t('personalAccessTokens', 'createButton')}));
  return screen.getByRole('dialog');
}

describe('PersonalAccessTokensGroup', () => {
  it('loading: shows the skeleton list and disables the create button', async () => {
    vi.mocked(svc.fetchMyTokens).mockReturnValue(new Promise(() => {}));
    renderGroup();
    expect(screen.getByLabelText(t('personalAccessTokens', 'listLoading'))).toBeInTheDocument();
    expect(screen.getByRole('button', {name: t('personalAccessTokens', 'createButton')})).toBeDisabled();
  });

  it('empty: shows the empty line, the recommendation and clients note, with an enabled create button', async () => {
    vi.mocked(svc.fetchMyTokens).mockResolvedValue({ok: true, data: []});
    renderGroup();
    await waitFor(() => expect(screen.getByText(t('personalAccessTokens', 'listEmpty'))).toBeInTheDocument());
    expect(screen.getByRole('button', {name: t('personalAccessTokens', 'createButton')})).not.toBeDisabled();
    expect(screen.getByText(t('personalAccessTokens', 'readRecommendation'))).toBeInTheDocument();
    expect(screen.getByText(t('personalAccessTokens', 'clientsNote'))).toBeInTheDocument();
  });

  it('list error: shows the error and retry; retry refetches and the create button stays enabled', async () => {
    vi.mocked(svc.fetchMyTokens)
      .mockResolvedValueOnce({ok: false, error: new Error('x')})
      .mockResolvedValue({ok: true, data: [ACTIVE]});
    renderGroup();
    await waitFor(() => expect(screen.getByText(t('personalAccessTokens', 'listLoadError'))).toBeInTheDocument());
    expect(screen.getByRole('button', {name: t('personalAccessTokens', 'createButton')})).not.toBeDisabled();
    await userEvent.click(screen.getByRole('button', {name: t('personalAccessTokens', 'retry')}));
    await waitFor(() => expect(screen.getByText('Claude Code')).toBeInTheDocument());
  });

  it('rows: active shows its data and a revoke control; expired and revoked are muted with no revoke control', async () => {
    vi.mocked(svc.fetchMyTokens).mockResolvedValue({ok: true, data: [ACTIVE, EXPIRED, REVOKED]});
    renderGroup();
    await waitFor(() => expect(screen.getByText('Claude Code')).toBeInTheDocument());

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);

    const activeRow = rows[0];
    expect(within(activeRow).getByText('prumo_pat_abc123…')).toBeInTheDocument();
    expect(within(activeRow).getByText(t('personalAccessTokens', 'neverUsed'))).toBeInTheDocument();
    expect(within(activeRow).getByRole('button', {name: t('personalAccessTokens', 'revokeAria')})).toBeInTheDocument();
    expect(activeRow).not.toHaveAttribute('data-muted', 'true');

    const expiredRow = rows[1];
    expect(expiredRow).toHaveAttribute('data-muted', 'true');
    expect(within(expiredRow).getByText('Expired 1/2/2026')).toBeInTheDocument();
    expect(within(expiredRow).queryByRole('button', {name: t('personalAccessTokens', 'revokeAria')})).not.toBeInTheDocument();

    // Narrow widths: the badges wrap under the name instead of squeezing it to "R…".
    const expiredName = within(expiredRow).getByText('Old agent');
    expect(expiredName).toHaveClass('min-w-[12ch]');
    expect(expiredName.parentElement).toHaveClass('flex-wrap');

    const revokedRow = rows[2];
    expect(revokedRow).toHaveAttribute('data-muted', 'true');
    expect(within(revokedRow).getByText('Revoked 2/3/2026')).toBeInTheDocument();
    expect(within(revokedRow).queryByRole('button', {name: t('personalAccessTokens', 'revokeAria')})).not.toBeInTheDocument();
  });

  it('create at the token cap: shows the limit copy inline and keeps the dialog open', async () => {
    vi.mocked(svc.fetchMyTokens).mockResolvedValue({ok: true, data: []});
    vi.mocked(svc.createMyToken).mockResolvedValue({ok: false, error: new ApiError('TOKEN_LIMIT_REACHED', 'limit', 409)});
    renderGroup();
    await waitFor(() => expect(screen.getByText(t('personalAccessTokens', 'listEmpty'))).toBeInTheDocument());

    const dialog = await openCreateDialog();
    await userEvent.type(within(dialog).getByLabelText(t('personalAccessTokens', 'nameLabel')), 'cli');
    await userEvent.click(within(dialog).getByRole('button', {name: t('personalAccessTokens', 'createSubmit')}));

    await waitFor(() => expect(within(dialog).getByText(t('personalAccessTokens', 'createLimitError'))).toBeInTheDocument());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('create validation error: shows the server detail inline and keeps the dialog open', async () => {
    vi.mocked(svc.fetchMyTokens).mockResolvedValue({ok: true, data: []});
    vi.mocked(svc.createMyToken).mockResolvedValue({ok: false, error: new ApiError('VALIDATION_ERROR', 'name: too long', 422)});
    renderGroup();
    await waitFor(() => expect(screen.getByText(t('personalAccessTokens', 'listEmpty'))).toBeInTheDocument());

    const dialog = await openCreateDialog();
    await userEvent.type(within(dialog).getByLabelText(t('personalAccessTokens', 'nameLabel')), 'cli');
    await userEvent.click(within(dialog).getByRole('button', {name: t('personalAccessTokens', 'createSubmit')}));

    await waitFor(() => expect(within(dialog).getByText('name: too long')).toBeInTheDocument());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('reveal: shows the secret once, survives Escape, and clears from state and the mutation cache on done', async () => {
    vi.mocked(svc.fetchMyTokens).mockResolvedValue({ok: true, data: []});
    vi.mocked(svc.createMyToken).mockResolvedValue({ok: true, data: {secret: 'prumo_pat_SECRET', token: ACTIVE}});
    const {client} = renderGroup();
    await waitFor(() => expect(screen.getByText(t('personalAccessTokens', 'listEmpty'))).toBeInTheDocument());

    const dialog = await openCreateDialog();
    await userEvent.type(within(dialog).getByLabelText(t('personalAccessTokens', 'nameLabel')), 'cli');
    await userEvent.click(within(dialog).getByRole('button', {name: t('personalAccessTokens', 'createSubmit')}));

    await waitFor(() => expect(screen.getByText(t('personalAccessTokens', 'revealTitle'))).toBeInTheDocument());
    expect(screen.getByText('prumo_pat_SECRET')).toBeInTheDocument();
    expect(screen.getByText(t('personalAccessTokens', 'revealWarning'))).toBeInTheDocument();
    expect(screen.getByText(t('personalAccessTokens', 'tokenLabel'))).toBeInTheDocument();
    expect(screen.getByRole('button', {name: t('personalAccessTokens', 'copyTokenAria')})).toBeInTheDocument();

    for (const key of ['chipClaudeCode', 'chipCursor', 'chipVsCode', 'chipGeminiCli', 'chipCodex', 'chipWindsurf'] as const) {
      expect(screen.getByRole('radio', {name: t('personalAccessTokens', key)})).toBeInTheDocument();
    }
    expect(screen.getByText('claude mcp add --transport http prumo https://api.test/mcp --header "Authorization: Bearer prumo_pat_SECRET"')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', {name: t('personalAccessTokens', 'chipCursor')}));
    const cursorPre = screen.getAllByText((_, el) => el?.tagName === 'PRE' && (el.textContent ?? '').startsWith('{'))[0];
    expect(JSON.parse(cursorPre.textContent ?? '')).toEqual({
      mcpServers: {prumo: {url: 'https://api.test/mcp', headers: {Authorization: 'Bearer prumo_pat_SECRET'}}},
    });

    await userEvent.keyboard('{Escape}');
    expect(screen.getByText('prumo_pat_SECRET')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', {name: t('personalAccessTokens', 'revealDone')}));
    expect(screen.queryByText('prumo_pat_SECRET')).toBeNull();
    await waitFor(() =>
      expect(
        JSON.stringify(client.getMutationCache().getAll().map((m) => m.state.data)),
      ).not.toContain('prumo_pat_SECRET'),
    );
  });

  it('revoke: confirms, disables while pending, then toasts success', async () => {
    vi.mocked(svc.fetchMyTokens).mockResolvedValue({ok: true, data: [ACTIVE]});
    let resolveRevoke: (v: {ok: true; data: undefined}) => void = () => {};
    vi.mocked(svc.revokeMyToken).mockReturnValue(new Promise((resolve) => { resolveRevoke = resolve; }));
    renderGroup();
    await waitFor(() => expect(screen.getByText('Claude Code')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', {name: t('personalAccessTokens', 'revokeAria')}));
    const alert = screen.getByRole('alertdialog');
    expect(within(alert).getByText(/Claude Code/)).toBeInTheDocument();

    await userEvent.click(within(alert).getByRole('button', {name: t('personalAccessTokens', 'revokeConfirm')}));
    const confirmButton = within(alert).getByRole('button', {name: t('personalAccessTokens', 'revoking')});
    expect(confirmButton).toBeDisabled();

    resolveRevoke({ok: true, data: undefined});
    await waitFor(() => expect(svc.revokeMyToken).toHaveBeenCalledWith('active-1'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(t('personalAccessTokens', 'revokeSuccess')));
  });

  it('revoke: Cancel closes the confirmation dialog without revoking', async () => {
    vi.mocked(svc.fetchMyTokens).mockResolvedValue({ok: true, data: [ACTIVE]});
    renderGroup();
    await waitFor(() => expect(screen.getByText('Claude Code')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', {name: t('personalAccessTokens', 'revokeAria')}));
    const alert = screen.getByRole('alertdialog');

    await userEvent.click(within(alert).getByRole('button', {name: t('personalAccessTokens', 'cancel')}));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(svc.revokeMyToken).not.toHaveBeenCalled();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
  });

  it('revoke error: toasts the server message and keeps the row', async () => {
    vi.mocked(svc.fetchMyTokens).mockResolvedValue({ok: true, data: [ACTIVE]});
    vi.mocked(svc.revokeMyToken).mockResolvedValue({ok: false, error: new Error('gone')});
    renderGroup();
    await waitFor(() => expect(screen.getByText('Claude Code')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', {name: t('personalAccessTokens', 'revokeAria')}));
    const alert = screen.getByRole('alertdialog');
    await userEvent.click(within(alert).getByRole('button', {name: t('personalAccessTokens', 'revokeConfirm')}));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('gone'));
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
  });

  it('reveal closed over a populated list: only the prefix stays on screen', async () => {
    const created = {...(ACTIVE as object), id: 'new-1', name: 'cli', token_prefix: 'prumo_pat_new456'} as never;
    vi.mocked(svc.fetchMyTokens).mockResolvedValue({ok: true, data: [ACTIVE]});
    vi.mocked(svc.createMyToken).mockResolvedValue({ok: true, data: {secret: 'prumo_pat_new456SECRETTAIL', token: created}});
    renderGroup();
    await waitFor(() => expect(screen.getByText('Claude Code')).toBeInTheDocument());

    const dialog = await openCreateDialog();
    await userEvent.type(within(dialog).getByLabelText(t('personalAccessTokens', 'nameLabel')), 'cli');
    vi.mocked(svc.fetchMyTokens).mockResolvedValue({ok: true, data: [created, ACTIVE]});
    await userEvent.click(within(dialog).getByRole('button', {name: t('personalAccessTokens', 'createSubmit')}));
    await waitFor(() => expect(screen.getByText('prumo_pat_new456SECRETTAIL')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', {name: t('personalAccessTokens', 'revealDone')}));
    await waitFor(() => expect(screen.getByText('prumo_pat_new456…')).toBeInTheDocument());
    expect(document.body.textContent).not.toContain('SECRETTAIL');
  });
});
