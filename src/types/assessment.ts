/**
 * Tipos TypeScript para o módulo de avaliação de qualidade (Assessment)
 *
 * Este arquivo define todas as interfaces e tipos necessários
 * para o sistema de avaliação de qualidade de estudos (PROBAST, QUADAS-2, ROB-2, etc.)
 *
 * Baseado na arquitetura do módulo de extração (DRY + KISS)
 *
 * @see assessment.py (backend schemas)
 * @see extraction.ts (tipos similares para extração)
 */

import { z } from 'zod';

// =================== ENUMS ===================

/**
 * Tipos de instrumentos de avaliação suportados
 */
export type AssessmentInstrumentType =
  | 'PROBAST'        // Prediction model Risk Of Bias Assessment Tool
  | 'QUADAS_2'       // Quality Assessment of Diagnostic Accuracy Studies
  | 'ROB_2'          // Risk of Bias tool (Cochrane)
  | 'ROBINS_I'       // Risk Of Bias In Non-randomized Studies
  | 'CUSTOM';        // Instrumento customizado

/**
 * Modo de execução do assessment
 */
export type AssessmentMode =
  | 'human'   // Manual (humano)
  | 'ai'      // Automático (IA)
  | 'hybrid'; // Híbrido (IA + revisão humana)

/**
 * Status da avaliação (alinhado com enum do banco)
 */
export type AssessmentStatus =
  | 'in_progress'    // Em progresso
  | 'submitted'      // Submetida (finalizada)
  | 'locked'         // Travada (read-only)
  | 'archived';      // Arquivada

/**
 * Status de sugestão de IA para assessment
 */
export type AssessmentSuggestionStatus = 'pending' | 'accepted' | 'rejected';

/**
 * Níveis de resposta comuns (podem variar por instrumento)
 */
export type AssessmentLevel =
  | 'Low'           // Baixo risco
  | 'High'          // Alto risco
  | 'Unclear'       // Não claro
  | 'Some concerns' // Algumas preocupações
  | 'Yes'           // Sim
  | 'Partially'     // Parcialmente
  | 'No'            // Não
  | string;         // Customizado

/**
 * Stages de execução de AI assessment
 */
export type AssessmentRunStage =
  | 'assess_single'      // Avaliação de item único
  | 'assess_batch'       // Avaliação em batch
  | 'assess_hierarchical'; // Avaliação hierárquica (PROBAST por modelo)

export type AssessmentRunStatus = 'pending' | 'running' | 'completed' | 'failed';

// =================== INSTRUMENTOS ===================

export interface AssessmentInstrumentSchemaDomain {
  code: string;
  name: string;
  description?: string | null;
  sort_order?: number;
}

export interface AssessmentInstrumentSchema {
  domains?: AssessmentInstrumentSchemaDomain[];
}

/**
 * Instrumento de avaliação (PROBAST, QUADAS-2, etc.)
 * Representa a linha do banco para assessment_instruments.
 */
export interface AssessmentInstrument {
  id: string;
  tool_type: AssessmentInstrumentType;
  name: string;
  version: string;
  mode: AssessmentMode;
  is_active: boolean;
  aggregation_rules: Record<string, unknown> | null;
  schema: AssessmentInstrumentSchema | null;
  created_at: string;
}

/**
 * Domínio de avaliação (ex: Domain 1 do PROBAST)
 * Similar a ExtractionEntityType de nível superior
 */
export interface AssessmentDomain {
  id: string;
  instrument_id: string;
  name: string;
  label: string;
  description: string | null;
  sort_order: number;
  items: AssessmentItem[];
  created_at: string;
}

/**
 * Item de avaliação (pergunta/critério)
 * Similar a ExtractionField
 */
export interface AssessmentItem {
  id: string;
  instrument_id: string;
  domain: string;
  item_code: string;         // Ex: "D1.1", "D1.2", "D2.1"
  question: string;
  guidance: string | null;
  allowed_levels: AssessmentLevel[];  // Ex: ["Low", "High", "Unclear"]
  sort_order: number;
  is_required: boolean;
  llm_description: string | null;
  created_at: string;
}

// =================== AVALIAÇÕES HUMANAS ===================

/**
 * Avaliação de qualidade feita por um usuário
 * Similar a ExtractionInstance (mas contém múltiplas respostas)
 */
export interface Assessment {
  id: string;
  project_id: string;
  article_id: string;
  user_id: string;
  instrument_id: string | null;
  tool_type: AssessmentInstrumentType;

  // Respostas estruturadas por item
  responses: Record<string, AssessmentResponseValue>;  // key: item_id

  // Avaliação geral agregada
  overall_assessment: {
    overall_risk?: AssessmentLevel;
    summary?: string;
    applicability?: string;
  } | null;

  status: AssessmentStatus;
  completion_percentage: number | null;

  // Para PROBAST: pode ser por modelo de predição
  extraction_instance_id: string | null;

  // Blind review
  is_blind: boolean;

  version: number;
  created_at: string;
  updated_at: string;
}

/**
 * Resposta a um item de avaliação
 * Similar a ExtractedValue
 */
export interface AssessmentResponse {
  item_id: string;
  selected_level: AssessmentLevel;
  confidence: number | null;  // 1-5 (humano) ou 0-1 (IA)
  notes: string | null;
  evidence: EvidencePassage[];
}

/**
 * Formato legado de respostas (level/comment)
 */
export interface LegacyAssessmentResponse {
  level: AssessmentLevel;
  comment?: string | null;
}

export type AssessmentResponseValue = AssessmentResponse | LegacyAssessmentResponse;

/**
 * Passagem de evidência citada
 */
export interface EvidencePassage {
  text: string;
  page_number: number | null;
  source?: string;
}

// =================== SUGESTÕES DE IA ===================

/**
 * Sugestão de IA para assessment (reusa ai_suggestions table)
 * Similar a AISuggestion de extraction
 */
export interface AIAssessmentSuggestion {
  id: string;
  run_id: string;
  assessment_item_id: string;  // FK para assessment_items

  // Valor sugerido estruturado
  suggested_value: {
    level: AssessmentLevel;
    evidence_passages: EvidencePassage[];
  };

  confidence_score: number;  // 0-1
  reasoning: string | null;
  status: AssessmentSuggestionStatus;

  // Metadata de execução
  metadata_: {
    trace_id?: string;
    ai_model_used?: string;
    processing_time_ms?: number;
    method_used?: 'direct' | 'file_search';
    prompt_tokens?: number;
    completion_tokens?: number;
    extraction_instance_id?: string;  // Para PROBAST por modelo
  };

  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

/**
 * Versão raw da sugestão (como vem do backend)
 */
export interface AIAssessmentSuggestionRaw {
  id: string;
  run_id: string;
  instance_id: string | null;
  field_id: string | null;
  assessment_item_id: string;
  suggested_value: unknown;
  confidence_score: number | null;
  reasoning: string | null;
  status: AssessmentSuggestionStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  metadata_: unknown;
  created_at: string;
}

/**
 * Execução de AI assessment (tracking)
 * Similar a ExtractionRun
 */
export interface AIAssessmentRun {
  id: string;
  project_id: string;
  article_id: string;
  instrument_id: string;
  extraction_instance_id: string | null;  // Para PROBAST por modelo

  stage: AssessmentRunStage;
  status: AssessmentRunStatus;

  parameters: {
    assessment_item_id?: string;
    item_ids?: string[];
    model?: string;
    items_count?: number;
    force_file_search?: boolean;
  };

  results: {
    suggestion_id?: string;
    suggestion_ids?: string[];
    selected_level?: string;
    tokens_prompt?: number;
    tokens_completion?: number;
    tokens_total?: number;
    ai_duration_ms?: number;
    total_duration_ms?: number;
    method_used?: string;
    items_completed?: number;
    items_failed?: number;
  };

  started_at: string | null;
  completed_at: string | null;
  created_by: string;
  created_at: string;
}

// =================== REQUESTS/RESPONSES ===================

/**
 * Request para avaliação AI de item único
 */
export interface AIAssessmentRequest {
  projectId: string;
  articleId: string;
  assessmentItemId: string;
  instrumentId: string;

  // PDF source (opcional, usa do artigo se não fornecido)
  pdfStorageKey?: string;
  pdfBase64?: string;
  pdfFilename?: string;
  pdfFileId?: string;

  // Opções
  forceFileSearch?: boolean;
  openaiApiKey?: string;  // BYOK
  extractionInstanceId?: string;  // Para PROBAST por modelo
  model?: string;
  temperature?: number;
}

/**
 * Response de avaliação AI
 */
export interface AIAssessmentResponse {
  ok: boolean;
  data?: {
    id: string;  // suggestion_id
    selectedLevel: AssessmentLevel;
    confidenceScore: number;
    justification: string;
    evidencePassages: EvidencePassage[];
    status: string;
    metadata: {
      processingTimeMs: number;
      tokensPrompt: number;
      tokensCompletion: number;
      methodUsed: string;
    };
  };
  error?: {
    code: string;
    message: string;
  };
  traceId?: string;
}

/**
 * Request para avaliação AI em batch
 */
export interface BatchAIAssessmentRequest {
  projectId: string;
  articleId: string;
  instrumentId: string;
  itemIds: string[];

  pdfStorageKey?: string;
  openaiApiKey?: string;
  extractionInstanceId?: string;
  model?: string;
  forceFileSearch?: boolean;
}

/**
 * Response de batch assessment
 */
export interface BatchAIAssessmentResponse {
  ok: boolean;
  data?: {
    results: AIAssessmentResponse['data'][];
    totalItems: number;
    successfulItems: number;
  };
  error?: {
    code: string;
    message: string;
  };
  traceId?: string;
}

/**
 * Request para salvar assessment humano
 */
export interface SaveAssessmentRequest {
  projectId: string;
  articleId: string;
  instrumentId: string;
  responses: Record<string, AssessmentResponse>;
  status?: AssessmentStatus;
  privateNotes?: string;
  extractionInstanceId?: string;  // Para PROBAST por modelo
}

/**
 * Request para revisar sugestão de IA
 */
export interface ReviewAISuggestionRequest {
  action: 'accept' | 'reject' | 'modify';
  modifiedValue?: {
    level: AssessmentLevel;
    confidence_score?: number;
    evidence_passages?: EvidencePassage[];
  };
  reviewNotes?: string;
}

/**
 * Response de revisão de sugestão
 */
export interface ReviewAISuggestionResponse {
  ok: boolean;
  data?: {
    suggestionId: string;
    action: string;
    assessmentCreated: boolean;
    assessmentId?: string;
  };
  error?: {
    code: string;
    message: string;
  };
  traceId?: string;
}

/**
 * Request para listar sugestões pendentes
 */
export interface ListSuggestionsRequest {
  projectId: string;
  articleId: string;
  instrumentId?: string;
  extractionInstanceId?: string;
  status?: AssessmentSuggestionStatus;
}

/**
 * Response com lista de sugestões
 */
export interface ListSuggestionsResponse {
  ok: boolean;
  data?: {
    suggestions: AIAssessmentSuggestion[];
    total: number;
  };
  error?: {
    code: string;
    message: string;
  };
  traceId?: string;
}

// =================== HISTÓRICO E COMPARAÇÃO ===================

/**
 * Item de histórico de sugestões
 * Similar ao de extraction
 */
export interface AIAssessmentSuggestionHistoryItem {
  id: string;
  value: {
    level: AssessmentLevel;
    evidence_passages: EvidencePassage[];
  };
  confidence: number;
  reasoning: string;
  status: AssessmentSuggestionStatus;
  timestamp: Date;
  reviewedBy?: string;
  reviewedAt?: Date;
}

/**
 * Comparação de assessments de múltiplos revisores
 */
export interface AssessmentComparison {
  articleId: string;
  instrumentId: string;
  assessments: Array<{
    userId: string;
    userName: string;
    responses: Record<string, AssessmentResponse>;
    completionPercentage: number;
  }>;
  agreements: Record<string, {  // key: item_id
    level: 'full' | 'partial' | 'none';
    values: AssessmentLevel[];
  }>;
}

/**
 * Assessment de outro usuário (para comparação/consenso)
 * Similar a OtherExtraction
 */
export interface OtherAssessment {
  userId: string;
  userName: string;
  responses: Record<string, AssessmentResponseValue>;
  completionPercentage: number;
  isBlind: boolean;
}

// =================== VALIDAÇÃO (ZOD SCHEMAS) ===================

/**
 * Schema Zod para validação de resposta
 */
export const AssessmentResponseSchema = z.object({
  item_id: z.string().uuid(),
  selected_level: z.string().min(1),
  confidence: z.number().min(1).max(5).nullable(),
  notes: z.string().nullable(),
  evidence: z.array(z.object({
    text: z.string(),
    page_number: z.number().nullable(),
    source: z.string().optional(),
  })),
});

/**
 * Schema para salvar assessment
 */
export const SaveAssessmentRequestSchema = z.object({
  projectId: z.string().uuid(),
  articleId: z.string().uuid(),
  instrumentId: z.string().uuid(),
  responses: z.record(AssessmentResponseSchema),
  status: z.enum(['in_progress', 'submitted']).optional(),
  privateNotes: z.string().optional(),
  extractionInstanceId: z.string().uuid().optional(),
});
