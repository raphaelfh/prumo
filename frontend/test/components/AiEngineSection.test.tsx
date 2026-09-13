/** §7.6: manager editable card, non-manager read-only, lock PUTs the default,
 * card load error. The Shared keys cases are Task 27's half of this file. */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {http, HttpResponse} from 'msw';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {TooltipProvider} from '@/components/ui/tooltip';
import {t} from '@/lib/copy';
import {server} from '../mocks/server';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getSession: vi.fn(async () => ({data: {session: {access_token: 'test-token'}}}))}},
}));
const role = vi.hoisted(() => ({isManager: true}));
vi.mock('@/hooks/useProjectMemberRole', () => ({
  useProjectMemberRole: () => ({isManager: role.isManager, role: role.isManager ? 'manager' : 'reviewer', loading: false}),
}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn()}}));

import {AiEngineSection} from '@/components/project/settings/AiEngineSection';

const ok = <T,>(data: T) => HttpResponse.json({ok: true, data});
const READ = {
  default: {provider: 'openai', model: 'gpt-4o-mini', mode: 'fast', source: 'project', retired: false, user_choice_allowed: true},
  effective: {provider: 'openai', model: 'gpt-4o-mini', mode: 'fast', source: 'project', retired: false, connection_id: null, connection_label: null},
  source: 'project',
  catalog: [{provider: 'openai', model: 'gpt-4o-mini', canonical: 'openai:gpt-4o-mini', label: 'GPT-4o mini', best_for: 'b', context_window: 1, cost_tier: '$'}],
  availability: {openai: 'global', anthropic: null, google: null, openai_compatible: null},
};
const PROVIDERS = [
  {id: 'openai', label: 'OpenAI', description: 'GPT', docs_url: 'https://x', needs_host: false, key_optional: false, scopes: ['project', 'user'], global_key_available: true},
  {id: 'llama_cloud', label: 'LlamaCloud', description: 'parsing', docs_url: 'https://y', needs_host: false, key_optional: false, scopes: ['project', 'user'], global_key_available: false},
  {id: 'openai_compatible', label: 'Custom host', description: 'h', docs_url: null, needs_host: true, key_optional: true, scopes: ['user'], global_key_available: false},
];
function renderSection() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}});
  return render(<QueryClientProvider client={client}><TooltipProvider><AiEngineSection projectId="p1" /></TooltipProvider></QueryClientProvider>);
}

beforeEach(() => {
  role.isManager = true;
  server.use(
    http.get('*/api/v1/projects/p1/llm-engine', () => ok(READ)),
    http.get('*/api/v1/me/providers', () => ok(PROVIDERS)),
  );
});

describe('AiEngineSection', () => {
  it('a manager sees the editable default, mode and lock', async () => {
    renderSection();
    expect(await screen.findByRole('switch', {name: t('llmConnections', 'lockLabel')})).not.toBeDisabled();
    expect(screen.getByRole('combobox', {name: t('llmConnections', 'modeLabel')})).toBeInTheDocument();
  });

  it('a non-manager sees a read-only card', async () => {
    role.isManager = false;
    renderSection();
    expect(await screen.findByText('GPT-4o mini')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('renders the card load error with a retry', async () => {
    server.use(http.get('*/api/v1/projects/p1/llm-engine', () => HttpResponse.json({ok: false, error: {code: 'X', message: 'boom'}}, {status: 500})));
    renderSection();
    expect(await screen.findByText(t('llmConnections', 'cardLoadError'))).toBeInTheDocument();
    expect(screen.getByRole('button', {name: t('llmConnections', 'retry')})).toBeInTheDocument();
  });

  it('toggling the lock PUTs the default with user_choice_allowed=false', async () => {
    const puts: unknown[] = [];
    server.use(http.put('*/api/v1/projects/p1/llm-engine', async ({request}) => { puts.push(await request.json()); return ok({...READ, default: {...READ.default, user_choice_allowed: false}}); }));
    renderSection();
    await userEvent.click(await screen.findByRole('switch', {name: t('llmConnections', 'lockLabel')}));
    await waitFor(() => expect(puts).toEqual([{provider: 'openai', model: 'gpt-4o-mini', mode: 'fast', user_choice_allowed: false}]));
  });
});
