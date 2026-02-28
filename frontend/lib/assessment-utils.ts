/**
 * Utilities para Assessment
 *
 * Funções utilitárias centralizadas para cálculos e operações
 * comuns do módulo de assessment. Elimina duplicação de código
 * encontrada em 4+ arquivos.
 *
 * @module lib/assessment-utils
 */

import type {Tables} from '@/integrations/supabase/types';
import type {
    AIAssessmentSuggestion,
    AIAssessmentSuggestionRaw,
    AssessmentInstrumentSchema,
    AssessmentItem,
    AssessmentLevel,
    AssessmentResponse,
    AssessmentResponseValue,
    AssessmentSuggestionStatus,
    LegacyAssessmentResponse,
} from '@/types/assessment';

type AssessmentItemRow = Tables<'assessment_items'> & {
  guidance?: string | null;
  llm_description?: string | null;
};

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

  if (totalRequired === 0) {
    return {
      totalRequired: 0,
      completedRequired: 0,
      progressPercentage: 100,
      isComplete: true,
    };
  }

  const progressPercentage = Math.round((completedRequired / totalRequired) * 100);

  return {
    totalRequired,
    completedRequired,
    progressPercentage,
    isComplete: completedRequired === totalRequired,
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
  if (status === 'submitted' || status === 'locked' || status === 'archived' || progressPercentage >= 100) {
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

// =================== AI SUGGESTION HELPERS ===================

/**
 * Gera chave única para sugestão
 */
export function getAssessmentSuggestionKey(itemId: string): string {
  return `ai_suggestion_${itemId}`;
}

/**
 * Normaliza sugestão raw do backend
 */
export function normalizeAIAssessmentSuggestion(
  raw: AIAssessmentSuggestionRaw
): AIAssessmentSuggestion {
  const suggestedValueRaw =
    typeof raw.suggested_value === 'object' && raw.suggested_value
      ? (raw.suggested_value as Record<string, unknown>)
      : null;
  const suggestedValue =
    suggestedValueRaw && typeof suggestedValueRaw.level === 'string'
      ? (raw.suggested_value as AIAssessmentSuggestion['suggested_value'])
      : { level: String(raw.suggested_value), evidence_passages: [] };

  const metadata =
    raw.metadata_ && typeof raw.metadata_ === 'object'
      ? (raw.metadata_ as AIAssessmentSuggestion['metadata_'])
      : {};

  // XOR: prioritize project-scoped (default) over global
  const effectiveItemId = raw.project_assessment_item_id || raw.assessment_item_id || '';

  return {
    id: raw.id,
    assessment_run_id: raw.assessment_run_id,
    assessment_item_id: effectiveItemId,
    suggested_value: suggestedValue,
    confidence_score: raw.confidence_score ?? 0,
    reasoning: raw.reasoning ?? '',
    status: raw.status,
    metadata_: metadata,
    reviewed_by: raw.reviewed_by,
    reviewed_at: raw.reviewed_at,
    created_at: raw.created_at,
  };
}

/**
 * Verifica status da sugestão
 */
export function isAssessmentSuggestionAccepted(
  suggestion: AIAssessmentSuggestion | undefined
): boolean {
  return suggestion?.status === 'accepted';
}

export function isAssessmentSuggestionRejected(
  suggestion: AIAssessmentSuggestion | undefined
): boolean {
  return suggestion?.status === 'rejected';
}

export function isAssessmentSuggestionPending(
  suggestion: AIAssessmentSuggestion | undefined
): boolean {
  return suggestion?.status === 'pending';
}

export function isAssessmentSuggestionStatus(
  status: string | undefined | null
): status is AssessmentSuggestionStatus {
  return status === 'pending' || status === 'accepted' || status === 'rejected';
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

// =================== RESPONSE NORMALIZATION ===================

export function getResponseLevel(
  response: AssessmentResponseValue | null | undefined
): AssessmentLevel | null {
  if (!response) return null;
  if ('selected_level' in response) {
    return response.selected_level ?? null;
  }
  if ('level' in response) {
    return response.level ?? null;
  }
  return null;
}

export function getResponseNotes(
  response: AssessmentResponseValue | null | undefined
): string | null {
  if (!response) return null;
  if ('notes' in response) {
    return response.notes ?? null;
  }
  if ('comment' in response) {
    return response.comment ?? null;
  }
  return null;
}

export function normalizeAssessmentResponse(
  itemId: string,
  response: AssessmentResponseValue
): AssessmentResponse {
  if ('selected_level' in response) {
    return {
      item_id: response.item_id || itemId,
      selected_level: response.selected_level,
      confidence: response.confidence ?? null,
      notes: response.notes ?? null,
      evidence: response.evidence ?? [],
    };
  }

  const legacy = response as LegacyAssessmentResponse;
  return {
    item_id: itemId,
    selected_level: legacy.level,
    confidence: null,
    notes: legacy.comment ?? null,
    evidence: [],
  };
}

export function normalizeAssessmentResponses(
  responses: Record<string, AssessmentResponseValue>
): Record<string, AssessmentResponse> {
  return Object.entries(responses).reduce<Record<string, AssessmentResponse>>(
    (acc, [itemId, response]) => {
      acc[itemId] = normalizeAssessmentResponse(itemId, response);
      return acc;
    },
    {}
  );
}

// =================== ITEM NORMALIZATION ===================

export function normalizeAssessmentItem(item: AssessmentItemRow): AssessmentItem {
  const allowedLevels = Array.isArray(item.allowed_levels)
    ? item.allowed_levels.map((level) => String(level))
    : [];

  return {
    id: item.id,
    instrument_id: item.instrument_id,
    domain: item.domain,
    item_code: item.item_code,
    question: item.question,
    guidance: item.guidance ?? null,
    allowed_levels: allowedLevels,
    sort_order: item.sort_order,
    is_required: item.required ?? false,
    llm_description: item.llm_description ?? null,
    created_at: item.created_at,
  };
}

// =================== SCHEMA PARSING ===================

export function parseInstrumentSchema(
  schema: unknown
): AssessmentInstrumentSchema | null {
  if (!schema) return null;
  if (typeof schema === 'string') {
    try {
      const parsed = JSON.parse(schema);
      return parsed && typeof parsed === 'object' ? (parsed as AssessmentInstrumentSchema) : null;
    } catch (error) {
      console.warn('[assessment-utils] Invalid instrument schema JSON', error);
      return null;
    }
  }
  if (typeof schema === 'object') {
    return schema as AssessmentInstrumentSchema;
  }
  return null;
}
