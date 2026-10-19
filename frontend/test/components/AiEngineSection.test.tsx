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

import {toast} from 'sonner';
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
const POLICY = {agent_runs: 'off', max_articles_per_run: 25, daily_agent_article_cap: 100, updated_at: null, updated_by: null};
function renderSection() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}});
  return render(<QueryClientProvider client={client}><TooltipProvider><AiEngineSection projectId="p1" /></TooltipProvider></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  role.isManager = true;
  server.use(
    http.get('*/api/v1/projects/p1/llm-engine', () => ok(READ)),
    http.get('*/api/v1/me/providers', () => ok(PROVIDERS)),
    http.get('*/api/v1/projects/p1/connections', () => ok([SHARED])),
    http.get('*/api/v1/projects/p1/ai-policy', () => ok(POLICY)),
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

  describe('AI agents policy group', () => {
    const agentsGroup = () =>
      screen.getByRole('heading', {name: t('llmConnections', 'agentsTitle')}).closest('.border-t') as HTMLElement;
    const runsName = t('llmConnections', 'agentRunsLabel');
    const perRunName = t('llmConnections', 'maxArticlesLabel');
    const dailyName = t('llmConnections', 'dailyCapLabel');
    const saveName = t('llmConnections', 'agentsSaveButton');

    it('shows a skeleton inside its group while the policy loads', async () => {
      server.use(http.get('*/api/v1/projects/p1/ai-policy', async () => { await delay(50); return ok(POLICY); }));
      renderSection();
      expect(agentsGroup().contains(screen.getByTestId('ai-agents-skeleton'))).toBe(true);
      expect(await within(agentsGroup()).findByRole('combobox', {name: runsName})).toBeInTheDocument();
      expect(screen.queryByTestId('ai-agents-skeleton')).not.toBeInTheDocument();
    });

    it('a load error shows inline with a Retry that refetches', async () => {
      let hits = 0;
      server.use(http.get('*/api/v1/projects/p1/ai-policy', () => {
        hits += 1;
        return hits === 1 ? HttpResponse.json({ok: false, error: {code: 'X', message: 'boom'}}, {status: 500}) : ok(POLICY);
      }));
      renderSection();
      expect(await within(agentsGroup()).findByText(t('llmConnections', 'agentsLoadError'))).toBeInTheDocument();
      await userEvent.click(within(agentsGroup()).getByRole('button', {name: t('llmConnections', 'retry')}));
      expect(await within(agentsGroup()).findByRole('combobox', {name: runsName})).toBeInTheDocument();
      expect(hits).toBe(2);
    });

    it('the defaults read Off, 25 per run and 100 per day', async () => {
      renderSection();
      const runs = await within(agentsGroup()).findByRole('combobox', {name: runsName});
      expect(runs).toHaveTextContent(t('llmConnections', 'agentRunsOff'));
      expect(within(agentsGroup()).getByRole('spinbutton', {name: perRunName})).toHaveValue(25);
      expect(within(agentsGroup()).getByRole('spinbutton', {name: dailyName})).toHaveValue(100);
    });

    it('a non-manager sees the values read-only, with no inputs and no Save', async () => {
      role.isManager = false;
      server.use(http.get('*/api/v1/projects/p1/ai-policy', () => ok({...POLICY, agent_runs: 'reviewers', max_articles_per_run: 10})));
      renderSection();
      expect(await within(agentsGroup()).findByText(t('llmConnections', 'agentRunsReviewers'))).toBeInTheDocument();
      expect(within(agentsGroup()).getByText('10')).toBeInTheDocument();
      expect(within(agentsGroup()).getByText('100')).toBeInTheDocument();
      expect(within(agentsGroup()).queryByRole('combobox')).not.toBeInTheDocument();
      expect(within(agentsGroup()).queryByRole('spinbutton')).not.toBeInTheDocument();
      expect(within(agentsGroup()).queryByRole('button', {name: saveName})).not.toBeInTheDocument();
    });

    it('a manager edits; Save PUTs all three fields and the group renders the saved policy', async () => {
      const puts: unknown[] = [];
      let stored: Record<string, unknown> = POLICY;
      server.use(
        http.get('*/api/v1/projects/p1/ai-policy', () => ok(stored)),
        http.put('*/api/v1/projects/p1/ai-policy', async ({request}) => {
          const body = (await request.json()) as Record<string, unknown>;
          puts.push(body);
          // The server's stored row is the truth: its value, not the typed one, must render.
          stored = {...POLICY, ...body, daily_agent_article_cap: 150, updated_at: '2026-10-19T00:00:00Z'};
          return ok(stored);
        }),
      );
      renderSection();
      await userEvent.click(await within(agentsGroup()).findByRole('combobox', {name: runsName}));
      await userEvent.click(screen.getByRole('option', {name: t('llmConnections', 'agentRunsManagers')}));
      const perRun = within(agentsGroup()).getByRole('spinbutton', {name: perRunName});
      await userEvent.clear(perRun);
      await userEvent.type(perRun, '10');
      const daily = within(agentsGroup()).getByRole('spinbutton', {name: dailyName});
      await userEvent.clear(daily);
      await userEvent.type(daily, '200');
      await userEvent.click(within(agentsGroup()).getByRole('button', {name: saveName}));

      await waitFor(() => expect(puts).toEqual([{agent_runs: 'managers', max_articles_per_run: 10, daily_agent_article_cap: 200}]));
      await waitFor(() => expect(within(agentsGroup()).getByRole('spinbutton', {name: dailyName})).toHaveValue(150));
      expect(within(agentsGroup()).getByRole('combobox', {name: runsName})).toHaveTextContent(t('llmConnections', 'agentRunsManagers'));
      expect(within(agentsGroup()).getByRole('spinbutton', {name: perRunName})).toHaveValue(10);
      expect(toast.success).toHaveBeenCalledWith(t('llmConnections', 'agentsSaveSuccess'));
    });

    it('an out-of-range value blocks the save with an inline message', async () => {
      const puts: unknown[] = [];
      server.use(http.put('*/api/v1/projects/p1/ai-policy', async ({request}) => { puts.push(await request.json()); return ok(POLICY); }));
      renderSection();
      const perRun = await within(agentsGroup()).findByRole('spinbutton', {name: perRunName});
      await userEvent.clear(perRun);
      await userEvent.type(perRun, '101');
      await userEvent.click(within(agentsGroup()).getByRole('button', {name: saveName}));

      expect(await within(agentsGroup()).findByText(t('llmConnections', 'maxArticlesRange'))).toBeInTheDocument();
      expect(perRun).toHaveAttribute('aria-invalid', 'true');
      expect(puts).toEqual([]);
    });

    it('Save is disabled while the PUT is pending', async () => {
      server.use(http.put('*/api/v1/projects/p1/ai-policy', async () => { await delay('infinite'); return ok(POLICY); }));
      renderSection();
      await within(agentsGroup()).findByRole('combobox', {name: runsName});
      const save = within(agentsGroup()).getByRole('button', {name: saveName});
      expect(save).not.toBeDisabled();
      await userEvent.click(save);
      expect(await within(agentsGroup()).findByRole('button', {name: t('llmConnections', 'saving')})).toBeDisabled();
    });

    it('a failed PUT toasts the save error', async () => {
      server.use(http.put('*/api/v1/projects/p1/ai-policy', () => HttpResponse.json({ok: false, error: {code: 'FORBIDDEN', message: 'no'}}, {status: 403})));
      renderSection();
      await within(agentsGroup()).findByRole('combobox', {name: runsName});
      await userEvent.click(within(agentsGroup()).getByRole('button', {name: saveName}));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(t('llmConnections', 'agentsSaveError')));
    });
  });
});
