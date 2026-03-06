/**
 * Assessment utilities
 *
 * Centralized utility functions for calculations and common operations
 * in the assessment module. Eliminates code duplication found in 4+ files.
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
 * Calculates assessment progress from items and responses
 *
 * Previously duplicated in:
 * - AssessmentInterface.tsx (lines 146-170)
 * - ArticleAssessmentTable.tsx (lines 189-303)
 * - DomainAccordion.tsx (lines 72-82)
 * - useAssessmentData.ts (line 204)
 *
 * @param items - Instrument items list
 * @param responses - Record of responses (key: item_id)
 * @returns Object with progress metrics
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
 * Calculates simplified progress (percentage only)
 *
 * @param completed - Number of completed items
 * @param total - Total items
 * @returns Percentage (0-100)
 */
export function calculateProgressPercentage(completed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((completed / total) * 100);
}

// =================== CONFIDENCE CALCULATION ===================

/**
 * Calculates confidence percentage (0-1 → 0-100%)
 * Returns 0 if value is undefined or invalid
 *
 * Previously duplicated in:
 * - AISuggestionConfidence.tsx (lines 26-31)
 *
 * @param confidence - Confidence score (0 to 1)
 * @returns Percentage (0-100)
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
 * Formats confidence percentage for display
 *
 * @param confidence - Confidence score (0 to 1)
 * @returns Formatted string (e.g. "85%")
 */
export function formatConfidencePercent(
  confidence: number | undefined | null
): string {
  return `${calculateConfidencePercent(confidence)}%`;
}

// =================== LEVEL FORMATTING ===================

/**
 * Map of assessment level labels (English display)
 */
const LEVEL_LABELS: Record<string, string> = {
    Low: 'Low risk',
    High: 'High risk',
    Unclear: 'Unclear',
    'Some concerns': 'Some concerns',
    Yes: 'Yes',
    Partially: 'Partially',
    No: 'No',
    'Low risk': 'Low risk',
    'High risk': 'High risk',
    'Not applicable': 'Not applicable',
};

/**
 * Format assessment level for display (English)
 */
export function formatAssessmentLevel(level: AssessmentLevel | string): string {
    return LEVEL_LABELS[level] || level;
}

// =================== STATUS HELPERS ===================

export type AssessmentStatusType = 'complete' | 'in_progress' | 'not_started';

/**
 * Determines assessment status from progress and DB status
 *
 * @param status - DB status (optional)
 * @param progressPercentage - Completion percentage
 * @returns Normalized status type
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
 * Returns display label for status
 */
export function getStatusLabel(status: AssessmentStatusType): string {
  const labels: Record<AssessmentStatusType, string> = {
      complete: 'Complete',
      in_progress: 'In progress',
      not_started: 'Not started',
  };
  return labels[status];
}

/**
 * Returns badge color for status
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
 * Generates unique key for suggestion
 */
export function getAssessmentSuggestionKey(itemId: string): string {
  return `ai_suggestion_${itemId}`;
}

/**
 * Normalizes raw suggestion from backend
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
 * Checks suggestion status
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
 * Groups items by domain
 *
 * @param items - Items list
 * @returns Record grouped by domain name
 */
export function groupItemsByDomain(
  items: AssessmentItem[]
): Record<string, AssessmentItem[]> {
  return items.reduce((acc, item) => {
      const domain = item.domain || 'No domain';
    if (!acc[domain]) {
      acc[domain] = [];
    }
    acc[domain].push(item);
    return acc;
  }, {} as Record<string, AssessmentItem[]>);
}

/**
 * Sorts domains by items' sort_order
 *
 * @param domains - Domains record
 * @returns Sorted array of [domainName, items] tuples
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
 * Checks if response is valid
 */
export function isValidResponse(response: AssessmentResponse | null | undefined): boolean {
  return Boolean(response?.selected_level?.trim());
}

/**
 * Counts valid responses
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
