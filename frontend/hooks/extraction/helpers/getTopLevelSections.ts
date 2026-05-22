/**
 * Helper to fetch study-level (top-level) sections.
 *
 * Study-level sections are entity types with ``role = 'study_section'``
 * — rendered as a top-level accordion, filled once per article. The
 * filter used to spell this as ``parent_entity_type_id IS NULL AND name
 * <> 'prediction_models'``; migration ``0016_entity_role_column``
 * promoted the concept to a column, so this stays in sync with the rest
 * of the form by reading the role directly.
 */

import {ENTITY_ROLE} from '@/lib/extraction/entityTypeRoles';

import {queryEntityTypesWithFallback} from './queryEntityTypes';

export interface TopLevelSection {
  id: string;
  name: string;
  label: string;
  sort_order: number;
}

/**
 * Fetches all study-level sections of the template, ordered by
 * ``sort_order`` (display order).
 */
export async function getTopLevelSections(
  templateId: string,
): Promise<TopLevelSection[]> {
  return queryEntityTypesWithFallback<TopLevelSection>({
    templateId,
    select: 'id, name, label, sort_order',
    filters: (query) => query.eq('role', ENTITY_ROLE.STUDY_SECTION),
  });
}


