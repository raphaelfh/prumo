/**
 * SecuritySection — inline validation feedback on the change-password form.
 *
 * The highest-stakes instance of the shared-hook regression guarded by
 * `frontend/test/components/ui/form.validation.test.tsx`: a password that
 * fails the strength rules blocked the submit with no visible reason, so the
 * user could not tell which rule they had missed.
 *
 * The cross-field `.refine` mismatch case is covered too — it lands on
 * `confirmPassword` via `path`, which is a different code path through
 * `getFieldState` than a plain per-field issue.
 *
 * `aria-invalid` is asserted on the `<input>` itself: `FormControl` sits
 * directly on the Input (the `relative` wrapper for the reveal toggle is
 * outside it), so the shared hook annotates the control a screen reader
 * actually lands on.
 *
 * One copy quirk: `securitySchemaMismatch` and `securityPasswordsDoNotMatch`
 * are the same sentence, so a mismatch renders it twice (live hint + inline
 * error).
 */
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/services/authService', () => ({
    updateUserPassword: vi.fn(),
}));
vi.mock('sonner', () => ({
    toast: Object.assign(vi.fn(), {error: vi.fn(), success: vi.fn(), info: vi.fn()}),
}));

import {SecuritySection} from '@/components/user/SecuritySection';
import {updateUserPassword} from '@/services/authService';
import {user as copy} from '@/lib/copy/user';

const updateMock = vi.mocked(updateUserPassword);

function newPasswordInput() {
    return screen.getByPlaceholderText(copy.securityNewPasswordPlaceholder);
}

function confirmPasswordInput() {
    return screen.getByPlaceholderText(copy.securityConfirmPlaceholder);
}

async function submit() {
    await userEvent.click(screen.getByRole('button', {name: copy.securityChangePassword}));
}

beforeEach(() => {
    vi.clearAllMocks();
    updateMock.mockResolvedValue({ok: true, data: undefined} as Awaited<
        ReturnType<typeof updateUserPassword>
    >);
});

describe('SecuritySection validation feedback', () => {
    it.each([
        ['too short', 'Ab1', copy.securitySchemaMin],
        ['no uppercase', 'abcdefg1', copy.securitySchemaUppercase],
        ['no digit', 'Abcdefgh', copy.securitySchemaNumber],
    ])('names the broken rule when the password is %s', async (_case, password, message) => {
        render(<SecuritySection/>);

        await userEvent.type(newPasswordInput(), password);
        await userEvent.type(confirmPasswordInput(), password);
        await submit();

        expect(await screen.findByText(message)).toBeInTheDocument();
        expect(newPasswordInput()).toHaveAttribute('aria-invalid', 'true');
        expect(updateMock).not.toHaveBeenCalled();
    });

    it('points the input at its own message, and keeps the label wired to it', async () => {
        render(<SecuritySection/>);

        // The label association must survive FormControl sitting on the Input:
        // SettingsField's htmlFor targets the Input's own hardcoded id, which
        // wins over the generated formItemId.
        expect(screen.getByLabelText(copy.securityNewPasswordLabel)).toBe(newPasswordInput());

        await userEvent.type(newPasswordInput(), 'Ab1');
        await userEvent.type(confirmPasswordInput(), 'Ab1');
        await submit();

        const message = await screen.findByText(copy.securitySchemaMin);
        await vi.waitFor(() =>
            expect(newPasswordInput().getAttribute('aria-describedby')).toContain(message.id),
        );
    });

    it('surfaces the cross-field mismatch on the confirm field', async () => {
        render(<SecuritySection/>);

        await userEvent.type(newPasswordInput(), 'Abcdefg1');
        await userEvent.type(confirmPasswordInput(), 'Abcdefg2');
        await submit();

        // Rendered more than once: the live match hint reuses this sentence.
        // Not pinning the count — aria-invalid below is what proves WHICH
        // field owns the error.
        await vi.waitFor(() =>
            expect(screen.getAllByText(copy.securitySchemaMismatch).length).toBeGreaterThan(0),
        );
        expect(confirmPasswordInput()).toHaveAttribute('aria-invalid', 'true');
        expect(newPasswordInput()).toHaveAttribute('aria-invalid', 'false');
        expect(updateMock).not.toHaveBeenCalled();
    });

    it('clears the message and submits once every rule is met', async () => {
        render(<SecuritySection/>);

        await userEvent.type(newPasswordInput(), 'Ab1');
        await userEvent.type(confirmPasswordInput(), 'Ab1');
        await submit();
        expect(await screen.findByText(copy.securitySchemaMin)).toBeInTheDocument();

        await userEvent.type(newPasswordInput(), 'cdefg');
        await userEvent.type(confirmPasswordInput(), 'cdefg');

        await vi.waitFor(() =>
            expect(screen.queryByText(copy.securitySchemaMin)).not.toBeInTheDocument(),
        );

        await submit();

        await vi.waitFor(() => expect(updateMock).toHaveBeenCalledWith('Ab1cdefg'));
    });
});
