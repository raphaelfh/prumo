/**
 * Hook to compute assessment progress
 *
 * Computes how many required items were answered
 * and returns completion percentage.
 *
 * Based on useExtractionProgress.ts (DRY + KISS)
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
 * Hook to compute assessment progress
 *
 * @param responses - Assessment responses { itemId: response }
 * @param items - Instrument items list
 * @returns Assessment progress (completed items, total, percentage, isComplete)
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
