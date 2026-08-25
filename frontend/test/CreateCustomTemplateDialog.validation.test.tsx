/**
 * CreateCustomTemplateDialog: the client must measure the name the way the
 * server does, AND say so when it refuses.
 *
 * The endpoint trims inside its string schema, so an untrimmed `"  ab  "`
 * would pass a bare `min(3)` here and come back a 422 — and FastAPI's
 * validation 422 is NOT in the ApiResponse envelope (`{"detail": [...]}`, no
 * `error` key), so `apiClient` can only report a generic unknown error. The
 * user would see "Error creating template: <generic>" with no hint that the
 * name was the problem. Trimming client-side keeps that path unreachable.
 *
 * The inline-message half was previously untestable: `<FormMessage />` never
 * rendered, because the shared `useFormField` read the error off
 * `useFormContext().formState` and react-compiler memoized the parent's JSX
 * so the re-render never reached it. Fixed in `components/ui/form.tsx` —
 * root cause and worked example in `components/ui/form.validation.test.tsx`.
 * `aria-invalid` is asserted next to the message because only the shared hook
 * can produce it, while a message could also come from a children fallback.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/templateImportService', () => ({ createCustomTemplate: vi.fn() }));

import { CreateCustomTemplateDialog } from '@/components/extraction/dialogs/CreateCustomTemplateDialog';
import { createCustomTemplate as rawCreate } from '@/services/templateImportService';
import { extraction as copy } from '@/lib/copy';

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

const nameInput = () => screen.getByLabelText(/template name/i);
const clickCreate = () =>
  fireEvent.click(screen.getByRole('button', { name: /create template/i }));

async function submitName(name: string) {
  renderDialog();
  fireEvent.change(nameInput(), { target: { value: name } });
  clickCreate();
}

describe('CreateCustomTemplateDialog name validation', () => {
  it('rejects a whitespace-padded short name without calling the API', async () => {
    createCustomTemplate.mockClear();
    await submitName('  ab  ');

    // Raw length is 6, so an untrimmed min(3) would let this through and the
    // server would answer 422. Asserted on the call rather than the message:
    // the second test is what makes this non-vacuous — the same harness DOES
    // reach the service for a valid name, so the pair shows validation
    // discriminating rather than the form never submitting.
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

describe('CreateCustomTemplateDialog validation feedback', () => {
  it('tells the user why a short name was refused', async () => {
    createCustomTemplate.mockClear();
    await submitName('ab');

    expect(await screen.findByText(copy.createValidationNameMin)).toBeInTheDocument();
    expect(nameInput()).toHaveAttribute('aria-invalid', 'true');
    expect(createCustomTemplate).not.toHaveBeenCalled();
  });

  it('says the same for a padded name the server would also reject', async () => {
    createCustomTemplate.mockClear();
    await submitName('  ab  ');

    // The trim is what makes this message reachable at all: without it the
    // raw 6 characters would pass, so this doubles as a guard on `.trim()`.
    expect(await screen.findByText(copy.createValidationNameMin)).toBeInTheDocument();
    expect(nameInput()).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows the max-length message past 100 characters', async () => {
    createCustomTemplate.mockClear();
    await submitName('x'.repeat(101));

    expect(await screen.findByText(copy.createValidationNameMax)).toBeInTheDocument();
    expect(nameInput()).toHaveAttribute('aria-invalid', 'true');
    expect(createCustomTemplate).not.toHaveBeenCalled();
  });

  it('clears the message and submits once the name becomes valid', async () => {
    createCustomTemplate.mockClear();
    createCustomTemplate.mockResolvedValue({
      ok: true,
      data: { templateId: 't1', entityTypesAdded: 0, fieldsAdded: 0 },
    });
    await submitName('ab');
    expect(await screen.findByText(copy.createValidationNameMin)).toBeInTheDocument();

    await userEvent.type(nameInput(), 'c');

    await waitFor(() =>
      expect(screen.queryByText(copy.createValidationNameMin)).not.toBeInTheDocument(),
    );
    expect(nameInput()).toHaveAttribute('aria-invalid', 'false');

    clickCreate();

    await waitFor(() =>
      expect(createCustomTemplate).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({ name: 'abc' }),
      ),
    );
  });
});
