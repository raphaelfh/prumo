/**
 * AddProjectDialog — inline validation feedback.
 *
 * Same contract as every other zodResolver form in the app: an invalid value
 * blocks the submit AND says why. See
 * `frontend/test/components/ui/form.validation.test.tsx` for the shared-hook
 * regression these guard against.
 *
 * `aria-invalid` is asserted next to the message because only the shared
 * `useFormField` can produce it — a `FormMessage` children fallback cannot.
 */
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {AddProjectDialog} from '@/components/project/AddProjectDialog';
import {project as copy} from '@/lib/copy/project';

const onProjectCreate = vi.fn();
const onOpenChange = vi.fn();

function renderDialog() {
    return render(
        <AddProjectDialog open onOpenChange={onOpenChange} onProjectCreate={onProjectCreate}/>,
    );
}

function nameInput() {
    return screen.getByPlaceholderText(copy.addDialogNamePlaceholder);
}

async function submit() {
    await userEvent.click(screen.getByRole('button', {name: copy.addDialogCreateProject}));
}

beforeEach(() => {
    vi.clearAllMocks();
    onProjectCreate.mockResolvedValue(undefined);
});

describe('AddProjectDialog validation feedback', () => {
    it('shows the required message on an empty name', async () => {
        renderDialog();

        await submit();

        expect(await screen.findByText(copy.addDialogNameRequired)).toBeInTheDocument();
        expect(nameInput()).toHaveAttribute('aria-invalid', 'true');
        expect(onProjectCreate).not.toHaveBeenCalled();
    });

    it('shows the min-length message on a two-character name', async () => {
        renderDialog();

        await userEvent.type(nameInput(), 'ab');
        await submit();

        expect(await screen.findByText(copy.addDialogNameMinLength)).toBeInTheDocument();
        expect(nameInput()).toHaveAttribute('aria-invalid', 'true');
        expect(onProjectCreate).not.toHaveBeenCalled();
    });

    it('clears the message and creates once the name becomes valid', async () => {
        renderDialog();

        await userEvent.type(nameInput(), 'ab');
        await submit();
        expect(await screen.findByText(copy.addDialogNameMinLength)).toBeInTheDocument();

        await userEvent.type(nameInput(), 'c');

        await vi.waitFor(() =>
            expect(screen.queryByText(copy.addDialogNameMinLength)).not.toBeInTheDocument(),
        );
        expect(nameInput()).toHaveAttribute('aria-invalid', 'false');

        await submit();

        await vi.waitFor(() =>
            expect(onProjectCreate).toHaveBeenCalledWith({name: 'abc', description: undefined}),
        );
    });
});
