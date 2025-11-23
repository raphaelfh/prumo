/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * Hook para Extração de Todas as Seções de um Modelo
 * 
 * Hook React para gerenciar extração de IA de todas as seções de um modelo de uma vez.
 * 
 * FOCO: Extração em batch com memória resumida (section-extraction pipeline com extractAllSections=true).
 * Permite ao usuário extrair todas as seções de um modelo sequencialmente em uma única operação.
 * 
 * FEATURES:
 * - Estado de loading e error
 * - Toast notifications automáticas com resultados agregados
 * - Callback para refresh de sugestões após extração
 * - Tratamento de erros amigável
 */

import { useState, useCallback } from "react";
import { toast } from "sonner";
import {
  SectionExtractionService,
} from "@/services/sectionExtractionService";
import type { BatchSectionExtractionRequest } from "@/types/ai-extraction";
import {
  getErrorMessage,
  getErrorCode,
  PDFNotFoundError,
  AuthenticationError,
} from "@/lib/ai-extraction/errors";

/**
 * Tipo de retorno do hook
 */
export interface UseBatchSectionExtractionReturn {
  extractAllSections: (request: BatchSectionExtractionRequest) => Promise<void>;
  loading: boolean;
  error: string | null;
}

/**
 * Hook para extração de todas as seções de um modelo
 * 
 * USO:
 * ```tsx
 * const { extractAllSections, loading, error } = useBatchSectionExtraction({
 *   onSuccess: (result) => {
 *     // Refresh sugestões ou navegar
 *   }
 * });
 * 
 * await extractAllSections({
 *   projectId,
 *   articleId,
 *   templateId,
 *   parentInstanceId,
 *   extractAllSections: true
 * });
 * ```
 * 
 * @param options - Opções do hook (callback de sucesso)
 * @returns Função de extração, estado de loading e error
 */
export function useBatchSectionExtraction(options?: {
  onSuccess?: (result: { totalSections: number; successfulSections: number; failedSections: number; totalSuggestionsCreated: number }) => void;
}): UseBatchSectionExtractionReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Extrai todas as seções de um modelo
   * 
   * @param request - Parâmetros da extração
   */
  const extractAllSections = useCallback(
    async (request: BatchSectionExtractionRequest) => {
      console.log('[useBatchSectionExtraction] Iniciando extração de todas as seções', request);
      setLoading(true);
      setError(null);

      try {
        // Chamar service para executar extração
        console.log('[useBatchSectionExtraction] Chamando service...');
        const result = await SectionExtractionService.extractAllSections(request);
        console.log('[useBatchSectionExtraction] Service retornou', {
          hasData: !!result.data,
          totalSections: result.data?.totalSections,
          successfulSections: result.data?.successfulSections,
          failedSections: result.data?.failedSections,
          totalSuggestionsCreated: result.data?.totalSuggestionsCreated,
        });

        if (!result.data) {
          throw new Error("No data returned from batch extraction");
        }

        const { totalSections, successfulSections, failedSections, totalSuggestionsCreated, metadata } = result.data;

        // Toast de sucesso com informações agregadas
        if (failedSections === 0) {
          toast.success(
            `Extração concluída! ${successfulSections} seção(ões) extraída(s) com sucesso.`,
            {
              description: `${totalSuggestionsCreated} sugestão(ões) criada(s). ${metadata.totalTokensUsed} tokens usados em ${(metadata.totalDuration / 1000).toFixed(1)}s`,
              duration: 8000,
            },
          );
        } else {
          toast.warning(
            `Extração parcialmente concluída: ${successfulSections}/${totalSections} seção(ões) extraída(s) com sucesso.`,
            {
              description: `${totalSuggestionsCreated} sugestão(ões) criada(s). ${failedSections} seção(ões) falharam. Verifique os logs para mais detalhes.`,
              duration: 10000,
            },
          );
        }

        // Chamar callback de sucesso se fornecido
        if (options?.onSuccess) {
          Promise.resolve(
            options.onSuccess({
              totalSections,
              successfulSections,
              failedSections,
              totalSuggestionsCreated,
            })
          ).catch(err => {
            console.error('[useBatchSectionExtraction] Erro no callback onSuccess:', err);
          });
        }
      } catch (err: any) {
        console.error('[useBatchSectionExtraction] Erro capturado', {
          error: err instanceof Error ? err.message : String(err),
          name: err instanceof Error ? err.name : 'Unknown',
          stack: err instanceof Error ? err.stack : undefined,
        });

        // Tratar erro de forma amigável usando classes de erro customizadas
        const message = getErrorMessage(err);
        const code = getErrorCode(err);
        setError(message);

        // Toast de erro com mensagem clara baseada no tipo de erro
        const errorCode = code || '';
        if (err instanceof PDFNotFoundError || errorCode === 'PDF_NOT_FOUND') {
          toast.error("Erro na extração", {
            description: message,
          });
        } else if (err instanceof AuthenticationError || errorCode === 'AUTH_ERROR') {
          toast.error("Erro de autenticação", {
            description: "Por favor, faça login novamente.",
          });
        } else if (errorCode === 'TIMEOUT' || message.includes('timeout') || message.includes('cancelada')) {
          toast.error("Extração cancelada por timeout", {
            description: "A extração demorou muito tempo. Tente novamente com um PDF menor ou extraia as seções individualmente.",
            duration: 10000,
          });
        } else {
          toast.error(`Erro na extração de todas as seções: ${message}`, {
            duration: 8000,
          });
        }

        // Re-throw para permitir tratamento adicional pelo componente
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [options],
  );

  return { extractAllSections, loading, error };
}

