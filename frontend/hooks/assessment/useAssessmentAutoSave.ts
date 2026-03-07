/**
 * Hook for auto-saving assessment responses
 *
 * Features:
 * - 3-second debounce after last change
 * - Uses useAssessmentResponses save function
 * - Last save tracking
 * - Error handling
 *
 * Based on useExtractionAutoSave.ts (DRY + KISS)
 *
 * @hook
 */

import {useEffect, useRef, useState} from 'react';
import {toast} from 'sonner';
import {t} from '@/lib/copy';
import type {AssessmentResponse} from '@/types/assessment';
import {countValidResponses} from '@/lib/assessment-utils';

// =================== INTERFACES ===================

interface UseAssessmentAutoSaveProps {
  responses: Record<string, AssessmentResponse>; // { itemId: response }
    save: () => Promise<void>; // save function from useAssessmentResponses
  enabled?: boolean;
}

export interface UseAssessmentAutoSaveReturn {
  isSaving: boolean;
  lastSaved: Date | null;
  error: string | null;
  saveNow: () => Promise<void>;
}

// =================== HOOK ===================

/**
 * Hook for auto-saving assessment responses
 *
 * Watches `responses` and saves automatically after 3 seconds of inactivity.
 * Uses the `save()` function provided by useAssessmentResponses.
 *
 * @param props - Auto-save options
 * @returns Saving state, last save time, error and manual save function
 *
 * @example
 * ```tsx
 * const { responses, save } = useAssessmentResponses({ ... });
 * const { isSaving, lastSaved, saveNow } = useAssessmentAutoSave({
 *   responses,
 *   save,
 *   enabled: true
 * });
 * ```
 */
export function useAssessmentAutoSave(
  props: UseAssessmentAutoSaveProps
): UseAssessmentAutoSaveReturn {
  const { responses, save, enabled = true } = props;

  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout>();
  const previousValuesRef = useRef<string>('');

    // Auto-save with 3-second debounce
  useEffect(() => {
    if (!enabled || !save) return;

      // Serialize values to string to compare changes
    const currentValuesStr = JSON.stringify(responses);

      // If unchanged, do nothing
    if (currentValuesStr === previousValuesRef.current) {
      return;
    }

    previousValuesRef.current = currentValuesStr;

      // Cancel previous scheduled save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

      // Schedule new save after 3 seconds
    saveTimeoutRef.current = setTimeout(() => {
      saveResponses();
    }, 3000);

    // Cleanup
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [responses, enabled, save]);

  /**
   * Save responses using the provided save function
   */
  const saveResponses = async () => {
    setIsSaving(true);
    setError(null);

    try {
        // Check if there are responses to save
      const responsesToSave = countValidResponses(responses);

      if (responsesToSave === 0) {
          console.warn('⚠️ [useAssessmentAutoSave] No responses to save (all empty)');
        setIsSaving(false);
        return;
      }

        console.warn(`💾 [useAssessmentAutoSave] Auto-saving ${responsesToSave} response(s)...`);

        // Call provided save function (from useAssessmentResponses)
      await save();

      setLastSaved(new Date());
        console.warn(`✅ [useAssessmentAutoSave] Auto-save done: ${responsesToSave} response(s) saved`);
    } catch (err) {
        const message = err instanceof Error ? err.message : t('common', 'errors_saveFailed');
        console.error('❌ [useAssessmentAutoSave] Auto-save error:', err);
      setError(message);
        toast.error(t('assessment', 'errors_autoSaveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * Save immediately (no debounce)
   */
  const saveNow = async () => {
      // Cancel scheduled save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

      // Save immediately
    await saveResponses();
  };

  return {
    isSaving,
    lastSaved,
    error,
    saveNow,
  };
}
