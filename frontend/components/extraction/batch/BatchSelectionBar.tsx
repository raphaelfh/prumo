/**
 * Shared selection bar for AI batch runs (spec 2026-09-15 §11.2). Mirrors the
 * markup ArticleExtractionTable's own selected-count block uses so both
 * lists read as one system. Owns the RunAIBatchDialog open state — the
 * caller only wires selection and the active-batch chip.
 */
import {useState} from 'react';
import type {ReactElement} from 'react';
import {Sparkles} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {useProjectMemberRole} from '@/hooks/useProjectMemberRole';
import {t} from '@/lib/copy';
import type {ExtractionBatchSummary} from '@/types/extraction-batch';

import {RunAIBatchDialog} from './RunAIBatchDialog';

export const MAX_BATCH_ARTICLES = 100;

interface BatchSelectionBarProps {
  projectId: string;
  templateId: string;
  selectedIds: Set<string>;
  onClear: () => void;
  activeBatch: ExtractionBatchSummary | null;
  onViewBatch: (batchId: string) => void;
}

export function BatchSelectionBar({
  projectId,
  templateId,
  selectedIds,
  onClear,
  activeBatch,
  onViewBatch,
}: BatchSelectionBarProps): ReactElement | null {
  const [dialogOpen, setDialogOpen] = useState(false);
  const {role, loading} = useProjectMemberRole(projectId);
  const selectedCount = selectedIds.size;

  if (selectedCount === 0) return null;

  const canRunAI = !loading && role !== null && role !== 'viewer';
  const tooMany = selectedCount > MAX_BATCH_ARTICLES;

  return (
    <div className="flex items-center gap-2 animate-in fade-in duration-200">
      <span className="text-[11px] font-medium text-foreground tabular-nums">
        {t('aiBatch', 'selectedCount').replace('{{n}}', String(selectedCount))}
      </span>
      {activeBatch ? (
        <>
          <span className="text-[12px] text-muted-foreground">
            {t('aiBatch', 'batchRunningChip')
              .replace('{{done}}', String(activeBatch.counts.done + activeBatch.counts.done_with_issues))
              .replace('{{total}}', String(activeBatch.counts.total))}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-[12px]"
            onClick={() => onViewBatch(activeBatch.id)}
          >
            {t('aiBatch', 'view')}
          </Button>
        </>
      ) : (
        canRunAI && (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-[12px]"
            disabled={tooMany}
            title={tooMany ? t('aiBatch', 'tooManySelected') : undefined}
            onClick={() => setDialogOpen(true)}
          >
            <Sparkles className="h-4 w-4" />
            {t('aiBatch', 'runAI')}
          </Button>
        )
      )}
      <Button variant="ghost" size="sm" className="gap-1.5 text-[12px]" onClick={onClear}>
        {t('aiBatch', 'clearSelection')}
      </Button>
      <RunAIBatchDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        projectId={projectId}
        templateId={templateId}
        articleIds={Array.from(selectedIds)}
        onStarted={() => setDialogOpen(false)}
        onViewBatch={onViewBatch}
      />
    </div>
  );
}
