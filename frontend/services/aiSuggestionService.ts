/**
 * AI Suggestions management service
 *
 * Centralizes all DB operations for AI suggestions.
 * Abstracts Supabase queries from the hook for reuse and unit tests.
 *
 * FOCUS: Section extraction pipeline (granular extraction per section)
 *
 * @example
 * ```typescript
 * // Load suggestions for an article
 * const instanceIds = await AISuggestionService.getArticleInstanceIds(articleId);
 * const result = await AISuggestionService.loadSuggestions(articleId, instanceIds);
 *
 * // Accept a suggestion
 * await AISuggestionService.acceptSuggestion({
 *   suggestionId: '...',
 *   projectId: '...',
 *   articleId: '...',
 *   instanceId: '...',
 *   fieldId: '...',
 *   value: 'extracted value',
 *   confidence: 0.95,
 *   reviewerId: '...',
 * });
 * ```
 */

import {supabase} from '@/integrations/supabase/client';
import {handleSupabaseError, queryBuilder} from '@/lib/supabase/baseRepository';
import type {
    AISuggestion,
    AISuggestionHistoryItem,
    AISuggestionRaw,
    LoadSuggestionsResult,
    SuggestionStatus,
} from '@/types/ai-extraction';
import {getSuggestionKey, normalizeAISuggestion,} from '@/types/ai-extraction';
import {APIError,} from '@/lib/ai-extraction/errors';

/**
 * Service for AI suggestion operations
 */
export class AISuggestionService {
  /**
   * Loads suggestions for an article's instances
   *
   * Fetches pending, accepted and rejected suggestions, keeping only the latest per field.
   * Includes rejected so the decision can be reverted.
   *
   * @param articleId - Article ID
   * @param instanceIds - Extraction instance IDs
   * @param statuses - Statuses to filter (default: ['pending', 'accepted', 'rejected'])
   * @returns Map of suggestions keyed by `${instanceId}_${fieldId}`
   */
  static async loadSuggestions(
    articleId: string,
    instanceIds: string[],
    statuses: SuggestionStatus[] = ['pending', 'accepted', 'rejected']
  ): Promise<LoadSuggestionsResult> {
    if (instanceIds.length === 0) {
      return { suggestions: {}, count: 0 };
    }

    // Usar queryBuilder do baseRepository
    // Para filtros .in(), precisamos usar array nos filters
    const { data, error } = await queryBuilder<AISuggestionRaw>(
      'ai_suggestions',
      {
        select: '*',
        filters: {
          instance_id: instanceIds,
          status: statuses,
        },
        orderBy: { column: 'created_at', ascending: false },
      }
    );

    if (error) {
      handleSupabaseError(error, 'loadSuggestions');
    }

      // Map to format { instanceId_fieldId: suggestion }
      // Keep only the latest per field (first in sorted array)
    const suggestionsMap: Record<string, AISuggestion> = {};

      console.warn(`📊 [loadSuggestions] Processing ${(data || []).length} suggestion(s) from DB for ${instanceIds.length} instance(s)`);

    (data || []).forEach((item: AISuggestionRaw) => {
      if (!item.instance_id) {
          console.warn('[loadSuggestions] Suggestion without instance_id ignored:', {
          suggestionId: item.id,
          fieldId: item.field_id,
          status: item.status
        });
        return;
      }

      const key = getSuggestionKey(item.instance_id, item.field_id);
        // Only add if not already present (keeps latest)
      if (!suggestionsMap[key]) {
        suggestionsMap[key] = normalizeAISuggestion(item);
          console.warn(`✅ [loadSuggestions] Suggestion added: ${key}`, {
          status: item.status,
          fieldId: item.field_id,
          instanceId: item.instance_id
        });
      } else {
          console.warn(`⏭️ [loadSuggestions] Latest suggestion already exists for ${key}, skipping`);
      }
    });

    const finalCount = Object.keys(suggestionsMap).length;
      console.warn(`🎯 [loadSuggestions] Total of ${finalCount} unique suggestion(s) mapped`);

    return {
      suggestions: suggestionsMap,
      count: finalCount,
    };
  }

  /**
   * Fetches full suggestion history for a specific field
   *
   * @param instanceId - Instance ID
   * @param fieldId - Field ID
   * @param limit - Result limit (default: 10)
   * @returns List of suggestions sorted by date (newest first)
   */
  static async getHistory(
    instanceId: string,
    fieldId: string,
    limit: number = 10
  ): Promise<AISuggestionHistoryItem[]> {
    // Usar queryBuilder do baseRepository
    const { data, error } = await queryBuilder<AISuggestionRaw>(
      'ai_suggestions',
      {
        select: '*',
        filters: {
          instance_id: instanceId,
          field_id: fieldId,
        },
        orderBy: { column: 'created_at', ascending: false },
        limit,
      }
    );

    if (error) {
      handleSupabaseError(error, 'getHistory');
    }

    return (data || []).map((item: AISuggestionRaw) =>
      normalizeAISuggestion(item)
    );
  }

  /**
   * Accepts an AI suggestion
   *
   * Creates extracted_value and updates suggestion status to 'accepted'.
   *
   * @param params - Accept suggestion parameters
   */
  static async acceptSuggestion(params: {
    suggestionId: string;
    projectId: string;
    articleId: string;
    instanceId: string;
    fieldId: string;
    value: any;
    confidence: number;
    reviewerId: string;
  }): Promise<void> {
    const {
      suggestionId,
      projectId,
      articleId,
      instanceId,
      fieldId,
      value,
      confidence,
      reviewerId,
    } = params;

      // 1. Check if extracted_value already exists for this instance_id, field_id and reviewer_id
    const { data: existing, error: selectError } = await supabase
      .from('extracted_values')
      .select('id')
      .eq('instance_id', instanceId)
      .eq('field_id', fieldId)
      .eq('reviewer_id', reviewerId)
      .maybeSingle();

    if (selectError) {
      throw new APIError(`Failed to check existing extracted value: ${selectError.message}`, undefined, { selectError });
    }

      // Prepare value data
    const valueData = {
      project_id: projectId,
      article_id: articleId,
      instance_id: instanceId,
      field_id: fieldId,
      value: { value },
      source: 'ai' as const,
      confidence_score: confidence,
      reviewer_id: reviewerId,
      is_consensus: false,
      ai_suggestion_id: suggestionId,
    };

      // 2. UPDATE if exists, INSERT if not
    if (existing) {
      const { error: updateError } = await supabase
        .from('extracted_values')
        .update(valueData)
        .eq('id', existing.id);

      if (updateError) {
        throw new APIError(`Failed to update extracted value: ${updateError.message}`, undefined, { updateError });
      }
    } else {
      const { error: insertError } = await supabase
        .from('extracted_values')
        .insert(valueData);

      if (insertError) {
        throw new APIError(`Failed to create extracted value: ${insertError.message}`, undefined, { insertError });
      }
    }

      // 3. Update suggestion status to 'accepted'
    const { error: updateError } = await supabase
      .from('ai_suggestions')
      .update({
        status: 'accepted',
        reviewed_by: reviewerId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', suggestionId);

    if (updateError) {
      throw new APIError(`Failed to update suggestion status: ${updateError.message}`, undefined, { updateError });
    }
  }

  /**
   * Rejects an AI suggestion
   *
   * Updates suggestion status to 'rejected'.
   * If it was accepted before, removes the related extracted_value.
   *
   * @param params - Reject suggestion parameters
   */
  static async rejectSuggestion(params: {
    suggestionId: string;
    reviewerId: string;
    wasAccepted?: boolean;
    instanceId?: string;
    fieldId?: string;
    projectId?: string;
    articleId?: string;
  }): Promise<void> {
    const { suggestionId, reviewerId, wasAccepted, instanceId, fieldId, projectId, articleId } = params;

      // If was accepted before, remove related extracted_value
    if (wasAccepted && instanceId && fieldId && projectId && articleId) {
      const { error: deleteError } = await supabase
        .from('extracted_values' as any)
        .delete()
        .eq('instance_id', instanceId)
        .eq('field_id', fieldId)
        .eq('reviewer_id', reviewerId)
        .eq('article_id', articleId)
        .eq('ai_suggestion_id', suggestionId);

      if (deleteError) {
          console.warn(`⚠️ Error removing extracted_value on reject: ${deleteError.message}`);
          // Do not throw - continue with reject even if remove fails
      }
    }

      // Update suggestion status to 'rejected'
    const { error } = await supabase
      .from('ai_suggestions')
      .update({
        status: 'rejected',
        reviewed_by: reviewerId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', suggestionId);

    if (error) {
      throw new APIError(`Failed to reject suggestion: ${error.message}`, undefined, { error });
    }
  }

  /**
   * Fetches extraction instances for an article
   *
   * Helper to get instance IDs before loading suggestions.
   * IMPORTANT: Filters only instances with non-null article_id (article-specific instances).
   *
   * @param articleId - Article ID
   * @returns Array of instance IDs
   */
  static async getArticleInstanceIds(articleId: string): Promise<string[]> {
    const { data, error } = await supabase
      .from('extraction_instances')
      .select('id, label, entity_type_id, article_id')
      .eq('article_id', articleId)
        .not('article_id', 'is', null); // Ensure article_id is not null

    if (error) {
        console.error('Error fetching instances for suggestions:', error);
      throw new APIError(`Failed to load instances: ${error.message}`, undefined, { error });
    }

    const instanceIds = (data || []).map((i) => i.id);

      // Detailed log for debug
      console.warn(`📋 [getArticleInstanceIds] Found ${instanceIds.length} instance(s) for article ${articleId}:`, {
          instanceIds: instanceIds.slice(0, 10), // First 10 to avoid log noise
      instances: (data || []).slice(0, 5).map(i => ({
        id: i.id,
        label: i.label,
        entity_type_id: i.entity_type_id
      }))
    });

    return instanceIds;
  }
}

