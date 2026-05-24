/**
 * Hook to load a reviewer's per-field values for an extraction run.
 *
 * Two-mode read path, switched by the run's current stage:
 *
 *  * ``stage='proposal'`` — the run is being filled in (manual edits as
 *    `human` proposals, AI proposals from extract_for_run). The form
 *    hydrates from ``runDetail.proposals`` (newest-per-coord, any
 *    source) so both human and AI proposals appear immediately. This
 *    mirrors the QA flow (``QualityAssessmentFullScreen.tsx:163-185``).
 *
 *  * ``stage in {'review','consensus','finalized'}`` — proposals have
 *    been "frozen" and reviewers are deciding. The form hydrates from
 *    ``extraction_reviewer_states`` (current decision pointer per
 *    coord, scoped to the active user) — the same path that has been
 *    in use since the ``extracted_values`` removal.
 *
 *  * ``stage='pending'`` or no run — empty map; autosave is also a
 *    no-op so the user's typing stays in local state until the page
 *    opens a session and the run lands in PROPOSAL.
 *
 * Run resolution moved out of this hook: the page resolves it via
 * ``useExtractionSession`` and passes ``runId`` + ``stage`` (+ proposals
 * when in PROPOSAL) in. There is no ``save()`` method anymore — the
 * autosave is the single writer.
 */

import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';

import { supabase } from '@/integrations/supabase/client';
import { extractValueFromDb } from '@/lib/validations/selectOther';
import { dispatchValueUpdates } from '@/lib/extraction/valueUpdates';
import { t } from '@/lib/copy';
import { ExtractionValueService } from '@/services/extractionValueService';
import type { ProposalRecordResponse } from '@/hooks/runs/types';

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
  proposals?: ProposalRecordResponse[];
  enabled?: boolean;
}

interface UseExtractedValuesReturn {
  values: Record<string, any>;
  updateValue: (instanceId: string, fieldId: string, value: any) => void;
  loading: boolean;
  initialized: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const REVIEWER_STATE_STAGES = new Set(['review', 'consensus', 'finalized']);

function resetValuesIfNeeded(
  setValues: Dispatch<SetStateAction<Record<string, any>>>,
) {
  setValues((prev) => (Object.keys(prev).length > 0 ? {} : prev));
}

function unwrapProposalValue(raw: unknown): unknown {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object' && raw !== null && 'value' in raw) {
    return (raw as { value: unknown }).value ?? null;
  }
  return raw;
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
  const { runId, stage, proposals, enabled = true } = props;

  const [values, setValues] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hydratedRunIdRef = useRef<string | null>(null);

  const applyLoadedValues = useCallback(
    (valuesMap: Record<string, any>) => {
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
    },
    [runId],
  );

  const loadValues = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);

      try {
        if (!runId || !stage) {
          hydratedRunIdRef.current = null;
          resetValuesIfNeeded(setValues);
          setInitialized(true);
          return;
        }

        if (stage === 'proposal') {
          const valuesMap: Record<string, any> = {};
          // ``proposals`` is sorted newest-first by the API; first hit per
          // coord wins, regardless of source — mirrors QA's hydration.
          for (const p of proposals ?? []) {
            const key = `${p.instance_id}_${p.field_id}`;
            if (key in valuesMap) continue;
            const unwrapped = unwrapProposalValue(p.proposed_value);
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

        if (REVIEWER_STATE_STAGES.has(stage)) {
          // Surface auth errors instead of treating them as "user is
          // signed out" — a transient Supabase 5xx on /auth/v1/user
          // would otherwise blank the entire extraction form silently
          // (#49). Throwing here flows into the catch below, which
          // sets ``error`` and toasts so the reviewer knows their
          // edits are not lost.
          const userRes = await supabase.auth.getUser();
          if (userRes.error) throw userRes.error;
          const user = userRes.data.user;
          if (!user) {
            hydratedRunIdRef.current = runId;
            resetValuesIfNeeded(setValues);
            return;
          }

          const rows = await ExtractionValueService.loadValuesForUser(
            runId,
            user.id,
          );
          const valuesMap: Record<string, any> = {};
          for (const row of rows) {
            if (row.decision === 'reject') continue;
            const key = `${row.instanceId}_${row.fieldId}`;
            const unit =
              typeof row.value === 'object' &&
              row.value !== null &&
              'unit' in (row.value as Record<string, unknown>)
                ? ((row.value as { unit: string | null }).unit ?? null)
                : null;
            valuesMap[key] = extractValueFromDb({ value: row.value, unit });
          }
          applyLoadedValues(valuesMap);
          setInitialized(true);
          return;
        }

        // PENDING / CANCELLED / unknown — no values to show.
        hydratedRunIdRef.current = runId;
        resetValuesIfNeeded(setValues);
        setInitialized(true);
      } catch (err: any) {
        console.error('Erro ao carregar valores extraídos:', err);
        setError(err.message || t('extraction', 'errors_loadExtractedValues'));
        toast.error(t('extraction', 'errors_loadExtractedValues'));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [runId, stage, proposals, applyLoadedValues],
  );

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
      resetValuesIfNeeded(setValues);
      setLoading(false);
      setInitialized(true);
      return;
    }
    void loadValues();
  }, [enabled, loadValues]);

  const updateValue = useCallback((instanceId: string, fieldId: string, value: any) => {
    const key = `${instanceId}_${fieldId}`;
    setValues((prev) => ({
      ...prev,
      [key]: value,
    }));
  }, []);

  const refresh = useCallback(async () => {
    await loadValues(true);
  }, [loadValues]);

  return {
    values,
    updateValue,
    loading,
    initialized,
    error,
    refresh,
  };
}
