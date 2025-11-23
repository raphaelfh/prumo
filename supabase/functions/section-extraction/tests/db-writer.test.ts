/**
 * Testes unitários para SectionDBWriter
 */

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { SectionDBWriter } from "./db-writer.ts";
import { Logger } from "../_shared/core/logger.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// Mock do Supabase client para testes
function createMockSupabaseClient(): SupabaseClient {
  return {
    from: () => ({
      insert: () => ({
        select: () => Promise.resolve({ data: [{ id: "test-id" }], error: null }),
      }),
      update: () => ({
        eq: () => Promise.resolve({ data: null, error: null }),
      }),
    }),
  } as unknown as SupabaseClient;
}

Deno.test("SectionDBWriter - isValidEnrichedData valida estrutura correta", () => {
  const logger = new Logger({ traceId: "test-trace" });
  const writer = new SectionDBWriter(createMockSupabaseClient(), logger);

  // Usar reflection para acessar método privado (para teste apenas)
  const isValid = (writer as any).isValidEnrichedData({
    value: "test value",
    confidence_score: 0.8,
    reasoning: "test reasoning",
  });

  assertEquals(isValid, true);
});

Deno.test("SectionDBWriter - isValidEnrichedData rejeita estrutura inválida", () => {
  const logger = new Logger({ traceId: "test-trace" });
  const writer = new SectionDBWriter(createMockSupabaseClient(), logger);

  // Teste com valor faltando
  const isValid1 = (writer as any).isValidEnrichedData({
    confidence_score: 0.8,
    reasoning: "test reasoning",
  });

  assertEquals(isValid1, false);

  // Teste com confidence_score inválido
  const isValid2 = (writer as any).isValidEnrichedData({
    value: "test",
    confidence_score: 1.5, // > 1.0
    reasoning: "test",
  });

  assertEquals(isValid2, false);

  // Teste com reasoning não-string
  const isValid3 = (writer as any).isValidEnrichedData({
    value: "test",
    confidence_score: 0.8,
    reasoning: null,
  });

  assertEquals(isValid3, false);
});

Deno.test("SectionDBWriter - isValidEnrichedData aceita evidence opcional", () => {
  const logger = new Logger({ traceId: "test-trace" });
  const writer = new SectionDBWriter(createMockSupabaseClient(), logger);

  const isValid = (writer as any).isValidEnrichedData({
    value: "test",
    confidence_score: 0.8,
    reasoning: "test",
    evidence: {
      text: "evidence text",
      page_number: 1,
    },
  });

  assertEquals(isValid, true);
});

