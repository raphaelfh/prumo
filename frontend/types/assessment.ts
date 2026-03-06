/**
 * TypeScript types for the quality assessment module (Assessment)
 *
 * This file defines all interfaces and types required for the quality
 * assessment system (PROBAST, QUADAS-2, ROB-2, etc.)
 *
 * Based on the extraction module architecture (DRY + KISS)
 *
 * @see assessment.py (backend schemas)
 * @see extraction.ts (similar types for extraction)
 */

import {z} from 'zod';

// =================== ENUMS ===================

/**
 * Supported assessment instrument types
 */
export type AssessmentInstrumentType =
  | 'PROBAST'        // Prediction model Risk Of Bias Assessment Tool
  | 'QUADAS_2'       // Quality Assessment of Diagnostic Accuracy Studies
  | 'ROB_2'          // Risk of Bias tool (Cochrane)
  | 'ROBINS_I'       // Risk Of Bias In Non-randomized Studies
    | 'CUSTOM';        // Custom instrument

/**
 * Assessment execution mode
 */
export type AssessmentMode =
    | 'human'   // Manual (human)
    | 'ai'      // Automatic (AI)
    | 'hybrid'; // Hybrid (AI + human review)

/**
 * Assessment target mode (per article or per model)
 * Similar to CHARMS which extracts per model
 */
export type AssessmentTargetMode =
    | 'per_article'  // Assess the article as a whole
    | 'per_model';   // Assess each extracted model separately (PROBAST style)

/**
 * Assessment status (aligned with DB enum)
 */
export type AssessmentStatus =
    | 'in_progress'    // In progress
    | 'submitted'      // Submitted (finalized)
    | 'locked'         // Locked (read-only)
    | 'archived';      // Archived

/**
 * AI suggestion status for assessment
 */
export type AssessmentSuggestionStatus = 'pending' | 'accepted' | 'rejected';

/**
 * Common response levels (may vary by instrument)
 */
export type AssessmentLevel =
    | 'Low'           // Low risk
    | 'High'          // High risk
    | 'Unclear'       // Unclear
    | 'Some concerns' // Some concerns
    | 'Yes'           // Yes
    | 'Partially'     // Partially
    | 'No'            // No
    | string;         // Custom

/**
 * AI assessment execution stages
 */
export type AssessmentRunStage =
    | 'assess_single'      // Single item assessment
    | 'assess_batch'       // Batch assessment
    | 'assess_hierarchical'; // Hierarchical assessment (PROBAST per model)

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
 * Assessment instrument (PROBAST, QUADAS-2, etc.)
 * Represents the DB row for assessment_instruments.
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
 * Assessment domain (e.g. Domain 1 of PROBAST)
 * Similar to top-level ExtractionEntityType
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
 * Assessment item (question/criterion)
 * Similar to ExtractionField
 */
export interface AssessmentItem {
  id: string;
  instrument_id: string;
  domain: string;
    item_code: string;         // E.g. "D1.1", "D1.2", "D2.1"
  question: string;
  guidance: string | null;
    allowed_levels: AssessmentLevel[];  // E.g. ["Low", "High", "Unclear"]
  sort_order: number;
  is_required: boolean;
  llm_description: string | null;
  created_at: string;
}

// =================== HUMAN ASSESSMENTS ===================

/**
 * Quality assessment made by a user
 * Similar to ExtractionInstance (but contains multiple responses)
 */
export interface Assessment {
  id: string;
  project_id: string;
  article_id: string;
  user_id: string;
  instrument_id: string | null;
  tool_type: AssessmentInstrumentType;

    // Structured responses per item
  responses: Record<string, AssessmentResponseValue>;  // key: item_id

    // Aggregated overall assessment
  overall_assessment: {
    overall_risk?: AssessmentLevel;
    summary?: string;
    applicability?: string;
  } | null;

  status: AssessmentStatus;
  completion_percentage: number | null;

    // For PROBAST: can be per prediction model
  extraction_instance_id: string | null;

  // Blind review
  is_blind: boolean;

  version: number;
  created_at: string;
  updated_at: string;
}

/**
 * Response to an assessment item
 * Similar to ExtractedValue
 */
export interface AssessmentResponse {
  item_id: string;
  selected_level: AssessmentLevel;
  confidence: number | null;  // 1-5 (humano) ou 0-1 (IA)
  notes: string | null;
  evidence: EvidencePassage[];
}

/**
 * Legacy response format (level/comment)
 */
export interface LegacyAssessmentResponse {
  level: AssessmentLevel;
  comment?: string | null;
}

export type AssessmentResponseValue = AssessmentResponse | LegacyAssessmentResponse;

/**
 * Cited evidence passage
 */
export interface EvidencePassage {
  text: string;
  page_number: number | null;
  source?: string;
}

// =================== AI SUGGESTIONS ===================

/**
 * AI suggestion for assessment (reuses ai_suggestions table)
 * Similar to extraction AISuggestion
 */
export interface AIAssessmentSuggestion {
  id: string;
    assessment_run_id: string;  // FK to ai_assessment_runs
  assessment_item_id: string;  // Effective item ID (global or project-scoped)

    // Structured suggested value
  suggested_value: {
    level: AssessmentLevel;
    evidence_passages: EvidencePassage[];
  };

  confidence_score: number;  // 0-1
  reasoning: string | null;
  status: AssessmentSuggestionStatus;

    // Execution metadata
  metadata_: {
    trace_id?: string;
    ai_model_used?: string;
    processing_time_ms?: number;
    method_used?: 'direct' | 'file_search';
    prompt_tokens?: number;
    completion_tokens?: number;
      extraction_instance_id?: string;  // For PROBAST per model
  };

  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

/**
 * Raw suggestion version (as returned from backend)
 */
export interface AIAssessmentSuggestionRaw {
  id: string;
    assessment_run_id: string;        // FK to ai_assessment_runs
    extraction_run_id: string | null; // FK to extraction_runs (not used for assessment)
  instance_id: string | null;
  field_id: string | null;
    assessment_item_id: string | null;       // FK to assessment_items (global)
    project_assessment_item_id: string | null; // FK to project_assessment_items (project-scoped)
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
 * AI assessment run (tracking)
 * Similar to ExtractionRun
 */
export interface AIAssessmentRun {
  id: string;
  project_id: string;
  article_id: string;
  instrument_id: string;
    extraction_instance_id: string | null;  // For PROBAST per model

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
 * Request for single-item AI assessment
 */
export interface AIAssessmentRequest {
  projectId: string;
  articleId: string;
  assessmentItemId: string;
  instrumentId: string;

    // PDF source (optional, uses article's if not provided)
  pdfStorageKey?: string;
  pdfBase64?: string;
  pdfFilename?: string;
  pdfFileId?: string;

    // Options
  forceFileSearch?: boolean;
  openaiApiKey?: string;  // BYOK
    extractionInstanceId?: string;  // For PROBAST per model
  model?: string;
  temperature?: number;
}

/**
 * AI assessment response
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
 * Request for batch AI assessment
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
 * Batch assessment response
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
 * Request to save human assessment
 */
export interface SaveAssessmentRequest {
  projectId: string;
  articleId: string;
  instrumentId: string;
  responses: Record<string, AssessmentResponse>;
  status?: AssessmentStatus;
  privateNotes?: string;
    extractionInstanceId?: string;  // For PROBAST per model
}

/**
 * Request to review AI suggestion
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
 * Suggestion review response
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
 * Request to list pending suggestions
 */
export interface ListSuggestionsRequest {
  projectId: string;
  articleId: string;
  instrumentId?: string;
  extractionInstanceId?: string;
  status?: AssessmentSuggestionStatus;
}

/**
 * Response with list of suggestions
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

// =================== HISTORY AND COMPARISON ===================

/**
 * Suggestion history item
 * Similar to extraction
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
 * Comparison of assessments from multiple reviewers
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
 * Another user's assessment (for comparison/consensus)
 * Similar to OtherExtraction
 */
export interface OtherAssessment {
  userId: string;
  userName: string;
  responses: Record<string, AssessmentResponseValue>;
  completionPercentage: number;
  isBlind: boolean;
}

// =================== VALIDATION (ZOD SCHEMAS) ===================

/**
 * Zod schema for response validation
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
 * Schema for saving assessment
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
 * Source of assessment response
 * Aligned with PostgreSQL enum 'assessment_source'
 */
export type AssessmentSource = 'human' | 'ai' | 'consensus';

/**
 * Assessment instance (PROBAST per article or per model)
 * Analogous to ExtractionInstance
 */
export interface AssessmentInstance {
  id: string;
  project_id: string;
  article_id: string;
  instrument_id: string;
    extraction_instance_id: string | null;  // Links to model (PROBAST per model)
    parent_instance_id: string | null;      // Hierarchy (optional)

  label: string;  // "PROBAST - Model A", "Domain 1: Participants", etc.
  status: AssessmentStatus;
  reviewer_id: string;

    // Blind mode
  is_blind: boolean;
  can_see_others: boolean;

    // Flexible metadata (overall_risk, applicability_concerns, custom fields)
  metadata: Record<string, unknown>;

  created_at: string;
  updated_at: string;

    // Relationships (when loaded)
  responses?: AssessmentResponseNew[];
  evidence?: AssessmentEvidenceNew[];
}

/**
 * Individual response to an assessment item
 * Analogous to ExtractedValue
 *
 * Full granularity: 1 row = 1 response
 */
export interface AssessmentResponseNew {
  id: string;

    // Intentional denormalization (performance + RLS)
  project_id: string;
  article_id: string;

    // Links
  assessment_instance_id: string;
  assessment_item_id: string;

    // Response
  selected_level: string;  // "Low", "High", "Unclear", etc.
  notes: string | null;
  confidence: number | null;  // 0.0-1.0

    // Source and traceability
  source: AssessmentSource;
    confidence_score: number | null;  // AI score
    ai_suggestion_id: string | null;  // FK to ai_assessments

  reviewer_id: string;
  is_consensus: boolean;

  created_at: string;
  updated_at: string;

    // Relationships (when loaded)
  assessment_instance?: AssessmentInstance;
  evidence?: AssessmentEvidenceNew[];
}

/**
 * Evidence supporting a response or instance
 * Analogous to ExtractionEvidence
 */
export interface AssessmentEvidenceNew {
  id: string;

  project_id: string;
  article_id: string;

    // Polymorphic target
  target_type: 'response' | 'instance';
  target_id: string;

    // PDF evidence
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
 * Request to create assessment instance
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
 * Request to create assessment response
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
 * Request to create multiple responses in batch
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
 * Request to update assessment instance
 */
export interface UpdateAssessmentInstanceRequest {
  label?: string;
  status?: AssessmentStatus;
  metadata?: Record<string, unknown>;
}

/**
 * Request to update assessment response
 */
export interface UpdateAssessmentResponseRequest {
  selected_level?: string;
  notes?: string | null;
  confidence?: number | null;
  is_consensus?: boolean;
}

/**
 * Request to create evidence
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
 * Filters to query assessment instances
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
 * Filters to query assessment responses
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
 * Filters to query evidence
 */
export interface AssessmentEvidenceFilters {
  project_id?: string;
  article_id?: string;
  target_type?: 'response' | 'instance';
  target_id?: string;
}

// =================== COMPUTED/DERIVED TYPES ===================

/**
 * Progress of an assessment instance
 * Returned by calculate_assessment_instance_progress()
 */
export interface AssessmentInstanceProgress {
  total_items: number;
  answered_items: number;
  completion_percentage: number;  // 0-100
}

/**
 * Assessment instance with responses and progress loaded
 * Useful for UI
 */
export interface AssessmentInstanceWithProgress extends AssessmentInstance {
  responses: AssessmentResponseNew[];
  progress: AssessmentInstanceProgress;
}

/**
 * Assessment instance hierarchy
 * For tree rendering (e.g. PROBAST root → Domains)
 */
export interface AssessmentInstanceHierarchy {
  instance: AssessmentInstance;
  children: AssessmentInstanceHierarchy[];
  progress: AssessmentInstanceProgress;
}

// =================== ZOD SCHEMAS (NEW API) ===================

/**
 * Zod schema to create assessment instance
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
 * Zod schema to create assessment response
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
 * Zod schema for bulk create responses
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
 * Project assessment instrument item
 * Cloned from global or custom
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
 * Project assessment instrument
 * Cloned from global (PROBAST, ROBIS) or custom
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
 * Global instrument summary for selection
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
 * Request to clone global instrument
 */
export interface CloneInstrumentRequest {
  projectId: string;
  globalInstrumentId: string;
  customName?: string | null;
}

/**
 * Clone instrument response
 */
export interface CloneInstrumentResponse {
  projectInstrumentId: string;
  message: string;
}

/**
 * Request to create custom instrument
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
 * Request to create instrument item
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
 * Request to update instrument
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
 * Request to update item
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
 * Zod schema for clone instrument request
 */
export const CloneInstrumentRequestSchema = z.object({
  projectId: z.string().uuid(),
  globalInstrumentId: z.string().uuid(),
  customName: z.string().min(1).max(255).nullable().optional(),
});

/**
 * Zod schema for create project instrument
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
