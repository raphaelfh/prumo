/**
 * Hook to load + persist a reviewer's per-field values for an extraction
 * run.
 *
 * Post-migration off `extracted_values`: reads come from
 * `extraction_reviewer_states` joined with `extraction_reviewer_decisions`
 * (latest decision per field), filtered to the current user. Saves go
 * through `POST /v1/runs/{runId}/decisions` with `decision='edit'`.
 *
 * The active extraction run is resolved on first load via
 * `ExtractionValueService.findActiveRun(articleId, templateId)`. If no
 * run exists yet (i.e. AI extraction hasn't been triggered), reads
 * return empty and saves are skipped silently — the consumer should
 * trigger extraction first.
 */

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { supabase } from '@/integrations/supabase/client';
import { extractValueForSave, extractValueFromDb } from '@/lib/validations/selectOther';
import { dispatchValueUpdates, shallowValueEqual } from '@/lib/extraction/valueUpdates';
import { t } from '@/lib/copy';
import { ExtractionValueService } from '@/services/extractionValueService';

export interface ExtractedValueData {
  id?: string;
  instanceId: string;
  fieldId: string;
  value: any;
  source?: 'human' | 'ai' | 'rule';
  confidence?: number;
}

interface UseExtractedValuesProps {
  articleId: string;
  projectId: string;
  templateId?: string;
  enabled?: boolean;
}

interface UseExtractedValuesReturn {
  values: Record<string, any>;
  updateValue: (instanceId: string, fieldId: string, value: any) => void;
  loading: boolean;
  initialized: boolean;
  error: string | null;
  save: () => Promise<void>;
  refresh: () => Promise<void>;
  runId: string | null;
}

export function useExtractedValues(props: UseExtractedValuesProps): UseExtractedValuesReturn {
  const { articleId, projectId: _projectId, templateId, enabled = true } = props;

  const [values, setValues] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);

  const loadValues = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);

      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          setValues({});
          return;
        }

        const run = await ExtractionValueService.findActiveRun(
          articleId,
          templateId ?? null,
        );
        setRunId(run?.id ?? null);
        if (!run) {
          setValues({});
          setInitialized(true);
          return;
        }

        const rows = await ExtractionValueService.loadValuesForUser(run.id, user.id);

        const valuesMap: Record<string, any> = {};
        for (const row of rows) {
          if (row.decision === 'reject') continue;
          const key = `${row.instanceId}_${row.fieldId}`;
          // The JSONB blob may carry a sibling `unit` key for number-with-unit
          // fields; pull it out so `extractValueFromDb` reassembles the
          // {value, unit} object the form expects.
          const unit =
            typeof row.value === 'object' && row.value !== null && 'unit' in row.value
              ? (row.value as { unit: string | null }).unit
              : null;
          valuesMap[key] = extractValueFromDb({ value: row.value, unit });
        }

        setValues((prev) => mergeValuesById(prev, valuesMap));
        setInitialized(true);
      } catch (err: any) {
        console.error('Erro ao carregar valores extraídos:', err);
        setError(err.message || t('extraction', 'errors_loadExtractedValues'));
        toast.error(t('extraction', 'errors_loadExtractedValues'));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [articleId, templateId],
  );

  useEffect(() => {
    if (!enabled || !articleId) return;
    void loadValues();
  }, [articleId, enabled, loadValues]);

  /**
   * Shallow merge keyed by `${instanceId}_${fieldId}`. Preserves the
   * reference of unchanged entries so React's diff sees stable identities;
   * only the values that the backend actually returned (or that user touched)
   * trigger downstream re-renders. Values present in `prev` but absent in
   * `next` are kept (an in-flight refresh shouldn't visually drop them).
   *
   * Side effect: keys whose values changed get marked as "just-updated" so
   * the UI can briefly highlight them — better feedback than the previous
   * "everything bounces" refresh + scroll-to-top.
   */
  function mergeValuesById(
    prev: Record<string, any>,
    next: Record<string, any>,
  ): Record<string, any> {
    let changed = false;
    const updatedKeys: string[] = [];
    const out = { ...prev };
    for (const [key, value] of Object.entries(next)) {
      const before = out[key];
      const isDifferent = !shallowValueEqual(before, value);
      if (isDifferent) {
        out[key] = value;
        changed = true;
        if (before !== undefined) {
          updatedKeys.push(key);
        }
      }
    }
    if (updatedKeys.length > 0) {
      requestAnimationFrame(() => dispatchValueUpdates(updatedKeys));
    }
    return changed ? out : prev;
  }

  const updateValue = useCallback((instanceId: string, fieldId: string, value: any) => {
    const key = `${instanceId}_${fieldId}`;
    setValues((prev) => ({
      ...prev,
      [key]: value,
    }));
  }, []);

  const save = useCallback(async () => {
    if (!runId) {
      console.warn('[useExtractedValues.save] No active run — skipping save.');
      return;
    }

    const entries = Object.entries(values);
    if (entries.length === 0) return;

    await Promise.all(
      entries.map(([key, valueData]) => {
        const [instanceId, fieldId] = key.split('_');
        const { value: actualValue, unit, isOther } = extractValueForSave(valueData);
        // For number-with-unit fields, fold unit back into the JSONB so it
        // round-trips through ReviewerDecision.value.
        const valueToWrite = isOther
          ? actualValue
          : unit !== null && unit !== undefined
            ? { value: actualValue, unit }
            : actualValue;
        return ExtractionValueService.saveValue(
          runId,
          instanceId,
          fieldId,
          valueToWrite,
        );
      }),
    );
  }, [runId, values]);

  const refresh = useCallback(async () => {
    await loadValues(true);
  }, [loadValues]);

  return {
    values,
    updateValue,
    loading,
    initialized,
    error,
    save,
    refresh,
    runId,
  };
}
