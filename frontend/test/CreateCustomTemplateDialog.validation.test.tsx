/**
 * CreateCustomTemplateDialog: the client must measure the name the way the
 * server does.
 *
 * The endpoint trims inside its string schema, so an untrimmed `"  ab  "`
 * would pass a bare `min(3)` here and come back a 422 — and FastAPI's
 * validation 422 is NOT in the ApiResponse envelope (`{"detail": [...]}`, no
 * `error` key), so `apiClient` can only report a generic unknown error. The
 * user would see "Error creating template: <generic>" with no hint that the
 * name was the problem. Trimming client-side keeps that path unreachable.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/templateImportService', () => ({ createCustomTemplate: vi.fn() }));

import { CreateCustomTemplateDialog } from '@/components/extraction/dialogs/CreateCustomTemplateDialog';
import { createCustomTemplate as rawCreate } from '@/services/templateImportService';

const createCustomTemplate = vi.mocked(rawCreate);

const noop = () => {};

function renderDialog() {
  return render(
    <CreateCustomTemplateDialog
      projectId="p1"
      open
      onOpenChange={noop}
      onTemplateCreated={noop}
    />,
  );
}

async function submitName(name: string) {
  renderDialog();
  fireEvent.change(screen.getByLabelText(/template name/i), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: /create template/i }));
}

describe('CreateCustomTemplateDialog name validation', () => {
  it('rejects a whitespace-padded short name without calling the API', async () => {
    createCustomTemplate.mockClear();
    await submitName('  ab  ');

    // Raw length is 6, so an untrimmed min(3) would let this through and the
    // server would answer 422. Asserted on the call rather than on the inline
    // message: this dialog's `<FormMessage />` does not currently render (a
    // plain "ab" behaves identically, so it predates the trim) — see the
    // separate follow-up. The second test is what makes this non-vacuous: the
    // same harness DOES reach the service for a valid name, so the pair shows
    // validation discriminating rather than the form never submitting.
    await waitFor(() => expect(createCustomTemplate).not.toHaveBeenCalled());
  });

  it('submits the trimmed name, matching what the server stores', async () => {
    createCustomTemplate.mockClear();
    createCustomTemplate.mockResolvedValue({
      ok: true,
      data: { templateId: 't1', entityTypesAdded: 0, fieldsAdded: 0 },
    });
    await submitName('   Diabetes Grid   ');

    await waitFor(() => expect(createCustomTemplate).toHaveBeenCalled());
    expect(createCustomTemplate).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ name: 'Diabetes Grid' }),
    );
  });
});
