/**
 * One record as the caller may see it. Blindness is the server's: this view
 * renders `peer_decisions` and `outcome` exactly as the API returns them.
 * A reviewer may change the decision here; anyone else only reads.
 */
import {ArrowLeft} from 'lucide-react';
import {useRef, type ReactNode} from 'react';
import {toast} from 'sonner';

import {ErrorState} from '@/components/patterns/ErrorState';
import {Button} from '@/components/ui/button';
import {useScreeningAssignment} from '@/hooks/screening/useScreeningAssignment';
import {useDecide} from '@/hooks/screening/useScreeningQueue';
import {t} from '@/lib/copy';
import {screeningErrorMessage} from '@/lib/screening/errors';
import type {ScreeningAssignmentRead, ScreeningDecisionCreate} from '@/services/screeningService';

import {DecisionButtons} from './DecisionButtons';
import {decisionLabel, LoadingState, RecordBody} from './ScreeningParts';

const STATUS_LABEL = {
  awaiting_me: 'statusAwaitingMe',
  awaiting_others: 'statusAwaitingOthers',
  conflict: 'statusConflict',
  decided: 'statusDecided',
} as const;

const OUTCOME_KIND_LABEL = {
  solo: 'outcomeSolo',
  consensus: 'outcomeConsensus',
  arbitrated: 'outcomeArbitrated',
} as const;

function Section({title, children}: {title: string; children: ReactNode}) {
  return (
    <section className="flex flex-col gap-1.5 border-t border-border/40 pt-3">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function DecisionLine({
  decision,
  reason,
  children,
}: {
  decision: ScreeningDecisionCreate['decision'];
  reason: string | null;
  children?: ReactNode;
}) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 text-[13px] text-foreground">
      {children}
      <span className="font-medium">{decisionLabel(decision)}</span>
      {reason && <span className="text-muted-foreground">{reason}</span>}
    </p>
  );
}

function AssignmentDetails({read}: {read: ScreeningAssignmentRead}) {
  const {outcome, my_decision, peer_decisions} = read;
  return (
    <div className="flex flex-col gap-4">
      <RecordBody article={read.article} />
      {my_decision && (
        <Section title={t('screening', 'yourDecision')}>
          <DecisionLine decision={my_decision.decision} reason={my_decision.exclusion_reason} />
        </Section>
      )}
      {outcome && (
        <Section title={t('screening', 'outcomeTitle')}>
          <DecisionLine decision={outcome.decision} reason={outcome.exclusion_reason}>
            <span className="text-muted-foreground">{t('screening', OUTCOME_KIND_LABEL[outcome.kind])}</span>
          </DecisionLine>
          {outcome.reasons_differ && (
            <p className="text-xs text-muted-foreground">{t('screening', 'reasonsDiffer')}</p>
          )}
        </Section>
      )}
      {peer_decisions.length > 0 && (
        <Section title={t('screening', 'peerDecisionsTitle')}>
          <ul className="flex flex-col gap-1">
            {peer_decisions.map((peer) => (
              <li key={peer.id}>
                <DecisionLine decision={peer.decision} reason={peer.exclusion_reason}>
                  <span className="text-muted-foreground">{peer.reviewer_name ?? t('screening', 'peerUnnamed')}</span>
                </DecisionLine>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

interface AssignmentViewProps {
  assignmentId: string;
  canReview: boolean;
  onBack: () => void;
}

export function AssignmentView({assignmentId, canReview, onBack}: AssignmentViewProps) {
  const query = useScreeningAssignment(assignmentId);
  const decide = useDecide(query.data?.project_id ?? '');
  // `isPending` reaches the buttons only after a re-render; two keys pressed
  // before it would both post. This flag flips at once.
  const inFlight = useRef(false);

  const back = (
    <Button variant="ghost" onClick={onBack} className="self-start">
      <ArrowLeft />
      {t('screening', 'backToQueue')}
    </Button>
  );

  if (query.isPending) return <LoadingState />;
  if (query.isError) {
    return (
      <div className="flex flex-col p-2">
        {back}
        <ErrorState message={screeningErrorMessage(query.error)} />
      </div>
    );
  }

  const read = query.data;
  const onDecide = (body: ScreeningDecisionCreate) => {
    if (inFlight.current) return;
    inFlight.current = true;
    decide.mutate(
      {assignmentId, body},
      {
        onError: (error) => toast.error(screeningErrorMessage(error)),
        onSettled: () => {
          inFlight.current = false;
        },
      },
    );
  };

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 px-2 pt-2">
        {back}
        <span className="rounded-sm bg-muted px-2 py-0.5 text-xs text-foreground">
          {t('screening', STATUS_LABEL[read.status])}
        </span>
      </div>
      <div className="mx-auto w-full max-w-3xl px-4 py-4">
        <AssignmentDetails read={read} />
      </div>
      {canReview && (
        <div className="sticky bottom-0 border-t border-border/40 bg-background px-4 py-3">
          <div className="mx-auto w-full max-w-3xl">
            <DecisionButtons reasons={read.exclusion_reasons} disabled={decide.isPending} onDecide={onDecide} />
          </div>
        </div>
      )}
    </div>
  );
}
