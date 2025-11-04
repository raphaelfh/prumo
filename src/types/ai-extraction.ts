/**
 * Tipos TypeScript centralizados para AI Extraction
 * 
 * Este arquivo consolida todos os tipos relacionados à extração com IA,
 * focando exclusivamente no pipeline de section-extraction (extração granular por seção).
 * 
 * FONTE ÚNICA DA VERDADE: Todos os tipos de AI extraction devem ser definidos aqui.
 * 
 * ARQUITETURA:
 * - Tipos Raw: Representam dados exatamente como vêm do banco (AISuggestionRaw, ExtractionRunRaw)
 * - Tipos Processados: Valores normalizados para uso no frontend (AISuggestion, ExtractionRun)
 * - Utilitários: Funções para converter entre raw e processado (normalizeAISuggestion, etc.)
 * 
 * @example
 * ```typescript
 * // Usar tipos processados em componentes
 * const suggestion: AISuggestion = {
 *   id: '...',
 *   runId: '...',
 *   value: 'extracted value',
 *   confidence: 0.95,
 *   reasoning: '...',
 *   status: 'pending',
 *   timestamp: new Date(),
 * };
 * 
 * // Normalizar dados do banco
 * const normalized = normalizeAISuggestion(rawSuggestionFromDB);
 * ```
 */

// =================== ENUMS ===================

export type SuggestionStatus = 'pending' | 'accepted' | 'rejected';
export type ExtractionRunStatus = 'pending' | 'running' | 'completed' | 'failed';
export type ExtractionRunStage = 'data_suggest' | 'parsing' | 'validation' | 'consensus';

/**
 * Modelos suportados para extração com IA
 */
export type SupportedAIModel = 'gpt-4o-mini' | 'gpt-4o' | 'gpt-5';

// =================== SUGESTÕES DE IA ===================

/**
 * Sugestão de IA como retornada do banco de dados (raw)
 * Representa a estrutura exata da tabela ai_suggestions
 */
export interface AISuggestionRaw {
  id: string;
  run_id: string;
  instance_id: string | null;
  field_id: string;
  suggested_value: {
    value: any;
  } | any; // Pode ser {value: X} ou direto dependendo do contexto
  confidence_score: number | null;
  reasoning: string | null;
  status: SuggestionStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  metadata?: {
    evidence?: {
      text: string;
      page_number?: number | null;
    };
  } | null;
}

/**
 * Sugestão de IA processada para uso no frontend
 * Valores normalizados e formatados para facilitar uso em componentes
 */
export interface AISuggestion {
  id: string;
  runId: string;
  value: any; // Valor extraído e normalizado (não o objeto {value: X})
  confidence: number; // confidence_score normalizado (0-1), padrão 0 se null
  reasoning: string; // reasoning normalizado (string vazia se null)
  status: SuggestionStatus;
  timestamp: Date; // created_at convertido para Date
  evidence?: {
    text: string;
    pageNumber?: number | null;
  };
}

/**
 * Item do histórico de sugestões
 * Extende AISuggestion mantendo compatibilidade
 */
export interface AISuggestionHistoryItem extends AISuggestion {
  // Adicionar campos específicos do histórico se necessário no futuro
}

// =================== EXECUÇÕES DE EXTRAÇÃO ===================

/**
 * Execução de extração como retornada do banco (raw)
 * Representa a estrutura da tabela extraction_runs
 */
export interface ExtractionRunRaw {
  id: string;
  project_id: string;
  article_id: string;
  template_id: string;
  stage: ExtractionRunStage;
  status: ExtractionRunStatus;
  parameters: {
    model?: SupportedAIModel;
    entityTypeId?: string;
    [key: string]: any;
  };
  results: {
    suggestions_created?: number;
    tokens_used?: number;
    pdf_pages?: number;
    duration?: number;
    error_message?: string;
    [key: string]: any;
  };
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_by: string;
  created_at: string;
}

/**
 * Execução de extração processada para uso no frontend
 */
export interface ExtractionRun {
  id: string;
  projectId: string;
  articleId: string;
  templateId: string;
  stage: ExtractionRunStage;
  status: ExtractionRunStatus;
  metadata: {
    suggestionsCreated?: number;
    tokensUsed?: number;
    pdfPages?: number;
    duration?: number;
    errorMessage?: string;
  } | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

// =================== REQUESTS E RESPONSES ===================

/**
 * Request para extração de seção específica
 * Usado para chamar a edge function section-extraction
 */
export interface SectionExtractionRequest {
  projectId: string;
  articleId: string;
  templateId: string;
  entityTypeId: string;
  parentInstanceId?: string; // Nova: para filtrar child entities por modelo
  options?: {
    model?: SupportedAIModel;
  };
}

/**
 * Response da edge function section-extraction
 */
export interface SectionExtractionResponse {
  ok: boolean;
  data?: {
    runId: string;
    status: 'completed' | 'partial' | 'failed';
    suggestionsCreated: number;
    metadata: {
      pdfPages: number;
      tokensUsed: number;
      duration: number;
    };
  };
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  traceId?: string;
}

/**
 * Request para extração de modelos de predição
 */
export interface ModelExtractionRequest {
  projectId: string;
  articleId: string;
  templateId: string;
  options?: {
    model?: SupportedAIModel;
  };
}

/**
 * Response da extração de modelos
 */
export interface ModelExtractionResponse {
  ok: boolean;
  data?: {
    runId: string;
    modelsCreated: Array<{
      instanceId: string;
      modelName: string;
      modellingMethod?: string;
    }>;
    childInstancesCreated: number;
    metadata?: {
      tokensPrompt?: number;
      tokensCompletion?: number;
      tokensUsed?: number;
      duration?: number;
      modelsFound?: number;
      [key: string]: any;
    };
  };
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  traceId?: string;
}

// =================== TIPOS PARA HOOKS ===================

/**
 * Props para o hook useAISuggestions
 */
export interface UseAISuggestionsProps {
  articleId: string;
  projectId: string;
  enabled?: boolean;
  onSuggestionAccepted?: (instanceId: string, fieldId: string, value: any) => void;
}

/**
 * Retorno do hook useAISuggestions
 */
export interface UseAISuggestionsReturn {
  suggestions: Record<string, AISuggestion>; // key: `${instanceId}_${fieldId}`
  loading: boolean;
  acceptSuggestion: (instanceId: string, fieldId: string) => Promise<void>;
  rejectSuggestion: (instanceId: string, fieldId: string) => Promise<void>;
  batchAccept: (threshold?: number) => Promise<void>;
  getSuggestionsHistory: (instanceId: string, fieldId: string) => Promise<AISuggestionHistoryItem[]>;
  getLatestSuggestion: (instanceId: string, fieldId: string) => AISuggestion | undefined;
  refresh: () => Promise<LoadSuggestionsResult>; // Retorna resultado diretamente para polling eficiente
  isActionLoading: (instanceId: string, fieldId: string) => 'accept' | 'reject' | null; // Verifica se ação está em loading
}

export interface LoadSuggestionsResult {
  suggestions: Record<string, AISuggestion>;
  count: number;
}

/**
 * Props para o hook useExtractionRuns
 */
export interface UseExtractionRunsProps {
  articleId: string;
  templateId: string;
  enabled?: boolean;
}

/**
 * Retorno do hook useExtractionRuns
 */
export interface UseExtractionRunsReturn {
  runs: ExtractionRun[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

// =================== TIPOS PARA COMPONENTES ===================

/**
 * Props para componentes que exibem sugestões de IA
 */
export interface AISuggestionDisplayProps {
  instanceId: string;
  fieldId: string;
  suggestion: AISuggestion;
  onAccept?: () => void;
  onReject?: () => void;
  getHistory?: (instanceId: string, fieldId: string) => Promise<AISuggestionHistoryItem[]>;
  loading?: boolean;
}

// =================== UTILIDADES ===================

/**
 * Chave única para identificar uma sugestão no mapa
 */
export function getSuggestionKey(instanceId: string, fieldId: string): string {
  return `${instanceId}_${fieldId}`;
}

/**
 * Parse de suggested_value do banco para valor normalizado
 * Lida com diferentes formatos: {value: X} ou valor direto
 */
export function parseSuggestedValue(rawValue: any): any {
  if (rawValue === null || rawValue === undefined) {
    return '';
  }
  
  // Se for objeto com propriedade 'value', extrair o valor
  if (typeof rawValue === 'object' && 'value' in rawValue) {
    return rawValue.value ?? '';
  }
  
  // Caso contrário, retornar o valor direto
  return rawValue;
}

/**
 * Normaliza uma sugestão raw do banco para o formato processado
 */
export function normalizeAISuggestion(raw: AISuggestionRaw): AISuggestion {
  return {
    id: raw.id,
    runId: raw.run_id,
    value: parseSuggestedValue(raw.suggested_value),
    confidence: raw.confidence_score ?? 0,
    reasoning: raw.reasoning ?? '',
    status: raw.status,
    timestamp: new Date(raw.created_at),
    evidence: raw.metadata?.evidence
      ? {
          text: raw.metadata.evidence.text,
          pageNumber: raw.metadata.evidence.page_number ?? null,
        }
      : undefined,
  };
}

/**
 * Normaliza um run raw do banco para o formato processado
 */
export function normalizeExtractionRun(raw: ExtractionRunRaw): ExtractionRun {
  return {
    id: raw.id,
    projectId: raw.project_id,
    articleId: raw.article_id,
    templateId: raw.template_id,
    stage: raw.stage,
    status: raw.status,
    metadata: raw.results
      ? {
          suggestionsCreated: raw.results.suggestions_created,
          tokensUsed: raw.results.tokens_used,
          pdfPages: raw.results.pdf_pages,
          duration: raw.results.duration,
          errorMessage: raw.results.error_message,
        }
      : null,
    startedAt: raw.started_at,
    completedAt: raw.completed_at,
    createdAt: raw.created_at,
  };
}

