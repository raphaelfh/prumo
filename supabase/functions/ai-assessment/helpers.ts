/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * Helpers locais para AI Assessment Edge Function
 * 
 * Funções auxiliares específicas desta função, não compartilhadas.
 */

type InputFileNode =
  | { type: "input_file"; file_id: string }
  | { type: "input_file"; file_data: string; filename?: string };

/**
 * Extrai output_text do Responses API
 */
export function extractOutputText(resp: any): string | undefined {
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

/**
 * Prepara arquivo para OpenAI (File Inputs)
 * Retorna InputFileNode e tamanho aproximado
 */
export async function preparePDFFile(
  pdf_file_id: string | undefined,
  pdf_base64: string | undefined,
  pdf_filename: string | undefined,
  pdf_storage_key: string | undefined,
  adminClient: any,
  logger: { info: (msg: string, data?: any) => void; error: (msg: string, data?: any) => void },
  traceId: string,
): Promise<{ inputFileNode: InputFileNode; approxSizeBytes: number }> {
  const now = () => Date.now();
  const dur = (t: number) => `${Date.now() - t}ms`;

  if (pdf_file_id) {
    // Caso 1: já tem file_id do OpenAI
    logger.info("Using pdf_file_id", { pdf_file_id, traceId });
    return {
      inputFileNode: { type: "input_file", file_id: pdf_file_id },
      approxSizeBytes: 0, // desconhecido
    };
  }

  if (pdf_base64) {
    // Caso 2: base64 fornecido
    const approxSizeBytes = Math.floor((pdf_base64.length * 3) / 4);
    logger.info("Using pdf_base64", { approxSizeBytes, traceId });
    return {
      inputFileNode: {
        type: "input_file",
        file_data: `data:application/pdf;base64,${pdf_base64}`,
        filename: pdf_filename || "article.pdf",
      },
      approxSizeBytes,
    };
  }

  if (pdf_storage_key) {
    // Caso 3: baixar do Storage e subir via Files API (purpose user_data)
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY not configured");
    }

    const tDw = now();
    const { data: blob, error: dwErr } = await adminClient.storage
      .from("articles")
      .download(pdf_storage_key);
    if (dwErr) throw new Error(`Failed to download PDF from storage: ${dwErr.message}`);
    const approxSizeBytes = (blob as Blob).size;
    logger.info("Downloaded PDF from storage", {
      storageKey: pdf_storage_key,
      size: approxSizeBytes,
      took: dur(tDw),
      traceId,
    });

    const form = new FormData();
    form.append("purpose", "user_data");
    form.append("file", blob, pdf_storage_key.split("/").pop() || "article.pdf");
    const tUp = now();
    const up = await fetch("https://api.openai.com/v1/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form,
    });
    if (!up.ok) {
      const txt = await up.text();
      logger.error("Files upload error", {
        status: up.status,
        body_head: txt.slice(0, 800),
        traceId,
      });
      throw new Error(`OpenAI Files upload error: ${up.status} - ${txt}`);
    }
    const upJson = await up.json();
    logger.info("Files uploaded (user_data)", {
      file_id: upJson.id,
      took: dur(tUp),
      traceId,
    });

    return {
      inputFileNode: { type: "input_file", file_id: upJson.id },
      approxSizeBytes,
    };
  }

  throw new Error("No PDF provided. Send pdf_storage_key or pdf_base64 or pdf_file_id.");
}

/**
 * Constrói schema de resposta para OpenAI
 */
export function buildResponseSchema(allowedLevels: string[]) {
  const levelProp =
    Array.isArray(allowedLevels) && allowedLevels.length > 0
      ? { type: "string", enum: allowedLevels }
      : { type: "string", description: "Freeform level (no allowed_levels configured)" };

  return {
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
}

/**
 * Processa template de prompt substituindo variáveis
 */
export function processPromptTemplate(
  template: string,
  item: any,
  project: any,
  allowedLevels: string[]
): string {
  let prompt = template
    .replace("{{question}}", item?.question ?? "")
    .replace("{{levels}}", (allowedLevels ?? []).join(", "));

  if (project) {
    prompt = prompt
      .replace("{{description}}", project.description ?? "")
      .replace("{{review_title}}", project.review_title ?? "")
      .replace("{{condition_studied}}", project.condition_studied ?? "")
      .replace(
        "{{eligibility_criteria}}",
        typeof project.eligibility_criteria === "object"
          ? JSON.stringify(project.eligibility_criteria)
          : (project.eligibility_criteria ?? "")
      )
      .replace(
        "{{study_design}}",
        typeof project.study_design === "object"
          ? JSON.stringify(project.study_design)
          : (project.study_design ?? "")
      );
  }

  return prompt;
}

