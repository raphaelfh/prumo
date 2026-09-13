import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {TooltipProvider} from '@/components/ui/tooltip';
import {t} from '@/lib/copy';

vi.mock('@/services/llmConnectionsService', () => ({
  fetchMyConnections: vi.fn(),
  fetchProviders: vi.fn(),
  fetchProjectConnections: vi.fn(),
  createMyConnection: vi.fn(),
  deleteMyConnection: vi.fn(),
  verifyMyConnection: vi.fn(),
}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn()}}));

import {toast} from 'sonner';

import * as svc from '@/services/llmConnectionsService';
import {AiConnectionsSection} from '@/components/user/AiConnectionsSection';

const OPENAI = {
  id: 'openai', label: 'OpenAI', description: 'GPT models', docs_url: 'https://platform.openai.com/api-keys',
  needs_host: false, key_optional: false, scopes: ['project', 'user'], global_key_available: true,
};
const HOST = {...OPENAI, id: 'openai_compatible', label: 'Custom host', needs_host: true, key_optional: true, scopes: ['user'], global_key_available: false};
const ROW = {
  id: 'c1', scope: 'user', provider: 'openai', label: 'mine', base_url: null, has_api_key: true,
  allowed_models: [], capabilities: {output_mode: null, models_seen: []}, validation_status: 'unverified',
  last_validated_at: null, last_used_at: null, created_by_name: null, created_at: '2026-09-13T00:00:00Z',
} as never;

function renderSection() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}});
  return render(
    <QueryClientProvider client={client}><TooltipProvider><AiConnectionsSection /></TooltipProvider></QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(svc.fetchProviders).mockResolvedValue({ok: true, data: [OPENAI, HOST] as never});
});

describe('AiConnectionsSection', () => {
  it('renders the empty state with the Add action once providers resolve', async () => {
    vi.mocked(svc.fetchMyConnections).mockResolvedValue({ok: true, data: []});
    renderSection();
    expect(screen.getByRole('button', {name: t('llmConnections', 'addButton')})).toBeDisabled();
    await waitFor(() => expect(screen.getByText(t('llmConnections', 'listEmpty'))).toBeInTheDocument());
    expect(screen.getByRole('button', {name: t('llmConnections', 'addButton')})).not.toBeDisabled();
  });

  it('renders the load-error line with a retry that refetches', async () => {
    vi.mocked(svc.fetchMyConnections).mockResolvedValueOnce({ok: false, error: new Error('x')}).mockResolvedValue({ok: true, data: [ROW]});
    renderSection();
    await waitFor(() => expect(screen.getByText(t('llmConnections', 'listLoadError'))).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', {name: t('llmConnections', 'retry')}));
    await waitFor(() => expect(screen.getByText('mine')).toBeInTheDocument());
  });

  it('the host field appears only for a host-bearing provider and the add posts', async () => {
    vi.mocked(svc.fetchMyConnections).mockResolvedValue({ok: true, data: []});
    vi.mocked(svc.createMyConnection).mockResolvedValue({ok: true, data: ROW});
    renderSection();
    await waitFor(() => expect(screen.getByRole('button', {name: t('llmConnections', 'addButton')})).not.toBeDisabled());
    await userEvent.click(screen.getByRole('button', {name: t('llmConnections', 'addButton')}));
    expect(screen.queryByLabelText(t('llmConnections', 'hostLabel'))).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(t('llmConnections', 'labelLabel')), 'mine');
    await userEvent.type(screen.getByLabelText(t('llmConnections', 'keyLabel')), 'sk-test');
    await userEvent.click(screen.getByRole('button', {name: t('llmConnections', 'saveButton')}));
    await waitFor(() => expect(svc.createMyConnection).toHaveBeenCalledWith({provider: 'openai', label: 'mine', api_key: 'sk-test', base_url: null, allowed_models: []}));
  });

  it('remove confirms then deletes', async () => {
    vi.mocked(svc.fetchMyConnections).mockResolvedValue({ok: true, data: [ROW]});
    vi.mocked(svc.deleteMyConnection).mockResolvedValue({ok: true, data: {deleted: true, id: 'c1'}});
    renderSection();
    await waitFor(() => expect(screen.getByText('mine')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', {name: t('llmConnections', 'removeAria')}));
    await userEvent.click(screen.getByRole('button', {name: t('llmConnections', 'removeConfirm')}));
    await waitFor(() => expect(svc.deleteMyConnection).toHaveBeenCalledWith('c1'));
  });

  it('verify calls the service and reports a failed probe with its reason', async () => {
    vi.mocked(svc.fetchMyConnections).mockResolvedValue({ok: true, data: [ROW]});
    vi.mocked(svc.verifyMyConnection).mockResolvedValue({
      ok: true, data: {validation_status: 'failed', output_mode: null, models_seen: [], error: 'unauthorized'},
    });
    renderSection();
    await waitFor(() => expect(screen.getByText('mine')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', {name: t('llmConnections', 'verifyAria')}));
    await waitFor(() => expect(svc.verifyMyConnection).toHaveBeenCalledWith('c1'));
    expect(toast.error).toHaveBeenCalledWith(t('llmConnections', 'verifyFailed').replace('{{reason}}', 'unauthorized'));
  });

  it('a providers read failure shows the load-error line and its retry refetches both reads', async () => {
    vi.mocked(svc.fetchMyConnections).mockResolvedValue({ok: true, data: []});
    vi.mocked(svc.fetchProviders)
      .mockReset()
      .mockResolvedValueOnce({ok: false, error: new Error('x')})
      .mockResolvedValue({ok: true, data: [OPENAI, HOST] as never});
    renderSection();
    await waitFor(() => expect(screen.getByText(t('llmConnections', 'listLoadError'))).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', {name: t('llmConnections', 'retry')}));
    await waitFor(() => expect(screen.getByRole('button', {name: t('llmConnections', 'addButton')})).not.toBeDisabled());
    expect(svc.fetchProviders).toHaveBeenCalledTimes(2);
    expect(svc.fetchMyConnections).toHaveBeenCalledTimes(2);
  });

  it('the key input opts out of autofill and the host clears when the provider changes', async () => {
    vi.mocked(svc.fetchMyConnections).mockResolvedValue({ok: true, data: []});
    renderSection();
    await waitFor(() => expect(screen.getByRole('button', {name: t('llmConnections', 'addButton')})).not.toBeDisabled());
    await userEvent.click(screen.getByRole('button', {name: t('llmConnections', 'addButton')}));
    expect(screen.getByLabelText(t('llmConnections', 'keyLabel'))).toHaveAttribute('autocomplete', 'off');
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(screen.getByRole('option', {name: /Custom host/}));
    await userEvent.type(screen.getByLabelText(t('llmConnections', 'hostLabel')), 'https://h/v1');
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(screen.getByRole('option', {name: /OpenAI/}));
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(screen.getByRole('option', {name: /Custom host/}));
    expect(screen.getByLabelText(t('llmConnections', 'hostLabel'))).toHaveValue('');
  });

  it("a failed create surfaces the server's error detail", async () => {
    vi.mocked(svc.fetchMyConnections).mockResolvedValue({ok: true, data: []});
    vi.mocked(svc.createMyConnection).mockResolvedValue({ok: false, error: new Error('Host must be public')});
    renderSection();
    await waitFor(() => expect(screen.getByRole('button', {name: t('llmConnections', 'addButton')})).not.toBeDisabled());
    await userEvent.click(screen.getByRole('button', {name: t('llmConnections', 'addButton')}));
    await userEvent.type(screen.getByLabelText(t('llmConnections', 'labelLabel')), 'mine');
    await userEvent.type(screen.getByLabelText(t('llmConnections', 'keyLabel')), 'sk-test');
    await userEvent.click(screen.getByRole('button', {name: t('llmConnections', 'saveButton')}));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        t('llmConnections', 'errorDetail')
          .replace('{{error}}', t('llmConnections', 'createError'))
          .replace('{{reason}}', 'Host must be public'),
      ),
    );
  });

  it('is one AI connections group: an h2 title with its hint trigger', async () => {
    vi.mocked(svc.fetchMyConnections).mockResolvedValue({ok: true, data: []});
    const {container} = renderSection();
    const title = t('llmConnections', 'integrationsTitle');
    expect(screen.getByRole('heading', {level: 2, name: title})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: t('common', 'fieldHintAria').replace('{{label}}', title)})).toBeInTheDocument();
    // The group is the component's root: no wrapper and no space-y-* parent.
    expect(container.firstElementChild).toHaveClass('border-t');
    expect(container.querySelector('.space-y-3')).toBeNull();
    await waitFor(() => expect(screen.getByText(t('llmConnections', 'listEmpty'))).toBeInTheDocument());
  });

  it('loading renders h-8 skeleton rows inside the group', () => {
    vi.mocked(svc.fetchMyConnections).mockReturnValue(new Promise(() => {}));
    const {container} = renderSection();
    const list = screen.getByRole('list', {name: t('llmConnections', 'listLoading')});
    expect(container.firstElementChild).toContainElement(list);
    const skeletons = list.querySelectorAll('.animate-pulse');
    expect(skeletons).toHaveLength(2);
    skeletons.forEach((s) => expect(s).toHaveClass('h-8'));
  });

  it('the load error keeps its destructive line, with a ghost Retry, inside the group', async () => {
    vi.mocked(svc.fetchMyConnections).mockResolvedValue({ok: false, error: new Error('x')});
    const {container} = renderSection();
    const line = await screen.findByText(t('llmConnections', 'listLoadError'));
    expect(line).toHaveClass('text-[13px]', 'text-destructive');
    expect(container.firstElementChild).toContainElement(line);
    const retry = screen.getByRole('button', {name: t('llmConnections', 'retry')});
    expect(retry).toHaveClass('active:bg-accent/80');
    expect(retry).not.toHaveClass('border');
  });

  it('connections are a flush list with no dividers; Add connection is ghost', async () => {
    vi.mocked(svc.fetchMyConnections).mockResolvedValue({ok: true, data: [ROW]});
    renderSection();
    await waitFor(() => expect(screen.getByText('mine')).toBeInTheDocument());
    const list = screen.getByRole('list');
    expect(list).not.toHaveClass('divide-y');
    const item = within(list).getByRole('listitem');
    expect(item).toHaveTextContent('mine');
    expect(item).toHaveTextContent('OpenAI');
    expect(item).toHaveTextContent(t('llmConnections', 'statusUnverified'));
    const add = screen.getByRole('button', {name: t('llmConnections', 'addButton')});
    expect(add).toHaveClass('active:bg-accent/80');
    expect(add).not.toHaveClass('border');
  });

  it('the add form is rows: hints reach their controls, docs link stays visible, Save primary and Cancel ghost', async () => {
    vi.mocked(svc.fetchMyConnections).mockResolvedValue({ok: true, data: []});
    renderSection();
    await waitFor(() => expect(screen.getByRole('button', {name: t('llmConnections', 'addButton')})).not.toBeDisabled());
    await userEvent.click(screen.getByRole('button', {name: t('llmConnections', 'addButton')}));
    // OpenAI has a global key: its note is the Provider row hint.
    expect(screen.getByRole('combobox')).toHaveAccessibleDescription(t('llmConnections', 'globalKeyNote'));
    expect(screen.getByRole('link', {name: t('llmConnections', 'docsLink')})).toHaveAttribute('href', OPENAI.docs_url);
    const labelInput = screen.getByLabelText(t('llmConnections', 'labelLabel'));
    expect(labelInput).not.toHaveClass('h-9');
    expect(labelInput).toHaveClass('border-transparent');
    expect(screen.getByRole('button', {name: t('llmConnections', 'saveButton')})).toHaveClass('bg-primary');
    const cancel = screen.getByRole('button', {name: t('llmConnections', 'cancelButton')});
    expect(cancel).toHaveClass('active:bg-accent/80');
    const form = screen.getByRole('combobox').closest('form');
    expect(form).toHaveClass('space-y-1');
    expect(form).not.toHaveClass('border');
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(screen.getByRole('option', {name: /Custom host/}));
    expect(screen.getByLabelText(t('llmConnections', 'hostLabel'))).toHaveAccessibleDescription(t('llmConnections', 'hostHint'));
    expect(screen.getByRole('combobox')).not.toHaveAccessibleDescription(t('llmConnections', 'globalKeyNote'));
  });
});
