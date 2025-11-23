/**
 * Helper para buscar seções filhas de um modelo
 * 
 * Busca todas as entity_types filhas de um modelo (parent instance).
 * Usado para chunking de extração em batch.
 */

import { supabase } from '@/integrations/supabase/client';
import { queryEntityTypesWithFallback } from './queryEntityTypes';

export interface ModelChildSection {
  id: string;
  name: string;
  label: string;
  sort_order: number;
}

/**
 * Busca todas as seções filhas de um modelo
 * 
 * @param parentInstanceId - ID da instância do modelo
 * @param templateId - ID do template
 * @returns Array de seções filhas ordenadas por sort_order
 */
export async function getModelChildSections(
  parentInstanceId: string,
  templateId: string,
): Promise<ModelChildSection[]> {
  // 1. Buscar a instância do modelo para obter seu entity_type_id
  // Não filtrar por template_id aqui, pois a instância pode estar associada a project_template_id ou template_id
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

  // 2. Buscar entity_types filhas usando helper reutilizável
  return queryEntityTypesWithFallback<ModelChildSection>({
    templateId,
    select: 'id, name, label, sort_order',
    filters: (query) => query.eq('parent_entity_type_id', instance.entity_type_id),
  });
}

