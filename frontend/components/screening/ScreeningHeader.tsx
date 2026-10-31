/**
 * The configured tab's thin header, above every state once screening is set
 * up: enrolment and reviewers-per-record chips, the one PubMed import for
 * every member (it stays mounted across tab states), and for a manager an
 * "Enroll {{n}} new" action while articles wait beside enrolled ones.
 */
import {t} from '@/lib/copy';
import type {ScreeningConfigRead} from '@/services/screeningService';

import {EnrollAllButton, PubMedImportButton} from './ScreeningToolbarActions';

function Chip({children}: {children: string}) {
  return (
    <span className="whitespace-nowrap rounded-sm bg-muted px-1.5 py-0.5 text-xs text-foreground">
      {children}
    </span>
  );
}

interface ScreeningHeaderProps {
  projectId: string;
  config: ScreeningConfigRead;
}

export function ScreeningHeader({projectId, config}: ScreeningHeaderProps) {
  const reviewers =
    config.reviewer_count === 1
      ? t('screening', 'summaryReviewerOne')
      : t('screening', 'summaryReviewers').replace('{{n}}', String(config.reviewer_count));

  return (
    <div className="flex min-h-12 flex-wrap items-center gap-2 border-b border-border/40 px-2 py-2 text-[13px]">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        <Chip>{t('screening', 'summaryEnrolled').replace('{{n}}', String(config.enrolled))}</Chip>
        <Chip>{t('screening', 'summaryNotEnrolled').replace('{{n}}', String(config.not_enrolled))}</Chip>
        <Chip>{reviewers}</Chip>
      </div>
      <PubMedImportButton
        projectId={projectId}
        canManage={config.can_manage}
        className="shrink-0"
      />
      {config.can_manage && config.enrolled > 0 && config.not_enrolled > 0 && (
        <EnrollAllButton
          projectId={projectId}
          className="shrink-0"
          label={t('screening', 'enrollNew').replace('{{n}}', String(config.not_enrolled))}
        />
      )}
    </div>
  );
}
