/**
 * Hook for extraction data initialization
 *
 * Responsible ONLY for initializing extraction (creating auto instances).
 * Progress calculation moved to useExtractionProgressCalc (SRP).
 *
 * Refactored (Phase 5): Separated from progress calculation (SRP).
 */

import {useCallback, useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {useAuth} from '@/contexts/AuthContext';
import {toast} from 'sonner';
import {t} from '@/lib/copy';

export interface ExtractionProgress {
  totalRequiredFields: number;
  completedRequiredFields: number;
  totalOptionalFields: number;
  completedOptionalFields: number;
  progressPercentage: number;
}

export interface ExtractionSetupResult {
  success: boolean;
  instancesCreated: number;
  error?: string;
}

export function useExtractionSetup() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Initializes extraction for a specific article
   * Copies configured template instances to the article
   */
  const initializeArticleExtraction = useCallback(async (
    articleId: string,
    projectId: string,
    templateId: string
  ): Promise<ExtractionSetupResult> => {
    if (!user) {
        const error = t('common', 'errors_userNotAuthenticated');
      toast.error(error);
      return { success: false, instancesCreated: 0, error };
    }

    setLoading(true);
    setError(null);

    try {
        console.warn('Starting extraction for article:', {articleId, projectId, templateId});

        // 1. Check if instances already exist for this article
      const { data: existingInstances, error: checkError } = await supabase
        .from('extraction_instances')
        .select('id')
        .eq('article_id', articleId)
        .eq('template_id', templateId)
        .limit(1);

      if (checkError) {
          console.error('Error checking existing instances:', checkError);
        throw checkError;
      }

      if (existingInstances && existingInstances.length > 0) {
          const message = t('extraction', 'extractionAlreadyStarted');
        toast.info(message);
        return { success: true, instancesCreated: 0, error: message };
      }

        // 2. Fetch project template entity types to create instances
      const { data: entityTypes, error: entityTypesError } = await supabase
        .from('extraction_entity_types')
        .select('*')
        .eq('project_template_id', templateId)
        .order('sort_order', { ascending: true });

      if (entityTypesError) {
        console.error('Erro ao buscar entity types:', entityTypesError);
        throw entityTypesError;
      }

      if (!entityTypes || entityTypes.length === 0) {
          const error = t('extraction', 'noTemplateConfigFound');
        toast.error(error);
        return { success: false, instancesCreated: 0, error };
      }

        console.warn(`Creating ${entityTypes.length} instances for the article`);

        // 3. Create instances based on entity types
        const instances = entityTypes.map((entityType, _index) => ({
        project_id: projectId,
        article_id: articleId,
        template_id: templateId,
        entity_type_id: entityType.id,
        label: entityType.label,
        sort_order: entityType.sort_order,
        status: 'pending',
        metadata: {},
        created_by: user.id
      }));

        // 4. Insert all instances at once
      const { data: createdInstances, error: insertError } = await supabase
        .from('extraction_instances')
        .insert(instances)
        .select();

      if (insertError) {
          console.error('Error creating instances:', insertError);
        throw insertError;
      }

      const instancesCreated = createdInstances?.length || 0;
        console.warn(`${instancesCreated} instances created successfully`);

        toast.success(t('extraction', 'extractionStartedToast').replace('{{n}}', String(instancesCreated)));

      return {
        success: true,
        instancesCreated,
      };

    } catch (err: any) {
        const errorMessage = err.message || t('extraction', 'errorInitializingExtraction');
        console.error('Error initializing extraction:', err);
      setError(errorMessage);
        toast.error(`${t('common', 'error')}: ${errorMessage}`);
      
      return {
        success: false,
        instancesCreated: 0,
        error: errorMessage,
      };
    } finally {
      setLoading(false);
    }
  }, [user]);

    // NOTE: Progress calculation moved to useExtractionProgressCalc
    // To follow SRP (Single Responsibility Principle)

  /**
   * Checks if extraction was initialized for an article
   */
  const isExtractionInitialized = useCallback(async (
    articleId: string,
    templateId: string
  ): Promise<boolean> => {
    try {
      const { data, error } = await supabase
        .from('extraction_instances')
        .select('id')
        .eq('article_id', articleId)
        .eq('template_id', templateId)
        .limit(1);

      if (error) {
          console.error('Error checking initialization:', error);
        return false;
      }

      const initialized = data && data.length > 0;
        console.warn(`Artigo ${articleId} inicializado:`, initialized);
      return initialized;
    } catch (err) {
        console.error('Error checking initialization:', err);
      return false;
    }
  }, []);

  return {
    initializeArticleExtraction,
    isExtractionInitialized,
    loading,
    error,
  };
}

