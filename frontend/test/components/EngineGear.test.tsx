import {render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter} from 'react-router';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {t} from '@/lib/copy';

const hooks = vi.hoisted(() => ({
  engine: vi.fn(),
  setMine: vi.fn(),
  role: vi.fn(),
  providers: vi.fn(),
  clearMine: vi.fn(),
  mine: vi.fn(),
}));
vi.mock('@/hooks/extraction/useLlmEngine', () => ({
  useLlmEngine: hooks.engine,
  useSetMyEngine: hooks.setMine,
  useClearMyEngine: hooks.clearMine,
}));
vi.mock('@/hooks/user/useLlmConnections', () => ({useProviders: hooks.providers, useMyConnections: hooks.mine}));
vi.mock('@/hooks/useProjectMemberRole', () => ({useProjectMemberRole: hooks.role}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn()}}));

import {toast} from 'sonner';

/** Mirrors the shape the api client throws: an Error carrying `code`. */
class ApiError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

import {EngineGear} from '@/components/extraction/EngineGear';

const HOST = {id: 'c1', provider: 'openai_compatible', label: 'Lab Ollama', base_url: 'https://8.8.8.8/v1', allowed_models: ['llama3'], validation_status: 'ok', has_api_key: false} as never;

const entry = (provider: string, model: string, label: string) => ({
  provider,
  model,
  canonical: `${provider}:${model}`,
  label,
  best_for: 'b',
  context_window: 1000,
  cost_tier: '$',
});
const READ = {
  default: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    mode: 'fast',
    source: 'project',
    retired: false,
    user_choice_allowed: true,
  },
  effective: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    mode: 'fast',
    source: 'project',
    retired: false,
    connection_id: null,
    connection_label: null,
  },
  source: 'project',
  catalog: [
    entry('openai', 'gpt-4o-mini', 'GPT-4o mini'),
    entry('anthropic', 'claude-haiku-4-5', 'Claude Haiku'),
    entry('google', 'gemini-3.8-flash', 'Gemini Flash'),
  ],
  availability: {openai: 'global', anthropic: 'project', google: null, openai_compatible: 'user'},
};
const setMutate = vi.fn();

function renderGear() {
  return render(
    <MemoryRouter>
      <EngineGear projectId="p1" />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hooks.engine.mockReturnValue({data: READ, isPending: false, isError: false, refetch: vi.fn()});
  hooks.setMine.mockReturnValue({mutate: setMutate, isPending: false});
  hooks.clearMine.mockReturnValue({mutate: vi.fn(), isPending: false});
  hooks.mine.mockReturnValue({data: [HOST]});
  hooks.role.mockReturnValue({isManager: false, role: 'reviewer', loading: false});
  hooks.providers.mockReturnValue({
    data: [
      {id: 'openai', label: 'OpenAI'},
      {id: 'anthropic', label: 'Anthropic'},
      {id: 'google', label: 'Google'},
      {id: 'openai_compatible', label: 'Custom host'},
    ],
  });
});

describe('EngineGear', () => {
  it('names the effective engine in its tooltip and shows the project default line', async () => {
    renderGear();
    const gear = screen.getByRole('button', {name: t('llmConnections', 'gearAria')});
    await userEvent.hover(gear);
    expect(
      await screen.findAllByText(t('llmConnections', 'gearTooltip').replace('{{engine}}', 'GPT-4o mini')),
    ).not.toHaveLength(0);
    await userEvent.click(gear);
    expect(
      screen.getByText(t('llmConnections', 'projectDefaultLine').replace('{{engine}}', 'GPT-4o mini')),
    ).toBeInTheDocument();
  });

  it('renders the scope tags and the needs-a-key row unselectable with a link out', async () => {
    renderGear();
    await userEvent.click(screen.getByTestId('engine-gear'));
    expect(screen.getByText(t('llmConnections', 'tagPrumo'))).toBeInTheDocument();
    expect(screen.getByText(t('llmConnections', 'tagProjectKey'))).toBeInTheDocument();
    const gemini = screen.getByText('Gemini Flash').closest('[role="option"]')!;
    expect(gemini).toHaveAttribute('aria-disabled', 'true');
    expect(within(gemini as HTMLElement).getByText(t('llmConnections', 'tagNeedsKey'))).toBeInTheDocument();
    expect(screen.getByRole('link', {name: t('llmConnections', 'needsKeyLink')})).toHaveAttribute(
      'href',
      '/settings?tab=integrations',
    );
    expect(screen.getAllByText(t('llmConnections', 'tagYourKey')).length).toBeGreaterThan(0); // the host group
  });

  it('a catalogue pick writes the viewer row with the effective mode', async () => {
    renderGear();
    await userEvent.click(screen.getByTestId('engine-gear'));
    await userEvent.click(screen.getByText('Claude Haiku'));
    expect(setMutate).toHaveBeenCalledWith(
      {provider: 'anthropic', model: 'claude-haiku-4-5', mode: 'fast', connection_id: null},
      expect.anything(),
    );
  });

  it('is read-only with the reason for a locked member', async () => {
    hooks.engine.mockReturnValue({
      data: {...READ, default: {...READ.default, user_choice_allowed: false}},
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderGear();
    await userEvent.click(screen.getByTestId('engine-gear'));
    expect(screen.getByText(t('llmConnections', 'lockedReason'))).toBeInTheDocument();
    expect(screen.getByText('Claude Haiku').closest('[role="option"]')).toHaveAttribute('aria-disabled', 'true');
  });

  it('stays editable for a manager under the same lock', async () => {
    hooks.engine.mockReturnValue({
      data: {...READ, default: {...READ.default, user_choice_allowed: false}},
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    hooks.role.mockReturnValue({isManager: true, role: 'manager', loading: false});
    renderGear();
    await userEvent.click(screen.getByTestId('engine-gear'));
    expect(screen.queryByText(t('llmConnections', 'lockedReason'))).not.toBeInTheDocument();
    expect(screen.getByText('Claude Haiku').closest('[role="option"]')).toHaveAttribute('aria-disabled', 'false');
  });

  it('shows the load-error line with a retry and keeps the gear mounted', async () => {
    const refetch = vi.fn();
    hooks.engine.mockReturnValue({data: undefined, isPending: false, isError: true, refetch});
    renderGear();
    await userEvent.click(screen.getByTestId('engine-gear'));
    await userEvent.click(screen.getByRole('button', {name: t('llmConnections', 'retry')}));
    expect(refetch).toHaveBeenCalled();
  });

  it('a pick writes the viewer row; the host group lists allowed models', async () => {
    renderGear();
    await userEvent.click(screen.getByTestId('engine-gear'));
    await userEvent.click(screen.getByText('llama3'));
    expect(setMutate).toHaveBeenCalledWith(
      {provider: 'openai_compatible', model: 'llama3', mode: 'fast', connection_id: 'c1'},
      expect.anything(),
    );
  });

  it('the mode toggle writes the effective pair with the new mode', async () => {
    renderGear();
    await userEvent.click(screen.getByTestId('engine-gear'));
    await userEvent.click(screen.getByRole('radio', {name: t('llmConnections', 'modeVerified')}));
    expect(setMutate).toHaveBeenCalledWith(
      {provider: 'openai', model: 'gpt-4o-mini', mode: 'verified', connection_id: null},
      expect.anything(),
    );
  });

  it('offers "follow the project default" only on a user row, and it clears', async () => {
    const clear = vi.fn();
    hooks.clearMine.mockReturnValue({mutate: clear, isPending: false});
    hooks.engine.mockReturnValue({
      data: {...READ, source: 'user', effective: {...READ.effective, source: 'user'}},
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderGear();
    await userEvent.click(screen.getByTestId('engine-gear'));
    await userEvent.click(screen.getByRole('button', {name: t('llmConnections', 'followDefault')}));
    expect(clear).toHaveBeenCalled();
  });

  it('hides "follow the project default" on a project row', async () => {
    renderGear();
    await userEvent.click(screen.getByTestId('engine-gear'));
    expect(
      screen.queryByRole('button', {name: t('llmConnections', 'followDefault')}),
    ).not.toBeInTheDocument();
  });

  it('links to Integrations when the viewer owns no host and nothing needs a key', async () => {
    hooks.mine.mockReturnValue({data: []});
    hooks.engine.mockReturnValue({
      data: {
        ...READ,
        availability: {openai: 'global', anthropic: 'project', google: 'global', openai_compatible: null},
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderGear();
    await userEvent.click(screen.getByTestId('engine-gear'));
    expect(screen.getByRole('link', {name: t('llmConnections', 'noHostsLink')})).toHaveAttribute(
      'href',
      '/settings?tab=integrations',
    );
  });

  it('closes the popover on a successful pick', async () => {
    setMutate.mockImplementation((_body, opts) => opts.onSuccess?.());
    renderGear();
    await userEvent.click(screen.getByTestId('engine-gear'));
    await userEvent.click(screen.getByText('Claude Haiku'));
    await waitFor(() =>
      expect(
        screen.queryByText(t('llmConnections', 'projectDefaultLine').replace('{{engine}}', 'GPT-4o mini')),
      ).not.toBeInTheDocument(),
    );
  });

  it('closes the popover on a successful clear', async () => {
    hooks.clearMine.mockReturnValue({
      mutate: vi.fn((_v, opts) => opts.onSuccess?.()),
      isPending: false,
    });
    hooks.engine.mockReturnValue({
      data: {...READ, source: 'user'},
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderGear();
    await userEvent.click(screen.getByTestId('engine-gear'));
    await userEvent.click(screen.getByRole('button', {name: t('llmConnections', 'followDefault')}));
    await waitFor(() =>
      expect(
        screen.queryByText(t('llmConnections', 'projectDefaultLine').replace('{{engine}}', 'GPT-4o mini')),
      ).not.toBeInTheDocument(),
    );
  });

  it.each([
    ['LLM_ENGINE_LOCKED', 'lockedReason'],
    ['LLM_ENGINE_NEEDS_KEY', 'pickErrorNeedsKey'],
    ['SOMETHING_ELSE', 'pickError'],
  ] as const)('maps a failed pick with %s to its copy', async (code, key) => {
    setMutate.mockImplementation((_body, opts) => opts.onError?.(new ApiError(code, 'boom')));
    renderGear();
    await userEvent.click(screen.getByTestId('engine-gear'));
    await userEvent.click(screen.getByText('Claude Haiku'));
    expect(toast.error).toHaveBeenCalledWith(t('llmConnections', key));
  });

  it('maps a failed clear by its error code', async () => {
    hooks.clearMine.mockReturnValue({
      mutate: vi.fn((_v, opts) => opts.onError?.(new ApiError('LLM_ENGINE_LOCKED', 'boom'))),
      isPending: false,
    });
    hooks.engine.mockReturnValue({
      data: {...READ, source: 'user'},
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderGear();
    await userEvent.click(screen.getByTestId('engine-gear'));
    await userEvent.click(screen.getByRole('button', {name: t('llmConnections', 'followDefault')}));
    expect(toast.error).toHaveBeenCalledWith(t('llmConnections', 'lockedReason'));
  });
});
