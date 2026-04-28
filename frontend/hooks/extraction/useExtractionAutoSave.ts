/**
 * Auto-save hook — debounces user edits and persists them as
 * `ReviewerDecision(decision='edit')` rows on the active extraction run.
 *
 * Drop-in replacement for the legacy `extracted_values` upserts: same
 * 3-second debounce + last-saved tracking, but writes go through
 * `POST /v1/runs/{runId}/decisions`. Run resolution is internal —
 * find the latest non-finalized run for `(article × project_template)`
 * and use it; if none, the autosave is a no-op until extraction kicks
 * one off.
 */

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { supabase } from '@/integrations/supabase/client';
import { extractValueForSave } from '@/lib/validations/selectOther';
import { t } from '@/lib/copy';
import { ExtractionValueService } from '@/services/extractionValueService';

interface UseExtractionAutoSaveProps {
  articleId: string;
  projectId: string;
  templateId?: string;
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
  const { articleId, projectId: _projectId, templateId, values, enabled = true } = props;

  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>();
  const previousValuesRef = useRef<string>('');

  // 3-second debounce — same UX as the legacy autosave.
  useEffect(() => {
    if (!enabled || !articleId) return;

    const currentValuesStr = JSON.stringify(values);
    if (currentValuesStr === previousValuesRef.current) return;
    previousValuesRef.current = currentValuesStr;

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      void saveValues();
    }, 3000);

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [values, enabled, articleId, templateId]);

  const saveValues = async () => {
    setIsSaving(true);
    setError(null);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        throw new Error(t('common', 'errors_userNotAuthenticated'));
      }

      const valuesToSave = Object.entries(values).filter(
        ([, value]) => value !== null && value !== undefined && value !== '',
      );
      if (valuesToSave.length === 0) {
        setIsSaving(false);
        return;
      }

      // Without a templateId we cannot safely scope the active-run lookup,
      // and a stray Quality-Assessment run on the same article would leak
      // through. Bail until the project's active extraction template is
      // resolved by the parent page.
      if (!templateId) {
        setIsSaving(false);
        return;
      }

      const run = await ExtractionValueService.findActiveRun(
        articleId,
        templateId,
      );
      if (!run) {
        // No active run yet — autosave silently no-ops. The form will
        // pick this up once extraction has been triggered.
        setIsSaving(false);
        return;
      }

      await Promise.all(
        valuesToSave.map(([key, valueData]) => {
          const [instanceId, fieldId] = key.split('_');
          const { value: actualValue, unit, isOther } = extractValueForSave(valueData);
          const writeValue = isOther
            ? actualValue
            : unit !== null && unit !== undefined
              ? { value: actualValue, unit }
              : actualValue;
          return ExtractionValueService.saveValue(
            run.id,
            instanceId,
            fieldId,
            writeValue,
          );
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
    await saveValues();
  };

  return { isSaving, lastSaved, error, saveNow };
}
