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
});
