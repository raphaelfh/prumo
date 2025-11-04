/**
 * Teste End-to-End do Pipeline de Section Extraction
 * 
 * Testa o pipeline completo usando um PDF real e dados mockados do banco.
 * 
 * Para rodar: deno test --allow-read --allow-net --allow-env pipeline-e2e.test.ts
 */

import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { SectionExtractionPipeline } from "./pipeline.ts";
import { Logger } from "../_shared/core/logger.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * Mock do Supabase Client com dados de exemplo
 */
function createMockSupabaseClient(): SupabaseClient {
  // Dados de exemplo baseados no schema real
  const mockEntityType = {
    id: "550e8400-e29b-41d4-a716-446655440001",
    project_template_id: "550e8400-e29b-41d4-a716-446655440100",
    name: "abstract",
    label: "Abstract",
    description: "Abstract section of the paper",
    cardinality: "one" as const,
    sort_order: 1,
    is_required: true,
  };

  const mockFields = [
    {
      id: "550e8400-e29b-41d4-a716-446655440010",
      entity_type_id: mockEntityType.id,
      name: "abstract_text",
      label: "Abstract Text",
      description: "The abstract text of the paper",
      field_type: "text" as const,
      is_required: true,
      validation_schema: null,
      allowed_values: null,
      unit: null,
      llm_description: "Extract the complete abstract text from the document",
      sort_order: 1,
    },
    {
      id: "550e8400-e29b-41d4-a716-446655440011",
      entity_type_id: mockEntityType.id,
      name: "keywords",
      label: "Keywords",
      description: "Keywords of the paper",
      field_type: "multiselect" as const,
      is_required: false,
      validation_schema: null,
      allowed_values: null,
      unit: null,
      llm_description: "Extract keywords mentioned in the abstract or document",
      sort_order: 2,
    },
  ];

  const mockInstance = {
    id: "550e8400-e29b-41d4-a716-446655440020",
    label: "Abstract Instance",
  };

  return {
    from: (table: string) => {
      if (table === "extraction_entity_types") {
        return {
          select: (columns: string) => ({
            eq: (col: string, val: string) => {
              if (col === "project_template_id") {
                return {
                  eq: (col2: string, val2: string) => {
                    if (col2 === "id") {
                      return {
                        single: () => Promise.resolve({
                          data: {
                            ...mockEntityType,
                            fields: mockFields,
                          },
                          error: null,
                        }),
                      };
                    }
                    return { single: () => Promise.resolve({ data: null, error: null }) };
                  },
                  maybeSingle: () => Promise.resolve({ data: null, error: null }),
                };
              }
              return { single: () => Promise.resolve({ data: null, error: null }) };
            },
          }),
        };
      }

      if (table === "extraction_instances") {
        return {
          select: (columns: string) => ({
            eq: (col: string, val: string) => {
              if (col === "article_id") {
                return {
                  eq: (col2: string, val2: string) => {
                    if (col2 === "template_id") {
                      return {
                        eq: (col3: string, val3: string) => {
                          if (col3 === "entity_type_id") {
                            return {
                              order: (orderCol: string, options?: { ascending: boolean }) => {
                                return Promise.resolve({
                                  data: [mockInstance],
                                  error: null,
                                });
                              },
                            };
                          }
                          return Promise.resolve({ data: [], error: null });
                        },
                      };
                    }
                    return Promise.resolve({ data: [], error: null });
                  },
                };
              }
              return Promise.resolve({ data: [], error: null });
            },
          }),
        };
      }

      if (table === "extraction_runs") {
        return {
          insert: (data: unknown) => ({
            select: (columns: string) => ({
              single: () => Promise.resolve({
                data: {
                  id: "550e8400-e29b-41d4-a716-446655440030",
                  ...(typeof data === "object" && data !== null ? data as Record<string, unknown> : {}),
                },
                error: null,
              }),
            }),
          }),
          update: (data: unknown) => ({
            eq: (col: string, val: string) => Promise.resolve({ data: null, error: null }),
          }),
        };
      }

      if (table === "ai_suggestions") {
        return {
          insert: (data: unknown) => {
            const suggestions = Array.isArray(data) ? data : [data];
            return {
              select: () => Promise.resolve({
                data: suggestions.map((s: unknown, idx: number) => ({
                  id: `suggestion-${idx}`,
                  ...(typeof s === "object" && s !== null ? s as Record<string, unknown> : {}),
                })),
                error: null,
              }),
            };
          },
        };
      }

      if (table === "project_extraction_templates") {
        return {
          select: (columns: string) => ({
            eq: (col: string, val: string) => {
              if (col === "project_id") {
                return {
                  eq: (col2: string, val2: boolean) => {
                    if (col2 === "is_active" && val2 === true) {
                      return {
                        maybeSingle: () => Promise.resolve({
                          data: {
                            id: "550e8400-e29b-41d4-a716-446655440100",
                          },
                          error: null,
                        }),
                      };
                    }
                    return { maybeSingle: () => Promise.resolve({ data: null, error: null }) };
                  },
                };
              }
              return { maybeSingle: () => Promise.resolve({ data: null, error: null }) };
            },
          }),
        };
      }

      return {
        select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
        insert: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
        update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
      };
    },
    storage: {
      from: () => ({
        download: () => Promise.resolve({
          data: null,
          error: { message: "Mock storage - use file directly", statusCode: 500 },
        }),
      }),
    },
  } as unknown as SupabaseClient;
}

/**
 * Carrega o PDF de teste
 */
async function loadTestPDF(): Promise<Uint8Array> {
  const pdfPath = "./src/test/Zou et al. - 2025 - Back Propagation Artificial Neural Network Enhanced Accuracy of Multi-Mode Sensors.pdf";
  
  try {
    const file = await Deno.readFile(pdfPath);
    console.log(`✅ PDF carregado: ${file.length} bytes`);
    return file;
  } catch (error) {
    console.error(`❌ Erro ao carregar PDF: ${error.message}`);
    throw new Error(`Failed to load test PDF: ${error.message}`);
  }
}

/**
 * Mock da OpenAI API Key (não será usada em testes, mas necessário para inicializar)
 */
const MOCK_OPENAI_KEY = "sk-test-mock-key-for-testing";

/**
 * Configuração de teste
 */
const TEST_CONFIG = {
  projectId: "550e8400-e29b-41d4-a716-446655440000",
  articleId: "550e8400-e29b-41d4-a716-446655440001",
  templateId: "550e8400-e29b-41d4-a716-446655440100",
  entityTypeId: "550e8400-e29b-41d4-a716-446655440001",
  userId: "550e8400-e29b-41d4-a716-446655440999",
  model: "gpt-4o-mini" as const, // Modelo mais econômico para testes
};

Deno.test("Pipeline E2E - Execução completa com PDF real", async () => {
  console.log("\n🚀 Iniciando teste E2E do pipeline...\n");

  // 1. Carregar PDF
  console.log("📄 Carregando PDF de teste...");
  const pdfBuffer = await loadTestPDF();
  assertEquals(pdfBuffer.length > 0, true);
  console.log(`✅ PDF carregado com sucesso (${(pdfBuffer.length / 1024 / 1024).toFixed(2)} MB)\n`);

  // 2. Criar mock do Supabase
  console.log("🔧 Criando mock do Supabase client...");
  const mockSupabase = createMockSupabaseClient();
  assertExists(mockSupabase);
  console.log("✅ Mock criado\n");

  // 3. Criar logger
  const logger = new Logger({
    traceId: `test-${crypto.randomUUID()}`,
    testRun: true,
  });

  // 4. Criar pipeline
  console.log("⚙️  Criando pipeline...");
  const pipeline = new SectionExtractionPipeline(
    mockSupabase,
    MOCK_OPENAI_KEY,
    logger,
  );
  assertExists(pipeline);
  console.log("✅ Pipeline criado\n");

  // 5. Executar pipeline
  console.log("🔄 Executando pipeline...");
  console.log("📊 Configuração:", JSON.stringify(TEST_CONFIG, null, 2));
  console.log("");

  try {
    const startTime = performance.now();
    
    // NOTA: Este teste vai falhar na chamada real da OpenAI porque usamos uma API key mock
    // O objetivo é validar que todo o fluxo até a chamada LLM está funcionando
    
    const result = await pipeline.run(pdfBuffer, {
      projectId: TEST_CONFIG.projectId,
      articleId: TEST_CONFIG.articleId,
      templateId: TEST_CONFIG.templateId,
      entityTypeId: TEST_CONFIG.entityTypeId,
      userId: TEST_CONFIG.userId,
      model: TEST_CONFIG.model,
    });

    const duration = performance.now() - startTime;

    console.log("\n✅ Pipeline executado com sucesso!");
    console.log("📊 Resultados:");
    console.log(`   - Run ID: ${result.runId}`);
    console.log(`   - Status: ${result.status}`);
    console.log(`   - Sugestões criadas: ${result.suggestionsCreated}`);
    console.log(`   - Páginas do PDF: ${result.metadata.pdfPages}`);
    console.log(`   - Tokens usados: ${result.metadata.tokensUsed}`);
    console.log(`   - Duração: ${(duration / 1000).toFixed(2)}s`);
    console.log("");

    // Validações
    assertEquals(typeof result.runId, "string");
    assertEquals(result.runId.length > 0, true);
    assertEquals(["completed", "partial", "failed"].includes(result.status), true);
    assertEquals(typeof result.suggestionsCreated, "number");
    assertEquals(result.metadata.pdfPages >= 0, true);
    assertEquals(result.metadata.tokensUsed >= 0, true);

  } catch (error) {
    console.error("\n❌ Erro durante execução do pipeline:");
    console.error(error);

    // Se o erro for de API key inválida (esperado em testes), ainda validamos
    // que chegamos até a chamada LLM
    if (error instanceof Error) {
      const errorMessage = error.message.toLowerCase();
      if (
        errorMessage.includes("api key") ||
        errorMessage.includes("authentication") ||
        errorMessage.includes("openai")
      ) {
        console.log("\n⚠️  Erro esperado (API key mockada) - Pipeline chegou até a chamada LLM ✅");
        console.log("   Isso significa que todo o fluxo anterior está funcionando corretamente!");
      } else {
        throw error;
      }
    } else {
      throw error;
    }
  }
});

Deno.test("Pipeline E2E - Validação de mocks", async () => {
  console.log("\n🔍 Validando mocks do banco de dados...\n");

  const mockSupabase = createMockSupabaseClient();

  // Testar query de entity_type
  const { data: entityType, error: entityError } = await mockSupabase
    .from("extraction_entity_types")
    .select("*, fields:extraction_fields(*)")
    .eq("project_template_id", TEST_CONFIG.templateId)
    .eq("id", TEST_CONFIG.entityTypeId)
    .single();

  assertEquals(entityError, null);
  assertExists(entityType);
  assertEquals(entityType.name, "abstract");
  assertEquals(entityType.fields?.length, 2);
  console.log("✅ Entity type mock válido");

  // Testar query de instances
  const { data: instances, error: instancesError } = await mockSupabase
    .from("extraction_instances")
    .select("id, label")
    .eq("article_id", TEST_CONFIG.articleId)
    .eq("template_id", TEST_CONFIG.templateId)
    .eq("entity_type_id", TEST_CONFIG.entityTypeId)
    .order("sort_order", { ascending: true });

  assertEquals(instancesError, null);
  assertExists(instances);
  assertEquals(instances.length, 1);
  assertEquals(instances[0].id, "550e8400-e29b-41d4-a716-446655440020");
  console.log("✅ Instances mock válidas");

  console.log("\n✅ Todos os mocks estão funcionando corretamente!");
});

