/**
 * Hook para Extração de Seções de Nível Superior
 * 
 * Extrai todas as seções de nível superior (study-level) que não são subseções de modelos.
 * Essas seções são vinculadas diretamente ao artigo (sem parentInstanceId).
 * 
 * FEATURES:
 * - Extração sequencial de seções de nível superior
 * - Progresso individual por seção
 * - Tratamento de erros (continua mesmo se algumas seções falharem)
 * - Resultados agregados
 */

import { useState, useCallback } from "react";
import { toast } from "sonner";
import { SectionExtractionService } from "@/services/sectionExtractionService";
import { getTopLevelSections } from "./helpers/getTopLevelSections";
import type { SectionExtractionRequest } from "@/types/ai-extraction";

/**
 * Progresso da extração de seções de nível superior
 */
export interface TopLevelSectionsProgress {
  currentSection: number;
  totalSections: number;
  currentSectionName: string | null;
  completedSections: number;
}

/**
 * Tipo de retorno do hook
 */
export interface UseTopLevelSectionsExtractionReturn {
  extractTopLevelSections: (params: {
    projectId: string;
    articleId: string;
    templateId: string;
    options?: {
      model?: 'gpt-4o-mini' | 'gpt-4o' | 'gpt-5';
    };
  }) => Promise<{
    totalSections: number;
    successfulSections: number;
    failedSections: number;
    totalSuggestionsCreated: number;
  }>;
  loading: boolean;
  error: string | null;
  progress: TopLevelSectionsProgress | null;
}

/**
 * Hook para extração de seções de nível superior
 * 
 * @param options - Opções do hook
 * @returns Função de extração, estado de loading, error e progresso
 */
export function useTopLevelSectionsExtraction(options?: {
  onProgress?: (progress: TopLevelSectionsProgress) => void;
  onSuccess?: (result: {
    totalSections: number;
    successfulSections: number;
    failedSections: number;
    totalSuggestionsCreated: number;
  }) => void;
}): UseTopLevelSectionsExtractionReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<TopLevelSectionsProgress | null>(null);

  const extractTopLevelSections = useCallback(
    async (params: {
      projectId: string;
      articleId: string;
      templateId: string;
      options?: {
        model?: 'gpt-4o-mini' | 'gpt-4o' | 'gpt-5';
      };
    }) => {
      console.log('[useTopLevelSectionsExtraction] Iniciando extração de seções de nível superior', params);
      setLoading(true);
      setError(null);
      setProgress(null);

      try {
        const { projectId, articleId, templateId, options: extractionOptions } = params;

        // 1. Buscar lista de seções de nível superior
        console.log('[useTopLevelSectionsExtraction] Buscando seções de nível superior...');
        const sections = await getTopLevelSections(templateId);

        if (sections.length === 0) {
          console.log('[useTopLevelSectionsExtraction] Nenhuma seção de nível superior encontrada');
          toast.info("Nenhuma seção de nível superior encontrada para extrair");
          return {
            totalSections: 0,
            successfulSections: 0,
            failedSections: 0,
            totalSuggestionsCreated: 0,
          };
        }

        console.log('[useTopLevelSectionsExtraction] Seções encontradas:', sections.length);

        // 2. Processar cada seção sequencialmente
        let totalSuggestionsCreated = 0;
        let successfulSections = 0;
        let failedSections = 0;

        for (let i = 0; i < sections.length; i++) {
          const section = sections[i];
          const sectionIndex = i + 1;
          const totalSections = sections.length;

          try {
            const request: SectionExtractionRequest = {
              projectId,
              articleId,
              templateId,
              entityTypeId: section.id,
              // SEM parentInstanceId - seções de nível superior são vinculadas diretamente ao artigo
              options: extractionOptions,
            };

            // Atualizar progresso antes de processar (com nome da seção)
            const progressBefore: TopLevelSectionsProgress = {
              currentSection: sectionIndex,
              totalSections,
              currentSectionName: section.label,
              completedSections: i,
            };
            setProgress(progressBefore);
            options?.onProgress?.(progressBefore);

            const result = await SectionExtractionService.extractSection(request);

            if (result.data) {
              totalSuggestionsCreated += result.data.suggestionsCreated || 0;
              successfulSections++;
              console.log(`[useTopLevelSectionsExtraction] Seção ${sectionIndex}/${totalSections} extraída com sucesso: ${section.label}`);
            } else {
              failedSections++;
              console.error(`[useTopLevelSectionsExtraction] Seção ${sectionIndex}/${totalSections} falhou: ${section.label}`);
            }
          } catch (sectionError: any) {
            console.error(`[useTopLevelSectionsExtraction] Erro na seção ${sectionIndex}/${totalSections}:`, sectionError);
            failedSections++;
            // Continuar com próxima seção
          }

          // Atualizar progresso após processar seção (sem nome, apenas contador)
          const progressAfter: TopLevelSectionsProgress = {
            currentSection: sectionIndex,
            totalSections,
            currentSectionName: null,
            completedSections: sectionIndex,
          };
          setProgress(progressAfter);
          options?.onProgress?.(progressAfter);
        }

        console.log('[useTopLevelSectionsExtraction] Extração concluída', {
          totalSections: sections.length,
          successfulSections,
          failedSections,
          totalSuggestionsCreated,
        });

        // Toast de sucesso com informações agregadas
        if (successfulSections > 0) {
          toast.success(
            `Seções de nível superior extraídas: ${successfulSections}/${sections.length}`,
            {
              description: failedSections > 0
                ? `${failedSections} seção(ões) falharam. ${totalSuggestionsCreated} sugestão(ões) criada(s).`
                : `${totalSuggestionsCreated} sugestão(ões) criada(s).`,
              duration: 6000,
            },
          );
        } else if (failedSections > 0) {
          toast.error(
            `Falha ao extrair seções de nível superior`,
            {
              description: `Todas as ${failedSections} seção(ões) falharam.`,
              duration: 6000,
            },
          );
        }

        const result = {
          totalSections: sections.length,
          successfulSections,
          failedSections,
          totalSuggestionsCreated,
        };

        options?.onSuccess?.(result);
        return result;
      } catch (err: any) {
        console.error('[useTopLevelSectionsExtraction] Erro na extração:', err);
        const errorMessage = err.message || "Erro desconhecido na extração de seções de nível superior.";
        setError(errorMessage);
        toast.error(`Erro na extração de seções de nível superior: ${errorMessage}`);
        throw err;
      } finally {
        setLoading(false);
        setProgress(null);
      }
    },
    [options],
  );

  return { extractTopLevelSections, loading, error, progress };
}


