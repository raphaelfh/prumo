/**
 * Hook para carregar extrações de outros membros
 * 
 * Busca valores extraídos por outros usuários do mesmo projeto
 * para permitir comparação e detecção de consenso.
 * 
 * @hook
 */

import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

// =================== INTERFACES ===================

export interface OtherExtraction {
  userId: string;
  userName: string;
  userAvatar?: string;
  values: Record<string, any>; // key: `${instanceId}_${fieldId}`, value: extracted value
  timestamp: Date;
}

interface UseOtherExtractionsProps {
  articleId: string;
  projectId: string;
  currentUserId: string;
  enabled?: boolean;
}

interface UseOtherExtractionsReturn {
  otherExtractions: OtherExtraction[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

// =================== HOOK ===================

export function useOtherExtractions(
  props: UseOtherExtractionsProps
): UseOtherExtractionsReturn {
  const { articleId, projectId, currentUserId, enabled = true } = props;

  const [otherExtractions, setOtherExtractions] = useState<OtherExtraction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !articleId || !currentUserId) {
      setLoading(false);
      return;
    }

    loadOtherExtractions();
  }, [articleId, currentUserId, enabled]);

  const loadOtherExtractions = async () => {
    setLoading(true);
    setError(null);

    try {
      console.log('👥 Carregando extrações de outros membros...');

      // Buscar extracted_values de outros usuários
      const { data, error: queryError } = await supabase
        .from('extracted_values')
        .select(`
          *,
          reviewer:reviewer_id (
            id,
            full_name,
            avatar_url
          )
        `)
        .eq('article_id', articleId)
        .neq('reviewer_id', currentUserId);

      if (queryError) throw queryError;

      // Agrupar por usuário
      const groupedByUser: Record<string, OtherExtraction> = {};

      (data || []).forEach(value => {
        const userId = value.reviewer_id;
        
        if (!groupedByUser[userId]) {
          groupedByUser[userId] = {
            userId,
            userName: value.reviewer?.full_name || 'Usuário',
            userAvatar: value.reviewer?.avatar_url,
            values: {},
            timestamp: new Date(value.updated_at || value.created_at)
          };
        }

        // Adicionar valor
        const key = `${value.instance_id}_${value.field_id}`;
        const extractedValue = value.value?.value ?? value.value;
        groupedByUser[userId].values[key] = extractedValue;

        // Atualizar timestamp para o mais recente
        const valueTimestamp = new Date(value.updated_at || value.created_at);
        if (valueTimestamp > groupedByUser[userId].timestamp) {
          groupedByUser[userId].timestamp = valueTimestamp;
        }
      });

      const extractionsList = Object.values(groupedByUser);
      setOtherExtractions(extractionsList);
      
      console.log(`✅ Carregadas extrações de ${extractionsList.length} membros`);

    } catch (err: any) {
      console.error('❌ Erro ao carregar outras extrações:', err);
      setError(err.message || 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  };

  const refresh = async () => {
    await loadOtherExtractions();
  };

  return {
    otherExtractions,
    loading,
    error,
    refresh
  };
}

