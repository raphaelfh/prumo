/**
 * Edge Function: Structured Extraction
 * 
 * Extração estruturada usando Instructor.js para dados genéricos.
 * 
 * DIFERENCIAL: Usa Instructor.js como alternativa ao LangChain, oferecendo
 * interface mais simples e direta para extração estruturada.
 * 
 * ARQUITETURA MODULAR: Reutiliza módulo compartilhado _shared/extraction/instructor-extractor.ts
 * seguindo princípio DRY (Don't Repeat Yourself).
 * 
 * FLUXO:
 * 1. Validação de entrada (text, schema, prompt)
 * 2. Autenticação do usuário (opcional, pode ser configurado)
 * 3. Extração usando Instructor.js (módulo compartilhado)
 * 4. Retorno do resultado estruturado
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { Logger } from "../_shared/core/logger.ts";
import { ErrorHandler, AppError, ErrorCode } from "../_shared/core/error-handler.ts";
import { z } from "npm:zod@3.23.8";
import { Validator } from "../_shared/core/validation.ts";
import { corsHeaders } from "../_shared/core/cors.ts";
import { authenticateUser } from "../_shared/core/auth.ts";
import { InstructorExtractor } from "../_shared/extraction/instructor-extractor.ts";
import { CONFIG } from "./config.ts";

// Declarações de tipos do Deno
declare const Deno: {
  env: { get(key: string): string | undefined };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

/**
 * Schema de validação do request
 * 
 * KISS: Interface simples que aceita texto, schema Zod e prompt
 * 
 * NOTA: O schema Zod deve ser passado como objeto JSON serializável.
 * O cliente deve converter o schema Zod para JSON antes de enviar.
 */
const StructuredExtractionRequestSchema = z.object({
  text: z.string().min(1, "Text cannot be empty"),
  schema: z.any(), // Schema Zod (objeto JSON) - será validado dinamicamente
  prompt: z.string().min(1, "Prompt cannot be empty"),
  options: z
    .object({
      model: z.enum(["gpt-4o-mini", "gpt-4o", "gpt-5"]).optional(),
      temperature: z.number().min(0).max(2).optional(),
      maxTokens: z.number().positive().optional(),
    })
    .optional(),
  // Autenticação opcional (pode ser requerida dependendo do caso de uso)
  requireAuth: z.boolean().optional().default(false),
});

type StructuredExtractionRequest = z.infer<typeof StructuredExtractionRequestSchema>;

/**
 * Handler principal
 */
Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Trace ID para rastreabilidade
  const traceId = req.headers.get("x-client-trace-id") || crypto.randomUUID();
  const logger = new Logger({ traceId });

  try {
    // ==================== 1. VALIDAÇÃO DE ENTRADA ====================
    const body = await req.json().catch(() => {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid JSON body", 400);
    });

    const input: StructuredExtractionRequest = Validator.validate(
      StructuredExtractionRequestSchema,
      body,
    );

    // Validar schema Zod
    // O schema pode ser um objeto JSON que representa um schema Zod
    // ou pode ser um objeto Zod já parseado. Vamos tentar construir o schema.
    let zodSchema: z.ZodTypeAny;
    
    try {
      // Tentar construir schema Zod a partir do objeto fornecido
      // Se for um objeto JSON, precisamos reconstruir o schema Zod
      // Por enquanto, aceitamos qualquer objeto e validamos depois
      if (!input.schema || typeof input.schema !== 'object') {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          "Schema must be a valid object",
          400,
        );
      }
      
      // Por enquanto, assumimos que o schema será usado diretamente
      // Na prática, o Instructor.js pode aceitar o schema em formato JSON
      zodSchema = input.schema as z.ZodTypeAny;
    } catch (error) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        "Invalid schema format",
        400,
        { error: error instanceof Error ? error.message : String(error) },
      );
    }

    // Validar tamanho do texto
    if (input.text.length > CONFIG.llm.maxTextLength) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Text exceeds maximum length of ${CONFIG.llm.maxTextLength} characters`,
        400,
        { textLength: input.text.length, maxLength: CONFIG.llm.maxTextLength },
      );
    }

    // ==================== 2. AUTENTICAÇÃO (OPCIONAL) ====================
    let user: { id: string } | null = null;

    if (input.requireAuth) {
      const authHeader = req.headers.get("Authorization");
      const authResult = await authenticateUser(authHeader, logger);
      user = authResult.user;
      logger.info("User authenticated", { userId: user.id });
    }

    // ==================== 3. VERIFICAR API KEY ====================
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      throw new AppError(
        ErrorCode.INTERNAL_ERROR,
        "OPENAI_API_KEY not configured",
        500,
      );
    }

    // ==================== 4. EXTRAIR DADOS COM INSTRUCTOR.JS ====================
    // Usar módulo compartilhado (DRY)
    const extractor = new InstructorExtractor(OPENAI_API_KEY, logger);
    
    const contextualLogger = user
      ? logger.child({ userId: user.id })
      : logger;

    contextualLogger.info("Starting structured extraction", {
      textLength: input.text.length,
      model: input.options?.model || "gpt-4o-mini",
      hasSchema: !!input.schema,
    });

    const result = await extractor.extract(
      input.text,
      zodSchema,
      input.prompt,
      {
        model: input.options?.model,
        temperature: input.options?.temperature,
        maxTokens: input.options?.maxTokens,
        maxRetries: CONFIG.retry.maxAttempts,
      },
    );

    contextualLogger.info("Structured extraction completed", {
      duration: `${result.metadata.duration.toFixed(2)}ms`,
      model: result.metadata.model,
    });

    // ==================== 5. RETORNAR RESULTADO ====================
    return new Response(
      JSON.stringify({
        ok: true,
        data: result.data,
        metadata: result.metadata,
        traceId,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    return ErrorHandler.handle(error, logger);
  }
});

