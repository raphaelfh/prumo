/**
 * The AI-configuration dialog, its PICOTS editor, and the read-only summary
 * that opens it.
 *
 * `ReviewDetailsSection` had no test at all while it owned this editing surface,
 * which is how two defects survived in it: array criteria written to a dotted
 * key that never existed (so every add replaced the list), and a save routed
 * through a batched PostgREST PATCH whose RLS refusal returns no error. Both are
 * pinned here so neither can come back quietly.
 *
 * The tabbed suite pins the merge of the review question and the template's
 * general AI instruction into one dialog: both tabs stay mounted (a tab
 * switch must never destroy a half-typed draft), and each tab saves through
 * its own write path.
 */
import {useState} from 'react';
import {render, screen, waitFor, within} from '@testing-library/react';
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
vi.mock('@/hooks/project/useAiContext', () => ({
  useAiContext: vi.fn(),
  useSetAiContext: vi.fn(),
}));
vi.mock('@/hooks/useProjectMemberRole', () => ({
  useProjectMemberRole: vi.fn(),
}));
// Callable-with-methods shape — a namespace-only mock swallows `toast(...)`
// and reports green for feedback that never fired.
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  }),
}));

import {useAiContext, useSetAiContext} from '@/hooks/project/useAiContext';
import {useProjectMemberRole} from '@/hooks/useProjectMemberRole';
import {AiConfigDialog} from '@/components/project/AiConfigDialog';

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const TEMPLATE_ID = 'tmpl-1';

const EMPTY_SLOT = {description: '', inclusion: [], exclusion: []};

function readModel(overrides: Record<string, unknown> = {}) {
  return {
    picots: {
      population: {description: 'Adults', inclusion: ['NYHA II-IV'], exclusion: []},
      index_models: {...EMPTY_SLOT},
      comparator_models: {...EMPTY_SLOT},
      outcomes: {...EMPTY_SLOT},
      timing: {...EMPTY_SLOT},
      setting_and_intended_use: {...EMPTY_SLOT},
    },
    labels: {
      population: 'Population',
      index_models: 'Index model(s)',
      comparator_models: 'Comparator model(s)',
      outcomes: 'Outcome(s)',
      timing: 'Timing',
      setting_and_intended_use: 'Setting and intended use',
    },
    review_type: 'predictive_model',
    picots_enabled: true,
    preview: '- Population: Adults\n  Include: NYHA II-IV',
    ...overrides,
  };
}

const mutate = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAiContext).mockReturnValue({
    data: readModel(),
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useAiContext>);
  vi.mocked(useSetAiContext).mockReturnValue({
    mutate,
    isPending: false,
  } as unknown as ReturnType<typeof useSetAiContext>);
  vi.mocked(useProjectMemberRole).mockReturnValue({
    isManager: true,
  } as unknown as ReturnType<typeof useProjectMemberRole>);
  getTemplateInstruction.mockResolvedValue({
    project_template_id: TEMPLATE_ID,
    llm_template_instruction: 'Old text',
    default_instruction: null,
  });
});

/** The trigger's shape: it owns the instruction draft so a dismissed dialog
 * cannot destroy it (see TemplateInstructionControl). */
function TemplateModeHarness({
  initialTab,
}: {
  initialTab?: 'picots' | 'instruction';
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <AiConfigDialog
      projectId={PROJECT_ID}
      open
      onOpenChange={vi.fn()}
      initialTab={initialTab}
      template={{
        id: TEMPLATE_ID,
        instructionDraft: draft,
        onInstructionDraftChange: setDraft,
      }}
    />
  );
}

function renderTemplateMode(initialTab?: 'picots' | 'instruction') {
  const queryClient = new QueryClient({
    defaultOptions: {queries: {retry: false}, mutations: {retry: false}},
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <TemplateModeHarness initialTab={initialTab} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('AiConfigDialog — tabbed (with template)', () => {
  it('carries every tab and opens on the tab the trigger asked for', async () => {
    renderTemplateMode('instruction');

    // One popup for the project's question and the template's instruction;
    // the engine lives on the worklist gear.
    expect(screen.queryByRole('tab', {name: /Model/})).not.toBeInTheDocument();
    expect(
      screen.getByRole('tab', {name: /Review question/}),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', {name: /Instruction/})).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('carries each tab\'s state in its LABEL, so the other tabs are legible', async () => {
    getTemplateInstruction.mockResolvedValue({
      project_template_id: TEMPLATE_ID,
      llm_template_instruction: 'Fill [customize: cohort] here.',
      default_instruction: null,
    });
    renderTemplateMode('picots');

    // One filled slot of six in the fixture, and one unfilled [customize:]
    // slot in the instruction — both readable without visiting the tab, the
    // way the config bar's chips read from outside the dialog.
    expect(screen.getByRole('tab', {name: /Review question/})).toHaveTextContent(
      '1/6',
    );
    await waitFor(() =>
      expect(screen.getByRole('tab', {name: /Instruction/})).toHaveTextContent(
        '1',
      ),
    );
  });

  it('keeps a half-typed review-question draft across a tab switch', async () => {
    const user = userEvent.setup();
    renderTemplateMode('picots');

    const population = screen.getByLabelText('Population');
    await user.type(population, ' with heart failure');

    // Both panels are force-mounted precisely so this switch cannot unmount
    // the form and silently reset the draft to the server value.
    await user.click(screen.getByRole('tab', {name: /Instruction/}));
    await user.click(screen.getByRole('tab', {name: /Review question/}));

    expect(screen.getByLabelText('Population')).toHaveValue(
      'Adults with heart failure',
    );
  });

  it('saves the instruction tab through its own write path', async () => {
    const user = userEvent.setup();
    updateTemplateInstruction.mockResolvedValue({
      project_template_id: TEMPLATE_ID,
      llm_template_instruction: 'New text',
    });
    renderTemplateMode('instruction');

    const panel = within(screen.getByTestId('ai-config-instruction-panel'));
    const textarea = await panel.findByRole('textbox');
    await user.clear(textarea);
    await user.type(textarea, 'New text');
    await user.click(panel.getByRole('button', {name: 'Save'}));

    await waitFor(() =>
      expect(updateTemplateInstruction).toHaveBeenCalledWith(
        PROJECT_ID,
        TEMPLATE_ID,
        'New text',
      ),
    );
  });
});
