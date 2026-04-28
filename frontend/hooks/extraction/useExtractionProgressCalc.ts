/**
 * Hook to compute extraction progress
 *
 * Separates progress calculation from useExtractionSetup (SRP).
 */

import {useCallback} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {t} from '@/lib/copy';

export interface ExtractionProgress {
  totalRequiredFields: number;
  completedRequiredFields: number;
  totalOptionalFields: number;
  completedOptionalFields: number;
  progressPercentage: number;
}

interface UseExtractionProgressCalcReturn {
  calculateProgress: (articleId: string, templateId: string) => Promise<ExtractionProgress | null>;
}

/**
 * Hook to compute extraction progress
 */
export function useExtractionProgressCalc(): UseExtractionProgressCalcReturn {
  /**
   * Computes extraction progress for an article
   */
  const calculateProgress = useCallback(async (
    articleId: string,
    templateId: string
  ): Promise<ExtractionProgress | null> => {
    try {
        // 1. Fetch template entity types
      const { data: entityTypes, error: entityTypesError } = await supabase
        .from('extraction_entity_types')
        .select('id')
        .eq('project_template_id', templateId);

      if (entityTypesError) throw entityTypesError;
      if (!entityTypes || entityTypes.length === 0) return null;

      const entityTypeIds = entityTypes.map(et => et.id);

        // 2. Fetch required and optional fields
      const { data: fields, error: fieldsError } = await supabase
        .from('extraction_fields')
        .select('id, is_required')
        .in('entity_type_id', entityTypeIds);

      if (fieldsError) throw fieldsError;
      if (!fields) return null;

      const requiredFields = fields.filter(f => f.is_required);
      const optionalFields = fields.filter(f => !f.is_required);

        // 3. Fetch article instances
      const { data: instances, error: instancesError } = await supabase
        .from('extraction_instances')
        .select('id')
        .eq('article_id', articleId)
        .eq('template_id', templateId);

      if (instancesError) throw instancesError;
      if (!instances || instances.length === 0) {
        return {
          totalRequiredFields: requiredFields.length,
          completedRequiredFields: 0,
          totalOptionalFields: optionalFields.length,
          completedOptionalFields: 0,
          progressPercentage: 0,
        };
      }

      const instanceIds = instances.map(i => i.id);

        // 4. Count filled values via reviewer_states (latest non-reject
        //    decision per reviewer × item). Any (instance, field) that any
        //    reviewer has a non-reject decision for counts as "completed".
      const { data: states, error: statesError } = await supabase
        .from('extraction_reviewer_states')
        .select('field_id, instance_id, current_decision_id, reviewer_decision:current_decision_id(decision)')
        .in('instance_id', instanceIds);

      if (statesError) throw statesError;

      const completedFieldIds = new Set(
        (states || [])
          .filter((s: { current_decision_id: string | null; reviewer_decision: { decision: string } | { decision: string }[] | null }) => {
            if (!s.current_decision_id) return false;
            const dec = Array.isArray(s.reviewer_decision)
              ? s.reviewer_decision[0]
              : s.reviewer_decision;
            return dec && dec.decision !== 'reject';
          })
          .map((s: { field_id: string }) => s.field_id),
      );

      const completedRequired = requiredFields.filter(f => completedFieldIds.has(f.id)).length;
      const completedOptional = optionalFields.filter(f => completedFieldIds.has(f.id)).length;

      const totalFields = requiredFields.length + optionalFields.length;
      const completedFields = completedRequired + completedOptional;
      const progressPercentage = totalFields > 0
        ? Math.round((completedFields / totalFields) * 100)
        : 0;

      return {
        totalRequiredFields: requiredFields.length,
        completedRequiredFields: completedRequired,
        totalOptionalFields: optionalFields.length,
        completedOptionalFields: completedOptional,
        progressPercentage,
      };

    } catch (err: unknown) {
        const _message = err instanceof Error ? err.message : t('extraction', 'errorCalculatingProgress');
        console.error('Error calculating extraction progress:', err);
      return null;
    }
  }, []);

  return {
    calculateProgress,
  };
}

