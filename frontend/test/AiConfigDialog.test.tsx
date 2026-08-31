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

// The model tab reads the engine catalogue; mocked so this suite stays about
// the dialog's own composition (the picker has its own two suites).
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
import {ReviewDetailsSection} from '@/components/project/settings/ReviewDetailsSection';

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

describe('AiConfigDialog — review question (no template)', () => {
  it('labels the slots with the wording the server says the prompt emits', () => {
    render(
      <AiConfigDialog projectId={PROJECT_ID} open onOpenChange={vi.fn()} />,
    );

    // Instrument wording, not a frontend copy of it: PROBAST+AI phrases its
    // applicability items against "index model(s)".
    expect(screen.getByText('Index model(s)')).toBeInTheDocument();
    expect(screen.getByText('Comparator model(s)')).toBeInTheDocument();
  });

  it('renders the server preview verbatim rather than re-deriving it', async () => {
    const user = userEvent.setup();
    render(<AiConfigDialog projectId={PROJECT_ID} open onOpenChange={vi.fn()} />);

    // Collapsed by default — it sits at the top of the pane where it is
    // discoverable, and costs no height until asked for.
    expect(document.querySelector('pre')).toBeNull();
    await user.click(screen.getByRole('button', {name: /What the AI is sent/}));

    // textContent off the DOCUMENT (the dialog renders in a Radix portal, so the
    // render container does not contain it), and not getByText: that matcher
    // normalizes whitespace, whereas the newline/indent IS the contract here —
    // this is the exact string the model receives.
    const pre = document.querySelector('pre');
    expect(pre?.textContent).toBe('- Population: Adults\n  Include: NYHA II-IV');
  });

  it('saves through the typed PUT, carrying the loaded slots', async () => {
    const user = userEvent.setup();
    render(
      <AiConfigDialog projectId={PROJECT_ID} open onOpenChange={vi.fn()} />,
    );

    await user.click(screen.getByRole('button', {name: 'Save'}));

    expect(mutate).toHaveBeenCalledTimes(1);
    const body = mutate.mock.calls[0][0];
    expect(body.picots.population.description).toBe('Adults');
    expect(body.picots_enabled).toBe(true);
  });

  it('APPENDS a criterion instead of replacing the list', async () => {
    const user = userEvent.setup();
    render(
      <AiConfigDialog projectId={PROJECT_ID} open onOpenChange={vi.fn()} />,
    );

    // The predecessor looked up a dotted key that was never on the object, so
    // the existing entry was silently dropped on every add.
    const inputs = screen.getAllByRole('textbox');
    const tagInput = inputs.find(
      (el) => (el as HTMLInputElement).type === 'text',
    );
    if (tagInput) {
      await user.type(tagInput, 'adults only{Enter}');
    }
    await user.click(screen.getByRole('button', {name: 'Save'}));

    const body = mutate.mock.calls[0][0];
    expect(body.picots.population.inclusion).toContain('NYHA II-IV');
  });

  it('renders criteria lists only for Population — other slots are description-only', () => {
    render(
      <AiConfigDialog projectId={PROJECT_ID} open onOpenChange={vi.fn()} />,
    );

    // The two TagInputs (inclusion + exclusion) belong to Population alone;
    // the other five slots are a plain description box.
    const tagInputs = screen
      .getAllByRole('textbox')
      .filter((el) => (el as HTMLInputElement).type === 'text');
    expect(tagInputs).toHaveLength(2);
  });

  it('keeps STORED criteria visible on a non-Population slot so they stay editable', () => {
    const model = readModel();
    (model.picots as Record<string, unknown>).timing = {
      description: '',
      inclusion: ['at admission'],
      exclusion: [],
    };
    vi.mocked(useAiContext).mockReturnValue({
      data: model,
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAiContext>);

    render(
      <AiConfigDialog projectId={PROJECT_ID} open onOpenChange={vi.fn()} />,
    );

    // Hidden criteria would still be emitted into the prompt — legacy data
    // must stay on screen until the manager removes it.
    expect(screen.getByText('at admission')).toBeInTheDocument();
  });

  it('refuses to save when the read failed, so blanks cannot overwrite', () => {
    vi.mocked(useAiContext).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    } as unknown as ReturnType<typeof useAiContext>);

    render(
      <AiConfigDialog projectId={PROJECT_ID} open onOpenChange={vi.fn()} />,
    );

    expect(
      screen.getByText('Could not load the review question'),
    ).toBeInTheDocument();
    // Stronger than a disabled button: the form never mounts, so there is no
    // draft of six blank slots that could be written over the stored question.
    expect(screen.queryByRole('button', {name: /Save/})).toBeNull();
  });
});

/** The trigger's shape: it owns the instruction draft so a dismissed dialog
 * cannot destroy it (see TemplateInstructionControl). */
function TemplateModeHarness({
  initialTab,
}: {
  initialTab?: 'model' | 'picots' | 'instruction';
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <AiConfigDialog
      projectId={PROJECT_ID}
      open
      onOpenChange={vi.fn()}
      initialTab={initialTab}
      withModel
      template={{
        id: TEMPLATE_ID,
        instructionDraft: draft,
        onInstructionDraftChange: setDraft,
      }}
    />
  );
}

function renderTemplateMode(initialTab?: 'model' | 'picots' | 'instruction') {
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

    // One popup for everything the AI is configured with: the model that
    // runs it, the project's question, and the template's instruction.
    expect(screen.getByRole('tab', {name: /Model/})).toBeInTheDocument();
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

describe('ReviewDetailsSection PICOTS summary', () => {
  const project = {
    review_title: null,
    condition_studied: null,
    review_rationale: null,
    search_strategy: null,
    review_context: null,
    review_type: 'predictive_model',
  } as never;

  it('shows the server preview and the filled-slot count', () => {
    render(
      <ReviewDetailsSection
        projectId={PROJECT_ID}
        project={project}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText(/1 of 6 parts filled/)).toBeInTheDocument();
  });

  it('disables editing for a non-manager', () => {
    vi.mocked(useProjectMemberRole).mockReturnValue({
      isManager: false,
    } as unknown as ReturnType<typeof useProjectMemberRole>);

    render(
      <ReviewDetailsSection
        projectId={PROJECT_ID}
        project={project}
        onChange={vi.fn()}
      />,
    );

    // The column is manager-only at the database, and the PostgREST save this
    // replaced reported SUCCESS on an RLS refusal — so the control must be
    // disabled rather than relying on the user discovering a failure.
    expect(
      screen.getByRole('button', {name: 'Edit review question'}),
    ).toBeDisabled();
  });

  it('says so when the review question is empty', () => {
    vi.mocked(useAiContext).mockReturnValue({
      data: readModel({preview: null, picots: {}}),
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAiContext>);

    render(
      <ReviewDetailsSection
        projectId={PROJECT_ID}
        project={project}
        onChange={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/The AI is given no review question/),
    ).toBeInTheDocument();
  });

  it('flags a question that is stored but switched off', () => {
    vi.mocked(useAiContext).mockReturnValue({
      data: readModel({picots_enabled: false, preview: null}),
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAiContext>);

    render(
      <ReviewDetailsSection
        projectId={PROJECT_ID}
        project={project}
        onChange={vi.fn()}
      />,
    );

    const summary = screen.getByText(/parts filled/);
    expect(within(summary).getByText(/Not being sent to the AI/)).toBeDefined();
  });
});
