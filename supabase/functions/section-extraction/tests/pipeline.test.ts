/**
 * Testes unitários para SectionExtractionPipeline
 */

import { assertEquals, assertRejects } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { SectionExtractionPipeline } from "./pipeline.ts";
import { AppError, ErrorCode } from "../_shared/core/error-handler.ts";
import { Logger } from "../_shared/core/logger.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// Mock do Supabase client para testes
function createMockSupabaseClient(): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              order: () => Promise.resolve({
                data: [{ id: "instance-1", label: "Instance 1" }],
                error: null,
              }),
            }),
          }),
        }),
      }),
      insert: () => ({
        select: () => ({
          single: () => Promise.resolve({
            data: { id: "run-123" },
            error: null,
          }),
        }),
      }),
      update: () => ({
        eq: () => Promise.resolve({ data: null, error: null }),
      }),
    }),
  } as unknown as SupabaseClient;
}

Deno.test("SectionExtractionPipeline - buildFieldMapping cria mapeamento correto", () => {
  const logger = new Logger({ traceId: "test-trace" });
  const pipeline = new SectionExtractionPipeline(
    createMockSupabaseClient(),
    "test-api-key",
    logger,
  );

  const fields = [
    { id: "field-1", name: "title" },
    { id: "field-2", name: "author" },
  ];
  const instances = [
    { id: "instance-1" },
    { id: "instance-2" },
  ];

  // Usar reflection para acessar método privado (para teste apenas)
  const mapping = (pipeline as any).buildFieldMapping(fields, instances);

  assertEquals(mapping.size, 2);
  assertEquals(mapping.has("title"), true);
  assertEquals(mapping.has("author"), true);

  // Cada campo deve mapear para todas as instâncias
  const titleMappings = mapping.get("title");
  assertEquals(titleMappings?.length, 2);
  assertEquals(titleMappings?.[0].instanceId, "instance-1");
  assertEquals(titleMappings?.[0].fieldId, "field-1");
  assertEquals(titleMappings?.[1].instanceId, "instance-2");
  assertEquals(titleMappings?.[1].fieldId, "field-1");
});

Deno.test("SectionExtractionPipeline - buildFieldMapping vazio com campos vazios", () => {
  const logger = new Logger({ traceId: "test-trace" });
  const pipeline = new SectionExtractionPipeline(
    createMockSupabaseClient(),
    "test-api-key",
    logger,
  );

  const mapping = (pipeline as any).buildFieldMapping([], []);

  assertEquals(mapping.size, 0);
});

