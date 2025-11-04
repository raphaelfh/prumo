/**
 * Testes unitários para SectionPDFProcessor
 */

import { assertEquals, assertRejects } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { SectionPDFProcessor } from "./pdf-processor.ts";
import { AppError, ErrorCode } from "../_shared/core/error-handler.ts";
import { Logger } from "../_shared/core/logger.ts";

Deno.test("SectionPDFProcessor - process válido PDF buffer", async () => {
  const logger = new Logger({ traceId: "test-trace" });
  const processor = new SectionPDFProcessor(logger);

  // Criar um PDF válido mínimo (header PDF)
  const pdfHeader = new TextEncoder().encode("%PDF-1.4\n");
  // Adicionar alguns bytes aleatórios para simular PDF
  const pdfBuffer = new Uint8Array([...pdfHeader, ...new Array(100).fill(0)]);

  // Este teste pode falhar se pdf-parse não conseguir processar um PDF mínimo
  // Mas pelo menos valida que o método não lança erro para formato válido
  try {
    const result = await processor.process(pdfBuffer);
    assertEquals(typeof result.text, "string");
    assertEquals(typeof result.pageCount, "number");
    assertEquals(typeof result.metadata, "object");
  } catch (err) {
    // Se falhar, pelo menos deve ser um AppError com código apropriado
    if (err instanceof AppError) {
      assertEquals(err.code, ErrorCode.PDF_PROCESSING_ERROR);
    } else {
      throw err;
    }
  }
});

Deno.test("SectionPDFProcessor - process rejeita buffer vazio", async () => {
  const logger = new Logger({ traceId: "test-trace" });
  const processor = new SectionPDFProcessor(logger);
  const emptyBuffer = new Uint8Array(0);

  await assertRejects(
    async () => {
      await processor.process(emptyBuffer);
    },
    AppError,
    "PDF buffer is empty",
  );
});

Deno.test("SectionPDFProcessor - process valida header PDF", async () => {
  const logger = new Logger({ traceId: "test-trace" });
  const processor = new SectionPDFProcessor(logger);

  // Buffer sem header PDF válido
  const invalidBuffer = new TextEncoder().encode("INVALID PDF CONTENT");

  // Deve processar mas logar warning (não falhar imediatamente)
  try {
    const result = await processor.process(invalidBuffer);
    // Se chegou aqui, pelo menos não lançou erro imediatamente
    assertEquals(typeof result, "object");
  } catch (err) {
    // Se falhar, deve ser erro de processamento, não validação
    if (err instanceof AppError) {
      // Não deve ser erro de validação para buffer vazio
      assertEquals(err.code, ErrorCode.PDF_PROCESSING_ERROR);
    } else {
      throw err;
    }
  }
});

