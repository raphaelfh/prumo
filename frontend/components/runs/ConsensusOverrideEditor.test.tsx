/**
 * ConsensusOverrideEditor — the typed override row content that replaces the
 * raw-JSON box. Emits the FORM-SHAPED value (or the flat "no information"
 * marker); the caller envelopes it via toConsensusValueEnvelope before POST.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/copy', () => ({ t: (_ns: string, key: string) => key }));

import { ConsensusOverrideEditor } from './ConsensusOverrideEditor';

const field = { id: 'f1', label: 'Outcome', field_type: 'text' };

describe('ConsensusOverrideEditor', () => {
  it('publish disabled on empty value, enabled after typing, emits value + empty rationale', () => {
    const onPublish = vi.fn();
    render(
      <ConsensusOverrideEditor
        coordKey="i1::f1"
        field={field}
        disabled={false}
        onCancel={() => {}}
        onPublish={onPublish}
      />,
    );
    const submit = screen.getByTestId('consensus-override-submit-i1::f1');
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Low' } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(onPublish).toHaveBeenCalledWith('Low', '');
  });

  it('rationale is optional and passed through when provided', () => {
    const onPublish = vi.fn();
    render(
      <ConsensusOverrideEditor
        coordKey="i1::f1"
        field={field}
        disabled={false}
        onCancel={() => {}}
        onPublish={onPublish}
      />,
    );
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Low' } });
    fireEvent.change(screen.getAllByRole('textbox')[1], { target: { value: 'tie-break' } });
    fireEvent.click(screen.getByTestId('consensus-override-submit-i1::f1'));
    expect(onPublish).toHaveBeenCalledWith('Low', 'tie-break');
  });

  it('"No information" toggle publishes the flat marker', () => {
    const onPublish = vi.fn();
    render(
      <ConsensusOverrideEditor
        coordKey="i1::f1"
        field={field}
        disabled={false}
        onCancel={() => {}}
        onPublish={onPublish}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /dispositionNoInformation/i }));
    const submit = screen.getByTestId('consensus-override-submit-i1::f1');
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(onPublish).toHaveBeenCalledWith(
      { value: null, absent_reason: 'no_information' },
      '',
    );
  });

  it('seeds initialValue + initialRationale (Change on a resolved override)', () => {
    render(
      <ConsensusOverrideEditor
        coordKey="i1::f1"
        field={field}
        disabled={false}
        initialValue="High"
        initialRationale="prior"
        onCancel={() => {}}
        onPublish={() => {}}
      />,
    );
    expect(screen.getAllByRole('textbox')[0]).toHaveValue('High');
    expect(screen.getAllByRole('textbox')[1]).toHaveValue('prior');
  });

  it('disabled=true disables the value input, marker toggle and submit', () => {
    render(
      <ConsensusOverrideEditor
        coordKey="i1::f1"
        field={field}
        disabled
        initialValue="High"
        onCancel={() => {}}
        onPublish={() => {}}
      />,
    );
    expect(screen.getAllByRole('textbox')[0]).toBeDisabled();
    expect(screen.getByRole('button', { name: /dispositionNoInformation/i })).toBeDisabled();
    expect(screen.getByTestId('consensus-override-submit-i1::f1')).toBeDisabled();
  });

  it('omits the "No information" button when the field opts out (ADR-0016 / 0062)', () => {
    // Must agree with FieldInput: on an opted-out field a published marker is
    // invisible AND unclearable on the form, yet still counts as filled. Both
    // controls now read the same flags off the same field object.
    render(
      <ConsensusOverrideEditor
        coordKey="i1::f1"
        field={{ ...field, allows_no_information: false }}
        disabled={false}
        onCancel={() => {}}
        onPublish={() => {}}
      />,
    );
    expect(
      screen.queryByRole('button', { name: /dispositionNoInformation/i }),
    ).not.toBeInTheDocument();
    // The typed editor and submit are untouched — only the marker is gone.
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'NI' } });
    expect(screen.getByTestId('consensus-override-submit-i1::f1')).toBeEnabled();
  });

  it('offers the opt-in Not applicable / Not evaluated chips (was unreachable)', async () => {
    // The hand-copied row only ever rendered "No information", yet
    // toConsensusValueEnvelope accepts all three codes — so a manager could not
    // publish a `not_applicable` override on a field that explicitly allows it.
    const user = userEvent.setup();
    const onPublish = vi.fn();
    render(
      <ConsensusOverrideEditor
        coordKey="i1::f1"
        field={{ ...field, allows_not_applicable: true, allows_not_evaluated: true }}
        disabled={false}
        onCancel={() => {}}
        onPublish={onPublish}
      />,
    );
    await user.click(screen.getByRole('button', { name: /dispositionNotApplicable/i }));
    fireEvent.click(screen.getByTestId('consensus-override-submit-i1::f1'));
    expect(onPublish).toHaveBeenCalledWith(
      { value: null, absent_reason: 'not_applicable' },
      '',
    );
  });

  it('Cancel fires onCancel', () => {
    const onCancel = vi.fn();
    render(
      <ConsensusOverrideEditor
        coordKey="i1::f1"
        field={field}
        disabled={false}
        onCancel={onCancel}
        onPublish={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});
