/**
 * Hook to manage AI suggestions
 *
 * Features:
 * - Load pending suggestions
 * - Accept suggestion (create extracted_value)
 * - Reject suggestion
 * - Batch accept by threshold
 *
 * @hook
 */

import {useCallback, useEffect, useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {toast} from 'sonner';
import {t} from '@/lib/copy';
import type {
    AISuggestion,
    AISuggestionHistoryItem,
    LoadSuggestionsResult,
    UseAISuggestionsProps,
    UseAISuggestionsReturn,
} from '@/types/ai-extraction';
import {getSuggestionKey} from '@/types/ai-extraction';
import {AISuggestionService} from '@/services/aiSuggestionService';
import {filterSuggestionsByConfidence} from '@/lib/ai-extraction/suggestionUtils';
import {AuthenticationError, getErrorMessage,} from '@/lib/ai-extraction/errors';

// =================== HOOK ===================

// Re-export types for compatibility with existing code
export type { AISuggestion, AISuggestionHistoryItem } from '@/types/ai-extraction';

export function useAISuggestions(props: UseAISuggestionsProps): UseAISuggestionsReturn {
  const {
    articleId,
    projectId,
    enabled = true,
    runId,
    instanceIds: providedInstanceIds,
    acceptStrategy = 'reviewer-decision',
    onSuggestionAccepted,
    onSuggestionRejected,
  } = props;

  const [suggestions, setSuggestions] = useState<Record<string, AISuggestion>>({});
  const [loading, setLoading] = useState(false);
    // Loading state per suggestion for immediate visual feedback
  const [actionLoading, setActionLoading] = useState<Record<string, 'accept' | 'reject' | null>>({});

  // Stable cache of pre-resolved instance ids — `useCallback` deps capture
  // it without re-running on every parent render.
  const providedInstanceKey = providedInstanceIds?.join('|') ?? null;

    // Declare loadSuggestions BEFORE useEffect to avoid init error
  const loadSuggestions = useCallback(async (): Promise<LoadSuggestionsResult> => {
    setLoading(true);

    try {
        console.warn('Loading AI suggestions...', {articleId, runId});

        // Prefer caller-provided instance ids when available (QA gets these
        // straight from the HITL session response). Fall back to the
        // article-wide lookup that Data Extraction has always used.
      const instanceIds = providedInstanceIds && providedInstanceIds.length > 0
        ? providedInstanceIds
        : await AISuggestionService.getArticleInstanceIds(articleId);

      if (instanceIds.length === 0) {
          console.warn('No instances found when loading suggestions');
        setSuggestions({});
        setLoading(false);
        return { suggestions: {}, count: 0 };
      }

        console.warn(`📋 ${instanceIds.length} instance(s) found for loading suggestions:`, {
            instanceIds: instanceIds.slice(0, 5), // First 5 IDs for debug
        totalCount: instanceIds.length
      });

        // Load suggestions using the service
      const result = await AISuggestionService.loadSuggestions(
        articleId,
        instanceIds,
        runId,
      );

        // CRITICAL: setSuggestions updates state asynchronously
        // Use updater function so previous state is considered
      setSuggestions(() => {
        const newSuggestions = result.suggestions;
        const count = Object.keys(newSuggestions).length;
          console.warn(`✅ [useAISuggestions] ${count} suggestion(s) loaded and state updated`);

          // Detailed log of loaded suggestion keys for debug
        const suggestionKeys = Object.keys(newSuggestions).slice(0, 10);
          console.warn(`📝 [useAISuggestions] First suggestions loaded:`, {
          keys: suggestionKeys,
          total: count
        });
        
        return newSuggestions;
      });

        // Return result directly for polling
      return result;

    } catch (err: any) {
        console.error('Error loading suggestions:', err);
      const message = getErrorMessage(err);
        toast.error(`${t('extraction', 'errors_loadSuggestions')}: ${message}`);
        setSuggestions({}); // Clear suggestions on error
      return { suggestions: {}, count: 0 };
    } finally {
      setLoading(false);
    }
  }, [articleId, runId, providedInstanceKey]);

    // useEffect AFTER loadSuggestions declaration
  useEffect(() => {
    if (!enabled || !articleId) return;
    loadSuggestions();
  }, [articleId, enabled, loadSuggestions]);

  const acceptSuggestion = useCallback(async (instanceId: string, fieldId: string) => {
    const key = getSuggestionKey(instanceId, fieldId);
    const suggestion = suggestions[key];
    if (!suggestion) return;

    // Feedback visual imediato
    setActionLoading(prev => ({ ...prev, [key]: 'accept' }));

    try {
      if (acceptStrategy === 'human-proposal') {
        // Quality-Assessment path: the run lives in PROPOSAL until
        // Publish, so a ReviewerDecision (which requires REVIEW) would
        // be rejected by the backend. Instead, just bubble the value
        // up via ``onSuggestionAccepted`` — the consumer records it as
        // a ``human`` proposal through its existing form pipeline.
      } else {
        // Get user more efficiently (cache if possible)
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new AuthenticationError();

        // Accept suggestion using the service (writes ReviewerDecision
        // with decision='accept_proposal' on a REVIEW-stage run).
        await AISuggestionService.acceptSuggestion({
          suggestionId: suggestion.id,
          projectId,
          articleId,
          instanceId,
          fieldId,
          value: suggestion.value,
          confidence: suggestion.confidence,
          reviewerId: user.id,
          runId,
        });
      }

        // Update status in local state to 'accepted' (do not remove!)
        // IMPORTANT: Create new object to ensure re-render
      setSuggestions(prev => {
        if (!prev[key]) {
            console.warn(`⚠️ Suggestion ${key} not found in state when accepting`);
          return prev;
        }
        const next = { ...prev };
        next[key] = {
          ...next[key],
          status: 'accepted' as const,
        };
          console.warn(`✅ Suggestion ${key} accepted - state updated to 'accepted'`);
          return {...next}; // New reference to ensure re-render
      });

        // Callback to fill input automatically (non-blocking)
      if (onSuggestionAccepted) {
          // Run in background so UI is not blocked
        Promise.resolve(onSuggestionAccepted(instanceId, fieldId, suggestion.value)).catch(err => {
          console.error('Erro no callback onSuggestionAccepted:', err);
        });
      }

        toast.success(t('extraction', 'toastSuggestionAcceptedSuccess'));

    } catch (err: any) {
        console.error('Error accepting suggestion:', err);
      const message = getErrorMessage(err);
        toast.error(`${t('extraction', 'errors_acceptSuggestion')}: ${message}`);
    } finally {
        // Clear loading after operation
      setActionLoading(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }, [suggestions, projectId, articleId, runId, acceptStrategy, onSuggestionAccepted]);

  const rejectSuggestion = useCallback(async (instanceId: string, fieldId: string) => {
    const key = getSuggestionKey(instanceId, fieldId);
    const suggestion = suggestions[key];
    if (!suggestion) return;

    // Feedback visual imediato
    setActionLoading(prev => ({ ...prev, [key]: 'reject' }));

    try {
      if (acceptStrategy === 'human-proposal') {
        // QA path: same logic as accept — no ReviewerDecision write.
        // Local state flip + onSuggestionRejected callback are enough.
      } else {
        // Obter user de forma mais eficiente
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new AuthenticationError();

          // Check if was accepted before (need to remove extracted_value)
        const wasAccepted = suggestion.status === 'accepted';

          // Reject suggestion using the service
        await AISuggestionService.rejectSuggestion({
          suggestionId: suggestion.id,
          reviewerId: user.id,
            wasAccepted, // Pass flag to remove extracted_value if needed
          instanceId,
          fieldId,
          projectId,
          articleId,
          runId,
        });
      }

        // Update status in local state to 'rejected' (do not remove!)
        // IMPORTANT: Create new object to ensure re-render e mostrar indicador visual
      setSuggestions(prev => {
        if (!prev[key]) {
            console.warn(`⚠️ Suggestion ${key} not found in state when rejecting`);
          return prev;
        }
        const next = { ...prev };
        next[key] = {
          ...next[key],
          status: 'rejected' as const,
        };
          console.warn(`✅ Suggestion ${key} rejected - state updated to 'rejected'`);
          return {...next}; // New reference to ensure re-render
      });

        // Callback to clear field when rejecting
      if (onSuggestionRejected) {
        Promise.resolve(onSuggestionRejected(instanceId, fieldId)).catch(err => {
          console.error('Erro no callback onSuggestionRejected:', err);
        });
      }

        toast.success(t('extraction', 'toastSuggestionRejectedSuccess'));

    } catch (err: any) {
        console.error('Error rejecting suggestion:', err);
      const message = getErrorMessage(err);
        toast.error(`${t('extraction', 'errors_rejectSuggestion')}: ${message}`);
    } finally {
        // Clear loading after operation
      setActionLoading(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }, [suggestions, projectId, articleId, runId, acceptStrategy, onSuggestionRejected]);

  const batchAccept = useCallback(async (threshold = 0.8) => {
    try {
      const filtered = filterSuggestionsByConfidence(suggestions, threshold);

      if (filtered.length === 0) {
          toast.info(t('extraction', 'noSuggestionConfidenceToast').replace('{{pct}}', String(Math.round(threshold * 100))));
        return;
      }

      await Promise.all(
        filtered.map(([key]) => {
          // key format: `${instanceId}_${fieldId}`
          const [instanceId, ...fieldIdParts] = key.split('_');
          const fieldId = fieldIdParts.join('_'); // Caso field_id tenha underscores
          return acceptSuggestion(instanceId, fieldId);
        })
      );

        toast.success(t('extraction', 'batchAcceptCountToast').replace('{{n}}', String(filtered.length)));

    } catch (err: any) {
      console.error('❌ Erro no batch accept:', err);
      const message = getErrorMessage(err);
        toast.error(`${t('extraction', 'errors_batchAcceptSuggestions')}: ${message}`);
    }
  }, [suggestions, acceptSuggestion]);

  /**
   * Fetches full suggestion history for a specific field
   */
  const getSuggestionsHistory = useCallback(async (
    instanceId: string,
    fieldId: string
  ): Promise<AISuggestionHistoryItem[]> => {
    try {
      return await AISuggestionService.getHistory(instanceId, fieldId, 10);
    } catch (err: any) {
        console.error('Error loading suggestion history:', err);
      const message = getErrorMessage(err);
        toast.error(`${t('extraction', 'errors_loadSuggestionsHistory')}: ${message}`);
      return [];
    }
  }, []);

  /**
   * Returns the latest suggestion for a field (if present in local state)
   */
  const getLatestSuggestion = useCallback((
    instanceId: string,
    fieldId: string
  ): AISuggestion | undefined => {
    const key = getSuggestionKey(instanceId, fieldId);
    return suggestions[key];
  }, [suggestions]);

    // Helper to check if a suggestion is loading
  const isActionLoading = useCallback((instanceId: string, fieldId: string): 'accept' | 'reject' | null => {
    const key = getSuggestionKey(instanceId, fieldId);
    return actionLoading[key] || null;
  }, [actionLoading]);

  return {
    suggestions,
    loading,
    acceptSuggestion,
    rejectSuggestion,
    batchAccept,
    getSuggestionsHistory,
    getLatestSuggestion,
    refresh: loadSuggestions,
    isActionLoading,
  };
}

