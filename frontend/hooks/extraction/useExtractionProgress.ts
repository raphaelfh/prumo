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
    // Fix #55: count (instance × field) pairs, not unique field defs.
    // The previous implementation marked a required field "done" the
    // moment a single instance was filled, so cardinality='many'
    // entities (e.g. multiple prediction models) reported 100 %
    // completion while later instances were still empty.
    //
    // Key format is `${instanceId}_${fieldId}`. We derive the set of
    // instances per entity type by scanning the value keys and
    // matching their fieldId against the entity type's required-field
    // ids. An entity type with no observed instances contributes one
    // "phantom" instance to the denominator so the entity is still
    // represented in the progress total.
    const fieldToEntityType = new Map<string, string>();
    const requiredFieldIdsByEntityType = new Map<string, Set<string>>();
    for (const et of entityTypes) {
      const required = new Set<string>();
      for (const field of et.fields) {
        fieldToEntityType.set(field.id, et.id);
        if (field.is_required) required.add(field.id);
      }
      requiredFieldIdsByEntityType.set(et.id, required);
    }

    const instancesByEntityType = new Map<string, Set<string>>();
    for (const key of Object.keys(values)) {
      const sep = key.indexOf('_');
      if (sep < 0) continue;
      const instanceId = key.slice(0, sep);
      const fieldId = key.slice(sep + 1);
      const etId = fieldToEntityType.get(fieldId);
      if (!etId) continue;
      let set = instancesByEntityType.get(etId);
      if (!set) {
        set = new Set();
        instancesByEntityType.set(etId, set);
      }
      set.add(instanceId);
    }

    let totalRequired = 0;
    for (const et of entityTypes) {
      const reqCount = requiredFieldIdsByEntityType.get(et.id)?.size ?? 0;
      if (reqCount === 0) continue;
      const instanceCount = instancesByEntityType.get(et.id)?.size ?? 1;
      totalRequired += reqCount * instanceCount;
    }

    let completedRequired = 0;
    for (const [key, value] of Object.entries(values)) {
      if (value === null || value === undefined || value === '') continue;
      const sep = key.indexOf('_');
      if (sep < 0) continue;
      const fieldId = key.slice(sep + 1);
      const etId = fieldToEntityType.get(fieldId);
      if (!etId) continue;
      if (requiredFieldIdsByEntityType.get(etId)?.has(fieldId)) {
        completedRequired += 1;
      }
    }

    const percentage = totalRequired > 0
      ? Math.round((completedRequired / totalRequired) * 100)
      : 0;

    return {
      completedFields: completedRequired,
      totalFields: totalRequired,
      completionPercentage: percentage,
      isComplete: totalRequired > 0 && completedRequired >= totalRequired,
    };
  }, [values, entityTypes]);
}

