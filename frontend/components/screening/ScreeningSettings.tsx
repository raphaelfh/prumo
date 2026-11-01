/**
 * The Settings sub-view, title/abstract part (spec §6.2): reviewers per
 * article (1–3; an option above `reviewer_capable` disabled and says why;
 * locked after the first decision) and the protocol's exclusion reasons, read
 * from the config and edited in the protocol. A 409 frozen save toasts and
 * refetches the project's screening reads; a 403 replaces the form.
 */
import {zodResolver} from '@hookform/resolvers/zod';
import {useQueryClient} from '@tanstack/react-query';
import {useId} from 'react';
import {useForm} from 'react-hook-form';
import {Link} from 'react-router';
import {toast} from 'sonner';
import {z} from 'zod';

import {ErrorState} from '@/components/patterns/ErrorState';
import {SettingsActions, SettingsGroup, SettingsPage} from '@/components/settings';
import {Button} from '@/components/ui/button';
import {Form, FormControl, FormDescription, FormField, FormItem, FormMessage} from '@/components/ui/form';
import {RadioGroup, RadioGroupItem} from '@/components/ui/radio-group';
import {useSetScreeningConfig} from '@/hooks/screening/useScreeningConfig';
import {ApiError} from '@/integrations/api/client';
import {t} from '@/lib/copy';
import {screeningKeys} from '@/lib/query-keys/screening';
import {screeningErrorMessage} from '@/lib/screening/errors';
import {cn} from '@/lib/utils';
import type {ScreeningConfigRead} from '@/services/screeningService';

const schema = z.object({reviewer_count: z.coerce.number().int().min(1).max(3)});
type FormIn = z.input<typeof schema>;
type FormOut = z.output<typeof schema>;

const REVIEWER_OPTIONS = [1, 2, 3] as const;
const PROTOCOL_HREF = '?tab=settings&section=review-question';

function optionLabel(n: number): string {
  return n === 1 ? t('screening', 'reviewerCountOne') : t('screening', 'reviewerCountMany').replace('{{n}}', String(n));
}

function isForbidden(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}

interface ScreeningSettingsProps {
  projectId: string;
  config: ScreeningConfigRead;
}

function ReviewerCountForm({projectId, config}: ScreeningSettingsProps) {
  const idPrefix = useId();
  const lockedHintId = `${idPrefix}-locked`;
  const queryClient = useQueryClient();
  const save = useSetScreeningConfig(projectId);
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(schema),
    defaultValues: {reviewer_count: config.reviewer_count ?? 1},
  });
  const locked = config.reviewer_count_locked;
  const disabled = locked || save.isPending;

  const onSubmit = (values: FormOut) => {
    save.mutate(values, {
      onSuccess: () => {
        toast.success(t('screening', 'configSavedToast'));
        form.reset(values);
      },
      onError: (error) => {
        if (isForbidden(error)) return;
        toast.error(screeningErrorMessage(error));
        if (error instanceof ApiError && error.code === 'SCREENING_CONFIG_FROZEN') {
          void queryClient.invalidateQueries({queryKey: screeningKeys.project(projectId)});
        }
      },
    });
  };

  if (save.isError && isForbidden(save.error)) {
    return <ErrorState title={t('screening', 'managerOnlyError')} message={screeningErrorMessage(save.error)} />;
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-2">
        <FormField
          control={form.control}
          name="reviewer_count"
          render={({field}) => (
            <FormItem>
              <FormControl>
                <RadioGroup
                  aria-label={t('screening', 'settingsReviewersTitle')}
                  aria-describedby={locked ? lockedHintId : undefined}
                  value={String(field.value)}
                  onValueChange={field.onChange}
                  disabled={disabled}
                  className="gap-1.5"
                >
                  {REVIEWER_OPTIONS.map((n) => {
                    const tooFew = n > config.reviewer_capable;
                    const itemId = `${idPrefix}-${n}`;
                    const hintId = `${itemId}-hint`;
                    return (
                      <div key={n} className="flex items-center gap-2">
                        <RadioGroupItem
                          id={itemId}
                          value={String(n)}
                          disabled={disabled || tooFew}
                          aria-describedby={tooFew ? hintId : undefined}
                        />
                        <label
                          htmlFor={itemId}
                          className={cn('text-[13px]', (disabled || tooFew) && 'text-muted-foreground')}
                        >
                          {optionLabel(n)}
                        </label>
                        {tooFew && (
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
              {locked && (
                <span id={lockedHintId} className="sr-only">
                  {t('screening', 'settingsReviewersLocked')}
                </span>
              )}
              <FormMessage />
            </FormItem>
          )}
        />
        <SettingsActions>
          <Button type="submit" size="sm" disabled={disabled}>
            {t('screening', 'configureSave')}
          </Button>
        </SettingsActions>
      </form>
    </Form>
  );
}

export function ScreeningSettings({projectId, config}: ScreeningSettingsProps) {
  const reasonsTitle = t('screening', 'settingsReasonsTitle');
  return (
    <div className="p-2">
      <SettingsPage>
        <SettingsGroup
          title={t('screening', 'settingsReviewersTitle')}
          hint={config.reviewer_count_locked ? t('screening', 'settingsReviewersLocked') : undefined}
        >
          <ReviewerCountForm projectId={projectId} config={config} />
        </SettingsGroup>
        <SettingsGroup title={reasonsTitle}>
          {config.exclusion_reasons.length > 0 ? (
            <ul aria-label={reasonsTitle} className="flex flex-col gap-0.5 text-[13px] text-foreground">
              {config.exclusion_reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted-foreground">{t('screening', 'settingsReasonsEmpty')}</p>
          )}
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <Link to={PROTOCOL_HREF}>{t('screening', 'editInProtocol')}</Link>
          </Button>
        </SettingsGroup>
      </SettingsPage>
    </div>
  );
}
