/**
 * `ReviewQuestionSection` — the review question (PICOTS) as an inline
 * settings section.
 *
 * `ReviewDetailsSection` had no test at all while it owned this editing surface,
 * which is how two defects survived in it: array criteria written to a dotted
 * key that never existed (so every add replaced the list), and a save routed
 * through a batched PostgREST PATCH whose RLS refusal returns no error. Both are
 * pinned here so neither can come back quietly.
 */
import {render, screen} from '@testing-library/react';
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
import {ReviewQuestionSection} from '@/components/project/settings/ReviewQuestionSection';

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
const onDirtyChange = vi.fn();

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

describe('ReviewQuestionSection — review question (no template)', () => {
  it('labels the slots with the wording the server says the prompt emits', () => {
    render(<ReviewQuestionSection projectId={PROJECT_ID} onDirtyChange={onDirtyChange} />);

    // Instrument wording, not a frontend copy of it: PROBAST+AI phrases its
    // applicability items against "index model(s)".
    expect(screen.getByText('Index model(s)')).toBeInTheDocument();
    expect(screen.getByText('Comparator model(s)')).toBeInTheDocument();
  });

  it('renders the server preview verbatim rather than re-deriving it', async () => {
    const user = userEvent.setup();
    render(<ReviewQuestionSection projectId={PROJECT_ID} onDirtyChange={onDirtyChange} />);

    // Collapsed by default — it sits at the top of the pane where it is
    // discoverable, and costs no height until asked for.
    expect(document.querySelector('pre')).toBeNull();
    await user.click(screen.getByRole('button', {name: /What the AI is sent/}));

    const pre = document.querySelector('pre');
    expect(pre?.textContent).toBe('- Population: Adults\n  Include: NYHA II-IV');
  });

  it('saves through the typed PUT, carrying the loaded slots', async () => {
    const user = userEvent.setup();
    render(<ReviewQuestionSection projectId={PROJECT_ID} onDirtyChange={onDirtyChange} />);

    // The footer only renders while dirty.
    await user.type(screen.getByLabelText('Population'), '!');
    await user.click(screen.getByRole('button', {name: 'Save'}));

    expect(mutate).toHaveBeenCalledTimes(1);
    const body = mutate.mock.calls[0][0];
    expect(body.picots.population.description).toBe('Adults!');
    expect(body.picots_enabled).toBe(true);
  });

  it('APPENDS a criterion instead of replacing the list', async () => {
    const user = userEvent.setup();
    render(<ReviewQuestionSection projectId={PROJECT_ID} onDirtyChange={onDirtyChange} />);

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
    render(<ReviewQuestionSection projectId={PROJECT_ID} onDirtyChange={onDirtyChange} />);

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

    render(<ReviewQuestionSection projectId={PROJECT_ID} onDirtyChange={onDirtyChange} />);

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

    render(<ReviewQuestionSection projectId={PROJECT_ID} onDirtyChange={onDirtyChange} />);

    expect(
      screen.getByText('Could not load the review question'),
    ).toBeInTheDocument();
    // Stronger than a disabled button: the form never mounts, so there is no
    // draft of six blank slots that could be written over the stored question.
    expect(screen.queryByRole('button', {name: /Save/})).toBeNull();
  });

  it('shows skeleton rows while loading, not "Saving…" or a Population field', () => {
    vi.mocked(useAiContext).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    } as unknown as ReturnType<typeof useAiContext>);

    render(<ReviewQuestionSection projectId={PROJECT_ID} onDirtyChange={onDirtyChange} />);

    expect(screen.queryByText('Saving…')).toBeNull();
    expect(screen.queryByLabelText('Population')).toBeNull();
  });
});

describe('ReviewQuestionSection footer', () => {
  it('shows no Save until the form differs from the server read', async () => {
    const user = userEvent.setup();
    render(<ReviewQuestionSection projectId={PROJECT_ID} onDirtyChange={onDirtyChange} />);

    expect(screen.queryByRole('button', {name: 'Save'})).toBeNull();
    await user.type(screen.getByLabelText('Population'), ' with HF');
    expect(screen.getByRole('button', {name: 'Save'})).toBeInTheDocument();
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });

  it('Cancel restores the server read and hides the footer', async () => {
    const user = userEvent.setup();
    render(<ReviewQuestionSection projectId={PROJECT_ID} onDirtyChange={onDirtyChange} />);

    await user.type(screen.getByLabelText('Population'), ' with HF');
    await user.click(screen.getByRole('button', {name: 'Cancel'}));

    expect(screen.getByLabelText('Population')).toHaveValue('Adults');
    expect(screen.queryByRole('button', {name: 'Save'})).toBeNull();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it('a successful save clears dirty', async () => {
    const user = userEvent.setup();
    mutate.mockImplementation((_body, opts) => opts?.onSuccess?.());
    render(<ReviewQuestionSection projectId={PROJECT_ID} onDirtyChange={onDirtyChange} />);

    await user.type(screen.getByLabelText('Population'), ' with HF');
    await user.click(screen.getByRole('button', {name: 'Save'}));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it('a non-manager sees the preview and the reason, never the form', () => {
    vi.mocked(useProjectMemberRole).mockReturnValue({
      isManager: false,
    } as unknown as ReturnType<typeof useProjectMemberRole>);
    render(<ReviewQuestionSection projectId={PROJECT_ID} onDirtyChange={onDirtyChange} />);

    expect(screen.getByText('Only project managers can change the review question.')).toBeInTheDocument();
    expect(document.querySelector('pre')?.textContent).toBe('- Population: Adults\n  Include: NYHA II-IV');
    expect(screen.queryByLabelText('Population')).toBeNull();
  });

  it('a non-manager sees the load-error line, not the empty-preview text, when the read failed', () => {
    vi.mocked(useProjectMemberRole).mockReturnValue({
      isManager: false,
    } as unknown as ReturnType<typeof useProjectMemberRole>);
    vi.mocked(useAiContext).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    } as unknown as ReturnType<typeof useAiContext>);

    render(<ReviewQuestionSection projectId={PROJECT_ID} onDirtyChange={onDirtyChange} />);

    expect(screen.getByText('Could not load the review question')).toBeInTheDocument();
    expect(screen.queryByText('Nothing yet. Fill in at least one part above.')).toBeNull();
  });
});

describe('ReviewQuestionSection — flat layout (spec 2026-09-13 §4.3, §10)', () => {
  const INTRO = 'What this review is asking. Sent to the AI with every extraction and quality assessment.';
  const groupOf = (el: Element | null) => el?.closest('.border-t') as HTMLElement | null;

  it('renders the intro line in place of the section heading', () => {
    render(<ReviewQuestionSection projectId={PROJECT_ID} onDirtyChange={onDirtyChange} />);
    expect(screen.getByText(INTRO)).toBeInTheDocument();
    expect(screen.queryByRole('heading', {name: 'Review question'})).toBeNull();
  });

  it('has no separator between the groups or inside a slot', () => {
    const {container} = render(<ReviewQuestionSection projectId={PROJECT_ID} onDirtyChange={onDirtyChange} />);
    expect(screen.queryByRole('separator')).toBeNull();
    // ui/separator is decorative (role="none"), so the role query alone is vacuous;
    // Radix Separator always stamps data-orientation.
    expect(container.querySelector('[data-orientation]')).toBeNull();
  });

  it("the switch is a row whose hint reaches it; the timing slot's help is the row ⓘ", () => {
    render(<ReviewQuestionSection projectId={PROJECT_ID} onDirtyChange={onDirtyChange} />);
    expect(screen.getByRole('switch', {name: 'Send to the AI'})).toHaveAccessibleDescription(
      'Turn off to withhold the review question from AI calls without deleting it.',
    );
    expect(screen.getByRole('button', {name: 'About Timing'})).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Help'})).toBeNull();
    expect(screen.getByLabelText('Timing')).toHaveAccessibleDescription(
      'Covers both the prediction moment (T0) and the prediction horizon.',
    );
  });

  it('labels the criteria inputs and names their add controls from the row label', () => {
    render(<ReviewQuestionSection projectId={PROJECT_ID} onDirtyChange={onDirtyChange} />);
    // TagInput's draft Input sets no type attribute (Task 3); the property defaults to text.
    expect((screen.getByLabelText('Inclusion criteria') as HTMLInputElement).type).toBe('text');
    expect(screen.getByRole('button', {name: 'Add to Inclusion criteria'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Add to Exclusion criteria'})).toBeInTheDocument();
  });

  it('the preview drops its border and keeps its muted fill', async () => {
    const user = userEvent.setup();
    render(<ReviewQuestionSection projectId={PROJECT_ID} onDirtyChange={onDirtyChange} />);
    await user.click(screen.getByRole('button', {name: /What the AI is sent/}));
    const pre = document.querySelector('pre');
    expect(pre).not.toHaveClass('border');
    expect(pre).toHaveClass('bg-muted/40');
  });

  it('the sticky footer Cancel is ghost', async () => {
    const user = userEvent.setup();
    render(<ReviewQuestionSection projectId={PROJECT_ID} onDirtyChange={onDirtyChange} />);
    await user.type(screen.getByLabelText('Population'), '!');
    const cancel = screen.getByRole('button', {name: 'Cancel'});
    expect(cancel).not.toHaveClass('border');
    expect(cancel).not.toHaveClass('border-input');
  });

  it('loading and error render inside the first group', () => {
    vi.mocked(useAiContext).mockReturnValue({data: undefined, isLoading: true, isError: false} as unknown as ReturnType<typeof useAiContext>);
    const {unmount} = render(<ReviewQuestionSection projectId={PROJECT_ID} onDirtyChange={onDirtyChange} />);
    expect(groupOf(document.querySelector('.animate-pulse'))).not.toBeNull();
    unmount();

    vi.mocked(useAiContext).mockReturnValue({data: undefined, isLoading: false, isError: true} as unknown as ReturnType<typeof useAiContext>);
    render(<ReviewQuestionSection projectId={PROJECT_ID} onDirtyChange={onDirtyChange} />);
    expect(groupOf(screen.getByText('Could not load the review question'))).not.toBeNull();
  });

  it.each([
    ['loading', {data: undefined, isLoading: true, isError: false}],
    ['error', {data: undefined, isLoading: false, isError: true}],
    ['empty', {data: readModel({preview: null}), isLoading: false, isError: false}],
  ])('a non-manager sees the preview %s state inside the managerOnly group', (state, read) => {
    vi.mocked(useProjectMemberRole).mockReturnValue({isManager: false} as unknown as ReturnType<typeof useProjectMemberRole>);
    vi.mocked(useAiContext).mockReturnValue(read as unknown as ReturnType<typeof useAiContext>);
    render(<ReviewQuestionSection projectId={PROJECT_ID} onDirtyChange={onDirtyChange} />);

    const group = groupOf(screen.getByText('Only project managers can change the review question.'));
    expect(group).not.toBeNull();
    const stateEl =
      state === 'loading'
        ? group!.querySelector('.animate-pulse')
        : state === 'error'
          ? screen.getByText('Could not load the review question')
          : screen.getByText('Nothing yet. Fill in at least one part above.');
    expect(stateEl).not.toBeNull();
    expect(group!.contains(stateEl)).toBe(true);
  });
});
