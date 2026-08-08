import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));

import {TemplateInspector, type SaveFieldHandler} from './TemplateInspector';
import {buildTemplateTree} from './templateTree';

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

function renderInspector(
  over: Partial<Parameters<typeof TemplateInspector>[0]> = {},
) {
  const props = {
    field: selectField,
    section: null,
    owningSection: section,
    onSaveField: vi.fn() as SaveFieldHandler,
    saving: false,
    focusGroup: null,
    ...over,
  };
  const view = render(<TemplateInspector {...props} />);
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
