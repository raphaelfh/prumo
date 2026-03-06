/**
 * Centralized TypeScript types for AI Extraction
 *
 * This file consolidates all types related to AI extraction,
 * focusing on the section-extraction pipeline (granular extraction per section).
 *
 * SINGLE SOURCE OF TRUTH: All AI extraction types must be defined here.
 *
 * ARCHITECTURE:
 * - Raw types: Data exactly as from the DB (AISuggestionRaw, ExtractionRunRaw)
 * - Processed types: Values normalized for frontend use (AISuggestion, ExtractionRun)
 * - Utilities: Functions to convert between raw and processed (normalizeAISuggestion, etc.)
 *
 * @example
 * ```typescript
 * const suggestion: AISuggestion = { ... };
 * const normalized = normalizeAISuggestion(rawSuggestionFromDB);
 * ```
 */

// =================== ENUMS ===================

export type SuggestionStatus = 'pending' | 'accepted' | 'rejected';
export type ExtractionRunStatus = 'pending' | 'running' | 'completed' | 'failed';
export type ExtractionRunStage = 'data_suggest' | 'parsing' | 'validation' | 'consensus';

/**
 * Supported models for AI extraction
 */
export type SupportedAIModel = 'gpt-4o-mini' | 'gpt-4o' | 'gpt-5';

// =================== AI SUGGESTIONS ===================

/**
 * AI suggestion as returned from the database (raw)
 * Matches the ai_suggestions table structure
 */
export interface AISuggestionRaw {
  id: string;
  run_id: string;
  instance_id: string | null;
  field_id: string;
  suggested_value: {
    value: any;
  } | any; // Can be {value: X} or direct depending on context
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
 * AI suggestion processed for frontend use
 * Normalized and formatted values for easy use in components
 */
export interface AISuggestion {
  id: string;
  runId: string;
  value: any; // Extracted and normalized value (not the {value: X} object)
  confidence: number; // Normalized confidence_score (0-1), default 0 if null
  reasoning: string; // Normalized reasoning (empty string if null)
  status: SuggestionStatus;
  timestamp: Date; // created_at converted to Date
  evidence?: {
    text: string;
    pageNumber?: number | null;
  };
}

/**
 * Suggestion history item
 * Type alias for AISuggestion for compatibility
 */
export type AISuggestionHistoryItem = AISuggestion;

// =================== EXTRACTION RUNS ===================

/**
 * Extraction run as returned from DB (raw)
 * Matches extraction_runs table structure
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
 * Processed extraction run for frontend use
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
    tokensTotal?: number;  // Backend usa tokensTotal
    tokensUsed?: number;   // Legado/fallback
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
 * Request for specific section extraction
 * Used to call the section-extraction edge function
 */
export interface SectionExtractionRequest {
  projectId: string;
  articleId: string;
  templateId: string;
  entityTypeId: string;
  parentInstanceId?: string; // To filter child entities by model
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
    entityTypeId?: string;
    suggestionsCreated: number;
    // Direct token fields (not in metadata)
    tokensPrompt?: number;
    tokensCompletion?: number;
    tokensTotal?: number;
    durationMs?: number;
    // Legado: metadata pode existir em alguns casos
    status?: 'completed' | 'partial' | 'failed';
    metadata?: {
      pdfPages?: number;
      tokensTotal?: number;
      duration?: number;
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
 * Request for prediction model extraction
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
 * Summary memory of an extracted section (for batch context)
 */
export interface SectionMemory {
  entityTypeId: string;
  entityTypeName: string;
  summary: string; // Max 200 chars - structured summary
}

/**
 * Request for batch extraction of all sections of a model
 */
export interface BatchSectionExtractionRequest {
  projectId: string;
  articleId: string;
  templateId: string;
  parentInstanceId: string; // Model instance (required)
  extractAllSections: true; // Flag for batch extraction
  sectionIds?: string[]; // Filter specific sections (for chunking)
  pdfText?: string; // Pre-processed PDF text (avoids reprocessing)
  options?: {
    model?: SupportedAIModel;
  };
}

/**
 * Result of single section extraction (used in batch)
 */
export interface BatchSectionResult {
  entityTypeId: string;
  entityTypeName: string;
  success: boolean;
  runId?: string;
  suggestionsCreated?: number;
  error?: string;
}

/**
 * Response of batch extraction of all sections
 */
export interface BatchSectionExtractionResponse {
  ok: boolean;
  data?: {
    runId: string;
    totalSections: number;
    successfulSections: number;
    failedSections: number;
    totalSuggestionsCreated: number;
    totalTokensUsed: number;  // Direct in response (not in metadata)
    durationMs: number;       // Direct in response (not in metadata)
    sections: BatchSectionResult[];
  };
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  traceId?: string;
}

/**
 * Response of model extraction
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
      tokensTotal?: number;  // Backend returns tokensTotal (not tokensUsed)
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

// =================== HOOK PROPS ===================

/**
 * Props for the useAISuggestions hook
 */
export interface UseAISuggestionsProps {
  articleId: string;
  projectId: string;
  enabled?: boolean;
  onSuggestionAccepted?: (instanceId: string, fieldId: string, value: any) => void;
  onSuggestionRejected?: (instanceId: string, fieldId: string) => void;
}

/**
 * Return type of useAISuggestions hook
 */
export interface UseAISuggestionsReturn {
  suggestions: Record<string, AISuggestion>; // key: `${instanceId}_${fieldId}`
  loading: boolean;
  acceptSuggestion: (instanceId: string, fieldId: string) => Promise<void>;
  rejectSuggestion: (instanceId: string, fieldId: string) => Promise<void>;
  batchAccept: (threshold?: number) => Promise<void>;
  getSuggestionsHistory: (instanceId: string, fieldId: string) => Promise<AISuggestionHistoryItem[]>;
  getLatestSuggestion: (instanceId: string, fieldId: string) => AISuggestion | undefined;
  refresh: () => Promise<LoadSuggestionsResult>; // Returns result directly for efficient polling
  isActionLoading: (instanceId: string, fieldId: string) => 'accept' | 'reject' | null; // Whether action is loading
}

export interface LoadSuggestionsResult {
  suggestions: Record<string, AISuggestion>;
  count: number;
}

/**
 * Props for the useExtractionRuns hook
 */
export interface UseExtractionRunsProps {
  articleId: string;
  templateId: string;
  enabled?: boolean;
}

/**
 * Return type of useExtractionRuns hook
 */
export interface UseExtractionRunsReturn {
  runs: ExtractionRun[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

// =================== COMPONENT PROPS ===================

/**
 * Props for components that display AI suggestions
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

// =================== UTILITIES ===================

/**
 * Unique key to identify a suggestion in the map
 */
export function getSuggestionKey(instanceId: string, fieldId: string): string {
  return `${instanceId}_${fieldId}`;
}

/**
 * Parse suggested_value from DB to normalized value
 * Handles formats: {value: X} or direct value
 */
export function parseSuggestedValue(rawValue: any): any {
  if (rawValue === null || rawValue === undefined) {
    return '';
  }

  // If object with 'value' property, extract it
  if (typeof rawValue === 'object' && 'value' in rawValue) {
    return rawValue.value ?? '';
  }

  // Otherwise return the value as-is
  return rawValue;
}

/**
 * Normalize a raw suggestion from DB to processed format
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
 * Normalize a raw run from DB to processed format
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

