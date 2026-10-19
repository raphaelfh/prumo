/**
 * Project → Configuration → AI engine → AI agents: who may start AI
 * extraction runs through a connected agent, and the per-run and per-day
 * article caps. A manager edits and saves the whole policy at once (the PUT
 * is a full replacement); every other member sees the values read-only.
 */
import {zodResolver} from '@hookform/resolvers/zod';
import {useForm} from 'react-hook-form';
import {toast} from 'sonner';
import {z} from 'zod';

import {SettingsActions, SettingsGroup, SettingsRow} from '@/components/settings';
import {Button} from '@/components/ui/button';
import {Form, FormControl, FormField, FormItem, FormMessage} from '@/components/ui/form';
import {Input} from '@/components/ui/input';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {Skeleton} from '@/components/ui/skeleton';
import {useAiPolicy, useUpdateAiPolicy} from '@/hooks/extraction/useAiPolicy';
import {t} from '@/lib/copy';
import type {AiPolicyRead, AiPolicyUpdateRequest} from '@/services/aiPolicyService';

const AGENT_RUNS_COPY = {
  off: 'agentRunsOff',
  managers: 'agentRunsManagers',
  reviewers: 'agentRunsReviewers',
} as const;
const AGENT_RUNS = ['off', 'managers', 'reviewers'] as const;

const wholeNumber = (max: number, message: string) =>
  z.number({invalid_type_error: message}).int(message).min(1, message).max(max, message);

const policySchema = z.object({
  agent_runs: z.enum(AGENT_RUNS),
  max_articles_per_run: wholeNumber(100, t('llmConnections', 'maxArticlesRange')),
  daily_agent_article_cap: wholeNumber(1000, t('llmConnections', 'dailyCapRange')),
});

const toForm = (read: AiPolicyRead): AiPolicyUpdateRequest => ({
  agent_runs: read.agent_runs,
  max_articles_per_run: read.max_articles_per_run,
  daily_agent_article_cap: read.daily_agent_article_cap,
});

/** An emptied number input reports NaN; render it as empty, never as "NaN". */
const numberValue = (value: number) => (Number.isNaN(value) ? '' : value);

function PolicyForm({projectId, read}: {projectId: string; read: AiPolicyRead}) {
  const save = useUpdateAiPolicy(projectId);
  // `values` re-seeds the form whenever the stored policy changes (the save's
  // response, then its refetch), so the inputs show what the server kept.
  const form = useForm<AiPolicyUpdateRequest>({resolver: zodResolver(policySchema), values: toForm(read)});
  const submit = (body: AiPolicyUpdateRequest) =>
    save.mutate(body, {
      onSuccess: () => toast.success(t('llmConnections', 'agentsSaveSuccess')),
      onError: () => toast.error(t('llmConnections', 'agentsSaveError')),
    });
  return (
    <Form {...form}>
      <form className="space-y-1" onSubmit={form.handleSubmit(submit)} noValidate>
        <FormField
          control={form.control}
          name="agent_runs"
          render={({field}) => (
            <SettingsRow label={t('llmConnections', 'agentRunsLabel')} htmlFor="ai-agents-runs">
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="ai-agents-runs" variant="quiet" className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AGENT_RUNS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t('llmConnections', AGENT_RUNS_COPY[value])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsRow>
          )}
        />
        <FormField
          control={form.control}
          name="max_articles_per_run"
          render={({field}) => (
            <FormItem className="space-y-0">
              <SettingsRow label={t('llmConnections', 'maxArticlesLabel')} htmlFor="ai-agents-per-run">
                <FormControl>
                  <Input
                    id="ai-agents-per-run"
                    variant="quiet"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={100}
                    className="w-24"
                    name={field.name}
                    ref={field.ref}
                    onBlur={field.onBlur}
                    value={numberValue(field.value)}
                    onChange={(e) => field.onChange(e.target.valueAsNumber)}
                  />
                </FormControl>
                <FormMessage className="text-[12px]" />
              </SettingsRow>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="daily_agent_article_cap"
          render={({field}) => (
            <FormItem className="space-y-0">
              <SettingsRow
                label={t('llmConnections', 'dailyCapLabel')}
                htmlFor="ai-agents-daily"
                hint={t('llmConnections', 'dailyCapHint')}
              >
                {({describedBy}) => (
                  <>
                    <FormControl aria-describedby={describedBy}>
                      <Input
                        id="ai-agents-daily"
                        variant="quiet"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={1000}
                        className="w-24"
                        name={field.name}
                        ref={field.ref}
                        onBlur={field.onBlur}
                        value={numberValue(field.value)}
                        onChange={(e) => field.onChange(e.target.valueAsNumber)}
                      />
                    </FormControl>
                    <FormMessage className="text-[12px]" />
                  </>
                )}
              </SettingsRow>
            </FormItem>
          )}
        />
        <SettingsActions>
          <Button type="submit" size="sm" disabled={save.isPending}>
            {save.isPending ? t('llmConnections', 'saving') : t('llmConnections', 'agentsSaveButton')}
          </Button>
        </SettingsActions>
      </form>
    </Form>
  );
}

function PolicyReadOnly({read}: {read: AiPolicyRead}) {
  return (
    <>
      <SettingsRow label={t('llmConnections', 'agentRunsLabel')}>
        <span className="px-2 text-[13px]">{t('llmConnections', AGENT_RUNS_COPY[read.agent_runs])}</span>
      </SettingsRow>
      <SettingsRow label={t('llmConnections', 'maxArticlesLabel')}>
        <span className="px-2 text-[13px] tabular-nums">{read.max_articles_per_run}</span>
      </SettingsRow>
      <SettingsRow label={t('llmConnections', 'dailyCapLabel')} hint={t('llmConnections', 'dailyCapHint')}>
        <span className="px-2 text-[13px] tabular-nums">{read.daily_agent_article_cap}</span>
      </SettingsRow>
    </>
  );
}

export function AiAgentsPolicyGroup({projectId, isManager}: {projectId: string; isManager: boolean}) {
  const policy = useAiPolicy(projectId);
  return (
    <SettingsGroup title={t('llmConnections', 'agentsTitle')} hint={t('llmConnections', 'agentsHint')}>
      {policy.isPending && (
        <>
          <Skeleton className="h-8 w-full" data-testid="ai-agents-skeleton" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </>
      )}
      {policy.isError && (
        <p className="flex items-center gap-2 text-[13px] text-destructive">
          {t('llmConnections', 'agentsLoadError')}
          <Button size="sm" variant="ghost" onClick={() => void policy.refetch()}>
            {t('llmConnections', 'retry')}
          </Button>
        </p>
      )}
      {policy.data &&
        (isManager ? (
          <PolicyForm projectId={projectId} read={policy.data} />
        ) : (
          <PolicyReadOnly read={policy.data} />
        ))}
    </SettingsGroup>
  );
}
