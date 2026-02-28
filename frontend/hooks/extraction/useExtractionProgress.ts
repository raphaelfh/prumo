/**
 * Hook para calcular progresso da extração
 * 
 * Calcula quantos campos obrigatórios foram preenchidos
 * e retorna porcentagem de completude.
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
    // Coletar todos os campos obrigatórios
    const requiredFields: Array<{ fieldId: string; instanceIds: string[] }> = [];

    entityTypes.forEach(entityType => {
      entityType.fields
        .filter(field => field.is_required)
        .forEach(field => {
          requiredFields.push({
            fieldId: field.id,
            instanceIds: [] // Será preenchido com instâncias reais
          });
        });
    });

    const totalRequired = requiredFields.length;

    // Contar campos preenchidos
    const completedRequired = requiredFields.filter(({ fieldId }) => {
      // Verificar se há pelo menos uma instância com valor para este campo
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

