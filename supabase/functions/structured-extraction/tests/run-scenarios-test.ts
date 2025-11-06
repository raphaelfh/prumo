/**
 * Script para rodar testes de cenários E2E com Instructor.js
 * 
 * Testa diferentes cenários com chamadas reais à API (requer OPENAI_API_KEY).
 * 
 * Uso: deno run --allow-all --allow-env --allow-net supabase/functions/structured-extraction/tests/run-scenarios-test.ts
 */

import { z } from "npm:zod@3.23.8";
import { InstructorExtractor } from "../../_shared/extraction/instructor-extractor.ts";
import { Logger } from "../../_shared/core/logger.ts";

declare const Deno: {
  env: { get(key: string): string | undefined };
  exit(code: number): never;
};

/**
 * Cenários de teste
 */
const SCENARIOS = [
  {
    name: "Cenário 1: Extração simples (título e autor)",
    text: `
      Artigo: Machine Learning Applications in Healthcare
      Autor: Dr. John Smith
      Ano: 2024
    `,
    schema: z.object({
      title: z.string().describe("Title of the article"),
      author: z.string().describe("Author name"),
      year: z.number().describe("Publication year"),
    }),
    prompt: "Extract the title, author, and year from the text.",
  },
  {
    name: "Cenário 2: Schema aninhado (artigo com autores múltiplos)",
    text: `
      Title: Deep Learning for Medical Diagnosis
      Authors: 
        - Dr. Jane Doe (jane@university.edu)
        - Dr. Bob Johnson (bob@research.org)
      Year: 2024
      Journal: AI in Medicine
    `,
    schema: z.object({
      title: z.string(),
      authors: z.array(z.object({
        name: z.string(),
        email: z.string().email().optional(),
      })),
      year: z.number(),
      journal: z.string(),
    }),
    prompt: "Extract structured information about the article including title, authors with emails, year, and journal.",
  },
  {
    name: "Cenário 3: Array de itens",
    text: `
      Products:
      1. Laptop - $999.99 - 5 units
      2. Mouse - $19.99 - 10 units
      3. Keyboard - $49.99 - 8 units
    `,
    schema: z.array(z.object({
      name: z.string(),
      price: z.number().positive(),
      quantity: z.number().int().positive(),
    })),
    prompt: "Extract a list of products with their names, prices, and quantities.",
  },
  {
    name: "Cenário 4: Campos opcionais",
    text: `
      Conference Paper: Neural Networks Explained
      Author: Dr. Alice Brown
      Year: 2023
      DOI: 10.1234/nn.2023.001
    `,
    schema: z.object({
      title: z.string(),
      author: z.string(),
      year: z.number(),
      doi: z.string().optional(),
      abstract: z.string().optional(),
    }),
    prompt: "Extract paper information. Some fields like DOI and abstract may be missing.",
  },
  {
    name: "Cenário 5: Validação de tipos (email, URL)",
    text: `
      Contact Information:
      Name: Sarah Williams
      Email: sarah.williams@example.com
      Website: https://www.example.com/research
      Phone: +1-555-1234
    `,
    schema: z.object({
      name: z.string(),
      email: z.string().email(),
      website: z.string().url().optional(),
      phone: z.string().optional(),
    }),
    prompt: "Extract contact information. Validate email format and URL if present.",
  },
];

/**
 * Executar um cenário de teste
 */
async function runScenario(
  scenario: typeof SCENARIOS[0],
  extractor: InstructorExtractor,
  logger: Logger,
): Promise<boolean> {
  console.log(`\n🧪 ${scenario.name}`);
  console.log("─".repeat(60));

  try {
    const start = performance.now();

    const result = await extractor.extract(
      scenario.text,
      scenario.schema,
      scenario.prompt,
      {
        model: "gpt-4o-mini", // Modelo mais barato para testes
        temperature: 0.0,
      },
    );

    const duration = performance.now() - start;

    // Validar resultado com schema
    const validation = scenario.schema.safeParse(result.data);
    
    if (!validation.success) {
      console.error("❌ Validação do schema falhou!");
      console.error(validation.error.errors);
      return false;
    }

    console.log("✅ Extração bem-sucedida!");
    console.log(`⏱️  Duração: ${duration.toFixed(2)}ms`);
    console.log(`🤖 Modelo: ${result.metadata.model}`);
    console.log("\n📊 Dados extraídos:");
    console.log(JSON.stringify(result.data, null, 2));

    return true;
  } catch (error) {
    console.error("❌ Erro na extração:");
    console.error(error);
    return false;
  }
}

/**
 * Função principal
 */
async function main() {
  console.log("🚀 Iniciando testes de cenários E2E para Structured Extraction\n");
  console.log("=".repeat(60));

  // Verificar API Key
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    console.error("❌ OPENAI_API_KEY não encontrada no ambiente");
    console.log("💡 Configure OPENAI_API_KEY no arquivo supabase/.env");
    Deno.exit(1);
  }

  console.log("✅ API Key encontrada\n");

  // Criar logger e extractor
  const logger = new Logger({ traceId: `scenarios-${crypto.randomUUID()}` });
  const extractor = new InstructorExtractor(apiKey, logger);

  // Executar todos os cenários
  const results: boolean[] = [];

  for (const scenario of SCENARIOS) {
    const success = await runScenario(scenario, extractor, logger);
    results.push(success);
    
    // Pequeno delay entre testes para não sobrecarregar a API
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Resumo final
  console.log("\n" + "=".repeat(60));
  console.log("📊 RESUMO DOS TESTES");
  console.log("=".repeat(60));

  const passed = results.filter(r => r).length;
  const total = results.length;

  console.log(`✅ Passou: ${passed}/${total}`);
  console.log(`❌ Falhou: ${total - passed}/${total}`);
  console.log(`📈 Taxa de sucesso: ${((passed / total) * 100).toFixed(1)}%`);

  if (passed === total) {
    console.log("\n🎉 Todos os testes passaram!");
    Deno.exit(0);
  } else {
    console.log("\n⚠️  Alguns testes falharam. Verifique os erros acima.");
    Deno.exit(1);
  }
}

// Executar
if (import.meta.main) {
  await main();
}

