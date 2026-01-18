/**
 * Hook para Extração de Modelos de Predição
 * 
 * Hook React para gerenciar extração automática de modelos de predição do artigo.
 * 
 * FOCO: Extração automática de modelos (model-extraction pipeline).
 * Permite ao usuário extrair modelos automaticamente do PDF do artigo.
 * 
 * FEATURES:
 * - Estado de loading e error
 * - Toast notifications automáticas
 * - Callback para refresh após extração (recarregar modelos e instâncias)
 * - Tratamento de erros amigável
 */

import { useState, useCallback } from "react";
import { toast } from "sonner";
import {
  SectionExtractionService,
  type ModelExtractionRequest,
} from "@/services/sectionExtractionService";
import {
  getErrorMessage,
  getErrorCode,
  PDFNotFoundError,
  AuthenticationError,
} from "@/lib/ai-extraction/errors";

/**
 * Tipo de retorno do hook
 */
export interface UseModelExtractionReturn {
  extractModels: (request: ModelExtractionRequest) => Promise<void>;
  loading: boolean;
  error: string | null;
}

/**
 * Hook para extração de modelos de predição
 * 
 * USO:
 * ```tsx
 * const { extractModels, loading, error } = useModelExtraction({
 *   onSuccess: (runId, modelsCreated) => {
 *     // Refresh modelos e instâncias
 *   }
 * });
 * 
 * await extractModels({
 *   projectId,
 *   articleId,
 *   templateId
 * });
 * ```
 * 
 * @param options - Opções do hook (callback de sucesso)
 * @returns Função de extração, estado de loading e error
 */
export function useModelExtraction(options?: {
  onSuccess?: (runId: string, modelsCreated: number) => void;
}): UseModelExtractionReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Extrai modelos de predição do artigo
   * 
   * @param request - Parâmetros da extração
   */
  const extractModels = useCallback(
    async (request: ModelExtractionRequest) => {
      console.log('[useModelExtraction] Iniciando extração de modelos', request);
      setLoading(true);
      setError(null);

      try {
        // Chamar service para executar extração
        console.log('[useModelExtraction] Chamando service...');
        const result = await SectionExtractionService.extractModels(request);
        console.log('[useModelExtraction] Service retornou', {
          hasData: !!result.data,
          modelsCreated: result.data?.modelsCreated?.length || 0,
        });

        if (!result.data) {
          throw new Error("No data returned from model extraction");
        }

        const modelsCreated = result.data.modelsCreated.length;

        // Verificar se há modelos criados
        if (modelsCreated === 0) {
          // Avisar que nenhum modelo foi encontrado
          toast.warning("Nenhum modelo encontrado", {
            description: "A extração foi concluída, mas nenhum modelo de predição foi encontrado no artigo.",
            duration: 6000,
          });
        } else {
          // Toast de sucesso com informações úteis
          // Nota: Backend envia tokensTotal, não tokensUsed
          toast.success(
            `Extração concluída! ${modelsCreated} modelo(s) encontrado(s) e criado(s).`,
            {
              description: `${result.data.metadata?.tokensTotal || 0} tokens usados`,
            },
          );
        }

        // Chamar callback de sucesso se fornecido
        // Útil para refresh de modelos e instâncias após extração
        // IMPORTANTE: Não fazer await - callback não deve bloquear o reset do loading
        if (options?.onSuccess) {
          // Executar callback sem bloquear (pode ser async)
          // O loading será resetado no finally independentemente do callback
          Promise.resolve(
            options.onSuccess(result.data.runId, modelsCreated)
          ).catch(err => {
            console.error('[useModelExtraction] Erro no callback onSuccess:', err);
            // Não bloquear o reset do loading por erro no callback
          });
        }
      } catch (err: any) {
        console.error('[useModelExtraction] Erro capturado', {
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
        } else {
          toast.error(`Erro na extração de modelos: ${message}`);
        }

        // Re-throw para permitir tratamento adicional pelo componente
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [options],
  );

  return { extractModels, loading, error };
}

