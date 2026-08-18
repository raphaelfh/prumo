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

const ALT_RETIRED = {
  provider: 'openai',
  model: 'gpt-3.5-turbo',
  canonical: 'openai:gpt-3.5-turbo',
  retired: true,
};

const ALT_BYOK = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  canonical: 'anthropic:claude-sonnet-4-5',
  retired: false,
};

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

function renderChip() {
  return render(
    <MemoryRouter>
      <div data-testid="tab-sibling">sibling content</div>
      <LocationSpy />
      <LlmEngineChip projectId="p1" />
    </MemoryRouter>,
  );
}

/** Every popover assertion starts here: read mocked, chip rendered, open. */
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

describe('chip', () => {
  it('renders the resolved engine label and the Fast mode', () => {
    mockRead();
    renderChip();

    const chip = screen.getByRole('button', {name: copy.chipAria});
    expect(chip).toHaveTextContent('GPT-4o mini');
    expect(chip).toHaveTextContent(copy.modeFast);
  });

  it('renders the Verified mode label when the stored mode is verified', () => {
    mockRead({mode: 'verified'});
    renderChip();

    const chip = screen.getByRole('button', {name: copy.chipAria});
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
      screen.queryByRole('button', {name: copy.chipAria}),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('tab-sibling')).toBeInTheDocument();
  });

  it('falls back to the raw model string when the pair left the catalogue', () => {
    mockRead({model: 'gpt-3.5-turbo', retired: true, source: 'project'});
    renderChip();

    expect(
      screen.getByRole('button', {name: copy.chipAria}),
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
    // Row anatomy: best-for line + mono canonical + context/cost column.
    expect(screen.getByText('Fast bulk extraction')).toBeInTheDocument();
    expect(screen.getByText('openai:gpt-4o-mini')).toBeInTheDocument();
    expect(screen.getByText('200k')).toBeInTheDocument();
    // Million-token windows round to "M", never a five-digit "k".
    expect(screen.getByText('1M')).toBeInTheDocument();
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

  it('shows the stored mode selected with Verified enabled — no soon hint (§5 Verified)', async () => {
    await renderOpenPopover();

    const verified = screen.getByRole('radio', {name: copy.modeVerified});
    expect(verified).toBeEnabled();
    // The "soon" hint died with the disabled state.
    expect(verified.textContent).toBe(copy.modeVerified);
    expect(
      screen.getByRole('radio', {name: copy.modeFast}),
    ).toHaveAttribute('data-state', 'on');
  });

  it('drives the toggle from the stored mode on a verified project', async () => {
    await renderOpenPopover({mode: 'verified'});

    expect(
      screen.getByRole('radio', {name: copy.modeVerified}),
    ).toHaveAttribute('data-state', 'on');
    expect(
      screen.getByRole('radio', {name: copy.modeFast}),
    ).toHaveAttribute('data-state', 'off');
  });

  it('fires the mutation with the CHOSEN mode on toggle', async () => {
    await renderOpenPopover();

    await userEvent.click(screen.getByRole('radio', {name: copy.modeVerified}));

    expect(mutateMock).toHaveBeenCalledTimes(1);
    expect(mutateMock.mock.calls[0][0]).toEqual({
      provider: 'openai',
      model: 'gpt-4o-mini',
      mode: 'verified',
      alternates: [],
    });
  });

  it('re-clicking the active mode never fires a mutation (Radix deselect)', async () => {
    await renderOpenPopover();

    await userEvent.click(screen.getByRole('radio', {name: copy.modeFast}));

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

  it('a 422 from an old backend toasts generically and leaves the toggle unchanged (panel B3)', async () => {
    // The deploy window: FastAPI's raw `detail` body misses the client's
    // message chain, so the surfaced Error carries the generic copy (pinned
    // at the service level in llmEngineService.test.ts).
    mutateMock.mockImplementation(
      (_body: unknown, opts?: {onError?: (e: Error) => void}) => {
        opts?.onError?.(new Error('Unknown error'));
      },
    );
    await renderOpenPopover();

    await userEvent.click(screen.getByRole('radio', {name: copy.modeVerified}));

    expect(toast.error).toHaveBeenCalledWith(
      `${copy.saveError}: Unknown error`,
    );
    // No optimistic update: the toggle re-derives from the cached read.
    expect(
      screen.getByRole('radio', {name: copy.modeFast}),
    ).toHaveAttribute('data-state', 'on');
    expect(
      screen.getByRole('radio', {name: copy.modeVerified}),
    ).toHaveAttribute('data-state', 'off');
  });

  it('renders the attribution line only when the source is the project', async () => {
    await renderOpenPopover({
      source: 'project',
      updated_by_name: 'Alice Reviewer',
      updated_at: '2026-08-15T12:00:00Z',
      previous_model: 'gpt-4o',
    });

    const expected = copy.attribution
      .replace('{{name}}', 'Alice Reviewer')
      .replace(
        '{{date}}',
        // Compact "Aug 15" shape — the popover line must not carry a full
        // locale date.
        new Date('2026-08-15T12:00:00Z').toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        }),
      )
      .replace('{{model}}', 'gpt-4o');
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it('omits the attribution line for the env default', async () => {
    await renderOpenPopover();

    expect(
      screen.queryByText(/Model changed by/),
    ).not.toBeInTheDocument();
  });

  it('flags a retired stored engine with the amber re-choose note', async () => {
    await renderOpenPopover({model: 'gpt-3.5-turbo', retired: true, source: 'project'});

    expect(screen.getByRole('alert')).toHaveTextContent(copy.retiredNote);
  });
});

describe('alternates section', () => {
  it('renders the header, helper, and empty state when no alternates are stored', async () => {
    await renderOpenPopover();

    expect(screen.getByText(copy.alternatesTitle)).toBeInTheDocument();
    expect(screen.getByText(copy.alternatesHelper)).toBeInTheDocument();
    expect(screen.getByText(copy.alternatesEmpty)).toBeInTheDocument();
  });

  it('toggling an alternate ON fires the PUT with the full body incl. explicit mode', async () => {
    await renderOpenPopover();

    await userEvent.click(
      screen.getByRole('button', {name: copy.alternatesAddLabel}),
    );
    await userEvent.click(screen.getByTestId('llm-engine-option-openai:gpt-4o'));

    expect(mutateMock).toHaveBeenCalledTimes(1);
    expect(mutateMock.mock.calls[0][0]).toEqual({
      provider: 'openai',
      model: 'gpt-4o-mini',
      mode: 'fast',
      alternates: [{provider: 'openai', model: 'gpt-4o'}],
    });
  });

  it('toggling a member OFF strips it from the PUT alternates', async () => {
    await renderOpenPopover({alternates: [ALT_GPT41]});

    await userEvent.click(
      screen.getByRole('button', {name: copy.alternatesAddLabel}),
    );

    // a11y: managing mode is a multiselect — each membership row exposes
    // its state as aria-checked (role=option supports it).
    expect(
      screen.getByTestId('llm-engine-option-openai:gpt-4.1-mini'),
    ).toHaveAttribute('aria-checked', 'true');
    expect(
      screen.getByTestId('llm-engine-option-openai:gpt-4o'),
    ).toHaveAttribute('aria-checked', 'false');

    await userEvent.click(
      screen.getByTestId('llm-engine-option-openai:gpt-4.1-mini'),
    );

    expect(mutateMock).toHaveBeenCalledTimes(1);
    expect(mutateMock.mock.calls[0][0]).toEqual({
      provider: 'openai',
      model: 'gpt-4o-mini',
      mode: 'fast',
      alternates: [],
    });
  });

  it('disables the current default row in managing mode with the primary note', async () => {
    await renderOpenPopover();

    await userEvent.click(
      screen.getByRole('button', {name: copy.alternatesAddLabel}),
    );

    const current = screen.getByTestId('llm-engine-option-openai:gpt-4o-mini');
    expect(current).toHaveAttribute('aria-disabled', 'true');
    expect(
      within(current).getByText(copy.alternatesPrimaryNote),
    ).toBeInTheDocument();

    await userEvent.click(current);
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it('renders a retired alternate with the amber treatment and canonical fallback label', async () => {
    // gpt-3.5-turbo left the catalogue: no label match, so the row falls
    // back to the canonical id — flagged amber like the retiredNote.
    await renderOpenPopover({alternates: [ALT_RETIRED]});

    const row = screen.getByTestId(
      'llm-engine-alternate-openai:gpt-3.5-turbo',
    );
    expect(row).toHaveTextContent('openai:gpt-3.5-turbo');
    expect(row.className).toContain('text-warning');
  });

  it('shows the BYOK-only inline warning on a BYOK alternate', async () => {
    await renderOpenPopover({alternates: [ALT_BYOK]});

    expect(screen.getByText(copy.alternatesByokWarn)).toBeInTheDocument();
  });

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

  it('the remove button strips the alternate and PUTs the remainder', async () => {
    await renderOpenPopover({alternates: [ALT_GPT41, ALT_BYOK]});

    const row = screen.getByTestId(
      'llm-engine-alternate-openai:gpt-4.1-mini',
    );
    await userEvent.click(
      within(row).getByRole('button', {name: copy.alternatesRemoveAria}),
    );

    expect(mutateMock).toHaveBeenCalledTimes(1);
    expect(mutateMock.mock.calls[0][0]).toEqual({
      provider: 'openai',
      model: 'gpt-4o-mini',
      mode: 'fast',
      alternates: [{provider: 'anthropic', model: 'claude-sonnet-4-5'}],
    });
  });

  it('a successful membership toggle toasts the alternates-specific copy', async () => {
    mutateMock.mockImplementation(
      (_body: unknown, opts?: {onSuccess?: () => void}) => opts?.onSuccess?.(),
    );
    await renderOpenPopover();

    await userEvent.click(
      screen.getByRole('button', {name: copy.alternatesAddLabel}),
    );
    await userEvent.click(screen.getByTestId('llm-engine-option-openai:gpt-4o'));

    expect(toast.success).toHaveBeenCalledWith(copy.alternatesSaveSuccess);
  });

  it('a failed remove toasts the alternates-specific error copy', async () => {
    mutateMock.mockImplementation(
      (_body: unknown, opts?: {onError?: (e: Error) => void}) =>
        opts?.onError?.(new Error('boom')),
    );
    await renderOpenPopover({alternates: [ALT_GPT41]});

    const row = screen.getByTestId('llm-engine-alternate-openai:gpt-4.1-mini');
    await userEvent.click(
      within(row).getByRole('button', {name: copy.alternatesRemoveAria}),
    );

    expect(toast.error).toHaveBeenCalledWith(
      `${copy.alternatesSaveError}: boom`,
    );
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

describe('pending mutation guards (lost-update race)', () => {
  // Back-to-back mutations both computed `next` from the SAME stale list —
  // the second PUT silently reverted the first. While one is in flight the
  // membership toggles and remove buttons are disabled and inert.
  beforeEach(() => {
    useSetLlmEngineMock.mockReturnValue({
      mutate: mutateMock,
      isPending: true,
    } as unknown as ReturnType<typeof useSetLlmEngine>);
  });

  it('disables the remove button while the mutation is pending', async () => {
    await renderOpenPopover({alternates: [ALT_GPT41]});

    const row = screen.getByTestId('llm-engine-alternate-openai:gpt-4.1-mini');
    const removeButton = within(row).getByRole('button', {
      name: copy.alternatesRemoveAria,
    });
    expect(removeButton).toBeDisabled();

    await userEvent.click(removeButton);
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it('disables the managing-mode membership toggles while the mutation is pending', async () => {
    await renderOpenPopover();

    await userEvent.click(
      screen.getByRole('button', {name: copy.alternatesAddLabel}),
    );

    const option = screen.getByTestId('llm-engine-option-openai:gpt-4o');
    expect(option).toHaveAttribute('aria-disabled', 'true');

    await userEvent.click(option);
    expect(mutateMock).not.toHaveBeenCalled();
  });
});

describe('alternates — deploy-window tolerance (old backend omits the field)', () => {
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

  it('renders the popover without crashing on a legacy payload', async () => {
    mockLegacyRead();
    renderChip();
    await userEvent.click(screen.getByRole('button', {name: copy.chipAria}));

    expect(screen.getByText(copy.alternatesTitle)).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(copy.searchPlaceholder),
    ).toBeInTheDocument();
  });

  it('hides the Add-alternate affordance on a legacy payload (old backend 422s alternates writes)', async () => {
    mockLegacyRead();
    renderChip();
    await userEvent.click(screen.getByRole('button', {name: copy.chipAria}));

    expect(
      screen.queryByRole('button', {name: copy.alternatesAddLabel}),
    ).not.toBeInTheDocument();
  });

  it('a model change fires the PUT WITHOUT the alternates key', async () => {
    mockLegacyRead();
    renderChip();
    await userEvent.click(screen.getByRole('button', {name: copy.chipAria}));
    await userEvent.click(screen.getByTestId('llm-engine-option-openai:gpt-4o'));

    expect(mutateMock).toHaveBeenCalledTimes(1);
    const body = mutateMock.mock.calls[0][0] as Record<string, unknown>;
    expect(body).toEqual({provider: 'openai', model: 'gpt-4o', mode: 'fast'});
    // Key ABSENCE, not `alternates: undefined` — an old backend with
    // extra="forbid" 422s on the key itself.
    expect('alternates' in body).toBe(false);
  });
});
