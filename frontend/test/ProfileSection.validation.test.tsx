/**
 * ProfileSection — inline validation feedback on the display-name form.
 *
 * Guards the same shared-hook regression as
 * `frontend/test/components/ui/form.validation.test.tsx`: clearing the name
 * and pressing Save blocked the write with no visible reason.
 *
 * The `<FormMessage/>` here is bare (no children fallback), so the message
 * text can only have come from the shared `useFormField` — it is the
 * load-bearing assertion, with `aria-invalid` corroborating it.
 */
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/services/profileService', () => ({
    fetchProfile: vi.fn(),
    saveProfile: vi.fn(),
}));
vi.mock('sonner', () => ({
    toast: Object.assign(vi.fn(), {error: vi.fn(), success: vi.fn(), info: vi.fn()}),
}));

import {ProfileSection} from '@/components/user/ProfileSection';
import {fetchProfile, saveProfile} from '@/services/profileService';
import {user as copy} from '@/lib/copy/user';

const fetchMock = vi.mocked(fetchProfile);
const saveMock = vi.mocked(saveProfile);

function nameInput() {
    return screen.getByPlaceholderText(copy.profileFullNamePlaceholder);
}

async function submit() {
    await userEvent.click(screen.getByRole('button', {name: copy.profileSaveChanges}));
}

/**
 * Waits out the mount-time profile load. Awaiting the settled VALUE, not the
 * element: `loading` starts false, so the input is on screen from the first
 * paint and an element query could resolve before `form.reset()` lands.
 */
async function renderLoaded() {
    render(<ProfileSection/>);
    return screen.findByDisplayValue('Ada Lovelace');
}

beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockResolvedValue({
        ok: true,
        data: {fullName: 'Ada Lovelace', email: 'ada@example.org', avatarUrl: ''},
    } as unknown as Awaited<ReturnType<typeof fetchProfile>>);
    saveMock.mockResolvedValue({ok: true, data: undefined} as Awaited<
        ReturnType<typeof saveProfile>
    >);
});

describe('ProfileSection validation feedback', () => {
    it('shows the required message when the name is cleared', async () => {
        await renderLoaded();

        await userEvent.clear(nameInput());
        await submit();

        expect(await screen.findByText(copy.profileNameRequired)).toBeInTheDocument();
        expect(nameInput()).toHaveAttribute('aria-invalid', 'true');
        expect(saveMock).not.toHaveBeenCalled();
    });

    it('shows the max-length message past 100 characters', async () => {
        await renderLoaded();

        await userEvent.clear(nameInput());
        // paste, not type: 101 simulated keystrokes cost ~300ms for no signal.
        await userEvent.click(nameInput());
        await userEvent.paste('x'.repeat(101));
        await submit();

        expect(await screen.findByText(copy.profileNameMaxLength)).toBeInTheDocument();
        expect(nameInput()).toHaveAttribute('aria-invalid', 'true');
        expect(saveMock).not.toHaveBeenCalled();
    });

    it('clears the message and saves once the name is valid again', async () => {
        await renderLoaded();

        await userEvent.clear(nameInput());
        await submit();
        expect(await screen.findByText(copy.profileNameRequired)).toBeInTheDocument();

        await userEvent.type(nameInput(), 'Grace Hopper');

        await vi.waitFor(() =>
            expect(screen.queryByText(copy.profileNameRequired)).not.toBeInTheDocument(),
        );
        expect(nameInput()).toHaveAttribute('aria-invalid', 'false');

        await submit();

        await vi.waitFor(() =>
            expect(saveMock).toHaveBeenCalledWith(
                expect.objectContaining({fullName: 'Grace Hopper'}),
            ),
        );
    });
});
