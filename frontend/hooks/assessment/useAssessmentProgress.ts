/**
 * Hook para calcular progresso da avaliação (assessment)
 *
 * Calcula quantos itens obrigatórios foram respondidos
 * e retorna porcentagem de completude.
 *
 * Baseado em useExtractionProgress.ts (DRY + KISS)
 *
 * @hook
 */

import {useMemo} from 'react';
import type {AssessmentItem, AssessmentResponse} from '@/types/assessment';
import {calculateAssessmentProgress} from '@/lib/assessment-utils';

// =================== INTERFACES ===================

export interface UseAssessmentProgressReturn {
  completedItems: number;
  totalItems: number;
  completionPercentage: number;
  isComplete: boolean;
}

// =================== HOOK ===================

/**
 * Hook para calcular progresso da avaliação
 *
 * @param responses - Respostas do assessment { itemId: response }
 * @param items - Lista de items do instrumento
 * @returns Progresso da avaliação (items completados, total, porcentagem, isComplete)
 *
 * @example
 * ```tsx
 * const { completionPercentage, isComplete } = useAssessmentProgress(
 *   responses,
 *   items
 * );
 * ```
 */
export function useAssessmentProgress(
  responses: Record<string, AssessmentResponse>,
  items: AssessmentItem[]
): UseAssessmentProgressReturn {
  return useMemo(() => {
    const progress = calculateAssessmentProgress(items, responses);
    return {
      completedItems: progress.completedRequired,
      totalItems: progress.totalRequired,
      completionPercentage: progress.progressPercentage,
      isComplete: progress.isComplete,
    };
  }, [responses, items]);
}
