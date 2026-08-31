/**
 * LlmEngineChip — the ⚙ engine chip + picker popover (§5, C1b T6).
 *
 * The data hooks are mocked in the house style (every data hook mocked —
 * the MSW gate would fail loudly on an unmocked GET). Contracts under
 * test:
 * - chip renders the resolved engine label + Fast, from the read payload;
 * - on a failed read the chip renders NOTHING (deploy-race 404 window)
 *   and sibling content is unaffected;
 * - popover: provider groups, locked BYOK rows (disabled + "Add your
 *   key" CTA deep-linking to the key settings), mode toggle driven by
 *   the stored mode (§5 Verified enabled);
 * - selection fires the mutation with the canonical pair + current mode;
 * - attribution renders only for source == "project";
 * - a retired stored engine shows the amber re-choose note.
 */
import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter, useLocation} from 'react-router';
import {beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/hooks/extraction/useLlmEngine', () => ({
  useLlmEngine: vi.fn(),
  useSetLlmEngine: vi.fn(),
}));
// The endpoints family is mocked too: the popover footer mounts the
// management dialog, whose hooks would otherwise pull the real service —
// and with it the api client, which needs supabase env at import time.
vi.mock('@/hooks/extraction/useLlmEndpoints', () => ({
  useLlmEndpoints: vi.fn(),
  useCreateLlmEndpoint: vi.fn(),
  useUpdateLlmEndpoint: vi.fn(),
  useDeleteLlmEndpoint: vi.fn(),
  useVerifyLlmEndpoint: vi.fn(),
}));
// The chip opens `AiConfigDialog`, whose other tabs read the project's AI
// context and the template instruction. Mocked like every other data hook
// here: unmocked they need a QueryClientProvider the chip never had.
vi.mock('@/hooks/project/useAiContext', () => ({
  useAiContext: () => ({data: undefined, isLoading: false, isError: true}),
  useSetAiContext: () => ({mutate: vi.fn(), isPending: false}),
}));
vi.mock('@/hooks/extraction/useTemplateInstruction', () => ({
  useTemplateInstruction: vi.fn(() => ({data: undefined, isLoading: true})),
  useUpdateTemplateInstruction: () => ({mutate: vi.fn(), isPending: false}),
}));
// Callable-with-methods shape — a namespace-only mock swallows `toast(...)`
// calls and reports green for feedback that never fired.
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  }),
}));

import {toast} from 'sonner';

import {LlmEngineChip} from '@/components/extraction/LlmEngineChip';
import {useLlmEngine, useSetLlmEngine} from '@/hooks/extraction/useLlmEngine';
import {useTemplateInstruction} from '@/hooks/extraction/useTemplateInstruction';
import {
  useCreateLlmEndpoint,
  useDeleteLlmEndpoint,
  useLlmEndpoints,
  useUpdateLlmEndpoint,
  useVerifyLlmEndpoint,
} from '@/hooks/extraction/useLlmEndpoints';
import {aiContext, extraction, llmEngine as copy} from '@/lib/copy';
import type {LlmEndpointRead} from '@/services/llmEndpointService';
import type {LlmEngineRead} from '@/services/llmEngineService';

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
  {
    provider: 'openai',
    model: 'gpt-4.1-mini',
    canonical: 'openai:gpt-4.1-mini',
    label: 'GPT-4.1 mini',
    best_for: 'Very long articles',
    // Just over 1M: must render "1M", never "1048k".
    context_window: 1047576,
    cost_tier: '$' as const,
    byok_only: false,
  },
  {
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    canonical: 'anthropic:claude-sonnet-4-5',
    label: 'Claude Sonnet 4.5',
    best_for: 'Long, nuanced documents',
    context_window: 200000,
    cost_tier: '$$' as const,
    byok_only: true,
  },
];

const ENGINE_READ = makeEngineRead({catalog: CATALOG});

const ALT_GPT41 = {
  provider: 'openai',
  model: 'gpt-4.1-mini',
  canonical: 'openai:gpt-4.1-mini',
  retired: false,
};

// ALT_RETIRED / ALT_BYOK moved with their assertions to
// LlmEngineSettingsDialog.test.tsx — the alternates list lives there now.

const mutateMock = vi.fn();

/**
 * Endpoint rows for the popover footer's dialog. The endpoint-specific
 * assertions live in `LlmEngineChip.endpoints.test.tsx`; here the list is
 * only kept empty so the footer's dialog has something to render.
 */
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

/** Reflects router navigations (the group-level Add-your-key item). */
function LocationSpy() {
  const location = useLocation();
  return (
    <div data-testid="location-spy">{`${location.pathname}${location.search}`}</div>
  );
}

function renderChip(templateId?: string) {
  return render(
    <MemoryRouter>
      <div data-testid="tab-sibling">sibling content</div>
      <LocationSpy />
      <LlmEngineChip projectId="p1" templateId={templateId} />
    </MemoryRouter>,
  );
}

/** Every popover assertion starts here: read mocked, chip rendered, open. */
async function renderOpenPopover(overrides: Partial<LlmEngineRead> = {}) {
  mockRead(overrides);
  renderChip();
  await userEvent.click(screen.getByRole('button', {name: new RegExp(aiContext.configDialogTitle)}));
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

describe('chip', () => {
  it('renders the resolved engine label and the Fast mode', () => {
    mockRead();
    renderChip();

    const chip = screen.getByRole('button', {name: new RegExp(aiContext.configDialogTitle)});
    expect(chip).toHaveTextContent('GPT-4o mini');
    expect(chip).toHaveTextContent(copy.modeFast);
  });

  it('renders the Verified mode label when the stored mode is verified', () => {
    mockRead({mode: 'verified'});
    renderChip();

    const chip = screen.getByRole('button', {name: new RegExp(aiContext.configDialogTitle)});
    expect(chip).toHaveTextContent(copy.modeVerified);
    expect(chip).not.toHaveTextContent(copy.modeFast);
  });

  it('renders NOTHING on a failed read, leaving siblings unaffected', () => {
    useLlmEngineMock.mockReturnValue({
      data: undefined,
      isError: true,
      isPending: false,
    } as unknown as ReturnType<typeof useLlmEngine>);
    renderChip();

    expect(
      screen.queryByRole('button', {name: new RegExp(aiContext.configDialogTitle)}),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('tab-sibling')).toBeInTheDocument();
  });

  /* The chip is the config bar's ONLY AI trigger, so the template
     instruction's unfilled [customize:] slots — the one WARNING the other
     tabs carry — have to survive on it, and inside the button's accessible
     name (an aria-label would replace the composed name and erase exactly
     this for the users who cannot see the amber count). */
  it("carries the instruction's unfilled slots in the trigger's own name", () => {
    mockRead();
    vi.mocked(useTemplateInstruction).mockReturnValue({
      data: {llm_template_instruction: 'Judge [customize:what] on [customize:whom]'},
      isLoading: false,
    } as unknown as ReturnType<typeof useTemplateInstruction>);
    renderChip('t1');

    expect(screen.getByTestId('instruction-customize-chip')).toHaveTextContent(
      '2',
    );
    expect(
      screen.getByRole('button', {
        name: new RegExp(extraction.instructionCustomizeChip.replace('{{n}}', '2')),
      }),
    ).toBeInTheDocument();
  });

  it('shows no warning while the chip rides standalone (no template)', () => {
    mockRead();
    renderChip();

    expect(screen.queryByTestId('instruction-customize-chip')).toBeNull();
  });

  it('falls back to the raw model string when the pair left the catalogue', () => {
    mockRead({model: 'gpt-3.5-turbo', retired: true, source: 'project'});
    renderChip();

    expect(
      screen.getByRole('button', {name: new RegExp(aiContext.configDialogTitle)}),
    ).toHaveTextContent('gpt-3.5-turbo');
  });
});

describe('popover', () => {
  it('groups the catalogue by provider, with the BYOK-only group note', async () => {
    await renderOpenPopover();

    expect(screen.getByText(copy.providerOpenai)).toBeInTheDocument();
    expect(screen.getByText(copy.providerAnthropic)).toBeInTheDocument();
    // BYOK-only providers carry the own-key note in the group header.
    expect(screen.getByText(copy.byokGroupNote)).toBeInTheDocument();
    // Row anatomy since slice C: the visible line is the label plus one
    // right-aligned "<context> · <cost>". The best-for text and canonical id
    // are present but revealed only on the active row (asserted separately).
    // The label is scoped to the row — the chip trigger shows the same string.
    const row = screen.getByTestId('llm-engine-option-openai:gpt-4o-mini');
    expect(within(row).getByText('GPT-4o mini')).toBeInTheDocument();
    expect(screen.getByText('200k · $$')).toBeInTheDocument();
    // Million-token windows round to "M", never a five-digit "k".
    expect(screen.getByText('1M · $')).toBeInTheDocument();
  });

  it('reveals the description and canonical id on the ACTIVE row only', async () => {
    // Slice C moved them off the row so the list reads one line per model.
    // They must still be reachable — and reachable by KEYBOARD, which a
    // hover-only tooltip would not be: cmdk marks the active row
    // data-selected on arrow-key navigation as well as hover.
    await renderOpenPopover();

    const row = screen.getByTestId('llm-engine-option-openai:gpt-4o-mini');
    const detail = within(row).getByText('Fast bulk extraction');

    // Present in the DOM for every row, revealed by CSS on the active one —
    // so assert the mechanism, not just presence.
    expect(detail.className).toContain('hidden');
    expect(detail.className).toContain('group-data-[selected=true]:block');
    expect(within(row).getByText('openai:gpt-4o-mini')).toBeInTheDocument();
  });

  it('fills the current row and keeps its accessible marker', async () => {
    await renderOpenPopover();

    const current = screen.getByTestId(
      `llm-engine-option-${ENGINE_READ.provider}:${ENGINE_READ.model}`,
    );
    expect(current.className).toContain('bg-primary/5');
    expect(
      within(current).getByLabelText(copy.currentModelAria),
    ).toBeInTheDocument();
  });

  it('opens the engine settings dialog from the footer link', async () => {
    await renderOpenPopover();

    await userEvent.click(screen.getByTestId('llm-engine-open-settings'));

    expect(
      await screen.findByTestId('llm-engine-settings-dialog'),
    ).toBeInTheDocument();
  });

  it('no longer carries policy controls in the popover', async () => {
    // The split is the point of slice C: 156px of mode + alternates used to
    // sit above the search box.
    await renderOpenPopover();

    expect(
      screen.queryByRole('group', {name: copy.modeGroupAria}),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(copy.alternatesTitle)).not.toBeInTheDocument();
  });

  it('renders a locked row disabled with the Add-your-key CTA deep link', async () => {
    await renderOpenPopover();

    const locked = screen.getByTestId(
      'llm-engine-option-anthropic:claude-sonnet-4-5',
    );
    expect(locked).toHaveAttribute('aria-disabled', 'true');
    const cta = within(locked).getByRole('link', {name: copy.lockedAddKeyCta});
    expect(cta).toHaveAttribute('href', '/settings?tab=integrations');
  });

  it('fires the mutation with the canonical pair on selection', async () => {
    await renderOpenPopover();

    await userEvent.click(screen.getByTestId('llm-engine-option-openai:gpt-4o'));

    expect(mutateMock).toHaveBeenCalledTimes(1);
    expect(mutateMock.mock.calls[0][0]).toEqual({
      provider: 'openai',
      model: 'gpt-4o',
      mode: 'fast',
      alternates: [],
    });
  });

  it('does not fire the mutation from a locked row', async () => {
    await renderOpenPopover();

    await userEvent.click(
      screen.getByTestId('llm-engine-option-anthropic:claude-sonnet-4-5'),
    );

    expect(mutateMock).not.toHaveBeenCalled();
  });

  it('reaches the Add-your-key item by keyboard and navigates on Enter', async () => {
    // cmdk skips disabled items with the arrow keys, so the per-row CTA
    // (inside a disabled row) is mouse-only. The locked group must carry
    // ONE enabled item that the combobox's own navigation can reach.
    await renderOpenPopover();

    const cta = screen.getByTestId('llm-engine-add-key-anthropic');
    expect(
      within(cta).getByText(copy.lockedAddKeyItem),
    ).toBeInTheDocument();

    // End jumps to the LAST enabled item — the CTA (the locked model row
    // before it is skipped by cmdk). Assert the focus landed there before
    // committing with Enter.
    await userEvent.click(screen.getByPlaceholderText(copy.searchPlaceholder));
    await userEvent.keyboard('{End}');
    expect(cta).toHaveAttribute('data-selected', 'true');
    await userEvent.keyboard('{Enter}');

    expect(screen.getByTestId('location-spy')).toHaveTextContent(
      '/settings?tab=integrations',
    );
    // The locked model rows stay unselectable: no mutation fired on the way.
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it('MODEL selection on a verified project sends mode: "verified" explicitly (panel B2)', async () => {
    // Omitting mode would let the server default silently downgrade the
    // project back to fast — the old-FE stale-tab clobber this FE must not
    // recreate.
    await renderOpenPopover({mode: 'verified'});

    await userEvent.click(screen.getByTestId('llm-engine-option-openai:gpt-4o'));

    expect(mutateMock).toHaveBeenCalledTimes(1);
    expect(mutateMock.mock.calls[0][0]).toEqual({
      provider: 'openai',
      model: 'gpt-4o',
      mode: 'verified',
      alternates: [],
    });
  });

});

describe('selection preserves stored policy', () => {
  it('switching the default model sends the stored alternates untouched', async () => {
    await renderOpenPopover({alternates: [ALT_GPT41]});

    await userEvent.click(screen.getByTestId('llm-engine-option-openai:gpt-4o'));

    expect(mutateMock).toHaveBeenCalledTimes(1);
    expect(mutateMock.mock.calls[0][0]).toEqual({
      provider: 'openai',
      model: 'gpt-4o',
      mode: 'fast',
      alternates: [{provider: 'openai', model: 'gpt-4.1-mini'}],
    });
  });

  it('a model change keeps the existing generic save toast', async () => {
    mutateMock.mockImplementation(
      (_body: unknown, opts?: {onSuccess?: () => void}) => opts?.onSuccess?.(),
    );
    await renderOpenPopover();

    await userEvent.click(screen.getByTestId('llm-engine-option-openai:gpt-4o'));

    expect(toast.success).toHaveBeenCalledWith(copy.saveSuccess);
  });
});


describe('selection — deploy-window tolerance (old backend omits alternates)', () => {
  /**
   * The read as the SERVICE normalizes an old backend's payload (wire body
   * without the `alternates` field): `alternates: []` plus
   * `hasAlternates: false` — the service's REAL normalized shape, never a
   * hand-stripped object the service could not actually produce.
   */
  function mockLegacyRead() {
    useLlmEngineMock.mockReturnValue({
      data: {...ENGINE_READ, alternates: [], hasAlternates: false},
      isError: false,
      isPending: false,
    } as unknown as ReturnType<typeof useLlmEngine>);
  }

  it('a model change fires the PUT WITHOUT the alternates key', async () => {
    mockLegacyRead();
    renderChip();
    await userEvent.click(screen.getByRole('button', {name: new RegExp(aiContext.configDialogTitle)}));
    await userEvent.click(screen.getByTestId('llm-engine-option-openai:gpt-4o'));

    expect(mutateMock).toHaveBeenCalledTimes(1);
    const body = mutateMock.mock.calls[0][0] as Record<string, unknown>;
    expect(body).toEqual({provider: 'openai', model: 'gpt-4o', mode: 'fast'});
    // Key ABSENCE, not `alternates: undefined` — an old backend with
    // extra="forbid" 422s on the key itself.
    expect('alternates' in body).toBe(false);
  });
});
