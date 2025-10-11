/**
 * Hook para gerenciar configuração de assessment do projeto
 * 
 * Suporta dois modos:
 * - article: Um assessment por artigo (padrão/legado)
 * - extraction_instance: Um assessment por instância (ex: por modelo)
 * 
 * Inclui validações para evitar mudanças quando já existem assessments.
 */

import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { 
  ProjectAssessmentConfig, 
  AssessmentConfigValidation,
  AssessmentScope 
} from '@/types/assessment-config';
import { ExtractionEntityType } from '@/types/extraction';

interface UseProjectAssessmentConfigReturn {
  config: ProjectAssessmentConfig | null;
  loading: boolean;
  error: string | null;
  isPerInstance: boolean;
  validateScopeChange: (newScope: AssessmentScope) => Promise<AssessmentConfigValidation>;
  updateConfig: (newScope: AssessmentScope, entityTypeId?: string | null) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useProjectAssessmentConfig(projectId: string): UseProjectAssessmentConfigReturn {
  const [config, setConfig] = useState<ProjectAssessmentConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (projectId) {
      loadConfig();
    }
  }, [projectId]);

  const loadConfig = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const { data: project, error: projectError } = await supabase
        .from('projects')
        .select('assessment_scope, assessment_entity_type_id')
        .eq('id', projectId)
        .single();

      if (projectError) throw projectError;

      let entityType: ExtractionEntityType | undefined;
      
      if (project.assessment_entity_type_id) {
        const { data: et, error: etError } = await supabase
          .from('extraction_entity_types')
          .select('*')
          .eq('id', project.assessment_entity_type_id)
          .single();
          
        if (etError) throw etError;
        entityType = et as ExtractionEntityType;
      }

      setConfig({
        scope: (project.assessment_scope as AssessmentScope) || 'article',
        entityTypeId: project.assessment_entity_type_id,
        entityType
      });
    } catch (err: any) {
      console.error('Error loading assessment config:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const validateScopeChange = async (
    newScope: AssessmentScope
  ): Promise<AssessmentConfigValidation> => {
    try {
      // Verificar se há assessments existentes
      const { count, error } = await supabase
        .from('assessments')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', projectId);

      if (error) throw error;

      const assessmentCount = count || 0;

      // Se já existem assessments e o scope é diferente, bloquear mudança
      if (assessmentCount > 0 && config?.scope !== newScope) {
        return {
          canChangeScope: false,
          reason: `Não é possível mudar o escopo de assessment enquanto existem ${assessmentCount} assessment(s) no projeto. Delete os assessments existentes primeiro.`,
          existingAssessmentsCount: assessmentCount
        };
      }

      return { 
        canChangeScope: true,
        existingAssessmentsCount: assessmentCount
      };
    } catch (err: any) {
      console.error('Error validating scope change:', err);
      throw new Error(`Erro ao validar mudança de escopo: ${err.message}`);
    }
  };

  const updateConfig = async (
    newScope: AssessmentScope,
    entityTypeId?: string | null
  ) => {
    try {
      // Validar antes de atualizar
      const validation = await validateScopeChange(newScope);
      
      if (!validation.canChangeScope) {
        throw new Error(validation.reason);
      }

      // Validar que entityTypeId é fornecido se scope = extraction_instance
      if (newScope === 'extraction_instance' && !entityTypeId) {
        throw new Error('Entity type é obrigatório quando scope é extraction_instance');
      }

      const { error } = await supabase
        .from('projects')
        .update({
          assessment_scope: newScope,
          assessment_entity_type_id: newScope === 'extraction_instance' ? entityTypeId : null
        })
        .eq('id', projectId);

      if (error) throw error;
      
      // Recarregar config
      await loadConfig();
    } catch (err: any) {
      console.error('Error updating assessment config:', err);
      throw err;
    }
  };

  return {
    config,
    loading,
    error,
    isPerInstance: config?.scope === 'extraction_instance',
    validateScopeChange,
    updateConfig,
    refresh: loadConfig
  };
}


