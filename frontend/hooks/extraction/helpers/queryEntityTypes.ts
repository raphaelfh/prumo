/**
 * Reusable helper for entity_types queries with fallback
 *
 * Abstracts common logic to fetch entity_types that may live under:
 * - project_template_id (project template)
 * - template_id (global template)
 *
 * Always tries project_template_id first, then template_id as fallback.
 */

import {supabase} from '@/integrations/supabase/client';
import type {PostgrestFilterBuilder} from '@supabase/postgrest-js';

/**
 * Options for entity_types query
 */
export interface QueryEntityTypesOptions<T> {
    /** Template ID (may be project_template_id or template_id) */
  templateId: string;
    /** Field selection (e.g. 'id, name, label, sort_order') */
  select: string;
    /** Additional filters to apply to the query */
  filters?: (query: PostgrestFilterBuilder<any, any, any, T>) => PostgrestFilterBuilder<any, any, any, T>;
    /** Order (default: sort_order asc) */
  orderBy?: { column: string; ascending?: boolean };
}

/**
 * Fetches entity_types with automatic fallback project_template_id -> template_id
 *
 * @param options - Query options
 * @returns Array of entity_types found
 * @throws Error on query failure
 */
export async function queryEntityTypesWithFallback<T = any>(
  options: QueryEntityTypesOptions<T>
): Promise<T[]> {
  const { templateId, select, filters, orderBy } = options;

    // Build base query
  const buildQuery = (useProjectTemplate: boolean) => {
    let query = supabase
      .from('extraction_entity_types')
      .select(select);

    // Aplicar filtro de template (project_template_id ou template_id)
    if (useProjectTemplate) {
      query = query.eq('project_template_id', templateId);
    } else {
      query = query.eq('template_id', templateId);
    }

    // Aplicar filtros customizados se fornecidos
    if (filters) {
      query = filters(query);
    }

      // Apply sort order
    if (orderBy) {
      query = query.order(orderBy.column, { ascending: orderBy.ascending !== false });
    } else {
        // Default sort by sort_order
      query = query.order('sort_order', { ascending: true });
    }

    return query;
  };

  // Tentar primeiro project_template_id (template de projeto)
  let { data: results, error } = await buildQuery(true);

    // If not found, try template_id (global template)
  if (!results || results.length === 0) {
    const { data: globalResults, error: globalError } = await buildQuery(false);

    if (globalError) {
      throw new Error(`Failed to query entity types: ${globalError.message}`);
    }

    results = globalResults;
    error = null;
  }

  if (error) {
    throw new Error(`Failed to query entity types: ${error.message}`);
  }

  return (results || []) as T[];
}






