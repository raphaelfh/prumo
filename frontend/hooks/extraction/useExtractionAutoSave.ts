/**
 * Auto-save hook — debounces user edits and persists them as
 * ``human`` proposals on the active extraction run.
 *
 * Mirrors the QA flow (`QualityAssessmentFullScreen.handleValueChange`):
 * every changed field becomes a `ProposalRecord(source='human')` write.
 * The run lives in PROPOSAL while the user is editing; advancing to
 * REVIEW is an explicit action ("Submit for review") so consensus and
 * multi-reviewer accept/reject only kick in once the owner is done.
 *
 * Run resolution moved out of this hook: the page opens (or resumes) a
 * Run via `useExtractionSession` and passes the resulting `runId` in.
 * If `runId` is null/undefined the autosave is a silent no-op.
 *
 * Diff-aware: only fields whose value changed since the last successful
 * save are written, so the append-only `extraction_proposal_records`
 * table doesn't accumulate one duplicate row per debounce tick.
 *
 * Bypasses ``useCreateProposal`` (and its TanStack Query
 * `invalidateQueries(runDetail)` side effect) on purpose — the autosave
 * fires per keystroke, and invalidating the run detail every tick
 * triggers a `GET /runs/{id}` + `/reviewers` round-trip that the form
 * doesn't need (local state already shows the typed value). The next
 * natural refetch picks up the freshly written proposals.
 */

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { extractValueForSave } from '@/lib/validations/selectOther';
import { t } from '@/lib/copy';
import { apiClient } from '@/integrations/api';

interface UseExtractionAutoSaveProps {
  runId: string | null | undefined;
  values: Record<string, any>;
  enabled?: boolean;
}

export interface UseExtractionAutoSaveReturn {
  isSaving: boolean;
  lastSaved: Date | null;
  error: string | null;
  saveNow: () => Promise<void>;
}

export function useExtractionAutoSave(
  props: UseExtractionAutoSaveProps,
): UseExtractionAutoSaveReturn {
  const { runId, values, enabled = true } = props;

  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>();
  // Last successfully written value per `${instanceId}_${fieldId}`,
  // stringified so we can compare nested objects (selects, units, etc).
  const lastSavedByKey = useRef<Record<string, string>>({});
  // Mutex guard — React state updates are async, so `isSaving` cannot be
  // used to detect overlap. A ref is the only mutual-exclusion primitive
  // that works across overlapping debounce/saveNow invocations.
  const isSavingRef = useRef(false);

  useEffect(() => {
    if (!enabled || !runId) return;

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      void saveDiff();
    }, 3000);

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [values, enabled, runId]);

  const saveDiff = async () => {
    if (!runId) return;
    // Concurrency guard — a previous saveDiff is still in flight. Bail
    // out so the second writer can't read pre-update `lastSavedByKey`
    // and re-POST the same proposals (duplicate row in
    // ``extraction_proposal_records``).
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    setIsSaving(true);
    setError(null);

    try {
      const dirty: Array<[string, any]> = [];
      for (const [key, value] of Object.entries(values)) {
        // Skip `undefined` (field never touched) but treat `null` and
        // `''` as deliberate clears — they must be persisted as
        // `{ value: null }` proposals so reloads don't resurrect the
        // previous value.
        if (value === undefined) continue;
        const stringified = JSON.stringify(value ?? null);
        if (lastSavedByKey.current[key] === stringified) continue;
        dirty.push([key, value]);
      }
      if (dirty.length === 0) {
        return;
      }

      // ``Promise.allSettled`` so a single failed write does not abort
      // the others mid-flight; otherwise their `lastSavedByKey` updates
      // race the catch block and leave the diff map inconsistent.
      const results = await Promise.allSettled(
        dirty.map(async ([key, valueData]) => {
          const [instanceId, fieldId] = key.split('_');
          const {
            value: actualValue,
            unit,
            isOther,
          } = extractValueForSave(valueData);
          const writeValue = isOther
            ? actualValue
            : unit !== null && unit !== undefined
              ? { value: actualValue, unit }
              : actualValue;
          // Treat empty-string clears as `null` on the wire so the
          // backend records a deliberate "no value" proposal (#25);
          // otherwise the JSONB column stores `""` and the reload still
          // appears non-empty in the UI.
          const normalized =
            writeValue === '' || writeValue === undefined ? null : writeValue;
          await apiClient(`/api/v1/runs/${runId}/proposals`, {
            method: 'POST',
            body: {
              instance_id: instanceId,
              field_id: fieldId,
              source: 'human',
              proposed_value: { value: normalized },
            },
          });
          lastSavedByKey.current[key] = JSON.stringify(valueData ?? null);
        }),
      );

      const failures = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      if (failures.length > 0) {
        const first = failures[0].reason;
        const message =
          first instanceof Error ? first.message : String(first ?? 'unknown');
        throw new Error(message);
      }

      setLastSaved(new Date());
    } catch (err: any) {
      console.error('Auto-save error:', err);
      setError(err.message || t('extraction', 'errors_autoSaveFailed'));
      toast.error(t('extraction', 'errors_autoSaveFailed'));
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  const saveNow = async () => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    // Mirror the debounced path guard — callers may flush on unmount or
    // navigation even when the run is read-only (finalized run, consensus
    // view). Without this check, ``saveNow`` would POST proposals to a
    // non-PROPOSAL run and surface a spurious error toast.
    if (!enabled || !runId) return;
    await saveDiff();
  };

  return { isSaving, lastSaved, error, saveNow };
}
