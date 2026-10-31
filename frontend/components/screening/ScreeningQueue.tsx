/**
 * The reviewer's queue: the current record (`items[0]`) with its decision
 * bar pinned below it, so the buttons stay reachable however long the
 * abstract runs. A decision is final and advances at once (the hook removes
 * the record from the cache); the server's refetch settles the counts. When
 * the local list empties while the count says records remain, the next page
 * is loading, never "done".
 */
import {useEffect, useRef, useState} from 'react';
import {toast} from 'sonner';

import {ErrorState} from '@/components/patterns/ErrorState';
import {useDecide} from '@/hooks/screening/useScreeningMutations';
import {useScreeningQueue} from '@/hooks/screening/useScreeningQueue';
import {t} from '@/lib/copy';
import {screeningErrorMessage} from '@/lib/screening/errors';
import type {ScreeningDecisionCreate} from '@/services/screeningService';

import {DecisionButtons} from './DecisionButtons';
import {LoadingState, Notice, RecordBody} from './ScreeningParts';

export function ScreeningQueue({projectId}: {projectId: string}) {
  const query = useScreeningQueue(projectId, true);
  const decide = useDecide(projectId);
  const [decidedOnce, setDecidedOnce] = useState(false);
  // `isPending` reaches the buttons only after a re-render; two keys pressed
  // before it would both decide the same record. This flag flips at once.
  const inFlight = useRef(false);

  // Fast decisions can empty the cached page while more records remain: the
  // decision's settle refetches; if nothing is in flight, refetch once here.
  const drained = query.data !== undefined && query.data.items.length === 0 && query.data.awaiting_me > 0;
  const busy = query.isFetching || decide.isPending;
  const refetchedWhileDrained = useRef(false);
  const {refetch} = query;
  useEffect(() => {
    if (!drained) {
      refetchedWhileDrained.current = false;
      return;
    }
    if (busy || refetchedWhileDrained.current) return;
    refetchedWhileDrained.current = true;
    void refetch();
  }, [drained, busy, refetch]);

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

  if (!current) {
    if (drained) return <LoadingState />;
    return awaiting_others > 0 ? (
      <Notice
        title={t('screening', 'waitingTitle')}
        body={t('screening', 'waitingBody').replace('{{n}}', String(awaiting_others))}
      />
    ) : (
      <Notice title={t('screening', 'doneTitle')} body={t('screening', 'doneBody')} />
    );
  }

  const onDecide = (body: ScreeningDecisionCreate) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setDecidedOnce(true);
    const assignmentId = current.assignment_id;
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
    // `relative`: anchors the sr-only live region, which would otherwise add page scroll.
    <div className="relative flex min-h-0 flex-col">
      <p className="px-4 pt-3 text-xs text-muted-foreground">
        {t('screening', 'remainingForYou').replace('{{n}}', String(awaiting_me))}
      </p>
      <p role="status" aria-live="polite" className="sr-only">
        {decidedOnce ? t('screening', 'nextRecordAnnouncement').replace('{{title}}', current.article.title) : ''}
      </p>
      <div className="mx-auto w-full max-w-3xl px-4 py-4">
        <RecordBody key={current.assignment_id} article={current.article} />
      </div>
      <div className="sticky bottom-0 border-t border-border/40 bg-background px-4 py-3">
        <div className="mx-auto w-full max-w-3xl">
          <DecisionButtons
            key={current.assignment_id}
            reasons={exclusion_reasons}
            disabled={decide.isPending}
            onDecide={onDecide}
            phase="title_abstract"
          />
        </div>
      </div>
    </div>
  );
}
