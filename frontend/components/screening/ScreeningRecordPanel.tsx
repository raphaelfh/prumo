/**
 * A screening workspace's side panel: the selected record. No row →
 * the placeholder; a not-enrolled article → its metadata (and "Enroll" for a
 * manager); otherwise the assignment-backed body (`AssignmentView`), keyed by
 * assignment so a record change resets its in-flight and ruling state.
 */
import {toast} from 'sonner';

import {Button} from '@/components/ui/button';
import {useEnrollArticles} from '@/hooks/screening/useScreeningConfig';
import {t} from '@/lib/copy';
import {screeningErrorMessage} from '@/lib/screening/errors';
import type {ScreeningConfigRead, ScreeningPhase, ScreeningRecordRow} from '@/services/screeningService';

import {AssignmentView} from './AssignmentView';
import type {ScreeningCriteria} from './CriteriaPanel';
import {RecordIdentifiers} from './RecordMeta';
import {RecordStatusChip} from './RecordStatusChip';
import {Notice} from './ScreeningParts';

export interface ScreeningRecordPanelProps {
  projectId: string;
  /** `null` → the placeholder. */
  row: ScreeningRecordRow | null;
  config: ScreeningConfigRead;
  phase: ScreeningPhase;
  /** The protocol criteria, shown beside an enrolled record (never on the placeholder or a not-enrolled one). */
  criteria: ScreeningCriteria;
  /** The workspace's controlled shell state: the criteria rail over the disclosure; at full text the PDF beside the pane. */
  maximized: boolean;
  /** After a successful decision (auto-advance and the announcement are the caller's). */
  onDecided: (row: ScreeningRecordRow) => void;
  /** 403/404 on the assignment read, or 404 from decide/arbitrate: the caller clears the selection and toasts. */
  onNotInPhase: () => void;
}

function NotEnrolledBody({projectId, row, canManage}: {projectId: string; row: ScreeningRecordRow; canManage: boolean}) {
  const enroll = useEnrollArticles(projectId);
  const byline = [row.first_author, row.journal_title, row.publication_year]
    .filter((part) => part !== null && part !== '')
    .join(' · ');

  const enrollOne = () =>
    enroll.mutate(
      {article_ids: [row.article_id]},
      {
        onSuccess: (result) =>
          toast.success(t('screening', 'enrolledToast').replace('{{n}}', String(result.enrolled))),
        onError: (error) => toast.error(screeningErrorMessage(error)),
      },
    );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-4">
      <div>
        <RecordStatusChip status={row.status} />
      </div>
      <article className="flex min-w-0 flex-col gap-2">
        <h2 className="text-base font-semibold leading-snug text-foreground">{row.title}</h2>
        {byline && <p className="text-[13px] text-muted-foreground">{byline}</p>}
        <RecordIdentifiers article={row} />
      </article>
      {canManage ? (
        <div>
          <Button size="sm" onClick={enrollOne} disabled={enroll.isPending}>
            {t('screening', 'enrollOne')}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t('screening', 'enrollManagerOnly')}</p>
      )}
    </div>
  );
}

export function ScreeningRecordPanel({
  projectId,
  row,
  config,
  phase,
  criteria,
  maximized,
  onDecided,
  onNotInPhase,
}: ScreeningRecordPanelProps) {
  if (row === null) {
    return <Notice title={t('screening', 'panelPlaceholderTitle')} body={t('screening', 'panelPlaceholderBody')} />;
  }
  if (row.assignment_id === null) {
    return <NotEnrolledBody projectId={projectId} row={row} canManage={config.can_manage} />;
  }
  return (
    <AssignmentView
      key={row.assignment_id}
      assignmentId={row.assignment_id}
      row={row}
      config={config}
      phase={phase}
      criteria={criteria}
      maximized={maximized}
      onDecided={onDecided}
      onNotInPhase={onNotInPhase}
    />
  );
}
