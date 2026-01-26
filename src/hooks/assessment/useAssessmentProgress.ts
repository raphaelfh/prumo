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

import { useMemo } from 'react';
import type { AssessmentItem, AssessmentResponse } from '@/types/assessment';

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
    // Filtrar apenas itens obrigatórios
    const requiredItems = items.filter(item => item.is_required);
    const totalRequired = requiredItems.length;

    // Se não há itens obrigatórios, retornar 100% completo
    if (totalRequired === 0) {
      return {
        completedItems: 0,
        totalItems: 0,
        completionPercentage: 100,
        isComplete: true,
      };
    }

    // Contar itens obrigatórios que foram respondidos
    const completedRequired = requiredItems.filter(item => {
      const response = responses[item.id];

      // Considera completo se:
      // 1. Response existe
      // 2. Tem um level selecionado
      // 3. Level não é vazio
      return (
        response &&
        response.selected_level &&
        response.selected_level.trim() !== ''
      );
    }).length;

    const percentage =
      totalRequired > 0
        ? Math.round((completedRequired / totalRequired) * 100)
        : 0;

    return {
      completedItems: completedRequired,
      totalItems: totalRequired,
      completionPercentage: percentage,
      isComplete: percentage === 100,
    };
  }, [responses, items]);
}
