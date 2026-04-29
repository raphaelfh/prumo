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

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { supabase } from '@/integrations/supabase/client';
import { extractValueFromDb } from '@/lib/validations/selectOther';
import { dispatchValueUpdates, shallowValueEqual } from '@/lib/extraction/valueUpdates';
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

function unwrapProposalValue(raw: unknown): unknown {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object' && raw !== null && 'value' in raw) {
    return (raw as { value: unknown }).value ?? null;
  }
  return raw;
}

export function useExtractedValues(
  props: UseExtractedValuesProps,
): UseExtractedValuesReturn {
  const { runId, stage, proposals, enabled = true } = props;

  const [values, setValues] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadValues = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);

      try {
        if (!runId || !stage) {
          setValues({});
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
          setValues((prev) => mergeValuesById(prev, valuesMap));
          setInitialized(true);
          return;
        }

        if (REVIEWER_STATE_STAGES.has(stage)) {
          const {
            data: { user },
          } = await supabase.auth.getUser();
          if (!user) {
            setValues({});
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
          setValues((prev) => mergeValuesById(prev, valuesMap));
          setInitialized(true);
          return;
        }

        // PENDING / CANCELLED / unknown — no values to show.
        setValues({});
        setInitialized(true);
      } catch (err: any) {
        console.error('Erro ao carregar valores extraídos:', err);
        setError(err.message || t('extraction', 'errors_loadExtractedValues'));
        toast.error(t('extraction', 'errors_loadExtractedValues'));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [runId, stage, proposals],
  );

  useEffect(() => {
    if (!enabled) return;
    void loadValues();
  }, [enabled, loadValues]);

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
