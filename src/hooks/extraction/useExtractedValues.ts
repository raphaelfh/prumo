/**
 * Hook para gerenciar valores extraídos
 * 
 * Responsabilidades:
 * - Carregar valores existentes do banco
 * - Gerenciar estado local de valores
 * - Fornecer função de update
 * - Fornecer função de save
 * 
 * @hook
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { extractValueForSave, extractValueFromDb } from '@/lib/validations/selectOther';
import { toast } from 'sonner';

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

  // Carregar valores existentes
  useEffect(() => {
    if (!enabled || !articleId) return;
    loadValues();
  }, [articleId, enabled]);

  const loadValues = async () => {
    setLoading(true);
    setError(null);

    try {
      console.log('📥 Carregando valores extraídos para artigo:', articleId);

      // Buscar valores existentes do usuário atual
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.log('⚠️ Usuário não autenticado');
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

      setValues(valuesMap);
      setInitialized(true); // ✅ Marca como inicializado
      console.log(`✅ Carregados ${Object.keys(valuesMap).length} valores extraídos`);

    } catch (err: any) {
      console.error('❌ Erro ao carregar valores:', err);
      setError(err.message || 'Erro ao carregar valores');
      toast.error('Erro ao carregar valores extraídos');
    } finally {
      setLoading(false);
    }
  };

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
      if (!user) throw new Error('Usuário não autenticado');

      // Preparar batch de upserts
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
        console.log('⚠️ Nenhum valor para salvar');
        return;
      }

      // Verificar quais valores já existem (batch SELECT)
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
          throw new Error(`Erro ao atualizar ${updateErrors.length} valores: ${updateErrors[0]?.message}`);
        }
      }

      // Executar INSERTs em lote (se houver)
      if (toInsert.length > 0) {
        const { error: insertError } = await supabase
          .from('extracted_values' as any)
          .insert(toInsert);
        if (insertError) throw insertError;
      }

      console.log(`✅ Salvos ${upserts.length} valores`);

    } catch (err: any) {
      console.error('❌ Erro ao salvar valores:', err);
      throw err;
    }
  };

  const refresh = useCallback(async () => {
    await loadValues();
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
