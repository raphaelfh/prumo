/**
 * Hook para Extração de Todas as Seções de um Modelo com Chunking
 * 
 * Hook React para gerenciar extração de IA de todas as seções de um modelo
 * usando chunking (dividindo em grupos menores) para evitar timeout.
 * 
 * FOCO: Chunking no frontend para processar seções em grupos de 2-3,
 * evitando timeout de 150s do Supabase Edge Functions.
 * 
 * FEATURES:
 * - Chunking automático (2-3 seções por chunk)
 * - Cache de PDF (processa uma vez, reutiliza texto)
 * - Progresso em tempo real
 * - Tratamento de erros (pula seções que falharam)
 */

import { useState, useCallback } from "react";
import { toast } from "sonner";
import type { BatchSectionExtractionRequest } from "@/types/ai-extraction";
import {
  getErrorMessage,
  getErrorCode,
  PDFNotFoundError,
  AuthenticationError,
} from "@/lib/ai-extraction/errors";
import { getModelChildSections } from "./helpers/getModelChildSections";
import { processSectionsInChunks } from "./helpers/processSectionsInChunks";

/**
 * Progresso da extração em chunks
 */
export interface ExtractionProgress {
  currentChunk: number;
  totalChunks: number;
  completedSections: number;
  totalSections: number;
  currentSectionName: string | null;
}

/**
 * Tipo de retorno do hook
 */
export interface UseBatchSectionExtractionChunkedReturn {
  extractAllSections: (request: Omit<BatchSectionExtractionRequest, 'sectionIds' | 'pdfText'>) => Promise<void>;
  loading: boolean;
  error: string | null;
  progress: ExtractionProgress | null;
}

/**
 * Hook para extração de todas as seções com chunking
 * 
 * USO:
 * ```tsx
 * const { extractAllSections, loading, progress } = useBatchSectionExtractionChunked({
 *   onProgress: (p) => console.log('Progresso:', p),
 *   onSuccess: (result) => {
 *     // Refresh sugestões
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
 * @param options - Opções do hook
 * @returns Função de extração, estado de loading, error e progresso
 */
export function useBatchSectionExtractionChunked(options?: {
  onProgress?: (progress: ExtractionProgress) => void;
  onSuccess?: (result: { totalSections: number; successfulSections: number; failedSections: number; totalSuggestionsCreated: number }) => void;
  chunkSize?: number; // Padrão: 2
}): UseBatchSectionExtractionChunkedReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ExtractionProgress | null>(null);
  const [pdfTextCache, setPdfTextCache] = useState<string | null>(null);

  const chunkSize = options?.chunkSize || 2;

  /**
   * Extrai todas as seções de um modelo usando chunking
   * 
   * @param request - Parâmetros da extração (sem sectionIds e pdfText - serão gerados)
   */
  const extractAllSections = useCallback(
    async (request: Omit<BatchSectionExtractionRequest, 'sectionIds' | 'pdfText'>) => {
      console.log('[useBatchSectionExtractionChunked] Iniciando extração com chunking', request);
      setLoading(true);
      setError(null);
      setProgress(null);

      try {
        // 1. Buscar lista de seções do modelo
        console.log('[useBatchSectionExtractionChunked] Buscando seções do modelo...');
        const sections = await getModelChildSections(
          request.parentInstanceId,
          request.templateId,
        );

        if (sections.length === 0) {
          toast.warning("Nenhuma seção encontrada para este modelo");
          return;
        }

        console.log('[useBatchSectionExtractionChunked] Seções encontradas:', sections.length);

        // 2. Processar seções em chunks usando helper
        const result = await processSectionsInChunks({
          sections,
          baseRequest: request,
          chunkSize,
          pdfText: pdfTextCache || undefined,
          onProgress: (progress) => {
            setProgress(progress);
            options?.onProgress?.(progress);
          },
        });

        // 3. Consolidar resultados finais
        const { totalSuggestionsCreated, successfulSections, failedSections, totalTokensUsed, totalDurationMs } = result;
        const totalSections = sections.length;

        console.log('[useBatchSectionExtractionChunked] Extração concluída', {
          totalSections,
          successfulSections,
          failedSections,
          totalSuggestionsCreated,
          totalTokensUsed,
          totalDurationMs,
        });

        // Toast de sucesso com informações agregadas
        const durationSecs = (totalDurationMs / 1000).toFixed(1);
        if (failedSections === 0) {
          toast.success(
            `Extração concluída! ${successfulSections} seção(ões) extraída(s) com sucesso.`,
            {
              description: `${totalSuggestionsCreated} sugestão(ões) criada(s). ${totalTokensUsed} tokens usados em ${durationSecs}s`,
              duration: 8000,
            },
          );
        } else {
          toast.warning(
            `Extração parcialmente concluída: ${successfulSections}/${totalSections} seção(ões) extraída(s) com sucesso.`,
            {
              description: `${totalSuggestionsCreated} sugestão(ões) criada(s). ${failedSections} seção(ões) falharam. ${totalTokensUsed} tokens usados.`,
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
            console.error('[useBatchSectionExtractionChunked] Erro no callback onSuccess:', err);
          });
        }

        // Limpar progresso
        setProgress(null);
      } catch (err: any) {
        console.error('[useBatchSectionExtractionChunked] Erro capturado', {
          error: err instanceof Error ? err.message : String(err),
          name: err instanceof Error ? err.name : 'Unknown',
          stack: err instanceof Error ? err.stack : undefined,
        });

        // Tratar erro de forma amigável
        const message = getErrorMessage(err);
        const code = getErrorCode(err);
        setError(message);

        // Toast de erro
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
          toast.error(`Erro na extração: ${message}`, {
            duration: 8000,
          });
        }

        // Limpar progresso
        setProgress(null);

        // Re-throw para permitir tratamento adicional pelo componente
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [options, chunkSize, pdfTextCache],
  );

  return { extractAllSections, loading, error, progress };
}

