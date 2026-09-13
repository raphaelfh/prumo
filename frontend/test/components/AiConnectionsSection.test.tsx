import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {TooltipProvider} from '@/components/ui/tooltip';
import {t} from '@/lib/copy';

vi.mock('@/services/llmConnectionsService', () => ({
  fetchMyConnections: vi.fn(),
  fetchProviders: vi.fn(),
  fetchProjectConnections: vi.fn(),
  createMyConnection: vi.fn(),
}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn()}}));

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
});
