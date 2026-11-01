/**
 * The Settings sub-view (spec §6.2): the phases (title/abstract only, or then
 * full text; locked once a record was sent to full text), reviewers per
 * article per phase (1–3; an option above `reviewer_capable` disabled and says why;
 * locked after the first decision) and the protocol's exclusion reasons, read
 * from the config and edited in the protocol. A 409 frozen save toasts and
 * refetches the project's screening reads; a 403 replaces the form.
 */
import {zodResolver} from '@hookform/resolvers/zod';
import {useQueryClient} from '@tanstack/react-query';
import {useId} from 'react';
import {useForm, useWatch} from 'react-hook-form';
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

const schema = z.object({
  phase: z.enum(['ta_only', 'ta_then_ft']),
  reviewer_count: z.coerce.number().int().min(1).max(3),
  full_text_reviewer_count: z.coerce.number().int().min(1).max(3),
});
type FormIn = z.input<typeof schema>;
type FormOut = z.output<typeof schema>;

const REVIEWER_OPTIONS = [1, 2, 3] as const;
const PHASE_OPTIONS = [
  {value: 'ta_only', key: 'phaseTaOnly'},
  {value: 'ta_then_ft', key: 'phaseTaThenFt'},
] as const;
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

interface CountOptionsProps {
  idPrefix: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  capable: number;
  describedBy?: string;
}

/** A 1–3 reviewer radio group; an option above the capable reviewers is disabled and says why. */
function CountOptions({idPrefix, label, value, onChange, disabled, capable, describedBy}: CountOptionsProps) {
  return (
    <RadioGroup
      aria-label={label}
      aria-describedby={describedBy}
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      className="gap-1.5"
    >
      {REVIEWER_OPTIONS.map((n) => {
        const tooFew = n > capable;
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
            <label htmlFor={itemId} className={cn('text-[13px]', (disabled || tooFew) && 'text-muted-foreground')}>
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
  );
}

function ReviewForm({projectId, config}: ScreeningSettingsProps) {
  const idPrefix = useId();
  const lockedHintId = `${idPrefix}-locked`;
  const ftLockedHintId = `${idPrefix}-ft-locked`;
  const queryClient = useQueryClient();
  const save = useSetScreeningConfig(projectId);
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(schema),
    defaultValues: {
      phase: config.full_text_reviewer_count === null ? 'ta_only' : 'ta_then_ft',
      reviewer_count: config.reviewer_count ?? 1,
      full_text_reviewer_count: config.full_text_reviewer_count ?? Math.max(1, Math.min(2, config.reviewer_capable)),
    },
  });
  const phase = useWatch({control: form.control, name: 'phase'});
  const locked = config.reviewer_count_locked;
  const ftLocked = config.full_text_count_locked;
  const taDisabled = locked || save.isPending;
  const ftDisabled = ftLocked || save.isPending;

  const onSubmit = (values: FormOut) => {
    const body = {
      reviewer_count: values.reviewer_count,
      full_text_reviewer_count: values.phase === 'ta_then_ft' ? values.full_text_reviewer_count : null,
    };
    save.mutate(body, {
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
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <SettingsGroup
          title={t('screening', 'settingsPhasesTitle')}
          hint={ftLocked ? t('screening', 'settingsFtLocked') : undefined}
        >
          <FormField
            control={form.control}
            name="phase"
            render={({field}) => (
              <FormItem>
                <FormControl>
                  <RadioGroup
                    aria-label={t('screening', 'settingsPhasesTitle')}
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={ftDisabled}
                    className="gap-1.5"
                  >
                    {PHASE_OPTIONS.map(({value, key}) => (
                      <div key={value} className="flex items-center gap-2">
                        <RadioGroupItem id={`${idPrefix}-${value}`} value={value} />
                        <label
                          htmlFor={`${idPrefix}-${value}`}
                          className={cn('text-[13px]', ftDisabled && 'text-muted-foreground')}
                        >
                          {t('screening', key)}
                        </label>
                      </div>
                    ))}
                  </RadioGroup>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </SettingsGroup>
        <SettingsGroup
          title={t('screening', 'settingsReviewersTitle')}
          hint={locked ? t('screening', 'settingsReviewersLocked') : undefined}
        >
          <FormField
            control={form.control}
            name="reviewer_count"
            render={({field}) => (
              <FormItem>
                <FormControl>
                  <CountOptions
                    idPrefix={`${idPrefix}-ta`}
                    label={t('screening', 'settingsReviewersTitle')}
                    value={String(field.value)}
                    onChange={field.onChange}
                    disabled={taDisabled}
                    capable={config.reviewer_capable}
                    describedBy={locked ? lockedHintId : undefined}
                  />
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
        </SettingsGroup>
        {phase === 'ta_then_ft' && (
          <SettingsGroup title={t('screening', 'settingsFtReviewersTitle')}>
            <FormField
              control={form.control}
              name="full_text_reviewer_count"
              render={({field}) => (
                <FormItem>
                  <FormControl>
                    <CountOptions
                      idPrefix={`${idPrefix}-ft`}
                      label={t('screening', 'settingsFtReviewersTitle')}
                      value={String(field.value)}
                      onChange={field.onChange}
                      disabled={ftDisabled}
                      capable={config.reviewer_capable}
                      describedBy={ftLocked ? ftLockedHintId : undefined}
                    />
                  </FormControl>
                  {ftLocked && (
                    <span id={ftLockedHintId} className="sr-only">
                      {t('screening', 'settingsFtLocked')}
                    </span>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
          </SettingsGroup>
        )}
        <SettingsActions>
          <Button type="submit" size="sm" disabled={(locked && ftLocked) || save.isPending}>
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
        <ReviewForm projectId={projectId} config={config} />
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
