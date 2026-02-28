/**
 * Hook para gerenciar templates globais disponíveis para importação
 * 
 * Features:
 * - Lista templates globais (CHARMS, PICOS, etc.)
 * - Cache de dados
 * - Loading states
 * - Error handling
 * 
 * @module useGlobalTemplates
 */

import {useEffect, useRef, useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {GlobalExtractionTemplate} from '@/types/extraction';

// =================== INTERFACES ===================

export interface GlobalTemplate extends GlobalExtractionTemplate {
  entityTypesCount: number;
}

interface UseGlobalTemplatesReturn {
  templates: GlobalTemplate[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

// =================== HOOK ===================

export function useGlobalTemplates(): UseGlobalTemplatesReturn {
  const [templates, setTemplates] = useState<GlobalTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  const loadTemplates = async () => {
    if (!isMountedRef.current) return;
    setLoading(true);
    setError(null);

    try {
      console.log('📚 Buscando templates globais disponíveis...');

      // Buscar templates globais
      const { data: templatesData, error: templatesError } = await supabase
        .from('extraction_templates_global')
        .select('*')
        .eq('is_global', true)
        .order('framework', { ascending: true });

      if (templatesError) {
        console.error('Erro ao buscar templates globais:', templatesError);
        throw templatesError;
      }

      if (!templatesData || templatesData.length === 0) {
        console.warn('Nenhum template global encontrado');
        setTemplates([]);
        return;
      }

      // Para cada template, contar entity types
      const templatesWithCounts = await Promise.all(
        templatesData.map(async (template) => {
          const { count } = await supabase
            .from('extraction_entity_types')
            .select('id', { count: 'exact', head: true })
            .eq('template_id', template.id);

          return {
            id: template.id,
            name: template.name,
            framework: template.framework as 'CHARMS' | 'PICOS' | 'CUSTOM',
            description: template.description,
            version: template.version,
            is_global: template.is_global,
            schema: template.schema,
            created_at: template.created_at,
            updated_at: template.updated_at,
            entityTypesCount: count || 0
          };
        })
      );

      console.log(`✅ ${templatesWithCounts.length} templates globais encontrados`);
      setTemplates(templatesWithCounts);

    } catch (err: any) {
      console.error('Erro ao carregar templates globais:', err);
      setError(err.message || 'Erro desconhecido');
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    loadTemplates();

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return {
    templates,
    loading,
    error,
    refresh: loadTemplates
  };
}
