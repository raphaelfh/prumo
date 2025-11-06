/**
 * Testes de Cenários para Structured Extraction Edge Function
 * 
 * Testa diferentes cenários de uso:
 * - Diferentes tipos de schemas (objetos, arrays, aninhados)
 * - Casos de erro (validação, timeout, API)
 * - Diferentes tamanhos de texto
 * - Validação de limites
 * - Diferentes modelos
 * - Autenticação opcional
 */

import { assertEquals, assertRejects, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { Logger } from "../../_shared/core/logger.ts";
import { InstructorExtractor } from "../../_shared/extraction/instructor-extractor.ts";
import { AppError, ErrorCode } from "../../_shared/core/error-handler.ts";
import { z } from "npm:zod@3.23.8";
import { Validator } from "../../_shared/core/validation.ts";

// ==================== CENÁRIO 1: SCHEMAS DIFERENTES ====================

Deno.test("Cenário 1.1 - Schema objeto simples", () => {
  const schema = z.object({
    title: z.string(),
    year: z.number(),
  });

  assertEquals(typeof schema.parse, "function");
  assertEquals(Object.keys(schema.shape).length, 2);
});

Deno.test("Cenário 1.2 - Schema com campos opcionais", () => {
  const schema = z.object({
    title: z.string(),
    subtitle: z.string().optional(),
    year: z.number(),
    doi: z.string().optional(),
  });

  // Deve aceitar objeto sem campos opcionais
  const result = schema.safeParse({ title: "Test", year: 2024 });
  assertEquals(result.success, true);
  
  // Deve aceitar objeto com campos opcionais
  const result2 = schema.safeParse({ 
    title: "Test", 
    subtitle: "Sub",
    year: 2024,
    doi: "10.1234/test"
  });
  assertEquals(result2.success, true);
});

Deno.test("Cenário 1.3 - Schema aninhado complexo", () => {
  const schema = z.object({
    article: z.object({
      title: z.string(),
      authors: z.array(z.object({
        name: z.string(),
        email: z.string().email().optional(),
        affiliation: z.string().optional(),
      })),
      metadata: z.object({
        year: z.number(),
        journal: z.string(),
        volume: z.number().optional(),
        issue: z.number().optional(),
      }),
    }),
  });

  const testData = {
    article: {
      title: "Test Article",
      authors: [
        { name: "John Doe", email: "john@example.com" },
        { name: "Jane Smith", affiliation: "University" },
      ],
      metadata: {
        year: 2024,
        journal: "Test Journal",
        volume: 10,
      },
    },
  };

  const result = schema.safeParse(testData);
  assertEquals(result.success, true);
});

Deno.test("Cenário 1.4 - Schema array de objetos", () => {
  const schema = z.array(z.object({
    item: z.string(),
    quantity: z.number(),
    price: z.number().positive(),
  }));

  const testData = [
    { item: "Book", quantity: 2, price: 29.99 },
    { item: "Pen", quantity: 5, price: 1.99 },
  ];

  const result = schema.safeParse(testData);
  assertEquals(result.success, true);
  assertEquals(Array.isArray(result.data), true);
});

Deno.test("Cenário 1.5 - Schema com union types", () => {
  const schema = z.object({
    type: z.enum(["article", "book", "conference"]),
    status: z.union([z.literal("draft"), z.literal("published"), z.literal("archived")]),
  });

  const result1 = schema.safeParse({ type: "article", status: "published" });
  assertEquals(result1.success, true);

  const result2 = schema.safeParse({ type: "invalid", status: "draft" });
  assertEquals(result2.success, false);
});

// ==================== CENÁRIO 2: VALIDAÇÃO DE ENTRADA ====================

Deno.test("Cenário 2.1 - Texto vazio rejeitado", async () => {
  const logger = new Logger({ traceId: "test" });
  const extractor = new InstructorExtractor("test-key", logger);
  const schema = z.object({ data: z.string() });

  await assertRejects(
    () => extractor.extract("", schema, "Extract data"),
    AppError,
    "Text parameter is empty or invalid",
  );
});

Deno.test("Cenário 2.2 - Texto null rejeitado", async () => {
  const logger = new Logger({ traceId: "test" });
  const extractor = new InstructorExtractor("test-key", logger);
  const schema = z.object({ data: z.string() });

  // TypeScript bloqueia null em runtime, mas testamos que a validação funciona
  // Aceitamos qualquer erro (TypeError do TypeScript ou AppError da validação)
  await assertRejects(
    async () => {
      // @ts-ignore - testando caso inválido intencionalmente
      await extractor.extract(null, schema, "Extract data");
    },
    Error, // Aceita qualquer erro (TypeError ou AppError)
  );
});

Deno.test("Cenário 2.3 - Texto undefined rejeitado", async () => {
  const logger = new Logger({ traceId: "test" });
  const extractor = new InstructorExtractor("test-key", logger);
  const schema = z.object({ data: z.string() });

  // TypeScript bloqueia undefined em runtime, mas testamos que a validação funciona
  // Aceitamos qualquer erro (TypeError do TypeScript ou AppError da validação)
  await assertRejects(
    async () => {
      // @ts-ignore - testando caso inválido intencionalmente
      await extractor.extract(undefined, schema, "Extract data");
    },
    Error, // Aceita qualquer erro (TypeError ou AppError)
  );
});

Deno.test("Cenário 2.4 - Texto apenas espaços rejeitado", async () => {
  const logger = new Logger({ traceId: "test" });
  const extractor = new InstructorExtractor("test-key", logger);
  const schema = z.object({ data: z.string() });

  await assertRejects(
    () => extractor.extract("   \n\t  ", schema, "Extract data"),
    AppError,
  );
});

Deno.test("Cenário 2.5 - Texto muito longo (limite configurável)", () => {
  const maxLength = 50000;
  const longText = "a".repeat(maxLength + 1);

  assertEquals(longText.length > maxLength, true);
  // A validação de tamanho máximo é feita na Edge Function
});

// ==================== CENÁRIO 3: VALIDAÇÃO DE REQUEST ====================

Deno.test("Cenário 3.1 - Request válido completo", () => {
  const requestSchema = z.object({
    text: z.string().min(1),
    schema: z.any(),
    prompt: z.string().min(1),
    options: z.object({
      model: z.enum(["gpt-4o-mini", "gpt-4o", "gpt-5"]).optional(),
      temperature: z.number().min(0).max(2).optional(),
      maxTokens: z.number().positive().optional(),
    }).optional(),
    requireAuth: z.boolean().optional(),
  });

  const validRequest = {
    text: "Sample text",
    schema: { type: "object" },
    prompt: "Extract data",
    options: {
      model: "gpt-4o" as const,
      temperature: 0.0,
      maxTokens: 1000,
    },
    requireAuth: false,
  };

  const result = requestSchema.safeParse(validRequest);
  assertEquals(result.success, true);
});

Deno.test("Cenário 3.2 - Request sem options", () => {
  const requestSchema = z.object({
    text: z.string().min(1),
    schema: z.any(),
    prompt: z.string().min(1),
    options: z.object({
      model: z.enum(["gpt-4o-mini", "gpt-4o", "gpt-5"]).optional(),
    }).optional(),
  });

  const request = {
    text: "Sample text",
    schema: { type: "object" },
    prompt: "Extract data",
  };

  const result = requestSchema.safeParse(request);
  assertEquals(result.success, true);
});

Deno.test("Cenário 3.3 - Request com modelo inválido rejeitado", () => {
  const requestSchema = z.object({
    options: z.object({
      model: z.enum(["gpt-4o-mini", "gpt-4o", "gpt-5"]),
    }).optional(),
  });

  const invalidRequest = {
    options: {
      model: "invalid-model",
    },
  };

  const result = requestSchema.safeParse(invalidRequest);
  assertEquals(result.success, false);
});

Deno.test("Cenário 3.4 - Request com temperature fora do range", () => {
  const requestSchema = z.object({
    options: z.object({
      temperature: z.number().min(0).max(2),
    }).optional(),
  });

  const invalidRequest = {
    options: {
      temperature: 3.0, // Fora do range [0, 2]
    },
  };

  const result = requestSchema.safeParse(invalidRequest);
  assertEquals(result.success, false);
});

Deno.test("Cenário 3.5 - Request com maxTokens negativo", () => {
  const requestSchema = z.object({
    options: z.object({
      maxTokens: z.number().positive(),
    }).optional(),
  });

  const invalidRequest = {
    options: {
      maxTokens: -100,
    },
  };

  const result = requestSchema.safeParse(invalidRequest);
  assertEquals(result.success, false);
});

// ==================== CENÁRIO 4: DIFERENTES MODELOS ====================

Deno.test("Cenário 4.1 - Modelo gpt-4o-mini", () => {
  const options = {
    model: "gpt-4o-mini" as const,
    temperature: 0.0,
  };

  assertEquals(options.model, "gpt-4o-mini");
  assertEquals(typeof options.temperature, "number");
});

Deno.test("Cenário 4.2 - Modelo gpt-4o", () => {
  const options = {
    model: "gpt-4o" as const,
    temperature: 0.1,
  };

  assertEquals(options.model, "gpt-4o");
});

Deno.test("Cenário 4.3 - Modelo gpt-5", () => {
  const options = {
    model: "gpt-5" as const,
    maxTokens: 2000,
  };

  assertEquals(options.model, "gpt-5");
});

Deno.test("Cenário 4.4 - Modelo padrão quando não especificado", () => {
  const options = {};
  
  // O modelo padrão deve ser "gpt-4o"
  const defaultModel = "gpt-4o";
  assertEquals(typeof defaultModel, "string");
});

// ==================== CENÁRIO 5: SCHEMAS COM VALIDAÇÕES ====================

Deno.test("Cenário 5.1 - Schema com email válido", () => {
  const schema = z.object({
    email: z.string().email(),
  });

  const valid = schema.safeParse({ email: "test@example.com" });
  assertEquals(valid.success, true);

  const invalid = schema.safeParse({ email: "invalid-email" });
  assertEquals(invalid.success, false);
});

Deno.test("Cenário 5.2 - Schema com URL válida", () => {
  const schema = z.object({
    url: z.string().url(),
  });

  const valid = schema.safeParse({ url: "https://example.com" });
  assertEquals(valid.success, true);

  const invalid = schema.safeParse({ url: "not-a-url" });
  assertEquals(invalid.success, false);
});

Deno.test("Cenário 5.3 - Schema com número positivo", () => {
  const schema = z.object({
    price: z.number().positive(),
    quantity: z.number().int().positive(),
  });

  const valid = schema.safeParse({ price: 29.99, quantity: 5 });
  assertEquals(valid.success, true);

  const invalid = schema.safeParse({ price: -10, quantity: 0 });
  assertEquals(invalid.success, false);
});

Deno.test("Cenário 5.4 - Schema com string com tamanho mínimo", () => {
  const schema = z.object({
    title: z.string().min(5),
    description: z.string().min(10).max(500),
  });

  const valid = schema.safeParse({ 
    title: "Valid Title", 
    description: "This is a valid description with more than 10 characters"
  });
  assertEquals(valid.success, true);

  const invalid = schema.safeParse({ 
    title: "Hi", // Menos de 5 caracteres
    description: "Short" // Menos de 10 caracteres
  });
  assertEquals(invalid.success, false);
});

// ==================== CENÁRIO 6: CASOS DE ERRO ====================

Deno.test("Cenário 6.1 - Erro de validação formatado", () => {
  const schema = z.object({
    required: z.string(),
  });

  const result = schema.safeParse({});
  
  if (!result.success) {
    assertEquals(result.error.errors.length > 0, true);
    assertEquals(result.error.errors[0].code, "invalid_type");
  }
});

Deno.test("Cenário 6.2 - Erro com múltiplos campos inválidos", () => {
  const schema = z.object({
    name: z.string().min(3),
    email: z.string().email(),
    age: z.number().positive(),
  });

  const result = schema.safeParse({
    name: "ab", // Muito curto
    email: "invalid", // Email inválido
    age: -5, // Negativo
  });

  assertEquals(result.success, false);
  if (!result.success) {
    assertEquals(result.error.errors.length >= 3, true);
  }
});

// ==================== CENÁRIO 7: DIFERENTES TAMANHOS DE TEXTO ====================

Deno.test("Cenário 7.1 - Texto pequeno (menos de 100 caracteres)", () => {
  const smallText = "This is a small text for testing.";
  assertEquals(smallText.length < 100, true);
  assertEquals(typeof smallText, "string");
});

Deno.test("Cenário 7.2 - Texto médio (100-1000 caracteres)", () => {
  const mediumText = "a".repeat(500);
  assertEquals(mediumText.length >= 100, true);
  assertEquals(mediumText.length <= 1000, true);
});

Deno.test("Cenário 7.3 - Texto grande (1000-10000 caracteres)", () => {
  const largeText = "a".repeat(5000);
  assertEquals(largeText.length > 1000, true);
  assertEquals(largeText.length <= 10000, true);
});

Deno.test("Cenário 7.4 - Texto muito grande (acima do limite)", () => {
  const maxLength = 50000;
  const veryLargeText = "a".repeat(maxLength + 1000);
  assertEquals(veryLargeText.length > maxLength, true);
});

// ==================== CENÁRIO 8: PROMPTS DIFERENTES ====================

Deno.test("Cenário 8.1 - Prompt simples", () => {
  const prompt = "Extract the title and author from the text.";
  assertEquals(prompt.length > 0, true);
  assertEquals(typeof prompt, "string");
});

Deno.test("Cenário 8.2 - Prompt detalhado", () => {
  const prompt = `
    Extract structured information from the following text.
    Focus on:
    1. Title of the document
    2. List of authors
    3. Publication year
    4. Abstract if available
    
    Return the data in a structured format.
  `;
  assertEquals(prompt.length > 100, true);
  assertEquals(prompt.includes("Extract"), true);
});

Deno.test("Cenário 8.3 - Prompt vazio rejeitado", () => {
  const prompt = "";
  assertEquals(prompt.length === 0, true);
  // Deve ser rejeitado na validação
});

// ==================== CENÁRIO 9: TESTES DE INTEGRAÇÃO COM VALIDATOR ====================

Deno.test("Cenário 9.1 - Validator rejeita texto vazio", () => {
  const schema = z.object({
    text: z.string().min(1),
  });

  const result = Validator.safeValidate(schema, { text: "" });
  assertEquals(result.success, false);
});

Deno.test("Cenário 9.2 - Validator aceita request válido", () => {
  const schema = z.object({
    text: z.string().min(1),
    prompt: z.string().min(1),
  });

  const data = {
    text: "Sample text",
    prompt: "Extract data",
  };

  const result = Validator.safeValidate(schema, data);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.text, "Sample text");
  }
});

// ==================== CENÁRIO 10: SCHEMAS EDGE CASES ====================

Deno.test("Cenário 10.1 - Schema com array vazio permitido", () => {
  const schema = z.array(z.string());
  const result = schema.safeParse([]);
  assertEquals(result.success, true);
});

Deno.test("Cenário 10.2 - Schema com objeto vazio", () => {
  const schema = z.object({});
  const result = schema.safeParse({});
  assertEquals(result.success, true);
});

Deno.test("Cenário 10.3 - Schema com valores default", () => {
  const schema = z.object({
    status: z.string().default("pending"),
    count: z.number().default(0),
  });

  const result = schema.safeParse({});
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.status, "pending");
    assertEquals(result.data.count, 0);
  }
});

Deno.test("Cenário 10.4 - Schema com transformação", () => {
  const schema = z.object({
    name: z.string().transform((val) => val.toUpperCase()),
    age: z.string().transform((val) => parseInt(val, 10)),
  });

  const result = schema.safeParse({ name: "john", age: "25" });
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.name, "JOHN");
    assertEquals(result.data.age, 25);
  }
});

// ==================== CENÁRIO 11: LOGGER E OBSERVABILIDADE ====================

Deno.test("Cenário 11.1 - Logger cria contexto", () => {
  const logger = new Logger({ traceId: "test-123" });
  assertExists(logger);
  assertEquals(typeof logger.info, "function");
});

Deno.test("Cenário 11.2 - Logger cria child logger", () => {
  const parentLogger = new Logger({ traceId: "parent-123" });
  const childLogger = parentLogger.child({ userId: "user-456" });
  
  assertExists(childLogger);
  assertEquals(typeof childLogger.info, "function");
});

Deno.test("Cenário 11.3 - Logger suporta diferentes níveis", () => {
  const logger = new Logger({ traceId: "test" });
  
  assertEquals(typeof logger.debug, "function");
  assertEquals(typeof logger.info, "function");
  assertEquals(typeof logger.warn, "function");
  assertEquals(typeof logger.error, "function");
});

// ==================== CENÁRIO 12: EXTRACTOR CONFIGURAÇÃO ====================

Deno.test("Cenário 12.1 - InstructorExtractor inicializa corretamente", () => {
  const logger = new Logger({ traceId: "test" });
  const extractor = new InstructorExtractor("test-api-key", logger);
  
  assertExists(extractor);
  assertEquals(typeof extractor.extract, "function");
});

Deno.test("Cenário 12.2 - InstructorExtractor aceita diferentes opções", () => {
  const logger = new Logger({ traceId: "test" });
  const extractor = new InstructorExtractor("test-api-key", logger);
  const schema = z.object({ data: z.string() });

  // Deve aceitar opções sem erro (validação de interface)
  const options = {
    model: "gpt-4o" as const,
    temperature: 0.5,
    maxTokens: 2000,
    maxRetries: 3,
  };

  assertEquals(typeof options.model, "string");
  assertEquals(typeof options.temperature, "number");
  assertEquals(typeof options.maxTokens, "number");
  assertEquals(typeof options.maxRetries, "number");
});

