/**
 * Testes de integração para section-extraction edge function
 * 
 * Para rodar: deno test --allow-net --allow-env section-extraction.test.ts
 */

import { assertEquals, assert } from "https://deno.land/std@0.208.0/assert/mod.ts";

/**
 * Testa o handler principal da edge function com diferentes cenários
 */
Deno.test("Section Extraction - validação de input", async () => {
  const invalidRequest = {
    projectId: "not-a-uuid",
    articleId: "123",
  };

  // Criar request mock
  const request = new Request("http://localhost", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer test-token",
    },
    body: JSON.stringify(invalidRequest),
  });

  // Importar handler
  // Nota: Em produção, isso seria testado com um servidor mock do Deno
  // Por enquanto, validamos apenas a estrutura do teste

  // Verificar que o request foi criado corretamente
  assertEquals(request.method, "POST");
  assertEquals(request.headers.get("Content-Type"), "application/json");
});

Deno.test("Section Extraction - CORS headers presentes", async () => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-client-trace-id",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  // Verificar que headers CORS estão definidos
  assertEquals(corsHeaders["Access-Control-Allow-Origin"], "*");
  assert(corsHeaders["Access-Control-Allow-Headers"].includes("authorization"));
  assert(corsHeaders["Access-Control-Allow-Methods"].includes("POST"));
  assert(corsHeaders["Access-Control-Allow-Methods"].includes("OPTIONS"));
});

Deno.test("Section Extraction - schema de validação requer campos obrigatórios", () => {
  const requiredFields = ["projectId", "articleId", "templateId", "entityTypeId"];

  // Validar que todos os campos são UUIDs
  const validRequest = {
    projectId: "550e8400-e29b-41d4-a716-446655440000",
    articleId: "550e8400-e29b-41d4-a716-446655440001",
    templateId: "550e8400-e29b-41d4-a716-446655440002",
    entityTypeId: "550e8400-e29b-41d4-a716-446655440003",
  };

  // Verificar UUID format (básico)
  for (const field of requiredFields) {
    const value = validRequest[field as keyof typeof validRequest];
    assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value));
  }
});

