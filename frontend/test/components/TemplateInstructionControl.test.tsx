import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter} from 'react-router';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const getTemplateInstruction = vi.fn();
const updateTemplateInstruction = vi.fn();
vi.mock('@/services/templateInstructionService', () => ({
  getTemplateInstruction: (...a: unknown[]) => getTemplateInstruction(...a),
  updateTemplateInstruction: (...a: unknown[]) => updateTemplateInstruction(...a),
}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn()}}));
vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));
// The dialog the trigger opens force-mounts its review-question tab too;
// an errored read keeps that pane inert so these tests stay about the
// instruction surface.
vi.mock('@/hooks/project/useAiContext', () => ({
  useAiContext: () => ({data: undefined, isLoading: false, isError: true}),
  useSetAiContext: () => ({mutate: vi.fn(), isPending: false}),
}));
// Same reason for the model tab: an errored read keeps that pane inert so
// these tests stay about the instruction surface.
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

import {TooltipProvider} from '@/components/ui/tooltip';
import {TemplateInstructionControl} from '@/components/extraction/TemplateInstructionControl';

function renderControl() {
  const queryClient = new QueryClient({
    defaultOptions: {queries: {retry: false}, mutations: {retry: false}},
  });
  return render(
    // MemoryRouter: the dialog's model tab deep-links to the key settings.
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <TemplateInstructionControl projectId="p1" templateId="t1" />
        </TooltipProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TemplateInstructionControl', () => {
  it('shows the empty ghost state when no instruction is set', async () => {
    getTemplateInstruction.mockResolvedValue({
      project_template_id: 't1',
      llm_template_instruction: null,
      default_instruction: null,
    });
    renderControl();
    // No preview on the bar any more — "nothing set yet" reaches a screen
    // reader through the trigger's own accessible name.
    expect(await screen.findByText('instructionEmpty')).toBeInTheDocument();
  });

  it('shows a customize chip when unresolved [customize:] slots remain', async () => {
    getTemplateInstruction.mockResolvedValue({
      project_template_id: 't1',
      llm_template_instruction: 'Do X. [customize: scope] Do Y. [customize: cohort]',
      default_instruction: null,
    });
    renderControl();
    expect(
      await screen.findByTestId('instruction-customize-chip'),
    ).toBeInTheDocument();
  });

  it('renders no customize chip when no slots remain', async () => {
    getTemplateInstruction.mockResolvedValue({
      project_template_id: 't1',
      llm_template_instruction: 'All resolved.',
      default_instruction: null,
    });
    renderControl();
    await screen.findByRole('button', {name: /instructionTitle/});
    expect(screen.queryByTestId('instruction-customize-chip')).toBeNull();
  });

  it('expands, edits, and saves through the mutation', async () => {
    getTemplateInstruction.mockResolvedValue({
      project_template_id: 't1',
      llm_template_instruction: 'Old text',
      default_instruction: null,
    });
    // B-4 response shape: a draft edit — no version fields.
    updateTemplateInstruction.mockResolvedValue({
      project_template_id: 't1',
      llm_template_instruction: 'New text',
    });
    renderControl();
    await userEvent.click(
      await screen.findByRole('button', {name: /instructionTitle/}),
    );
    const textarea = screen.getByRole('textbox');
    await userEvent.clear(textarea);
    await userEvent.type(textarea, 'New text');
    await userEvent.click(screen.getByRole('button', {name: 'instructionSave'}));
    await waitFor(() =>
      expect(updateTemplateInstruction).toHaveBeenCalledWith('p1', 't1', 'New text'),
    );
  });

  it('reset-to-default fills the textarea with the origin text', async () => {
    getTemplateInstruction.mockResolvedValue({
      project_template_id: 't1',
      llm_template_instruction: 'Customized',
      default_instruction: 'Origin default',
    });
    renderControl();
    await userEvent.click(
      await screen.findByRole('button', {name: /instructionTitle/}),
    );
    await userEvent.click(
      screen.getByRole('button', {name: 'instructionResetDefault'}),
    );
    expect(screen.getByRole('textbox')).toHaveValue('Origin default');
  });

  it('keeps the unresolved-slot warning readable without opening anything', async () => {
    getTemplateInstruction.mockResolvedValue({
      project_template_id: 't1',
      llm_template_instruction: 'Fill [customize: cohort] here.',
      default_instruction: null,
    });
    renderControl();
    // The chip is the one instruction signal that must survive the collapse:
    // unfilled slots ship straight into prompts. It has to be IN the trigger's
    // accessible name, so an aria-label that replaces the content is a defect.
    const trigger = await screen.findByRole('button', {name: /instructionTitle/});
    expect(trigger).toHaveAccessibleName(
      expect.stringContaining('instructionCustomizeChip'),
    );
    expect(screen.getByTestId('instruction-customize-chip')).toBeInTheDocument();
  });

  it('preserves an unsaved draft when the dialog is dismissed', async () => {
    getTemplateInstruction.mockResolvedValue({
      project_template_id: 't1',
      llm_template_instruction: 'Old text',
      default_instruction: null,
    });
    renderControl();
    const trigger = await screen.findByRole('button', {name: /instructionTitle/});
    await userEvent.click(trigger);
    await userEvent.type(screen.getByRole('textbox'), ' plus mine');
    // Dismissing the dialog must not silently destroy prose the manager
    // typed — the draft outlives the surface that edits it.
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
    await userEvent.click(screen.getByRole('button', {name: /instructionTitle/}));
    expect(screen.getByRole('textbox')).toHaveValue('Old text plus mine');
  });
});
