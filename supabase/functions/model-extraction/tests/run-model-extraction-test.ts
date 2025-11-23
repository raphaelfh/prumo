/**
 * Script para rodar teste E2E do pipeline de extração de modelos com PDF real
 * 
 * Uso: deno run --allow-read --allow-net --allow-env --no-check run-model-extraction-test.ts [path-to-pdf]
 * 
 * Variáveis de ambiente opcionais:
 * - MODEL: modelo LLM a usar (gpt-4o-mini, gpt-4o, gpt-5) - padrão: gpt-4o-mini
 * - OPENAI_API_KEY: chave da API OpenAI (ou usar .env)
 */

import { ModelExtractionPipeline } from "../pipeline.ts";
import { Logger } from "../../_shared/core/logger.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// Declarações de tipos do Deno
declare const Deno: {
  env: {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
  };
  readFile(path: string): Promise<Uint8Array>;
  args: string[];
  exit(code: number): never;
};

/**
 * Mock do Supabase Client para teste E2E
 * Nota: Em produção, usar cliente real conectado ao Supabase
 */
function createMockSupabaseClient(): SupabaseClient {
  // Entity Type "prediction_models"
  const mockEntityType = {
    id: "550e8400-e29b-41d4-a716-446655440100",
    project_template_id: "550e8400-e29b-41d4-a716-446655440100",
    name: "prediction_models",
    label: "Prediction Models",
    description: "Prediction models used in the study",
    cardinality: "one" as const,
    sort_order: 1,
    is_required: true,
  };

  // Campos do entity type
  const mockFields = [
    {
      id: "550e8400-e29b-41d4-a716-446655440101",
      entity_type_id: mockEntityType.id,
      name: "model_name",
      label: "Model Name",
      field_type: "text" as const,
      is_required: true,
      llm_description: "Name of the prediction model",
    },
    {
      id: "550e8400-e29b-41d4-a716-446655440102",
      entity_type_id: mockEntityType.id,
      name: "modelling_method",
      label: "Modelling Method",
      field_type: "text" as const,
      is_required: false,
      llm_description: "Method used for modelling",
    },
  ];

  // Child entity types
  const mockChildEntityType = {
    id: "550e8400-e29b-41d4-a716-446655440103",
    project_template_id: "550e8400-e29b-41d4-a716-446655440100",
    parent_entity_type_id: mockEntityType.id,
    name: "model_variables",
    label: "Model Variables",
    cardinality: "one" as const,
    sort_order: 1,
  };

  return {
    from: (table: string) => {
      if (table === "extraction_entity_types") {
        return {
          select: (columns: string) => ({
            eq: (col: string, val: any) => {
              if (col === "project_template_id") {
                return {
                  eq: (col2: string, val2: any) => {
                    if (col2 === "name" && val2 === "prediction_models") {
                      return {
                        maybeSingle: () => Promise.resolve({
                          data: mockEntityType,
                          error: null,
                        }),
                      };
                    }
                    if (col2 === "parent_entity_type_id" && val2 === mockEntityType.id) {
                      return {
                        order: () => Promise.resolve({
                          data: [mockChildEntityType],
                          error: null,
                        }),
                      };
                    }
                    return {
                      maybeSingle: () => Promise.resolve({ data: null, error: null }),
                      order: () => Promise.resolve({ data: [], error: null }),
                    };
                  },
                };
              }
              return {
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: null, error: null }),
                  order: () => Promise.resolve({ data: [], error: null }),
                }),
              };
            },
          }),
        };
      }

      if (table === "extraction_fields") {
        return {
          select: (columns: string) => ({
            eq: (col: string, val: any) => {
              if (col === "entity_type_id" && val === mockEntityType.id) {
                return {
                  order: () => Promise.resolve({
                    data: mockFields,
                    error: null,
                  }),
                };
              }
              return {
                order: () => Promise.resolve({ data: [], error: null }),
              };
            },
          }),
        };
      }

      if (table === "extraction_instances") {
        return {
          select: (columns: string) => ({
            eq: (col: string, val: any) => ({
              eq: (col2: string, val2: any) => ({
                order: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          }),
          insert: (data: any) => {
            const inserted = Array.isArray(data) ? data : [data];
            const insertedWithIds = inserted.map((item, idx) => ({
              ...item,
              id: `instance-${Date.now()}-${idx}`,
              created_at: new Date().toISOString(),
            }));
            return {
              select: (columns: string) => {
                if (inserted.length === 1) {
                  return {
                    single: () => Promise.resolve({
                      data: insertedWithIds[0],
                      error: null,
                    }),
                  };
                }
                return Promise.resolve({
                  data: insertedWithIds,
                  error: null,
                });
              },
            };
          },
        };
      }

      if (table === "extraction_runs") {
        return {
          insert: (data: any) => ({
            select: (columns: string) => ({
              single: () => Promise.resolve({
                data: {
                  id: `run-${Date.now()}`,
                  ...data,
                },
                error: null,
              }),
            }),
          }),
          update: (data: any) => ({
            eq: (col: string, val: any) => Promise.resolve({
              data: null,
              error: null,
            }),
          }),
        };
      }

      if (table === "ai_suggestions") {
        return {
          insert: (data: any) => {
            const inserted = Array.isArray(data) ? data : [data];
            return Promise.resolve({
              data: inserted.map((item, idx) => ({
                ...item,
                id: `suggestion-${Date.now()}-${idx}`,
              })),
              error: null,
            });
          },
        };
      }

      return {} as any;
    },
  } as unknown as SupabaseClient;
}

/**
 * Carregar PDF do arquivo
 */
async function loadPDF(path: string): Promise<Uint8Array> {
  try {
    const buffer = await Deno.readFile(path);
    console.log(`✅ PDF carregado: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);
    return buffer;
  } catch (error: any) {
    console.error(`❌ Erro ao carregar PDF: ${error.message}`);
    Deno.exit(1);
  }
}

/**
 * Função principal
 */
async function main() {
  console.log("\n🚀 Teste E2E - Extração de Modelos de Predição\n");

  // 1. Carregar PDF
  const pdfPath = Deno.args[0] || "./test-pdf.pdf";
  console.log(`📄 Carregando PDF: ${pdfPath}`);
  const pdfBuffer = await loadPDF(pdfPath);

  // 2. Configuração
  const model = (Deno.env.get("MODEL") || "gpt-4o-mini") as "gpt-4o-mini" | "gpt-4o" | "gpt-5";
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  
  if (!openaiKey) {
    console.error("❌ OPENAI_API_KEY não configurada. Configure a variável de ambiente.");
    Deno.exit(1);
  }

  const config = {
    projectId: "550e8400-e29b-41d4-a716-446655440000",
    articleId: "550e8400-e29b-41d4-a716-446655440001",
    templateId: "550e8400-e29b-41d4-a716-446655440100",
    userId: "550e8400-e29b-41d4-a716-446655440999",
    model,
  };

  console.log("\n📊 Configuração:");
  console.log(`   Modelo LLM: ${config.model}`);
  console.log(`   Project ID: ${config.projectId}`);
  console.log(`   Article ID: ${config.articleId}`);
  console.log(`   Template ID: ${config.templateId}\n`);

  // 3. Criar componentes
  console.log("🔧 Criando componentes...");
  const logger = new Logger({
    traceId: `e2e-test-${Date.now()}`,
    testRun: true,
  });
  const mockSupabase = createMockSupabaseClient();
  const pipeline = new ModelExtractionPipeline(mockSupabase, openaiKey, logger);
  console.log("✅ Componentes criados\n");

  // 4. Executar pipeline
  console.log("🔄 Executando pipeline de extração de modelos...\n");
  const startTime = performance.now();

  try {
    const result = await pipeline.run(pdfBuffer, config);
    const duration = performance.now() - startTime;

    // 5. Exibir resultados
    console.log("\n" + "=".repeat(60));
    console.log("✅ EXTRAÇÃO CONCLUÍDA");
    console.log("=".repeat(60));
    console.log(`\n📋 Run ID: ${result.runId}`);
    console.log(`\n🎯 Modelos Encontrados: ${result.modelsCreated.length}`);
    
    if (result.modelsCreated.length > 0) {
      console.log("\n📦 Modelos Criados:");
      result.modelsCreated.forEach((model, idx) => {
        console.log(`\n   ${idx + 1}. ${model.modelName}`);
        console.log(`      Instance ID: ${model.instanceId}`);
        if (model.modellingMethod) {
          console.log(`      Método: ${model.modellingMethod}`);
        }
      });
    }

    console.log(`\n📊 Child Instances Criadas: ${result.childInstancesCreated}`);
    console.log(`\n💡 Métricas:`);
    console.log(`   Tokens (Prompt): ${result.metadata.tokensPrompt}`);
    console.log(`   Tokens (Completion): ${result.metadata.tokensCompletion}`);
    console.log(`   Tokens (Total): ${result.metadata.tokensUsed}`);
    console.log(`   Duração: ${(result.metadata.duration / 1000).toFixed(2)}s`);
    console.log(`   Duração (medida): ${(duration / 1000).toFixed(2)}s`);

    console.log("\n" + "=".repeat(60));
    console.log("✅ Teste concluído com sucesso!");
    console.log("=".repeat(60) + "\n");

  } catch (error: any) {
    console.error("\n❌ Erro durante extração:");
    console.error(error.message);
    if (error.stack) {
      console.error("\nStack trace:");
      console.error(error.stack);
    }
    Deno.exit(1);
  }
}

// Executar
main().catch((error) => {
  console.error("❌ Erro fatal:", error);
  Deno.exit(1);
});

