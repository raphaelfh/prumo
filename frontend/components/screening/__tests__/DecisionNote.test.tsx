/**
 * DecisionNote — the reviewer's optional note on a title/abstract decision:
 * hidden behind "Add note" until asked for (or already written), capped at
 * the backend's `rationale` limit.
 */
import {render, screen} from '@testing-library/react';
import {useState} from 'react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it} from 'vitest';

import {DecisionNote, useDecisionNoteForm} from '@/components/screening/DecisionNote';

function Harness() {
  const form = useDecisionNoteForm();
  return <DecisionNote form={form} />;
}

/** The form outlives the note, as in `AssignmentView`, whose error and loading returns unmount it. */
function RemountHarness() {
  const form = useDecisionNoteForm();
  const [shown, setShown] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setShown((s) => !s)}>
        toggle
      </button>
      {shown && <DecisionNote form={form} />}
    </>
  );
}

describe('DecisionNote', () => {
  it('reveals the textarea from Add note', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByLabelText('Note (optional)')).toBeNull();
    await user.click(screen.getByRole('button', {name: 'Add note'}));
    const note = screen.getByLabelText('Note (optional)');
    expect(note).toHaveFocus();
    await user.type(note, 'Adults only');
    expect(note).toHaveValue('Adults only');
  });

  it('caps the note at 2000 characters', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', {name: 'Add note'}));
    expect(screen.getByLabelText('Note (optional)')).toHaveAttribute('maxLength', '2000');
  });

  it('reopens on a note already written when it mounts again', async () => {
    const user = userEvent.setup();
    render(<RemountHarness />);
    await user.click(screen.getByRole('button', {name: 'Add note'}));
    await user.type(screen.getByLabelText('Note (optional)'), 'Adults only');
    await user.click(screen.getByRole('button', {name: 'toggle'}));
    await user.click(screen.getByRole('button', {name: 'toggle'}));
    expect(screen.getByLabelText('Note (optional)')).toHaveValue('Adults only');
  });

  it('starts closed when it mounts again on an empty note', async () => {
    const user = userEvent.setup();
    render(<RemountHarness />);
    await user.click(screen.getByRole('button', {name: 'toggle'}));
    await user.click(screen.getByRole('button', {name: 'toggle'}));
    expect(screen.getByRole('button', {name: 'Add note'})).toBeInTheDocument();
    expect(screen.queryByLabelText('Note (optional)')).toBeNull();
  });
});
