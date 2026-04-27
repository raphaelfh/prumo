/**
 * Hook to manage extracted values
 * 
 * Responsabilidades:
 * - Load existing values from DB
 * - Gerenciar estado local de valores
 * - Fornecer função de update
 * - Fornecer função de save
 * 
 * @hook
 */

import {useCallback, useEffect, useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {extractValueForSave, extractValueFromDb} from '@/lib/validations/selectOther';
import {dispatchValueUpdates, shallowValueEqual} from '@/lib/extraction/valueUpdates';
import {toast} from 'sonner';
import {t} from '@/lib/copy';

// =================== INTERFACES ===================

export interface ExtractedValueData {
  id?: string;
  instanceId: string;
  fieldId: string;
  value: any;
  source?: 'human' | 'ai' | 'rule';
  confidence?: number;
  aiSuggestionId?: string;
}

interface UseExtractedValuesProps {
  articleId: string;
  projectId: string;
  enabled?: boolean;
}

interface UseExtractedValuesReturn {
  values: Record<string, any>; // key: `${instanceId}_${fieldId}`
  updateValue: (instanceId: string, fieldId: string, value: any) => void;
  loading: boolean;
  initialized: boolean; // Flag para indicar se valores foram carregados
  error: string | null;
  save: () => Promise<void>;
  refresh: () => Promise<void>;
}

// =================== HOOK ===================

export function useExtractedValues(props: UseExtractedValuesProps): UseExtractedValuesReturn {
  const { articleId, projectId, enabled = true } = props;

  const [values, setValues] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);

    // Load existing values
  useEffect(() => {
    if (!enabled || !articleId) return;
    loadValues();
  }, [articleId, enabled]);

  const loadValues = async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);

    try {
        // Fetch existing values for current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setValues({});
        return;
      }

      const { data, error: queryError } = await supabase
        .from('extracted_values' as any)
        .select(`
          id,
          instance_id,
          field_id,
          value,
          unit,
          source,
          confidence_score,
          ai_suggestion_id,
          created_at,
          updated_at
        `)
        .eq('article_id', articleId)
        .eq('reviewer_id', user.id);

      if (queryError) throw queryError;

      // Converter para formato { instanceId_fieldId: { value, unit } }
      const valuesMap: Record<string, any> = {};

      (data || []).forEach((item: any) => {
        const key = `${item.instance_id}_${item.field_id}`;
        
        // Usar helper DRY para extrair valor do banco
        valuesMap[key] = extractValueFromDb(item);
      });

      setValues(prev => mergeValuesById(prev, valuesMap));
      setInitialized(true);
    } catch (err: any) {
      console.error('Erro ao carregar valores extraídos:', err);
      setError(err.message || t('extraction', 'errors_loadExtractedValues'));
      toast.error(t('extraction', 'errors_loadExtractedValues'));
    } finally {
      if (!silent) setLoading(false);
    }
  };

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
    next: Record<string, any>
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
      // Defer to next paint so the new render commits before the highlight
      // class lands. `dispatchValueUpdates` is a no-op when there are no
      // listeners.
      requestAnimationFrame(() => dispatchValueUpdates(updatedKeys));
    }
    return changed ? out : prev;
  }

  const updateValue = useCallback((instanceId: string, fieldId: string, value: any) => {
    const key = `${instanceId}_${fieldId}`;
    setValues(prev => ({
      ...prev,
      [key]: value
    }));
  }, []);

  const save = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error(t('common', 'errors_userNotAuthenticated'));

        // Prepare batch of upserts
      const upserts = Object.entries(values).map(([key, valueData]) => {
        const [instanceId, fieldId] = key.split('_');

        // Usar helper DRY para extrair valor
        const { value: actualValue, unit: unitValue, isOther } = extractValueForSave(valueData);

        return {
          project_id: projectId,
          article_id: articleId,
          instance_id: instanceId,
          field_id: fieldId,
          value: isOther ? actualValue : { value: actualValue }, // Preservar objeto "outro" ou wrap simples
          unit: unitValue,
          source: 'human' as const,
          reviewer_id: user.id,
          is_consensus: false
        };
      });

      if (upserts.length === 0) {
          console.warn('⚠️ Nenhum valor para salvar');
        return;
      }

        // Check which values already exist (batch SELECT)
      const { data: existingValues, error: selectError } = await supabase
        .from('extracted_values' as any)
        .select('id, instance_id, field_id, reviewer_id')
        .eq('article_id', articleId)
        .eq('reviewer_id', user.id)
        .in('instance_id', [...new Set(upserts.map(u => u.instance_id))]);

      if (selectError) throw selectError;

      // Criar mapa de IDs existentes: key => id
      const existingMap = new Map<string, string>();
      (existingValues || []).forEach((ev: any) => {
        const key = `${ev.instance_id}_${ev.field_id}_${ev.reviewer_id}`;
        existingMap.set(key, ev.id);
      });

      // Separar em UPDATEs e INSERTs
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

      // Executar UPDATEs em lote (se houver)
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

      // Executar INSERTs em lote (se houver)
      if (toInsert.length > 0) {
        const { error: insertError } = await supabase
          .from('extracted_values' as any)
          .insert(toInsert);
        if (insertError) throw insertError;
      }

    } catch (err: any) {
      console.error('Erro ao salvar valores extraídos:', err);
      throw err;
    }
  };

  const refresh = useCallback(async () => {
    // Silent refresh — keeps the form mounted while we re-fetch in the
    // background, so the user does not see a loading flash + scroll reset.
    await loadValues(true);
  }, [articleId]);

  return {
    values,
    updateValue,
    loading,
    initialized,
    error,
    save,
    refresh
  };
}
