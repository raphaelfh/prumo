/**
 * Detecção de consenso e cálculo de concordância
 * 
 * Lógica de negócio para análise de consenso entre múltiplos revisores.
 * Reutilizável em Assessment e Extraction.
 * 
 * @module comparison/consensus
 */

import { formatComparisonValue } from './formatters';

/**
 * Resultado da análise de consenso
 */
export interface ConsensusResult {
  value: string | null;          // Valor consensual
  count: number;                  // Quantos usuários têm esse valor
  total: number;                  // Total de valores não-vazios
  percentage: number;             // % de concordância (0-100)
  hasConsensus: boolean;          // Se atingiu threshold
  threshold: number;              // Threshold usado (0-100)
}

/**
 * Detecta consenso em array de valores
 * 
 * Algoritmo:
 * 1. Filtra valores vazios
 * 2. Agrupa valores iguais (usando formatComparisonValue)
 * 3. Encontra valor mais frequente
 * 4. Verifica se atinge threshold (default: 50%)
 * 
 * @param values - Array de valores de diferentes usuários
 * @param threshold - % mínimo para ser consenso (0-1, default: 0.5)
 * @returns ConsensusResult ou null se não houver valores
 * 
 * @example
 * detectConsensus([150, 150, 152]) 
 * // { value: '150', count: 2, total: 3, percentage: 67, hasConsensus: true }
 * 
 * detectConsensus([150, 200, 300])
 * // { value: '150', count: 1, total: 3, percentage: 33, hasConsensus: false }
 */
export function detectConsensus(
  values: any[],
  threshold: number = 0.5
): ConsensusResult | null {
  // Validação de threshold
  if (threshold < 0 || threshold > 1) {
    throw new Error('Threshold deve estar entre 0 e 1');
  }

  // NOVO: Verificar se TODOS os valores são vazios (consenso implícito)
  const allEmpty = values.every(v => v === null || v === undefined || v === '');
  
  if (allEmpty) {
    // Consenso implícito: todos concordam em deixar vazio
    return {
      value: '—',
      count: values.length,
      total: values.length,
      percentage: 100,
      hasConsensus: true,
      threshold: Math.round(threshold * 100)
    };
  }

  // Filtrar valores vazios
  const nonEmpty = values.filter(v => 
    v !== null && v !== undefined && v !== ''
  );

  if (nonEmpty.length === 0) return null; // Não deveria chegar aqui após check acima

  // Agrupar por valor formatado (para comparação consistente)
  const counts: Record<string, number> = {};
  nonEmpty.forEach(v => {
    const formatted = formatComparisonValue(v);
    counts[formatted] = (counts[formatted] || 0) + 1;
  });

  // Encontrar valor mais frequente
  let maxCount = 0;
  let consensusValue: string | null = null;

  Object.entries(counts).forEach(([value, count]) => {
    if (count > maxCount) {
      maxCount = count;
      consensusValue = value;
    }
  });

  const total = nonEmpty.length;
  const percentage = Math.round((maxCount / total) * 100);
  const hasConsensus = maxCount > 1 && (maxCount / total) >= threshold;

  return {
    value: consensusValue,
    count: maxCount,
    total,
    percentage,
    hasConsensus,
    threshold: Math.round(threshold * 100)
  };
}

/**
 * Calcula concordância entre dois conjuntos de valores
 * Útil para comparação usuário vs usuário
 * 
 * @param values1 - Primeiro conjunto (key -> value)
 * @param values2 - Segundo conjunto (key -> value)
 * @returns Estatísticas de concordância
 * 
 * @example
 * calculateConcordance(
 *   { field1: '150', field2: 'Yes' },
 *   { field1: '150', field2: 'No' }
 * )
 * // { matches: 1, total: 2, percentage: 50 }
 */
export function calculateConcordance(
  values1: Record<string, any>,
  values2: Record<string, any>
): { matches: number; total: number; percentage: number } {
  const commonKeys = Object.keys(values1).filter(k => k in values2);
  
  if (commonKeys.length === 0) {
    return { matches: 0, total: 0, percentage: 0 };
  }

  const matches = commonKeys.filter(k => 
    formatComparisonValue(values1[k]) === formatComparisonValue(values2[k])
  ).length;

  const percentage = Math.round((matches / commonKeys.length) * 100);

  return { matches, total: commonKeys.length, percentage };
}

/**
 * Agrupa valores por usuário
 * Helper para transformar array em Map indexada por userId
 * 
 * @param extractions - Array de extrações/assessments
 * @returns Map de userId -> valores
 */
export function groupValuesByUser<T extends { userId: string; values: Record<string, any> }>(
  extractions: T[]
): Map<string, Record<string, any>> {
  const grouped = new Map<string, Record<string, any>>();
  
  extractions.forEach(ext => {
    grouped.set(ext.userId, ext.values);
  });

  return grouped;
}

/**
 * Calcula estatísticas de divergência para um conjunto de campos
 * Retorna quantos campos têm consenso vs divergência
 * 
 * @param fieldValues - Map de fieldId -> array de valores
 * @param threshold - Threshold para consenso
 * @returns Estatísticas agregadas
 */
export function calculateDivergenceStats(
  fieldValues: Map<string, any[]>,
  threshold: number = 0.5
): {
  totalFields: number;
  consensusFields: number;
  divergentFields: number;
  consensusPercentage: number;
} {
  let consensusFields = 0;
  let divergentFields = 0;

  fieldValues.forEach((values) => {
    const consensus = detectConsensus(values, threshold);
    if (consensus?.hasConsensus) {
      consensusFields++;
    } else if (consensus) {
      divergentFields++;
    }
  });

  const totalFields = consensusFields + divergentFields;
  const consensusPercentage = totalFields > 0 
    ? Math.round((consensusFields / totalFields) * 100)
    : 0;

  return {
    totalFields,
    consensusFields,
    divergentFields,
    consensusPercentage
  };
}

