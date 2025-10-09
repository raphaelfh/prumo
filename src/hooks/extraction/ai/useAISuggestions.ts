/**
 * Hook para gerenciar sugestões de IA
 * 
 * Features:
 * - Carregar sugestões pendentes
 * - Aceitar sugestão (criar extracted_value)
 * - Rejeitar sugestão
 * - Batch accept por threshold
 * 
 * @hook
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// =================== INTERFACES ===================

export interface AISuggestion {
  id: string;
  value: any;
  confidence: number;
  reasoning: string;
  status: 'pending' | 'accepted' | 'rejected';
  timestamp: Date;
}

interface UseAISuggestionsProps {
  articleId: string;
  projectId: string;
  enabled?: boolean;
}

interface UseAISuggestionsReturn {
  suggestions: Record<string, AISuggestion>; // key: `${instanceId}_${fieldId}`
  loading: boolean;
  acceptSuggestion: (instanceId: string, fieldId: string) => Promise<void>;
  rejectSuggestion: (instanceId: string, fieldId: string) => Promise<void>;
  batchAccept: (threshold?: number) => Promise<void>;
  refresh: () => Promise<void>;
}

// =================== HOOK ===================

export function useAISuggestions(props: UseAISuggestionsProps): UseAISuggestionsReturn {
  const { articleId, projectId, enabled = true } = props;

  const [suggestions, setSuggestions] = useState<Record<string, AISuggestion>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !articleId) return;
    loadSuggestions();
  }, [articleId, enabled]);

  const loadSuggestions = async () => {
    setLoading(true);

    try {
      console.log('🤖 Carregando sugestões de IA...');

      // Buscar instâncias deste artigo primeiro
      const { data: articleInstances, error: instancesError } = await supabase
        .from('extraction_instances')
        .select('id')
        .eq('article_id', articleId);

      if (instancesError) throw instancesError;

      const instanceIds = (articleInstances || []).map(i => i.id);

      if (instanceIds.length === 0) {
        console.log('⚠️ Nenhuma instância encontrada');
        setSuggestions({});
        return;
      }

      // Buscar sugestões pendentes para estas instâncias
      const { data, error: queryError } = await supabase
        .from('ai_suggestions')
        .select('*')
        .in('instance_id', instanceIds)
        .eq('status', 'pending');

      if (queryError) throw queryError;

      // Mapear para formato { instanceId_fieldId: suggestion }
      const suggestionsMap: Record<string, AISuggestion> = {};

      (data || []).forEach(item => {
        const key = `${item.instance_id}_${item.field_id}`;
        suggestionsMap[key] = {
          id: item.id,
          value: item.suggested_value?.value ?? item.suggested_value,
          confidence: item.confidence_score || 0,
          reasoning: item.reasoning || '',
          status: item.status as 'pending' | 'accepted' | 'rejected',
          timestamp: new Date(item.created_at)
        };
      });

      setSuggestions(suggestionsMap);
      console.log(`✅ Carregadas ${Object.keys(suggestionsMap).length} sugestões de IA`);

    } catch (err: any) {
      console.error('❌ Erro ao carregar sugestões:', err);
    } finally {
      setLoading(false);
    }
  };

  const acceptSuggestion = useCallback(async (instanceId: string, fieldId: string) => {
    const key = `${instanceId}_${fieldId}`;
    const suggestion = suggestions[key];
    if (!suggestion) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      // 1. Criar extracted_value com source='ai'
      const { error: insertError } = await supabase
        .from('extracted_values')
        .upsert({
          project_id: projectId,
          article_id: articleId,
          instance_id: instanceId,
          field_id: fieldId,
          value: { value: suggestion.value },
          source: 'ai',
          confidence_score: suggestion.confidence,
          reviewer_id: user.id,
          is_consensus: false,
          ai_suggestion_id: suggestion.id
        }, {
          onConflict: 'instance_id,field_id,reviewer_id'
        });

      if (insertError) throw insertError;

      // 2. Atualizar status da suggestion para 'accepted'
      const { error: updateError } = await supabase
        .from('ai_suggestions')
        .update({
          status: 'accepted',
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', suggestion.id);

      if (updateError) throw updateError;

      // 3. Remover do estado local
      setSuggestions(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });

      toast.success('Sugestão aceita com sucesso');

    } catch (err: any) {
      console.error('❌ Erro ao aceitar sugestão:', err);
      toast.error('Erro ao aceitar sugestão');
    }
  }, [suggestions, projectId, articleId]);

  const rejectSuggestion = useCallback(async (instanceId: string, fieldId: string) => {
    const key = `${instanceId}_${fieldId}`;
    const suggestion = suggestions[key];
    if (!suggestion) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      // Atualizar status para 'rejected'
      const { error } = await supabase
        .from('ai_suggestions')
        .update({
          status: 'rejected',
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', suggestion.id);

      if (error) throw error;

      // Remover do estado local
      setSuggestions(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });

      toast.success('Sugestão rejeitada');

    } catch (err: any) {
      console.error('❌ Erro ao rejeitar sugestão:', err);
      toast.error('Erro ao rejeitar sugestão');
    }
  }, [suggestions]);

  const batchAccept = useCallback(async (threshold = 0.8) => {
    try {
      const filtered = Object.entries(suggestions).filter(([, suggestion]) => {
        return suggestion.confidence >= threshold;
      });

      if (filtered.length === 0) {
        toast.info(`Nenhuma sugestão com confiança ≥${threshold * 100}%`);
        return;
      }

      await Promise.all(
        filtered.map(([key]) => {
          const [instanceId, fieldId] = key.split('_');
          return acceptSuggestion(instanceId, fieldId);
        })
      );

      toast.success(`${filtered.length} sugestões aceitas em lote`);

    } catch (err: any) {
      console.error('❌ Erro no batch accept:', err);
      toast.error('Erro ao aceitar sugestões em lote');
    }
  }, [suggestions, acceptSuggestion]);

  return {
    suggestions,
    loading,
    acceptSuggestion,
    rejectSuggestion,
    batchAccept,
    refresh: loadSuggestions
  };
}

