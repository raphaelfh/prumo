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

import {supabase} from '@/integrations/supabase/client';
import {handleSupabaseError, queryBuilder} from '@/lib/supabase/baseRepository';
import type {
    AISuggestion,
    AISuggestionHistoryItem,
    AISuggestionRaw,
    LoadSuggestionsResult,
    SuggestionStatus,
} from '@/types/ai-extraction';
import {getSuggestionKey, normalizeAISuggestion,} from '@/types/ai-extraction';
import {APIError,} from '@/lib/ai-extraction/errors';

/**
 * Service para operações com sugestões de IA
 */
export class AISuggestionService {
  /**
   * Carrega sugestões para instâncias de um artigo
   * 
   * Busca sugestões pendentes, aceitas e rejeitadas, mantendo apenas a mais recente por campo.
   * Inclui rejeitadas para permitir reverter a decisão.
   * 
   * @param articleId - ID do artigo
   * @param instanceIds - IDs das instâncias de extração
   * @param statuses - Statuses para filtrar (padrão: ['pending', 'accepted', 'rejected'])
   * @returns Mapa de sugestões indexadas por `${instanceId}_${fieldId}`
   */
  static async loadSuggestions(
    articleId: string,
    instanceIds: string[],
    statuses: SuggestionStatus[] = ['pending', 'accepted', 'rejected']
  ): Promise<LoadSuggestionsResult> {
    if (instanceIds.length === 0) {
      return { suggestions: {}, count: 0 };
    }

    // Usar queryBuilder do baseRepository
    // Para filtros .in(), precisamos usar array nos filters
    const { data, error } = await queryBuilder<AISuggestionRaw>(
      'ai_suggestions',
      {
        select: '*',
        filters: {
          instance_id: instanceIds,
          status: statuses,
        },
        orderBy: { column: 'created_at', ascending: false },
      }
    );

    if (error) {
      handleSupabaseError(error, 'loadSuggestions');
    }

    // Mapear para formato { instanceId_fieldId: suggestion }
    // Manter apenas a mais recente por campo (primeira do array ordenado)
    const suggestionsMap: Record<string, AISuggestion> = {};

    console.log(`📊 [loadSuggestions] Processando ${(data || []).length} sugestão(ões) do banco para ${instanceIds.length} instância(s)`);

    (data || []).forEach((item: AISuggestionRaw) => {
      if (!item.instance_id) {
        console.warn('⚠️ [loadSuggestions] Sugestão sem instance_id ignorada:', {
          suggestionId: item.id,
          fieldId: item.field_id,
          status: item.status
        });
        return;
      }

      const key = getSuggestionKey(item.instance_id, item.field_id);
      // Só adiciona se ainda não existe (mantém a mais recente)
      if (!suggestionsMap[key]) {
        suggestionsMap[key] = normalizeAISuggestion(item);
        console.log(`✅ [loadSuggestions] Sugestão adicionada: ${key}`, {
          status: item.status,
          fieldId: item.field_id,
          instanceId: item.instance_id
        });
      } else {
        console.log(`⏭️ [loadSuggestions] Sugestão mais recente já existe para ${key}, ignorando esta`);
      }
    });

    const finalCount = Object.keys(suggestionsMap).length;
    console.log(`🎯 [loadSuggestions] Total de ${finalCount} sugestão(ões) únicas mapeadas`);

    return {
      suggestions: suggestionsMap,
      count: finalCount,
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
    // Usar queryBuilder do baseRepository
    const { data, error } = await queryBuilder<AISuggestionRaw>(
      'ai_suggestions',
      {
        select: '*',
        filters: {
          instance_id: instanceId,
          field_id: fieldId,
        },
        orderBy: { column: 'created_at', ascending: false },
        limit,
      }
    );

    if (error) {
      handleSupabaseError(error, 'getHistory');
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

    // 1. Verificar se já existe extracted_value para esse instance_id, field_id e reviewer_id
    const { data: existing, error: selectError } = await supabase
      .from('extracted_values')
      .select('id')
      .eq('instance_id', instanceId)
      .eq('field_id', fieldId)
      .eq('reviewer_id', reviewerId)
      .maybeSingle();

    if (selectError) {
      throw new APIError(`Failed to check existing extracted value: ${selectError.message}`, undefined, { selectError });
    }

    // Preparar dados do valor
    const valueData = {
      project_id: projectId,
      article_id: articleId,
      instance_id: instanceId,
      field_id: fieldId,
      value: { value },
      source: 'ai' as const,
      confidence_score: confidence,
      reviewer_id: reviewerId,
      is_consensus: false,
      ai_suggestion_id: suggestionId,
    };

    // 2. UPDATE se existir, INSERT se não existir
    if (existing) {
      const { error: updateError } = await supabase
        .from('extracted_values')
        .update(valueData)
        .eq('id', existing.id);

      if (updateError) {
        throw new APIError(`Failed to update extracted value: ${updateError.message}`, undefined, { updateError });
      }
    } else {
      const { error: insertError } = await supabase
        .from('extracted_values')
        .insert(valueData);

      if (insertError) {
        throw new APIError(`Failed to create extracted value: ${insertError.message}`, undefined, { insertError });
      }
    }

    // 3. Atualizar status da suggestion para 'accepted'
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
   * Se foi aceito antes, remove o extracted_value relacionado.
   * 
   * @param params - Parâmetros para rejeitar sugestão
   * @returns void
   */
  static async rejectSuggestion(params: {
    suggestionId: string;
    reviewerId: string;
    wasAccepted?: boolean;
    instanceId?: string;
    fieldId?: string;
    projectId?: string;
    articleId?: string;
  }): Promise<void> {
    const { suggestionId, reviewerId, wasAccepted, instanceId, fieldId, projectId, articleId } = params;

    // Se foi aceito antes, remover o extracted_value relacionado
    if (wasAccepted && instanceId && fieldId && projectId && articleId) {
      const { error: deleteError } = await supabase
        .from('extracted_values' as any)
        .delete()
        .eq('instance_id', instanceId)
        .eq('field_id', fieldId)
        .eq('reviewer_id', reviewerId)
        .eq('article_id', articleId)
        .eq('ai_suggestion_id', suggestionId);

      if (deleteError) {
        console.warn(`⚠️ Erro ao remover extracted_value ao rejeitar: ${deleteError.message}`);
        // Não lançar erro - continuar com rejeição mesmo se não conseguir remover
      }
    }

    // Atualizar status da sugestão para 'rejected'
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
   * IMPORTANTE: Filtra apenas instâncias com article_id não nulo (instâncias específicas do artigo).
   * 
   * @param articleId - ID do artigo
   * @returns Array de IDs de instâncias
   */
  static async getArticleInstanceIds(articleId: string): Promise<string[]> {
    const { data, error } = await supabase
      .from('extraction_instances')
      .select('id, label, entity_type_id, article_id')
      .eq('article_id', articleId)
      .not('article_id', 'is', null); // Garantir que article_id não é null

    if (error) {
      console.error('❌ Erro ao buscar instâncias para sugestões:', error);
      throw new APIError(`Failed to load instances: ${error.message}`, undefined, { error });
    }

    const instanceIds = (data || []).map((i) => i.id);
    
    // Log detalhado para debug
    console.log(`📋 [getArticleInstanceIds] Encontradas ${instanceIds.length} instância(s) para artigo ${articleId}:`, {
      instanceIds: instanceIds.slice(0, 10), // Primeiros 10 para não poluir log
      instances: (data || []).slice(0, 5).map(i => ({
        id: i.id,
        label: i.label,
        entity_type_id: i.entity_type_id
      }))
    });

    return instanceIds;
  }
}

