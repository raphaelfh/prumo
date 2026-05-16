/**
 * Hook to manage global templates available for import
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
import {t} from '@/lib/copy';
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
        console.warn('Fetching available global templates...');

        // Fetch global templates
      const { data: templatesData, error: templatesError } = await supabase
        .from('extraction_templates_global')
        .select('*')
        .eq('is_global', true)
        .order('framework', { ascending: true });

      if (templatesError) {
          console.error('Error fetching global templates:', templatesError);
        throw templatesError;
      }

      if (!templatesData || templatesData.length === 0) {
        console.warn('Nenhum template global encontrado');
        setTemplates([]);
        return;
      }

      // Fetch entity-type counts in a single query instead of
      // firing one Supabase request per template (#75 N+1). Counting
      // is done client-side over the returned `template_id` column —
      // PostgREST grouping isn't broadly portable, but the row set
      // is tiny (one row per template entity type) and a single
      // round-trip is far cheaper than N round-trips. Errors must
      // also be surfaced so a permission denial does not silently
      // render "0 sections" for every template.
      const templateIds = templatesData.map((t) => t.id);
      const { data: entityTypeRows, error: countError } = await supabase
        .from('extraction_entity_types')
        .select('template_id')
        .in('template_id', templateIds);
      if (countError) {
        throw countError;
      }
      const countByTemplateId = new Map<string, number>();
      for (const row of entityTypeRows ?? []) {
        const tid = (row as { template_id: string }).template_id;
        countByTemplateId.set(tid, (countByTemplateId.get(tid) ?? 0) + 1);
      }
      const templatesWithCounts = templatesData.map((template) => ({
        id: template.id,
        name: template.name,
        framework: template.framework as 'CHARMS' | 'PICOS' | 'CUSTOM',
        description: template.description,
        version: template.version,
        is_global: template.is_global,
        schema: template.schema,
        created_at: template.created_at,
        updated_at: template.updated_at,
        entityTypesCount: countByTemplateId.get(template.id) ?? 0,
      }));

        console.warn(`✅ ${templatesWithCounts.length} templates globais encontrados`);
      setTemplates(templatesWithCounts);

    } catch (err: any) {
      console.error('Erro ao carregar templates globais:', err);
        setError(err.message || t('common', 'errors_unknownError'));
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
