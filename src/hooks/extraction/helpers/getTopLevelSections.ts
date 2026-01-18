/**
 * Helper para buscar seções de nível superior (study-level)
 * 
 * Seções de nível superior são entity_types que:
 * - Têm parent_entity_type_id = null (não são filhas de outros entity_types)
 * - NÃO são prediction_models (name != 'prediction_models')
 * - Podem ter cardinality = 'one' ou 'many'
 * - São vinculadas diretamente ao artigo (sem parentInstanceId)
 */

import { queryEntityTypesWithFallback } from './queryEntityTypes';

export interface TopLevelSection {
  id: string;
  name: string;
  label: string;
  sort_order: number;
}

/**
 * Busca todas as seções de nível superior do template
 * 
 * @param templateId - ID do template
 * @returns Array de seções de nível superior ordenadas por sort_order
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


