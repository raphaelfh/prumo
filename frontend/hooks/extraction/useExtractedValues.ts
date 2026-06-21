/**
 * Hook to load a reviewer's per-field values for an extraction run.
 *
 * Two-mode read path, switched by the run's current stage AND kind:
 *
 *  * reviewer-state path — ``stage in {'consensus','finalized'}``, or an
 *    extraction run (``kind='extraction'``) in the editable ``'extract'``
 *    stage. Extraction humans write per-user ReviewerDecisions, so the form
 *    hydrates from ``extraction_reviewer_states`` (current decision pointer
 *    per coord, scoped to the active user). AI proposals surface as
 *    suggestions, not field pre-fills.
 *
 *  * proposals path — a QA run (``kind != 'extraction'``) in ``'extract'``.
 *    QA writes ``human`` proposals on the shared track, so the form
 *    hydrates from ``runDetail.proposals`` (newest-per-coord, blind-filtered).
 *
 *  * ``stage='pending'`` or no run — empty map; autosave is also a
 *    no-op so the user's typing stays in local state until the page
 *    opens a session and the run lands in EXTRACT.
 *
 * Run resolution moved out of this hook: the page resolves it via
 * ``useExtractionSession`` and passes ``runId`` + ``stage`` (+ proposals
 * when in PROPOSAL) in. There is no ``save()`` method anymore — the
 * autosave is the single writer.
 */

import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';

import { extractValueFromDb } from '@/lib/validations/selectOther';
import { dispatchValueUpdates } from '@/lib/extraction/valueUpdates';
import { pickLatestProposalPerCoord } from '@/lib/extraction/proposalValues';
import { t } from '@/lib/copy';
import { unwrapValue } from '@/services/extractionValueService';
import type { ProposalRecordResponse, RunViewCurrentValue } from '@/hooks/runs/types';

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
   * Run kind. In the collapsed ``'extract'`` stage it selects the read path:
   * ``'extraction'`` hydrates from reviewer-states (per-user decisions); any
   * other kind hydrates from raw proposals (QA). consensus/finalized always
   * use reviewer-states regardless of kind.
   */
  kind?: string | null;
  proposals?: ProposalRecordResponse[];
  /**
   * Pre-computed reviewer values embedded in the run view (review /
   * consensus / finalized stages) — the current decision per coord,
   * resolved and reviewer-scoped server-side. The review branch hydrates
   * directly from this array, with no separate client-side query.
   */
  currentValues?: RunViewCurrentValue[];
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

// Read-path selectors for the collapsed ``extract`` stage. Extraction writes
// per-user decisions (reviewer-states); QA writes shared proposals. consensus
// and finalized always resolve from reviewer-states.
function usesReviewerStatePath(
  stage: string | null | undefined,
  kind: string | null | undefined,
): boolean {
  return (
    stage === 'consensus' ||
    stage === 'finalized' ||
    (stage === 'extract' && kind === 'extraction')
  );
}

function usesProposalsPath(
  stage: string | null | undefined,
  kind: string | null | undefined,
): boolean {
  return stage === 'extract' && kind !== 'extraction';
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
  const { runId, stage, kind, proposals, currentValues, currentUserId, enabled = true } = props;

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
    // path (proposal + reviewer-state) routes through here, including the
    // empty-map case, so switching runs replaces the baseline too. Keep the
    // SAME reference when the content is unchanged: this runs on every
    // ``loadValues`` (e.g. each ``proposals`` change), and emitting a fresh
    // object each time churned re-renders (and, with an unstable proposals
    // prop, looped to OOM).
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

        if (usesProposalsPath(stage, kind)) {
          // Bug A (multi-reviewer blind leak): the previous logic took
          // newest-per-coord regardless of source, which surfaced one
          // reviewer's ``human`` proposals in another reviewer's form
          // the moment they opened the same shared Run (sessions are
          // intentionally shared per (article × template); see
          // ``hitl_session_service._reuse_or_create_run``). To preserve
          // the blind-review contract we filter ``human`` proposals by
          // ``source_user_id``: the current reviewer sees only their
          // own human edits, plus all AI / system proposals (which are
          // not reviewer-attributable opinions).
          // Select the NEWEST proposal per coordinate (by ``created_at``),
          // honoring the blind-review filter. Selecting by ``created_at``
          // rather than array position fixes the "edited value reverts to
          // the old value after refresh" bug: proposals are append-only, the
          // API returns them oldest-first, and the previous first-hit-wins
          // loop therefore surfaced the stale original value. The blind
          // filter (a ``human`` proposal from another reviewer is hidden)
          // now lives in the shared resolver. See
          // ``frontend/lib/extraction/proposalValues.ts``.
          const valuesMap: Record<string, any> = {};
          const latestByCoord = pickLatestProposalPerCoord(proposals, {
            currentUserId,
          });
          for (const [key, p] of latestByCoord) {
            const unwrapped = unwrapValue(p.proposed_value);
            const unit =
              typeof p.proposed_value === 'object' &&
              p.proposed_value !== null &&
              'unit' in (p.proposed_value as Record<string, unknown>)
                ? ((p.proposed_value as { unit: string | null }).unit ?? null)
                : null;
            valuesMap[key] = extractValueFromDb({ value: unwrapped, unit });
          }
          applyLoadedValues(valuesMap);
          setInitialized(true);
          return;
        }

        if (usesReviewerStatePath(stage, kind)) {
          // ``currentUserId`` comes from AuthContext (zero network), so the
          // transient /auth/v1/user 5xx that used to blank the form (#49) is
          // gone. A null id means signed out → reset, don't fetch values.
          if (!currentUserId) {
            hydratedRunIdRef.current = runId;
            resetValuesIfNeeded(setValues);
            return;
          }

          const valuesMap: Record<string, any> = {};
          for (const cv of currentValues ?? []) {
            if (cv.decision === 'reject') continue;
            const key = `${cv.instance_id}_${cv.field_id}`;
            const unwrapped = unwrapValue(cv.value);
            const unit =
              typeof unwrapped === 'object' &&
              unwrapped !== null &&
              'unit' in (unwrapped as Record<string, unknown>)
                ? ((unwrapped as { unit: string | null }).unit ?? null)
                : null;
            valuesMap[key] = extractValueFromDb({ value: unwrapped, unit });
          }
          applyLoadedValues(valuesMap);
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
