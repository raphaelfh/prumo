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
 * Modo de alvo do assessment (por artigo ou por modelo)
 * Similar ao CHARMS que extrai por modelo
 */
export type AssessmentTargetMode =
  | 'per_article'  // Avalia o artigo como um todo
  | 'per_model';   // Avalia cada modelo extraído separadamente (PROBAST style)

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
  assessment_run_id: string;  // FK para ai_assessment_runs
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
  assessment_run_id: string;        // FK para ai_assessment_runs
  extraction_run_id: string | null; // FK para extraction_runs (não usado para assessment)
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

// =================== NEW TYPES (Assessment 2.0 - Extraction Pattern) ===================

/**
 * Origem da resposta de assessment
 * Alinhado com enum 'assessment_source' do PostgreSQL
 */
export type AssessmentSource = 'human' | 'ai' | 'consensus';

/**
 * Instância de avaliação (PROBAST por artigo ou por modelo)
 * Análogo a ExtractionInstance
 */
export interface AssessmentInstance {
  id: string;
  project_id: string;
  article_id: string;
  instrument_id: string;
  extraction_instance_id: string | null;  // Vincula ao modelo (PROBAST por modelo)
  parent_instance_id: string | null;      // Hierarquia (opcional)

  label: string;  // "PROBAST - Model A", "Domain 1: Participants", etc.
  status: AssessmentStatus;
  reviewer_id: string;

  // Modo cego
  is_blind: boolean;
  can_see_others: boolean;

  // Metadados flexíveis (overall_risk, applicability_concerns, custom fields)
  metadata: Record<string, unknown>;

  created_at: string;
  updated_at: string;

  // Relationships (quando carregadas)
  responses?: AssessmentResponseNew[];
  evidence?: AssessmentEvidenceNew[];
}

/**
 * Resposta individual a um item de avaliação
 * Análogo a ExtractedValue
 *
 * Granularidade total: 1 linha = 1 resposta
 */
export interface AssessmentResponseNew {
  id: string;

  // Denormalização intencional (performance + RLS)
  project_id: string;
  article_id: string;

  // Vinculação
  assessment_instance_id: string;
  assessment_item_id: string;

  // Resposta
  selected_level: string;  // "Low", "High", "Unclear", etc.
  notes: string | null;
  confidence: number | null;  // 0.0-1.0

  // Origem e rastreabilidade
  source: AssessmentSource;
  confidence_score: number | null;  // Score de IA
  ai_suggestion_id: string | null;  // FK para ai_assessments

  reviewer_id: string;
  is_consensus: boolean;

  created_at: string;
  updated_at: string;

  // Relationships (quando carregadas)
  assessment_instance?: AssessmentInstance;
  evidence?: AssessmentEvidenceNew[];
}

/**
 * Evidência que suporta resposta ou instance
 * Análogo a ExtractionEvidence
 */
export interface AssessmentEvidenceNew {
  id: string;

  project_id: string;
  article_id: string;

  // Alvo polimórfico
  target_type: 'response' | 'instance';
  target_id: string;

  // Evidência do PDF
  article_file_id: string | null;
  page_number: number | null;
  position: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  } | null;
  text_content: string | null;

  created_by: string;
  created_at: string;
}

// =================== CREATE/UPDATE REQUESTS (NEW API) ===================

/**
 * Request para criar assessment instance
 */
export interface CreateAssessmentInstanceRequest {
  project_id: string;
  article_id: string;
  instrument_id: string;
  extraction_instance_id?: string | null;
  parent_instance_id?: string | null;
  label: string;
  is_blind?: boolean;
  can_see_others?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Request para criar assessment response
 */
export interface CreateAssessmentResponseRequest {
  project_id: string;
  article_id: string;
  assessment_instance_id: string;
  assessment_item_id: string;
  selected_level: string;
  notes?: string | null;
  confidence?: number | null;
  source?: AssessmentSource;
  ai_suggestion_id?: string | null;
}

/**
 * Request para criar múltiplas responses em batch
 */
export interface BulkCreateAssessmentResponsesRequest {
  project_id: string;
  article_id: string;
  assessment_instance_id: string;
  responses: Array<{
    assessment_item_id: string;
    selected_level: string;
    notes?: string | null;
    confidence?: number | null;
    source?: AssessmentSource;
    ai_suggestion_id?: string | null;
  }>;
}

/**
 * Request para atualizar assessment instance
 */
export interface UpdateAssessmentInstanceRequest {
  label?: string;
  status?: AssessmentStatus;
  metadata?: Record<string, unknown>;
}

/**
 * Request para atualizar assessment response
 */
export interface UpdateAssessmentResponseRequest {
  selected_level?: string;
  notes?: string | null;
  confidence?: number | null;
  is_consensus?: boolean;
}

/**
 * Request para criar evidência
 */
export interface CreateAssessmentEvidenceRequest {
  project_id: string;
  article_id: string;
  target_type: 'response' | 'instance';
  target_id: string;
  article_file_id?: string | null;
  page_number?: number | null;
  position?: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  } | null;
  text_content?: string | null;
}

// =================== QUERY FILTERS ===================

/**
 * Filtros para buscar assessment instances
 */
export interface AssessmentInstanceFilters {
  project_id?: string;
  article_id?: string;
  instrument_id?: string;
  extraction_instance_id?: string;
  parent_instance_id?: string;
  reviewer_id?: string;
  status?: AssessmentStatus;
}

/**
 * Filtros para buscar assessment responses
 */
export interface AssessmentResponseFilters {
  project_id?: string;
  article_id?: string;
  assessment_instance_id?: string;
  assessment_item_id?: string;
  reviewer_id?: string;
  source?: AssessmentSource;
  selected_level?: string;
}

/**
 * Filtros para buscar evidências
 */
export interface AssessmentEvidenceFilters {
  project_id?: string;
  article_id?: string;
  target_type?: 'response' | 'instance';
  target_id?: string;
}

// =================== COMPUTED/DERIVED TYPES ===================

/**
 * Progresso de uma assessment instance
 * Retornado pela função calculate_assessment_instance_progress()
 */
export interface AssessmentInstanceProgress {
  total_items: number;
  answered_items: number;
  completion_percentage: number;  // 0-100
}

/**
 * Assessment instance com responses e progresso carregados
 * Útil para UI
 */
export interface AssessmentInstanceWithProgress extends AssessmentInstance {
  responses: AssessmentResponseNew[];
  progress: AssessmentInstanceProgress;
}

/**
 * Hierarquia de assessment instances
 * Para renderização em árvore (ex: PROBAST root → Domains)
 */
export interface AssessmentInstanceHierarchy {
  instance: AssessmentInstance;
  children: AssessmentInstanceHierarchy[];
  progress: AssessmentInstanceProgress;
}

// =================== ZOD SCHEMAS (NEW API) ===================

/**
 * Schema Zod para criar assessment instance
 */
export const CreateAssessmentInstanceSchema = z.object({
  project_id: z.string().uuid(),
  article_id: z.string().uuid(),
  instrument_id: z.string().uuid(),
  extraction_instance_id: z.string().uuid().nullable().optional(),
  parent_instance_id: z.string().uuid().nullable().optional(),
  label: z.string().min(1).max(255),
  is_blind: z.boolean().optional(),
  can_see_others: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Schema Zod para criar assessment response
 */
export const CreateAssessmentResponseSchema = z.object({
  project_id: z.string().uuid(),
  article_id: z.string().uuid(),
  assessment_instance_id: z.string().uuid(),
  assessment_item_id: z.string().uuid(),
  selected_level: z.string().min(1),
  notes: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  source: z.enum(['human', 'ai', 'consensus']).optional(),
  ai_suggestion_id: z.string().uuid().nullable().optional(),
});

/**
 * Schema Zod para bulk create responses
 */
export const BulkCreateAssessmentResponsesSchema = z.object({
  project_id: z.string().uuid(),
  article_id: z.string().uuid(),
  assessment_instance_id: z.string().uuid(),
  responses: z.array(
    z.object({
      assessment_item_id: z.string().uuid(),
      selected_level: z.string().min(1),
      notes: z.string().nullable().optional(),
      confidence: z.number().min(0).max(1).nullable().optional(),
      source: z.enum(['human', 'ai', 'consensus']).optional(),
      ai_suggestion_id: z.string().uuid().nullable().optional(),
    })
  ).min(1),
});

// =================== PROJECT ASSESSMENT INSTRUMENTS ===================

/**
 * Item de instrumento de avaliação de projeto
 * Clonado de global ou customizado
 */
export interface ProjectAssessmentItem {
  id: string;
  projectInstrumentId: string;
  globalItemId: string | null;
  domain: string;
  itemCode: string;
  question: string;
  description: string | null;
  sortOrder: number;
  required: boolean;
  allowedLevels: string[];
  llmPrompt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Instrumento de avaliação de projeto
 * Clonado de global (PROBAST, ROBIS) ou customizado
 */
export interface ProjectAssessmentInstrument {
  id: string;
  projectId: string;
  globalInstrumentId: string | null;
  name: string;
  description: string | null;
  toolType: string;  // PROBAST, ROBIS, CUSTOM
  version: string;
  mode: AssessmentMode;
  targetMode: AssessmentTargetMode;  // per_article or per_model
  isActive: boolean;
  aggregationRules: Record<string, unknown> | null;
  schema: Record<string, unknown> | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  items: ProjectAssessmentItem[];
}

/**
 * Resumo de instrumento global para seleção
 */
export interface GlobalInstrumentSummary {
  id: string;
  toolType: string;
  name: string;
  version: string;
  mode: AssessmentMode;
  targetMode: AssessmentTargetMode;  // per_article or per_model
  itemsCount: number;
  domains: string[];
}

/**
 * Request para clonar instrumento global
 */
export interface CloneInstrumentRequest {
  projectId: string;
  globalInstrumentId: string;
  customName?: string | null;
}

/**
 * Response de clone de instrumento
 */
export interface CloneInstrumentResponse {
  projectInstrumentId: string;
  message: string;
}

/**
 * Request para criar instrumento customizado
 */
export interface CreateProjectInstrumentRequest {
  projectId: string;
  globalInstrumentId?: string | null;
  name: string;
  description?: string | null;
  toolType: string;
  version?: string;
  mode?: AssessmentMode;
  targetMode?: AssessmentTargetMode;  // per_article or per_model
  isActive?: boolean;
  aggregationRules?: Record<string, unknown> | null;
  schema?: Record<string, unknown> | null;
  items?: CreateProjectItemRequest[];
}

/**
 * Request para criar item de instrumento
 */
export interface CreateProjectItemRequest {
  globalItemId?: string | null;
  domain: string;
  itemCode: string;
  question: string;
  description?: string | null;
  sortOrder?: number;
  required?: boolean;
  allowedLevels: string[];
  llmPrompt?: string | null;
}

/**
 * Request para atualizar instrumento
 */
export interface UpdateProjectInstrumentRequest {
  name?: string;
  description?: string | null;
  version?: string;
  mode?: AssessmentMode;
  targetMode?: AssessmentTargetMode;  // per_article or per_model
  isActive?: boolean;
  aggregationRules?: Record<string, unknown> | null;
  schema?: Record<string, unknown> | null;
}

/**
 * Request para atualizar item
 */
export interface UpdateProjectItemRequest {
  domain?: string;
  itemCode?: string;
  question?: string;
  description?: string | null;
  sortOrder?: number;
  required?: boolean;
  allowedLevels?: string[];
  llmPrompt?: string | null;
}

/**
 * Schema Zod para clone instrument request
 */
export const CloneInstrumentRequestSchema = z.object({
  projectId: z.string().uuid(),
  globalInstrumentId: z.string().uuid(),
  customName: z.string().min(1).max(255).nullable().optional(),
});

/**
 * Schema Zod para create project instrument
 */
export const CreateProjectInstrumentRequestSchema = z.object({
  projectId: z.string().uuid(),
  globalInstrumentId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(255),
  description: z.string().nullable().optional(),
  toolType: z.string().min(1),
  version: z.string().optional().default('1.0.0'),
  mode: z.enum(['human', 'ai', 'hybrid']).optional().default('human'),
  isActive: z.boolean().optional().default(true),
  aggregationRules: z.record(z.unknown()).nullable().optional(),
  schema: z.record(z.unknown()).nullable().optional(),
  items: z.array(z.object({
    globalItemId: z.string().uuid().nullable().optional(),
    domain: z.string().min(1),
    itemCode: z.string().min(1),
    question: z.string().min(1),
    description: z.string().nullable().optional(),
    sortOrder: z.number().optional(),
    required: z.boolean().optional().default(true),
    allowedLevels: z.array(z.string().min(1)),
    llmPrompt: z.string().nullable().optional(),
  })).optional(),
});
