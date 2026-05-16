/**
 * Hook to compute extraction progress
 *
 * Separates progress calculation from useExtractionSetup (SRP).
 */

import {useCallback} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {t} from '@/lib/copy';
import {ExtractionValueService} from '@/services/extractionValueService';

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
        // 1. Fetch template entity types (with cardinality to size the
        //    denominator correctly for multi-instance entity types).
      const { data: entityTypes, error: entityTypesError } = await supabase
        .from('extraction_entity_types')
        .select('id')
        .eq('project_template_id', templateId);

      if (entityTypesError) throw entityTypesError;
      if (!entityTypes || entityTypes.length === 0) return null;

      const entityTypeIds = entityTypes.map(et => et.id);

        // 2. Fetch required and optional fields, keyed back to entity type
        //    so we can multiply by per-entity instance count.
      const { data: fields, error: fieldsError } = await supabase
        .from('extraction_fields')
        .select('id, is_required, entity_type_id')
        .in('entity_type_id', entityTypeIds);

      if (fieldsError) throw fieldsError;
      if (!fields) return null;

      const requiredFields = fields.filter(f => f.is_required);
      const optionalFields = fields.filter(f => !f.is_required);

        // 3. Fetch article instances with their entity_type_id so we
        //    can compute (instance × field) totals and not just unique
        //    field counts (#52).
      const { data: instances, error: instancesError } = await supabase
        .from('extraction_instances')
        .select('id, entity_type_id')
        .eq('article_id', articleId)
        .eq('template_id', templateId);

      if (instancesError) throw instancesError;

      // Count instances per entity_type so we can compute
      // (instance count × required field count) per entity type.
      const instanceCountByEntityType = new Map<string, number>();
      const instanceIds: string[] = [];
      for (const inst of instances ?? []) {
        instanceIds.push(inst.id);
        instanceCountByEntityType.set(
          inst.entity_type_id,
          (instanceCountByEntityType.get(inst.entity_type_id) ?? 0) + 1,
        );
      }

      const totalForFields = (subset: typeof fields): number => {
        let total = 0;
        for (const f of subset) {
          // Entity types with zero instances still contribute 1 slot
          // so the field shows up in the denominator (matches the
          // local-state hook in useExtractionProgress).
          const count = instanceCountByEntityType.get(f.entity_type_id) ?? 1;
          total += count;
        }
        return total;
      };

      const totalRequiredPairs = totalForFields(requiredFields);
      const totalOptionalPairs = totalForFields(optionalFields);

      if (instanceIds.length === 0) {
        const totalPairs = totalRequiredPairs + totalOptionalPairs;
        return {
          totalRequiredFields: totalRequiredPairs,
          completedRequiredFields: 0,
          totalOptionalFields: totalOptionalPairs,
          completedOptionalFields: 0,
          progressPercentage: totalPairs > 0 ? 0 : 0,
        };
      }

        // 4. Resolve the active run for this (article × template). The
        //    previous implementation queried reviewer_states with only an
        //    instance_id filter, leaking decisions from finalized/old
        //    runs into the current progress percentage (#48/#77). Scope
        //    explicitly to the active run; fall back to the latest
        //    finalized run when nothing is in flight so a freshly
        //    completed article still shows its progress.
      const activeRun = await ExtractionValueService.findActiveRun(
        articleId,
        templateId,
      );
      const finalRun =
        activeRun ??
        (await ExtractionValueService.findLatestFinalizedRun(
          articleId,
          templateId,
        ));
      if (!finalRun) {
        const totalPairs = totalRequiredPairs + totalOptionalPairs;
        return {
          totalRequiredFields: totalRequiredPairs,
          completedRequiredFields: 0,
          totalOptionalFields: totalOptionalPairs,
          completedOptionalFields: 0,
          progressPercentage: totalPairs > 0 ? 0 : 0,
        };
      }

        // 5. Count filled values via reviewer_states, scoped to the
        //    resolved run. Dedupe by (instance_id, field_id) — the
        //    previous implementation deduped by field_id only, so a
        //    single filled instance of a cardinality='many' entity type
        //    falsely flipped every sibling instance to "done" (#52).
      const { data: states, error: statesError } = await supabase
        .from('extraction_reviewer_states')
        .select('field_id, instance_id, current_decision_id, reviewer_decision:extraction_reviewer_decisions!fk_extraction_reviewer_states_decision_run_match(decision)')
        .eq('run_id', finalRun.id)
        .in('instance_id', instanceIds);

      if (statesError) throw statesError;

      const requiredFieldIds = new Set(requiredFields.map((f) => f.id));
      const optionalFieldIds = new Set(optionalFields.map((f) => f.id));

      const completedRequiredPairs = new Set<string>();
      const completedOptionalPairs = new Set<string>();
      for (const s of (states || []) as Array<{
        field_id: string;
        instance_id: string;
        current_decision_id: string | null;
        reviewer_decision:
          | { decision: string }
          | { decision: string }[]
          | null;
      }>) {
        if (!s.current_decision_id) continue;
        const dec = Array.isArray(s.reviewer_decision)
          ? s.reviewer_decision[0]
          : s.reviewer_decision;
        if (!dec || dec.decision === 'reject') continue;
        const key = `${s.instance_id}_${s.field_id}`;
        if (requiredFieldIds.has(s.field_id)) {
          completedRequiredPairs.add(key);
        } else if (optionalFieldIds.has(s.field_id)) {
          completedOptionalPairs.add(key);
        }
      }

      const completedRequired = completedRequiredPairs.size;
      const completedOptional = completedOptionalPairs.size;

      const totalFields = totalRequiredPairs + totalOptionalPairs;
      const completedFields = completedRequired + completedOptional;
      const progressPercentage = totalFields > 0
        ? Math.round((completedFields / totalFields) * 100)
        : 0;

      return {
        totalRequiredFields: totalRequiredPairs,
        completedRequiredFields: completedRequired,
        totalOptionalFields: totalOptionalPairs,
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

