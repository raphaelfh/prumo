/**
 * The arbitrator's conflicts: one card per record where reviewers disagree,
 * with every current decision. A ruling either adopts one reviewer's decision
 * or decides differently (Include / Exclude / Maybe, with a reason when the
 * protocol lists them). The optional note rides either ruling. Each ruling
 * names every decision the arbitrator saw, so the server can refuse it when
 * they changed since.
 */
import {zodResolver} from '@hookform/resolvers/zod';
import {ChevronRight} from 'lucide-react';
import {useRef, useState} from 'react';
import {useForm} from 'react-hook-form';
import {toast} from 'sonner';
import {z} from 'zod';

import {ErrorState} from '@/components/patterns/ErrorState';
import {Button} from '@/components/ui/button';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@/components/ui/collapsible';
import {Form, FormControl, FormField, FormItem, FormLabel, FormMessage} from '@/components/ui/form';
import {Textarea} from '@/components/ui/textarea';
import {useArbitrate, useScreeningConflicts} from '@/hooks/screening/useScreeningConflicts';
import {t} from '@/lib/copy';
import {screeningErrorMessage} from '@/lib/screening/errors';
import type {ScreeningArbitrationCreate, ScreeningConflictsRead} from '@/services/screeningService';

import {DecisionButtons} from './DecisionButtons';
import {decisionLabel, LoadingState, Notice, RecordAbstract} from './ScreeningParts';

type Conflict = ScreeningConflictsRead['items'][number];
type Ruling = Omit<ScreeningArbitrationCreate, 'ruled_on_decision_ids' | 'rationale'>;

const NOTE_MAX = 2000;
const noteSchema = z.object({rationale: z.string().max(NOTE_MAX)});
type NoteValues = z.infer<typeof noteSchema>;

interface ConflictCardProps {
  conflict: Conflict;
  reasons: string[];
  deciding: boolean;
  busy: boolean;
  onToggleDeciding: () => void;
  onRule: (assignmentId: string, body: ScreeningArbitrationCreate) => void;
}

function ConflictCard({conflict, reasons, deciding, busy, onToggleDeciding, onRule}: ConflictCardProps) {
  const form = useForm<NoteValues>({resolver: zodResolver(noteSchema), defaultValues: {rationale: ''}});
  const ruledOn = conflict.decisions.map((d) => d.id);

  const rule = (ruling: Ruling) =>
    void form.handleSubmit(({rationale}) => {
      onRule(conflict.assignment_id, {
        ruled_on_decision_ids: ruledOn,
        ...ruling,
        ...(rationale.trim() ? {rationale: rationale.trim()} : {}),
      });
    })();

  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-md border border-border/60 bg-card p-4">
      <Collapsible className="flex min-w-0 flex-col gap-2">
        <CollapsibleTrigger className="group flex w-full items-start gap-1.5 rounded-sm text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          <ChevronRight className="mt-1 size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
          <span className="min-w-0 text-base font-semibold leading-snug text-foreground">
            {conflict.article.title}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-2 pl-5">
          <RecordAbstract article={conflict.article} />
        </CollapsibleContent>
      </Collapsible>

      <ul className="flex flex-col gap-2">
        {conflict.decisions.map((d) => {
          const name = d.reviewer_name ?? t('screening', 'unnamedReviewer');
          return (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[13px] text-foreground">
                <span className="text-muted-foreground">{name}</span>
                <span className="font-medium">{decisionLabel(d.decision)}</span>
                {d.exclusion_reason && <span className="text-muted-foreground">{d.exclusion_reason}</span>}
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => rule({selected_decision_id: d.id})}
              >
                {t('screening', 'useDecisionOf').replace('{{name}}', name)}
              </Button>
            </li>
          );
        })}
      </ul>

      <Form {...form}>
        <form onSubmit={(event) => event.preventDefault()} className="flex flex-col gap-3">
          <FormField
            control={form.control}
            name="rationale"
            render={({field}) => (
              <FormItem>
                <FormLabel className="text-xs font-medium text-muted-foreground">
                  {t('screening', 'rulingNote')}
                </FormLabel>
                <FormControl>
                  <Textarea rows={2} maxLength={NOTE_MAX} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </Form>

      <div className="flex flex-col gap-2">
        <div>
          <Button size="sm" variant="ghost" aria-expanded={deciding} onClick={onToggleDeciding}>
            {t('screening', 'decideDifferently')}
          </Button>
        </div>
        {deciding && (
          <DecisionButtons
            reasons={reasons}
            disabled={busy}
            onDecide={({decision, exclusion_reason}) => rule({decision, exclusion_reason})}
          />
        )}
      </div>
    </li>
  );
}

export function ConflictsPanel({projectId}: {projectId: string}) {
  const query = useScreeningConflicts(projectId, true);
  const arbitrate = useArbitrate(projectId);
  // At most one card shows the decision keys: they listen on the window.
  const [decidingId, setDecidingId] = useState<string | null>(null);
  // `isPending` reaches the buttons only after a re-render; a double click
  // would post twice. This flag flips at once.
  const inFlight = useRef(false);

  if (query.isPending) return <LoadingState />;
  if (query.isError) {
    return (
      <ErrorState
        title={t('screening', 'loadErrorTitle')}
        message={screeningErrorMessage(query.error)}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const {items, exclusion_reasons} = query.data;
  if (items.length === 0) {
    return <Notice title={t('screening', 'conflictsEmptyTitle')} body={t('screening', 'conflictsEmptyBody')} />;
  }

  const onRule = (assignmentId: string, body: ScreeningArbitrationCreate) => {
    if (inFlight.current) return;
    inFlight.current = true;
    arbitrate.mutate(
      {assignmentId, body},
      {
        onSuccess: () => {
          setDecidingId(null);
          toast.success(t('screening', 'rulingSaved'));
        },
        onError: (error) => toast.error(screeningErrorMessage(error)),
        onSettled: () => {
          inFlight.current = false;
        },
      },
    );
  };

  return (
    <ul className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-4">
      {items.map((conflict) => (
        <ConflictCard
          key={conflict.assignment_id}
          conflict={conflict}
          reasons={exclusion_reasons}
          deciding={decidingId === conflict.assignment_id}
          busy={arbitrate.isPending}
          onToggleDeciding={() => setDecidingId((id) => (id === conflict.assignment_id ? null : conflict.assignment_id))}
          onRule={onRule}
        />
      ))}
    </ul>
  );
}
