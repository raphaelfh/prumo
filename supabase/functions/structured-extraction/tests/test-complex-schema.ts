/**
 * Teste com Schema Zod Complexo
 * 
 * Testa extração com schema aninhado complexo incluindo:
 * - Objetos aninhados
 * - Arrays de objetos
 * - Campos opcionais
 * - Validações (email, URL, números positivos)
 * - Union types
 * 
 * Executar: deno run --allow-all --allow-env --allow-net supabase/functions/structured-extraction/tests/test-complex-schema.ts
 */

import { z } from "npm:zod@3.23.8";
import { InstructorExtractor } from "../../_shared/extraction/instructor-extractor.ts";
import { Logger } from "../../_shared/core/logger.ts";

declare const Deno: {
  env: { get(key: string): string | undefined };
  exit(code: number): never;
};

/**
 * Schema Zod Complexo
 */
const ComplexSchema = z.object({
  article: z.object({
    // Informações básicas
    title: z.string().min(5).describe("Title of the research article"),
    subtitle: z.string().optional().describe("Subtitle if available"),
    
    // Autores com validações
    authors: z.array(z.object({
      name: z.string().describe("Full name of the author"),
      email: z.string().email().optional().describe("Email address"),
      affiliation: z.string().optional().describe("Institutional affiliation"),
      orcid: z.string().regex(/^\d{4}-\d{4}-\d{4}-\d{4}$/).optional().describe("ORCID ID in format XXXX-XXXX-XXXX-XXXX"),
    })).min(1).describe("List of authors (at least one required)"),
    
    // Metadata com validações
    metadata: z.object({
      year: z.number().int().min(1900).max(2030).describe("Publication year"),
      journal: z.string().describe("Journal or conference name"),
      volume: z.number().int().positive().optional().describe("Volume number"),
      issue: z.number().int().positive().optional().describe("Issue number"),
      pages: z.object({
        start: z.number().int().positive(),
        end: z.number().int().positive(),
      }).optional().describe("Page range"),
      doi: z.string().regex(/^10\.\d{4,}\/.+$/).optional().describe("DOI in format 10.xxxx/..."),
      url: z.string().url().optional().describe("Full URL to the article"),
    }),
    
    // Abstract
    abstract: z.string().min(50).describe("Abstract text (at least 50 characters)"),
    
    // Keywords
    keywords: z.array(z.string()).min(3).max(10).describe("List of keywords (3-10 items)"),
    
    // Status
    status: z.enum(["published", "accepted", "submitted", "preprint"]).describe("Publication status"),
    
    // Métricas (opcional)
    metrics: z.object({
      citations: z.number().int().nonnegative().optional(),
      downloads: z.number().int().nonnegative().optional(),
      impactFactor: z.number().positive().optional(),
    }).optional(),
    
    // Funding (opcional)
    funding: z.array(z.object({
      agency: z.string(),
      grantNumber: z.string().optional(),
      amount: z.number().positive().optional(),
    })).optional(),
  }),
  
  // Informações adicionais
  tags: z.array(z.string()).optional(),
  categories: z.array(z.enum(["machine-learning", "healthcare", "nlp", "computer-vision", "other"])).optional(),
});

/**
 * Texto de exemplo complexo para extração
 */
const sampleText = `
Title: Deep Learning Applications in Medical Diagnosis: A Comprehensive Review
Subtitle: Recent Advances and Future Directions

Authors:
1. Dr. Sarah Johnson, MD, PhD
   Email: sarah.johnson@medicaluniversity.edu
   Affiliation: Department of Medical Informatics, Medical University
   ORCID: 0000-0001-2345-6789

2. Prof. Michael Chen, PhD
   Email: m.chen@research-institute.org
   Affiliation: AI Research Institute
   ORCID: 0000-0002-3456-7890

3. Dr. Emily Rodriguez, MD
   Affiliation: Department of Radiology, City Hospital
   (Email and ORCID not provided)

Publication Information:
- Year: 2024
- Journal: Journal of Medical AI and Machine Learning
- Volume: 15
- Issue: 3
- Pages: 245-278
- DOI: 10.1234/jmaml.2024.001
- URL: https://www.journal-medical-ai.com/articles/2024/deep-learning-medical-diagnosis

Abstract:
This comprehensive review explores the application of deep learning techniques in medical diagnosis, 
focusing on recent advances in convolutional neural networks, recurrent neural networks, and 
transformers. We analyze over 150 recent studies published between 2020 and 2024, covering various 
medical imaging modalities including X-rays, MRI, CT scans, and histopathology. The review discusses 
challenges such as data scarcity, interpretability, and clinical validation. We also examine 
emerging trends including federated learning, few-shot learning, and explainable AI in medical 
contexts. The paper concludes with a discussion of future directions and opportunities for 
improving diagnostic accuracy and patient outcomes through advanced AI technologies.

Keywords:
- Deep Learning
- Medical Diagnosis
- Convolutional Neural Networks
- Medical Imaging
- AI in Healthcare
- Computer-Aided Diagnosis
- Neural Networks
- Healthcare AI

Status: Published

Metrics:
- Citations: 127
- Downloads: 3,450
- Impact Factor: 8.5

Funding:
- National Institutes of Health (NIH) - Grant #R01-HL123456 - Amount: $500,000
- Medical Research Foundation - Grant #MRF-2024-001 - Amount: $150,000

Tags: AI, healthcare, machine learning, medical imaging
Categories: machine-learning, healthcare
`;

/**
 * Prompt de extração
 */
const extractionPrompt = `
Extract all structured information from this academic article text. 
Pay special attention to:
- All authors with their complete information (name, email, affiliation, ORCID if available)
- Complete metadata including publication details
- Full abstract text
- All keywords
- Publication status
- Metrics if available
- Funding information if available
- Tags and categories

Ensure all fields are properly validated according to the schema requirements.
Be precise with email formats, URLs, DOIs, ORCID IDs, and numerical values.
`;

async function loadEnvFile() {
  try {
    // Tentar carregar do .env no diretório supabase
    const envPath = "../../../.env";
    const envContent = await Deno.readTextFile(envPath);
    const lines = envContent.split("\n");
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      
      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        let value = match[2].trim();
        
        // Remover aspas se presentes
        if ((value.startsWith('"') && value.endsWith('"')) || 
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        
        Deno.env.set(key, value);
      }
    }
  } catch (error) {
    // Ignorar erro se arquivo não existir
    console.log("⚠️  Não foi possível carregar .env, usando variáveis do sistema");
  }
}

async function main() {
  console.log("=" .repeat(80));
  console.log("🧪 TESTE COM SCHEMA ZOD COMPLEXO");
  console.log("=" .repeat(80));
  console.log();

  // Carregar .env se disponível
  await loadEnvFile();

  // Verificar API Key
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    console.error("❌ OPENAI_API_KEY não encontrada!");
    console.log("💡 Configure no arquivo supabase/.env ou como variável de ambiente");
    Deno.exit(1);
  }

  console.log("✅ API Key encontrada\n");

  // Criar logger e extractor
  const logger = new Logger({ traceId: `complex-test-${crypto.randomUUID()}` });
  const extractor = new InstructorExtractor(apiKey, logger);

  // Mostrar informações do teste
  console.log("📋 INFORMAÇÕES DO TESTE");
  console.log("-".repeat(80));
  console.log(`📝 Tamanho do texto: ${sampleText.length} caracteres`);
  console.log(`📊 Schema: Objeto aninhado com ${Object.keys(ComplexSchema.shape).length} campos principais`);
  console.log(`   - article (objeto aninhado)`);
  console.log(`   - tags (array opcional)`);
  console.log(`   - categories (array opcional)`);
  console.log(`🤖 Modelo: gpt-4o-mini`);
  console.log();

  // Executar extração
  console.log("🔄 Executando extração...");
  console.log();

  const startTime = performance.now();

  try {
    const result = await extractor.extract(
      sampleText,
      ComplexSchema,
      extractionPrompt,
      {
        model: "gpt-4o-mini",
        temperature: 0.0,
      },
    );

    const duration = performance.now() - startTime;

    // Validar resultado
    const validation = ComplexSchema.safeParse(result.data);

    console.log("=" .repeat(80));
    console.log("📊 RESULTADO DA EXTRAÇÃO");
    console.log("=" .repeat(80));
    console.log();

    if (!validation.success) {
      console.error("❌ VALIDAÇÃO DO SCHEMA FALHOU!");
      console.error("Erros encontrados:");
      validation.error.errors.forEach((err, idx) => {
        console.error(`  ${idx + 1}. Caminho: ${err.path.join(".")}`);
        console.error(`     Mensagem: ${err.message}`);
        console.error();
      });
      Deno.exit(1);
    }

    console.log("✅ Extração bem-sucedida e validada!");
    console.log();
    console.log("⏱️  DURAÇÃO:");
    console.log(`   ${duration.toFixed(2)}ms`);
    console.log();
    console.log("🤖 MODELO:");
    console.log(`   ${result.metadata.model}`);
    console.log();

    // Mostrar resultado formatado
    console.log("=" .repeat(80));
    console.log("📄 RESULTADO EXTRAÍDO (JSON formatado)");
    console.log("=" .repeat(80));
    console.log();
    console.log(JSON.stringify(result.data, null, 2));
    console.log();

    // Mostrar resumo
    console.log("=" .repeat(80));
    console.log("📈 RESUMO");
    console.log("=" .repeat(80));
    console.log();
    
    const data = result.data as z.infer<typeof ComplexSchema>;
    
    console.log(`📰 Artigo: ${data.article.title}`);
    if (data.article.subtitle) {
      console.log(`   Subtítulo: ${data.article.subtitle}`);
    }
    console.log();
    console.log(`👥 Autores: ${data.article.authors.length}`);
    data.article.authors.forEach((author, idx) => {
      console.log(`   ${idx + 1}. ${author.name}`);
      if (author.email) console.log(`      Email: ${author.email}`);
      if (author.affiliation) console.log(`      Afiliação: ${author.affiliation}`);
      if (author.orcid) console.log(`      ORCID: ${author.orcid}`);
    });
    console.log();
    console.log(`📅 Publicação: ${data.article.metadata.year}`);
    console.log(`📚 Journal: ${data.article.metadata.journal}`);
    if (data.article.metadata.volume) {
      console.log(`   Volume: ${data.article.metadata.volume}`);
    }
    if (data.article.metadata.issue) {
      console.log(`   Issue: ${data.article.metadata.issue}`);
    }
    if (data.article.metadata.pages) {
      console.log(`   Páginas: ${data.article.metadata.pages.start}-${data.article.metadata.pages.end}`);
    }
    if (data.article.metadata.doi) {
      console.log(`   DOI: ${data.article.metadata.doi}`);
    }
    if (data.article.metadata.url) {
      console.log(`   URL: ${data.article.metadata.url}`);
    }
    console.log();
    console.log(`📝 Abstract: ${data.article.abstract.substring(0, 100)}...`);
    console.log();
    console.log(`🏷️  Keywords: ${data.article.keywords.length} - ${data.article.keywords.join(", ")}`);
    console.log();
    console.log(`📊 Status: ${data.article.status}`);
    console.log();
    
    if (data.article.metrics) {
      console.log("📈 Métricas:");
      if (data.article.metrics.citations) {
        console.log(`   Citações: ${data.article.metrics.citations}`);
      }
      if (data.article.metrics.downloads) {
        console.log(`   Downloads: ${data.article.metrics.downloads}`);
      }
      if (data.article.metrics.impactFactor) {
        console.log(`   Impact Factor: ${data.article.metrics.impactFactor}`);
      }
      console.log();
    }
    
    if (data.article.funding && data.article.funding.length > 0) {
      console.log(`💰 Funding: ${data.article.funding.length} agência(s)`);
      data.article.funding.forEach((fund, idx) => {
        console.log(`   ${idx + 1}. ${fund.agency}`);
        if (fund.grantNumber) console.log(`      Grant: ${fund.grantNumber}`);
        if (fund.amount) console.log(`      Valor: $${fund.amount.toLocaleString()}`);
      });
      console.log();
    }
    
    if (data.tags && data.tags.length > 0) {
      console.log(`🏷️  Tags: ${data.tags.join(", ")}`);
      console.log();
    }
    
    if (data.categories && data.categories.length > 0) {
      console.log(`📂 Categories: ${data.categories.join(", ")}`);
      console.log();
    }

    console.log("=" .repeat(80));
    console.log("🎉 TESTE CONCLUÍDO COM SUCESSO!");
    console.log("=" .repeat(80));

  } catch (error) {
    console.error("=" .repeat(80));
    console.error("❌ ERRO NA EXTRAÇÃO");
    console.error("=" .repeat(80));
    console.error();
    console.error(error);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}

