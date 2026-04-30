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

  useEffect(() => {
    if (!enabled || !runId) return;

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      void saveDiff();
    }, 3000);

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, enabled, runId]);

  const saveDiff = async () => {
    if (!runId) return;
    setIsSaving(true);
    setError(null);

    try {
      const dirty: Array<[string, any]> = [];
      for (const [key, value] of Object.entries(values)) {
        if (value === null || value === undefined || value === '') continue;
        const stringified = JSON.stringify(value);
        if (lastSavedByKey.current[key] === stringified) continue;
        dirty.push([key, value]);
      }
      if (dirty.length === 0) {
        setIsSaving(false);
        return;
      }

      await Promise.all(
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
          await apiClient(`/api/v1/runs/${runId}/proposals`, {
            method: 'POST',
            body: {
              instance_id: instanceId,
              field_id: fieldId,
              source: 'human',
              proposed_value: { value: writeValue ?? null },
            },
          });
          lastSavedByKey.current[key] = JSON.stringify(valueData);
        }),
      );

      setLastSaved(new Date());
    } catch (err: any) {
      console.error('Auto-save error:', err);
      setError(err.message || t('extraction', 'errors_autoSaveFailed'));
      toast.error(t('extraction', 'errors_autoSaveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const saveNow = async () => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    await saveDiff();
  };

  return { isSaving, lastSaved, error, saveNow };
}
