/**
 * Header AI Actions para Assessment
 *
 * Mostra botão "Avaliar Tudo com IA" + badge de sugestões pendentes
 * Adaptado de extraction/header/HeaderAIActions.tsx
 *
 * @component
 */

import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Tooltip, TooltipContent, TooltipTrigger,} from '@/components/ui/tooltip';
import {Brain, CheckCheck, Loader2, Sparkles} from 'lucide-react';
import {t} from '@/lib/copy';
import type {AIAssessmentSuggestion} from '@/types/assessment';
import type {BatchAssessmentProgress} from '@/hooks/assessment/ai/useBatchAssessment';

interface AssessmentHeaderAIActionsProps {
  suggestions: Record<string, AIAssessmentSuggestion>;
  onBatchAssess: () => void;
  batchLoading: boolean;
  batchProgress: BatchAssessmentProgress | null;
  onBatchAccept?: (threshold: number) => Promise<number>;
}

export function AssessmentHeaderAIActions({
  suggestions,
  onBatchAssess,
  batchLoading,
  batchProgress,
  onBatchAccept,
}: AssessmentHeaderAIActionsProps) {
  const pendingCount = Object.values(suggestions).filter(
    (s) => s.status === 'pending'
  ).length;

  return (
    <div className="flex items-center gap-2">
      {/* Batch Assess Button */}
      <Button
        size="sm"
        variant="outline"
        onClick={onBatchAssess}
        disabled={batchLoading}
        className="gap-2"
      >
        {batchLoading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {batchProgress
              ? `Avaliando ${batchProgress.current} de ${batchProgress.total}`
              : 'Avaliando...'}
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4" />
            Avaliar Tudo com IA
          </>
        )}
      </Button>

      {/* Batch Accept High-Confidence Button */}
      {onBatchAccept && pendingCount > 0 && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => onBatchAccept(0.80)}
          disabled={batchLoading}
          className="gap-2"
        >
          <CheckCheck className="h-4 w-4" />
          Aceitar alta confiança
        </Button>
      )}

      {/* Pending Suggestions Badge */}
      {pendingCount > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className="gap-1.5 text-xs px-2.5 py-0.5 text-primary border-primary/40 bg-primary/5 font-medium"
            >
              <Brain className="h-3 w-3" />
              <span className="tabular-nums">
                {pendingCount > 99 ? '99+' : pendingCount}
              </span>
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            {pendingCount}{' '}
            {pendingCount === 1
                ? t('assessment', 'aiSuggestionPendingSingle')
                : t('assessment', 'aiSuggestionPendingPlural')}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
