/**
 * Confirm dialog for starting an AI batch run (spec 2026-09-15 §10 F1/F3/F4,
 * §11.3). The engine line reuses EngineGear's own label helper rather than
 * duplicating the catalogue/effective-engine logic; if the read is not
 * available yet (pending or errored) the line is simply omitted.
 */
import {useState} from 'react';
import type {MouseEvent, ReactElement} from 'react';
import {toast} from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {Checkbox} from '@/components/ui/checkbox';
import {engineLabel} from '@/components/extraction/EngineGear';
import {ApiError} from '@/integrations/api/client';
import {useStartBatch} from '@/hooks/extraction/useExtractionBatches';
import {useLlmEngine} from '@/hooks/extraction/useLlmEngine';
import {t} from '@/lib/copy';
import type {ExtractionBatchDetail} from '@/types/extraction-batch';

interface RunAIBatchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  templateId: string;
  articleIds: string[];
  /** §10: Retry failed / Run remaining reopen with the skip option off. */
  defaultSkipExisting?: boolean;
  onStarted: (batch: ExtractionBatchDetail) => void;
}

const ENGINE_PROBLEM_CODES = new Set([
  'LLM_ENGINE_RETIRED',
  'MISSING_API_KEY',
  'LLM_ENDPOINT_UNAVAILABLE',
]);

function startFailedToast(error: unknown): void {
  if (error instanceof ApiError) {
    if (ENGINE_PROBLEM_CODES.has(error.code)) {
      toast.error(t('aiBatch', 'startEngineProblemTitle'));
      return;
    }
    if (error.code === 'SERVICE_UNAVAILABLE' || error.status === 503) {
      toast.error(t('aiBatch', 'startQueueDownTitle'), {
        description: t('aiBatch', 'startQueueDownDescription'),
      });
      return;
    }
    if (error.code === 'AI_BATCH_ALREADY_ACTIVE') {
      toast.error(t('aiBatch', 'startAlreadyActiveTitle'));
      return;
    }
    toast.error(t('aiBatch', 'startFailedTitle'), {description: error.message});
    return;
  }
  toast.error(t('aiBatch', 'startFailedTitle'), {
    description: error instanceof Error ? error.message : String(error),
  });
}

export function RunAIBatchDialog({
  open,
  onOpenChange,
  projectId,
  templateId,
  articleIds,
  defaultSkipExisting,
  onStarted,
}: RunAIBatchDialogProps): ReactElement {
  const [skipExisting, setSkipExisting] = useState(defaultSkipExisting ?? true);
  const engine = useLlmEngine(projectId);
  const startBatch = useStartBatch();

  const n = articleIds.length;
  const title =
    n === 1 ? t('aiBatch', 'confirmTitleOne') : t('aiBatch', 'confirmTitle').replace('{{n}}', String(n));

  const confirm = (event: MouseEvent) => {
    // AlertDialogAction auto-dismisses on click; the mutation is async and
    // must be able to keep the dialog open on error, so take over closing.
    event.preventDefault();
    startBatch.mutate(
      {
        project_id: projectId,
        template_id: templateId,
        article_ids: articleIds,
        skip_articles_with_ai_suggestions: skipExisting,
      },
      {
        onSuccess: (batch) => {
          onOpenChange(false);
          onStarted(batch);
          toast.success(
            n === 1
              ? t('aiBatch', 'startedToastOne')
              : t('aiBatch', 'startedToast').replace('{{n}}', String(n)),
            {action: {label: t('aiBatch', 'view'), onClick: () => onStarted(batch)}},
          );
        },
        onError: startFailedToast,
      },
    );
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-[13px]">
              {engine.data && (
                <p>{t('aiBatch', 'confirmEngineLine').replace('{{engine}}', engineLabel(engine.data))}</p>
              )}
              <p>{t('aiBatch', 'confirmKeepsHumanAnswers')}</p>
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={skipExisting}
                  onCheckedChange={(checked) => setSkipExisting(checked === true)}
                />
                {t('aiBatch', 'confirmSkipLabel')}
              </label>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('aiBatch', 'confirmCancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={confirm} disabled={startBatch.isPending}>
            {t('aiBatch', 'confirmRun')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
