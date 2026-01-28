/**
 * Hook para gerenciar sugestões de IA para Assessment
 *
 * Features:
 * - Carregar sugestões pendentes/accepted/rejected
 * - Aceitar sugestão (criar/atualizar assessment response)
 * - Rejeitar sugestão (remover response se foi aceita)
 * - Batch accept por threshold
 * - Histórico de sugestões
 *
 * Baseado em useAISuggestions.ts (DRY + KISS)
 *
 * @hook
 */

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import type {
  AIAssessmentSuggestion,
  AIAssessmentSuggestionHistoryItem,
  AssessmentSuggestionStatus,
  AssessmentLevel,
  EvidencePassage,
} from '@/types/assessment';
import { getAssessmentSuggestionKey } from '@/lib/assessment-utils';
import {
  AIAssessmentSuggestionService,
  type LoadAssessmentSuggestionsResult,
} from '@/services/aiAssessmentSuggestionService';
import {
  getErrorMessage,
  AuthenticationError,
} from '@/lib/ai-extraction/errors';
import { useCurrentUser } from '@/hooks/useCurrentUser';

/**
 * Props do hook
 */
export interface UseAIAssessmentSuggestionsProps {
  projectId: string;
  articleId: string;
  instrumentId?: string;
  extractionInstanceId?: string;  // Para PROBAST por modelo
  enabled?: boolean;
  onSuggestionAccepted?: (itemId: string, value: { level: AssessmentLevel; evidence_passages: EvidencePassage[] }) => void | Promise<void>;
  onSuggestionRejected?: (itemId: string) => void | Promise<void>;
}

/**
 * Retorno do hook
 */
export interface UseAIAssessmentSuggestionsReturn {
  // Estado
  suggestions: Record<string, AIAssessmentSuggestion>;  // key: ai_suggestion_${itemId}
  loading: boolean;

  // Funções principais
  acceptSuggestion: (itemId: string) => Promise<void>;
  rejectSuggestion: (itemId: string) => Promise<void>;
  batchAccept: (threshold?: number) => Promise<number>;

  // Funções auxiliares
  getSuggestionsHistory: (itemId: string, limit?: number) => Promise<AIAssessmentSuggestionHistoryItem[]>;
  getLatestSuggestion: (itemId: string) => AIAssessmentSuggestion | undefined;
  refresh: () => Promise<LoadAssessmentSuggestionsResult>;

  // Estado de loading por ação (para UI feedback)
  isActionLoading: (itemId: string) => 'accept' | 'reject' | null;
}

/**
 * Hook para gerenciar sugestões de IA para assessment
 */
export function useAIAssessmentSuggestions(
  props: UseAIAssessmentSuggestionsProps
): UseAIAssessmentSuggestionsReturn {
  const {
    projectId,
    articleId,
    instrumentId,
    extractionInstanceId,
    enabled = true,
    onSuggestionAccepted,
    onSuggestionRejected,
  } = props;

  // Estados
  const [suggestions, setSuggestions] = useState<Record<string, AIAssessmentSuggestion>>({});
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<Record<string, 'accept' | 'reject' | null>>({});
  const { user, loading: authLoading } = useCurrentUser();

  /**
   * Carrega sugestões do backend
   */
  const loadSuggestions = useCallback(async (): Promise<LoadAssessmentSuggestionsResult> => {
    setLoading(true);

    try {
      console.log('🤖 [useAIAssessmentSuggestions] Carregando sugestões...', {
        articleId,
        projectId,
        instrumentId,
        extractionInstanceId,
      });

      // Carregar sugestões usando o serviço
      const result = await AIAssessmentSuggestionService.loadSuggestions({
        articleId,
        projectId,
        instrumentId,
        extractionInstanceId,
        statuses: ['pending', 'accepted', 'rejected'],
      });

      // Atualizar estado
      setSuggestions(() => {
        const newSuggestions = result.suggestions;
        const count = Object.keys(newSuggestions).length;

        console.log(`✅ [useAIAssessmentSuggestions] ${count} sugestão(ões) carregada(s)`);

        // Log das primeiras sugestões para debug
        const suggestionKeys = Object.keys(newSuggestions).slice(0, 5);
        console.log(`📝 [useAIAssessmentSuggestions] Primeiras sugestões:`, {
          keys: suggestionKeys,
          total: count,
        });

        return newSuggestions;
      });

      return result;
    } catch (err) {
      console.error('❌ [useAIAssessmentSuggestions] Erro ao carregar sugestões:', err);
      const message = getErrorMessage(err);
      toast.error(`Erro ao carregar sugestões: ${message}`);
      setSuggestions({});
      return { suggestions: {}, count: 0 };
    } finally {
      setLoading(false);
    }
  }, [articleId, projectId, instrumentId, extractionInstanceId]);

  /**
   * Effect para carregar sugestões quando deps mudarem
   */
  useEffect(() => {
    if (!enabled || !articleId || !projectId) return;
    loadSuggestions();
  }, [articleId, projectId, instrumentId, extractionInstanceId, enabled, loadSuggestions]);

  /**
   * Aceita uma sugestão
   */
  const acceptSuggestion = useCallback(async (itemId: string) => {
    const key = getAssessmentSuggestionKey(itemId);
    const suggestion = suggestions[key];

    if (!suggestion) {
      console.warn(`⚠️ [acceptSuggestion] Sugestão não encontrada: ${itemId}`);
      return;
    }

    // Feedback visual imediato
    setActionLoading(prev => ({ ...prev, [key]: 'accept' }));

    try {
      // Obter usuário autenticado
      if (authLoading || !user) throw new AuthenticationError();

      console.log('✅ [acceptSuggestion] Aceitando sugestão:', {
        itemId,
        suggestionId: suggestion.id,
        level: suggestion.suggested_value.level,
      });

      // Aceitar usando o serviço
      await AIAssessmentSuggestionService.acceptSuggestion({
        suggestionId: suggestion.id,
        projectId,
        articleId,
        itemId,
        value: suggestion.suggested_value,
        confidence: suggestion.confidence_score,
        reviewerId: user.id,
        instrumentId,
        extractionInstanceId,
      });

      // Atualizar status no estado local para 'accepted'
      setSuggestions(prev => {
        if (!prev[key]) {
          console.warn(`⚠️ [acceptSuggestion] Sugestão ${key} não encontrada no estado`);
          return prev;
        }

        const next = { ...prev };
        next[key] = {
          ...next[key],
          status: 'accepted' as const,
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
        };

        console.log(`✅ [acceptSuggestion] Estado atualizado para 'accepted': ${key}`);
        return { ...next }; // Nova referência para re-render
      });

      // Callback para atualizar response (não bloquear)
      if (onSuggestionAccepted) {
        Promise.resolve(
          onSuggestionAccepted(itemId, suggestion.suggested_value)
        ).catch(err => {
          console.error('⚠️ [acceptSuggestion] Erro no callback onSuggestionAccepted:', err);
        });
      }

      toast.success('Sugestão aceita com sucesso');
    } catch (err) {
      console.error('❌ [acceptSuggestion] Erro:', err);
      const message = getErrorMessage(err);
      toast.error(`Erro ao aceitar sugestão: ${message}`);
      throw err;
    } finally {
      setActionLoading(prev => ({ ...prev, [key]: null }));
    }
  }, [suggestions, projectId, articleId, instrumentId, extractionInstanceId, onSuggestionAccepted, user, authLoading]);

  /**
   * Rejeita uma sugestão
   */
  const rejectSuggestion = useCallback(async (itemId: string) => {
    const key = getAssessmentSuggestionKey(itemId);
    const suggestion = suggestions[key];

    if (!suggestion) {
      console.warn(`⚠️ [rejectSuggestion] Sugestão não encontrada: ${itemId}`);
      return;
    }

    // Feedback visual imediato
    setActionLoading(prev => ({ ...prev, [key]: 'reject' }));

    try {
      if (authLoading || !user) throw new AuthenticationError();

      const wasAccepted = suggestion.status === 'accepted';

      console.log('❌ [rejectSuggestion] Rejeitando sugestão:', {
        itemId,
        suggestionId: suggestion.id,
        wasAccepted,
      });

      // Rejeitar usando o serviço
      await AIAssessmentSuggestionService.rejectSuggestion({
        suggestionId: suggestion.id,
        reviewerId: user.id,
        wasAccepted,
        itemId,
        projectId,
        articleId,
        instrumentId,
        extractionInstanceId,
      });

      // Atualizar status no estado local para 'rejected'
      setSuggestions(prev => {
        if (!prev[key]) {
          console.warn(`⚠️ [rejectSuggestion] Sugestão ${key} não encontrada no estado`);
          return prev;
        }

        const next = { ...prev };
        next[key] = {
          ...next[key],
          status: 'rejected' as const,
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
        };

        console.log(`✅ [rejectSuggestion] Estado atualizado para 'rejected': ${key}`);
        return { ...next };
      });

      // Callback para limpar response (não bloquear)
      if (onSuggestionRejected) {
        Promise.resolve(onSuggestionRejected(itemId)).catch(err => {
          console.error('⚠️ [rejectSuggestion] Erro no callback onSuggestionRejected:', err);
        });
      }

      toast.success('Sugestão rejeitada');
    } catch (err) {
      console.error('❌ [rejectSuggestion] Erro:', err);
      const message = getErrorMessage(err);
      toast.error(`Erro ao rejeitar sugestão: ${message}`);
      throw err;
    } finally {
      setActionLoading(prev => ({ ...prev, [key]: null }));
    }
  }, [suggestions, projectId, articleId, instrumentId, extractionInstanceId, onSuggestionRejected, user, authLoading]);

  /**
   * Aceita múltiplas sugestões em batch (acima de threshold)
   */
  const batchAccept = useCallback(async (threshold: number = 0.8): Promise<number> => {
    try {
      if (authLoading || !user) throw new AuthenticationError();

      console.log('📦 [batchAccept] Iniciando batch accept:', { threshold });

      const accepted = await AIAssessmentSuggestionService.batchAcceptSuggestions({
        suggestions,
        threshold,
        reviewerId: user.id,
        projectId,
        articleId,
        instrumentId,
        extractionInstanceId,
      });

      if (accepted > 0) {
        // Refresh para atualizar estado
        await loadSuggestions();
        toast.success(`${accepted} sugestão(ões) aceita(s) automaticamente`);
      } else {
        toast.info('Nenhuma sugestão atingiu o threshold de confiança');
      }

      return accepted;
    } catch (err) {
      console.error('❌ [batchAccept] Erro:', err);
      const message = getErrorMessage(err);
      toast.error(`Erro no batch accept: ${message}`);
      return 0;
    }
  }, [suggestions, projectId, articleId, instrumentId, extractionInstanceId, loadSuggestions, user, authLoading]);

  /**
   * Busca histórico de sugestões para um item
   */
  const getSuggestionsHistory = useCallback(async (
    itemId: string,
    limit: number = 10
  ): Promise<AIAssessmentSuggestionHistoryItem[]> => {
    try {
      return await AIAssessmentSuggestionService.getHistory(itemId, limit);
    } catch (err) {
      console.error('❌ [getSuggestionsHistory] Erro:', err);
      return [];
    }
  }, []);

  /**
   * Busca sugestão mais recente para um item
   */
  const getLatestSuggestion = useCallback((itemId: string): AIAssessmentSuggestion | undefined => {
    const key = getAssessmentSuggestionKey(itemId);
    return suggestions[key];
  }, [suggestions]);

  /**
   * Refresh (recarrega sugestões)
   */
  const refresh = useCallback(async (): Promise<LoadAssessmentSuggestionsResult> => {
    return await loadSuggestions();
  }, [loadSuggestions]);

  /**
   * Verifica se uma ação está em loading
   */
  const isActionLoading = useCallback((itemId: string): 'accept' | 'reject' | null => {
    const key = getAssessmentSuggestionKey(itemId);
    return actionLoading[key] ?? null;
  }, [actionLoading]);

  return {
    suggestions,
    loading,
    acceptSuggestion,
    rejectSuggestion,
    batchAccept,
    getSuggestionsHistory,
    getLatestSuggestion,
    refresh,
    isActionLoading,
  };
}
