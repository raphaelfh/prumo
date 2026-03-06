/**
 * Hook to manage AI suggestions for Assessment
 *
 * Features:
 * - Load pending/accepted/rejected suggestions
 * - Accept suggestion (create/update assessment response)
 * - Reject suggestion (remove response if was accepted)
 * - Batch accept by threshold
 * - Suggestion history
 *
 * Based on useAISuggestions.ts (DRY + KISS)
 *
 * @hook
 */

import {useCallback, useEffect, useState} from 'react';
import {toast} from 'sonner';
import type {
    AIAssessmentSuggestion,
    AIAssessmentSuggestionHistoryItem,
    AssessmentLevel,
    EvidencePassage,
} from '@/types/assessment';
import {getAssessmentSuggestionKey} from '@/lib/assessment-utils';
import {
    AIAssessmentSuggestionService,
    type LoadAssessmentSuggestionsResult,
} from '@/services/aiAssessmentSuggestionService';
import {AuthenticationError, getErrorMessage,} from '@/lib/ai-extraction/errors';
import {t} from '@/lib/copy';
import {useCurrentUser} from '@/hooks/useCurrentUser';

/**
 * Hook props
 */
export interface UseAIAssessmentSuggestionsProps {
  projectId: string;
  articleId: string;
  instrumentId?: string;
    extractionInstanceId?: string;  // For PROBAST per model
  enabled?: boolean;
  onSuggestionAccepted?: (itemId: string, value: { level: AssessmentLevel; evidence_passages: EvidencePassage[] }) => void | Promise<void>;
  onSuggestionRejected?: (itemId: string) => void | Promise<void>;
}

/**
 * Hook return type
 */
export interface UseAIAssessmentSuggestionsReturn {
    // State
  suggestions: Record<string, AIAssessmentSuggestion>;  // key: ai_suggestion_${itemId}
  loading: boolean;

    // Main functions
  acceptSuggestion: (itemId: string) => Promise<void>;
  rejectSuggestion: (itemId: string) => Promise<void>;
  batchAccept: (threshold?: number) => Promise<number>;

    // Helper functions
  getSuggestionsHistory: (itemId: string, limit?: number) => Promise<AIAssessmentSuggestionHistoryItem[]>;
  getLatestSuggestion: (itemId: string) => AIAssessmentSuggestion | undefined;
  refresh: () => Promise<LoadAssessmentSuggestionsResult>;

    // Loading state per action (for UI feedback)
  isActionLoading: (itemId: string) => 'accept' | 'reject' | null;
}

/**
 * Hook to manage AI suggestions for assessment
 */
export function useAIAssessmentSuggestions(
  props: UseAIAssessmentSuggestionsProps
): UseAIAssessmentSuggestionsReturn {
  const {
    projectId,
    articleId,
    instrumentId,
    extractionInstanceId,
    enabled = true,
    onSuggestionAccepted,
    onSuggestionRejected,
  } = props;

    // State
  const [suggestions, setSuggestions] = useState<Record<string, AIAssessmentSuggestion>>({});
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<Record<string, 'accept' | 'reject' | null>>({});
  const { user, loading: authLoading } = useCurrentUser();

  /**
   * Loads suggestions from backend
   */
  const loadSuggestions = useCallback(async (): Promise<LoadAssessmentSuggestionsResult> => {
    setLoading(true);

    try {
      const result = await AIAssessmentSuggestionService.loadSuggestions({
        articleId,
        projectId,
        instrumentId,
        extractionInstanceId,
        statuses: ['pending', 'accepted', 'rejected'],
      });

      setSuggestions(result.suggestions);
      return result;
    } catch (err) {
        console.error('[useAIAssessmentSuggestions] Error loading suggestions:', err);
      const message = getErrorMessage(err);
        toast.error(`${t('assessment', 'errors_loadSuggestions')}: ${message}`);
      setSuggestions({});
      return { suggestions: {}, count: 0 };
    } finally {
      setLoading(false);
    }
  }, [articleId, projectId, instrumentId, extractionInstanceId]);

  /**
   * Effect to load suggestions when deps change
   */
  useEffect(() => {
    if (!enabled || !articleId || !projectId) return;
    loadSuggestions();
  }, [articleId, projectId, instrumentId, extractionInstanceId, enabled, loadSuggestions]);

  /**
   * Accepts a suggestion
   */
  const acceptSuggestion = useCallback(async (itemId: string) => {
    const key = getAssessmentSuggestionKey(itemId);
    const suggestion = suggestions[key];

    if (!suggestion) {
        console.warn(`⚠️ [acceptSuggestion] Suggestion not found: ${itemId}`);
      return;
    }

      // Immediate visual feedback
    setActionLoading(prev => ({ ...prev, [key]: 'accept' }));

    try {
        // Get authenticated user
      if (authLoading || !user) throw new AuthenticationError();

        console.log('[acceptSuggestion] Accepting suggestion:', {
        itemId,
        suggestionId: suggestion.id,
        level: suggestion.suggested_value.level,
      });

        // Accept using service
      await AIAssessmentSuggestionService.acceptSuggestion({
        suggestionId: suggestion.id,
        projectId,
        articleId,
        itemId,
        value: suggestion.suggested_value,
        confidence: suggestion.confidence_score,
        reviewerId: user.id,
        instrumentId,
        extractionInstanceId,
      });

        // Update local state status to 'accepted'
      setSuggestions(prev => {
        if (!prev[key]) {
            console.warn(`⚠️ [acceptSuggestion] Suggestion ${key} not found in state`);
          return prev;
        }

        const next = { ...prev };
        next[key] = {
          ...next[key],
          status: 'accepted' as const,
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
        };

          console.log(`[acceptSuggestion] State updated to 'accepted': ${key}`);
          return {...next}; // New reference for re-render
      });

        // Callback to update response (non-blocking)
      if (onSuggestionAccepted) {
        Promise.resolve(
          onSuggestionAccepted(itemId, suggestion.suggested_value)
        ).catch(err => {
            console.error('[acceptSuggestion] Error in onSuggestionAccepted callback:', err);
        });
      }

        toast.success(t('assessment', 'toastSuggestionAccepted'));
    } catch (err) {
        console.error('[acceptSuggestion] Error:', err);
      const message = getErrorMessage(err);
        toast.error(`${t('assessment', 'errors_acceptSuggestion')}: ${message}`);
      throw err;
    } finally {
      setActionLoading(prev => ({ ...prev, [key]: null }));
    }
  }, [suggestions, projectId, articleId, instrumentId, extractionInstanceId, onSuggestionAccepted, user, authLoading]);

  /**
   * Rejects a suggestion
   */
  const rejectSuggestion = useCallback(async (itemId: string) => {
    const key = getAssessmentSuggestionKey(itemId);
    const suggestion = suggestions[key];

    if (!suggestion) {
        console.warn(`⚠️ [rejectSuggestion] Suggestion not found: ${itemId}`);
      return;
    }

    // Feedback visual imediato
    setActionLoading(prev => ({ ...prev, [key]: 'reject' }));

    try {
      if (authLoading || !user) throw new AuthenticationError();

      const wasAccepted = suggestion.status === 'accepted';

        console.log('[rejectSuggestion] Rejecting suggestion:', {
        itemId,
        suggestionId: suggestion.id,
        wasAccepted,
      });

        // Reject using service
      await AIAssessmentSuggestionService.rejectSuggestion({
        suggestionId: suggestion.id,
        reviewerId: user.id,
        wasAccepted,
        itemId,
        projectId,
        articleId,
        instrumentId,
        extractionInstanceId,
      });

        // Update local state status to 'rejected'
      setSuggestions(prev => {
        if (!prev[key]) {
            console.warn(`⚠️ [rejectSuggestion] Suggestion ${key} not found in state`);
          return prev;
        }

        const next = { ...prev };
        next[key] = {
          ...next[key],
          status: 'rejected' as const,
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
        };

          console.log(`[rejectSuggestion] State updated to 'rejected': ${key}`);
        return { ...next };
      });

        // Callback to clear response (non-blocking)
      if (onSuggestionRejected) {
        Promise.resolve(onSuggestionRejected(itemId)).catch(err => {
            console.error('[rejectSuggestion] Error in onSuggestionRejected callback:', err);
        });
      }

        toast.success(t('assessment', 'toastSuggestionRejected'));
    } catch (err) {
        console.error('[rejectSuggestion] Error:', err);
      const message = getErrorMessage(err);
        toast.error(`${t('assessment', 'errors_rejectSuggestion')}: ${message}`);
      throw err;
    } finally {
      setActionLoading(prev => ({ ...prev, [key]: null }));
    }
  }, [suggestions, projectId, articleId, instrumentId, extractionInstanceId, onSuggestionRejected, user, authLoading]);

  /**
   * Accepts multiple suggestions in batch (above threshold)
   */
  const batchAccept = useCallback(async (threshold: number = 0.8): Promise<number> => {
    try {
      if (authLoading || !user) throw new AuthenticationError();

        console.log('[batchAccept] Starting batch accept:', {threshold});

      const accepted = await AIAssessmentSuggestionService.batchAcceptSuggestions({
        suggestions,
        threshold,
        reviewerId: user.id,
        projectId,
        articleId,
        instrumentId,
        extractionInstanceId,
      });

      if (accepted > 0) {
        await loadSuggestions();
          toast.success(t('assessment', 'batchAcceptSuccessToast').replace('{{n}}', String(accepted)));
      } else {
          toast.info(t('assessment', 'noSuggestionThresholdToast'));
      }

      return accepted;
    } catch (err) {
        console.error('[batchAccept] Error:', err);
      const message = getErrorMessage(err);
        toast.error(`${t('assessment', 'batchAcceptError')}: ${message}`);
      return 0;
    }
  }, [suggestions, projectId, articleId, instrumentId, extractionInstanceId, loadSuggestions, user, authLoading]);

  /**
   * Fetches suggestion history for an item
   */
  const getSuggestionsHistory = useCallback(async (
    itemId: string,
    limit: number = 10
  ): Promise<AIAssessmentSuggestionHistoryItem[]> => {
    try {
      return await AIAssessmentSuggestionService.getHistory(itemId, limit);
    } catch (err) {
        console.error('[getSuggestionsHistory] Error:', err);
      return [];
    }
  }, []);

  /**
   * Gets latest suggestion for an item
   */
  const getLatestSuggestion = useCallback((itemId: string): AIAssessmentSuggestion | undefined => {
    const key = getAssessmentSuggestionKey(itemId);
    return suggestions[key];
  }, [suggestions]);

  /**
   * Refresh (reloads suggestions)
   */
  const refresh = useCallback(async (): Promise<LoadAssessmentSuggestionsResult> => {
    return await loadSuggestions();
  }, [loadSuggestions]);

  /**
   * Checks if an action is loading
   */
  const isActionLoading = useCallback((itemId: string): 'accept' | 'reject' | null => {
    const key = getAssessmentSuggestionKey(itemId);
    return actionLoading[key] ?? null;
  }, [actionLoading]);

  return {
    suggestions,
    loading,
    acceptSuggestion,
    rejectSuggestion,
    batchAccept,
    getSuggestionsHistory,
    getLatestSuggestion,
    refresh,
    isActionLoading,
  };
}
