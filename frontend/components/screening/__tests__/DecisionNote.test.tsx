/**
 * DecisionNote — the reviewer's optional note on a title/abstract decision:
 * hidden behind "Add note" until asked for (or already written), capped at
 * the backend's `rationale` limit.
 */
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it} from 'vitest';

import {DecisionNote, useDecisionNoteForm} from '@/components/screening/DecisionNote';

function Harness() {
  const form = useDecisionNoteForm();
  return <DecisionNote form={form} />;
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
});
