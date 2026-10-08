/**
 * Hook to load a run's AI suggestions (latest per coordinate) and their
 * history. Accepting one is the reviewer's decision and lives in
 * ``useRunValues``; rejecting marks the suggestion locally and bubbles via
 * ``onSuggestionRejected`` so the screen clears the field (autosave writes
 * the clear). Nothing here writes to the backend.
 *
 * @hook
 */

import {useEffect, useRef, useState} from 'react';
import {toast} from 'sonner';
import {t} from '@/lib/copy';
import type {
    AISuggestion,
    AISuggestionHistoryItem,
    LoadSuggestionsResult,
    UseAISuggestionsProps,
    UseAISuggestionsReturn,
} from '@/types/ai-extraction';
import {coordKey} from '@/lib/runs/coord';
import {AISuggestionService} from '@/services/aiSuggestionService';
import {getErrorMessage} from '@/lib/ai-extraction/errors';

// =================== HOOK ===================

// Re-export types for compatibility with existing code
export type { AISuggestion, AISuggestionHistoryItem } from '@/types/ai-extraction';

export function useAISuggestions(props: UseAISuggestionsProps): UseAISuggestionsReturn {
  const {
    articleId,
    enabled = true,
    runId,
    instanceIds: providedInstanceIds,
    onSuggestionRejected,
  } = props;

  const [suggestions, setSuggestions] = useState<Record<string, AISuggestion>>({});
  const [loading, setLoading] = useState(false);
  // True only after a successful load — consumers use it to tell "no AI
  // suggestion exists" apart from "the AI-existence signal is unavailable"
  // (a failed load must not mislabel decisions as Manual in consensus).
  const [suggestionsReady, setSuggestionsReady] = useState(false);

  // Monotonic counter identifying the newest in-flight load; see the guard in
  // loadSuggestions (#406).
  const loadGenerationRef = useRef(0);

  // Stable, content-derived key for the caller-provided instance ids. The
  // loader reads ONLY this primitive (never the `providedInstanceIds` array
  // directly), so neither the manual deps nor the React Compiler's inferred
  // reactivity re-run the loader/effect on every parent render when the caller
  // passes a fresh array with identical ids. Instance ids are UUIDs (no '|'),
  // so the join/split round-trip is lossless.
  const providedInstanceKey = providedInstanceIds?.join('|') ?? null;

    // Declare loadSuggestions BEFORE useEffect to avoid init error
  const loadSuggestions = (): Promise<LoadSuggestionsResult> => {
    // Generation guard: the effect re-runs on articleId change, so a load
    // started for one article must not write its suggestions once a newer
    // load has begun — otherwise article A's map lands on article B (#406).
    // The returned promise still resolves for whoever awaited it; only the
    // state writes are suppressed.
    loadGenerationRef.current += 1;
    const generation = loadGenerationRef.current;
    const isCurrent = () => generation === loadGenerationRef.current;

    setLoading(true);
    // Not ready while ANY load is in flight — consumers (the consensus
    // Manual chip) must see null, not a stale previous map, mid-refresh.
    setSuggestionsReady(false);

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
          if (isCurrent()) setSuggestions({});
          return { suggestions: {}, count: 0 } as LoadSuggestionsResult;
        }

        console.warn(`📋 ${instanceIds.length} instance(s) found for loading suggestions:`, {
          instanceIds: instanceIds.slice(0, 5),
          totalCount: instanceIds.length,
        });

        return AISuggestionService.loadSuggestions(articleId, instanceIds, runId);
      })
      .then((result) => {
        if (!isCurrent()) return result;
        setSuggestionsReady(true);
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
        if (isCurrent()) {
          const message = getErrorMessage(err);
          toast.error(`${t('extraction', 'errors_loadSuggestions')}: ${message}`);
          setSuggestionsReady(false);
          setSuggestions({});
        }
        return { suggestions: {}, count: 0 } as LoadSuggestionsResult;
      })
      .finally(() => {
        if (isCurrent()) setLoading(false);
      });
  };

    // useEffect AFTER loadSuggestions declaration
  useEffect(() => {
    if (!enabled || !articleId) return;
    // Microtask so the loader's setState calls run in an async callback.
    queueMicrotask(() => void loadSuggestions());
  }, [articleId, enabled, loadSuggestions]);

  // Rejecting never writes to the backend from here: the cleared value
  // bubbles via onSuggestionRejected and the screen's autosave persists it.
  const rejectSuggestion = async (instanceId: string, fieldId: string) => {
    const key = coordKey(instanceId, fieldId);
    const suggestion = suggestions[key];
    if (!suggestion) return;

      // Update status in local state to 'rejected' (do not remove!)
      // IMPORTANT: Create new object to ensure re-render
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
      return {...next}; // New reference to ensure re-render
    });

      // Callback to clear field when rejecting
    if (onSuggestionRejected) {
      Promise.resolve(onSuggestionRejected(instanceId, fieldId)).catch(err => {
        console.error('Error in onSuggestionRejected callback:', err);
      });
    }

    toast.success(t('extraction', 'toastSuggestionRejectedSuccess'));
  };

  /**
   * Fetches full suggestion history for a specific field. `limit` defaults to
   * the form-popover depth; the consensus trace passes 50 so an adopted
   * version is less likely to fall outside the loaded window (the popover
   * shows an explicit notice when it still does — D5). Backend caps at 100.
   *
   * Failures propagate: the review popover owns the error surface (an inline
   * "couldn't load" state) — swallowing to [] here would render a definitive
   * "No versions" on an audit surface after a throttled/failed fetch.
   */
  const getSuggestionsHistory = (
    instanceId: string,
    fieldId: string,
    limit = 10,
  ): Promise<AISuggestionHistoryItem[]> =>
    AISuggestionService.getHistory(articleId, instanceId, fieldId, limit);

  return {
    suggestions,
    loading,
    suggestionsReady,
    rejectSuggestion,
    getSuggestionsHistory,
    refresh: loadSuggestions,
  };
}

