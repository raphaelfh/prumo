/**
 * Centralized TypeScript types for AI Extraction (post-HITL).
 *
 * The legacy `ai_suggestions` and `extraction_runs` raw shapes are gone:
 * data flows through `aiSuggestionService` (reads `extraction_proposal_records`)
 * and the run hooks under `frontend/hooks/runs/`. The remaining types here
 * are the *presentation* layer the extraction UI renders.
 */

// =================== ENUMS ===================

export type SuggestionStatus = 'pending' | 'accepted' | 'rejected';
export type ExtractionRunStatus = 'pending' | 'running' | 'completed' | 'failed';
export type ExtractionRunStage =
  | 'pending'
  | 'proposal'
  | 'review'
  | 'consensus'
  | 'finalized'
  | 'cancelled';

/**
 * Supported models for AI extraction
 */
export type SupportedAIModel = 'gpt-4o-mini' | 'gpt-4o' | 'gpt-5';

// =================== AI SUGGESTIONS (presentation shape) ===================

/**
 * Presentation shape an extraction-UI consumer renders. There's no longer
 * a backing `ai_suggestions` table — the equivalent rows live in
 * `extraction_proposal_records` (filtered by `source='ai'`) and are
 * mapped into this shape by `aiSuggestionService`.
 */
export interface AISuggestion {
  id: string;
  runId: string;
  value: any; // Extracted and normalized value (not the {value: X} object)
  confidence: number; // 0-1, default 0 when missing
  reasoning: string; // empty string when null
  status: SuggestionStatus;
  timestamp: Date; // proposal created_at parsed
  evidence?: {
    text: string;
    pageNumber?: number | null;
  };
}

/**
 * Alias for the `getHistory` consumer — same shape, different intent.
 */
export type AISuggestionHistoryItem = AISuggestion;

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
 * Unique key to identify a suggestion in the map.
 */
export function getSuggestionKey(instanceId: string, fieldId: string): string {
  return `${instanceId}_${fieldId}`;
}

