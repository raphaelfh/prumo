/**
 * Hook to load a reviewer's per-field values for an extraction run.
 *
 * Read path, switched by the run's current stage:
 *
 *  * published path — ``stage='finalized'``. The run is published and
 *    read-only: the form hydrates ONLY from ``publishedStates`` (spec
 *    2026-07-02 D3) and the values map is fully replaced, never merged.
 *
 *  * reviewer-state path — ``stage='extract'`` or ``stage='consensus'``.
 *    Humans write per-user ReviewerDecisions (both run kinds since D8), so
 *    the form hydrates from ``current_values`` (current decision per coord,
 *    resolved and caller-scoped server-side). AI proposals surface as
 *    suggestions, not field pre-fills.
 *
 *  * ``stage='pending'`` or no run — empty map; autosave is also a
 *    no-op so the user's typing stays in local state until the page
 *    opens a session and the run lands in EXTRACT.
 *
 * Run resolution moved out of this hook: the page resolves it via
 * ``useExtractionSession`` and passes ``runId`` + ``stage`` in. There is no
 * ``save()`` method anymore — the autosave is the single writer.
 */

import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';

import { dispatchValueUpdates } from '@/lib/extraction/valueUpdates';
import { t } from '@/lib/copy';
import { currentValuesToValuesMap, publishedStatesToValuesMap } from '@/lib/extraction/publishedValues';
import type {
  PublishedStateResponse,
  RunViewCurrentValue,
} from '@/hooks/runs/types';

export interface ExtractedValueData {
  id?: string;
  instanceId: string;
  fieldId: string;
  value: any;
  source?: 'human' | 'ai' | 'rule';
  confidence?: number;
}

interface UseExtractedValuesProps {
  runId: string | null | undefined;
  stage: string | null | undefined;
  /**
   * Pre-computed reviewer values embedded in the run view (extract /
   * consensus stages) — the current decision per coord, resolved and
   * reviewer-scoped server-side. The reviewer-state branch hydrates
   * directly from this array, with no separate client-side query.
   */
  currentValues?: RunViewCurrentValue[];
  /**
   * Published rows from the run view. At ``stage === 'finalized'`` the form
   * hydrates ONLY from these (spec 2026-07-02 D3) — published truth, not the
   * viewer's decision stream.
   */
  publishedStates?: PublishedStateResponse[];
  /**
   * Current reviewer id, supplied by the caller (from AuthContext via
   * ``useCurrentUser``) so this hook never fires its own ``auth.getUser``
   * round-trip — it re-runs on every proposals/stage change, which made it
   * the dominant ``/auth/v1/user`` multiplier on run open.
   */
  currentUserId: string | null;
  enabled?: boolean;
}

interface UseExtractedValuesReturn {
  values: Record<string, any>;
  /**
   * The raw server-loaded value map (per ``${instanceId}_${fieldId}``) this
   * hook last hydrated from. Passed to ``useAutoSaveProposals`` as the
   * baseline so opening a run doesn't re-POST loaded values on mount.
   */
  loadedValues: Record<string, any>;
  updateValue: (instanceId: string, fieldId: string, value: any) => void;
  loading: boolean;
  initialized: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

// Both run kinds write per-user decisions since D8, so extract AND consensus
// hydrate from the caller-scoped ``current_values`` resolution; finalized
// resolves from published_states (dedicated branch in ``doLoad``).
function usesReviewerStatePath(stage: string | null | undefined): boolean {
  return stage === 'extract' || stage === 'consensus';
}

function resetValuesIfNeeded(
  setValues: Dispatch<SetStateAction<Record<string, any>>>,
) {
  setValues((prev) => (Object.keys(prev).length > 0 ? {} : prev));
}

function mergeValuesById(
  prev: Record<string, any>,
  next: Record<string, any>,
): Record<string, any> {
  // Local edits are authoritative. ``useAutoSaveProposals`` is the
  // sole writer that flips ``proposed_value`` on the backend; any
  // diff between ``prev[key]`` and ``next[key]`` for a key the user
  // has touched means the autosave POST simply hasn't landed yet (or
  // a TanStack ``useRun`` refetch raced ahead of it). Overwriting in
  // that window erased the keystroke before autosave's debounce
  // fired — the autosave then saw "no dirty entries" and skipped the
  // POST, silently dropping the input. We only adopt backend-shaped
  // entries for coords absent from local state (initial hydration +
  // AI proposals that introduce brand-new fields).
  let changed = false;
  const addedKeys: string[] = [];
  const out = { ...prev };
  for (const [key, value] of Object.entries(next)) {
    if (key in prev) continue;
    out[key] = value;
    changed = true;
    addedKeys.push(key);
  }
  if (addedKeys.length > 0) {
    requestAnimationFrame(() => dispatchValueUpdates(addedKeys));
  }
  return changed ? out : prev;
}

export function useExtractedValues(
  props: UseExtractedValuesProps,
): UseExtractedValuesReturn {
  const {
    runId,
    stage,
    currentValues,
    publishedStates,
    currentUserId,
    enabled = true,
  } = props;

  const [values, setValues] = useState<Record<string, any>>({});
  // Raw server map the hook hydrated from — the autosave baseline.
  const [loadedValues, setLoadedValues] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hydratedRunIdRef = useRef<string | null>(null);

  const applyLoadedValues = (valuesMap: Record<string, any>) => {
    // Expose the raw server map as the autosave baseline (see return docs)
    // so the form never re-POSTs hydrated values on mount. Every hydration
    // path routes through here, including the empty-map case, so switching
    // runs replaces the baseline too. Keep the SAME reference when the
    // content is unchanged: this runs on every ``loadValues`` (e.g. each
    // run-view refetch), and emitting a fresh object each time churned
    // re-renders (and, with an unstable input prop, looped to OOM).
    setLoadedValues((prev) =>
      JSON.stringify(prev) === JSON.stringify(valuesMap) ? prev : valuesMap,
    );
    setValues((prev) => {
      if (hydratedRunIdRef.current !== runId) {
        hydratedRunIdRef.current = runId ?? null;
        const addedKeys = Object.keys(valuesMap);
        if (addedKeys.length > 0) {
          requestAnimationFrame(() => dispatchValueUpdates(addedKeys));
        }
        return valuesMap;
      }
      return mergeValuesById(prev, valuesMap);
    });
  };

  const loadValues = (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);

      const doLoad = async () => {
        if (!runId || !stage) {
          hydratedRunIdRef.current = null;
          resetValuesIfNeeded(setValues);
          setInitialized(true);
          return;
        }

        if (stage === 'finalized') {
          // Published truth only — no reviewer-state fallback. A coord
          // without a published row renders empty (it was never published).
          // Full REPLACE, bypassing applyLoadedValues: its same-run branch
          // merges (local-edits-win), which would keep stale pre-finalize
          // reviewer-state values after an in-session consensus → finalized
          // flip. The JSON-equality guards keep identity stable across
          // refetch churn (mirrors the setLoadedValues check below).
          const publishedMap = publishedStatesToValuesMap(publishedStates);
          setValues((prev) =>
            JSON.stringify(prev) === JSON.stringify(publishedMap) ? prev : publishedMap,
          );
          setLoadedValues((prev) =>
            JSON.stringify(prev) === JSON.stringify(publishedMap) ? prev : publishedMap,
          );
          hydratedRunIdRef.current = runId ?? null;
          setInitialized(true);
          return;
        }

        if (usesReviewerStatePath(stage)) {
          // ``currentUserId`` comes from AuthContext (zero network), so the
          // transient /auth/v1/user 5xx that used to blank the form (#49) is
          // gone. A null id means signed out → reset, don't fetch values.
          if (!currentUserId) {
            hydratedRunIdRef.current = runId;
            resetValuesIfNeeded(setValues);
            return;
          }

          // Marker-preserving conversion (the SAME map builder the QA screen
          // uses): a resolved ADR-0016 disposition — e.g. an accepted "No
          // information" — hydrates as the raw `{value:null, absent_reason}`
          // envelope so FieldInput lights the disposition button and the coord
          // counts as filled. The bare `envelopeToFieldValue` peel collapsed
          // the marker to null, which de-selected the button, dropped the
          // section count, and rendered the accepted-AI fallback as
          // "[object Object]".
          applyLoadedValues(currentValuesToValuesMap(currentValues));
          setInitialized(true);
          return;
        }

        // PENDING / CANCELLED / unknown — no values to show.
        hydratedRunIdRef.current = runId;
        resetValuesIfNeeded(setValues);
        setInitialized(true);
      };

      return doLoad()
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : t('extraction', 'errors_loadExtractedValues');
          console.error('Erro ao carregar valores extraídos:', err);
          setError(message);
          toast.error(t('extraction', 'errors_loadExtractedValues'));
        })
        .finally(() => { if (!silent) setLoading(false); });
  };

  useEffect(() => {
    if (!enabled) {
      // ``loading`` is initialised to ``true`` (so the first paint shows
      // a spinner instead of an empty form). When the hook is disabled
      // — typically because the parent has no active ``runId`` yet,
      // e.g. while ``useExtractionSession`` is still POSTing
      // ``/api/v1/hitl/sessions`` — there is nothing to load, but the
      // effect must still flip ``loading`` to ``false`` so the page's
      // ``if (loading || valuesLoading) → spinner`` gate doesn't sit on
      // the spinner forever. Treat ``initialized = true`` here as
      // "we know there are no values to show" (the empty map below).
      hydratedRunIdRef.current = runId ?? null;
      // Microtask so the reset's setState calls run in an async callback.
      queueMicrotask(() => {
        resetValuesIfNeeded(setValues);
        setLoading(false);
        setInitialized(true);
      });
      return;
    }
    // Microtask so the loader's setState calls run in an async callback.
    queueMicrotask(() => void loadValues());
  }, [enabled, loadValues]);

  const updateValue = (instanceId: string, fieldId: string, value: any) => {
    const key = `${instanceId}_${fieldId}`;
    setValues((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const refresh = () => loadValues(true);

  return {
    values,
    loadedValues,
    updateValue,
    loading,
    initialized,
    error,
    refresh,
  };
}
