/**
 * LlmEngineChip × custom endpoints (§5.2, C2 C2 + C3).
 *
 * Split from `LlmEngineChip.test.tsx` (which sits at the file-size
 * ceiling) the way `llmEngineService.deployWindow.test.ts` is split from
 * its sibling: one concern per file. Contracts under test:
 * - the popover footer opens the management dialog;
 * - one CommandGroup per endpoint whose `validation_status` is "ok", and
 *   none at all when no endpoint is verified (decision 12 — the groups
 *   derive from the endpoints HOOK, never from the engine read);
 * - selecting an endpoint model PUTs provider `openai_compatible` with
 *   `endpoint_id`, and the chip labels such an engine
 *   `<model> · <endpoint_label>` from the read's scalar;
 * - a catalogue selection CLEARS a live pointer (`endpoint_id: null`) but
 *   a project that never had one keeps sending the pre-endpoints body.
 */
import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter} from 'react-router';
import {beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/hooks/extraction/useLlmEngine', () => ({
  useLlmEngine: vi.fn(),
  useSetLlmEngine: vi.fn(),
}));
vi.mock('@/hooks/extraction/useLlmEndpoints', () => ({
  useLlmEndpoints: vi.fn(),
  useCreateLlmEndpoint: vi.fn(),
  useUpdateLlmEndpoint: vi.fn(),
  useDeleteLlmEndpoint: vi.fn(),
  useVerifyLlmEndpoint: vi.fn(),
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  }),
}));

import {LlmEngineChip} from '@/components/extraction/LlmEngineChip';
import {useLlmEngine, useSetLlmEngine} from '@/hooks/extraction/useLlmEngine';
import {
  useCreateLlmEndpoint,
  useDeleteLlmEndpoint,
  useLlmEndpoints,
  useUpdateLlmEndpoint,
  useVerifyLlmEndpoint,
} from '@/hooks/extraction/useLlmEndpoints';
import {llmEngine as copy} from '@/lib/copy';
import type {LlmEndpointRead} from '@/services/llmEndpointService';
import type {LlmEngineRead} from '@/services/llmEngineService';

import {makeEndpointRead} from './mocks/llmEndpointRead';
import {makeEngineRead} from './mocks/llmEngineRead';

const useLlmEngineMock = vi.mocked(useLlmEngine);
const useSetLlmEngineMock = vi.mocked(useSetLlmEngine);
const useLlmEndpointsMock = vi.mocked(useLlmEndpoints);

const CATALOG = [
  {
    provider: 'openai',
    model: 'gpt-4o-mini',
    canonical: 'openai:gpt-4o-mini',
    label: 'GPT-4o mini',
    best_for: 'Fast bulk extraction',
    context_window: 128000,
    cost_tier: '$' as const,
    byok_only: false,
  },
  {
    provider: 'openai',
    model: 'gpt-4o',
    canonical: 'openai:gpt-4o',
    label: 'GPT-4o',
    best_for: 'Higher-fidelity extraction',
    context_window: 128000,
    cost_tier: '$$' as const,
    byok_only: false,
  },
];

const ENGINE_READ = makeEngineRead({catalog: CATALOG});

const OK_ENDPOINT = makeEndpointRead({
  id: 'e1',
  label: 'Lab vLLM',
  validation_status: 'ok',
  allowed_models: ['qwen3-30b', 'llama-3.3-70b'],
});

/** Verified, but the probe only got prompted JSON out of it (decision 10). */
const PROMPTED_ENDPOINT = makeEndpointRead({
  id: 'e9',
  label: 'Prompted box',
  validation_status: 'ok',
  allowed_models: ['mistral-7b'],
  capabilities: {output_mode: 'prompted', models_seen: ['mistral-7b']},
});

/** The engine as it reads once an endpoint model is the project default. */
const ENDPOINT_ENGINE: Partial<LlmEngineRead> = {
  provider: 'openai_compatible',
  model: 'qwen3-30b',
  endpoint_id: 'e1',
  endpoint_label: 'Lab vLLM',
};

const mutateMock = vi.fn();

function mockEndpoints(endpoints: LlmEndpointRead[] = []) {
  useLlmEndpointsMock.mockReturnValue({
    data: endpoints,
    isError: false,
    isPending: false,
  } as unknown as ReturnType<typeof useLlmEndpoints>);
}

function mockRead(overrides: Partial<LlmEngineRead> = {}) {
  useLlmEngineMock.mockReturnValue({
    data: {...ENGINE_READ, ...overrides},
    isError: false,
    isPending: false,
  } as unknown as ReturnType<typeof useLlmEngine>);
}

function renderChip() {
  return render(
    <MemoryRouter>
      <LlmEngineChip projectId="p1" />
    </MemoryRouter>,
  );
}

async function renderOpenPopover(overrides: Partial<LlmEngineRead> = {}) {
  mockRead(overrides);
  renderChip();
  await userEvent.click(screen.getByRole('button', {name: copy.chipAria}));
}

beforeAll(() => {
  // cmdk scrolls the selected item into view; jsdom has no scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
  useSetLlmEngineMock.mockReturnValue({
    mutate: mutateMock,
    isPending: false,
  } as unknown as ReturnType<typeof useSetLlmEngine>);
  mockEndpoints();
  // The dialog the footer mounts calls all four mutation hooks on render.
  const idleMutation = {mutate: vi.fn(), isPending: false};
  vi.mocked(useCreateLlmEndpoint).mockReturnValue(
    idleMutation as unknown as ReturnType<typeof useCreateLlmEndpoint>,
  );
  vi.mocked(useUpdateLlmEndpoint).mockReturnValue(
    idleMutation as unknown as ReturnType<typeof useUpdateLlmEndpoint>,
  );
  vi.mocked(useDeleteLlmEndpoint).mockReturnValue(
    idleMutation as unknown as ReturnType<typeof useDeleteLlmEndpoint>,
  );
  vi.mocked(useVerifyLlmEndpoint).mockReturnValue(
    idleMutation as unknown as ReturnType<typeof useVerifyLlmEndpoint>,
  );
});

describe('popover footer', () => {
  it('opens the custom-endpoint management dialog', async () => {
    mockEndpoints([makeEndpointRead()]);
    await renderOpenPopover();

    await userEvent.click(
      screen.getByRole('button', {name: copy.manageEndpoints}),
    );

    expect(
      screen.getByRole('heading', {name: copy.endpointsTitle}),
    ).toBeInTheDocument();
    expect(screen.getByText('Lab vLLM')).toBeInTheDocument();
  });
});

describe('endpoint groups (C2 C3)', () => {
  it('renders the chip label as <model> · <endpoint_label>', () => {
    mockRead({...ENDPOINT_ENGINE, source: 'project'});
    renderChip();

    expect(
      screen.getByRole('button', {name: copy.chipAria}),
    ).toHaveTextContent('qwen3-30b · Lab vLLM');
  });

  it('renders one group per ok endpoint, with its host and the shared-key note', async () => {
    mockEndpoints([OK_ENDPOINT]);
    await renderOpenPopover();

    expect(screen.getByText('Lab vLLM')).toBeInTheDocument();
    expect(screen.getByText('llm.lab.example.org')).toBeInTheDocument();
    expect(screen.getByText(copy.endpointGroupNote)).toBeInTheDocument();
    expect(
      screen.getByTestId('llm-engine-endpoint-option-e1-qwen3-30b'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('llm-engine-endpoint-option-e1-llama-3.3-70b'),
    ).toBeInTheDocument();
  });

  it('renders NO endpoint group when no endpoint is ok', async () => {
    mockEndpoints([
      makeEndpointRead({id: 'e2', validation_status: 'unverified'}),
      makeEndpointRead({id: 'e3', validation_status: 'failed'}),
    ]);
    await renderOpenPopover();

    expect(screen.queryByText(copy.endpointGroupNote)).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('llm-engine-endpoint-option-e2-qwen3-30b'),
    ).not.toBeInTheDocument();
  });

  it('selecting an endpoint model PUTs provider openai_compatible + endpoint_id', async () => {
    mockEndpoints([OK_ENDPOINT]);
    await renderOpenPopover();

    await userEvent.click(
      screen.getByTestId('llm-engine-endpoint-option-e1-qwen3-30b'),
    );

    expect(mutateMock).toHaveBeenCalledTimes(1);
    expect(mutateMock.mock.calls[0][0]).toEqual({
      provider: 'openai_compatible',
      model: 'qwen3-30b',
      mode: 'fast',
      alternates: [],
      endpoint_id: 'e1',
    });
  });

  it('marks the current endpoint model with the ✓', async () => {
    mockEndpoints([OK_ENDPOINT]);
    await renderOpenPopover(ENDPOINT_ENGINE);

    const current = screen.getByTestId(
      'llm-engine-endpoint-option-e1-qwen3-30b',
    );
    expect(
      within(current).getByLabelText(copy.currentModelAria),
    ).toBeInTheDocument();
    const other = screen.getByTestId(
      'llm-engine-endpoint-option-e1-llama-3.3-70b',
    );
    expect(
      within(other).queryByLabelText(copy.currentModelAria),
    ).not.toBeInTheDocument();
  });

  it('a catalogue selection from an endpoint engine CLEARS the pointer', async () => {
    mockEndpoints([OK_ENDPOINT]);
    await renderOpenPopover(ENDPOINT_ENGINE);

    await userEvent.click(screen.getByTestId('llm-engine-option-openai:gpt-4o'));

    expect(mutateMock.mock.calls[0][0]).toEqual({
      provider: 'openai',
      model: 'gpt-4o',
      mode: 'fast',
      alternates: [],
      // Explicit null: leaving the stored pointer on a catalogue pair
      // would keep routing runs at the endpoint.
      endpoint_id: null,
    });
  });

  it('a plain catalogue selection sends NO endpoint_id key', async () => {
    mockEndpoints([OK_ENDPOINT]);
    await renderOpenPopover();

    await userEvent.click(screen.getByTestId('llm-engine-option-openai:gpt-4o'));

    const body = mutateMock.mock.calls[0][0] as Record<string, unknown>;
    expect(body).toEqual({
      provider: 'openai',
      model: 'gpt-4o',
      mode: 'fast',
      alternates: [],
    });
    expect('endpoint_id' in body).toBe(false);
  });

  // A verified endpoint with nothing allowed is a heading with zero rows:
  // dead UI that suggests models exist behind it.
  it('renders NO group for an ok endpoint whose model list is empty', async () => {
    mockEndpoints([
      makeEndpointRead({id: 'e5', validation_status: 'ok', allowed_models: []}),
    ]);
    await renderOpenPopover();

    expect(screen.queryByText(copy.endpointGroupNote)).not.toBeInTheDocument();
  });

  it('hides endpoint rows while managing alternates (catalogue pairs only)', async () => {
    mockEndpoints([OK_ENDPOINT]);
    await renderOpenPopover();

    await userEvent.click(
      screen.getByRole('button', {name: copy.alternatesAddLabel}),
    );

    expect(
      screen.queryByTestId('llm-engine-endpoint-option-e1-qwen3-30b'),
    ).not.toBeInTheDocument();
  });
});

/**
 * Decision 10: the backend REJECTS mode="verified" on a prompted-only
 * endpoint, "and the UI warns first". The dialog's warning is not enough —
 * a manager picking an engine need never open it (a colleague may have
 * created and verified the endpoint).
 */
describe('prompted-only endpoints (decision 10)', () => {
  it('warns in the group heading that the endpoint cannot back Verified mode', async () => {
    mockEndpoints([PROMPTED_ENDPOINT]);
    await renderOpenPopover();

    expect(
      screen.getByText(copy.endpointPromptedGroupNote),
    ).toBeInTheDocument();
  });

  it('does not warn for an endpoint that probed tool calling', async () => {
    mockEndpoints([
      makeEndpointRead({
        id: 'e1',
        validation_status: 'ok',
        capabilities: {output_mode: 'tool', models_seen: []},
      }),
    ]);
    await renderOpenPopover();

    expect(
      screen.queryByText(copy.endpointPromptedGroupNote),
    ).not.toBeInTheDocument();
  });

  it('offers the rows normally on a Fast-mode project', async () => {
    mockEndpoints([PROMPTED_ENDPOINT]);
    await renderOpenPopover();

    await userEvent.click(
      screen.getByTestId('llm-engine-endpoint-option-e9-mistral-7b'),
    );

    expect(mutateMock).toHaveBeenCalledTimes(1);
  });

  it('blocks the rows on a Verified-mode project, with the way out', async () => {
    mockEndpoints([PROMPTED_ENDPOINT]);
    await renderOpenPopover({mode: 'verified'});

    const option = screen.getByTestId('llm-engine-endpoint-option-e9-mistral-7b');
    expect(option).toHaveAttribute('aria-disabled', 'true');
    expect(
      within(option).getByText(copy.endpointPromptedBlocked),
    ).toBeInTheDocument();

    await userEvent.click(option);

    // The dead click is the bug: a 422 arrives as a generic save-error
    // toast with no hint of which knob to turn.
    expect(mutateMock).not.toHaveBeenCalled();
  });
});
