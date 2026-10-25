/**
 * The project's Screening tab. One config read drives a state machine,
 * checked in order: loading → load error → not configured → nothing enrolled
 * → running. Managers act in each state; members get a notice saying who
 * acts. Once configured, one header (with the one PubMed import) sits above
 * both later states, so enrolling never unmounts an open import. While
 * running, `?assignment=<id>` opens that record for
 * any member; otherwise a reviewer gets the queue and an arbitrator the
 * conflicts list (a tab beside the queue when they also review).
 */
import {useState} from 'react';
import {useSearchParams} from 'react-router';

import {ErrorState} from '@/components/patterns/ErrorState';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {useScreeningConfig} from '@/hooks/screening/useScreeningConfig';
import {useScreeningConflicts} from '@/hooks/screening/useScreeningConflicts';
import {t} from '@/lib/copy';
import {screeningErrorMessage} from '@/lib/screening/errors';
import type {ScreeningConfigRead} from '@/services/screeningService';

import {AssignmentView} from './AssignmentView';
import {ConflictsPanel} from './ConflictsPanel';
import {ScreeningConfigForm} from './ScreeningConfigForm';
import {LoadingState, Notice} from './ScreeningParts';
import {EnrollAllButton, ScreeningHeader} from './ScreeningHeader';
import {ScreeningQueue} from './ScreeningQueue';

/** The arbitrator's running view: the conflicts list, beside the queue when they also review. */
function ArbitratorWorkspace({projectId, canReview}: {projectId: string; canReview: boolean}) {
  const [tab, setTab] = useState(canReview ? 'queue' : 'conflicts');
  const conflicts = useScreeningConflicts(projectId, true);
  const count = conflicts.data ? String(conflicts.data.items.length) : '…';
  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList className="mx-4 mt-3 self-start">
        {canReview && <TabsTrigger value="queue">{t('screening', 'tabQueue')}</TabsTrigger>}
        <TabsTrigger value="conflicts">{t('screening', 'tabConflictsCount').replace('{{n}}', count)}</TabsTrigger>
      </TabsList>
      {canReview && (
        <TabsContent value="queue" className="mt-0">
          <ScreeningQueue projectId={projectId} />
        </TabsContent>
      )}
      <TabsContent value="conflicts" className="mt-0">
        <ConflictsPanel projectId={projectId} />
      </TabsContent>
    </Tabs>
  );
}

function NothingEnrolled({projectId, config}: {projectId: string; config: ScreeningConfigRead}) {
  if (!config.can_manage) {
    return <Notice title={t('screening', 'nothingEnrolledTitle')} body={t('screening', 'nothingEnrolledMember')} />;
  }
  const nothingToEnroll = config.not_enrolled === 0;
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium text-foreground">{t('screening', 'nothingEnrolledTitle')}</h2>
        <p className="max-w-sm text-[13px] text-muted-foreground">{t('screening', 'nothingEnrolledManager')}</p>
      </div>
      <EnrollAllButton projectId={projectId} size="default" label={t('screening', 'enrollAll')} disabled={nothingToEnroll} />
      {nothingToEnroll && <p className="text-xs text-muted-foreground">{t('screening', 'nothingToEnroll')}</p>}
    </div>
  );
}

export function ScreeningTab({projectId}: {projectId: string}) {
  const query = useScreeningConfig(projectId);
  const [searchParams, setSearchParams] = useSearchParams();
  const assignmentId = searchParams.get('assignment');
  const closeAssignment = () =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('assignment');
      return next;
    });

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

  const config = query.data;

  if (config.reviewer_count === null) {
    return config.can_manage ? (
      <div className="p-2">
        <ScreeningConfigForm projectId={projectId} config={config} />
      </div>
    ) : (
      <Notice title={t('screening', 'notConfiguredTitle')} body={t('screening', 'notConfiguredMember')} />
    );
  }

  const isViewer = !config.can_review && !config.can_arbitrate;
  return (
    <div className="flex flex-col">
      <ScreeningHeader projectId={projectId} config={config} />
      {config.enrolled === 0 ? (
        <NothingEnrolled projectId={projectId} config={config} />
      ) : assignmentId ? (
        <AssignmentView assignmentId={assignmentId} canReview={config.can_review} onBack={closeAssignment} />
      ) : config.can_arbitrate ? (
        <ArbitratorWorkspace projectId={projectId} canReview={config.can_review} />
      ) : config.can_review ? (
        <ScreeningQueue projectId={projectId} />
      ) : (
        isViewer && (
          <p className="px-4 py-12 text-center text-[13px] text-muted-foreground">{t('screening', 'viewerNotice')}</p>
        )
      )}
    </div>
  );
}
