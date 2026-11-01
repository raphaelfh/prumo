/**
 * The record panel's body for an enrolled record: the assignment read decides
 * what the caller may do. A reviewer the record awaits decides here; an
 * unseated arbitrator rules a conflict here; on a solo record the caller's own
 * decision stays changeable (the recorded-choice ring). Everything else is
 * read-only and renders `peer_decisions` and `outcome` exactly as the API
 * returns them (blindness is the server's). The status chip is the records
 * row's server-computed status, never re-derived here.
 */
import {useEffect, useRef, type ReactNode} from 'react';
import {toast} from 'sonner';

import {ErrorState} from '@/components/patterns/ErrorState';
import {useScreeningAssignment} from '@/hooks/screening/useScreeningAssignment';
import {useArbitrate, useDecide} from '@/hooks/screening/useScreeningMutations';
import {ApiError} from '@/integrations/api/client';
import {t} from '@/lib/copy';
import {screeningErrorMessage} from '@/lib/screening/errors';
import type {
  ScreeningArbitrationCreate,
  ScreeningAssignmentRead,
  ScreeningConfigRead,
  ScreeningDecisionCreate,
  ScreeningRecordRow,
} from '@/services/screeningService';

import {ConflictRulingForm} from './ConflictRulingForm';
import {DecisionButtons} from './DecisionButtons';
import {RecordStatusChip} from './RecordStatusChip';
import {decisionLabel, LoadingState, RecordBody} from './ScreeningParts';

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

/** The record is gone from this phase for the caller (deleted, moved, or refused). */
function isNotInPhase(error: unknown, statuses: readonly number[]): boolean {
  return error instanceof ApiError && statuses.includes(error.status);
}

interface AssignmentViewProps {
  assignmentId: string;
  row: ScreeningRecordRow;
  config: ScreeningConfigRead;
  onDecided: (row: ScreeningRecordRow) => void;
  onNotInPhase: () => void;
}

export function AssignmentView({assignmentId, row, config, onDecided, onNotInPhase}: AssignmentViewProps) {
  const query = useScreeningAssignment(assignmentId);
  const projectId = query.data?.project_id ?? '';
  const decide = useDecide(projectId);
  const arbitrate = useArbitrate(projectId);
  // `isPending` reaches the buttons only after a re-render; two keys pressed
  // before it would both post. This flag flips at once.
  const inFlight = useRef(false);
  const readGone = query.isError && isNotInPhase(query.error, [403, 404]);

  useEffect(() => {
    if (readGone) onNotInPhase();
  }, [readGone, onNotInPhase]);

  if (query.isPending || readGone) return <LoadingState />;
  if (query.isError) {
    return (
      <ErrorState
        title={t('screening', 'loadErrorTitle')}
        message={screeningErrorMessage(query.error)}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const read = query.data;
  const busy = decide.isPending || arbitrate.isPending;
  const onWriteError = (error: Error) => {
    if (isNotInPhase(error, [404])) onNotInPhase();
    else toast.error(screeningErrorMessage(error));
  };
  const release = () => {
    inFlight.current = false;
  };

  const solo =
    config.can_review && config.reviewer_count === 1 && read.my_decision !== null && read.outcome?.kind === 'solo';
  const canDecide = solo || (config.can_review && read.status === 'awaiting_me');
  const canRule = config.can_arbitrate && read.status === 'conflict';

  const onDecide = (body: ScreeningDecisionCreate) => {
    if (inFlight.current) return;
    inFlight.current = true;
    decide.mutate(
      {assignmentId, body},
      {
        onSuccess: () => {
          if (solo) toast.success(t('screening', 'changedTo').replace('{{decision}}', decisionLabel(body.decision)));
          onDecided(row);
        },
        onError: onWriteError,
        onSettled: release,
      },
    );
  };

  const onRule = (body: ScreeningArbitrationCreate) => {
    if (inFlight.current) return;
    inFlight.current = true;
    arbitrate.mutate(
      {assignmentId, body},
      {
        onSuccess: () => toast.success(t('screening', 'rulingSaved')),
        onError: onWriteError,
        onSettled: release,
      },
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-4">
          <div>
            <RecordStatusChip status={row.status} arbitrated={row.outcome_kind === 'arbitrated'} />
          </div>
          {canDecide ? (
            <RecordBody article={read.article} />
          ) : canRule ? (
            <div className="flex flex-col gap-4">
              <RecordBody article={read.article} />
              <Section title={t('screening', 'peerDecisionsTitle')}>
                <ConflictRulingForm read={read} busy={busy} onRule={onRule} />
              </Section>
            </div>
          ) : (
            <AssignmentDetails read={read} />
          )}
        </div>
      </div>
      {canDecide && (
        <div className="shrink-0 border-t border-border/40 bg-background px-4 py-3">
          <div className="mx-auto w-full max-w-3xl">
            <DecisionButtons
              reasons={read.exclusion_reasons}
              disabled={busy}
              onDecide={onDecide}
              phase="title_abstract"
              recorded={solo ? read.my_decision?.decision : null}
              recordedReason={solo ? read.my_decision?.exclusion_reason : null}
            />
          </div>
        </div>
      )}
    </div>
  );
}
