/**
 * Regression guard for the shared react-hook-form primitives in
 * `components/ui/form.tsx`.
 *
 * The bug this locks down: `useFormField` used to read the error from
 * `useFormContext().formState`. That proxy only registers a subscription on
 * the component that called `useForm`, so an error reached `FormMessage`
 * solely as a side effect of that parent re-rendering. Under
 * babel-plugin-react-compiler the parent's JSX is memoized on a stable
 * `form` object, so the re-render never propagated and EVERY inline
 * validation message in the app silently rendered nothing — submits were
 * blocked correctly, but the user saw a dead button.
 *
 * These tests exercise the primitives through a compiled component (vitest
 * shares the app's compiler preset via vite.shared-plugins.ts), which is what
 * makes them able to catch a revert. Asserting the message alone is not
 * enough — `FormMessage` falls back to its `children`, so a caller that
 * passes `fieldState.error?.message` explicitly stays green while the shared
 * hook is broken. `aria-invalid` on the control comes only from the hook, so
 * it is the load-bearing assertion here.
 */
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';
import {useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {z} from 'zod';

import {Input} from '@/components/ui/input';

import {Form, FormControl, FormField, FormItem, FormLabel, FormMessage} from './form';

const NAME_MIN_MESSAGE = 'Name must be at least 3 characters';

const schema = z.object({
    name: z.string().min(3, NAME_MIN_MESSAGE),
});

type Values = z.infer<typeof schema>;

function TestForm({onValid}: { onValid: (values: Values) => void }) {
    const form = useForm<Values>({
        resolver: zodResolver(schema),
        defaultValues: {name: ''},
    });

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onValid)}>
                <FormField
                    control={form.control}
                    name="name"
                    render={({field}) => (
                        <FormItem>
                            <FormLabel>Name</FormLabel>
                            <FormControl>
                                <Input {...field} />
                            </FormControl>
                            <FormMessage/>
                        </FormItem>
                    )}
                />
                <button type="submit">Submit</button>
            </form>
        </Form>
    );
}

async function submitWith(value: string) {
    const onValid = vi.fn();
    render(<TestForm onValid={onValid}/>);

    const input = screen.getByLabelText('Name');
    if (value) {
        await userEvent.type(input, value);
    }
    await userEvent.click(screen.getByRole('button', {name: 'Submit'}));

    return {onValid, input};
}

describe('ui/form validation feedback', () => {
    it('renders the resolver message in FormMessage on an invalid submit', async () => {
        const {onValid} = await submitWith('ab');

        expect(await screen.findByText(NAME_MIN_MESSAGE)).toBeInTheDocument();
        expect(onValid).not.toHaveBeenCalled();
    });

    it('marks the control aria-invalid — the assertion a children fallback cannot fake', async () => {
        const {input} = await submitWith('ab');

        await vi.waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'));
    });

    it('points the control at the message via aria-describedby', async () => {
        const {input} = await submitWith('ab');

        const message = await screen.findByText(NAME_MIN_MESSAGE);
        await vi.waitFor(() =>
            expect(input.getAttribute('aria-describedby')).toContain(message.id),
        );
    });

    it('marks the label destructive so the field reads as errored', async () => {
        await submitWith('ab');

        await vi.waitFor(() =>
            expect(screen.getByText('Name')).toHaveClass('text-destructive'),
        );
    });

    it('clears the message and aria-invalid once the value becomes valid', async () => {
        const {onValid, input} = await submitWith('ab');
        expect(await screen.findByText(NAME_MIN_MESSAGE)).toBeInTheDocument();

        await userEvent.type(input, 'cde');

        await vi.waitFor(() => expect(screen.queryByText(NAME_MIN_MESSAGE)).not.toBeInTheDocument());
        expect(input).toHaveAttribute('aria-invalid', 'false');

        await userEvent.click(screen.getByRole('button', {name: 'Submit'}));
        await vi.waitFor(() => expect(onValid).toHaveBeenCalledWith(
            expect.objectContaining({name: 'abcde'}),
            expect.anything(),
        ));
    });

    it('renders no message and stays aria-valid before the first submit', async () => {
        render(<TestForm onValid={vi.fn()}/>);

        expect(screen.queryByText(NAME_MIN_MESSAGE)).not.toBeInTheDocument();
        expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'false');
    });
});
