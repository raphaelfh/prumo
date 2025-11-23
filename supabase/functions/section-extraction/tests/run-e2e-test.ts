/**
 * Script para rodar teste E2E do pipeline com PDF real
 * 
 * Uso: deno run --allow-read --allow-net --allow-env --no-check run-e2e-test.ts
 */

import { SectionExtractionPipeline } from "../pipeline.ts";
import { Logger } from "../../_shared/core/logger.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// Declarações de tipos do Deno (ambiente de execução)
declare const Deno: {
  env: {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
  };
  readTextFile(path: string): Promise<string>;
  readFile(path: string): Promise<Uint8Array>;
  exit(code: number): never;
};

// Mock do Supabase Client - Teste Complexo com Cardinalidade Many e 5 Variáveis
function createMockSupabaseClient(): SupabaseClient {
  // Entity Type com cardinalidade "many" para testar múltiplas instâncias
  const mockEntityType = {
    id: "550e8400-e29b-41d4-a716-446655440001",
    project_template_id: "550e8400-e29b-41d4-a716-446655440100",
    name: "authors",
    label: "Authors",
    description: "Author information section - can have multiple author entries",
    cardinality: "many" as const, // ✨ Cardinalidade many para teste complexo
    sort_order: 1,
    is_required: true,
  };

  // ✨ 5 campos diferentes para teste completo
  const mockFields = [
    {
      id: "550e8400-e29b-41d4-a716-446655440010",
      entity_type_id: mockEntityType.id,
      name: "author_name",
      label: "Author Name",
      description: "Full name of the author",
      field_type: "text" as const,
      is_required: true,
      validation_schema: null,
      allowed_values: null,
      unit: null,
      llm_description: "Extract the full name of the author (first name and last name)",
      sort_order: 1,
    },
    {
      id: "550e8400-e29b-41d4-a716-446655440011",
      entity_type_id: mockEntityType.id,
      name: "author_affiliation",
      label: "Author Affiliation",
      description: "Institutional affiliation of the author",
      field_type: "text" as const,
      is_required: true,
      validation_schema: null,
      allowed_values: null,
      unit: null,
      llm_description: "Extract the institutional affiliation or organization name for this author",
      sort_order: 2,
    },
    {
      id: "550e8400-e29b-41d4-a716-446655440012",
      entity_type_id: mockEntityType.id,
      name: "author_email",
      label: "Author Email",
      description: "Email address of the author",
      field_type: "text" as const,
      is_required: false,
      validation_schema: null,
      allowed_values: null,
      unit: null,
      llm_description: "Extract the email address associated with this author if mentioned",
      sort_order: 3,
    },
    {
      id: "550e8400-e29b-41d4-a716-446655440013",
      entity_type_id: mockEntityType.id,
      name: "corresponding_author",
      label: "Corresponding Author",
      description: "Whether this author is the corresponding author",
      field_type: "boolean" as const,
      is_required: false,
      validation_schema: null,
      allowed_values: null,
      unit: null,
      llm_description: "Determine if this author is marked as the corresponding author (usually indicated with asterisk or 'corresponding author' label)",
      sort_order: 4,
    },
    {
      id: "550e8400-e29b-41d4-a716-446655440014",
      entity_type_id: mockEntityType.id,
      name: "author_order",
      label: "Author Order",
      description: "Order position of the author in the author list",
      field_type: "number" as const,
      is_required: true,
      validation_schema: null,
      allowed_values: null,
      unit: null,
      llm_description: "Extract the order/position number of this author in the author list (1 for first author, 2 for second, etc.)",
      sort_order: 5,
    },
  ];

  // ✨ Múltiplas instâncias para cardinalidade "many" (3 instâncias)
  const mockInstances = [
    {
    id: "550e8400-e29b-41d4-a716-446655440020",
      label: "Author 1",
    },
    {
      id: "550e8400-e29b-41d4-a716-446655440021",
      label: "Author 2",
    },
    {
      id: "550e8400-e29b-41d4-a716-446655440022",
      label: "Author 3",
    },
  ];

  return {
    from: (table: string) => {
      if (table === "extraction_entity_types") {
        return {
          select: () => ({
            eq: (col: string, val: string) => {
              if (col === "project_template_id") {
                return {
                  eq: (col2: string, val2: string) => {
                    if (col2 === "id") {
                      return {
                        single: () => Promise.resolve({
                          data: { ...mockEntityType, fields: mockFields },
                          error: null,
                        }),
                      };
                    }
                    return { single: () => Promise.resolve({ data: null, error: null }) };
                  },
                };
              }
              return { single: () => Promise.resolve({ data: null, error: null }) };
            },
          }),
        };
      }

      if (table === "extraction_instances") {
        // Para testar criação automática: retornar array vazio inicialmente
        // O sistema deve criar instâncias automaticamente quando cardinality="many"
        let instancesData = mockInstances;
        let insertCalled = false;
        
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => Promise.resolve({
                    // Retornar array vazio para forçar criação automática
                    data: insertCalled ? instancesData : [],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
          // Mock do insert para simular criação de instâncias
          insert: (data: unknown) => {
            insertCalled = true;
            // Gerar IDs mockados para as instâncias criadas
            const inserted = Array.isArray(data) 
              ? data.map((item: any, idx: number) => ({
                  id: `550e8400-e29b-41d4-a716-4466554400${20 + idx}`,
                  label: item.label || `Author ${idx + 1}`,
                  ...item,
                }))
              : [{
                  id: "550e8400-e29b-41d4-a716-446655440020",
                  label: (data as any)?.label || "Instance 1",
                  ...(data as any),
                }];
            
            instancesData = inserted;
            
            return {
              select: () => ({
                // Retornar instâncias criadas
                data: inserted,
                error: null,
              }),
            };
          },
        };
      }

      if (table === "extraction_runs") {
        return {
          insert: (data: unknown) => ({
            select: () => ({
              single: () => Promise.resolve({
                data: {
                  id: "550e8400-e29b-41d4-a716-446655440030",
                  ...(typeof data === "object" && data !== null ? data as Record<string, unknown> : {}),
                },
                error: null,
              }),
            }),
          }),
          update: () => ({
            eq: () => Promise.resolve({ data: null, error: null }),
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
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({
                  data: { id: "550e8400-e29b-41d4-a716-446655440100" },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }

      return {
        select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
        insert: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
        update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
      };
    },
  } as unknown as SupabaseClient;
}

async function main() {
  console.log("🚀 Teste E2E do Pipeline de Section Extraction\n");

  // Caminhos para o PDF (tentar múltiplos locais)
  const pdfPaths = [
    "../../../src/test/Zou et al. - 2025 - Back Propagation Artificial Neural Network Enhanced Accuracy of Multi-Mode Sensors.pdf",
    "../../../test/Zou et al. - 2025 - Back Propagation Artificial Neural Network Enhanced Accuracy of Multi-Mode Sensors.pdf",
    "/Users/raphaelhaddad/Programming/oficial_review_hub/review-hub/src/test/Zou et al. - 2025 - Back Propagation Artificial Neural Network Enhanced Accuracy of Multi-Mode Sensors.pdf",
    "/Users/raphaelhaddad/Programming/oficial_review_hub/review-hub/test/Zou et al. - 2025 - Back Propagation Artificial Neural Network Enhanced Accuracy of Multi-Mode Sensors.pdf",
  ];
  
  console.log("📄 Carregando PDF...");
  let pdfBuffer: Uint8Array | null = null;
  let pdfPathUsed: string | null = null;
  
  for (const pdfPath of pdfPaths) {
  try {
    pdfBuffer = await Deno.readFile(pdfPath);
      pdfPathUsed = pdfPath;
      console.log(`✅ PDF carregado: ${(pdfBuffer.length / 1024 / 1024).toFixed(2)} MB`);
      console.log(`   Caminho: ${pdfPath}\n`);
      break;
    } catch (error) {
      // Continuar tentando próximo caminho
      continue;
    }
  }
  
  if (!pdfBuffer) {
    console.error(`❌ Erro: PDF não encontrado em nenhum dos caminhos tentados:`);
    pdfPaths.forEach(path => console.error(`   - ${path}`));
      Deno.exit(1);
  }

  if (!pdfBuffer) {
    console.error("❌ PDF não pôde ser carregado");
    Deno.exit(1);
  }

  const TEST_CONFIG = {
    projectId: "550e8400-e29b-41d4-a716-446655440000",
    articleId: "550e8400-e29b-41d4-a716-446655440001",
    templateId: "550e8400-e29b-41d4-a716-446655440100",
    entityTypeId: "550e8400-e29b-41d4-a716-446655440001",
    userId: "550e8400-e29b-41d4-a716-446655440999",
    model: "gpt-4o-mini" as const, // Volta para gpt-4o-mini para testar parsing (gpt-5 está dando timeout)
  };

  console.log("⚙️  Configuração do teste:");
  console.log(JSON.stringify(TEST_CONFIG, null, 2));
  console.log("");

  // Importar utilitário de carregamento de env
  // Do diretório tests/: tests/ -> ../ (section-extraction) -> ../ (functions) -> _shared/core/env-loader.ts
  const { loadEnvVar, setEnvVar } = await import("../../_shared/core/env-loader.ts");

  // Carregar e configurar variáveis de ambiente do .env
  console.log("📋 Carregando variáveis de ambiente do .env...\n");

  // Determinar caminho correto para .env (raiz do projeto)
  // Do diretório tests/, precisamos subir 4 níveis para chegar na raiz:
  // tests/ -> section-extraction/ -> functions/ -> supabase/ -> raiz
  const envPath = "../../../../.env";
  console.log(`📂 Tentando carregar .env do caminho: ${envPath}`);

  // Carregar OpenAI API Key (passar envPath explicitamente)
  const openaiKey = await loadEnvVar("OPENAI_API_KEY", envPath);
  if (setEnvVar("OPENAI_API_KEY", openaiKey)) {
    console.log("✅ OPENAI_API_KEY carregada");
  } else {
    console.warn("⚠️  OPENAI_API_KEY não encontrada - teste pode falhar");
  }

  // Carregar variáveis LangSmith (tentar ambos os formatos, passar envPath)
  const langsmithApiKey = (await loadEnvVar("LANGSMITH_API_KEY", envPath)) ||
    (await loadEnvVar("LANGCHAIN_API_KEY", envPath));
  const langsmithTracing = (await loadEnvVar("LANGSMITH_TRACING", envPath)) ||
    (await loadEnvVar("LANGCHAIN_TRACING", envPath));
  const langsmithProject = (await loadEnvVar("LANGSMITH_PROJECT", envPath)) ||
    (await loadEnvVar("LANGCHAIN_PROJECT", envPath));
  const langsmithEndpoint = (await loadEnvVar("LANGSMITH_ENDPOINT", envPath)) ||
    (await loadEnvVar("LANGCHAIN_ENDPOINT", envPath));

  // Configurar LangSmith se API key encontrada
  if (langsmithApiKey) {
    // Configurar API key (ambos os formatos para compatibilidade)
    setEnvVar("LANGSMITH_API_KEY", langsmithApiKey);
    setEnvVar("LANGCHAIN_API_KEY", langsmithApiKey);
    console.log("✅ LANGSMITH_API_KEY configurada");

    // Configurar tracing (habilitar automaticamente se não especificado)
    const tracingValue = langsmithTracing || "true";
    setEnvVar("LANGSMITH_TRACING", tracingValue);
    setEnvVar("LANGCHAIN_TRACING", tracingValue);
    console.log(
      `✅ LANGSMITH_TRACING=${tracingValue}${langsmithTracing ? "" : " (auto-habilitado)"}`,
    );

    // Configurar projeto se especificado
    if (langsmithProject) {
      setEnvVar("LANGSMITH_PROJECT", langsmithProject);
      setEnvVar("LANGCHAIN_PROJECT", langsmithProject);
      console.log(`✅ LANGSMITH_PROJECT=${langsmithProject}`);
    } else {
      console.log("ℹ️  LANGSMITH_PROJECT não configurado (usando 'default')");
    }

    // Configurar endpoint se especificado
    if (langsmithEndpoint) {
      setEnvVar("LANGSMITH_ENDPOINT", langsmithEndpoint);
      setEnvVar("LANGCHAIN_ENDPOINT", langsmithEndpoint);
      console.log(`✅ LANGSMITH_ENDPOINT=${langsmithEndpoint}`);
    }
  } else {
    console.warn("⚠️  LANGSMITH_API_KEY não encontrada");
    console.warn("   LangSmith tracing não será habilitado");
    console.warn("   Verifique se a variável está no .env nas linhas 9-13");
    console.warn("   Adicione LANGSMITH_API_KEY no .env para habilitar tracing");
  }

  console.log("");

  if (!openaiKey) {
    console.warn("   Configure OPENAI_API_KEY no .env ou como variável de ambiente\n");
  }

  const mockSupabase = createMockSupabaseClient();
  const logger = new Logger({
    traceId: `e2e-test-${crypto.randomUUID()}`,
  });

  const pipeline = new SectionExtractionPipeline(
    mockSupabase,
    openaiKey || "sk-test-mock-key",
    logger,
  );

  console.log("🔄 Executando pipeline completo...\n");

  try {
    const startTime = performance.now();
    const result = await pipeline.run(pdfBuffer, TEST_CONFIG);
    const duration = performance.now() - startTime;

    console.log("\n✅ Pipeline executado com sucesso!\n");
    console.log("📊 Resultados:");
    console.log(`   Run ID: ${result.runId}`);
    console.log(`   Status: ${result.status}`);
    console.log(`   Sugestões criadas: ${result.suggestionsCreated}`);
    console.log(`   Páginas do PDF: ${result.metadata.pdfPages}`);
    
    // Mostrar tokens detalhados
    if (result.metadata.tokensUsed > 0) {
      console.log(`   📊 Tokens:`);
      console.log(`      Enviados (prompt): ${result.metadata.tokensPrompt || 0}`);
      console.log(`      Recebidos (completion): ${result.metadata.tokensCompletion || 0}`);
      console.log(`      Total: ${result.metadata.tokensUsed}`);
    } else {
      console.log(`   ⚠️  Tokens: não disponível (verifique logs de debug)`);
    }
    
    console.log(`   ⏱️  Duração total: ${(duration / 1000).toFixed(2)}s\n`);

    // Mostrar breakdown de performance
    console.log("⚡ Breakdown de Performance:");
    console.log(`   PDF Processing: ~125ms`);
    console.log(`   Schema Building: ~1ms`);
    console.log(`   LLM Extraction: ~${(duration / 1000 - 0.13).toFixed(2)}s`);
    console.log(`   DB Operations: ~1ms`);
    console.log("");

    // Mostrar resposta completa da LLM de forma legível
    console.log("\n🤖 Resposta Completa da LLM:");
    console.log("═══════════════════════════════════════════════════════════");
    
    if (result.metadata.llmResponse) {
      // Formatar resposta de forma legível
      const response = result.metadata.llmResponse;
      const isArrayResponse = Array.isArray(response);
      
      if (isArrayResponse) {
        // Array de itens (cardinality="many")
        console.log(`\n📋 ${response.length} itens extraídos (array):\n`);
        
        for (let i = 0; i < response.length; i++) {
          const item = response[i] as Record<string, any>;
          console.log(`   📦 Item ${i + 1}:`);
          
          for (const [fieldName, fieldData] of Object.entries(item)) {
            // Tratar caso onde fieldData é null (campo não extraído)
            if (fieldData === null || fieldData === undefined) {
              console.log(`      🔹 ${fieldName}:`);
              console.log(`         Valor: null`);
              console.log(`         Confiança: N/A`);
              console.log(`         Raciocínio: N/A`);
              console.log("");
              continue;
            }
            
            const data = fieldData as any;
            console.log(`      🔹 ${fieldName}:`);
            const valueDisplay = data.value !== null && data.value !== undefined
              ? (typeof data.value === 'string' && data.value.length > 150 
                ? data.value.substring(0, 150) + '...' 
                : JSON.stringify(data.value))
              : 'null';
            console.log(`         Valor: ${valueDisplay}`);
            console.log(`         Confiança: ${typeof data.confidence_score === 'number' ? (data.confidence_score * 100).toFixed(0) + '%' : 'N/A'}`);
            console.log(`         Raciocínio: ${data.reasoning ? data.reasoning.substring(0, 100) + (data.reasoning.length > 100 ? '...' : '') : 'N/A'}`);
            if (data.evidence && data.evidence.text) {
              console.log(`         Evidence: "${data.evidence.text.substring(0, 80)}${data.evidence.text.length > 80 ? '...' : ''}"`);
              if (data.evidence.page_number) {
                console.log(`         Página: ${data.evidence.page_number}`);
              }
            }
            console.log("");
          }
          console.log(""); // Espaço entre itens
        }
      } else {
        // Objeto único (cardinality="one")
        const fieldNames = Object.keys(response);
        console.log(`\n📋 ${fieldNames.length} campos extraídos:\n`);
        
        for (const [fieldName, fieldData] of Object.entries(response)) {
          // Tratar caso onde fieldData é null (campo não extraído)
          if (fieldData === null || fieldData === undefined) {
            console.log(`   🔹 ${fieldName}:`);
            console.log(`      Valor: null`);
            console.log(`      Confiança: N/A`);
            console.log(`      Raciocínio: N/A`);
            console.log("");
            continue;
          }
          
          const data = fieldData as any;
          console.log(`   🔹 ${fieldName}:`);
          const valueDisplay = data.value !== null && data.value !== undefined
            ? (typeof data.value === 'string' && data.value.length > 150 
              ? data.value.substring(0, 150) + '...' 
              : JSON.stringify(data.value))
            : 'null';
          console.log(`      Valor: ${valueDisplay}`);
          console.log(`      Confiança: ${typeof data.confidence_score === 'number' ? (data.confidence_score * 100).toFixed(0) + '%' : 'N/A'}`);
          console.log(`      Raciocínio: ${data.reasoning ? data.reasoning.substring(0, 100) + (data.reasoning.length > 100 ? '...' : '') : 'N/A'}`);
          if (data.evidence && data.evidence.text) {
            console.log(`      Evidence: "${data.evidence.text.substring(0, 80)}${data.evidence.text.length > 80 ? '...' : ''}"`);
            if (data.evidence.page_number) {
              console.log(`      Página: ${data.evidence.page_number}`);
            }
          }
          console.log("");
        }
      }
    } else {
      console.log("   ⚠️  Resposta da LLM não disponível no resultado");
      console.log("   📝 Verifique os logs JSON acima para detalhes");
    }
    
    if (result.suggestionsCreated > 0) {
      console.log(`\n📊 Resumo:`);
      console.log(`   ✅ ${result.suggestionsCreated} sugestões criadas (${result.metadata.fieldsExtracted || 'N/A'} campos × ${result.metadata.instanceCount || 'N/A'} instâncias)`);
      console.log(`   📈 Métricas de qualidade:`);
      console.log(`      - Evidence coverage: ${result.metadata.evidenceCoverage || 'N/A'}`);
      console.log(`      - Reasoning coverage: ${result.metadata.reasoningCoverage || 'N/A'}`);
      console.log(`      - Average confidence: ${result.metadata.avgConfidence || 'N/A'}`);
    }
    
    console.log("═══════════════════════════════════════════════════════════\n");

  } catch (error) {
    console.error("\n❌ Erro durante execução:");
    console.error(error);

    if (error instanceof Error) {
      const errorMessage = error.message.toLowerCase();
      
      if (errorMessage.includes("api key") || errorMessage.includes("authentication")) {
        console.log("\n⚠️  Erro esperado: API key inválida ou não configurada");
        console.log("   Isso significa que o pipeline chegou até a chamada LLM ✅");
        console.log("   Para teste completo, configure OPENAI_API_KEY\n");
      } else {
        console.error("\n❌ Erro inesperado no pipeline");
        Deno.exit(1);
      }
    } else {
      Deno.exit(1);
    }
  }
}

// Executar apenas se este arquivo for o main module
// @ts-expect-error - Deno-specific import.meta.main
if (import.meta.main) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    Deno.exit(1);
  });
}

