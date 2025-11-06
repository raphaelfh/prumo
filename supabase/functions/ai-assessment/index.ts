/**
 * Edge Function: AI Assessment lendo o PDF diretamente (OpenAI Responses API)
 * Suporta: pdf_storage_key (Supabase Storage), pdf_base64, pdf_file_id (OpenAI Files)
 * Fallback automático >32MB (ou force_file_search): File Search + Vector Store
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/core/cors.ts";
import { authenticateUser } from "../_shared/core/auth.ts";
import { Logger } from "../_shared/core/logger.ts";
import { ErrorHandler, AppError, ErrorCode } from "../_shared/core/error-handler.ts";
import { checkRateLimit } from "../_shared/core/rate-limiter.ts";
import {
  extractOutputText,
  preparePDFFile,
  buildResponseSchema,
  processPromptTemplate,
} from "./helpers.ts";

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const traceId = req.headers.get("x-client-trace-id") || crypto.randomUUID();
  const logger = new Logger({ traceId });
  const startTime = performance.now();

  try {
    // 1) Parse body
    let body: any = {};
    try {
      body = await req.json();
    } catch (e) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        "Invalid JSON body",
        400,
        { error: String(e) }
      );
    }

    const {
      projectId,
      articleId,
      assessmentItemId,
      instrumentId,
      pdf_storage_key,
      pdf_base64,
      pdf_filename,
      pdf_file_id,
      force_file_search,
    } = body ?? {};

    // Validar campos obrigatórios
    if (!projectId || !articleId || !assessmentItemId || !instrumentId) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        "Missing required fields: projectId, articleId, assessmentItemId, instrumentId",
        400
      );
    }

    // 2) Verificar variáveis de ambiente
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !OPENAI_API_KEY) {
      throw new AppError(
        ErrorCode.INTERNAL_ERROR,
        "Missing env vars (SUPABASE_URL/SERVICE_ROLE_KEY/OPENAI_API_KEY)",
        500
      );
    }

    // 3) Autenticação
    const authHeader = req.headers.get("Authorization");
    const { user, supabase } = await authenticateUser(authHeader, logger);
    logger.info("Auth OK", { userId: user.id });

    // 3.1) Rate limiting: 10/min por user_id
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const rateLimitKey = `ai-assessment:user:${user.id}`;
    const rateLimit = await checkRateLimit(adminClient, rateLimitKey, 10, 60);
    
    if (!rateLimit.allowed) {
      throw new AppError(
        ErrorCode.INTERNAL_ERROR,
        "Rate limit exceeded. Maximum 10 requests per minute.",
        429,
        { remaining: rateLimit.remaining }
      );
    }
    
    logger.info("Rate limit check passed", { remaining: rateLimit.remaining });

    // 4) Buscar metadados (paralelizar queries independentes)
    const [itemResult, articleResult, projectResult] = await Promise.all([
      supabase
        .from("assessment_items")
        .select("*")
        .eq("id", assessmentItemId)
        .single(),
      supabase
        .from("articles")
        .select("*")
        .eq("id", articleId)
        .single(),
      supabase
        .from("projects")
        .select("description, review_title, condition_studied, eligibility_criteria, study_design")
        .eq("id", projectId)
        .single(),
    ]);

    if (itemResult.error) {
      throw new AppError(
        ErrorCode.DB_ERROR,
        `Failed to fetch assessment item: ${itemResult.error.message}`,
        500
      );
    }
    if (articleResult.error) {
      throw new AppError(
        ErrorCode.DB_ERROR,
        `Failed to fetch article: ${articleResult.error.message}`,
        500
      );
    }
    if (projectResult.error) {
      throw new AppError(
        ErrorCode.DB_ERROR,
        `Failed to fetch project: ${projectResult.error.message}`,
        500
      );
    }

    const item = itemResult.data;
    const article = articleResult.data;
    const project = projectResult.data;

    // Tentar descobrir storage key do PDF se não for informada
    let storageKey = pdf_storage_key as string | undefined;
    if (!storageKey) {
      const { data: files, error: fErr } = await supabase
        .from("article_files")
        .select("storage_key, file_type, created_at")
        .eq("article_id", articleId)
        .ilike("file_type", "%pdf%")
        .order("created_at", { ascending: false })
        .limit(1);
      if (fErr) {
        throw new AppError(
          ErrorCode.DB_ERROR,
          `Failed to fetch article files: ${fErr.message}`,
          500
        );
      }
      storageKey = files?.[0]?.storage_key || undefined;
    }

    logger.info("DB selects OK", {
      item_id: item.id,
      article_id: article.id,
      storageKeyFound: !!storageKey,
    });

    // 5) Preparar arquivo para OpenAI
    const { inputFileNode, approxSizeBytes } = await preparePDFFile(
      pdf_file_id,
      pdf_base64,
      pdf_filename,
      storageKey,
      adminClient,
      logger,
      traceId
    );

    // 6) Construir prompt e schema
    const { data: promptCfg } = await supabase
      .from("ai_assessment_prompts")
      .select("*")
      .eq("assessment_item_id", assessmentItemId)
      .maybeSingle();

    const systemPrompt =
      promptCfg?.system_prompt ??
      "You are an expert research quality assessor. Read the PDF and answer the specific question based on the evidence found in the document. Quote page numbers.";

    const allowedLevels: string[] = Array.isArray(item?.allowed_levels)
      ? item.allowed_levels
      : (() => {
          try {
            return item?.allowed_levels ? JSON.parse(item.allowed_levels) : [];
          } catch {
            return [];
          }
        })();

    const userPromptTemplate =
      promptCfg?.user_prompt_template ??
      "Based on the article PDF, assess: {{question}}\nAvailable response levels: {{levels}}\nReturn STRICT JSON with your choice, confidence, justification and evidence passages (with page_number).";

    const userPrompt = processPromptTemplate(userPromptTemplate, item, project, allowedLevels);
    const responseFormat = buildResponseSchema(allowedLevels);

    // 7) Escolher caminho: input_file direto OU File Search com Vector Store
    const SIZE_LIMIT = 32 * 1024 * 1024; // ~32MB
    const useFileSearch =
      force_file_search === true || (approxSizeBytes && approxSizeBytes > SIZE_LIMIT);

    const model = "gpt-5-mini";
    logger.info("AI path", { model, useFileSearch, approxSizeBytes });

    const aiStartTime = performance.now();
    let aiJson: any;

    if (useFileSearch) {
      // --- RAG gerenciado: Vector Store + tool:file_search (Responses API) ---
      let assistantsFileId: string | null = null;

      if ("file_data" in (inputFileNode as any)) {
        const dataUrl = (inputFileNode as any).file_data as string;
        const fname = (inputFileNode as any).filename || "article.pdf";
        const blob = await (await fetch(dataUrl)).blob();
        const form2 = new FormData();
        form2.append("purpose", "assistants");
        form2.append("file", blob, fname);
        const up2 = await fetch("https://api.openai.com/v1/files", {
          method: "POST",
          headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
          body: form2,
        });
        if (!up2.ok) {
          throw new AppError(
            ErrorCode.LLM_ERROR,
            `OpenAI Files upload (assistants) failed: ${up2.status} - ${await up2.text()}`,
            500
          );
        }
        const j2 = await up2.json();
        assistantsFileId = j2.id;
      } else if ("file_id" in (inputFileNode as any)) {
        assistantsFileId = (inputFileNode as any).file_id;
      }

      // Criar vector store
      const vs = await fetch("https://api.openai.com/v1/vector_stores", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: `ai-assessment-${crypto.randomUUID()}` }),
      });
      if (!vs.ok) {
        throw new AppError(
          ErrorCode.LLM_ERROR,
          `Vector Store create error: ${vs.status} - ${await vs.text()}`,
          500
        );
      }
      const vsJson = await vs.json();
      const vectorStoreId = vsJson.id as string;

      // Anexar arquivo
      const attach = await fetch(
        `https://api.openai.com/v1/vector_stores/${vectorStoreId}/files`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ file_id: assistantsFileId }),
        }
      );
      if (!attach.ok) {
        throw new AppError(
          ErrorCode.LLM_ERROR,
          `Vector Store attach error: ${attach.status} - ${await attach.text()}`,
          500
        );
      }

      // Responses + tool:file_search
      const payload = {
        model,
        input: [
          { role: "system", content: [{ type: "input_text", text: systemPrompt }] },
          { role: "user", content: [{ type: "input_text", text: userPrompt }] },
        ],
        tools: [{ type: "file_search", vector_store_ids: [vectorStoreId] }],
        text: { format: responseFormat },
      };

      const res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const txt = await res.text();
        logger.error("OpenAI Responses error (file_search)", {
          status: res.status,
          body_head: txt.slice(0, 4000),
        });
        throw new AppError(
          ErrorCode.LLM_ERROR,
          `OpenAI Responses (file_search) error: ${res.status}`,
          500,
          { body: txt.slice(0, 4000) }
        );
      }
      aiJson = await res.json();
    } else {
      // --- Caminho direto com "input_file" ---
      const payload = {
        model,
        input: [
          { role: "system", content: [{ type: "input_text", text: systemPrompt }] },
          {
            role: "user",
            content: [
              inputFileNode, // <— o PDF
              { type: "input_text", text: userPrompt }, // instruções
            ],
          },
        ],
        text: { format: responseFormat },
      };

      const res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const txt = await res.text();
        logger.error("OpenAI Responses error (input_file)", {
          status: res.status,
          body_head: txt.slice(0, 4000),
        });
        throw new AppError(
          ErrorCode.LLM_ERROR,
          `OpenAI Responses error: ${res.status}`,
          500,
          { body: txt.slice(0, 4000) }
        );
      }
      aiJson = await res.json();
    }

    const aiDuration = performance.now() - aiStartTime;
    logger.info("OpenAI response received", {
      duration: `${aiDuration.toFixed(2)}ms`,
      usage: aiJson?.usage ?? null,
    });

    // Processar resposta
    const raw = extractOutputText(aiJson);
    if (!raw) {
      throw new AppError(
        ErrorCode.LLM_ERROR,
        "OpenAI returned response without output_text",
        500
      );
    }

    let assessmentResult: any;
    try {
      assessmentResult = JSON.parse(raw);
    } catch {
      logger.error("Failed to parse JSON from model", {
        preview: raw.slice(0, 400),
      });
      throw new AppError(
        ErrorCode.LLM_ERROR,
        "Model returned non-JSON content",
        500
      );
    }

    const inputTokens = aiJson?.usage?.input_tokens ?? null;
    const outputTokens = aiJson?.usage?.output_tokens ?? null;

    // 8) Persistência
    const assessmentData = {
      project_id: projectId,
      article_id: articleId,
      assessment_item_id: assessmentItemId,
      instrument_id: instrumentId,
      user_id: user.id,
      selected_level: assessmentResult.selected_level,
      confidence_score: assessmentResult.confidence_score,
      justification: assessmentResult.justification,
      evidence_passages: assessmentResult.evidence_passages,
      ai_model_used: model,
      processing_time_ms: Math.round(aiDuration),
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      status: "pending_review",
    };

    const { data: saved, error: saveError } = await adminClient
      .from("ai_assessments")
      .insert(assessmentData)
      .select()
      .single();

    if (saveError) {
      throw new AppError(
        ErrorCode.DB_ERROR,
        `Failed to save: ${saveError.message}`,
        500
      );
    }

    logger.info("Saved assessment", { id: saved.id });

    const totalDuration = performance.now() - startTime;
    logger.info("Invocation OK", { total: `${totalDuration.toFixed(2)}ms` });

    return new Response(
      JSON.stringify({ ok: true, data: { assessment: saved }, traceId }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "x-trace-id": traceId,
        },
      }
    );
  } catch (error) {
    return ErrorHandler.handle(error, logger);
  }
});
