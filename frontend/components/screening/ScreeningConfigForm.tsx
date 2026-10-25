/**
 * Reviewers per record (1–3), chosen once by a manager before screening
 * starts. An option above `reviewer_capable` is disabled and says why; a
 * rejected save (409 frozen / too few reviewers) is worded inline.
 */
import {zodResolver} from '@hookform/resolvers/zod';
import {useId} from 'react';
import {useForm} from 'react-hook-form';
import {toast} from 'sonner';
import {z} from 'zod';

import {Button} from '@/components/ui/button';
import {Form, FormControl, FormDescription, FormField, FormItem, FormMessage} from '@/components/ui/form';
import {RadioGroup, RadioGroupItem} from '@/components/ui/radio-group';
import {useSetScreeningConfig} from '@/hooks/screening/useScreeningConfig';
import {t} from '@/lib/copy';
import {screeningErrorMessage} from '@/lib/screening/errors';
import {cn} from '@/lib/utils';
import type {ScreeningConfigRead} from '@/services/screeningService';

const schema = z.object({reviewer_count: z.coerce.number().int().min(1).max(3)});
type FormIn = z.input<typeof schema>;
type FormOut = z.output<typeof schema>;

const REVIEWER_OPTIONS = [1, 2, 3] as const;

function optionLabel(n: number): string {
  return n === 1 ? t('screening', 'reviewerCountOne') : t('screening', 'reviewerCountMany').replace('{{n}}', String(n));
}

interface ScreeningConfigFormProps {
  projectId: string;
  config: ScreeningConfigRead;
}

export function ScreeningConfigForm({projectId, config}: ScreeningConfigFormProps) {
  const titleId = useId();
  const idPrefix = useId();
  const save = useSetScreeningConfig(projectId);
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(schema),
    defaultValues: {reviewer_count: config.reviewer_count ?? 1},
  });

  const onSubmit = (values: FormOut) => {
    save.mutate(values, {
      onSuccess: () => {
        toast.success(t('screening', 'configSavedToast'));
        form.reset(values);
      },
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex max-w-md flex-col gap-3 p-4">
        <div className="flex flex-col gap-1">
          <h2 id={titleId} className="text-sm font-medium text-foreground">
            {t('screening', 'configureTitle')}
          </h2>
          <p className="text-[13px] text-muted-foreground">{t('screening', 'configureDescription')}</p>
        </div>
        <FormField
          control={form.control}
          name="reviewer_count"
          render={({field}) => (
            <FormItem>
              <FormControl>
                <RadioGroup
                  aria-labelledby={titleId}
                  value={String(field.value)}
                  onValueChange={field.onChange}
                  className="gap-1.5"
                >
                  {REVIEWER_OPTIONS.map((n) => {
                    const disabled = n > config.reviewer_capable;
                    const itemId = `${idPrefix}-${n}`;
                    const hintId = `${itemId}-hint`;
                    return (
                      <div key={n} className="flex items-center gap-2">
                        <RadioGroupItem
                          id={itemId}
                          value={String(n)}
                          disabled={disabled}
                          aria-describedby={disabled ? hintId : undefined}
                        />
                        <label
                          htmlFor={itemId}
                          className={cn('text-[13px]', disabled && 'text-muted-foreground')}
                        >
                          {optionLabel(n)}
                        </label>
                        {disabled && (
                          <span id={hintId} className="text-xs text-muted-foreground">
                            {t('screening', 'reviewerCountNeedsMembers').replace('{{n}}', String(n))}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </RadioGroup>
              </FormControl>
              <FormDescription className="text-xs">{t('screening', 'configureConflictHint')}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        {save.isError && (
          <p role="alert" className="text-[13px] text-destructive">
            {screeningErrorMessage(save.error)}
          </p>
        )}
        <div>
          <Button type="submit" disabled={save.isPending}>
            {t('screening', 'configureSave')}
          </Button>
        </div>
      </form>
    </Form>
  );
}
