/**
 * Hook to compute extraction progress
 *
 * Computes how many required fields were filled and returns completion percentage.
 *
 * @hook
 */

import {useMemo} from 'react';
import type {ExtractionField} from '@/types/extraction';

// =================== INTERFACES ===================

interface EntityTypeWithFields {
  id: string;
  fields: ExtractionField[];
}

export interface UseExtractionProgressReturn {
  completedFields: number;
  totalFields: number;
  completionPercentage: number;
  isComplete: boolean;
}

// =================== HOOK ===================

export function useExtractionProgress(
  values: Record<string, any>,
  entityTypes: EntityTypeWithFields[]
): UseExtractionProgressReturn {
  
  return useMemo(() => {
      // Collect all required fields
    const requiredFields: Array<{ fieldId: string; instanceIds: string[] }> = [];

    entityTypes.forEach(entityType => {
      entityType.fields
        .filter(field => field.is_required)
        .forEach(field => {
          requiredFields.push({
            fieldId: field.id,
              instanceIds: [] // Will be filled with real instances
          });
        });
    });

    const totalRequired = requiredFields.length;

    // Contar campos preenchidos
    const completedRequired = requiredFields.filter(({ fieldId }) => {
        // Check if at least one instance has a value for this field
      const hasValue = Object.keys(values).some(key => {
        const [, fId] = key.split('_');
        return fId === fieldId && values[key] !== null && values[key] !== undefined && values[key] !== '';
      });
      return hasValue;
    }).length;

    const percentage = totalRequired > 0
      ? Math.round((completedRequired / totalRequired) * 100)
      : 0;

    return {
      completedFields: completedRequired,
      totalFields: totalRequired,
      completionPercentage: percentage,
      isComplete: percentage === 100
    };
  }, [values, entityTypes]);
}

