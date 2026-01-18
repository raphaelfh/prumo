/**
 * Orquestrador de Comparação
 * 
 * Estratégia simplificada:
 * - cardinality='one': Tabela simples (todos os fields, todos os usuários)
 * - cardinality='many': Seletor de entidade + tabela comparando essa entidade entre usuários
 */

import type { ExtractionEntityType } from '@/types/extraction';

export interface ComparisonStrategy {
  type: 'simple' | 'entity-selector';
  renderMode: 'table' | 'accordion-by-entity';
}

export function getComparisonStrategy(
  entityType: ExtractionEntityType
): ComparisonStrategy {
  // Se cardinality='many': usar seletor de entidade
  if (entityType.cardinality === 'many') {
    return { 
      type: 'entity-selector', 
      renderMode: 'accordion-by-entity' 
    };
  }
  
  // cardinality='one': tabela simples
  return { 
    type: 'simple', 
    renderMode: 'table' 
  };
}
