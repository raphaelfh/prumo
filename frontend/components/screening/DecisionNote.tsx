/**
 * The reviewer's optional note on a title/abstract decision (`rationale`).
 * A ghost "Add note" reveals the field; the caller owns the form (created
 * above its early returns, keyed by assignment) and reads the note in its
 * decide handler. Decision keys stay inert while typing here: the
 * `DecisionButtons` listener ignores text targets.
 */
import {zodResolver} from '@hookform/resolvers/zod';
import {useState} from 'react';
import {useForm, useWatch, type UseFormReturn} from 'react-hook-form';
import {z} from 'zod';

import {Button} from '@/components/ui/button';
import {Form, FormControl, FormField, FormItem, FormLabel, FormMessage} from '@/components/ui/form';
import {Textarea} from '@/components/ui/textarea';
import {t} from '@/lib/copy';

/** The backend's `rationale` cap (`ScreeningDecisionCreate`). */
const NOTE_MAX = 2000;
const noteSchema = z.object({note: z.string().max(NOTE_MAX)});
type NoteValues = z.infer<typeof noteSchema>;

export type DecisionNoteForm = UseFormReturn<NoteValues>;

export function useDecisionNoteForm(): DecisionNoteForm {
  return useForm<NoteValues>({resolver: zodResolver(noteSchema), defaultValues: {note: ''}});
}

export function DecisionNote({form, disabled}: {form: DecisionNoteForm; disabled?: boolean}) {
  const [opened, setOpened] = useState(false);
  // The caller's form outlives this field (its error and loading returns
  // unmount it); a note already written must stay visible, since it is sent.
  const note = useWatch({control: form.control, name: 'note'});
  const open = opened || note !== '';

  if (!open) {
    return (
      <div>
        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => setOpened(true)}>
          {t('screening', 'noteAdd')}
        </Button>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={(event) => event.preventDefault()}>
        <FormField
          control={form.control}
          name="note"
          render={({field}) => (
            <FormItem>
              <FormLabel className="text-xs font-medium text-muted-foreground">{t('screening', 'noteLabel')}</FormLabel>
              <FormControl>
                <Textarea rows={2} maxLength={NOTE_MAX} autoFocus {...field} disabled={disabled} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </form>
    </Form>
  );
}
