/**
 * Helper to fetch top-level (study-level) sections
 *
 * Top-level sections are entity_types that:
 * - Have parent_entity_type_id = null (not children of other entity_types)
 * - Are NOT prediction_models (name != 'prediction_models')
 * - May have cardinality = 'one' or 'many'
 * - Are linked directly to the article (no parentInstanceId)
 */

import {queryEntityTypesWithFallback} from './queryEntityTypes';

export interface TopLevelSection {
  id: string;
  name: string;
  label: string;
  sort_order: number;
}

/**
 * Fetches all top-level sections of the template
 *
 * @param templateId - Template ID
 * @returns Array of top-level sections ordered by sort_order
 */
export async function getTopLevelSections(
  templateId: string,
): Promise<TopLevelSection[]> {
  return queryEntityTypesWithFallback<TopLevelSection>({
    templateId,
    select: 'id, name, label, sort_order',
    filters: (query) => query
      .is('parent_entity_type_id', null)
      .neq('name', 'prediction_models'),
  });
}


