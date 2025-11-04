/**
 * Service para Gerenciamento de Sugestões de IA
 * 
 * Centraliza todas as operações de banco de dados relacionadas a sugestões de IA.
 * Abstrai queries Supabase do hook, permitindo reutilização e testes unitários.
 * 
 * FOCUS: Section extraction pipeline (extração granular por seção)
 * 
 * @example
 * ```typescript
 * // Carregar sugestões para um artigo
 * const instanceIds = await AISuggestionService.getArticleInstanceIds(articleId);
 * const result = await AISuggestionService.loadSuggestions(articleId, instanceIds);
 * 
 * // Aceitar uma sugestão
 * await AISuggestionService.acceptSuggestion({
 *   suggestionId: '...',
 *   projectId: '...',
 *   articleId: '...',
 *   instanceId: '...',
 *   fieldId: '...',
 *   value: 'extracted value',
 *   confidence: 0.95,
 *   reviewerId: '...',
 * });
 * ```
 */

import { supabase } from '@/integrations/supabase/client';
import type {
  AISuggestion,
  AISuggestionRaw,
  AISuggestionHistoryItem,
  SuggestionStatus,
  LoadSuggestionsResult,
} from '@/types/ai-extraction';
import {
  getSuggestionKey,
  normalizeAISuggestion,
} from '@/types/ai-extraction';
import {
  AuthenticationError,
  APIError,
  SuggestionNotFoundError,
} from '@/lib/ai-extraction/errors';

/**
 * Service para operações com sugestões de IA
 */
export class AISuggestionService {
  /**
   * Carrega sugestões para instâncias de um artigo
   * 
   * Busca sugestões pendentes e aceitas, mantendo apenas a mais recente por campo.
   * 
   * @param articleId - ID do artigo
   * @param instanceIds - IDs das instâncias de extração
   * @param statuses - Statuses para filtrar (padrão: ['pending', 'accepted'])
   * @returns Mapa de sugestões indexadas por `${instanceId}_${fieldId}`
   */
  static async loadSuggestions(
    articleId: string,
    instanceIds: string[],
    statuses: SuggestionStatus[] = ['pending', 'accepted']
  ): Promise<LoadSuggestionsResult> {
    if (instanceIds.length === 0) {
      return { suggestions: {}, count: 0 };
    }

    const { data, error } = await supabase
      .from('ai_suggestions')
      .select('*')
      .in('instance_id', instanceIds)
      .in('status', statuses)
      .order('created_at', { ascending: false });

    if (error) {
      throw new APIError(`Failed to load suggestions: ${error.message}`, undefined, { error });
    }

    // Mapear para formato { instanceId_fieldId: suggestion }
    // Manter apenas a mais recente por campo (primeira do array ordenado)
    const suggestionsMap: Record<string, AISuggestion> = {};

    (data || []).forEach((item: AISuggestionRaw) => {
      if (!item.instance_id) return;

      const key = getSuggestionKey(item.instance_id, item.field_id);
      // Só adiciona se ainda não existe (mantém a mais recente)
      if (!suggestionsMap[key]) {
        suggestionsMap[key] = normalizeAISuggestion(item);
      }
    });

    return {
      suggestions: suggestionsMap,
      count: Object.keys(suggestionsMap).length,
    };
  }

  /**
   * Busca histórico completo de sugestões para um campo específico
   * 
   * @param instanceId - ID da instância
   * @param fieldId - ID do campo
   * @param limit - Limite de resultados (padrão: 10)
   * @returns Lista de sugestões ordenadas por data (mais recente primeiro)
   */
  static async getHistory(
    instanceId: string,
    fieldId: string,
    limit: number = 10
  ): Promise<AISuggestionHistoryItem[]> {
    const { data, error } = await supabase
      .from('ai_suggestions')
      .select('*')
      .eq('instance_id', instanceId)
      .eq('field_id', fieldId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new APIError(`Failed to load suggestion history: ${error.message}`, undefined, { error });
    }

    return (data || []).map((item: AISuggestionRaw) =>
      normalizeAISuggestion(item)
    );
  }

  /**
   * Aceita uma sugestão de IA
   * 
   * Cria extracted_value e atualiza status da sugestão para 'accepted'.
   * 
   * @param params - Parâmetros para aceitar sugestão
   * @returns void
   */
  static async acceptSuggestion(params: {
    suggestionId: string;
    projectId: string;
    articleId: string;
    instanceId: string;
    fieldId: string;
    value: any;
    confidence: number;
    reviewerId: string;
  }): Promise<void> {
    const {
      suggestionId,
      projectId,
      articleId,
      instanceId,
      fieldId,
      value,
      confidence,
      reviewerId,
    } = params;

    // 1. Criar extracted_value com source='ai'
    const { error: insertError } = await supabase
      .from('extracted_values')
      .upsert(
        {
          project_id: projectId,
          article_id: articleId,
          instance_id: instanceId,
          field_id: fieldId,
          value: { value },
          source: 'ai',
          confidence_score: confidence,
          reviewer_id: reviewerId,
          is_consensus: false,
          ai_suggestion_id: suggestionId,
        },
        {
          onConflict: 'instance_id,field_id,reviewer_id',
        }
      );

    if (insertError) {
      throw new APIError(`Failed to create extracted value: ${insertError.message}`, undefined, { insertError });
    }

    // 2. Atualizar status da suggestion para 'accepted'
    const { error: updateError } = await supabase
      .from('ai_suggestions')
      .update({
        status: 'accepted',
        reviewed_by: reviewerId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', suggestionId);

    if (updateError) {
      throw new APIError(`Failed to update suggestion status: ${updateError.message}`, undefined, { updateError });
    }
  }

  /**
   * Rejeita uma sugestão de IA
   * 
   * Atualiza status da sugestão para 'rejected'.
   * 
   * @param params - Parâmetros para rejeitar sugestão
   * @returns void
   */
  static async rejectSuggestion(params: {
    suggestionId: string;
    reviewerId: string;
  }): Promise<void> {
    const { suggestionId, reviewerId } = params;

    const { error } = await supabase
      .from('ai_suggestions')
      .update({
        status: 'rejected',
        reviewed_by: reviewerId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', suggestionId);

    if (error) {
      throw new APIError(`Failed to reject suggestion: ${error.message}`, undefined, { error });
    }
  }

  /**
   * Busca instâncias de extração para um artigo
   * 
   * Helper para obter lista de instance IDs antes de carregar sugestões.
   * 
   * @param articleId - ID do artigo
   * @returns Array de IDs de instâncias
   */
  static async getArticleInstanceIds(articleId: string): Promise<string[]> {
    const { data, error } = await supabase
      .from('extraction_instances')
      .select('id')
      .eq('article_id', articleId);

    if (error) {
      throw new APIError(`Failed to load instances: ${error.message}`, undefined, { error });
    }

    return (data || []).map((i) => i.id);
  }
}

