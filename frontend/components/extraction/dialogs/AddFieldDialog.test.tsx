/**
 * AddFieldDialog — ADR-0016 opt-in disposition toggles.
 *
 * "No information" is universal (no builder toggle); the template builder exposes
 * per-field Not applicable / Not evaluated switches, and the submitted payload
 * carries the flags so the Supabase-direct field write persists them.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/copy', () => ({ t: (_ns: string, key: string) => key }));

import { AddFieldDialog } from './AddFieldDialog';
import { ExtractionFieldSchema } from '@/types/extraction';

function renderDialog(onSave = vi.fn(async () => null)) {
  render(
    <AddFieldDialog open onOpenChange={vi.fn()} onSave={onSave} sectionName="Participants" />,
  );
  return onSave;
}

describe('AddFieldDialog disposition toggles', () => {
  it('renders the two opt-in toggles + the universal-no-info hint', () => {
    renderDialog();
    expect(screen.getByText('dispositionBuilderHint')).toBeInTheDocument();
    expect(screen.getByText('dispositionAllowNotApplicableLabel')).toBeInTheDocument();
    expect(screen.getByText('dispositionAllowNotEvaluatedLabel')).toBeInTheDocument();
  });

  it('submits allows_not_applicable=true when the toggle is on', async () => {
    const user = userEvent.setup();
    const onSave = renderDialog();

    await user.type(screen.getAllByRole('textbox')[0], 'Sample size');
    // Switch order for a text field: [is_required, not_applicable, not_evaluated].
    const switches = screen.getAllByRole('switch');
    await user.click(switches[1]);
    await user.click(screen.getByRole('button', { name: 'addFieldButtonLabel' }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const payload = onSave.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.allows_not_applicable).toBe(true);
    expect(payload.allows_not_evaluated).toBe(false);
  });
});

describe('ExtractionFieldSchema — disposition flags', () => {
  it('flags are optional (mirroring allow_other) and round-trip when set', () => {
    // Optional like allow_other → undefined when omitted; the dialogs always set
    // an explicit boolean, and the DB column server_default false backfills.
    const base = ExtractionFieldSchema.parse({ name: 'field_a', label: 'X', field_type: 'text' });
    expect(base.allows_not_applicable).toBeUndefined();
    expect(base.allows_not_evaluated).toBeUndefined();

    const enabled = ExtractionFieldSchema.parse({
      name: 'field_a',
      label: 'X',
      field_type: 'text',
      allows_not_evaluated: true,
    });
    expect(enabled.allows_not_evaluated).toBe(true);
  });
});
