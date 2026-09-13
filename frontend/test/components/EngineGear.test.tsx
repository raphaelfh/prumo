import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter} from 'react-router';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {t} from '@/lib/copy';

const hooks = vi.hoisted(() => ({
  engine: vi.fn(),
  setMine: vi.fn(),
  role: vi.fn(),
  providers: vi.fn(),
}));
vi.mock('@/hooks/extraction/useLlmEngine', () => ({
  useLlmEngine: hooks.engine,
  useSetMyEngine: hooks.setMine,
}));
vi.mock('@/hooks/user/useLlmConnections', () => ({useProviders: hooks.providers}));
vi.mock('@/hooks/useProjectMemberRole', () => ({useProjectMemberRole: hooks.role}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn()}}));

import {EngineGear} from '@/components/extraction/EngineGear';

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
});
