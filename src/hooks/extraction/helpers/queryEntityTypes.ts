/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * Helper reutilizável para queries de entity_types com fallback
 * 
 * Abstrai a lógica comum de buscar entity_types que podem estar em:
 * - project_template_id (template de projeto)
 * - template_id (template global)
 * 
 * Sempre tenta primeiro project_template_id, depois template_id como fallback.
 */

import { supabase } from '@/integrations/supabase/client';
import type { PostgrestFilterBuilder } from '@supabase/postgrest-js';

/**
 * Opções para query de entity_types
 */
export interface QueryEntityTypesOptions<T> {
  /** ID do template (pode ser project_template_id ou template_id) */
  templateId: string;
  /** Seleção de campos (ex: 'id, name, label, sort_order') */
  select: string;
  /** Filtros adicionais a serem aplicados na query */
  filters?: (query: PostgrestFilterBuilder<any, any, any, T>) => PostgrestFilterBuilder<any, any, any, T>;
  /** Ordenação (padrão: sort_order asc) */
  orderBy?: { column: string; ascending?: boolean };
}

/**
 * Busca entity_types com fallback automático project_template_id -> template_id
 * 
 * @param options - Opções da query
 * @returns Array de entity_types encontrados
 * @throws Error se houver erro na query
 */
export async function queryEntityTypesWithFallback<T = any>(
  options: QueryEntityTypesOptions<T>
): Promise<T[]> {
  const { templateId, select, filters, orderBy } = options;

  // Construir query base
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

    // Aplicar ordenação
    if (orderBy) {
      query = query.order(orderBy.column, { ascending: orderBy.ascending !== false });
    } else {
      // Ordenação padrão por sort_order
      query = query.order('sort_order', { ascending: true });
    }

    return query;
  };

  // Tentar primeiro project_template_id (template de projeto)
  let { data: results, error } = await buildQuery(true);

  // Se não encontrou, tentar template_id (template global)
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






