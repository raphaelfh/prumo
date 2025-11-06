/**
 * Teste para identificar problema com múltiplos inputs (cardinality="many")
 * 
 * Simula extração de autores (múltiplos) para identificar onde está falhando
 */

import { z } from "npm:zod@3.23.8";
import { InstructorExtractorAdapter } from "../../_shared/extraction/instructor-extractor-adapter.ts";
import { Logger } from "../../_shared/core/logger.ts";

// Simular schema de autores (cardinality="many") - wrapper com items
const authorsSchema = z.object({
  items: z.array(
    z.object({
      author_name: z.object({
        value: z.string(),
        confidence_score: z.number(),
        reasoning: z.string(),
        evidence: z.object({
          text: z.string(),
          page_number: z.number().optional(),
        }).optional(),
      }),
      author_email: z.object({
        value: z.string().optional(),
        confidence_score: z.number(),
        reasoning: z.string(),
        evidence: z.object({
          text: z.string(),
          page_number: z.number().optional(),
        }).optional(),
      }),
      author_order: z.object({
        value: z.number(),
        confidence_score: z.number(),
        reasoning: z.string(),
        evidence: z.object({
          text: z.string(),
          page_number: z.number().optional(),
        }).optional(),
      }),
    })
  ),
});

// Texto de exemplo com múltiplos autores
const sampleText = `
Authors:
1. John Doe (john.doe@example.com)
2. Jane Smith (jane.smith@example.com)
3. Bob Johnson (bob.johnson@example.com)

Corresponding author: John Doe
`;

const prompt = `
Extract all authors from the document. Each author should have:
- author_name: Full name
- author_email: Email address if available
- author_order: Order number (1 for first, 2 for second, etc.)

Extract ALL authors you find.
`;

async function testMultipleInputs() {
  console.log("🧪 Teste: Múltiplos inputs (cardinality='many')");
  console.log("=".repeat(60));

  const logger = new Logger({ traceId: "test-multiple-inputs" });
  const apiKey = Deno.env.get("OPENAI_API_KEY");

  if (!apiKey) {
    console.error("❌ OPENAI_API_KEY não configurada");
    Deno.exit(1);
  }

  const adapter = new InstructorExtractorAdapter(apiKey, logger);

  try {
    console.log("\n📋 Schema esperado:");
    console.log("  - Wrapper: { items: [...] }");
    console.log("  - Array de objetos com campos author_name, author_email, author_order");
    
    console.log("\n🔄 Chamando InstructorExtractorAdapter...");
    const result = await adapter.extract(sampleText, authorsSchema, prompt, {
      model: "gpt-4o-mini",
    });

    console.log("\n✅ Resultado recebido:");
    console.log("  - Tipo de data:", typeof result.data);
    console.log("  - É array?", Array.isArray(result.data));
    console.log("  - Keys do objeto:", result.data && typeof result.data === 'object' && !Array.isArray(result.data) ? Object.keys(result.data) : "N/A");
    
    // Verificar estrutura
    if (result.data && typeof result.data === 'object' && !Array.isArray(result.data)) {
      const wrapper = result.data as Record<string, any>;
      console.log("  - Tem propriedade 'items'?", 'items' in wrapper);
      if ('items' in wrapper) {
        console.log("  - items é array?", Array.isArray(wrapper.items));
        console.log("  - Quantidade de items:", Array.isArray(wrapper.items) ? wrapper.items.length : 0);
        if (Array.isArray(wrapper.items) && wrapper.items.length > 0) {
          console.log("  - Primeiro item keys:", Object.keys(wrapper.items[0]));
        }
      }
    } else if (Array.isArray(result.data)) {
      console.log("  ⚠️  PROBLEMA: Retornou array direto ao invés de wrapper { items: [...] }");
      console.log("  - Array length:", result.data.length);
    }

    console.log("\n📊 Estrutura completa (primeiros 500 chars):");
    console.log(JSON.stringify(result.data, null, 2).substring(0, 500));

    // Validar estrutura esperada
    const hasWrapper = result.data && typeof result.data === 'object' && !Array.isArray(result.data) && 'items' in result.data;
    const hasArray = Array.isArray((result.data as any)?.items);

    if (!hasWrapper) {
      console.error("\n❌ ERRO: Resultado não tem wrapper { items: [...] }");
      console.error("  - Esperado: { items: [...] }");
      console.error("  - Recebido:", typeof result.data, Array.isArray(result.data) ? "array direto" : "objeto sem 'items'");
    } else if (!hasArray) {
      console.error("\n❌ ERRO: wrapper.items não é array");
    } else {
      console.log("\n✅ Estrutura correta: { items: [...] }");
      const items = (result.data as any).items;
      console.log(`✅ Encontrados ${items.length} autores`);
    }

    console.log("\n📈 Metadata:");
    console.log("  - Model:", result.metadata.model);
    console.log("  - Tokens:", result.metadata.tokens);
    console.log("  - Duration:", result.metadata.duration.toFixed(2), "ms");

  } catch (error) {
    console.error("\n❌ Erro no teste:");
    console.error(error);
    Deno.exit(1);
  }
}

// Executar teste
if (import.meta.main) {
  await testMultipleInputs();
}

