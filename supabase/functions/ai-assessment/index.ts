// @ts-nocheck
// Edge Function: AI Assessment lendo o PDF diretamente (OpenAI Responses API)
// Suporta: pdf_storage_key (Supabase Storage), pdf_base64, pdf_file_id (OpenAI Files)
// Fallback automático >32MB (ou force_file_search): File Search + Vector Store

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Minimal ambient declaration so TS/ESLint in Node workspace accepts Deno globals
declare const Deno: {
  env: { get(key: string): string | undefined };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

// --- CORS ---
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-trace-id, x-debug, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// --- logging util ---
const now = () => Date.now();
const dur = (t: number) => `${Date.now() - t}ms`;
const jlog = (
  level: "info" | "warn" | "error",
  traceId: string,
  msg: string,
  extra: Record<string, unknown> = {}
) =>
  console[level === "error" ? "error" : level === "warn" ? "warn" : "log"](
    JSON.stringify({ level, traceId, msg, ...extra })
  );

// --- util: placeholder (antes removia response_format; agora não altera o payload) ---
function stripResponseFormat(_obj: any): void {
  // no-op: mantemos response_format para Structured Outputs da Responses API
}

// --- util: extrai output_text do Responses API ---
function extractOutputText(resp: any): string | undefined {
  const arr = resp?.output;
  if (Array.isArray(arr)) {
    for (const n of arr) {
      if (n?.type === "message" && Array.isArray(n?.content)) {
        const t = n.content.find((c: any) => c?.type === "output_text");
        if (t?.text) return t.text;
      }
    }
  }
  return resp?.output_text;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const traceId = req.headers.get("x-client-trace-id") || crypto.randomUUID();
  const t0 = now();
  jlog("info", traceId, "Invocation start", { method: req.method });

  try {
    // 1) Body
    const tBody = now();
    let body: any = {};
    try {
      body = await req.json();
    } catch (e) {
      jlog("error", traceId, "Invalid JSON body", { error: String(e) });
      return new Response(
        JSON.stringify({ error: "Invalid JSON body", traceId }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const {
      projectId,
      articleId,
      assessmentItemId,
      instrumentId,
      // novos campos p/ PDF direto:
      pdf_storage_key, // ex: "articles/123/meu.pdf"
      pdf_base64, // base64 puro (sem data:) do PDF
      pdf_filename, // nome do arquivo quando usar base64 (ex: "artigo.pdf")
      pdf_file_id, // file_id já existente no OpenAI Files
      force_file_search, // boolean opcional para forçar RAG
    } = body ?? {};

    jlog("info", traceId, "Body", {
      have: Object.keys(body || {}),
      ids: !!projectId && !!articleId && !!assessmentItemId && !!instrumentId,
      took: dur(tBody),
    });

    if (!projectId || !articleId || !assessmentItemId || !instrumentId) {
      return new Response(
        JSON.stringify({
          error:
            "Missing required fields: projectId, articleId, assessmentItemId, instrumentId",
          traceId,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2) Env
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY || !OPENAI_API_KEY) {
      jlog("error", traceId, "Missing env vars");
      throw new Error("Missing env vars (URL/ANON_KEY/SERVICE_ROLE_KEY/OPENAI_API_KEY)");
    }

    // 3) Auth (RLS ON)
    const tAuth = now();
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized (missing bearer)", traceId }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const jwt = authHeader.replace("Bearer ", "");
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser(jwt);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized", traceId }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    jlog("info", traceId, "Auth OK", { userId: user.id, took: dur(tAuth) });

    // 4) Metadados necessários
    const tSel = now();
    const { data: item, error: itemErr } = await userClient
      .from("assessment_items")
      .select("*")
      .eq("id", assessmentItemId)
      .single();
    if (itemErr) throw new Error(`Failed to fetch assessment item: ${itemErr.message}`);

    const { data: article, error: artErr } = await userClient
      .from("articles")
      .select("*")
      .eq("id", articleId)
      .single();
    if (artErr) throw new Error(`Failed to fetch article: ${artErr.message}`);

    // Buscar dados do projeto para variáveis do template
    const { data: project, error: projErr } = await userClient
      .from("projects")
      .select("description, review_title, condition_studied, eligibility_criteria, study_design")
      .eq("id", projectId)
      .single();
    if (projErr) throw new Error(`Failed to fetch project: ${projErr.message}`);

    // Tentar descobrir storage key do PDF se não for informada
    let storageKey = pdf_storage_key as string | undefined;
    if (!storageKey) {
      const { data: files, error: fErr } = await userClient
        .from("article_files")
        .select("storage_key, file_type, created_at")
        .eq("article_id", articleId)
        .ilike("file_type", "%pdf%")
        .order("created_at", { ascending: false })
        .limit(1);
      if (fErr) throw new Error(`Failed to fetch article files: ${fErr.message}`);
      const f = (files?.[0] as { storage_key?: string } | undefined);
      storageKey = f?.storage_key || undefined;
    }

    jlog("info", traceId, "DB selects OK", {
      item_id: item.id,
      article_id: article.id,
      storageKeyFound: !!storageKey,
      took: dur(tSel),
    });

    // 5) Preparar arquivo p/ OpenAI (File Inputs)
    type InputFileNode =
      | { type: "input_file"; file_id: string }
      | { type: "input_file"; file_data: string; filename?: string };

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    let inputFileNode: InputFileNode | null = null;
    let approxSizeBytes = 0;

    if (pdf_file_id) {
      // Caso 1: já tem file_id do OpenAI
      inputFileNode = { type: "input_file", file_id: pdf_file_id };
      approxSizeBytes = 0; // desconhecido
      jlog("info", traceId, "Using pdf_file_id", { pdf_file_id });
    } else if (pdf_base64) {
      // Caso 2: base64 fornecido
      inputFileNode = {
        type: "input_file",
        file_data: `data:application/pdf;base64,${pdf_base64}`,
        filename: pdf_filename || "article.pdf",
      };
      approxSizeBytes = Math.floor((pdf_base64.length * 3) / 4);
      jlog("info", traceId, "Using pdf_base64", { approxSizeBytes });
    } else if (storageKey) {
      // Caso 3: baixar do Storage e subir via Files API (purpose user_data)
      const tDw = now();
      const { data: blob, error: dwErr } = await adminClient.storage
        .from("articles")
        .download(storageKey);
      if (dwErr) throw new Error(`Failed to download PDF from storage: ${dwErr.message}`);
      approxSizeBytes = (blob as Blob).size;
      jlog("info", traceId, "Downloaded PDF from storage", {
        storageKey,
        size: approxSizeBytes,
        took: dur(tDw),
      });

      const form = new FormData();
      form.append("purpose", "user_data");
      form.append("file", blob, storageKey.split("/").pop() || "article.pdf");
      const tUp = now();
      const up = await fetch("https://api.openai.com/v1/files", {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: form,
      });
      if (!up.ok) {
        const txt = await up.text();
        jlog("error", traceId, "Files upload error", {
          status: up.status,
          body_head: txt.slice(0, 800),
        });
        throw new Error(`OpenAI Files upload error: ${up.status} - ${txt}`);
      }
      const upJson = await up.json();
      inputFileNode = { type: "input_file", file_id: upJson.id };
      jlog("info", traceId, "Files uploaded (user_data)", {
        file_id: upJson.id,
        took: dur(tUp),
      });
    } else {
      throw new Error("No PDF provided. Send pdf_storage_key or pdf_base64 or pdf_file_id.");
    }

    // 6) Prompt & schema
    const { data: promptCfg } = await userClient
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

    // Processar variáveis do template
    let userPrompt = userPromptTemplate
      .replace("{{question}}", item?.question ?? "")
      .replace("{{levels}}", (allowedLevels ?? []).join(", "));

    // Processar variáveis do projeto
    if (project) {
      userPrompt = userPrompt
        .replace("{{description}}", project.description ?? "")
        .replace("{{review_title}}", project.review_title ?? "")
        .replace("{{condition_studied}}", project.condition_studied ?? "")
        .replace("{{eligibility_criteria}}", 
          typeof project.eligibility_criteria === 'object' 
            ? JSON.stringify(project.eligibility_criteria) 
            : (project.eligibility_criteria ?? ""))
        .replace("{{study_design}}", 
          typeof project.study_design === 'object' 
            ? JSON.stringify(project.study_design) 
            : (project.study_design ?? ""));
    }

    // Fallback de schema quando allowedLevels está vazio (evita enum: [])
    const levelProp =
      Array.isArray(allowedLevels) && allowedLevels.length > 0
        ? { type: "string", enum: allowedLevels }
        : { type: "string", description: "Freeform level (no allowed_levels configured)" };

    // Structured Outputs na Responses API com response_format: json_schema
    const responseFormat = {
      type: "json_schema",
      name: "assessment_response",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          selected_level: levelProp,
          confidence_score: { type: "number" },
          justification: { type: "string" },
          evidence_passages: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                text: { type: "string" },
                page_number: { type: "number" },
                relevance_score: { type: "number" },
              },
              required: ["text", "page_number", "relevance_score"],
            },
          },
        },
        required: [
          "selected_level",
          "confidence_score",
          "justification",
          "evidence_passages",
        ],
      },
    } as const;

    // 7) Escolha do caminho: input_file direto OU File Search com Vector Store
    const SIZE_LIMIT = 32 * 1024 * 1024; // ~32MB
    const useFileSearch =
      force_file_search === true || (approxSizeBytes && approxSizeBytes > SIZE_LIMIT);

    // Usar sempre gpt-5-mini para melhor custo-efetividade
    const model = "gpt-5-mini";
    jlog("info", traceId, "AI path", { model, useFileSearch, approxSizeBytes });

    let aiJson: any;
    const tAI = now();

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
        if (!up2.ok)
          throw new Error(
            `OpenAI Files upload (assistants) failed: ${up2.status} - ${await up2.text()}`
          );
        const j2 = await up2.json();
        assistantsFileId = j2.id;
      } else if ("file_id" in (inputFileNode as any)) {
        assistantsFileId = (inputFileNode as any).file_id;
      }

      // cria vector store
      const vs = await fetch("https://api.openai.com/v1/vector_stores", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: `ai-assessment-${crypto.randomUUID()}` }),
      });
      if (!vs.ok) throw new Error(`Vector Store create error: ${vs.status} - ${await vs.text()}`);
      const vsJson = await vs.json();
      const vectorStoreId = vsJson.id as string;

      // anexa arquivo
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
      if (!attach.ok)
        throw new Error(
          `Vector Store attach error: ${attach.status} - ${await attach.text()}`
        );

      // responses + tool:file_search
      const payload = {
        model,
        input: [
          { role: "system", content: [{ type: "input_text", text: systemPrompt }] },
          { role: "user", content: [{ type: "input_text", text: userPrompt }] },
        ],
        tools: [{ type: "file_search", vector_store_ids: [vectorStoreId] }],
        text: { format: responseFormat }, // <- structured outputs no Responses
        // Nota: temperature não é suportado na Responses API
      };
      stripResponseFormat(payload); // preservado por compat
      jlog("info", traceId, "OpenAI payload keys (file_search)", {
        keys: Object.keys(payload),
        has_response_format: "response_format" in (payload as any),
      });

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
        jlog("error", traceId, "OpenAI Responses error (file_search)", {
          status: res.status,
          body_head: txt.slice(0, 4000),
        });
        throw new Error(`OpenAI Responses (file_search) error: ${res.status} - ${txt}`);
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
              inputFileNode!, // <— o PDF
              { type: "input_text", text: userPrompt }, // instruções
            ],
          },
        ],
        text: { format: responseFormat }, // <- structured outputs no Responses
        // Nota: temperature não é suportado na Responses API
      };
      stripResponseFormat(payload); // preservado por compat
      jlog("info", traceId, "OpenAI payload keys (input_file)", {
        keys: Object.keys(payload),
        has_response_format: "response_format" in (payload as any),
      });

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
        jlog("error", traceId, "OpenAI Responses error (input_file)", {
          status: res.status,
          body_head: txt.slice(0, 4000),
        });
        throw new Error(`OpenAI Responses error: ${res.status} - ${txt}`);
      }
      aiJson = await res.json();
    }

    jlog("info", traceId, "OpenAI response received", {
      took: dur(tAI),
      usage: aiJson?.usage ?? null,
    });

    const raw = extractOutputText(aiJson);
    if (!raw) throw new Error("OpenAI returned response without output_text");

    let assessmentResult: any;
    try {
      assessmentResult = JSON.parse(raw);
    } catch {
      jlog("error", traceId, "Failed to parse JSON from model", {
        preview: raw.slice(0, 400),
      });
      throw new Error("Model returned non-JSON content");
    }

    const inputTokens = aiJson?.usage?.input_tokens ?? null;
    const outputTokens = aiJson?.usage?.output_tokens ?? null;

    // 8) Persistência (INSERT para permitir múltiplas avaliações)
    const tSave = now();
    const adminDb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    // Dados para inserir
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
      processing_time_ms: Date.now() - tAI,
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      status: "pending_review",
    };

    // INSERT: sempre insere nova avaliação (múltiplas avaliações permitidas)
    const { data: saved, error: saveError } = await adminDb
      .from("ai_assessments")
      .insert(assessmentData)
      .select()
      .single();
      
    if (saveError) throw new Error(`Failed to save: ${saveError.message}`);
    
    jlog("info", traceId, "Saved assessment (insert)", { 
      id: saved.id, 
      took: dur(tSave) 
    });

    jlog("info", traceId, "Invocation OK", { total: dur(t0) });
    return new Response(
      JSON.stringify({ success: true, assessment: saved, traceId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json", "x-trace-id": traceId } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    jlog("error", traceId, "Unhandled error", { message, stack });
    return new Response(JSON.stringify({ error: message, traceId }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json", "x-trace-id": traceId },
    });
  }
});