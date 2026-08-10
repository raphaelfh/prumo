/**
 * AddSectionDialog — the three create variants (B-8 D3).
 *
 * ONE dialog, mode-driven: root keeps the B-7 study-section form
 * (cardinality select and all); group mode asks Label + Entry label and
 * hard-codes role model_container / cardinality many (the server enforces
 * the same, 422 — the form just never offers the impossible); per-model
 * mode presets the invoking group as parent and keeps the cardinality
 * select with per-{noun} wording. Copy is deliberately NOT mocked.
 */
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/services/templateService', () => ({createSection: vi.fn()}));
vi.mock('sonner', () => ({toast: {error: vi.fn(), success: vi.fn()}}));

import {createSection} from '@/services/templateService';

import {AddSectionDialog, type AddSectionMode} from './AddSectionDialog';

function renderDialog(mode: AddSectionMode) {
  const onOpenChange = vi.fn();
  const onSectionAdded = vi.fn();
  render(
    <AddSectionDialog
      projectId="p1"
      templateId="t1"
      open
      mode={mode}
      onOpenChange={onOpenChange}
      onSectionAdded={onSectionAdded}
    />,
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
});

describe('AddSectionDialog — group mode (Add repeating group…)', () => {
  it('asks Label + Entry label, no cardinality select, and posts a many-container', async () => {
    renderDialog({kind: 'group'});
    expect(screen.getByText('Add repeating group')).toBeInTheDocument();
    // NO cardinality choice — a group ALWAYS repeats (D3).
    expect(screen.queryByText('Section type *')).toBeNull();
    expect(screen.queryByText('Required section')).toBeNull();
    const entryLabel = screen.getByPlaceholderText('model');
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

  it('omits a BLANK entry label so the server defaults the noun', async () => {
    renderDialog({kind: 'group'});
    await userEvent.type(labelInput(), 'Models compared');
    await submit();
    await waitFor(() => expect(createSection).toHaveBeenCalledTimes(1));
    expect(createSection).toHaveBeenCalledWith(
      expect.objectContaining({role: 'model_container', entryLabel: undefined}),
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
