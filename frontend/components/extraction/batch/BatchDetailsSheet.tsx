/**
 * Details sheet for one AI batch run (spec 2026-09-15 §11.6). Opened from
 * the notification bell or the selection bar's "View" action.
 */
import {useState} from 'react';
import type {ReactElement} from 'react';
import {Link} from 'react-router';

import {Button} from '@/components/ui/button';
import {Sheet, SheetContent, SheetHeader, SheetTitle} from '@/components/ui/sheet';
import {useBatchDetail, useCancelBatch, useResumeBatch} from '@/hooks/extraction/useExtractionBatches';
import {extractionErrorToast} from '@/lib/ai-extraction/extractionErrorToast';
import {t} from '@/lib/copy';
import type {ExtractionBatchDetail, ExtractionBatchItem} from '@/types/extraction-batch';

import {RunAIBatchDialog} from './RunAIBatchDialog';

interface BatchDetailsSheetProps {
  batchId: string | null;
  onOpenChange: (open: boolean) => void;
}

type Group = 'needs_attention' | 'skipped' | 'not_run' | 'done';

const GROUP_ORDER: Group[] = ['needs_attention', 'skipped', 'not_run', 'done'];

const GROUP_TITLE_KEY = {
  needs_attention: 'sheetGroupNeedsAttention',
  skipped: 'sheetGroupSkipped',
  not_run: 'sheetGroupNotRun',
  done: 'sheetGroupDone',
} as const satisfies Record<Group, string>;

function groupFor(outcome: ExtractionBatchItem['outcome']): Group | null {
  switch (outcome) {
    case 'needs_attention':
      return 'needs_attention';
    case 'skipped':
      return 'skipped';
    case 'not_run':
      return 'not_run';
    case 'done':
    case 'done_with_issues':
      return 'done';
    default:
      return null;
  }
}

// Backend reason codes (extraction_batch_dispatcher.py / extraction_batch_view.py /
// extraction_batch_service.py) mapped to their `aiBatch` copy key. A code not
// mapped here, or not mapped by `extractionErrorToast`, falls back to `reasonUnknown`
// — never a raw code.
const REASON_COPY_KEY: Record<string, string> = {
  RUN_FINALIZED: 'reasonRunFinalized',
  RUN_NOT_EDITABLE: 'reasonRunNotEditable',
  ALREADY_HAS_AI_SUGGESTIONS: 'reasonAlreadyHasAiSuggestions',
  AI_ALREADY_RUNNING: 'reasonAiAlreadyRunning',
  NO_LONGER_AVAILABLE: 'reasonNoLongerAvailable',
  CANCELLED: 'reasonCancelled',
  STOPPED_ENGINE_ERROR: 'reasonStoppedEngineError',
  PDF_NOT_FOUND: 'reasonPdfNotFound',
  EXTRACTION_FAILED: 'reasonExtractionFailed',
};

function reasonLine(item: ExtractionBatchItem): string | null {
  if (item.outcome === 'done_with_issues' && item.failed_sections != null && item.total_sections != null) {
    return t('aiBatch', 'reasonSectionsFailed')
      .replace('{{failed}}', String(item.failed_sections))
      .replace('{{total}}', String(item.total_sections));
  }
  if (item.reason_code == null) return null;
  const mapped = extractionErrorToast(item.reason_code, item.message ?? '');
  if (mapped) return mapped.title;
  const copyKey = REASON_COPY_KEY[item.reason_code];
  if (copyKey === 'reasonRunFinalized') return t('aiBatch', 'reasonRunFinalized');
  if (copyKey === 'reasonRunNotEditable') return t('aiBatch', 'reasonRunNotEditable');
  if (copyKey === 'reasonAlreadyHasAiSuggestions') return t('aiBatch', 'reasonAlreadyHasAiSuggestions');
  if (copyKey === 'reasonAiAlreadyRunning') return t('aiBatch', 'reasonAiAlreadyRunning');
  if (copyKey === 'reasonNoLongerAvailable') return t('aiBatch', 'reasonNoLongerAvailable');
  if (copyKey === 'reasonCancelled') return t('aiBatch', 'reasonCancelled');
  if (copyKey === 'reasonStoppedEngineError') return t('aiBatch', 'reasonStoppedEngineError');
  if (copyKey === 'reasonPdfNotFound') return t('aiBatch', 'reasonPdfNotFound');
  if (copyKey === 'reasonExtractionFailed') return t('aiBatch', 'reasonExtractionFailed');
  return t('aiBatch', 'reasonUnknown');
}

function articleHref(item: ExtractionBatchItem, detail: ExtractionBatchDetail): string {
  return detail.kind === 'extraction'
    ? `/projects/${detail.project_id}/extraction/${item.article_id}`
    : `/projects/${detail.project_id}/articles/${item.article_id}/quality-assessment/${detail.template_id}`;
}

export function BatchDetailsSheet({batchId, onOpenChange}: BatchDetailsSheetProps): ReactElement {
  const {data: detail} = useBatchDetail(batchId);
  const cancelBatch = useCancelBatch();
  const resumeBatch = useResumeBatch();
  const [runDialog, setRunDialog] = useState<{articleIds: string[]} | null>(null);

  const items = detail?.items ?? [];
  const groups = new Map<Group, ExtractionBatchItem[]>();
  for (const item of items) {
    const group = groupFor(item.outcome);
    if (!group) continue;
    const list = groups.get(group) ?? [];
    list.push(item);
    groups.set(group, list);
  }

  const failedIds = items.filter((item) => item.outcome === 'needs_attention').map((item) => item.article_id);
  const notRunIds = items.filter((item) => item.outcome === 'not_run').map((item) => item.article_id);

  const isActive = detail?.state === 'active';
  const isStalled = detail?.stalled === true;

  return (
    <Sheet open={batchId !== null} onOpenChange={onOpenChange}>
      <SheetContent size="default">
        <SheetHeader>
          <SheetTitle>{t('aiBatch', 'sheetTitle')}</SheetTitle>
        </SheetHeader>
        {detail && (
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
            <p className="text-[13px] text-muted-foreground">
              {t('aiBatch', 'bellProgress')
                .replace('{{done}}', String(detail.counts.done + detail.counts.done_with_issues))
                .replace('{{total}}', String(detail.counts.total))}
            </p>
            {GROUP_ORDER.map((group) => {
              const groupItems = groups.get(group);
              if (!groupItems || groupItems.length === 0) return null;
              return (
                <section key={group} className="space-y-2">
                  <h3 className="text-[13px] font-medium text-foreground">{t('aiBatch', GROUP_TITLE_KEY[group])}</h3>
                  <ul className="space-y-2">
                    {groupItems.map((item) => (
                      <li key={item.article_id} className="space-y-0.5 rounded-md border border-border/40 p-2">
                        <p className="text-[13px] font-medium text-foreground">
                          {item.title || t('aiBatch', 'sheetUntitled')}
                        </p>
                        {reasonLine(item) && (
                          <p className="text-[12px] text-muted-foreground">{reasonLine(item)}</p>
                        )}
                        <Link
                          to={articleHref(item, detail)}
                          className="text-[12px] text-info hover:underline"
                        >
                          {t('aiBatch', 'sheetOpenArticle')}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
        {detail && (isActive || isStalled || failedIds.length > 0 || notRunIds.length > 0) && (
          <div className="flex flex-wrap gap-2 border-t border-border/40 px-4 py-3">
            {isActive && (
              <Button
                variant="outline"
                size="sm"
                disabled={cancelBatch.isPending}
                onClick={() => cancelBatch.mutate(detail.id)}
              >
                {t('aiBatch', 'sheetCancel')}
              </Button>
            )}
            {isStalled && (
              <Button
                variant="outline"
                size="sm"
                disabled={resumeBatch.isPending}
                onClick={() => resumeBatch.mutate(detail.id)}
              >
                {t('aiBatch', 'sheetResume')}
              </Button>
            )}
            {failedIds.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => setRunDialog({articleIds: failedIds})}>
                {t('aiBatch', 'sheetRetryFailed')}
              </Button>
            )}
            {notRunIds.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => setRunDialog({articleIds: notRunIds})}>
                {t('aiBatch', 'sheetRunRemaining')}
              </Button>
            )}
          </div>
        )}
        {detail && (
          <RunAIBatchDialog
            open={runDialog !== null}
            onOpenChange={(open) => !open && setRunDialog(null)}
            projectId={detail.project_id}
            templateId={detail.template_id}
            articleIds={runDialog?.articleIds ?? []}
            defaultSkipExisting={false}
            onStarted={() => setRunDialog(null)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
