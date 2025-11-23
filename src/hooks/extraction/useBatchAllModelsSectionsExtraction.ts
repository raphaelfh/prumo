/**
 * Hook para Extração de Seções de Todos os Modelos Existentes
 * 
 * Hook React para gerenciar extração de IA de todas as seções de todos os modelos
 * já existentes, usando chunking para evitar timeout.
 * 
 * FOCO: Iterar sobre modelos existentes e extrair seções de cada um usando chunking.
 * Não extrai modelos novos - apenas processa modelos já existentes.
 * 
 * FEATURES:
 * - Itera sobre modelos existentes
 * - Para cada modelo, extrai todas as seções usando chunking
 * - Progresso agregado (modelos + seções do modelo atual)
 * - Tratamento de erros (pula modelos que falharam)
 */

import { useState, useCallback } from "react";
import { toast } from "sonner";
import { getModelChildSections } from "./helpers/getModelChildSections";
import { processSectionsInChunks } from "./helpers/processSectionsInChunks";
import type { ExtractionProgress } from "./useBatchSectionExtractionChunked";

/**
 * Progresso da extração de seções de todos os modelos
 */
export interface AllModelsSectionsProgress {
  currentModel: number;
  totalModels: number;
  currentModelName: string | null;
  sectionProgress: ExtractionProgress | null;
}

/**
 * Tipo de retorno do hook
 */
export interface UseBatchAllModelsSectionsExtractionReturn {
  extractAllSectionsForAllModels: (params: {
    projectId: string;
    articleId: string;
    templateId: string;
    models: Array<{ instanceId: string; modelName: string }>;
  }) => Promise<void>;
  loading: boolean;
  error: string | null;
  progress: AllModelsSectionsProgress | null;
}

/**
 * Hook para extração de seções de todos os modelos existentes
 * 
 * USO:
 * ```tsx
 * const { extractAllSectionsForAllModels, loading, progress } = useBatchAllModelsSectionsExtraction({
 *   onProgress: (p) => console.log('Progresso:', p),
 *   onSuccess: (result) => {
 *     // Refresh sugestões
 *   }
 * });
 * 
 * await extractAllSectionsForAllModels({
 *   projectId,
 *   articleId,
 *   templateId,
 *   models: [{ instanceId: '...', modelName: 'CatBoost' }, ...]
 * });
 * ```
 * 
 * @param options - Opções do hook
 * @returns Função de extração, estado de loading, error e progresso
 */
export function useBatchAllModelsSectionsExtraction(options?: {
  onProgress?: (progress: AllModelsSectionsProgress) => void;
  onSuccess?: (result: { totalModels: number; successfulModels: number; failedModels: number; totalSuggestionsCreated: number }) => void;
}): UseBatchAllModelsSectionsExtractionReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<AllModelsSectionsProgress | null>(null);

  const chunkSize = 2; // Tamanho do chunk para seções

  /**
   * Extrai todas as seções de todos os modelos existentes
   * 
   * @param params - Parâmetros da extração (projectId, articleId, templateId, models)
   */
  const extractAllSectionsForAllModels = useCallback(
    async (params: {
      projectId: string;
      articleId: string;
      templateId: string;
      models: Array<{ instanceId: string; modelName: string }>;
    }) => {
      console.log('[useBatchAllModelsSectionsExtraction] Iniciando extração de seções de todos os modelos', {
        totalModels: params.models.length,
      });
      setLoading(true);
      setError(null);
      setProgress(null);

      try {
        const { projectId, articleId, templateId, models } = params;

        if (models.length === 0) {
          toast.warning("Nenhum modelo encontrado", {
            description: "Não há modelos para extrair seções. Extraia modelos primeiro.",
          });
          return;
        }

        let totalSuggestionsCreated = 0;
        let successfulModels = 0;
        let failedModels = 0;

        // Processar cada modelo sequencialmente
        for (let i = 0; i < models.length; i++) {
          const model = models[i];

          console.log(`[useBatchAllModelsSectionsExtraction] Processando modelo ${i + 1}/${models.length}`, {
            modelName: model.modelName,
            instanceId: model.instanceId,
          });

          // Atualizar progresso: modelo atual
          const currentProgress: AllModelsSectionsProgress = {
            currentModel: i + 1,
            totalModels: models.length,
            currentModelName: model.modelName,
            sectionProgress: null,
          };
          setProgress(currentProgress);
          if (options?.onProgress) {
            options.onProgress(currentProgress);
          }

          try {
            // Extrair seções deste modelo usando chunking
            // 1. Buscar lista de seções do modelo
            const sections = await getModelChildSections(
              model.instanceId,
              templateId,
            );

            if (sections.length === 0) {
              console.log(`[useBatchAllModelsSectionsExtraction] Nenhuma seção encontrada para modelo ${model.modelName}`);
              successfulModels++; // Considerar sucesso mesmo sem seções
              continue;
            }

            // 2. Processar seções em chunks usando helper
            const modelResult = await processSectionsInChunks({
              sections,
              baseRequest: {
                projectId,
                articleId,
                templateId,
                parentInstanceId: model.instanceId,
                extractAllSections: true,
              },
              chunkSize,
              onProgress: (sectionProgress) => {
                const updatedProgress: AllModelsSectionsProgress = {
                  currentModel: i + 1,
                  totalModels: models.length,
                  currentModelName: model.modelName,
                  sectionProgress,
                };
                setProgress(updatedProgress);
                options?.onProgress?.(updatedProgress);
              },
            });

            totalSuggestionsCreated += modelResult.totalSuggestionsCreated;

            // Se chegou aqui, extração foi bem-sucedida
            successfulModels++;
            console.log(`[useBatchAllModelsSectionsExtraction] Modelo ${i + 1} concluído com sucesso`, {
              modelName: model.modelName,
              suggestionsCreated: modelResult.totalSuggestionsCreated,
            });
          } catch (modelError: any) {
            console.error(`[useBatchAllModelsSectionsExtraction] Erro no modelo ${i + 1}:`, modelError);
            
            // Pular modelo que falhou (não propagar erro)
            failedModels++;
            
            // Continuar com próximo modelo
            continue;
          }
        }

        // Consolidar resultados finais
        console.log('[useBatchAllModelsSectionsExtraction] Extração concluída', {
          totalModels: models.length,
          successfulModels,
          failedModels,
        });

        // Toast de sucesso com informações agregadas
        if (failedModels === 0) {
          toast.success(
            `Extração concluída! Seções extraídas de ${successfulModels} modelo(s) com sucesso.`,
            {
              description: `${totalSuggestionsCreated} sugestão(ões) criada(s) no total.`,
              duration: 8000,
            },
          );
        } else {
          toast.warning(
            `Extração parcialmente concluída: ${successfulModels}/${models.length} modelo(s) processado(s) com sucesso.`,
            {
              description: `${totalSuggestionsCreated} sugestão(ões) criada(s). ${failedModels} modelo(s) falharam.`,
              duration: 10000,
            },
          );
        }

        // Chamar callback de sucesso se fornecido
        if (options?.onSuccess) {
          Promise.resolve(
            options.onSuccess({
              totalModels: models.length,
              successfulModels,
              failedModels,
              totalSuggestionsCreated,
            })
          ).catch(err => {
            console.error('[useBatchAllModelsSectionsExtraction] Erro no callback onSuccess:', err);
          });
        }

        // Limpar progresso
        setProgress(null);
      } catch (err: any) {
        console.error('[useBatchAllModelsSectionsExtraction] Erro capturado', {
          error: err instanceof Error ? err.message : String(err),
          name: err instanceof Error ? err.name : 'Unknown',
          stack: err instanceof Error ? err.stack : undefined,
        });

        // Tratar erro de forma amigável
        const message = err instanceof Error ? err.message : String(err);
        setError(message);

        toast.error(`Erro na extração de seções: ${message}`, {
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
    [options],
  );

  return { extractAllSectionsForAllModels, loading, error, progress };
}

