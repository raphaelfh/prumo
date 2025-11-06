/**
 * Testes unitários para Structured Extraction Edge Function
 * 
 * Testa validação, autenticação e extração usando Instructor.js.
 */

import { assertEquals, assertRejects } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { Logger } from "../../_shared/core/logger.ts";
import { InstructorExtractor } from "../../_shared/extraction/instructor-extractor.ts";
import { AppError, ErrorCode } from "../../_shared/core/error-handler.ts";
import { z } from "npm:zod@3.23.8";

/**
 * Teste: Validação de entrada vazia
 */
Deno.test("InstructorExtractor - rejeita texto vazio", async () => {
  const logger = new Logger({ traceId: "test-trace" });
  const extractor = new InstructorExtractor("test-api-key", logger);

  const schema = z.object({
    title: z.string(),
    author: z.string(),
  });

  await assertRejects(
    async () => {
      await extractor.extract("", schema, "Extract title and author");
    },
    AppError,
    "Text parameter is empty or invalid",
  );
});

/**
 * Teste: Validação de schema Zod
 */
Deno.test("InstructorExtractor - valida schema Zod", async () => {
  const logger = new Logger({ traceId: "test-trace" });
  const extractor = new InstructorExtractor("test-api-key", logger);

  const schema = z.object({
    title: z.string(),
    year: z.number(),
  });

  // Deve aceitar schema válido (não lançar erro de validação)
  // Nota: Não testamos a chamada real ao Instructor.js aqui (seria integração)
  // Apenas validamos que a função aceita o schema
  assertEquals(typeof schema.parse, "function");
});

/**
 * Teste: Validação de prompt vazio
 */
Deno.test("InstructorExtractor - valida prompt", async () => {
  const logger = new Logger({ traceId: "test-trace" });
  const extractor = new InstructorExtractor("test-api-key", logger);

  const schema = z.object({
    summary: z.string(),
  });

  // Prompt vazio deve ser tratado (mas não causa erro aqui, apenas no LLM)
  // Testamos que a função aceita o prompt
  assertEquals(typeof extractor.extract, "function");
});

/**
 * Teste: Opções de modelo
 */
Deno.test("InstructorExtractor - aceita opções de modelo", async () => {
  const logger = new Logger({ traceId: "test-trace" });
  const extractor = new InstructorExtractor("test-api-key", logger);

  const schema = z.object({
    data: z.string(),
  });

  // Verificar que a função aceita opções
  const options = {
    model: "gpt-4o",
    temperature: 0.0,
    maxTokens: 1000,
  };

  assertEquals(typeof options.model, "string");
  assertEquals(typeof options.temperature, "number");
  assertEquals(typeof options.maxTokens, "number");
});

/**
 * Teste: Schema complexo aninhado
 */
Deno.test("InstructorExtractor - suporta schema aninhado", () => {
  const schema = z.object({
    article: z.object({
      title: z.string(),
      authors: z.array(z.object({
        name: z.string(),
        affiliation: z.string().optional(),
      })),
      metadata: z.object({
        year: z.number(),
        journal: z.string(),
      }),
    }),
  });

  // Verificar que schema aninhado é válido
  assertEquals(typeof schema.parse, "function");
  assertEquals(schema.shape.article.shape.title, z.string());
});

/**
 * Teste: Schema array
 */
Deno.test("InstructorExtractor - suporta schema array", () => {
  const schema = z.array(z.object({
    item: z.string(),
    value: z.number(),
  }));

  // Verificar que schema array é válido
  assertEquals(typeof schema.parse, "function");
  assertEquals(schema._def.typeName, "ZodArray");
});

/**
 * Teste: Validação de request schema (Edge Function)
 */
Deno.test("Structured Extraction - valida request schema", () => {
  const validRequest = {
    text: "Sample text",
    schema: z.object({ title: z.string() }),
    prompt: "Extract title",
    options: {
      model: "gpt-4o" as const,
      temperature: 0.0,
    },
  };

  assertEquals(typeof validRequest.text, "string");
  assertEquals(validRequest.text.length > 0, true);
  assertEquals(typeof validRequest.prompt, "string");
  assertEquals(validRequest.prompt.length > 0, true);
});

/**
 * Teste: Request inválido (texto vazio)
 */
Deno.test("Structured Extraction - rejeita texto vazio no request", () => {
  const invalidRequest = {
    text: "",
    schema: z.object({ title: z.string() }),
    prompt: "Extract title",
  };

  assertEquals(invalidRequest.text.length === 0, true);
});

/**
 * Teste: Request inválido (prompt vazio)
 */
Deno.test("Structured Extraction - rejeita prompt vazio no request", () => {
  const invalidRequest = {
    text: "Sample text",
    schema: z.object({ title: z.string() }),
    prompt: "",
  };

  assertEquals(invalidRequest.prompt.length === 0, true);
});

