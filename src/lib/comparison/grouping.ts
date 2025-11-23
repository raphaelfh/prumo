/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * Helpers para agrupar instances por label
 * 
 * Usado em comparações de cardinality='many':
 * - Agrupa instances do current user
 * - Agrupa instances de outros usuários
 * - Retorna entidades únicas (ex: ["model A", "model B"])
 */

import type { ExtractionInstance } from '@/types/extraction';
import type { OtherExtraction } from '@/hooks/extraction/colaboracao/useOtherExtractions';

// Tipo para instances com criador
export interface InstanceWithCreator extends ExtractionInstance {
  created_by: string;
}

export interface GroupedEntity {
  label: string; // ex: "model A"
  instancesByUser: Map<string, string>; // userId -> instanceId
}

/**
 * Agrupa instances por label de todos os usuários
 * VERSÃO CORRIGIDA: Usa instances reais do banco em vez de inferir
 */
export function groupInstancesByLabel(
  myInstances: ExtractionInstance[],
  myUserId: string,
  allUserInstances: InstanceWithCreator[], // NOVO: instances reais do banco
  entityTypeId: string
): GroupedEntity[] {
  const labelMap = new Map<string, Map<string, string>>();
  
  // Agrupar TODAS as instances (minhas + outros usuários) por label
  allUserInstances.forEach(instance => {
    if (instance.entity_type_id !== entityTypeId) return; // ✅ Filtrar por entityType
    
    const userId = instance.created_by;
    const label = instance.label;
    
    if (!labelMap.has(label)) {
      labelMap.set(label, new Map());
    }
    
    labelMap.get(label)!.set(userId, instance.id);
  });
  
  // Converter para array e filtrar apenas grupos com pelo menos 1 usuário
  return Array.from(labelMap.entries())
    .map(([label, instancesByUser]) => ({
      label,
      instancesByUser
    }))
    .filter(entity => entity.instancesByUser.size > 0); // Pelo menos 1 usuário
}

/**
 * Extrai valores de uma instance específica de um usuário específico
 */
export function extractInstanceValuesForUser(
  allValues: Record<string, any>,
  instanceId: string
): Record<string, any> {
  const instanceValues: Record<string, any> = {};
  
  Object.entries(allValues).forEach(([key, value]) => {
    if (key.startsWith(`${instanceId}_`)) {
      const fieldId = key.replace(`${instanceId}_`, '');
      instanceValues[fieldId] = value;
    }
  });
  
  return instanceValues;
}
