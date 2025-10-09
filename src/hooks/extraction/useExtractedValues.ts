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
        .from('extracted_values')
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

      (data || []).forEach(item => {
        const key = `${item.instance_id}_${item.field_id}`;
        // Extrair valor do jsonb (pode estar em { value: X } ou diretamente)
        const extractedValue = item.value?.value ?? item.value;
        
        // Se tiver unit, armazenar como objeto { value, unit }
        // Senão, armazenar apenas o valor (backward compatible)
        valuesMap[key] = item.unit 
          ? { value: extractedValue, unit: item.unit }
          : extractedValue;
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
      const upserts = Object.entries(values).map(([key, value]) => {
        const [instanceId, fieldId] = key.split('_');

        return {
          project_id: projectId,
          article_id: articleId,
          instance_id: instanceId,
          field_id: fieldId,
          value: { value }, // Wrap em objeto conforme schema
          source: 'human' as const,
          reviewer_id: user.id,
          is_consensus: false
        };
      });

      if (upserts.length === 0) {
        console.log('⚠️ Nenhum valor para salvar');
        return;
      }

      // Batch upsert (atualiza se existe, insere se não)
      const { error: upsertError } = await supabase
        .from('extracted_values')
        .upsert(upserts, {
          onConflict: 'instance_id,field_id,reviewer_id'
        });

      if (upsertError) throw upsertError;

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
