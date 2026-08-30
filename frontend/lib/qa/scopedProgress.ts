/**
 * Worklist completion % for one quality-assessment article, with the sections
 * its own study-type classification takes out of play removed first.
 *
 * `computeRequiredFieldProgress` is deliberately NOT changed: its numerator
 * maps value keys through the projections it is handed, so dropping an entity
 * type from the array removes it from BOTH sides of the metric. An excluded
 * part is therefore not work owed, and a value left in it by a since-
 * reclassified assessment is not progress either — the row can neither stall
 * below 100% nor climb above what the instrument actually asks for.
 *
 * Extraction surfaces pass no schema and are inert by construction.
 */
import { computeRowProgress } from "@/lib/extraction/progress";
import type { ProgressInstanceRow, ProgressValueRow } from "@/lib/extraction/progress";
import { outOfScopeSectionsOnRow } from "@/lib/qa/studyTypeScope";
import type { ExtractionField } from "@/types/extraction";

interface ScopedEntityType {
  id: string;
  name: string;
  is_required?: boolean;
  fields: ExtractionField[];
}

export function scopedRowProgress(
  templateSchema: unknown,
  entityTypes: ScopedEntityType[],
  instances: ProgressInstanceRow[],
  values: ProgressValueRow[],
): number {
  const excluded = outOfScopeSectionsOnRow(
    templateSchema,
    entityTypes,
    instances,
    values,
  );
  const inScope =
    excluded.size === 0
      ? entityTypes
      : entityTypes.filter((et) => !excluded.has(et.name));
  return computeRowProgress(instances, values, inScope);
}
