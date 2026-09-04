/**
 * AddSectionDialog — the three create variants (B-8 D3).
 *
 * ONE dialog, mode-driven: root keeps the B-7 study-section form
 * (cardinality select and all); group mode asks Label + Entry label +
 * Description and hard-codes role model_container / cardinality many (the
 * server enforces the same, 422 — the form just never offers the
 * impossible); per-model mode presets the invoking group as parent and
 * keeps the cardinality select with per-{noun} wording. Copy is
 * deliberately NOT mocked.
 */
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/services/templateService', () => ({createSection: vi.fn()}));
vi.mock('sonner', () => ({toast: {error: vi.fn(), success: vi.fn()}}));

import {createSection} from '@/services/templateService';

import {TooltipProvider} from '@/components/ui/tooltip';

import {AddSectionDialog, type AddSectionMode} from './AddSectionDialog';

// Radix Select drives its listbox through pointer-capture APIs jsdom does not
// implement; without these the cardinality trigger never opens. Scoped to
// this file — the assertions under test are the form rules, not the polyfill.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

function renderDialog(mode: AddSectionMode) {
  const onOpenChange = vi.fn();
  const onSectionAdded = vi.fn();
  // TooltipProvider mirrors the app-level provider in App.tsx — the
  // auto-name switch carries its description in a Tooltip. delayDuration 0
  // skips Radix's 700ms hover delay, which otherwise dominates the runtime
  // and leaves almost no headroom under findBy*'s 1s timeout.
  render(
    <TooltipProvider delayDuration={0}>
      <AddSectionDialog
        projectId="p1"
        templateId="t1"
        open
        mode={mode}
        onOpenChange={onOpenChange}
        onSectionAdded={onSectionAdded}
      />
    </TooltipProvider>,
  );
  return {onOpenChange, onSectionAdded};
}

const labelInput = () => screen.getByPlaceholderText('Section label');
const submit = () => userEvent.click(screen.getByRole('button', {name: /Create section/}));

beforeEach(() => {
  vi.clearAllMocks();
  // createSection returns the created row since B-9d part 2 (the undo
  // replay needs its id). This dialog ignores it, but the type is real.
  vi.mocked(createSection).mockResolvedValue({
    ok: true,
    data: {
      id: 'sec-new',
      name: 'outcomes',
      label: 'Outcomes',
      role: 'study_section',
      cardinality: 'one',
      is_required: false,
      project_template_id: 't1',
      created_at: '2026-01-01T00:00:00Z',
      sort_order: 0,
    },
  });
});

describe('AddSectionDialog — root mode (unchanged B-7 contract)', () => {
  it('keeps the cardinality select and posts role study_section', async () => {
    const {onSectionAdded} = renderDialog({kind: 'root'});
    expect(screen.getByText('Section type *')).toBeInTheDocument();
    expect(screen.queryByText('Entry label')).toBeNull();
    await userEvent.type(labelInput(), 'Study basics');
    await submit();
    await waitFor(() => expect(createSection).toHaveBeenCalledTimes(1));
    expect(createSection).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'p1',
        templateId: 't1',
        name: 'study_basics',
        label: 'Study basics',
        role: 'study_section',
        cardinality: 'one',
        parentEntityTypeId: null,
      }),
    );
    expect(onSectionAdded).toHaveBeenCalledTimes(1);
  });

  it('asks for the entry label once the section repeats, requires it, and posts it', async () => {
    const user = userEvent.setup();
    renderDialog({kind: 'root'});
    expect(screen.queryByText('Entry label')).toBeNull();
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', {name: /Multiple sections/}));
    const entryLabel = await screen.findByPlaceholderText('entry');
    await user.type(labelInput(), 'Study arms');
    await submit();
    expect(
      await screen.findByText('Entry label is required for a repeating section'),
    ).toBeInTheDocument();
    expect(createSection).not.toHaveBeenCalled();
    await user.type(entryLabel, ' arm ');
    await submit();
    await waitFor(() => expect(createSection).toHaveBeenCalledTimes(1));
    expect(createSection).toHaveBeenCalledWith(
      expect.objectContaining({role: 'study_section', cardinality: 'many', entryLabel: 'arm'}),
    );
  });

  it('renders the technical-name hints through copy', () => {
    renderDialog({kind: 'root'});
    expect(screen.getByText('Technical name *')).toBeInTheDocument();
    expect(screen.getByText(/Unique internal name \(snake_case\)\./)).toBeInTheDocument();
    expect(screen.getByText(/Auto-generated\./)).toBeInTheDocument();
  });
});

describe('AddSectionDialog — group mode (Add repeating group…)', () => {
  it('asks Label + Entry label, no cardinality select, and posts a many-container', async () => {
    renderDialog({kind: 'group'});
    expect(screen.getByText('Add repeating group')).toBeInTheDocument();
    // NO cardinality choice — a group ALWAYS repeats (D3).
    expect(screen.queryByText('Section type *')).toBeNull();
    expect(screen.queryByText('Required section')).toBeNull();
    const entryLabel = screen.getByPlaceholderText('entry');
    await userEvent.type(labelInput(), 'Models compared');
    await userEvent.type(entryLabel, 'algorithm');
    await submit();
    await waitFor(() => expect(createSection).toHaveBeenCalledTimes(1));
    expect(createSection).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'models_compared',
        label: 'Models compared',
        role: 'model_container',
        cardinality: 'many',
        entryLabel: 'algorithm',
        parentEntityTypeId: null,
        isRequired: false,
      }),
    );
  });

  it('refuses a blank entry label — there is no server default to fall back to', async () => {
    renderDialog({kind: 'group'});
    await userEvent.type(labelInput(), 'Models compared');
    await submit();
    expect(
      await screen.findByText('Entry label is required for a repeating section'),
    ).toBeInTheDocument();
    expect(createSection).not.toHaveBeenCalled();
  });

  it('offers the description and posts it — the identifier has to be told something', async () => {
    // The group form used to drop the description, so a UI-created group
    // reached the AI with no identification instruction at all.
    renderDialog({kind: 'group'});
    await userEvent.type(labelInput(), 'Models compared');
    await userEvent.type(screen.getByPlaceholderText('entry'), 'model');
    await userEvent.type(
      screen.getByPlaceholderText('Section description'),
      '  One entry per model the paper reports.  ',
    );
    await submit();
    await waitFor(() => expect(createSection).toHaveBeenCalledTimes(1));
    expect(createSection).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'model_container',
        entryLabel: 'model',
        description: 'One entry per model the paper reports.',
      }),
    );
  });
});

describe('AddSectionDialog — per-model mode (New per-{noun} section)', () => {
  const mode: AddSectionMode = {
    kind: 'perModel',
    parentId: 'grp',
    parentLabel: 'Prediction models',
    entryNoun: 'algorithm',
  };

  it('presets the invoking group as parent and posts role model_section', async () => {
    renderDialog(mode);
    expect(screen.getByText('New per-algorithm section')).toBeInTheDocument();
    await userEvent.type(labelInput(), 'Calibration');
    await submit();
    await waitFor(() => expect(createSection).toHaveBeenCalledTimes(1));
    expect(createSection).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'calibration',
        label: 'Calibration',
        role: 'model_section',
        parentEntityTypeId: 'grp',
        cardinality: 'one',
        entryLabel: undefined,
      }),
    );
  });

  it('keeps the cardinality select, worded per-{noun} (Once / Repeats)', () => {
    renderDialog(mode);
    expect(screen.getByText('Section type *')).toBeInTheDocument();
    // The default (cardinality 'one') renders in the closed trigger.
    expect(screen.getByRole('combobox')).toHaveTextContent('Once per algorithm');
    expect(screen.queryByText('Entry label')).toBeNull();
  });
});

describe('AddSectionDialog — inline validation feedback', () => {
  // These messages regressed silently under babel-plugin-react-compiler: the
  // submit was blocked correctly but nothing rendered. Root cause and the
  // shared-primitive guard live in components/ui/form.validation.test.tsx.
  // Every <FormMessage/> here is bare, so the message text can only have come
  // from the shared useFormField.
  it('shows the label-required message on an empty submit', async () => {
    renderDialog({kind: 'root'});
    await submit();

    expect(await screen.findByText('Label is required')).toBeInTheDocument();
    expect(labelInput()).toHaveAttribute('aria-invalid', 'true');
    expect(createSection).not.toHaveBeenCalled();
  });

  it('shows the label min-length message on a one-character label', async () => {
    renderDialog({kind: 'root'});
    await userEvent.type(labelInput(), 'a');
    await submit();

    expect(await screen.findByText('Label must be at least 2 characters')).toBeInTheDocument();
    expect(labelInput()).toHaveAttribute('aria-invalid', 'true');
    expect(createSection).not.toHaveBeenCalled();
  });

  it('shows the name-format message when the technical name breaks the regex', async () => {
    renderDialog({kind: 'root'});
    await userEvent.type(labelInput(), 'Study design');
    // Auto-generation owns the name field until the switch is turned off.
    await userEvent.click(screen.getByRole('switch', {name: 'Auto-generate the technical name'}));
    const nameInput = screen.getByPlaceholderText('e.g. exclusion_criteria');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, '9 bad name');
    await submit();

    expect(await screen.findByText('Invalid name format')).toBeInTheDocument();
    expect(nameInput).toHaveAttribute('aria-invalid', 'true');
    expect(createSection).not.toHaveBeenCalled();
  });

  it('clears the message and creates once the label is valid', async () => {
    renderDialog({kind: 'root'});
    await userEvent.type(labelInput(), 'a');
    await submit();
    expect(await screen.findByText('Label must be at least 2 characters')).toBeInTheDocument();

    await userEvent.type(labelInput(), 'bc');

    await waitFor(() =>
      expect(screen.queryByText('Label must be at least 2 characters')).toBeNull(),
    );
    expect(labelInput()).toHaveAttribute('aria-invalid', 'false');

    await submit();

    // The payload contract is covered exhaustively by the mode suites above;
    // here the only question is whether the form is unblocked.
    await waitFor(() => expect(createSection).toHaveBeenCalled());
  });
});

describe('AddSectionDialog — switch accessibility', () => {
  it('names the auto-name switch so it is distinguishable from is_required', async () => {
    renderDialog({kind: 'root'});

    // Both getByRole calls throw on multiple matches, so resolving each by
    // name is itself the proof that the two switches are distinguishable.
    expect(
      screen.getByRole('switch', {name: 'Auto-generate the technical name'}),
    ).toBeInTheDocument();
    expect(screen.getByRole('switch', {name: 'Required section'})).toBeInTheDocument();
  });

  it('reveals the auto-name description on hover', async () => {
    renderDialog({kind: 'root'});

    await userEvent.hover(
      screen.getByRole('switch', {name: 'Auto-generate the technical name'}),
    );

    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Derive the technical name from the label. Turn off to type it yourself.',
    );
  });
});
