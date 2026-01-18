/**
 * Hook para Extração IA Completa
 * 
 * Hook React para gerenciar extração completa de IA:
 * 1. Extrai modelos do artigo (usando IA)
 * 2. Para cada modelo extraído, extrai todas as seções automaticamente
 * 
 * FOCO: Orquestração de extração completa (modelos + seções).
 * Reutiliza hooks existentes para manter DRY.
 * 
 * FEATURES:
 * - Extração sequencial: modelos primeiro, depois seções
 * - Progresso agregado (estágio atual + progresso de seções)
 * - Tratamento de erros (continua mesmo se alguns modelos falharem)
 * - Callback de sucesso para refresh
 */

import { useState, useCallback } from "react";
import { toast } from "sonner";
import { useModelExtraction } from "./useModelExtraction";
import { useBatchAllModelsSectionsExtraction } from "./useBatchAllModelsSectionsExtraction";
import { useTopLevelSectionsExtraction } from "./useTopLevelSectionsExtraction";
import { supabase } from "@/integrations/supabase/client";
import { queryEntityTypesWithFallback } from "./helpers/queryEntityTypes";
import type { AllModelsSectionsProgress } from "./useBatchAllModelsSectionsExtraction";
import type { TopLevelSectionsProgress } from "./useTopLevelSectionsExtraction";

/**
 * Progresso da extração completa
 */
export interface FullAIExtractionProgress {
  stage: 'extracting_models' | 'extracting_sections';
  modelsProgress?: AllModelsSectionsProgress;
  topLevelSectionsProgress?: TopLevelSectionsProgress;
}

/**
 * Tipo de retorno do hook
 */
export interface UseFullAIExtractionReturn {
  extractFullAI: (params: {
    projectId: string;
    articleId: string;
    templateId: string;
  }) => Promise<void>;
  loading: boolean;
  error: string | null;
  progress: FullAIExtractionProgress | null;
}

/**
 * Hook para extração IA completa
 * 
 * USO:
 * ```tsx
 * const { extractFullAI, loading, progress } = useFullAIExtraction({
 *   onSuccess: () => {
 *     // Refresh instâncias e modelos
 *   }
 * });
 * 
 * await extractFullAI({
 *   projectId,
 *   articleId,
 *   templateId
 * });
 * ```
 * 
 * @param options - Opções do hook
 * @returns Função de extração, estado de loading, error e progresso
 */
export function useFullAIExtraction(options?: {
  onSuccess?: () => Promise<void>;
}): UseFullAIExtractionReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<FullAIExtractionProgress | null>(null);

  // Hook para extração de modelos
  const { extractModels: extractModelsHook } = useModelExtraction();

  // Hook para extração de seções de nível superior
  const { extractTopLevelSections } = useTopLevelSectionsExtraction({
    onProgress: (topLevelSectionsProgress) => {
      setProgress({
        stage: 'extracting_models',
        topLevelSectionsProgress,
      });
    },
  });

  // Hook para extração de seções de todos os modelos
  const { extractAllSectionsForAllModels } = useBatchAllModelsSectionsExtraction({
    onProgress: (modelsProgress) => {
      setProgress({
        stage: 'extracting_sections',
        modelsProgress,
      });
    },
  });

  /**
   * Busca modelos extraídos do artigo
   * 
   * @param articleId - ID do artigo
   * @param modelParentEntityTypeId - ID do entity type dos modelos
   * @returns Array de modelos encontrados
   */
  const fetchExtractedModels = useCallback(async (
    articleId: string,
    modelParentEntityTypeId: string
  ): Promise<Array<{ instanceId: string; modelName: string }>> => {
    const { data: instances, error: instancesError } = await supabase
      .from('extraction_instances')
      .select('id, label')
      .eq('article_id', articleId)
      .eq('entity_type_id', modelParentEntityTypeId)
      .order('sort_order', { ascending: true });

    if (instancesError) {
      throw new Error(`Failed to fetch models: ${instancesError.message}`);
    }

    return (instances || []).map(instance => ({
      instanceId: instance.id,
      modelName: instance.label || 'Modelo sem nome',
    }));
  }, []);

  /**
   * Busca o entity type ID dos modelos (prediction_models)
   * 
   * @param templateId - ID do template
   * @returns ID do entity type dos modelos
   */
  const fetchModelParentEntityTypeId = useCallback(async (
    templateId: string
  ): Promise<string> => {
    const results = await queryEntityTypesWithFallback<{ id: string }>({
      templateId,
      select: 'id',
      filters: (query) => query.eq('name', 'prediction_models'),
    });

    if (results.length === 0) {
      throw new Error('Model entity type (prediction_models) not found in template');
    }

    return results[0].id;
  }, []);

  /**
   * Extrai modelos e depois seções de cada modelo
   * 
   * @param params - Parâmetros da extração
   */
  const extractFullAI = useCallback(
    async (params: {
      projectId: string;
      articleId: string;
      templateId: string;
    }) => {
      console.log('[useFullAIExtraction] Iniciando extração IA completa', params);
      setLoading(true);
      setError(null);
      setProgress(null);

      try {
        const { projectId, articleId, templateId } = params;

        // FASE 1: Extrair modelos e seções de nível superior em paralelo
        console.log('[useFullAIExtraction] Fase 1: Extraindo modelos e seções de nível superior em paralelo...');
        setProgress({
          stage: 'extracting_models',
        });

        // Executar ambas as extrações em paralelo
        const [modelsResult, topLevelSectionsResult] = await Promise.all([
          extractModelsHook({
            projectId,
            articleId,
            templateId,
          }),
          extractTopLevelSections({
            projectId,
            articleId,
            templateId,
          }),
        ]);

        console.log('[useFullAIExtraction] Modelos e seções de nível superior extraídos com sucesso', {
          modelsExtracted: true,
          topLevelSectionsExtracted: topLevelSectionsResult.totalSections > 0,
        });

        // FASE 2: Buscar modelos extraídos
        console.log('[useFullAIExtraction] Fase 2: Buscando modelos extraídos...');
        const modelParentEntityTypeId = await fetchModelParentEntityTypeId(templateId);
        const models = await fetchExtractedModels(articleId, modelParentEntityTypeId);

        if (models.length === 0) {
          toast.warning("Nenhum modelo encontrado", {
            description: "A extração de modelos foi concluída, mas nenhum modelo foi encontrado.",
          });
          return;
        }

        console.log(`[useFullAIExtraction] Encontrados ${models.length} modelo(s)`, {
          modelNames: models.map(m => m.modelName),
        });

        // FASE 3: Extrair seções de todos os modelos
        console.log('[useFullAIExtraction] Fase 3: Extraindo seções de todos os modelos...');
        setProgress({
          stage: 'extracting_sections',
        });

        await extractAllSectionsForAllModels({
          projectId,
          articleId,
          templateId,
          models,
        });

        console.log('[useFullAIExtraction] Extração IA completa concluída com sucesso');

        // Toast de sucesso final
        const topLevelSectionsCount = topLevelSectionsResult?.totalSections || 0;
        const topLevelSectionsSuccess = topLevelSectionsResult?.successfulSections || 0;
        
        let description = `${models.length} modelo(s) processado(s) com todas as seções extraídas.`;
        if (topLevelSectionsCount > 0) {
          description += ` ${topLevelSectionsSuccess} seção(ões) de nível superior extraída(s).`;
        }
        
        toast.success(
          `Extração IA completa concluída!`,
          {
            description,
            duration: 8000,
          },
        );

        // Chamar callback de sucesso se fornecido
        if (options?.onSuccess) {
          await options.onSuccess();
        }

        // Limpar progresso
        setProgress(null);
      } catch (err: any) {
        console.error('[useFullAIExtraction] Erro capturado', {
          error: err instanceof Error ? err.message : String(err),
          name: err instanceof Error ? err.name : 'Unknown',
          stack: err instanceof Error ? err.stack : undefined,
        });

        // Tratar erro de forma amigável
        const message = err instanceof Error ? err.message : String(err);
        setError(message);

        toast.error(`Erro na extração IA completa: ${message}`, {
          duration: 8000,
        });

        // Limpar progresso
        setProgress(null);

        // Re-throw para permitir tratamento adicional pelo componente
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [extractModelsHook, extractTopLevelSections, extractAllSectionsForAllModels, fetchModelParentEntityTypeId, fetchExtractedModels, options],
  );

  return { extractFullAI, loading, error, progress };
}

