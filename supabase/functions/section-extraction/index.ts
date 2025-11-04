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
import { SectionExtractionPipeline } from "./pipeline.ts";
import { CONFIG } from "./config.ts";

// Declarações de tipos do Deno (ambiente de execução)
declare const Deno: {
  env: { get(key: string): string | undefined };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

/**
 * Headers CORS para permitir requisições do frontend
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-client-trace-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * Schema de validação do request
 * 
 * DIFERENCIAL: Inclui entityTypeId (obrigatório) para identificar qual seção extrair
 */
const SectionExtractionRequestSchema = z.object({
  projectId: z.string().uuid("projectId must be a valid UUID"),
  articleId: z.string().uuid("articleId must be a valid UUID"),
  templateId: z.string().uuid("templateId must be a valid UUID"),
  entityTypeId: z.string().uuid("entityTypeId must be a valid UUID"), // Nova: seção específica
  parentInstanceId: z.string().uuid("parentInstanceId must be a valid UUID").optional(), // Nova: para filtrar child entities por modelo
  options: z
    .object({
      model: z.enum(["gpt-4o-mini", "gpt-4o", "gpt-5"]).optional(),
    })
    .optional(),
});

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
    // Validar header de autorização
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new AppError(ErrorCode.AUTH_ERROR, "Missing authorization", 401);
    }

    // Buscar variáveis de ambiente (configuradas no dashboard Supabase)
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, "Server configuration error", 500);
    }

    // Criar cliente Supabase com autorização do usuário
    // Service role key permite acesso completo, mas mantemos autorização do usuário
    // para logging e auditoria
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verificar se o usuário está autenticado
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      throw new AppError(ErrorCode.AUTH_ERROR, "Unauthorized", 401);
    }

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
      model: input.options?.model || "gpt-4o", // Padrão: gpt-4o (mais econômico)
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

    // Executar pipeline com todos os parâmetros necessários
    const result = await pipeline.run(pdfBuffer, {
      projectId: input.projectId,
      articleId: input.articleId,
      templateId: input.templateId,
      entityTypeId: input.entityTypeId, // Seção específica a extrair
      userId: user.id,
      model: input.options?.model,
      parentInstanceId: input.parentInstanceId, // Nova: filtrar por modelo específico
    });

    contextualLogger.info("Section extraction pipeline completed successfully", {
      runId: result.runId,
      suggestionsCreated: result.suggestionsCreated,
      entityTypeId: input.entityTypeId,
    });

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

