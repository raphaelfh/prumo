/**
 * LlmEngineSettingsDialog — the POLICY half of the engine surface (slice C).
 *
 * These contracts used to live in the picker popover and moved here wholesale
 * when the popover became selection-only: the Fast/Verified mode, the retired
 * alert, the attribution line, and the alternate-engine list (including the
 * lost-update guards and the deploy-window tolerance for an old backend that
 * omits `alternates`).
 *
 * The one deliberate behavioural change is the alternates picker: in the
 * popover it was a MODE that flipped the Command list into multi-select; here
 * it is a plain checkbox list, so a row is toggled directly.
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

import {LlmEngineSettingsDialog} from '@/components/extraction/LlmEngineSettingsDialog';
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
      <LlmEngineSettingsDialog projectId="p1" open onOpenChange={() => {}} />
    </MemoryRouter>,
  );
}

/**
 * Every assertion starts here. The dialog renders open directly rather than
 * driving chip → footer link → dialog: these are the POLICY contracts, and
 * routing through the picker would retest the picker on every one of them.
 */
async function renderSettings(overrides: Partial<LlmEngineRead> = {}) {
  mockRead(overrides);
  renderChip();
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


describe('LlmEngineSettingsDialog', () => {
  // --- moved from LlmEngineChip.test.tsx L330-374 ---
  it('shows the stored mode selected with Verified enabled — no soon hint (§5 Verified)', async () => {
    await renderSettings();

    const verified = screen.getByRole('radio', {name: copy.modeVerified});
    expect(verified).toBeEnabled();
    // The "soon" hint died with the disabled state.
    expect(verified.textContent).toBe(copy.modeVerified);
    expect(
      screen.getByRole('radio', {name: copy.modeFast}),
    ).toHaveAttribute('data-state', 'on');
  });

  it('drives the toggle from the stored mode on a verified project', async () => {
    await renderSettings({mode: 'verified'});

    expect(
      screen.getByRole('radio', {name: copy.modeVerified}),
    ).toHaveAttribute('data-state', 'on');
    expect(
      screen.getByRole('radio', {name: copy.modeFast}),
    ).toHaveAttribute('data-state', 'off');
  });

  it('fires the mutation with the CHOSEN mode on toggle', async () => {
    await renderSettings();

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
    await renderSettings();

    await userEvent.click(screen.getByRole('radio', {name: copy.modeFast}));

    expect(mutateMock).not.toHaveBeenCalled();
  });


  // --- moved from LlmEngineChip.test.tsx L392-452 ---
  it('a 422 from an old backend toasts generically and leaves the toggle unchanged (panel B3)', async () => {
    // The deploy window: FastAPI's raw `detail` body misses the client's
    // message chain, so the surfaced Error carries the generic copy (pinned
    // at the service level in llmEngineService.test.ts).
    mutateMock.mockImplementation(
      (_body: unknown, opts?: {onError?: (e: Error) => void}) => {
        opts?.onError?.(new Error('Unknown error'));
      },
    );
    await renderSettings();

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
    await renderSettings({
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
    await renderSettings();

    expect(
      screen.queryByText(/Model changed by/),
    ).not.toBeInTheDocument();
  });

  it('flags a retired stored engine with the amber re-choose note', async () => {
    await renderSettings({model: 'gpt-3.5-turbo', retired: true, source: 'project'});

    expect(screen.getByRole('alert')).toHaveTextContent(copy.retiredNote);
  });

  // --- moved from LlmEngineChip.test.tsx L456-544 ---
  it('renders the header, helper, and empty state when no alternates are stored', async () => {
    await renderSettings();

    expect(screen.getByText(copy.alternatesTitle)).toBeInTheDocument();
    expect(screen.getByText(copy.alternatesHelper)).toBeInTheDocument();
    expect(screen.getByText(copy.alternatesEmpty)).toBeInTheDocument();
  });

  it('toggling an alternate ON fires the PUT with the full body incl. explicit mode', async () => {
    await renderSettings();

    // Slice C: membership is a plain checkbox, always visible. In the popover
    // this needed an "Add alternate" mode flip first.
    await userEvent.click(
      screen.getByTestId('llm-engine-alternate-toggle-openai:gpt-4o'),
    );

    expect(mutateMock).toHaveBeenCalledTimes(1);
    expect(mutateMock.mock.calls[0][0]).toEqual({
      provider: 'openai',
      model: 'gpt-4o-mini',
      mode: 'fast',
      alternates: [{provider: 'openai', model: 'gpt-4o'}],
    });
  });

  it('toggling a member OFF strips it from the PUT alternates', async () => {
    await renderSettings({alternates: [ALT_GPT41]});

    // a11y: the checkbox carries membership state natively.
    expect(
      screen.getByTestId('llm-engine-alternate-toggle-openai:gpt-4.1-mini'),
    ).toBeChecked();
    expect(
      screen.getByTestId('llm-engine-alternate-toggle-openai:gpt-4o'),
    ).not.toBeChecked();

    await userEvent.click(
      screen.getByTestId('llm-engine-alternate-toggle-openai:gpt-4.1-mini'),
    );

    expect(mutateMock).toHaveBeenCalledTimes(1);
    expect(mutateMock.mock.calls[0][0]).toEqual({
      provider: 'openai',
      model: 'gpt-4o-mini',
      mode: 'fast',
      alternates: [],
    });
  });

  it('disables the current default and marks it, so it cannot be its own alternate', async () => {
    await renderSettings();

    const current = screen.getByTestId(
      'llm-engine-alternate-toggle-openai:gpt-4o-mini',
    );
    expect(current).toBeDisabled();
    expect(screen.getByText(copy.alternatesPrimaryNote)).toBeInTheDocument();

    await userEvent.click(current);
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it('renders a retired alternate with the amber treatment and canonical fallback label', async () => {
    // gpt-3.5-turbo left the catalogue: no label match, so the row falls
    // back to the canonical id — flagged amber like the retiredNote.
    await renderSettings({alternates: [ALT_RETIRED]});

    const row = screen.getByTestId(
      'llm-engine-alternate-openai:gpt-3.5-turbo',
    );
    expect(row).toHaveTextContent('openai:gpt-3.5-turbo');
    expect(row.className).toContain('text-warning');
  });

  it('shows the BYOK-only inline warning on a BYOK alternate', async () => {
    await renderSettings({alternates: [ALT_BYOK]});

    expect(screen.getByText(copy.alternatesByokWarn)).toBeInTheDocument();
  });


  // --- moved from LlmEngineChip.test.tsx L559-608 ---
  it('the remove button strips the alternate and PUTs the remainder', async () => {
    await renderSettings({alternates: [ALT_GPT41, ALT_BYOK]});

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
    await renderSettings();

    await userEvent.click(
      screen.getByTestId('llm-engine-alternate-toggle-openai:gpt-4o'),
    );

    expect(toast.success).toHaveBeenCalledWith(copy.alternatesSaveSuccess);
  });

  it('a failed remove toasts the alternates-specific error copy', async () => {
    mutateMock.mockImplementation(
      (_body: unknown, opts?: {onError?: (e: Error) => void}) =>
        opts?.onError?.(new Error('boom')),
    );
    await renderSettings({alternates: [ALT_GPT41]});

    const row = screen.getByTestId('llm-engine-alternate-openai:gpt-4.1-mini');
    await userEvent.click(
      within(row).getByRole('button', {name: copy.alternatesRemoveAria}),
    );

    expect(toast.error).toHaveBeenCalledWith(
      `${copy.alternatesSaveError}: boom`,
    );
  });


  // --- moved from LlmEngineChip.test.tsx L621-658 ---
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
    await renderSettings({alternates: [ALT_GPT41]});

    const row = screen.getByTestId('llm-engine-alternate-openai:gpt-4.1-mini');
    const removeButton = within(row).getByRole('button', {
      name: copy.alternatesRemoveAria,
    });
    expect(removeButton).toBeDisabled();

    await userEvent.click(removeButton);
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it('disables the membership checkboxes while the mutation is pending', async () => {
    await renderSettings();

    const option = screen.getByTestId(
      'llm-engine-alternate-toggle-openai:gpt-4o',
    );
    expect(option).toBeDisabled();

    await userEvent.click(option);
    expect(mutateMock).not.toHaveBeenCalled();
  });
});

  // --- moved from LlmEngineChip.test.tsx L675-695 ---
  describe('deploy-window tolerance (old backend omits `alternates`)', () => {
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

    it('renders without crashing on a legacy payload', () => {
      mockLegacyRead();
      renderChip();

      expect(screen.getByText(copy.alternatesTitle)).toBeInTheDocument();
      expect(screen.getByText(copy.alternatesEmpty)).toBeInTheDocument();
    });

    it('hides the membership picker on a legacy payload (old backend 422s alternates writes)', () => {
      mockLegacyRead();
      renderChip();

      expect(
        screen.queryByTestId('llm-engine-alternates-picker'),
      ).not.toBeInTheDocument();
    });
  });



});
