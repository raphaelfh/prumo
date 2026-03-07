/**
 * Auto-save hook for extracted values
 *
 * Features:
 * - 3-second debounce after last change
 * - Batch upsert for performance
 * - Last save tracking
 * - Error handling
 *
 * @hook
 */

import {useEffect, useRef, useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {toast} from 'sonner';
import {extractValueForSave} from '@/lib/validations/selectOther';
import {t} from '@/lib/copy';

// =================== INTERFACES ===================

interface UseExtractionAutoSaveProps {
  articleId: string;
  projectId: string;
  values: Record<string, any>; // { instanceId_fieldId: value }
  enabled?: boolean;
}

export interface UseExtractionAutoSaveReturn {
  isSaving: boolean;
  lastSaved: Date | null;
  error: string | null;
  saveNow: () => Promise<void>;
}

// =================== HOOK ===================

export function useExtractionAutoSave(
  props: UseExtractionAutoSaveProps
): UseExtractionAutoSaveReturn {
  const { articleId, projectId, values, enabled = true } = props;

  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout>();
  const previousValuesRef = useRef<string>('');

    // Auto-save with 3-second debounce
  useEffect(() => {
    if (!enabled || !articleId || !projectId) return;

      // Serialize values to string to detect changes
    const currentValuesStr = JSON.stringify(values);

      // Skip if unchanged
    if (currentValuesStr === previousValuesRef.current) {
      return;
    }

    previousValuesRef.current = currentValuesStr;

      // Cancel previously scheduled save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

      // Schedule new save after 3 seconds
    saveTimeoutRef.current = setTimeout(() => {
      saveValues();
    }, 3000);

    // Cleanup
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [values, enabled, articleId, projectId]);

  const saveValues = async () => {
    setIsSaving(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
          throw new Error(t('common', 'errors_userNotAuthenticated'));
      }

        // Keep only non-empty values
      const valuesToSave = Object.entries(values).filter(([, value]) => {
        return value !== null && value !== undefined && value !== '';
      });

      if (valuesToSave.length === 0) {
          console.warn('No values to save (all empty)');
        setIsSaving(false);
        return;
      }

        // Prepare batch upserts
      const upserts = valuesToSave.map(([key, valueData]) => {
        const [instanceId, fieldId] = key.split('_');

          // Use DRY helper to extract value
        const { value: actualValue, unit: unitValue, isOther } = extractValueForSave(valueData);

        return {
          project_id: projectId,
          article_id: articleId,
          instance_id: instanceId,
          field_id: fieldId,
            value: isOther ? actualValue : {value: actualValue}, // Preserve "other" object or wrap simple value
          unit: unitValue,
          source: 'human' as const,
          reviewer_id: user.id,
          is_consensus: false
        };
      });

        console.warn(`Auto-saving ${upserts.length} values...`);

        // Check which values already exist (batch SELECT)
      const { data: existingValues, error: selectError } = await supabase
        .from('extracted_values' as any)
        .select('id, instance_id, field_id, reviewer_id')
        .eq('article_id', articleId)
        .eq('reviewer_id', user.id)
        .in('instance_id', [...new Set(upserts.map(u => u.instance_id))]);

      if (selectError) throw selectError;

        // Build map of existing IDs: key => id
      const existingMap = new Map<string, string>();
      (existingValues || []).forEach((ev: any) => {
        const key = `${ev.instance_id}_${ev.field_id}_${ev.reviewer_id}`;
        existingMap.set(key, ev.id);
      });

        // Split into UPDATEs and INSERTs
      const toUpdate: Array<{ id: string; data: any }> = [];
      const toInsert: any[] = [];

      upserts.forEach(upsert => {
        const key = `${upsert.instance_id}_${upsert.field_id}_${upsert.reviewer_id}`;
        const existingId = existingMap.get(key);
        
        if (existingId) {
          toUpdate.push({ id: existingId, data: upsert });
        } else {
          toInsert.push(upsert);
        }
      });

        // Run UPDATEs in batch (if any)
      if (toUpdate.length > 0) {
        const updatePromises = toUpdate.map(({ id, data }) =>
          supabase
            .from('extracted_values' as any)
            .update(data)
            .eq('id', id)
        );
        const updateResults = await Promise.all(updatePromises);
        const updateErrors = updateResults.filter(r => r.error).map(r => r.error);
        if (updateErrors.length > 0) {
            throw new Error(
                t('extraction', 'errors_autoSaveUpdateValues')
                    .replace('{{n}}', String(updateErrors.length))
                    .replace('{{message}}', updateErrors[0]?.message ?? '')
            );
        }
      }

        // Run INSERTs in batch (if any)
      if (toInsert.length > 0) {
        const { error: insertError } = await supabase
          .from('extracted_values' as any)
          .insert(toInsert);
        if (insertError) throw insertError;
      }

      setLastSaved(new Date());
        console.warn(`Auto-save completed: ${upserts.length} values saved`);

    } catch (err: any) {
        console.error('Auto-save error:', err);
        setError(err.message || t('extraction', 'errors_autoSaveFailed'));
        toast.error(t('extraction', 'errors_autoSaveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const saveNow = async () => {
      // Cancel scheduled save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

      // Save immediately
    await saveValues();
  };

  return {
    isSaving,
    lastSaved,
    error,
    saveNow
  };
}

