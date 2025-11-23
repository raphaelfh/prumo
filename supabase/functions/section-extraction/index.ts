/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * Edge Function: Section Extraction
 * 
 * Extração de IA focada em uma seção específica (entity type) de um template.
 * 
 * DIFERENCIAL: Extrai apenas uma seção por vez, permitindo extração granular
 * e controlada pelo usuário via botão no frontend.
 * 
 * ARQUITETURA ISOLADA: Não reutiliza módulos de _shared/extraction para manter
 * isolamento e permitir evoluções independentes (ex: schema enriquecido com metadata).
 * 
 * FLUXO:
 * 1. Validação de entrada (projectId, articleId, templateId, entityTypeId)
 * 2. Autenticação do usuário
 * 3. Busca do PDF no storage (via article_files)
 * 4. Download do PDF
 * 5. Execução do pipeline de extração (isolado)
 * 6. Retorno do resultado (runId, sugestões criadas, metadata)
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { Logger } from "../_shared/core/logger.ts";
import { ErrorHandler, AppError, ErrorCode } from "../_shared/core/error-handler.ts";
import { z } from "npm:zod@3.23.8";
import { Validator } from "../_shared/core/validation.ts";
import { corsHeaders } from "../_shared/core/cors.ts";
import { authenticateUser } from "../_shared/core/auth.ts";
import { SectionExtractionPipeline } from "./pipeline.ts";
import { CONFIG } from "./config.ts";

// Declarações de tipos do Deno (ambiente de execução)
declare const Deno: {
  env: { get(key: string): string | undefined };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

/**
 * Schema de validação do request
 * 
 * DIFERENCIAL: Inclui entityTypeId (obrigatório) para identificar qual seção extrair
 * NOVO: Suporta extractAllSections para extrair todas as seções de um modelo
 */
const SectionExtractionRequestSchema = z.object({
  projectId: z.string().uuid("projectId must be a valid UUID"),
  articleId: z.string().uuid("articleId must be a valid UUID"),
  templateId: z.string().uuid("templateId must be a valid UUID"),
  entityTypeId: z.string().uuid("entityTypeId must be a valid UUID").optional(), // Opcional quando extractAllSections=true
  parentInstanceId: z.string().uuid("parentInstanceId must be a valid UUID").optional(), // Nova: para filtrar child entities por modelo
  extractAllSections: z.boolean().optional(), // Novo: flag para extrair todas as seções do modelo
  sectionIds: z.array(z.string().uuid()).optional(), // NOVO: Filtrar seções específicas (para chunking)
  pdfText: z.string().optional(), // NOVO: Texto do PDF já processado (evita reprocessar)
  options: z
    .object({
      model: z.enum(["gpt-4o-mini", "gpt-4o", "gpt-5"]).optional(),
    })
    .optional(),
}).refine(
  (data) => {
    // Se extractAllSections=true, parentInstanceId é obrigatório
    if (data.extractAllSections && !data.parentInstanceId) {
      return false;
    }
    // Se extractAllSections=false ou undefined, entityTypeId é obrigatório
    if (!data.extractAllSections && !data.entityTypeId) {
      return false;
    }
    return true;
  },
  {
    message: "When extractAllSections is true, parentInstanceId is required. When extractAllSections is false or undefined, entityTypeId is required.",
  }
);

type SectionExtractionRequest = z.infer<typeof SectionExtractionRequestSchema>;

/**
 * Handler principal da Edge Function
 * 
 * Processa requisições POST para extração de seção específica.
 * 
 * @param req - Request HTTP com body JSON contendo parâmetros de extração
 * @returns Response JSON com resultado da extração ou erro
 */
Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Gerar trace ID para rastreabilidade (usado em logs estruturados)
  const traceId = req.headers.get("x-client-trace-id") || crypto.randomUUID();
  const logger = new Logger({ traceId });

  try {
    // ==================== 1. PARSE E VALIDAÇÃO ====================
    // Parse do body JSON com tratamento de erro
    const body = await req.json().catch(() => {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid JSON body", 400);
    });

    // Validação do schema usando Zod
    // Isso garante que todos os campos obrigatórios estão presentes e com tipos corretos
    const input: SectionExtractionRequest = Validator.validate(SectionExtractionRequestSchema, body);

    // ==================== 2. AUTENTICAÇÃO ====================
    const authHeader = req.headers.get("Authorization");
    const { user, supabase } = await authenticateUser(authHeader, logger);

    // Criar logger filho com contexto completo para rastreabilidade
    const contextualLogger = logger.child({
      userId: user.id,
      projectId: input.projectId,
      articleId: input.articleId,
      templateId: input.templateId,
      entityTypeId: input.entityTypeId,
    });

    contextualLogger.info("Section extraction request authenticated", {
      entityTypeId: input.entityTypeId,
      model: input.options?.model || "gpt-4o-mini", // Padrão: gpt-4o-mini (mais rápido e estável)
    });

    // ==================== 3. BUSCAR PDF DO ARTIGO ====================
    // Buscar o arquivo PDF mais recente associado ao artigo
    // TODO: Considerar permitir seleção de PDF específico via parâmetro
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
    // Verificar se OPENAI_API_KEY está configurada
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, "OPENAI_API_KEY not configured", 500);
    }

    // Criar instância do pipeline isolado
    // O pipeline encapsula toda a lógica de extração: processamento de PDF,
    // construção de schema, extração com LLM, e salvamento no banco
    const pipeline = new SectionExtractionPipeline(supabase, OPENAI_API_KEY, contextualLogger);

    // Roteamento: extrair todas as seções ou apenas uma
    let result;
    if (input.extractAllSections) {
      // Extrair todas as seções do modelo com memória resumida
      contextualLogger.info("Extracting all sections with memory", {
        parentInstanceId: input.parentInstanceId,
        model: input.options?.model || "gpt-4o-mini",
      });
      
      result = await pipeline.runAllSectionsWithMemory(pdfBuffer, {
        projectId: input.projectId,
        articleId: input.articleId,
        templateId: input.templateId,
        parentInstanceId: input.parentInstanceId!, // Já validado pelo schema
        userId: user.id,
        model: input.options?.model,
        sectionIds: input.sectionIds, // NOVO: Filtrar seções específicas se fornecido
        pdfText: input.pdfText, // NOVO: Texto do PDF já processado se fornecido
      });

      contextualLogger.info("Batch section extraction completed", {
        totalSections: result.totalSections,
        successfulSections: result.successfulSections,
        failedSections: result.failedSections,
        totalSuggestionsCreated: result.totalSuggestionsCreated,
      });
    } else {
      // Extração de seção única (comportamento original)
      result = await pipeline.run(pdfBuffer, {
        projectId: input.projectId,
        articleId: input.articleId,
        templateId: input.templateId,
        entityTypeId: input.entityTypeId!, // Já validado pelo schema
        userId: user.id,
        model: input.options?.model,
        parentInstanceId: input.parentInstanceId, // Nova: filtrar por modelo específico
      });

      contextualLogger.info("Section extraction pipeline completed successfully", {
        runId: result.runId,
        suggestionsCreated: result.suggestionsCreated,
        entityTypeId: input.entityTypeId,
      });
    }

    // ==================== 6. RETORNAR RESULTADO ====================
    // Retornar resposta JSON com resultado da extração
    // O frontend usará runId para rastrear sugestões criadas
    return new Response(JSON.stringify({ ok: true, data: result, traceId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    // Tratamento centralizado de erros
    // ErrorHandler formata erros de forma consistente e adiciona logs
    return ErrorHandler.handle(error, logger);
  }
});

