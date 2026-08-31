/**
 * The config bar's "Project context" chip.
 *
 * Placement carries meaning here: the bar's existing hairline separates the
 * project regime from the versioned-template regime, and the chip belongs on
 * the project side because the review question applies to the NEXT run rather
 * than shipping on Publish. The count exists so an unfilled letter is visible
 * before it becomes invisible to the AI.
 */
import {render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/hooks/project/useAiContext', () => ({
  useAiContext: vi.fn(),
  useSetAiContext: vi.fn(() => ({mutate: vi.fn(), isPending: false})),
}));
// Imported (not called — the chip renders here without a templateId) via the
// shared AI dialog; unmocked it drags the supabase client into module init.
vi.mock('@/services/templateInstructionService', () => ({
  getTemplateInstruction: vi.fn(),
  updateTemplateInstruction: vi.fn(),
}));
// The dialog's model tab: an errored read keeps that pane inert so this
// suite stays about the chip.
vi.mock('@/hooks/extraction/useLlmEngine', () => ({
  useLlmEngine: () => ({data: undefined, isError: true, isPending: false}),
  useSetLlmEngine: () => ({mutate: vi.fn(), isPending: false}),
}));
vi.mock('@/hooks/extraction/useLlmEndpoints', () => ({
  useLlmEndpoints: () => ({data: [], isError: false, isPending: false}),
  useCreateLlmEndpoint: () => ({mutate: vi.fn(), isPending: false}),
  useUpdateLlmEndpoint: () => ({mutate: vi.fn(), isPending: false}),
  useDeleteLlmEndpoint: () => ({mutate: vi.fn(), isPending: false}),
  useVerifyLlmEndpoint: () => ({mutate: vi.fn(), isPending: false}),
}));
vi.mock('@/hooks/extraction/useTemplateInstruction', () => ({
  useTemplateInstruction: () => ({data: undefined, isLoading: true}),
  useUpdateTemplateInstruction: () => ({mutate: vi.fn(), isPending: false}),
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {success: vi.fn(), error: vi.fn(), info: vi.fn()}),
}));

import {useAiContext} from '@/hooks/project/useAiContext';
import {TooltipProvider} from '@/components/ui/tooltip';
import {ProjectContextChip} from '@/components/project/ProjectContextChip';

const PROJECT_ID = 'p-1';

// `TooltipProvider` is a bare Radix re-export: the app supplies one at the
// root, so the chip does not carry its own, but a test rendering it in
// isolation must.
const renderChip = () =>
  render(
    // MemoryRouter: the dialog's model tab deep-links to the key settings.
    <MemoryRouter>
      <TooltipProvider>
        <ProjectContextChip projectId={PROJECT_ID} />
      </TooltipProvider>
    </MemoryRouter>,
  );

function read(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      picots: {
        population: {description: 'Adults'},
        index_models: {description: 'ML models'},
        comparator_models: {description: ''},
        outcomes: {description: ''},
        timing: {description: ''},
        setting_and_intended_use: {description: ''},
      },
      labels: {},
      picots_enabled: true,
      preview: '- Population: Adults',
      ...overrides,
    },
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useAiContext>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAiContext).mockReturnValue(read());
});

describe('ProjectContextChip', () => {
  it('counts the FILLED slots, not the total', () => {
    renderChip();
    expect(screen.getByText('2/6')).toBeInTheDocument();
  });

  it('says so when the question is stored but switched off', () => {
    vi.mocked(useAiContext).mockReturnValue(read({picots_enabled: false}));
    renderChip();
    // A count would read as "being sent"; it is not.
    expect(screen.getByText('off')).toBeInTheDocument();
    expect(screen.queryByText('2/6')).toBeNull();
  });

  it('keeps its label in the accessible name when the bar narrows', () => {
    renderChip();
    // `sr-only`, never `hidden`: `hidden` would drop the word from the
    // accessibility tree and the control would lose its name at narrow widths.
    expect(
      screen.getByRole('button', {name: /Project context/}),
    ).toBeInTheDocument();
  });

  it('opens the shared editor rather than a second one', async () => {
    const user = userEvent.setup();
    renderChip();

    await user.click(screen.getByTestId('project-context-chip'));

    // Same dialog the Project Settings summary opens — one editor, three
    // triggers, so the two surfaces cannot drift.
    expect(screen.getByText('Review question')).toBeInTheDocument();
  });
});
