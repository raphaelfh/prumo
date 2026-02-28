/**
 * Hook para Extração de Seção Específica
 * 
 * Hook React para gerenciar extração de IA de uma seção (entity type) específica.
 * 
 * FOCO: Extração granular por seção (section-extraction pipeline).
 * Permite ao usuário extrair dados de uma seção específica do template por vez.
 * 
 * FEATURES:
 * - Estado de loading e error
 * - Toast notifications automáticas
 * - Callback para refresh de sugestões após extração
 * - Tratamento de erros amigável
 */

import {useCallback, useState} from "react";
import {toast} from "sonner";
import {type SectionExtractionRequest, SectionExtractionService,} from "@/services/sectionExtractionService";
import {
    AuthenticationError,
    FieldNameMismatchError,
    getErrorCode,
    getErrorMessage,
    NoInstancesError,
    PDFNotFoundError,
} from "@/lib/ai-extraction/errors";

/**
 * Tipo de retorno do hook
 */
export interface UseSectionExtractionReturn {
  extractSection: (request: SectionExtractionRequest) => Promise<void>;
  loading: boolean;
  error: string | null;
}

/**
 * Hook para extração de seção específica
 * 
 * USO:
 * ```tsx
 * const { extractSection, loading, error } = useSectionExtraction({
 *   onSuccess: (runId) => {
 *     // Refresh sugestões ou navegar
 *   }
 * });
 * 
 * await extractSection({
 *   projectId,
 *   articleId,
 *   templateId,
 *   entityTypeId
 * });
 * ```
 * 
 * @param options - Opções do hook (callback de sucesso)
 * @returns Função de extração, estado de loading e error
 */
export function useSectionExtraction(options?: {
  onSuccess?: (runId: string, suggestionsCreated: number) => void;
}): UseSectionExtractionReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Extrai dados de uma seção específica
   * 
   * @param request - Parâmetros da extração
   */
  const extractSection = useCallback(
    async (request: SectionExtractionRequest) => {
      console.log('[useSectionExtraction] Iniciando extração', request);
      setLoading(true);
      setError(null);

      try {
        // Chamar service para executar extração
        console.log('[useSectionExtraction] Chamando service...');
        const result = await SectionExtractionService.extractSection(request);
        console.log('[useSectionExtraction] Service retornou', {
          hasData: !!result.data,
          suggestionsCreated: result.data?.suggestionsCreated,
        });

        if (!result.data) {
          throw new Error("No data returned from extraction");
        }

        // Verificar se há sugestões criadas
        if (result.data.suggestionsCreated === 0) {
          // Avisar que nenhuma sugestão foi criada
          toast.warning("Extração concluída sem sugestões", {
            description: "A extração foi concluída, mas nenhuma sugestão foi criada. Verifique se os nomes dos campos correspondem exatamente ou se o PDF contém os dados esperados.",
            duration: 6000,
          });
        } else {
        // Toast de sucesso com informações úteis
        // Backend FastAPI envia tokensTotal direto, não em metadata
        const tokensUsed = result.data.tokensTotal || result.data.metadata?.tokensTotal || 0;
        toast.success(
            `Extração concluída! ${result.data.suggestionsCreated} sugestão(ões) criada(s) para esta seção.`,
          {
            description: `${tokensUsed} tokens usados`,
          },
        );
        }

        // Chamar callback de sucesso se fornecido
        // Útil para refresh de sugestões após extração
        // IMPORTANTE: Não fazer await - callback não deve bloquear o reset do loading
        if (options?.onSuccess) {
          // Executar callback sem bloquear (pode ser async)
          // O loading será resetado no finally independentemente do callback
          Promise.resolve(
            options.onSuccess(result.data.runId, result.data.suggestionsCreated)
          ).catch(err => {
            console.error('[useSectionExtraction] Erro no callback onSuccess:', err);
            // Não bloquear o reset do loading por erro no callback
          });
        }
      } catch (err: any) {
        console.error('[useSectionExtraction] Erro capturado', {
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
        if (err instanceof NoInstancesError || errorCode === 'NO_INSTANCES') {
          toast.error("Erro na extração", {
            description: message,
            duration: 6000,
          });
        } else if (err instanceof PDFNotFoundError || errorCode === 'PDF_NOT_FOUND') {
          toast.error("Erro na extração", {
            description: message,
          });
        } else if (err instanceof FieldNameMismatchError || errorCode === 'FIELD_NAME_MISMATCH') {
          toast.error("Erro: Campos não correspondem", {
            description: message,
            duration: 8000,
          });
        } else if (err instanceof AuthenticationError || errorCode === 'AUTH_ERROR') {
          toast.error("Erro de autenticação", {
            description: "Por favor, faça login novamente.",
          });
        } else {
          // Verificar se a mensagem de erro do backend indica field mismatch
          const errorMessage = message.toLowerCase();
          if (errorMessage.includes('field name') || errorMessage.includes('mismatch') || errorMessage.includes('no mapping')) {
            toast.error("Erro: Campos não correspondem", {
              description: "Os campos extraídos não correspondem aos campos esperados. Verifique os logs para mais detalhes.",
              duration: 8000,
          });
        } else {
          toast.error(`Erro na extração: ${message}`);
          }
        }

        // Re-throw para permitir tratamento adicional pelo componente
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [options],
  );

  return { extractSection, loading, error };
}

