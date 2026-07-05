/**
 * Hook to manage AI suggestions.
 *
 * Accepting/selecting/rejecting never writes to the backend from here: the
 * value bubbles up via the ``onSuggestion*`` callbacks into the screen's form
 * state, and the screen's autosave persists it (extraction: an ``edit``
 * decision carrying ``proposal_record_id`` via linkByKey — D0). ADR-0014
 * collapsed the stage model; the old PROPOSAL/REVIEW split this hook once
 * branched on (``acceptStrategy``) no longer exists.
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

// =================== HOOK ===================

// Re-export types for compatibility with existing code
export type { AISuggestion, AISuggestionHistoryItem } from '@/types/ai-extraction';

export function useAISuggestions(props: UseAISuggestionsProps): UseAISuggestionsReturn {
  const {
    articleId,
    enabled = true,
    runId,
    instanceIds: providedInstanceIds,
    onSuggestionAccepted,
    onSuggestionRejected,
  } = props;

  const [suggestions, setSuggestions] = useState<Record<string, AISuggestion>>({});
  const [loading, setLoading] = useState(false);
  // D0 (consensus AI trace): this session's real adoption events only —
  // accept/select set the chosen proposal id, reject tombstones with null.
  // NEVER hydrated from the read endpoint: the server marks any non-reject
  // caller decision 'accepted' (including plain manual edits), so hydrated
  // status would fabricate AI provenance for manually-typed values.
  const [sessionAdoption, setSessionAdoption] = useState<Record<string, string | null>>({});
  // True only after a successful load — consumers use it to tell "no AI
  // suggestion exists" apart from "the AI-existence signal is unavailable"
  // (a failed load must not mislabel decisions as Manual in consensus).
  const [suggestionsReady, setSuggestionsReady] = useState(false);

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
        const message = getErrorMessage(err);
        toast.error(`${t('extraction', 'errors_loadSuggestions')}: ${message}`);
        setSuggestionsReady(false);
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
  // Accepting never writes to the backend from here: the value bubbles up via
  // onSuggestionAccepted into the screen's form state, and the screen's
  // autosave persists it (extraction: an `edit` decision carrying
  // proposal_record_id via linkByKey — D0). Purely local state updates — the
  // async wrapper/error path that guarded the old service writes was removed
  // with them (2026-07-05 review).
  const selectProposalCore = async (
    instanceId: string,
    fieldId: string,
    proposalRecordId: string,
    value: unknown,
    confidence: number,
    silent: boolean,
  ): Promise<boolean> => {
    const key = getSuggestionKey(instanceId, fieldId);

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
      return {...next}; // New reference to ensure re-render
    });

    // D0: record the real adoption event for autosave's linkByKey.
    setSessionAdoption(prev => ({ ...prev, [key]: proposalRecordId }));

      // Callback to fill input automatically (non-blocking)
    if (onSuggestionAccepted) {
        // Run in background so UI is not blocked
      Promise.resolve(onSuggestionAccepted(instanceId, fieldId, value)).catch(err => {
        console.error('Error in onSuggestionAccepted callback:', err);
      });
    }

    if (!silent) toast.success(t('extraction', 'toastSuggestionAcceptedSuccess'));
    return true;
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

  // Rejecting never writes to the backend from here — same contract as
  // accept: the cleared value bubbles via onSuggestionRejected and the
  // screen's autosave persists it (link severed by the tombstone below).
  const rejectSuggestion = async (instanceId: string, fieldId: string) => {
    const key = getSuggestionKey(instanceId, fieldId);
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

    // D0: a reject severs any AI link for the coord (tombstone overrides
    // the caller's persisted decision link in deriveAiLinkByKey).
    setSessionAdoption(prev => ({ ...prev, [key]: null }));

      // Callback to clear field when rejecting
    if (onSuggestionRejected) {
      Promise.resolve(onSuggestionRejected(instanceId, fieldId)).catch(err => {
        console.error('Error in onSuggestionRejected callback:', err);
      });
    }

    toast.success(t('extraction', 'toastSuggestionRejectedSuccess'));
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

  return {
    suggestions,
    loading,
    sessionAdoption,
    suggestionsReady,
    acceptSuggestion,
    selectSuggestion,
    rejectSuggestion,
    batchAccept,
    getSuggestionsHistory,
    getLatestSuggestion,
    refresh: loadSuggestions,
  };
}

