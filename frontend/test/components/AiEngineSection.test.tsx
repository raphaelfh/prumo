/** §7.6: manager editable rows, non-manager read-only, lock PUTs the default,
 * card load error, plus the Shared keys list, form and per-group states. */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {delay, http, HttpResponse} from 'msw';
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
const SHARED = {id: 's1', scope: 'project', provider: 'llama_cloud', label: 'parsing key', base_url: null, has_api_key: true, allowed_models: [], capabilities: {output_mode: null, models_seen: []}, validation_status: 'unverified', last_validated_at: null, last_used_at: null, created_by_name: 'Alice', created_at: '2026-09-13T00:00:00Z'};
function renderSection() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}});
  return render(<QueryClientProvider client={client}><TooltipProvider><AiEngineSection projectId="p1" /></TooltipProvider></QueryClientProvider>);
}

beforeEach(() => {
  role.isManager = true;
  server.use(
    http.get('*/api/v1/projects/p1/llm-engine', () => ok(READ)),
    http.get('*/api/v1/me/providers', () => ok(PROVIDERS)),
    http.get('*/api/v1/projects/p1/connections', () => ok([SHARED])),
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

  it('shows a skeleton for the AI engine card while the read is pending', async () => {
    server.use(http.get('*/api/v1/projects/p1/llm-engine', async () => { await delay(50); return ok(READ); }));
    renderSection();
    expect(screen.getByTestId('ai-engine-skeleton')).toBeInTheDocument();
    expect(await screen.findByRole('switch', {name: t('llmConnections', 'lockLabel')})).toBeInTheDocument();
    expect(screen.queryByTestId('ai-engine-skeleton')).not.toBeInTheDocument();
  });

  it('a manager sees the Shared keys list with serves tags and a remove control per row', async () => {
    renderSection();
    const list = await screen.findByRole('list', {name: t('llmConnections', 'sharedTitle')});
    const row = within(list).getByRole('listitem');
    expect(within(row).getByText('parsing key')).toBeInTheDocument();
    expect(within(row).getByText(t('llmConnections', 'servesParsing'))).toBeInTheDocument();
    expect(within(row).getByRole('button', {name: t('llmConnections', 'sharedRemoveAria')})).toBeInTheDocument();
  });

  it('a non-manager sees no shared keys and never fetches the list', async () => {
    role.isManager = false;
    let projectListHits = 0;
    server.use(http.get('*/api/v1/projects/p1/connections', () => { projectListHits += 1; return ok([SHARED]); }));
    renderSection();
    expect(await screen.findByText('GPT-4o mini')).toBeInTheDocument();
    expect(screen.queryByText('parsing key')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: t('llmConnections', 'sharedRemoveAria')})).not.toBeInTheDocument();
    expect(projectListHits).toBe(0);
  });

  it('renders the empty shared-keys state', async () => {
    server.use(http.get('*/api/v1/projects/p1/connections', () => ok([])));
    renderSection();
    expect(await screen.findByText(t('llmConnections', 'sharedEmpty'))).toBeInTheDocument();
  });

  it('each block renders its own load error without blanking the other', async () => {
    server.use(http.get('*/api/v1/projects/p1/connections', () => HttpResponse.json({ok: false, error: {code: 'X', message: 'boom'}}, {status: 500})));
    renderSection();
    expect(await screen.findByText(t('llmConnections', 'sharedLoadError'))).toBeInTheDocument();
    expect(await screen.findByRole('switch', {name: t('llmConnections', 'lockLabel')})).toBeInTheDocument();
  });

  it('adding a shared key posts and the table refreshes; removing deletes', async () => {
    const posted: unknown[] = [];
    let rows: unknown[] = [];
    server.use(
      http.get('*/api/v1/projects/p1/connections', () => ok(rows)),
      http.post('*/api/v1/projects/p1/connections', async ({request}) => { posted.push(await request.json()); rows = [SHARED]; return ok(SHARED); }),
      http.delete('*/api/v1/projects/p1/connections/s1', () => { rows = []; return ok({deleted: true, id: 's1'}); }),
    );
    renderSection();
    await userEvent.click(await screen.findByRole('button', {name: t('llmConnections', 'sharedAddButton')}));
    await userEvent.type(screen.getByLabelText(t('llmConnections', 'labelLabel')), 'parsing key');
    await userEvent.type(screen.getByLabelText(t('llmConnections', 'keyLabel')), 'lc-1');
    await userEvent.click(screen.getByRole('button', {name: t('llmConnections', 'saveButton')}));
    await waitFor(() => expect(posted).toEqual([{provider: 'openai', label: 'parsing key', api_key: 'lc-1', base_url: null, allowed_models: []}]));
    expect(await screen.findByText('parsing key')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', {name: t('llmConnections', 'sharedRemoveAria')}));
    await userEvent.click(screen.getByRole('button', {name: t('llmConnections', 'removeConfirm')}));
    await waitFor(() => expect(screen.getByText(t('llmConnections', 'sharedEmpty'))).toBeInTheDocument());
  });

  it('a non-manager sees the Locked badge next to the default when members are locked', async () => {
    role.isManager = false;
    server.use(http.get('*/api/v1/projects/p1/llm-engine', () => ok({...READ, default: {...READ.default, user_choice_allowed: false}})));
    renderSection();
    expect(await screen.findByText(t('llmConnections', 'lockedBadge'))).toBeInTheDocument();
    expect(screen.getByText('GPT-4o mini')).toBeInTheDocument();
  });

  it('rows carry their hints: default ← cardDescription, lock ← lockHint; no card title', async () => {
    renderSection();
    const lock = await screen.findByRole('switch', {name: t('llmConnections', 'lockLabel')});
    expect(lock).toHaveAccessibleDescription(t('llmConnections', 'lockHint'));
    expect(screen.getByRole('combobox', {name: t('llmConnections', 'defaultLabel')})).toHaveAccessibleDescription(
      t('llmConnections', 'cardDescription'),
    );
    expect(screen.queryByRole('heading', {name: 'AI engine'})).not.toBeInTheDocument();
  });

  it('the engine skeleton renders inside its group', async () => {
    server.use(http.get('*/api/v1/projects/p1/llm-engine', async () => { await delay(50); return ok(READ); }));
    renderSection();
    expect(screen.getByTestId('ai-engine-skeleton').closest('.border-t')).not.toBeNull();
    await screen.findByRole('switch', {name: t('llmConnections', 'lockLabel')});
  });

  it('shared keys skeleton, error and empty states render inside the Shared keys group', async () => {
    const sharedGroup = () =>
      screen.getByRole('heading', {name: t('llmConnections', 'sharedTitle')}).closest('.border-t') as HTMLElement;

    server.use(http.get('*/api/v1/projects/p1/connections', async () => { await delay(50); return ok([]); }));
    const first = renderSection();
    expect(sharedGroup().querySelector('.animate-pulse')).not.toBeNull();
    const empty = await screen.findByText(t('llmConnections', 'sharedEmpty'));
    expect(sharedGroup().contains(empty)).toBe(true);
    const add = within(sharedGroup()).getByRole('button', {name: t('llmConnections', 'sharedAddButton')});
    expect(add).not.toHaveClass('border');
    first.unmount();

    server.use(http.get('*/api/v1/projects/p1/connections', () => HttpResponse.json({ok: false, error: {code: 'X', message: 'boom'}}, {status: 500})));
    renderSection();
    const error = await screen.findByText(t('llmConnections', 'sharedLoadError'));
    expect(sharedGroup().contains(error)).toBe(true);
    expect(within(sharedGroup()).getByRole('button', {name: t('llmConnections', 'retry')})).toBeInTheDocument();
  });

  it('the add form is labelled rows with a primary Save and a ghost Cancel, in no bordered box', async () => {
    renderSection();
    await userEvent.click(await screen.findByRole('button', {name: t('llmConnections', 'sharedAddButton')}));
    const fields = [
      screen.getByRole('combobox', {name: t('llmConnections', 'providerLabel')}),
      screen.getByLabelText(t('llmConnections', 'labelLabel')),
      screen.getByLabelText(t('llmConnections', 'keyLabel')),
    ];
    for (const field of fields) {
      // SETTINGS_ROW_GRID (Task 2b): each control sits in its own SettingsRow.
      expect(field.closest('.grid')).toHaveClass('@[36rem]/settings:grid-cols-[11rem_minmax(0,1fr)]');
      for (let el = field.parentElement; el && el !== document.body; el = el.parentElement) {
        const classes = Array.from(el.classList);
        expect(classes.includes('border') && classes.some((c) => c.startsWith('rounded'))).toBe(false);
      }
    }
    // ui/button.tsx: variant "default" renders bg-primary; "ghost" renders hover:bg-accent.
    const save = screen.getByRole('button', {name: t('llmConnections', 'saveButton')});
    expect(save).toHaveClass('bg-primary');
    expect(save).not.toHaveClass('hover:bg-accent');
    const cancel = screen.getByRole('button', {name: t('llmConnections', 'cancelButton')});
    expect(cancel).toHaveClass('hover:bg-accent');
    expect(cancel).not.toHaveClass('bg-primary');
  });
});
