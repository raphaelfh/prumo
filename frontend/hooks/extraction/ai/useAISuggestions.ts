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

import {useEffect, useState} from 'react';
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
import {filterSuggestionsByConfidence, isAbstention} from '@/lib/ai-extraction/suggestionUtils';
import {getErrorMessage} from '@/lib/ai-extraction/errors';
import {getRequiredUserId} from '@/services/authService';

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

  // Stable, content-derived key for the caller-provided instance ids. The
  // loader reads ONLY this primitive (never the `providedInstanceIds` array
  // directly), so neither the manual deps nor the React Compiler's inferred
  // reactivity re-run the loader/effect on every parent render when the caller
  // passes a fresh array with identical ids. Instance ids are UUIDs (no '|'),
  // so the join/split round-trip is lossless.
  const providedInstanceKey = providedInstanceIds?.join('|') ?? null;

    // Declare loadSuggestions BEFORE useEffect to avoid init error
  const loadSuggestions = (): Promise<LoadSuggestionsResult> => {
    setLoading(true);

    // Prefer caller-provided instance ids when available (QA gets these
    // straight from the HITL session response). Fall back to the
    // article-wide lookup that Data Extraction has always used.
    const keyedInstanceIds = providedInstanceKey ? providedInstanceKey.split('|') : [];
    const getInstanceIds = keyedInstanceIds.length > 0
      ? Promise.resolve(keyedInstanceIds)
      : AISuggestionService.getArticleInstanceIds(articleId);

    return getInstanceIds
      .then((instanceIds) => {
        if (instanceIds.length === 0) {
          console.warn('No instances found when loading suggestions');
          setSuggestions({});
          return { suggestions: {}, count: 0 } as LoadSuggestionsResult;
        }

        console.warn(`📋 ${instanceIds.length} instance(s) found for loading suggestions:`, {
          instanceIds: instanceIds.slice(0, 5),
          totalCount: instanceIds.length,
        });

        return AISuggestionService.loadSuggestions(articleId, instanceIds, runId);
      })
      .then((result) => {
        // CRITICAL: setSuggestions updates state asynchronously
        // Use updater function so previous state is considered
        setSuggestions(() => {
          const newSuggestions = result.suggestions;
          const count = Object.keys(newSuggestions).length;
          console.warn(`✅ [useAISuggestions] ${count} suggestion(s) loaded and state updated`);
          const suggestionKeys = Object.keys(newSuggestions).slice(0, 10);
          console.warn(`📝 [useAISuggestions] First suggestions loaded:`, {
            keys: suggestionKeys,
            total: count,
          });
          return newSuggestions;
        });
        return result;
      })
      .catch((err: unknown) => {
        console.error('Error loading suggestions:', err);
        const message = getErrorMessage(err);
        toast.error(`${t('extraction', 'errors_loadSuggestions')}: ${message}`);
        setSuggestions({});
        return { suggestions: {}, count: 0 } as LoadSuggestionsResult;
      })
      .finally(() => setLoading(false));
  };

    // useEffect AFTER loadSuggestions declaration
  useEffect(() => {
    if (!enabled || !articleId) return;
    // Microtask so the loader's setState calls run in an async callback.
    queueMicrotask(() => void loadSuggestions());
  }, [articleId, enabled, loadSuggestions]);

  // Shared accept body, keyed by an EXPLICIT proposal id + value. Both the
  // quick-accept (latest pending) and the review-popover version selection
  // funnel through here, so accept-by-id and accept-latest stay one code path.
  const selectProposalCore = async (
    instanceId: string,
    fieldId: string,
    proposalRecordId: string,
    value: unknown,
    confidence: number,
    silent: boolean,
  ): Promise<boolean> => {
    const key = getSuggestionKey(instanceId, fieldId);

    // Feedback visual imediato
    setActionLoading(prev => ({ ...prev, [key]: 'accept' }));

    const clearLoading = () =>
      setActionLoading(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });

    const doAccept = async (): Promise<boolean> => {
      if (acceptStrategy === 'human-proposal') {
        // Quality-Assessment path: the run lives in PROPOSAL until
        // Publish, so a ReviewerDecision (which requires REVIEW) would
        // be rejected by the backend. Instead, just bubble the value
        // up via ``onSuggestionAccepted`` — the consumer records it as
        // a ``human`` proposal through its existing form pipeline.
      } else {
        const userResult = await getRequiredUserId();
        if (!userResult.ok) throw userResult.error;

        // Accept the chosen proposal via the service (writes ReviewerDecision
        // with decision='accept_proposal' on a REVIEW-stage run). The backend
        // accepts any historical proposal_record_id (append-only audit trail),
        // which is what lets the reviewer switch between versions.
        await AISuggestionService.acceptSuggestion({
          suggestionId: proposalRecordId,
          projectId,
          articleId,
          instanceId,
          fieldId,
          value,
          confidence,
          reviewerId: userResult.data,
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
          // Reflect the CHOSEN version on the coord so the review popover
          // highlights it (and the field shows its value/confidence) across
          // close+reopen — accept-latest passes the same id/value/confidence,
          // so this is a no-op there.
          id: proposalRecordId,
          value,
          confidence,
          status: 'accepted' as const,
        };
          console.warn(`✅ Suggestion ${key} accepted - state updated to 'accepted'`);
          return {...next}; // New reference to ensure re-render
      });

        // Callback to fill input automatically (non-blocking)
      if (onSuggestionAccepted) {
          // Run in background so UI is not blocked
        Promise.resolve(onSuggestionAccepted(instanceId, fieldId, value)).catch(err => {
          console.error('Erro no callback onSuggestionAccepted:', err);
        });
      }

        if (!silent) toast.success(t('extraction', 'toastSuggestionAcceptedSuccess'));
        return true;
    };

    return doAccept()
      .catch((err: unknown) => {
        console.error('Error accepting suggestion:', err);
        const message = getErrorMessage(err);
        if (!silent) toast.error(`${t('extraction', 'errors_acceptSuggestion')}: ${message}`);
        return false;
      })
      .finally(clearLoading);
  };

  const acceptSuggestionCore = async (instanceId: string, fieldId: string, silent: boolean): Promise<boolean> => {
    const key = getSuggestionKey(instanceId, fieldId);
    const suggestion = suggestions[key];
    if (!suggestion) return false;
    // Quick-accept = select the latest pending proposal for this coord.
    return selectProposalCore(instanceId, fieldId, suggestion.id, suggestion.value, suggestion.confidence, silent);
  };

  // Public accept: surfaces its own toasts (silent=false) and keeps the
  // Promise<void> contract — only the batch path needs the success flag.
  const acceptSuggestion = async (instanceId: string, fieldId: string): Promise<void> => {
    await acceptSuggestionCore(instanceId, fieldId, false);
  };

  // Select a SPECIFIC historical version (by proposal id) and set the field to
  // its value. Drives the review popover's "Use this version". A null value is
  // valid — it records an explicit "no information" acknowledgement.
  const selectSuggestion = async (
    instanceId: string,
    fieldId: string,
    proposalRecordId: string,
    value: unknown,
    confidence: number,
  ): Promise<void> => {
    // The chosen version's own confidence is carried by the caller (the review
    // popover has it per row) — don't reconstruct it from the latest coord.
    await selectProposalCore(instanceId, fieldId, proposalRecordId, value, confidence, /* silent */ false);
  };

  const rejectSuggestion = async (instanceId: string, fieldId: string) => {
    const key = getSuggestionKey(instanceId, fieldId);
    const suggestion = suggestions[key];
    if (!suggestion) return;

    // Feedback visual imediato
    setActionLoading(prev => ({ ...prev, [key]: 'reject' }));

    const clearLoading = () =>
      setActionLoading(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });

    const doReject = async (): Promise<void> => {
      if (acceptStrategy === 'human-proposal') {
        // QA path: same logic as accept — no ReviewerDecision write.
        // Local state flip + onSuggestionRejected callback are enough.
      } else {
        const userResult = await getRequiredUserId();
        if (!userResult.ok) throw userResult.error;

          // Check if was accepted before (need to remove extracted_value)
        const wasAccepted = suggestion.status === 'accepted';

          // Reject suggestion using the service
        await AISuggestionService.rejectSuggestion({
          suggestionId: suggestion.id,
          reviewerId: userResult.data,
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
    };

    doReject()
      .catch((err: unknown) => {
        console.error('Error rejecting suggestion:', err);
        const message = getErrorMessage(err);
        toast.error(`${t('extraction', 'errors_rejectSuggestion')}: ${message}`);
      })
      .finally(clearLoading);
  };

  const batchAccept = async (threshold = 0.8) => {
    const filtered = filterSuggestionsByConfidence(suggestions, threshold);

    if (filtered.length === 0) {
        toast.info(t('extraction', 'noSuggestionConfidenceToast').replace('{{pct}}', String(Math.round(threshold * 100))));
      return;
    }

    // ADR-0016 decision #3: an AI abstention ("no information") must never be
    // silently bulk-accepted — a reviewer accepts it deliberately, one at a time.
    // Exclude markers so no confidence threshold can sweep them into accept-all
    // (an abstention normally has ~0 confidence, but this holds even if it didn't).
    const actionable = filtered.filter(([, suggestion]) => !isAbstention(suggestion.value));
    if (actionable.length === 0) {
        toast.info(t('extraction', 'noSuggestionConfidenceToast').replace('{{pct}}', String(Math.round(threshold * 100))));
      return;
    }

    // Accept each in silent mode so we fire ONE batch toast instead of N+1,
    // and count real successes so the batch toast can't claim success when
    // every accept actually failed (#160).
    const results = await Promise.all(
      actionable.map(([key]) => {
        // key format: `${instanceId}_${fieldId}`
        const [instanceId, ...fieldIdParts] = key.split('_');
        const fieldId = fieldIdParts.join('_'); // Caso field_id tenha underscores
        return acceptSuggestionCore(instanceId, fieldId, /* silent */ true);
      })
    );

    const accepted = results.filter(Boolean).length;
    if (accepted === 0) {
        toast.error(t('extraction', 'errors_batchAcceptSuggestions'));
      return;
    }
    toast.success(t('extraction', 'batchAcceptCountToast').replace('{{n}}', String(accepted)));
  };

  /**
   * Fetches full suggestion history for a specific field
   */
  const getSuggestionsHistory = async (
    instanceId: string,
    fieldId: string
  ): Promise<AISuggestionHistoryItem[]> =>
    AISuggestionService.getHistory(articleId, instanceId, fieldId, 10).catch((err: unknown) => {
      console.error('Error loading suggestion history:', err);
      const message = getErrorMessage(err);
      toast.error(`${t('extraction', 'errors_loadSuggestionsHistory')}: ${message}`);
      return [] as AISuggestionHistoryItem[];
    });

  /**
   * Returns the latest suggestion for a field (if present in local state)
   */
  const getLatestSuggestion = (
    instanceId: string,
    fieldId: string
  ): AISuggestion | undefined => {
    const key = getSuggestionKey(instanceId, fieldId);
    return suggestions[key];
  };

    // Helper to check if a suggestion is loading
  const isActionLoading = (instanceId: string, fieldId: string): 'accept' | 'reject' | null => {
    const key = getSuggestionKey(instanceId, fieldId);
    return actionLoading[key] || null;
  };

  return {
    suggestions,
    loading,
    acceptSuggestion,
    selectSuggestion,
    rejectSuggestion,
    batchAccept,
    getSuggestionsHistory,
    getLatestSuggestion,
    refresh: loadSuggestions,
    isActionLoading,
  };
}

