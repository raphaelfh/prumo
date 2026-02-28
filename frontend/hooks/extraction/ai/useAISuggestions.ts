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

import {useCallback, useEffect, useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {toast} from 'sonner';
import type {
    AISuggestion,
    AISuggestionHistoryItem,
    LoadSuggestionsResult,
    UseAISuggestionsProps,
    UseAISuggestionsReturn,
} from '@/types/ai-extraction';
import {getSuggestionKey} from '@/types/ai-extraction';
import {AISuggestionService} from '@/services/aiSuggestionService';
import {filterSuggestionsByConfidence} from '@/lib/ai-extraction/suggestionUtils';
import {AuthenticationError, getErrorMessage,} from '@/lib/ai-extraction/errors';

// =================== HOOK ===================

// Re-exportar tipos para compatibilidade com código existente
export type { AISuggestion, AISuggestionHistoryItem } from '@/types/ai-extraction';

export function useAISuggestions(props: UseAISuggestionsProps): UseAISuggestionsReturn {
  const { articleId, projectId, enabled = true, onSuggestionAccepted, onSuggestionRejected } = props;

  const [suggestions, setSuggestions] = useState<Record<string, AISuggestion>>({});
  const [loading, setLoading] = useState(false);
  // Estado de loading por sugestão específica para feedback visual imediato
  const [actionLoading, setActionLoading] = useState<Record<string, 'accept' | 'reject' | null>>({});

  // Declarar loadSuggestions ANTES do useEffect para evitar erro de inicialização
  const loadSuggestions = useCallback(async (): Promise<LoadSuggestionsResult> => {
    setLoading(true);

    try {
      console.log('🤖 Carregando sugestões de IA...', { articleId });

      // Buscar instâncias deste artigo
      const instanceIds = await AISuggestionService.getArticleInstanceIds(articleId);

      if (instanceIds.length === 0) {
        console.log('⚠️ Nenhuma instância encontrada ao buscar sugestões');
        setSuggestions({});
        setLoading(false);
        return { suggestions: {}, count: 0 };
      }

      console.log(`📋 ${instanceIds.length} instância(s) encontrada(s) para buscar sugestões:`, {
        instanceIds: instanceIds.slice(0, 5), // Mostrar primeiros 5 IDs para debug
        totalCount: instanceIds.length
      });

      // Carregar sugestões usando o serviço
      const result = await AISuggestionService.loadSuggestions(articleId, instanceIds);

      // CRÍTICO: setSuggestions atualiza o estado de forma assíncrona
      // Usar função de atualização para garantir que estado anterior seja considerado
      setSuggestions(() => {
        const newSuggestions = result.suggestions;
        const count = Object.keys(newSuggestions).length;
        console.log(`✅ [useAISuggestions] ${count} sugestão(ões) carregada(s) e estado atualizado`);
        
        // Log detalhado das chaves das sugestões carregadas para debug
        const suggestionKeys = Object.keys(newSuggestions).slice(0, 10);
        console.log(`📝 [useAISuggestions] Primeiras sugestões carregadas:`, {
          keys: suggestionKeys,
          total: count
        });
        
        return newSuggestions;
      });

      // Retornar resultado diretamente para uso em polling
      return result;

    } catch (err: any) {
      console.error('❌ Erro ao carregar sugestões:', err);
      const message = getErrorMessage(err);
      toast.error(`Erro ao carregar sugestões de IA: ${message}`);
      setSuggestions({}); // Limpar sugestões em caso de erro
      return { suggestions: {}, count: 0 };
    } finally {
      setLoading(false);
    }
  }, [articleId]);

  // useEffect DEPOIS da declaração de loadSuggestions
  useEffect(() => {
    if (!enabled || !articleId) return;
    loadSuggestions();
  }, [articleId, enabled, loadSuggestions]);

  const acceptSuggestion = useCallback(async (instanceId: string, fieldId: string) => {
    const key = getSuggestionKey(instanceId, fieldId);
    const suggestion = suggestions[key];
    if (!suggestion) return;

    // Feedback visual imediato
    setActionLoading(prev => ({ ...prev, [key]: 'accept' }));

    try {
      // Obter user de forma mais eficiente (cachear se possível)
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new AuthenticationError();

      // Aceitar sugestão usando o serviço
      await AISuggestionService.acceptSuggestion({
        suggestionId: suggestion.id,
        projectId,
        articleId,
        instanceId,
        fieldId,
        value: suggestion.value,
        confidence: suggestion.confidence,
        reviewerId: user.id,
      });

      // Atualizar status no estado local para 'accepted' (não remover!)
      // IMPORTANTE: Criar novo objeto para garantir re-render
      setSuggestions(prev => {
        if (!prev[key]) {
          console.warn(`⚠️ Sugestão ${key} não encontrada no estado ao aceitar`);
          return prev;
        }
        const next = { ...prev };
        next[key] = {
          ...next[key],
          status: 'accepted' as const,
        };
        console.log(`✅ Sugestão ${key} aceita - estado atualizado para 'accepted'`);
        return { ...next }; // Nova referência para garantir re-render
      });

      // Callback para preencher input automaticamente (não bloquear)
      if (onSuggestionAccepted) {
        // Executar em background para não bloquear UI
        Promise.resolve(onSuggestionAccepted(instanceId, fieldId, suggestion.value)).catch(err => {
          console.error('Erro no callback onSuggestionAccepted:', err);
        });
      }

      toast.success('Sugestão aceita com sucesso');

    } catch (err: any) {
      console.error('❌ Erro ao aceitar sugestão:', err);
      const message = getErrorMessage(err);
      toast.error(`Erro ao aceitar sugestão: ${message}`);
    } finally {
      // Remover loading após operação
      setActionLoading(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }, [suggestions, projectId, articleId, onSuggestionAccepted]);

  const rejectSuggestion = useCallback(async (instanceId: string, fieldId: string) => {
    const key = getSuggestionKey(instanceId, fieldId);
    const suggestion = suggestions[key];
    if (!suggestion) return;

    // Feedback visual imediato
    setActionLoading(prev => ({ ...prev, [key]: 'reject' }));

    try {
      // Obter user de forma mais eficiente
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new AuthenticationError();

      // Verificar se foi aceito antes (precisa remover extracted_value)
      const wasAccepted = suggestion.status === 'accepted';

      // Rejeitar sugestão usando o serviço
      await AISuggestionService.rejectSuggestion({
        suggestionId: suggestion.id,
        reviewerId: user.id,
        wasAccepted, // Passa flag para remover extracted_value se necessário
        instanceId,
        fieldId,
        projectId,
        articleId,
      });

      // Atualizar status no estado local para 'rejected' (não remover!)
      // IMPORTANTE: Criar novo objeto para garantir re-render e mostrar indicador visual
      setSuggestions(prev => {
        if (!prev[key]) {
          console.warn(`⚠️ Sugestão ${key} não encontrada no estado ao rejeitar`);
          return prev;
        }
        const next = { ...prev };
        next[key] = {
          ...next[key],
          status: 'rejected' as const,
        };
        console.log(`✅ Sugestão ${key} rejeitada - estado atualizado para 'rejected'`);
        return { ...next }; // Nova referência para garantir re-render
      });

      // Callback para limpar campo quando rejeitar
      if (onSuggestionRejected) {
        Promise.resolve(onSuggestionRejected(instanceId, fieldId)).catch(err => {
          console.error('Erro no callback onSuggestionRejected:', err);
        });
      }

      toast.success('Sugestão rejeitada');

    } catch (err: any) {
      console.error('❌ Erro ao rejeitar sugestão:', err);
      const message = getErrorMessage(err);
      toast.error(`Erro ao rejeitar sugestão: ${message}`);
    } finally {
      // Remover loading após operação
      setActionLoading(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }, [suggestions, projectId, articleId, onSuggestionRejected]);

  const batchAccept = useCallback(async (threshold = 0.8) => {
    try {
      const filtered = filterSuggestionsByConfidence(suggestions, threshold);

      if (filtered.length === 0) {
        toast.info(`Nenhuma sugestão com confiança ≥${threshold * 100}%`);
        return;
      }

      await Promise.all(
        filtered.map(([key]) => {
          // key format: `${instanceId}_${fieldId}`
          const [instanceId, ...fieldIdParts] = key.split('_');
          const fieldId = fieldIdParts.join('_'); // Caso field_id tenha underscores
          return acceptSuggestion(instanceId, fieldId);
        })
      );

      toast.success(`${filtered.length} sugestões aceitas em lote`);

    } catch (err: any) {
      console.error('❌ Erro no batch accept:', err);
      const message = getErrorMessage(err);
      toast.error(`Erro ao aceitar sugestões em lote: ${message}`);
    }
  }, [suggestions, acceptSuggestion]);

  /**
   * Busca histórico completo de sugestões para um campo específico
   */
  const getSuggestionsHistory = useCallback(async (
    instanceId: string,
    fieldId: string
  ): Promise<AISuggestionHistoryItem[]> => {
    try {
      return await AISuggestionService.getHistory(instanceId, fieldId, 10);
    } catch (err: any) {
      console.error('❌ Erro ao buscar histórico de sugestões:', err);
      const message = getErrorMessage(err);
      toast.error(`Erro ao buscar histórico: ${message}`);
      return [];
    }
  }, []);

  /**
   * Retorna a sugestão mais recente para um campo (se existir no estado local)
   */
  const getLatestSuggestion = useCallback((
    instanceId: string,
    fieldId: string
  ): AISuggestion | undefined => {
    const key = getSuggestionKey(instanceId, fieldId);
    return suggestions[key];
  }, [suggestions]);

  // Função helper para verificar se uma sugestão está com loading
  const isActionLoading = useCallback((instanceId: string, fieldId: string): 'accept' | 'reject' | null => {
    const key = getSuggestionKey(instanceId, fieldId);
    return actionLoading[key] || null;
  }, [actionLoading]);

  return {
    suggestions,
    loading,
    acceptSuggestion,
    rejectSuggestion,
    batchAccept,
    getSuggestionsHistory,
    getLatestSuggestion,
    refresh: loadSuggestions,
    isActionLoading,
  };
}

