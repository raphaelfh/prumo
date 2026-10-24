/**
 * The reviewer's queue: the current record (`items[0]`) with its decision
 * bar pinned below it, so the buttons stay reachable however long the
 * abstract runs. A decision advances at once (the hook removes the record
 * from the cache); the server's refetch settles the counts.
 */
import {useRef, useState} from 'react';
import {Link, useSearchParams} from 'react-router';
import {toast} from 'sonner';

import {ErrorState} from '@/components/patterns/ErrorState';
import {useDecide, useScreeningQueue} from '@/hooks/screening/useScreeningQueue';
import {t} from '@/lib/copy';
import {screeningErrorMessage} from '@/lib/screening/errors';
import type {ScreeningDecisionCreate} from '@/services/screeningService';

import {DecisionButtons} from './DecisionButtons';
import {LoadingState, Notice, RecordBody} from './ScreeningParts';

function ChangeLastLink({assignmentId}: {assignmentId: string}) {
  const [searchParams] = useSearchParams();
  const next = new URLSearchParams(searchParams);
  next.set('assignment', assignmentId);
  return (
    <Link
      to={{search: next.toString()}}
      className="rounded-sm text-[13px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {t('screening', 'changeLast')}
    </Link>
  );
}

export function ScreeningQueue({projectId}: {projectId: string}) {
  const query = useScreeningQueue(projectId, true);
  const decide = useDecide(projectId);
  const [lastDecided, setLastDecided] = useState<string | null>(null);
  // `isPending` reaches the buttons only after a re-render; two keys pressed
  // before it would both decide the same record. This flag flips at once.
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

  const {items, awaiting_me, awaiting_others, exclusion_reasons} = query.data;
  const current = items[0];
  const changeLast = lastDecided && <ChangeLastLink assignmentId={lastDecided} />;

  if (!current) {
    return awaiting_others > 0 ? (
      <Notice
        title={t('screening', 'waitingTitle')}
        body={t('screening', 'waitingBody').replace('{{n}}', String(awaiting_others))}
      >
        {changeLast}
      </Notice>
    ) : (
      <Notice title={t('screening', 'doneTitle')} body={t('screening', 'doneBody')}>
        {changeLast}
      </Notice>
    );
  }

  const onDecide = (body: ScreeningDecisionCreate) => {
    if (inFlight.current) return;
    inFlight.current = true;
    const assignmentId = current.assignment_id;
    decide.mutate(
      {assignmentId, body},
      {
        onSuccess: () => setLastDecided(assignmentId),
        onError: (error) => toast.error(screeningErrorMessage(error)),
        onSettled: () => {
          inFlight.current = false;
        },
      },
    );
  };

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 px-4 pt-3">
        <span className="text-xs text-muted-foreground">
          {t('screening', 'remainingForYou').replace('{{n}}', String(awaiting_me))}
        </span>
        {changeLast}
      </div>
      <div className="mx-auto w-full max-w-3xl px-4 py-4">
        <RecordBody key={current.assignment_id} article={current.article} />
      </div>
      <div className="sticky bottom-0 border-t border-border/40 bg-background px-4 py-3">
        <div className="mx-auto w-full max-w-3xl">
          <DecisionButtons reasons={exclusion_reasons} disabled={decide.isPending} onDecide={onDecide} />
        </div>
      </div>
    </div>
  );
}
