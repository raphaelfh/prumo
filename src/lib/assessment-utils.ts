/**
 * Utilities para Assessment
 *
 * Funções utilitárias centralizadas para cálculos e operações
 * comuns do módulo de assessment. Elimina duplicação de código
 * encontrada em 4+ arquivos.
 *
 * @module lib/assessment-utils
 */

import type { AssessmentItem, AssessmentResponse, AssessmentLevel } from '@/types/assessment';

// =================== PROGRESS CALCULATION ===================

export interface ProgressResult {
  totalRequired: number;
  completedRequired: number;
  progressPercentage: number;
  isComplete: boolean;
}

/**
 * Calcula progresso de assessment baseado em items e responses
 *
 * Anteriormente duplicada em:
 * - AssessmentInterface.tsx (linhas 146-170)
 * - ArticleAssessmentTable.tsx (linhas 189-303)
 * - DomainAccordion.tsx (linhas 72-82)
 * - useAssessmentData.ts (linha 204)
 *
 * @param items - Lista de items do instrumento
 * @param responses - Record de respostas (key: item_id)
 * @returns Objeto com métricas de progresso
 */
export function calculateAssessmentProgress(
  items: AssessmentItem[],
  responses: Record<string, AssessmentResponse>
): ProgressResult {
  const requiredItems = items.filter((item) => item.is_required);
  const totalRequired = requiredItems.length;

  const completedRequired = requiredItems.filter((item) => {
    const response = responses[item.id];
    return response?.selected_level?.trim();
  }).length;

  const progressPercentage =
    totalRequired > 0 ? Math.round((completedRequired / totalRequired) * 100) : 0;

  return {
    totalRequired,
    completedRequired,
    progressPercentage,
    isComplete: completedRequired === totalRequired && totalRequired > 0,
  };
}

/**
 * Calcula progresso simplificado (apenas percentual)
 *
 * @param completed - Número de items completados
 * @param total - Total de items
 * @returns Percentual (0-100)
 */
export function calculateProgressPercentage(completed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((completed / total) * 100);
}

// =================== CONFIDENCE CALCULATION ===================

/**
 * Calcula porcentagem de confiança (0-1 → 0-100%)
 * Retorna 0 se o valor for undefined ou inválido
 *
 * Anteriormente duplicada em:
 * - AISuggestionConfidence.tsx (linhas 26-31)
 *
 * @param confidence - Score de confiança (0 a 1)
 * @returns Percentual (0-100)
 */
export function calculateConfidencePercent(
  confidence: number | undefined | null
): number {
  if (confidence === undefined || confidence === null || isNaN(confidence)) {
    return 0;
  }
  return Math.round(confidence * 100);
}

/**
 * Formata porcentagem de confiança para exibição
 *
 * @param confidence - Score de confiança (0 a 1)
 * @returns String formatada (ex: "85%")
 */
export function formatConfidencePercent(
  confidence: number | undefined | null
): string {
  return `${calculateConfidencePercent(confidence)}%`;
}

// =================== LEVEL FORMATTING ===================

/**
 * Mapa de traduções para níveis de assessment
 */
const LEVEL_TRANSLATIONS: Record<string, string> = {
  Low: 'Baixo risco',
  High: 'Alto risco',
  Unclear: 'Não claro',
  'Some concerns': 'Algumas preocupações',
  Yes: 'Sim',
  Partially: 'Parcialmente',
  No: 'Não',
  'Low risk': 'Baixo risco',
  'High risk': 'Alto risco',
  'Not applicable': 'Não aplicável',
};

/**
 * Formata nível de assessment para exibição em português
 *
 * @param level - Nível original (ex: "Low", "High")
 * @returns Texto traduzido ou original se não encontrado
 */
export function formatAssessmentLevel(level: AssessmentLevel | string): string {
  return LEVEL_TRANSLATIONS[level] || level;
}

// =================== STATUS HELPERS ===================

export type AssessmentStatusType = 'complete' | 'in_progress' | 'not_started';

/**
 * Determina status de assessment baseado em progresso e status do banco
 *
 * @param status - Status do banco (optional)
 * @param progressPercentage - Percentual de completude
 * @returns Tipo de status normalizado
 */
export function getAssessmentStatus(
  status: string | undefined | null,
  progressPercentage: number
): AssessmentStatusType {
  if (status === 'submitted' || status === 'complete' || progressPercentage >= 100) {
    return 'complete';
  }
  if (progressPercentage > 0 || status === 'in_progress') {
    return 'in_progress';
  }
  return 'not_started';
}

/**
 * Retorna label em português para status
 */
export function getStatusLabel(status: AssessmentStatusType): string {
  const labels: Record<AssessmentStatusType, string> = {
    complete: 'Completa',
    in_progress: 'Em andamento',
    not_started: 'Não iniciada',
  };
  return labels[status];
}

/**
 * Retorna cor do badge para status
 */
export function getStatusColor(status: AssessmentStatusType): string {
  const colors: Record<AssessmentStatusType, string> = {
    complete: 'bg-green-500',
    in_progress: 'bg-blue-500',
    not_started: 'bg-gray-400',
  };
  return colors[status];
}

// =================== DOMAIN HELPERS ===================

/**
 * Agrupa items por domínio
 *
 * @param items - Lista de items
 * @returns Record agrupado por nome do domínio
 */
export function groupItemsByDomain(
  items: AssessmentItem[]
): Record<string, AssessmentItem[]> {
  return items.reduce((acc, item) => {
    const domain = item.domain || 'Sem domínio';
    if (!acc[domain]) {
      acc[domain] = [];
    }
    acc[domain].push(item);
    return acc;
  }, {} as Record<string, AssessmentItem[]>);
}

/**
 * Ordena domínios por sort_order dos items
 *
 * @param domains - Record de domínios
 * @returns Array de tuplas [domainName, items] ordenado
 */
export function sortDomains(
  domains: Record<string, AssessmentItem[]>
): [string, AssessmentItem[]][] {
  return Object.entries(domains).sort(([, itemsA], [, itemsB]) => {
    const orderA = itemsA[0]?.sort_order ?? 0;
    const orderB = itemsB[0]?.sort_order ?? 0;
    return orderA - orderB;
  });
}

// =================== VALIDATION ===================

/**
 * Verifica se response é válido
 */
export function isValidResponse(response: AssessmentResponse | null | undefined): boolean {
  return Boolean(response?.selected_level?.trim());
}

/**
 * Conta responses válidos
 */
export function countValidResponses(
  responses: Record<string, AssessmentResponse>
): number {
  return Object.values(responses).filter(isValidResponse).length;
}
