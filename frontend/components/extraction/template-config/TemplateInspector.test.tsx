import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));

import {TemplateInspector, type UpdateFieldMutation} from './TemplateInspector';
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
  ],
);

const section = tree[0];
const selectField = section.fields[0];
const textField = section.fields[1];

function makeMutation(over: Partial<UpdateFieldMutation> = {}): UpdateFieldMutation {
  return {
    mutate: vi.fn(),
    isPending: false,
    ...over,
  } as unknown as UpdateFieldMutation;
}

function renderInspector(
  over: Partial<Parameters<typeof TemplateInspector>[0]> = {},
) {
  const props = {
    field: selectField,
    section: null,
    owningSection: section,
    onEditField: vi.fn(),
    updateField: makeMutation(),
    ...over,
  };
  const view = render(<TemplateInspector {...props} />);
  return {props, view};
}

describe('TemplateInspector field form', () => {
  it('renders the current values as an editable draft', () => {
    renderInspector();
    expect(screen.getByLabelText('inspectorLabelLabel')).toHaveValue(
      'Study design',
    );
    expect(screen.getByRole('switch')).toBeChecked();
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

  it('saves the 5-key payload with empty strings collapsed to null', async () => {
    const user = userEvent.setup();
    const {props} = renderInspector();

    const ai = screen.getByLabelText(/inspectorAiLabel/);
    await user.clear(ai);
    await user.click(screen.getByRole('button', {name: 'inspectorSave'}));

    expect(props.updateField.mutate).toHaveBeenCalledWith(
      {
        fieldId: 'f1',
        updates: {
          label: 'Study design',
          is_required: true,
          allowed_values: ['Cohort', 'RCT'],
          llm_description: null,
          description: 'For reviewers',
        },
      },
      expect.anything(),
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

    const call = (props.updateField.mutate as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(call.updates.allowed_values).toBeNull();
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
    // The "Edit field" dialog saving while this field stays selected: same
    // id, new content. A stale draft here would silently revert the
    // dialog's edit on the next Save.
    const user = userEvent.setup();
    const {props, view} = renderInspector();
    await user.type(screen.getByLabelText('inspectorLabelLabel'), ' DRAFT');

    const renamedElsewhere = {...selectField, label: 'Renamed in dialog'};
    view.rerender(<TemplateInspector {...props} field={renamedElsewhere} />);
    expect(screen.getByLabelText('inspectorLabelLabel')).toHaveValue(
      'Renamed in dialog',
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

  it('disables the form and Save while a save is in flight', () => {
    renderInspector({updateField: makeMutation({isPending: true})});
    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.getByLabelText('inspectorLabelLabel')).toBeDisabled();
    expect(screen.getByRole('button', {name: 'inspectorSave'})).toBeDisabled();
  });

  it('blocks Save when the label is blank even if dirty', async () => {
    const user = userEvent.setup();
    renderInspector();
    await user.clear(screen.getByLabelText('inspectorLabelLabel'));
    expect(screen.getByRole('button', {name: 'inspectorSave'})).toBeDisabled();
  });

  it('keeps the Edit field escape hatch for type changes', async () => {
    const user = userEvent.setup();
    const {props} = renderInspector();
    await user.click(screen.getByRole('button', {name: /inspectorEditButton/}));
    expect(props.onEditField).toHaveBeenCalledWith(selectField);
  });
});
