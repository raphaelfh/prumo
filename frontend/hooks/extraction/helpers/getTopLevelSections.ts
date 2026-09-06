/**
 * Helper to fetch the study-level sections — the ones extracted once per
 * article, with no entry above them.
 *
 * Was ``role = 'study_section'``. Neither obvious replacement is equivalent,
 * and both fail SILENTLY — by dropping sections from an extraction run, not
 * by erroring:
 *
 * - ``parent IS NULL AND cardinality = 'one'`` drops a ROOT section that
 *   repeats. A manager can create one (`AddSectionDialog`) and
 *   `extraction-multi-instance.e2e.ts` does; 0016 called it a
 *   `study_section` and nothing coupled that role to cardinality.
 * - ``parent IS NULL`` alone sweeps in the entry GROUPS, which the model
 *   pipeline extracts by its own path.
 *
 * 0016's `study_section` was root AND childless (its CHECK forbade a
 * `study_section` from being a parent), so that is the predicate: a root
 * that owns no children. PostgREST cannot express "has no children", so the
 * parent ids come back in the same round trip and the exclusion is applied
 * here.
 */

import {queryEntityTypesWithFallback} from './queryEntityTypes';

export interface TopLevelSection {
  id: string;
  name: string;
  label: string;
  sort_order: number;
}

interface SectionRow extends TopLevelSection {
  parent_entity_type_id: string | null;
}

/**
 * Fetches the study-level sections of the template, ordered by
 * ``sort_order`` (display order).
 */
export async function getTopLevelSections(
  templateId: string,
): Promise<TopLevelSection[]> {
  const rows = await queryEntityTypesWithFallback<SectionRow>({
    templateId,
    select: 'id, name, label, sort_order, parent_entity_type_id',
  });

  const parentIds = new Set(
    rows.map((row) => row.parent_entity_type_id).filter((id): id is string => id !== null),
  );

  return rows
    .filter((row) => row.parent_entity_type_id === null && !parentIds.has(row.id))
    .map(({id, name, label, sort_order}) => ({id, name, label, sort_order}));
}
