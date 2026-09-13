/**
 * Guard for FormControl's aria-describedby merge — a deliberate divergence
 * from upstream shadcn (ui-styling skill; spec 2026-09-13 §4.2). Upstream
 * spreads props after its own attribute and Radix Slot lets them win, so a
 * SettingsRow hint id used to overwrite the description and message ids.
 */
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';
import {useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {z} from 'zod';

import {Input} from '@/components/ui/input';

import {Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage} from './form';

const MESSAGE = 'Name must be at least 3 characters';
const schema = z.object({name: z.string().min(3, MESSAGE)});
type Values = z.infer<typeof schema>;

function TestForm({incoming}: {incoming?: string}) {
  const form = useForm<Values>({resolver: zodResolver(schema), defaultValues: {name: ''}});
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(() => {})}>
        <FormField
          control={form.control}
          name="name"
          render={({field}) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl aria-describedby={incoming}>
                <Input {...field} />
              </FormControl>
              <FormDescription>Shown to reviewers</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <span id="row-hint">A row hint</span>
        <button type="submit">Submit</button>
      </form>
    </Form>
  );
}

const control = () => screen.getByLabelText('Name');
const descriptionId = () => screen.getByText('Shown to reviewers').id;
const submit = () => userEvent.click(screen.getByRole('button', {name: 'Submit'}));

describe('FormControl aria-describedby', () => {
  it('is unchanged with no incoming id, valid and errored', async () => {
    render(<TestForm />);
    expect(control()).toHaveAttribute('aria-describedby', descriptionId());
    await submit();
    const message = await screen.findByText(MESSAGE);
    await vi.waitFor(() => expect(control()).toHaveAttribute('aria-describedby', `${descriptionId()} ${message.id}`));
  });

  it('keeps the description id and appends an incoming id while valid', () => {
    render(<TestForm incoming="row-hint" />);
    expect(control().getAttribute('aria-describedby')?.split(' ')).toEqual([descriptionId(), 'row-hint']);
  });

  it('holds description, message and incoming ids after a failed submit', async () => {
    render(<TestForm incoming="row-hint" />);
    await submit();
    const message = await screen.findByText(MESSAGE);
    await vi.waitFor(() =>
      expect(control().getAttribute('aria-describedby')?.split(' ')).toEqual([descriptionId(), message.id, 'row-hint']),
    );
  });
});
