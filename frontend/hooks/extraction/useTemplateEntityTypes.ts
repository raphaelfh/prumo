/**
 * Template structure (entity types + their fields) for a project template,
 * TanStack-cached by `project_template_id`.
 *
 * The HITL article list, the extraction table and the dashboard need the
 * `is_required` flag per field to compute the canonical required-field
 * progress (`@/lib/extraction/progress`). They each used to lack it (or
 * compute a divergent instance-based number). Caching by the
 * article-independent template id means one fetch serves every row instead of
 * one-per-article.
 *
 * The select also carries the entity-type metadata the Configuration grid
 * renders (label/role/cardinality/parent/sort_order) so that screen reads the
 * whole template structure in ONE request instead of fanning out per section —
 * and inherits the invalidation `useTemplateRepublish` already performs on this
 * key after every config mutation.
 */

import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { templateEntityTypesKeys } from '@/lib/query-keys/extraction';
import type { ExtractionField } from '@/types/extraction';

export interface TemplateEntityTypeWithFields {
  id: string;
  name: string;
  label: string | null;
  description: string | null;
  role: string | null;
  cardinality: string | null;
  parent_entity_type_id: string | null;
  sort_order: number;
  /** Entity-level required flag (B-3b): supplied by the ACTIVE-snapshot
   * read; the live PostgREST select doesn't carry it (optional so its
   * consumers keep compiling — progress.ts treats absent as optional). */
  is_required?: boolean;
  fields: ExtractionField[];
}

export { templateEntityTypesKeys };

export function useTemplateEntityTypes(templateId: string | null | undefined) {
  const query = useQuery({
    queryKey: templateEntityTypesKeys.byTemplate(templateId ?? ''),
    enabled: !!templateId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<TemplateEntityTypeWithFields[]> => {
      const { data, error } = await supabase
        .from('extraction_entity_types')
        .select(
          'id, name, label, description, role, cardinality, parent_entity_type_id, sort_order, fields:extraction_fields(*)',
        )
        .eq('project_template_id', templateId as string)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((et) => ({
        id: et.id as string,
        name: et.name as string,
        label: (et.label ?? null) as string | null,
        description: (et.description ?? null) as string | null,
        role: (et.role ?? null) as string | null,
        cardinality: (et.cardinality ?? null) as string | null,
        parent_entity_type_id: (et.parent_entity_type_id ?? null) as string | null,
        sort_order: (et.sort_order ?? 0) as number,
        fields: (et.fields ?? []) as unknown as ExtractionField[],
      }));
    },
  });

  return {
    entityTypes: query.data ?? [],
    // isLoading is first-load-only (isFetching covers background refetches),
    // which is exactly the "skeleton once, then keep the rows" rule the
    // editor needs to preserve selection/search across a refresh.
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}
