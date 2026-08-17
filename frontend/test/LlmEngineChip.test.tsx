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
import {llmEngine as copy} from '@/lib/copy';
import type {LlmEngineRead} from '@/services/llmEngineService';

const useLlmEngineMock = vi.mocked(useLlmEngine);
const useSetLlmEngineMock = vi.mocked(useSetLlmEngine);

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

const ENGINE_READ: LlmEngineRead = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  mode: 'fast',
  source: 'default',
  retired: false,
  updated_by_name: null,
  updated_at: null,
  previous_model: null,
  catalog: CATALOG,
  availability: {openai: true, anthropic: false},
};

const mutateMock = vi.fn();

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

    // Arrow past the end of the list: the LAST enabled item is the CTA
    // (the locked model row before it is skipped by cmdk).
    await userEvent.click(screen.getByPlaceholderText(copy.searchPlaceholder));
    await userEvent.keyboard(
      '{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{Enter}',
    );

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
