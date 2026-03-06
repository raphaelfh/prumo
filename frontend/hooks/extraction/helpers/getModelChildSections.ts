/**
 * Helper to fetch child sections of a model
 *
 * Fetches all child entity_types of a model (parent instance).
 * Used for batch extraction chunking.
 */

import {supabase} from '@/integrations/supabase/client';
import {queryEntityTypesWithFallback} from './queryEntityTypes';

export interface ModelChildSection {
  id: string;
  name: string;
  label: string;
  sort_order: number;
}

/**
 * Fetches all child sections of a model
 *
 * @param parentInstanceId - Model instance ID
 * @param templateId - Template ID
 * @returns Array of child sections ordered by sort_order
 */
export async function getModelChildSections(
  parentInstanceId: string,
  templateId: string,
): Promise<ModelChildSection[]> {
    // 1. Fetch model instance to get its entity_type_id
    // Do not filter by template_id here; instance may be linked to project_template_id or template_id
  const { data: instance, error: instanceError } = await supabase
    .from('extraction_instances')
    .select('entity_type_id')
    .eq('id', parentInstanceId)
    .maybeSingle();

  if (instanceError) {
    throw new Error(`Failed to query model instance: ${instanceError.message}`);
  }

  if (!instance || !instance.entity_type_id) {
    throw new Error(`Model instance not found: ${parentInstanceId}`);
  }

    // 2. Fetch child entity_types using reusable helper
  return queryEntityTypesWithFallback<ModelChildSection>({
    templateId,
    select: 'id, name, label, sort_order',
    filters: (query) => query.eq('parent_entity_type_id', instance.entity_type_id),
  });
}

