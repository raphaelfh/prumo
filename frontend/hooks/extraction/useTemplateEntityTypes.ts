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
 */

import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import type { ExtractionField } from '@/types/extraction';

export interface TemplateEntityTypeWithFields {
  id: string;
  fields: ExtractionField[];
}

export const templateEntityTypesKeys = {
  all: ['template-entity-types'] as const,
  byTemplate: (templateId: string) =>
    ['template-entity-types', templateId] as const,
};

export function useTemplateEntityTypes(templateId: string | null | undefined) {
  const query = useQuery({
    queryKey: templateEntityTypesKeys.byTemplate(templateId ?? ''),
    enabled: !!templateId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<TemplateEntityTypeWithFields[]> => {
      const { data, error } = await supabase
        .from('extraction_entity_types')
        .select('id, fields:extraction_fields(*)')
        .eq('project_template_id', templateId as string)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((et) => ({
        id: et.id as string,
        fields: (et.fields ?? []) as unknown as ExtractionField[],
      }));
    },
  });

  return {
    entityTypes: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}
