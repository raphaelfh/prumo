/**
 * AI Assessment Suggestions management service
 *
 * Centralizes all DB operations for AI suggestions for quality assessment
 * (PROBAST, QUADAS-2, ROB-2, etc.)
 *
 * Based on aiSuggestionService.ts (DRY + KISS)
 *
 * FOCUS: Assessment AI suggestions workflow
 *
 * @example
 * ```typescript
 * // Load suggestions for an article
 * const result = await AIAssessmentSuggestionService.loadSuggestions({
 *   articleId: '...',
 *   projectId: '...',
 *   instrumentId: '...',
 * });
 *
 * // Accept a suggestion
 * await AIAssessmentSuggestionService.acceptSuggestion({
 *   suggestionId: '...',
 *   projectId: '...',
 *   articleId: '...',
 *   itemId: '...',
 *   value: { level: 'Low', evidence_passages: [] },
 *   confidence: 0.95,
 *   reviewerId: '...',
 * });
 * ```
 */

import {supabase} from '@/integrations/supabase/client';
import type {
    AIAssessmentSuggestion,
    AIAssessmentSuggestionHistoryItem,
    AIAssessmentSuggestionRaw,
    AssessmentLevel,
    AssessmentSuggestionStatus,
    EvidencePassage,
} from '@/types/assessment';
import {getAssessmentSuggestionKey, normalizeAIAssessmentSuggestion,} from '@/lib/assessment-utils';
import {APIError, SuggestionNotFoundError,} from '@/lib/ai-extraction/errors';
import {t} from '@/lib/copy';

/**
 * Result of loadSuggestions
 */
export interface LoadAssessmentSuggestionsResult {
  suggestions: Record<string, AIAssessmentSuggestion>;  // key: ai_suggestion_${itemId}
  count: number;
}

/**
 * Parameters for acceptSuggestion
 */
export interface AcceptAssessmentSuggestionParams {
  suggestionId: string;
  projectId: string;
  articleId: string;
  itemId: string;
  value: {
    level: AssessmentLevel;
    evidence_passages: EvidencePassage[];
  };
  confidence: number;
  reviewerId: string;
  instrumentId?: string;
  extractionInstanceId?: string;
}

/**
 * Parameters for rejectSuggestion
 */
export interface RejectAssessmentSuggestionParams {
  suggestionId: string;
  reviewerId: string;
  wasAccepted?: boolean;
  itemId?: string;
  projectId?: string;
  articleId?: string;
  instrumentId?: string;
  extractionInstanceId?: string;
}

type AIAssessmentSuggestionRow = AIAssessmentSuggestionRaw & {
  ai_assessment_runs?: {
    project_id: string;
    article_id: string;
    instrument_id: string | null;
    project_instrument_id: string | null;
    extraction_instance_id: string | null;
  } | null;
};

const normalizeId = (value?: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * Service for AI assessment suggestion operations
 */
export class AIAssessmentSuggestionService {
  /**
   * Loads AI suggestions for an article
   *
   * Fetches pending, accepted and rejected suggestions for assessment_items.
   * Unlike extraction, does not filter by instances; filters by instrument_id.
   *
   * @param params - Search params
   * @param params.articleId - Article ID
   * @param params.projectId - Project ID
   * @param params.instrumentId - Instrument ID (optional, filter by instrument)
   * @param params.extractionInstanceId - Extraction instance ID (optional, for PROBAST per model)
   * @param params.statuses - Statuses to filter
   * @returns Map of suggestions keyed by `ai_suggestion_${itemId}`
   */
  static async loadSuggestions(params: {
    articleId: string;
    projectId: string;
    instrumentId?: string;
    extractionInstanceId?: string;
    statuses?: AssessmentSuggestionStatus[];
  }): Promise<LoadAssessmentSuggestionsResult> {
    const { articleId, projectId, instrumentId, extractionInstanceId, statuses = ['pending', 'accepted', 'rejected'] } = params;

    // Query assessment suggestions (either global or project-scoped)
      // + JOIN with ai_assessment_runs to filter by projectId/articleId

    const query = supabase
      .from('ai_suggestions')
      .select(`
        *,
        ai_assessment_runs!ai_suggestions_assessment_run_id_fkey!inner (
          project_id,
          article_id,
          instrument_id,
          project_instrument_id,
          extraction_instance_id
        )
      `)
      .or('assessment_item_id.not.is.null,project_assessment_item_id.not.is.null')
      .in('status', statuses);

    // Filtros via JOIN
    if (projectId) {
      query.eq('ai_assessment_runs.project_id', projectId);
    }

    if (articleId) {
      query.eq('ai_assessment_runs.article_id', articleId);
    }

    // XOR: instrument_id (global) OR project_instrument_id (project-scoped)
    if (instrumentId) {
      query.or(
        `instrument_id.eq.${instrumentId},project_instrument_id.eq.${instrumentId}`,
        { foreignTable: 'ai_assessment_runs' }
      );
    }

    if (extractionInstanceId) {
      query.eq('ai_assessment_runs.extraction_instance_id', extractionInstanceId);
    }

    query.order('created_at', { ascending: false });

    const { data, error } = await query;

    if (error) {
        console.error('[loadSuggestions] Error loading suggestions:', error);
        throw new APIError(`${t('assessment', 'errors_loadSuggestions')}: ${error.message}`);
    }

      // Map to format { ai_suggestion_${itemId}: suggestion }
      // Keep only the latest per item
    const suggestionsMap: Record<string, AIAssessmentSuggestion> = {};

    const rows = (data || []) as AIAssessmentSuggestionRow[];

    rows.forEach((item) => {
      // XOR: prioritize project-scoped (default) over global
      const effectiveItemId = item.project_assessment_item_id || item.assessment_item_id;

      if (!effectiveItemId) {
          console.warn('[loadSuggestions] Suggestion without item ID ignored:', item.id);
        return;
      }

      const key = getAssessmentSuggestionKey(effectiveItemId);

      if (!suggestionsMap[key]) {
        suggestionsMap[key] = normalizeAIAssessmentSuggestion(item as AIAssessmentSuggestionRaw);
      }
    });

    // suggestionsMap now contains the latest suggestion per item

    return {
      suggestions: suggestionsMap,
      count: Object.keys(suggestionsMap).length,
    };
  }

  /**
   * Fetches full suggestion history for a specific item
   *
   * @param itemId - Assessment item ID
   * @param limit - Result limit (default: 10)
   * @returns List of suggestions sorted by date (newest first)
   */
  static async getHistory(
    itemId: string,
    limit: number = 10
  ): Promise<AIAssessmentSuggestionHistoryItem[]> {
    // Query by either assessment_item_id (global) or project_assessment_item_id (project-scoped)
    const { data, error } = await supabase
      .from('ai_suggestions')
      .select('*')
      .or(`assessment_item_id.eq.${itemId},project_assessment_item_id.eq.${itemId}`)
      .order('created_at', { ascending: false })
      .limit(limit) as { data: AIAssessmentSuggestionRaw[] | null; error: { message: string } | null };

    if (error) {
        console.error('[getHistory] Error loading history:', error);
        throw new APIError(`${t('assessment', 'errors_getHistory')}: ${error.message}`);
    }

    return (data || []).map(item => ({
      id: item.id,
      value: typeof item.suggested_value === 'object' && 'level' in item.suggested_value
        ? item.suggested_value
        : { level: String(item.suggested_value), evidence_passages: [] },
      confidence: item.confidence_score ?? 0,
      reasoning: item.reasoning ?? '',
      status: item.status,
      timestamp: new Date(item.created_at),
      reviewedBy: item.reviewed_by ?? undefined,
      reviewedAt: item.reviewed_at ? new Date(item.reviewed_at) : undefined,
    }));
  }

  /**
   * Accepts an AI suggestion
   *
   * Workflow:
   * 1. Check if assessment_response already exists (may have been accepted before)
   * 2. If not: create new assessment or update existing
   * 3. Update suggestion status to 'accepted'
   * 4. Set reviewed_by and reviewed_at
   *
   * @param params - Accept parameters
   * @throws {SuggestionNotFoundError} If suggestion not found
   * @throws {APIError} On operation error
   */
  static async acceptSuggestion(params: AcceptAssessmentSuggestionParams): Promise<void> {
    const { suggestionId, projectId, articleId, itemId, value, confidence, reviewerId, instrumentId, extractionInstanceId } = params;

      // 1. Fetch suggestion to verify it exists
    const { data: suggestion, error: fetchError } = await supabase
      .from('ai_suggestions')
      .select('*')
      .eq('id', suggestionId)
      .single();

    if (fetchError || !suggestion) {
        throw new SuggestionNotFoundError(suggestionId, '');
    }

    let resolvedInstrumentId = normalizeId(instrumentId);
    let resolvedExtractionInstanceId =
      extractionInstanceId === undefined ? null : normalizeId(extractionInstanceId);

    if (!resolvedInstrumentId || extractionInstanceId === undefined) {
      const { data: runData, error: runError } = await supabase
        .from('ai_assessment_runs')
        .select('instrument_id, project_instrument_id, extraction_instance_id')
        .eq('id', suggestion.assessment_run_id)
        .maybeSingle();

      if (runError) {
        console.warn('⚠️ [acceptSuggestion] Erro ao carregar run context:', runError);
      } else if (runData) {
        // XOR: use whichever instrument column is set (global or project-scoped)
        resolvedInstrumentId = resolvedInstrumentId
          ?? normalizeId(runData.instrument_id)
          ?? normalizeId(runData.project_instrument_id);
        if (extractionInstanceId === undefined) {
          resolvedExtractionInstanceId = normalizeId(runData.extraction_instance_id);
        }
      }
    }

      // 2. Fetch existing assessment for user
    let assessmentQuery = supabase
      .from('assessments')
      .select('id, responses')
      .eq('project_id', projectId)
      .eq('article_id', articleId)
      .eq('user_id', reviewerId)
      .eq('is_current_version', true);

    if (resolvedInstrumentId) {
      assessmentQuery = assessmentQuery.eq('instrument_id', resolvedInstrumentId);
    }

    if (resolvedExtractionInstanceId) {
      assessmentQuery = assessmentQuery.eq('extraction_instance_id', resolvedExtractionInstanceId);
    } else {
      assessmentQuery = assessmentQuery.is('extraction_instance_id', null);
    }

    const { data: existingAssessment, error: assessmentFetchError } = await assessmentQuery
      .maybeSingle();

    if (assessmentFetchError) {
      console.error('❌ [acceptSuggestion] Erro ao buscar assessment:', assessmentFetchError);
        throw new APIError(`${t('assessment', 'errors_loadAssessment')}: ${assessmentFetchError.message}`);
    }

      // 3. Update or create assessment with response
    const responses = existingAssessment?.responses || {};
    responses[itemId] = {
      item_id: itemId,
      selected_level: value.level,
      confidence: confidence,
      notes: null,
      evidence: value.evidence_passages,
    };

    if (existingAssessment) {
        // Update existing assessment
      const { error: updateError } = await supabase
        .from('assessments')
        .update({
          responses,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingAssessment.id);

      if (updateError) {
        console.error('❌ [acceptSuggestion] Erro ao atualizar assessment:', updateError);
          throw new APIError(`${t('assessment', 'errors_updateAssessment')}: ${updateError.message}`);
      }
    } else {
      const resolvedToolType = await (async () => {
        if (!resolvedInstrumentId) return 'CUSTOM';
        // Try global instruments first
        const { data: globalData } = await supabase
          .from('assessment_instruments')
          .select('tool_type')
          .eq('id', resolvedInstrumentId)
          .maybeSingle();
        if (globalData?.tool_type) return globalData.tool_type;
        // Fallback to project instruments
        const { data: projectData } = await supabase
          .from('project_assessment_instruments')
          .select('tool_type')
          .eq('id', resolvedInstrumentId)
          .maybeSingle();
        return projectData?.tool_type ?? 'CUSTOM';
      })();

        // Create new assessment
      const { error: insertError } = await supabase
        .from('assessments')
        .insert({
          project_id: projectId,
          article_id: articleId,
          user_id: reviewerId,
          instrument_id: resolvedInstrumentId,
          tool_type: resolvedToolType,
          responses,
          status: 'in_progress',
          completion_percentage: 0,
          extraction_instance_id: resolvedExtractionInstanceId,
          is_blind: false,
          is_current_version: true,
        });

      if (insertError) {
        console.error('❌ [acceptSuggestion] Erro ao criar assessment:', insertError);
          throw new APIError(`${t('assessment', 'errors_createAssessment')}: ${insertError.message}`);
      }
    }

      // 4. Update suggestion status
    const { error: updateSuggestionError } = await supabase
      .from('ai_suggestions')
      .update({
        status: 'accepted',
        reviewed_by: reviewerId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', suggestionId);

    if (updateSuggestionError) {
        console.error('[acceptSuggestion] Error updating suggestion status:', updateSuggestionError);
        throw new APIError(`${t('assessment', 'errors_updateSuggestion')}: ${updateSuggestionError.message}`);
    }

  }

  /**
   * Rejects an AI suggestion
   *
   * Workflow:
   * 1. If was accepted before: remove response from assessment
   * 2. Update suggestion status to 'rejected'
   * 3. Set reviewed_by and reviewed_at
   *
   * @param params - Reject parameters
   * @throws {SuggestionNotFoundError} If suggestion not found
   * @throws {APIError} On operation error
   */
  static async rejectSuggestion(params: RejectAssessmentSuggestionParams): Promise<void> {
    const {
      suggestionId,
      reviewerId,
      wasAccepted,
      itemId,
      projectId,
      articleId,
      instrumentId,
      extractionInstanceId,
    } = params;

      // 1. If was accepted, remove response from assessment
    if (wasAccepted && itemId && projectId && articleId) {
      const resolvedInstrumentId = normalizeId(instrumentId);
      const resolvedExtractionInstanceId = normalizeId(extractionInstanceId);

      let assessmentQuery = supabase
        .from('assessments')
        .select('id, responses')
        .eq('project_id', projectId)
        .eq('article_id', articleId)
        .eq('user_id', reviewerId)
        .eq('is_current_version', true);

      if (resolvedInstrumentId) {
        assessmentQuery = assessmentQuery.eq('instrument_id', resolvedInstrumentId);
      }

      if (resolvedExtractionInstanceId) {
        assessmentQuery = assessmentQuery.eq('extraction_instance_id', resolvedExtractionInstanceId);
      } else {
        assessmentQuery = assessmentQuery.is('extraction_instance_id', null);
      }

      const { data: existingAssessment, error: fetchError } = await assessmentQuery
        .maybeSingle();

      if (fetchError) {
          console.error('❌ [rejectSuggestion] Error fetching assessment:', fetchError);
          throw new APIError(`${t('assessment', 'errors_loadAssessment')}: ${fetchError.message}`);
      }

      if (existingAssessment && existingAssessment.responses[itemId]) {
        const updatedResponses = { ...existingAssessment.responses };
        delete updatedResponses[itemId];

        const { error: updateError } = await supabase
          .from('assessments')
          .update({
            responses: updatedResponses,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingAssessment.id);

        if (updateError) {
            console.error('❌ [rejectSuggestion] Error removing response:', updateError);
            throw new APIError(`${t('assessment', 'errors_removeResponse')}: ${updateError.message}`);
        }

      }
    }

      // 2. Update suggestion status
    const { error: updateError } = await supabase
      .from('ai_suggestions')
      .update({
        status: 'rejected',
        reviewed_by: reviewerId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', suggestionId);

    if (updateError) {
        console.error('[rejectSuggestion] Error updating suggestion status:', updateError);
        throw new APIError(`${t('assessment', 'errors_updateSuggestion')}: ${updateError.message}`);
    }

  }

  /**
   * Accepts multiple suggestions in batch (above confidence threshold)
   *
   * @param params - Batch params
   * @param params.suggestions - Suggestions to process
   * @param params.threshold - Minimum confidence (0-1)
   * @param params.reviewerId - Reviewer ID
   * @param params.projectId - Project ID
   * @param params.articleId - Article ID
   * @param params.instrumentId - Instrument ID
   * @returns Number of suggestions accepted
   */
  static async batchAcceptSuggestions(params: {
    suggestions: Record<string, AIAssessmentSuggestion>;
    threshold?: number;
    reviewerId: string;
    projectId: string;
    articleId: string;
    instrumentId?: string;
    extractionInstanceId?: string;
  }): Promise<number> {
    const { suggestions, threshold = 0.8, reviewerId, projectId, articleId, instrumentId, extractionInstanceId } = params;

    let accepted = 0;

    for (const suggestion of Object.values(suggestions)) {
      if (
        suggestion.status === 'pending' &&
        suggestion.confidence_score >= threshold
      ) {
        try {
          await this.acceptSuggestion({
            suggestionId: suggestion.id,
            projectId,
            articleId,
            itemId: suggestion.assessment_item_id,
            value: suggestion.suggested_value,
            confidence: suggestion.confidence_score,
            reviewerId,
            instrumentId,
            extractionInstanceId,
          });
          accepted++;
        } catch (error) {
            console.error(`❌ [batchAccept] Error accepting suggestion ${suggestion.id}:`, error);
            // Continue with next suggestions
        }
      }
    }

    return accepted;
  }
}
