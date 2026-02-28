/**
 * Hook para Avaliação em Batch com IA
 *
 * Orquestra a avaliação de múltiplos items de assessment em uma única operação.
 * Filtra items já aceitos, chama o backend, e refresha sugestões.
 *
 * Baseado em useFullAIExtraction.ts (DRY + KISS)
 *
 * @hook
 */

import {useCallback, useState} from 'react';
import {toast} from 'sonner';
import {AssessmentService} from '@/services/assessmentService';
import type {AssessmentItem, AssessmentResponse} from '@/types/assessment';

// =================== TYPES ===================

export interface BatchAssessmentProgress {
  current: number;
  total: number;
  stage: 'assessing';
}

interface BatchAssessParams {
  projectId: string;
  articleId: string;
  instrumentId: string;
  items: AssessmentItem[];
  existingResponses: Record<string, AssessmentResponse>;
}

export interface UseBatchAssessmentReturn {
  assessBatch: (params: BatchAssessParams) => Promise<void>;
  loading: boolean;
  error: string | null;
  progress: BatchAssessmentProgress | null;
}

// =================== HOOK ===================

export function useBatchAssessment(options?: {
  onComplete?: () => Promise<void>;
}): UseBatchAssessmentReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<BatchAssessmentProgress | null>(null);

  const assessBatch = useCallback(
    async (params: BatchAssessParams) => {
      const { projectId, articleId, instrumentId, items, existingResponses } = params;

      // Filter out items that already have accepted responses
      const itemsToAssess = items.filter((item) => {
        const response = existingResponses[item.id];
        return !response || !response.selected_level;
      });

      if (itemsToAssess.length === 0) {
        toast.info('Todos os items já possuem respostas. Nenhuma avaliação necessária.');
        return;
      }

      setLoading(true);
      setError(null);
      setProgress({
        current: 0,
        total: itemsToAssess.length,
        stage: 'assessing',
      });

      try {
        console.log('🤖 [useBatchAssessment] Iniciando batch:', {
          totalItems: items.length,
          itemsToAssess: itemsToAssess.length,
          skipped: items.length - itemsToAssess.length,
        });

        const result = await AssessmentService.assessBatch({
          projectId,
          articleId,
          instrumentId,
          itemIds: itemsToAssess.map((item) => item.id),
          model: 'gpt-4o-mini',
        });

        if (!result.ok || !result.data) {
          throw new Error(result.error?.message || 'Erro ao avaliar em batch');
        }

        setProgress({
          current: result.data.successfulItems,
          total: result.data.totalItems,
          stage: 'assessing',
        });

        const failed = result.data.totalItems - result.data.successfulItems;
        if (failed > 0) {
          toast.warning(
            `Avaliação em lote concluída com ${failed} falha(s)`,
            {
              description: `${result.data.successfulItems} de ${result.data.totalItems} items avaliados com sucesso`,
              duration: 6000,
            }
          );
        } else {
          toast.success(
            `Avaliação em lote concluída! ${result.data.successfulItems} sugestões criadas`,
            { duration: 5000 }
          );
        }

        // Execute onComplete callback (triggers suggestion refresh)
        if (options?.onComplete) {
          await options.onComplete();
        }

        setProgress(null);
      } catch (err) {
        console.error('❌ [useBatchAssessment] Erro:', err);
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        toast.error('Erro na avaliação em lote', {
          description: message,
          duration: 6000,
        });
        setProgress(null);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [options]
  );

  return { assessBatch, loading, error, progress };
}
