/**
 * Hook para carregar tipos de entidades (Entity Types)
 * 
 * Separa responsabilidade de carregar entity types do useExtractionInstances.
 * Segue SRP: uma responsabilidade por hook.
 * 
 * @component
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { ExtractionEntityType } from '@/types/extraction';

interface UseEntityTypesReturn {
  entityTypes: ExtractionEntityType[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

interface UseEntityTypesProps {
  templateId: string | undefined;
  enabled?: boolean;
}

/**
 * Hook para carregar entity types de um template
 */
export function useEntityTypes({
  templateId,
  enabled = true,
}: UseEntityTypesProps): UseEntityTypesReturn {
  const [entityTypes, setEntityTypes] = useState<ExtractionEntityType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Carregar entity types
  const loadEntityTypes = useCallback(async () => {
    if (!enabled || !templateId) {
      setEntityTypes([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { data, error: entityTypesError } = await supabase
        .from('extraction_entity_types')
        .select('*')
        .eq('project_template_id', templateId)
        .order('sort_order', { ascending: true });

      if (entityTypesError) throw entityTypesError;

      setEntityTypes(data || []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido ao carregar tipos de entidades';
      console.error('Erro ao carregar tipos de entidades:', err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [templateId, enabled]);

  // Carregar dados iniciais
  useEffect(() => {
    loadEntityTypes();
  }, [loadEntityTypes]);

  // Função de refresh
  const refresh = useCallback(async () => {
    await loadEntityTypes();
  }, [loadEntityTypes]);

  return {
    entityTypes,
    loading,
    error,
    refresh,
  };
}

