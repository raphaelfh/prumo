import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn()}}));
// The section pane's immediate-commit path (B-8 T6) goes through the
// service; the hook's cache refresh needs only a QueryClient.
vi.mock('@/services/templateService', () => ({
  updateSection: vi.fn(),
  republishTemplateVersion: vi.fn(),
}));
// Same reason, for the entry-key control (0059): useUpdateTemplateField
// reaches extractionFieldService, which imports the API client and with it
// the Supabase client. That client builds at MODULE scope and throws
// "supabaseUrl is required" without VITE_SUPABASE_URL — so an unmocked
// import fails the whole SUITE at load time in any env without a .env,
// which is exactly what CI is.
vi.mock('@/services/extractionFieldService', () => ({
  updateField: vi.fn(),
}));

import {toast} from 'sonner';

import {PgError} from '@/lib/error-utils';
import {updateSection} from '@/services/templateService';

import {TemplateInspector, type SaveFieldHandler} from './TemplateInspector';
import {
  buildTemplateTree,
  type GridSection,
  type MoveTargetSection,
} from './templateTree';

const tree = buildTemplateTree(
  [
    {
      id: 'sec',
      name: 'source_of_data',
      label: 'Source of Data',
      description: null,
      role: 'study_section',
      cardinality: 'one',
      parent_entity_type_id: null,
      sort_order: 1,
    },
  ],
  [
    {
      id: 'f1',
      entity_type_id: 'sec',
      name: 'study_design',
      label: 'Study design',
      description: 'For reviewers',
      field_type: 'select',
      is_required: true,
      allowed_values: ['Cohort', 'RCT'],
      llm_description: 'Extract the design.',
      sort_order: 1,
    },
    {
      id: 'f2',
      entity_type_id: 'sec',
      name: 'setting',
      label: 'Setting',
      description: null,
      field_type: 'text',
      is_required: false,
      allowed_values: null,
      llm_description: null,
      sort_order: 2,
    },
    {
      id: 'f3',
      entity_type_id: 'sec',
      name: 'weight',
      label: 'Weight',
      description: null,
      field_type: 'number',
      is_required: false,
      allowed_values: null,
      unit: 'kg',
      allowed_units: ['kg', 'g'],
      llm_description: null,
      sort_order: 3,
    },
    {
      id: 'f4',
      entity_type_id: 'sec',
      name: 'funding',
      label: 'Funding',
      description: null,
      field_type: 'select',
      is_required: false,
      allowed_values: ['Public', 'Private'],
      allow_other: true,
      other_label: 'Other source',
      other_placeholder: 'Type the source',
      allows_not_applicable: true,
      allows_not_evaluated: true,
      llm_description: null,
      sort_order: 4,
    },
  ],
);

const section = tree[0];
const selectField = section.fields[0];
const textField = section.fields[1];
const numberField = section.fields[2];
const otherField = section.fields[3];

/** Destination list the panel threads in — ALWAYS this template's
 * sections only (the client-side guard against the RLS move hole). */
const moveTargets: MoveTargetSection[] = [
  {id: 'sec', label: 'Source of Data', kind: 'root', fieldCount: 4},
  {id: 'grp', label: 'Models', kind: 'group', fieldCount: 0},
  {id: 'grpChild', label: 'Performance', kind: 'groupChild', fieldCount: 2},
  {id: 'sec2', label: 'Outcomes', kind: 'root', fieldCount: 1},
];

function renderInspector(
  over: Partial<Parameters<typeof TemplateInspector>[0]> = {},
) {
  const props = {
    projectId: 'p1',
    templateId: 't1',
    field: selectField,
    section: null,
    owningSection: section,
    parentGroupLabel: null,
    onSaveField: vi.fn() as SaveFieldHandler,
    saving: false,
    focusGroup: null,
    sections: moveTargets,
    onMoveField: vi.fn(),
    moveDisabled: false,
    ...over,
  };
  const view = render(<TemplateInspector {...props} />);
  return {props, view};
}

/** Group + per-model child tree for the section-pane variants (B-8 T6). */
const groupTree = buildTemplateTree(
  [
    {
      id: 'grp',
      name: 'prediction_models',
      label: 'Prediction models',
      description: null,
      role: 'model_container',
      cardinality: 'many',
      entry_label: 'algorithm',
      parent_entity_type_id: null,
      sort_order: 1,
    },
    {
      id: 'perf',
      name: 'performance',
      label: 'Performance',
      description: null,
      role: 'model_section',
      cardinality: 'one',
      parent_entity_type_id: 'grp',
      sort_order: 2,
    },
  ],
  [],
);
const groupSection = groupTree[0];
const childSection = groupSection.children[0];

/** Section-pane render: the pane owns the immediate-commit mutation, so
 * it mounts under a QueryClient (queries/mutations never retry here). */
function renderSection(
  selected: GridSection,
  over: Partial<Parameters<typeof TemplateInspector>[0]> = {},
) {
  const client = new QueryClient({
    defaultOptions: {queries: {retry: false}, mutations: {retry: false}},
  });
  const props = {
    projectId: 'p1',
    templateId: 't1',
    field: null,
    section: selected,
    owningSection: null,
    parentGroupLabel: selected.kind === 'groupChild' ? 'Prediction models' : null,
    onSaveField: vi.fn() as SaveFieldHandler,
    saving: false,
    focusGroup: null,
    sections: moveTargets,
    onMoveField: vi.fn(),
    moveDisabled: false,
    ...over,
  };
  const view = render(
    <QueryClientProvider client={client}>
      <TemplateInspector {...props} />
    </QueryClientProvider>,
  );
  return {props, view};
}

const lastUpdates = (onSaveField: SaveFieldHandler) =>
  (onSaveField as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1];

describe('TemplateInspector field form', () => {
  it('renders the current values as an editable draft', () => {
    renderInspector();
    expect(screen.getByLabelText('inspectorLabelLabel')).toHaveValue(
      'Study design',
    );
    expect(
      screen.getByRole('switch', {name: 'inspectorRequiredSwitch'}),
    ).toBeChecked();
    expect(screen.getByLabelText(/inspectorAiLabel/)).toHaveValue(
      'Extract the design.',
    );
    expect(screen.getByLabelText('inspectorDescriptionLabel')).toHaveValue(
      'For reviewers',
    );
    expect(screen.getByText('Cohort')).toBeInTheDocument();
    expect(screen.getByText('RCT')).toBeInTheDocument();
  });

  it('keeps Save disabled until the draft is dirty', async () => {
    const user = userEvent.setup();
    renderInspector();
    const save = screen.getByRole('button', {name: 'inspectorSave'});
    expect(save).toBeDisabled();

    await user.type(screen.getByLabelText('inspectorLabelLabel'), '!');
    expect(save).toBeEnabled();
  });

  it('saves the full payload with empty strings collapsed to null', async () => {
    const user = userEvent.setup();
    const {props} = renderInspector();

    const ai = screen.getByLabelText(/inspectorAiLabel/);
    await user.clear(ai);
    await user.click(screen.getByRole('button', {name: 'inspectorSave'}));

    expect(props.onSaveField).toHaveBeenCalledWith(
      expect.objectContaining({id: 'f1'}),
      {
        label: 'Study design',
        field_type: 'select',
        is_required: true,
        allowed_values: ['Cohort', 'RCT'],
        allow_other: false,
        other_label: null,
        other_placeholder: null,
        allowed_units: null,
        unit: null,
        allows_not_applicable: false,
        allows_not_evaluated: false,
        llm_description: null,
        description: 'For reviewers',
      },
      expect.any(Function),
    );
  });

  it('collapses an emptied options list to null', async () => {
    const user = userEvent.setup();
    const {props} = renderInspector();

    // Remove both chips (buttons around each option row).
    for (const option of ['Cohort', 'RCT']) {
      const row = screen.getByText(option).closest('div');
      const remove = row?.querySelector('button');
      expect(remove).toBeTruthy();
      await user.click(remove as HTMLButtonElement);
    }
    await user.click(screen.getByRole('button', {name: 'inspectorSave'}));

    expect(lastUpdates(props.onSaveField).allowed_values).toBeNull();
  });

  it('hides the options editor for non-select fields', () => {
    renderInspector({field: textField});
    expect(screen.queryByText('inspectorOptionsLabel')).not.toBeInTheDocument();
  });

  it('resets the draft when the selection changes', async () => {
    const user = userEvent.setup();
    const {props, view} = renderInspector();
    await user.type(screen.getByLabelText('inspectorLabelLabel'), ' EDITED');

    view.rerender(<TemplateInspector {...props} field={textField} />);
    expect(screen.getByLabelText('inspectorLabelLabel')).toHaveValue('Setting');

    view.rerender(<TemplateInspector {...props} field={selectField} />);
    expect(screen.getByLabelText('inspectorLabelLabel')).toHaveValue(
      'Study design',
    );
  });

  it('re-derives the draft when the same field changes underneath', async () => {
    // Another editor saving while this field stays selected: same id, new
    // content. A stale draft here would silently revert that edit on the
    // next Save.
    const user = userEvent.setup();
    const {props, view} = renderInspector();
    await user.type(screen.getByLabelText('inspectorLabelLabel'), ' DRAFT');

    const renamedElsewhere = {...selectField, label: 'Renamed elsewhere'};
    view.rerender(<TemplateInspector {...props} field={renamedElsewhere} />);
    expect(screen.getByLabelText('inspectorLabelLabel')).toHaveValue(
      'Renamed elsewhere',
    );
    expect(screen.getByRole('button', {name: 'inspectorSave'})).toBeDisabled();
  });

  it('Reset returns the draft to the baseline', async () => {
    const user = userEvent.setup();
    renderInspector();
    const label = screen.getByLabelText('inspectorLabelLabel');
    await user.type(label, ' EDITED');
    await user.click(screen.getByRole('button', {name: 'inspectorReset'}));
    expect(label).toHaveValue('Study design');
    expect(screen.getByRole('button', {name: 'inspectorSave'})).toBeDisabled();
  });

  it('moves the baseline when the save callback confirms — Save disarms', async () => {
    const user = userEvent.setup();
    const onSaveField = vi.fn(
      (_field, _updates, onSaved: () => void) => onSaved(),
    ) as SaveFieldHandler;
    renderInspector({onSaveField});

    await user.type(screen.getByLabelText('inspectorLabelLabel'), '!');
    await user.click(screen.getByRole('button', {name: 'inspectorSave'}));

    expect(screen.getByLabelText('inspectorLabelLabel')).toHaveValue(
      'Study design!',
    );
    expect(screen.getByRole('button', {name: 'inspectorSave'})).toBeDisabled();
  });

  it('disables the form and Save while a save is in flight', () => {
    renderInspector({saving: true});
    expect(
      screen.getByRole('switch', {name: 'inspectorRequiredSwitch'}),
    ).toBeDisabled();
    expect(screen.getByLabelText('inspectorLabelLabel')).toBeDisabled();
    expect(screen.getByRole('button', {name: 'inspectorSave'})).toBeDisabled();
  });

  it('blocks Save when the label is blank even if dirty', async () => {
    const user = userEvent.setup();
    renderInspector();
    await user.clear(screen.getByLabelText('inspectorLabelLabel'));
    expect(screen.getByRole('button', {name: 'inspectorSave'})).toBeDisabled();
  });
});

describe('TemplateInspector absorbed capabilities (B-5 Task 5)', () => {
  it('edits the type inline — the Edit-field escape hatch is GONE', async () => {
    // Inverts the pre-Task-5 escape-hatch test: type changes no longer
    // detour through the dialog (which Task 8 deletes).
    const user = userEvent.setup();
    const {props} = renderInspector();
    expect(
      screen.queryByRole('button', {name: /inspectorEditButton/}),
    ).toBeNull();

    const type = screen.getByLabelText('inspectorTypeLabel');
    expect(type).toHaveValue('select');
    await user.selectOptions(type, 'text');
    await user.click(screen.getByRole('button', {name: 'inspectorSave'}));

    expect(lastUpdates(props.onSaveField)).toMatchObject({
      field_type: 'text',
      allowed_values: null,
    });
  });

  it('switching the draft type to select reveals the options editor', async () => {
    const user = userEvent.setup();
    renderInspector({field: textField});
    expect(screen.queryByText('inspectorOptionsLabel')).toBeNull();
    await user.selectOptions(
      screen.getByLabelText('inspectorTypeLabel'),
      'select',
    );
    expect(screen.getByText('inspectorOptionsLabel')).toBeInTheDocument();
  });

  it('round-trips the ADR-0016 dispositions', async () => {
    const user = userEvent.setup();
    const {props} = renderInspector();

    const notApplicable = screen.getByRole('switch', {
      name: 'dispositionAllowNotApplicableLabel',
    });
    const notEvaluated = screen.getByRole('switch', {
      name: 'dispositionAllowNotEvaluatedLabel',
    });
    expect(notApplicable).not.toBeChecked();
    expect(notEvaluated).not.toBeChecked();

    await user.click(notApplicable);
    await user.click(notEvaluated);
    await user.click(screen.getByRole('button', {name: 'inspectorSave'}));

    expect(lastUpdates(props.onSaveField)).toMatchObject({
      allows_not_applicable: true,
      allows_not_evaluated: true,
    });
  });

  it('renders stored dispositions and allow-other state as checked', () => {
    renderInspector({field: otherField});
    expect(
      screen.getByRole('switch', {name: 'dispositionAllowNotApplicableLabel'}),
    ).toBeChecked();
    expect(
      screen.getByRole('switch', {name: 'dispositionAllowNotEvaluatedLabel'}),
    ).toBeChecked();
    expect(
      screen.getByRole('switch', {name: 'allowOtherSpecifyLabel'}),
    ).toBeChecked();
    expect(screen.getByLabelText('otherLabelLabel')).toHaveValue('Other source');
    expect(screen.getByLabelText('placeholderLabel')).toHaveValue(
      'Type the source',
    );
  });

  it('enables allow-other with its label and placeholder in one save', async () => {
    const user = userEvent.setup();
    const {props} = renderInspector();

    await user.click(screen.getByRole('switch', {name: 'allowOtherSpecifyLabel'}));
    await user.type(screen.getByLabelText('otherLabelLabel'), 'Other design');
    await user.type(screen.getByLabelText('placeholderLabel'), 'Describe it');
    await user.click(screen.getByRole('button', {name: 'inspectorSave'}));

    expect(lastUpdates(props.onSaveField)).toMatchObject({
      allow_other: true,
      other_label: 'Other design',
      other_placeholder: 'Describe it',
    });
  });

  it('edits units for number fields, first unit becoming the default', async () => {
    const user = userEvent.setup();
    const {props} = renderInspector({field: numberField});

    // AllowedUnitsList re-hosted from the dialog: stored units render
    // (list row + preview both show the default unit).
    expect(screen.getAllByText('kg').length).toBeGreaterThan(0);
    await user.type(
      screen.getByPlaceholderText('placeholderUnits'),
      'mg{Enter}',
    );
    await user.click(screen.getByRole('button', {name: 'inspectorSave'}));

    expect(lastUpdates(props.onSaveField)).toMatchObject({
      allowed_units: ['kg', 'g', 'mg'],
      unit: 'kg',
    });
  });

  it('hides the units editor for non-number fields', () => {
    renderInspector({field: textField});
    expect(screen.queryByText('inspectorUnitsLabel')).toBeNull();
  });

  it('shows option REORDER controls (the dialog had them; the inspector must too)', () => {
    const {view} = renderInspector();
    expect(
      view.container.querySelectorAll('[aria-roledescription="sortable"]').length,
    ).toBeGreaterThan(0);
  });

  it('deep-link to the AI group focuses the instruction editor', () => {
    renderInspector({focusGroup: {group: 'ai', seq: 1}});
    expect(document.activeElement).toBe(
      screen.getByLabelText(/inspectorAiLabel/),
    );
  });

  it('deep-link to the options group focuses the option input', () => {
    renderInspector({focusGroup: {group: 'options', seq: 1}});
    expect(document.activeElement).toBe(
      screen.getByPlaceholderText('placeholderOptions'),
    );
  });
});

describe('TemplateInspector Section combobox (B-6 T4)', () => {
  it('renders the owning section as the selected destination', () => {
    renderInspector();
    expect(screen.getByLabelText('inspectorSectionLabel')).toHaveValue('sec');
  });

  it('lists ONLY this template sections, in tree order', () => {
    renderInspector();
    const select = screen.getByLabelText(
      'inspectorSectionLabel',
    ) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      'sec',
      'grp',
      'grpChild',
      'sec2',
    ]);
  });

  it('a pick commits IMMEDIATELY: onMoveField fires with the section id', async () => {
    const user = userEvent.setup();
    const {props} = renderInspector();
    await user.selectOptions(
      screen.getByLabelText('inspectorSectionLabel'),
      'sec2',
    );
    expect(props.onMoveField).toHaveBeenCalledTimes(1);
    expect(props.onMoveField).toHaveBeenCalledWith(
      expect.objectContaining({id: 'f1'}),
      'sec2',
    );
  });

  it('is disabled on pending rows (no server id to move yet)', () => {
    renderInspector({moveDisabled: true});
    expect(screen.getByLabelText('inspectorSectionLabel')).toBeDisabled();
  });
});

describe('TemplateInspector section pane — group (B-8 T6, D10)', () => {
  beforeEach(() => {
    vi.mocked(updateSection).mockReset();
    vi.mocked(updateSection).mockResolvedValue({ok: true, data: {} as never});
    vi.mocked(toast.error).mockClear();
  });

  it('shows the kind line and the LOCKED Repeats row (no cardinality select)', () => {
    renderSection(groupSection);
    expect(screen.getByText('inspectorGroupKindLine')).toBeInTheDocument();
    expect(screen.getByText('inspectorGroupAlwaysRepeats')).toBeInTheDocument();
    // A group's cardinality is fixed, so it gets the read-only row rather
    // than the groupChild's select. Asserted by id: since 0059 the pane
    // also renders the entry-key select, and a bare `queryByRole
    // ('combobox')` would catch that unrelated control too.
    expect(document.getElementById('inspector-section-repeats')).toBeNull();
  });

  it('entry-label input commits IMMEDIATELY on blur via updateSection', async () => {
    const user = userEvent.setup();
    renderSection(groupSection);
    const input = screen.getByLabelText('entryLabelLabel');
    expect(input).toHaveValue('algorithm');

    await user.clear(input);
    await user.type(input, ' scenario ');
    await user.tab();

    await waitFor(() =>
      expect(updateSection).toHaveBeenCalledWith('p1', 't1', 'grp', {
        entry_label: 'scenario',
      }),
    );
    expect(updateSection).toHaveBeenCalledTimes(1);
  });

  it('Enter commits once (blur path), not twice', async () => {
    const user = userEvent.setup();
    renderSection(groupSection);
    const input = screen.getByLabelText('entryLabelLabel');
    await user.clear(input);
    await user.type(input, 'scenario{Enter}');
    await user.tab();

    await waitFor(() => expect(updateSection).toHaveBeenCalledTimes(1));
  });

  it('an unchanged value is a no-op — no call', async () => {
    const user = userEvent.setup();
    renderSection(groupSection);
    await user.click(screen.getByLabelText('entryLabelLabel'));
    await user.tab();
    expect(updateSection).not.toHaveBeenCalled();
  });

  it('an emptied value reverts the display and does not call', async () => {
    const user = userEvent.setup();
    renderSection(groupSection);
    const input = screen.getByLabelText('entryLabelLabel');
    await user.clear(input);
    await user.tab();

    expect(updateSection).not.toHaveBeenCalled();
    expect(input).toHaveValue('algorithm');
  });

  it('a failed commit reverts the display', async () => {
    vi.mocked(updateSection).mockResolvedValue({
      ok: false,
      error: new PgError('boom', '500'),
    });
    const user = userEvent.setup();
    renderSection(groupSection);
    const input = screen.getByLabelText('entryLabelLabel');
    await user.clear(input);
    await user.type(input, 'scenario');
    await user.tab();

    await waitFor(() => expect(input).toHaveValue('algorithm'));
  });

  it('commit then immediate revert PATCHes BOTH (own-save baseline, not the stale prop)', async () => {
    // Between a successful commit and the refetch-driven remount the
    // `section` prop still carries the OLD noun — a revert edit must
    // compare against the last COMMITTED value, or it silently sends
    // nothing and snaps back (B-8 review finding 3).
    const user = userEvent.setup();
    renderSection(groupSection);
    const input = screen.getByLabelText('entryLabelLabel');
    await user.clear(input);
    await user.type(input, 'scenario');
    await user.tab();
    await waitFor(() =>
      expect(updateSection).toHaveBeenCalledWith('p1', 't1', 'grp', {
        entry_label: 'scenario',
      }),
    );

    await user.click(input);
    await user.clear(input);
    await user.type(input, 'algorithm');
    await user.tab();

    await waitFor(() =>
      expect(updateSection).toHaveBeenCalledWith('p1', 't1', 'grp', {
        entry_label: 'algorithm',
      }),
    );
    expect(updateSection).toHaveBeenCalledTimes(2);
  });
});

describe('TemplateInspector section pane — per-model section (B-8 T6, D10)', () => {
  beforeEach(() => {
    vi.mocked(updateSection).mockReset();
    vi.mocked(updateSection).mockResolvedValue({ok: true, data: {} as never});
    vi.mocked(toast.error).mockClear();
  });

  it('shows the locked placement line inside the parent group', () => {
    renderSection(childSection);
    expect(screen.getByText('inspectorInsideGroup')).toBeInTheDocument();
  });

  it('Repeats select commits cardinality IMMEDIATELY', async () => {
    const user = userEvent.setup();
    renderSection(childSection);
    const select = screen.getByLabelText('inspectorRepeatsLabel');
    expect(select).toHaveValue('one');

    await user.selectOptions(select, 'many');

    await waitFor(() =>
      expect(updateSection).toHaveBeenCalledWith('p1', 't1', 'perf', {
        cardinality: 'many',
      }),
    );
  });

  it('the D5 many→one 409 surfaces the friendly copy and reverts the select', async () => {
    vi.mocked(updateSection).mockResolvedValue({
      ok: false,
      error: new PgError('templateConfig.errors_cardinalityInUse', '23503'),
    });
    const user = userEvent.setup();
    renderSection(childSection);
    const select = screen.getByLabelText('inspectorRepeatsLabel');

    await user.selectOptions(select, 'many');

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'templateConfig.errors_cardinalityInUse',
      ),
    );
    expect(select).toHaveValue('one');
  });

  it('has no entry-label input while it does not repeat (the noun names entries)', () => {
    renderSection(childSection);
    expect(screen.queryByLabelText('entryLabelLabel')).toBeNull();
  });

  it('commit then immediate revert PATCHes BOTH (own-save baseline, not the stale prop)', async () => {
    // After a successful many-commit the prop still says 'one' until
    // the refetch remounts the pane; picking 'one' again must PATCH —
    // the stale-prop guard used to swallow it and snap the select back
    // (B-8 review finding 3).
    const user = userEvent.setup();
    renderSection(childSection);
    const select = screen.getByLabelText('inspectorRepeatsLabel');

    await user.selectOptions(select, 'many');
    await waitFor(() =>
      expect(updateSection).toHaveBeenCalledWith('p1', 't1', 'perf', {
        cardinality: 'many',
      }),
    );

    await user.selectOptions(select, 'one');

    await waitFor(() =>
      expect(updateSection).toHaveBeenCalledWith('p1', 't1', 'perf', {
        cardinality: 'one',
      }),
    );
    expect(updateSection).toHaveBeenCalledTimes(2);
    expect(select).toHaveValue('one');
  });
});

describe('TemplateInspector section pane — root section (B-8 T6, D10)', () => {
  it('Repeats line is READ-ONLY: one per article', () => {
    renderSection(section);
    expect(screen.getByText('repeatsOncePerArticle')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByLabelText('entryLabelLabel')).toBeNull();
  });

  it('Repeats line is READ-ONLY: repeats per article', () => {
    const manyTree = buildTemplateTree(
      [
        {
          id: 'authors',
          name: 'authors',
          label: 'Authors',
          description: null,
          role: 'study_section',
          cardinality: 'many',
          parent_entity_type_id: null,
          sort_order: 1,
        },
      ],
      [],
    );
    renderSection(manyTree[0]);
    expect(screen.getByText('repeatsPerArticle')).toBeInTheDocument();
  });
});
