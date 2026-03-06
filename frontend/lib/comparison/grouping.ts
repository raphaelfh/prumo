/**
 * Helpers to group instances by label
 *
 * Used in cardinality='many' comparisons:
 * - Groups current user instances
 * - Groups other users' instances
 * - Returns unique entities (e.g. ["model A", "model B"])
 */

import type {ExtractionInstance} from '@/types/extraction';

// Type for instances with creator
export interface InstanceWithCreator extends ExtractionInstance {
  created_by: string;
}

export interface GroupedEntity {
    label: string; // e.g. "model A"
  instancesByUser: Map<string, string>; // userId -> instanceId
}

/**
 * Groups instances by label across all users
 * Uses real DB instances instead of inferring
 */
export function groupInstancesByLabel(
  myInstances: ExtractionInstance[],
  myUserId: string,
  allUserInstances: InstanceWithCreator[], // Real instances from DB
  entityTypeId: string
): GroupedEntity[] {
  const labelMap = new Map<string, Map<string, string>>();

    // Group ALL instances (mine + other users) by label
  allUserInstances.forEach(instance => {
      if (instance.entity_type_id !== entityTypeId) return; // Filter by entityType
    
    const userId = instance.created_by;
    const label = instance.label;
    
    if (!labelMap.has(label)) {
      labelMap.set(label, new Map());
    }
    
    labelMap.get(label)!.set(userId, instance.id);
  });

    // Convert to array and keep only groups with at least 1 user
  return Array.from(labelMap.entries())
    .map(([label, instancesByUser]) => ({
      label,
      instancesByUser
    }))
      .filter(entity => entity.instancesByUser.size > 0); // At least 1 user
}

/**
 * Extracts values for a specific instance of a specific user
 */
export function extractInstanceValuesForUser(
  allValues: Record<string, any>,
  instanceId: string
): Record<string, any> {
  const instanceValues: Record<string, any> = {};
  
  Object.entries(allValues).forEach(([key, value]) => {
    if (key.startsWith(`${instanceId}_`)) {
      const fieldId = key.replace(`${instanceId}_`, '');
      instanceValues[fieldId] = value;
    }
  });
  
  return instanceValues;
}
