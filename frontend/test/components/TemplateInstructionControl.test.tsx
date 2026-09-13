import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
import {TooltipProvider} from '@/components/ui/tooltip';
import {TemplateInstructionControl} from '@/components/extraction/TemplateInstructionControl';

function renderControl({
  draft = null,
  expanded,
  onActivate = vi.fn(),
}: {draft?: string | null; expanded?: boolean; onActivate?: () => void} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {queries: {retry: false}, mutations: {retry: false}},
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <TemplateInstructionControl
          projectId="p1"
          templateId="t1"
          draft={draft}
          expanded={expanded}
          onActivate={onActivate}
        />
      </TooltipProvider>
    </QueryClientProvider>,
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

  it('activates its host instead of opening a dialog', async () => {
    getTemplateInstruction.mockResolvedValue({project_template_id: 't1', llm_template_instruction: 'Set', default_instruction: null});
    const onActivate = vi.fn();
    renderControl({onActivate});
    await userEvent.click(await screen.findByRole('button', {name: /instructionTitle/}));
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('reports expansion only when the host tracks it', async () => {
    getTemplateInstruction.mockResolvedValue({project_template_id: 't1', llm_template_instruction: 'Set', default_instruction: null});
    const {unmount} = renderControl({expanded: true});
    expect(await screen.findByRole('button', {name: /instructionTitle/})).toHaveAttribute('aria-expanded', 'true');
    unmount();
    renderControl();
    expect(await screen.findByRole('button', {name: /instructionTitle/})).not.toHaveAttribute('aria-expanded');
  });

  it('marks an unsaved host draft in its accessible name', async () => {
    getTemplateInstruction.mockResolvedValue({project_template_id: 't1', llm_template_instruction: 'Set', default_instruction: null});
    renderControl({draft: 'Set, edited'});
    expect(await screen.findByRole('button', {name: /instructionTitle/})).toHaveAccessibleName(
      expect.stringContaining('instructionUnsavedDraft'),
    );
  });
});
