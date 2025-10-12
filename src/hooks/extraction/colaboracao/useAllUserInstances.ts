/**
 * Hook para buscar instances de TODOS os usuários para comparação
 * 
 * Busca apenas instances do artigo atual, com labels reais.
 * Usado para agrupar corretamente por label na comparação.
 */

import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { ExtractionInstance } from '@/types/extraction';

export interface InstanceWithCreator extends ExtractionInstance {
  created_by: string; // userId do criador
}

interface UseAllUserInstancesProps {
  articleId: string;
  enabled?: boolean;
}

interface UseAllUserInstancesReturn {
  instances: InstanceWithCreator[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useAllUserInstances(props: UseAllUserInstancesProps): UseAllUserInstancesReturn {
  const { articleId, enabled = true } = props;

  const [instances, setInstances] = useState<InstanceWithCreator[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !articleId) {
      setLoading(false);
      return;
    }

    loadInstances();
  }, [articleId, enabled]);

  const loadInstances = async () => {
    setLoading(true);
    setError(null);

    try {
      console.log('🔍 Buscando instances de todos os usuários para artigo:', articleId);

      const { data, error: queryError } = await supabase
        .from('extraction_instances')
        .select('*')
        .eq('article_id', articleId)
        .order('created_at', { ascending: true });

      if (queryError) throw queryError;

      setInstances((data || []) as InstanceWithCreator[]);
      console.log(`✅ Carregadas ${(data || []).length} instances de todos os usuários`);

    } catch (err: any) {
      console.error('❌ Erro ao carregar instances:', err);
      setError(err.message || 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  };

  const refresh = async () => {
    await loadInstances();
  };

  return {
    instances,
    loading,
    error,
    refresh
  };
}
