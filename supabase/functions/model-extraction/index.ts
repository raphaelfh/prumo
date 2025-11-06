/**
 * Edge Function: Model Extraction
 * 
 * Extração de IA focada em identificar e criar modelos de predição automaticamente.
 * 
 * DIFERENCIAL: Extrai todos os modelos do artigo e cria instâncias automaticamente
 * com suas hierarquias completas (child instances).
 * 
 * FLUXO:
 * 1. Validação de entrada (projectId, articleId, templateId)
 * 2. Autenticação do usuário
 * 3. Busca do PDF no storage (via article_files)
 * 4. Download do PDF
 * 5. Execução do pipeline de extração de modelos
 * 6. Retorno do resultado (runId, modelos criados)
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { Logger } from "../_shared/core/logger.ts";
import { ErrorHandler, AppError, ErrorCode } from "../_shared/core/error-handler.ts";
import { z } from "npm:zod@3.23.8";
import { Validator } from "../_shared/core/validation.ts";
import { corsHeaders } from "../_shared/core/cors.ts";
import { authenticateUser } from "../_shared/core/auth.ts";
import { ModelExtractionPipeline } from "./pipeline.ts";
import { CONFIG } from "../section-extraction/config.ts";

// Declarações de tipos do Deno (ambiente de execução)
declare const Deno: {
  env: { get(key: string): string | undefined };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

/**
 * Schema de validação do request
 */
const ModelExtractionRequestSchema = z.object({
  projectId: z.string().uuid("projectId must be a valid UUID"),
  articleId: z.string().uuid("articleId must be a valid UUID"),
  templateId: z.string().uuid("templateId must be a valid UUID"),
  options: z
    .object({
      model: z.enum(["gpt-4o-mini", "gpt-4o", "gpt-5"]).optional(),
    })
    .optional(),
});

type ModelExtractionRequest = z.infer<typeof ModelExtractionRequestSchema>;

/**
 * Handler principal da Edge Function
 */
Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Gerar trace ID para rastreabilidade
  const traceId = req.headers.get("x-client-trace-id") || crypto.randomUUID();
  const logger = new Logger({ traceId });

  try {
    // ==================== 1. AUTENTICAÇÃO (ANTES DO PARSE) ====================
    const authHeader = req.headers.get("Authorization");
    const { user, supabase } = await authenticateUser(authHeader, logger);

    // ==================== 2. PARSE E VALIDAÇÃO ====================
    const body = await req.json().catch(() => {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid JSON body", 400);
    });

    const input: ModelExtractionRequest = Validator.validate(ModelExtractionRequestSchema, body);

    // Criar logger filho com contexto completo
    const contextualLogger = logger.child({
      userId: user.id,
      projectId: input.projectId,
      articleId: input.articleId,
      templateId: input.templateId,
    });

    contextualLogger.info("Model extraction request received", {
      model: input.options?.model || "gpt-4o-mini",
    });

    // ==================== 3. BUSCAR PDF DO ARTIGO ====================
    // Buscar o arquivo PDF mais recente associado ao artigo
    // Mesma lógica usada em section-extraction (que está funcionando)
    const { data: articleFiles, error: filesError } = await supabase
      .from("article_files")
      .select("id, file_type, storage_key, original_filename, created_at")
      .eq("article_id", input.articleId)
      .ilike("file_type", "%pdf%")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (filesError) {
      contextualLogger.error("Failed to query article files", filesError as Error, {
        articleId: input.articleId,
        errorCode: filesError.code,
      });
      throw new AppError(ErrorCode.DB_ERROR, "Failed to query article files", 500, {
        error: filesError.message,
      });
    }

    if (!articleFiles || !articleFiles.storage_key) {
      contextualLogger.warn("PDF not found in article_files", { articleId: input.articleId });
      throw new AppError(
        ErrorCode.NOT_FOUND,
        "PDF not found. Upload a PDF first.",
        404,
        { articleId: input.articleId },
      );
    }

    const pdfFile = articleFiles;

    contextualLogger.info("PDF file found", {
      storage_key: pdfFile.storage_key,
      filename: pdfFile.original_filename,
    });

    // ==================== 4. DOWNLOAD DO PDF ====================
    // Baixar o PDF do Supabase Storage
    // storage_key já contém o caminho completo dentro do bucket
    const { data: file, error: storageError } = await supabase.storage
      .from("articles")
      .download(pdfFile.storage_key);

    if (storageError) {
      contextualLogger.error("Storage download failed", storageError as Error, {
        storage_key: pdfFile.storage_key,
        errorCode: storageError.statusCode,
      });
      throw new AppError(ErrorCode.PDF_PROCESSING_ERROR, "Failed to download PDF", 500, {
        storage_key: pdfFile.storage_key,
        error: storageError.message,
      });
    }

    if (!file) {
      contextualLogger.error("Storage download returned null file", new Error("No file data"), {
        storage_key: pdfFile.storage_key,
      });
      throw new AppError(ErrorCode.PDF_PROCESSING_ERROR, "PDF download returned empty file", 500, {
        storage_key: pdfFile.storage_key,
      });
    }

    // Validar tamanho do arquivo (limite configurável para evitar problemas de memória)
    const MAX_PDF_SIZE = CONFIG.pdf.maxSizeMB * 1024 * 1024;
    const fileSize = file.size;
    if (fileSize > MAX_PDF_SIZE) {
      contextualLogger.warn("PDF file too large", { sizeBytes: fileSize, maxSize: MAX_PDF_SIZE });
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `PDF file too large (${(fileSize / 1024 / 1024).toFixed(2)}MB). Maximum size is ${CONFIG.pdf.maxSizeMB}MB.`,
        400,
        { sizeBytes: fileSize, maxSize: MAX_PDF_SIZE },
      );
    }

    // Converter File para Uint8Array (formato esperado pelo processador de PDF)
    const pdfBuffer = new Uint8Array(await file.arrayBuffer());
    contextualLogger.info("PDF loaded from storage", {
      sizeBytes: pdfBuffer.byteLength,
      filename: pdfFile.original_filename,
    });

    // ==================== 5. EXECUTAR PIPELINE ====================
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, "OPENAI_API_KEY not configured", 500);
    }

    try {
      const pipeline = new ModelExtractionPipeline(supabase, OPENAI_API_KEY, contextualLogger);

      const result = await pipeline.run(pdfBuffer, {
        projectId: input.projectId,
        articleId: input.articleId,
        templateId: input.templateId,
        userId: user.id,
        model: input.options?.model,
      });

      contextualLogger.info("Model extraction pipeline completed successfully", {
        runId: result.runId,
        modelsCreated: result.modelsCreated.length,
      });

      // ==================== 6. RETORNAR RESULTADO ====================
      return new Response(JSON.stringify({ ok: true, data: result, traceId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (pipelineError) {
      contextualLogger.error("Pipeline error", pipelineError, {
        errorMessage: pipelineError instanceof Error ? pipelineError.message : String(pipelineError),
        errorName: pipelineError instanceof Error ? pipelineError.name : "Unknown",
      });
      throw pipelineError;
    }
  } catch (error) {
    return ErrorHandler.handle(error, logger);
  }
});

