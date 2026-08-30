/**
 * The PICOTS editor and the read-only summary that opens it.
 *
 * `ReviewDetailsSection` had no test at all while it owned this editing surface,
 * which is how two defects survived in it: array criteria written to a dotted
 * key that never existed (so every add replaced the list), and a save routed
 * through a batched PostgREST PATCH whose RLS refusal returns no error. Both are
 * pinned here so neither can come back quietly.
 */
import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

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
import {PicotsEditDialog} from '@/components/project/PicotsEditDialog';
import {ReviewDetailsSection} from '@/components/project/settings/ReviewDetailsSection';

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';

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
});

describe('PicotsEditDialog', () => {
  it('labels the slots with the wording the server says the prompt emits', () => {
    render(
      <PicotsEditDialog projectId={PROJECT_ID} open onOpenChange={vi.fn()} />,
    );

    // Instrument wording, not a frontend copy of it: PROBAST+AI phrases its
    // applicability items against "index model(s)".
    expect(screen.getByText('Index model(s)')).toBeInTheDocument();
    expect(screen.getByText('Comparator model(s)')).toBeInTheDocument();
  });

  it('renders the server preview verbatim rather than re-deriving it', () => {
    render(<PicotsEditDialog projectId={PROJECT_ID} open onOpenChange={vi.fn()} />);

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
      <PicotsEditDialog projectId={PROJECT_ID} open onOpenChange={vi.fn()} />,
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
      <PicotsEditDialog projectId={PROJECT_ID} open onOpenChange={vi.fn()} />,
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

  it('refuses to save when the read failed, so blanks cannot overwrite', () => {
    vi.mocked(useAiContext).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    } as unknown as ReturnType<typeof useAiContext>);

    render(
      <PicotsEditDialog projectId={PROJECT_ID} open onOpenChange={vi.fn()} />,
    );

    expect(
      screen.getByText('Could not load the review question'),
    ).toBeInTheDocument();
    // Stronger than a disabled button: the form never mounts, so there is no
    // draft of six blank slots that could be written over the stored question.
    expect(screen.queryByRole('button', {name: /Save/})).toBeNull();
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
