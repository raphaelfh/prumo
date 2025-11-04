/**
 * PDF Processor para Section Extraction
 * 
 * Responsável por extrair texto de PDFs usando pdf-parse.
 * 
 * ISOLADO: Implementação própria para manter independência do pipeline de extração completa.
 * Similar ao PDFProcessor de _shared, mas focado apenas no essencial.
 * 
 * ESTRATÉGIA: Atualmente usa apenas pdf-parse (pdfjs). Suporte para Unstructured API
 * pode ser adicionado no futuro se necessário.
 */

import { AppError, ErrorCode } from "../_shared/core/error-handler.ts";
import { Logger } from "../_shared/core/logger.ts";
import { RetryHandler } from "../_shared/core/retry.ts";
import { CONFIG } from "./config.ts";

/**
 * Interface para PDF processado
 * 
 * Contém o texto extraído e metadados básicos do PDF.
 */
export interface ProcessedPDF {
  text: string;
  pageCount: number;
  metadata: {
    title?: string;
    author?: string;
    createdAt?: string;
  };
}

/**
 * Classe para processamento de PDFs
 * 
 * Usa pdf-parse via npm specifier (Deno suporta npm:).
 * Implementa retry automático para falhas transitórias.
 */
export class SectionPDFProcessor {
  constructor(private logger: Logger) {}

  /**
   * Processa um buffer de PDF e extrai o texto
   * 
   * @param buffer - Buffer do PDF (Uint8Array)
   * @returns PDF processado com texto e metadados
   * @throws AppError se falhar o processamento após retries
   */
  async process(buffer: Uint8Array): Promise<ProcessedPDF> {
    const start = performance.now();

    // Validar buffer não vazio
    if (buffer.length === 0) {
      throw new AppError(ErrorCode.PDF_PROCESSING_ERROR, "PDF buffer is empty", 400);
    }

    // Validar que é um PDF (assina PDF deve começar com %PDF)
    const header = new TextDecoder("utf-8", { fatal: false }).decode(buffer.slice(0, 8));
      if (!header || typeof header !== 'string') {
        this.logger.warn("Buffer header decoding failed", {
          bufferSize: buffer.byteLength,
        });
      } else if (!header.startsWith("%PDF")) {
      this.logger.warn("Buffer does not appear to be a PDF", {
        header: header.substring(0, 20),
        bufferSize: buffer.byteLength,
      });
      // Não falhar ainda, pode ser que o header esteja mais adiante
    }

    try {
      // Usar pdf-parse com retry para lidar com falhas transitórias
      // Por exemplo: PDF corrompido temporariamente, timeout na primeira tentativa, etc.
      return await RetryHandler.withRetry(
        async () => {
          try {
            // Lazy import para reduzir cold start da edge function
            // pdf-parse é importado apenas quando necessário
            const mod = await import("npm:pdf-parse@1.1.1");
            const pdfParse = mod.default ?? mod;

            // Converter Uint8Array para Buffer (formato esperado pelo pdf-parse)
            const data = await pdfParse(Buffer.from(buffer));

            // Validar que extraiu algum texto
            // CRÍTICO: Garantir que data.text existe e é uma string válida
            let extractedText = "";
            if (data && typeof data === 'object') {
              extractedText = (data.text as string) ?? "";
              if (typeof extractedText !== 'string') {
                this.logger.warn("PDF text is not a string", {
                  textType: typeof data.text,
                  bufferSize: buffer.byteLength,
                });
                extractedText = "";
              }
            }

            const pageCount = (data?.numpages as number) ?? 0;

            if (extractedText.trim().length === 0 && pageCount > 0) {
              this.logger.warn("PDF processed but no text extracted", {
                pageCount,
                bufferSize: buffer.byteLength,
              });
            }

            // CRÍTICO: Garantir que sempre retornamos uma string válida (nunca undefined/null)
            if (!extractedText || typeof extractedText !== 'string') {
              extractedText = "";
            }

            return {
              text: extractedText, // Garantido ser string válida
              pageCount,
              metadata: {
                title: (data?.info?.Title as string) || undefined,
                author: (data?.info?.Author as string) || undefined,
                createdAt: (data?.info?.CreationDate as string) || undefined,
              },
            } satisfies ProcessedPDF;
          } catch (err) {
            const error = err as Error;
            const errorMessage = error.message?.toLowerCase() || "";

            // Erros específicos que não devem usar fallback
            if (
              errorMessage.includes("invalid pdf") ||
              errorMessage.includes("corrupted") ||
              errorMessage.includes("malformed")
            ) {
              this.logger.error("PDF is invalid or corrupted", error, {
                bufferSize: buffer.byteLength,
              });
              throw new AppError(
                ErrorCode.PDF_PROCESSING_ERROR,
                "PDF file is invalid or corrupted",
                400,
                { error: error.message },
              );
            }

            // Para outros erros, tentar fallback apenas na primeira tentativa
            // Não usar fallback em retries (pode indicar problema real)
            this.logger.warn("pdf-parse failed; attempting fallback decode", {
              error: error.message,
              bufferSize: buffer.byteLength,
            });

            // Fallback: tentar decodificar como texto (apenas se for erro conhecido)
            // Este fallback é muito básico e só deve ser usado em casos extremos
            const decoder = new TextDecoder("utf-8", { fatal: false });
            const fallbackText = decoder.decode(buffer);
            
            // Validar que o fallback produziu algo útil (mais de 50 caracteres)
            if (fallbackText.trim().length < 50) {
              throw new AppError(
                ErrorCode.PDF_PROCESSING_ERROR,
                "Failed to extract meaningful text from PDF",
                500,
                { error: error.message },
              );
            }

            return {
              text: fallbackText,
              pageCount: 0, // Desconhecido com fallback
              metadata: {},
            } satisfies ProcessedPDF;
          }
        },
        {
          maxAttempts: CONFIG.retry.maxAttempts,
          initialDelayMs: CONFIG.retry.pdfInitialDelayMs,
          shouldRetry: (e) => {
            // Não retry para PDFs inválidos (problema de arquivo, não transitório)
            const errorMessage = e.message?.toLowerCase() || "";
            return !(
              errorMessage.includes("invalid pdf") ||
              errorMessage.includes("corrupted") ||
              errorMessage.includes("malformed")
            );
          },
        },
      );
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.error("PDF processing failed after retries", err as Error, {
        bufferSize: buffer.byteLength,
        duration: `${duration.toFixed(0)}ms`,
      });

      // Se já é AppError, re-lançar
      if (err instanceof AppError) {
        throw err;
      }

      throw new AppError(ErrorCode.PDF_PROCESSING_ERROR, "Failed to process PDF after retries", 500, {
        error: (err as Error).message,
      });
    } finally {
      // Registrar métrica de performance
      const duration = performance.now() - start;
      this.logger.metric("pdf_processing_ms", duration, "ms");
    }
  }
}

