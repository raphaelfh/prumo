/**
 * Teste End-to-End básico para Structured Extraction
 * 
 * Testa a Edge Function completa com chamada real ao Instructor.js.
 * Este é um teste simples - use run-scenarios-test.ts para testes mais completos.
 * 
 * REQUISITOS:
 * - OPENAI_API_KEY configurada no .env
 * - Executar: deno run --allow-all --allow-env --allow-net supabase/functions/structured-extraction/tests/run-e2e-test.ts
 */

import { z } from "npm:zod@3.23.8";

/**
 * Schema de exemplo para teste
 */
const ArticleSchema = z.object({
  title: z.string().describe("Title of the article"),
  authors: z.array(z.string()).describe("List of authors"),
  year: z.number().describe("Publication year"),
  abstract: z.string().optional().describe("Abstract of the article"),
});

/**
 * Texto de exemplo
 */
const sampleText = `
Title: Machine Learning in Healthcare
Authors: John Doe, Jane Smith
Year: 2024
Abstract: This paper discusses the application of machine learning techniques in healthcare settings.
`;

/**
 * Prompt de exemplo
 */
const samplePrompt = `
Extract structured information from the following text about an academic article.
Return the title, authors, year, and abstract if available.
`;

async function runE2ETest() {
  console.log("🧪 Running E2E test for Structured Extraction...\n");

  // Verificar variável de ambiente
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    console.error("❌ OPENAI_API_KEY not found in environment");
    console.log("💡 Make sure to set OPENAI_API_KEY in supabase/.env");
    Deno.exit(1);
  }

  console.log("✅ API Key found\n");

  try {
    // Importar módulo (simular import da Edge Function)
    const { InstructorExtractor } = await import("../../_shared/extraction/instructor-extractor.ts");
    const { Logger } = await import("../../_shared/core/logger.ts");

    const logger = new Logger({ traceId: "e2e-test" });
    const extractor = new InstructorExtractor(apiKey, logger);

    console.log("📝 Testing extraction with Instructor.js...");
    console.log(`   Text length: ${sampleText.length} characters`);
    console.log(`   Schema: ArticleSchema (title, authors, year, abstract)\n`);

    const start = performance.now();

    const result = await extractor.extract(
      sampleText,
      ArticleSchema,
      samplePrompt,
      {
        model: "gpt-4o-mini", // Usar modelo mais barato para testes
        temperature: 0.0,
      },
    );

    const duration = performance.now() - start;

    console.log("✅ Extraction completed!\n");
    console.log("📊 Results:");
    console.log(JSON.stringify(result.data, null, 2));
    console.log(`\n⏱️  Duration: ${duration.toFixed(2)}ms`);
    console.log(`🤖 Model: ${result.metadata.model}\n`);

    // Validar resultado
    const validation = ArticleSchema.safeParse(result.data);
    if (validation.success) {
      console.log("✅ Schema validation passed!");
      console.log(`   Title: ${result.data.title}`);
      console.log(`   Authors: ${result.data.authors.join(", ")}`);
      console.log(`   Year: ${result.data.year}`);
      if (result.data.abstract) {
        console.log(`   Abstract: ${result.data.abstract.substring(0, 50)}...`);
      }
    } else {
      console.error("❌ Schema validation failed!");
      console.error(validation.error);
      Deno.exit(1);
    }

    console.log("\n🎉 E2E test passed successfully!");
  } catch (error) {
    console.error("❌ E2E test failed!");
    console.error(error);
    Deno.exit(1);
  }
}

// Executar teste
if (import.meta.main) {
  await runE2ETest();
}

