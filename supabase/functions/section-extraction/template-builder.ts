/**
 * Template Builder para Section Extraction
 * 
 * Responsável por construir schema Zod enriquecido e prompt para extração de uma seção específica.
 * 
 * DIFERENCIAL CRÍTICO: Schema inclui metadata (confidence_score, reasoning, evidence)
 * para cada campo extraído, seguindo melhores práticas de IA observável e interpretável.
 * 
 * ARQUITETURA:
 * - Busca entity_type e fields do banco
 * - Constrói schema Zod com estrutura enriquecida:
 *   { fieldName: { value, confidence_score, reasoning, evidence } }
 * - Gera prompt com instruções para Chain-of-Thought e citações
 */

import { z } from "npm:zod@3.23.8";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { Logger } from "../_shared/core/logger.ts";
import { AppError, ErrorCode } from "../_shared/core/error-handler.ts";

/**
 * Tipos mínimos para dados do banco (evita acoplamento com tipos do frontend)
 */
interface DbExtractionField {
  id: string;
  entity_type_id: string;
  name: string;
  label: string;
  description: string | null;
  field_type: "text" | "number" | "date" | "select" | "multiselect" | "boolean";
  is_required: boolean;
  validation_schema: unknown;
  allowed_values: string[] | null;
  unit: string | null;
  allowed_units?: string[] | null;
  llm_description?: string | null;
  sort_order: number;
}

interface DbExtractionEntityType {
  id: string;
  project_template_id?: string | null;
  name: string;
  label: string;
  description: string | null;
  cardinality: "one" | "many";
  sort_order: number;
  is_required: boolean;
  fields?: DbExtractionField[];
}

/**
 * Schema e prompt gerados para a seção
 */
export interface SectionSchemaResult {
  schema: z.ZodObject<any> | z.ZodArray<any>; // Pode ser objeto ou array dependendo de cardinality
  prompt: string;
  entityType: DbExtractionEntityType;
  fields: DbExtractionField[];
}

/**
 * Classe para construir schemas e prompts de seção
 * 
 * IMPLEMENTAÇÃO ENRIQUECIDA:
 * - Cada campo retorna objeto com { value, confidence_score, reasoning, evidence }
 * - Prompt solicita explicitamente Chain-of-Thought e citações
 * - Suporta todos os tipos de campo (text, number, date, select, multiselect, boolean)
 */
export class SectionTemplateBuilder {
  constructor(private supabase: SupabaseClient, private logger: Logger) {}

  /**
   * Constrói schema Zod e prompt para um entity_type específico
   * 
   * ESTRATÉGIA:
   * 1. Busca entity_type e fields do banco
   * 2. Para cada field, cria schema enriquecido com metadata
   * 3. Gera prompt com instruções detalhadas para LLM
   * 
   * @param templateId - ID do template de extração
   * @param entityTypeId - ID do entity_type (seção) a extrair
   * @param projectId - ID do projeto (opcional, para encontrar template ativo)
   * @returns Schema Zod, prompt e informações do entity_type
   */
  async buildSectionSchema(
    templateId: string,
    entityTypeId: string,
    projectId?: string,
  ): Promise<SectionSchemaResult> {
    const start = performance.now();

    try {
      // Se projectId fornecido, buscar template ativo do projeto
      // Isso permite usar template ativo mesmo se templateId não for o mais recente
      let actualTemplateId = templateId;

      if (projectId) {
        this.logger.debug("Looking up active template for project", { projectId, providedTemplateId: templateId });

        const { data: activeTemplate, error: templateError } = await this.supabase
          .from("project_extraction_templates")
          .select("id")
          .eq("project_id", projectId)
          .eq("is_active", true)
          .maybeSingle();

        if (templateError) {
          this.logger.warn("Failed to lookup active template, using provided templateId", {
            error: templateError.message,
            projectId,
            providedTemplateId: templateId,
          });
          // Continuar com templateId fornecido mesmo se houver erro
        } else if (activeTemplate) {
          actualTemplateId = activeTemplate.id;
          if (actualTemplateId !== templateId) {
            this.logger.info("Using active template instead of provided templateId", {
              projectId,
              providedTemplateId: templateId,
              activeTemplateId: actualTemplateId,
            });
          } else {
            this.logger.debug("Provided templateId matches active template", {
              projectId,
              templateId: actualTemplateId,
            });
          }
        } else {
          this.logger.debug("No active template found, using provided templateId", {
            projectId,
            providedTemplateId: templateId,
          });
        }
      }

      // Buscar entity_type com seus fields
      // Usar project_template_id para garantir que estamos buscando do template correto
      const { data, error } = await this.supabase
        .from("extraction_entity_types")
        .select("*, fields:extraction_fields(*)")
        .eq("project_template_id", actualTemplateId)
        .eq("id", entityTypeId)
        .single();

      if (error) {
        throw new AppError(ErrorCode.DB_ERROR, error.message, 500);
      }

      if (!data) {
        throw new AppError(ErrorCode.NOT_FOUND, "Entity type not found", 404, {
          templateId: actualTemplateId,
          entityTypeId,
        });
      }

      const entityType = data as DbExtractionEntityType;
      const fields = (entityType.fields || []) as DbExtractionField[];

      if (fields.length === 0) {
        this.logger.warn("Entity type has no fields", { entityTypeId, entityTypeName: entityType.name });
      }

      this.logger.info("Building section schema", {
        entityTypeId,
        entityTypeName: entityType.name,
        fieldsCount: fields.length,
      });

      // Construir schema Zod enriquecido
      // Cada campo terá estrutura: { value, confidence_score, reasoning, evidence }
      const schema = this.buildEnrichedSchema(fields, entityType);

      // Construir prompt com instruções detalhadas
      const prompt = this.buildEnrichedPrompt(entityType, fields);

      const duration = performance.now() - start;
      this.logger.metric("template_build_ms", duration, "ms");

      return {
        schema,
        prompt,
        entityType,
        fields,
      };
    } catch (err) {
      this.logger.error("Failed to build section schema", err as Error, {
        templateId,
        entityTypeId,
      });
      throw err;
    }
  }

  /**
   * Constrói schema Zod enriquecido com metadata
   * 
   * ESTRUTURA POR CAMPO:
   * {
   *   fieldName: {
   *     value: <tipo do campo>,        // Valor extraído
   *     confidence_score: number,      // 0.0 - 1.0
   *     reasoning: string,            // Justificativa
   *     evidence?: {                   // Trecho do texto (opcional)
   *       text: string,
   *       page_number?: number,
   *     }
   *   }
   * }
   * 
   * @param fields - Campos do entity_type
   * @param entityType - Entity type para descrição do schema
   * @returns Schema Zod validando estrutura enriquecida
   */
  private buildEnrichedSchema(
    fields: DbExtractionField[],
    entityType: DbExtractionEntityType,
  ): z.ZodObject<any> {
    const shape: Record<string, z.ZodTypeAny> = {};

    for (const field of fields) {
      // Construir schema base do valor (text, number, date, etc.)
      const valueSchema = this.buildFieldValueSchema(field);

      // Schema de evidence (trecho citado do texto)
      // CRÍTICO: Para OpenAI providerStrategy com structured output e response_format 'extract',
      // quando um objeto aninhado está presente, TODOS os campos desse objeto devem estar no 'required'.
      // 
      // SOLUÇÃO: Usar z.null() ao invés de .optional() para campos opcionais, pois o Zod
      // coloca campos nullable no array 'required', o que é necessário para OpenAI.
      // Dentro de evidence, text é required e page_number pode ser null.
      const evidenceSchema = z
        .object({
          text: z
            .string()
            .describe("Exact text passage from the document that supports this extraction"),
          // page_number sempre presente no objeto, mas pode ser null
          page_number: z
            .union([z.number().int().positive(), z.null()])
            .describe("Page number where this evidence was found (must be a positive integer or null if not identified)"),
        })
        .describe("Source citation from the document")
        .required(); // Garantir que quando evidence existe, text e page_number são required

      // Schema completo do campo enriquecido
      // IMPORTANTE: Para OpenAI response_format 'extract', campos que podem não existir
      // devem usar z.null() ao invés de .optional(), para que apareçam no array 'required'.
      // - value: obrigatório
      // - confidence_score: obrigatório
      // - reasoning: obrigatório
      // - evidence: nullable (pode ser null ou objeto) - quando objeto, text e page_number são required
      const enrichedFieldSchema = z.object({
        value: valueSchema.describe(`Extracted value for ${field.label}`),
        confidence_score: z
          .number()
          .min(0)
          .max(1)
          .describe(
            `Confidence score (0.0-1.0) indicating how certain you are about this extraction. Use lower scores (0.3-0.6) when information is ambiguous or partially mentioned. Use higher scores (0.7-1.0) when information is explicit and clear.`,
          ),
        reasoning: z
          .string()
          .describe(
            `Brief explanation of why you extracted this value. Include what information from the document led to this extraction.`,
          ),
        // Evidence nullable (pode ser null ou objeto) - necessário para OpenAI response_format 'extract'
        // Quando é objeto, text e page_number devem estar presentes (text required, page_number pode ser null)
        evidence: z
          .union([evidenceSchema, z.null()])
          .describe("Source citation from the document (optional - include if you found supporting text, or null if not found)"),
      });

      // Se campo não é obrigatório, permitir null
      if (!field.is_required) {
        shape[field.name] = enrichedFieldSchema.nullable();
      } else {
        shape[field.name] = enrichedFieldSchema;
      }
    }

    const baseSchema = z.object(shape).describe(entityType.description || entityType.label);

    // Se cardinality="many", retornar como objeto wrapper com array
    // IMPORTANTE: OpenAI response_format 'extract' não aceita schemas de tipo array diretamente,
    // então usamos um objeto wrapper: { items: [...] }
    if (entityType.cardinality === "many") {
      return z
        .object({
          items: z
            .array(baseSchema)
            .describe(
              `Array of ${entityType.label || entityType.name} instances. Extract ALL instances you find in the document. Each element represents one complete instance with all fields.`
            ),
        })
        .describe(
          `Wrapper object containing an array of ${entityType.label || entityType.name} instances. Extract ALL instances you find in the document.`
        );
    }

    return baseSchema;
  }

  /**
   * Constrói schema Zod para o valor do campo (sem metadata)
   * 
   * @param field - Campo a processar
   * @returns Schema Zod para o tipo de valor do campo
   */
  private buildFieldValueSchema(field: DbExtractionField): z.ZodTypeAny {
    const desc = field.llm_description || field.description || field.label;

    switch (field.field_type) {
      case "text":
        return z.string().describe(desc);

      case "number":
        const numberDesc = field.unit ? `${desc} (unit: ${field.unit})` : desc;
        return z.number().describe(numberDesc);

      case "boolean":
        return z.boolean().describe(desc);

      case "date":
        return z.string().describe(`${desc} (ISO date format: YYYY-MM-DD)`);

      case "select":
        // Select: valor deve ser uma das opções permitidas
        if (field.allowed_values && field.allowed_values.length > 0) {
          return z
            .enum(field.allowed_values as [string, ...string[]])
            .describe(`${desc} (must be one of: ${field.allowed_values.join(", ")})`);
        }
        return z.string().describe(desc);

      case "multiselect":
        // Multiselect: array de valores das opções permitidas
        if (field.allowed_values && field.allowed_values.length > 0) {
          return z
            .array(z.enum(field.allowed_values as [string, ...string[]]))
            .describe(`${desc} (can include multiple: ${field.allowed_values.join(", ")})`);
        }
        return z.array(z.string()).describe(desc);

      default:
        // Fallback para tipo desconhecido
        return z.string().describe(desc);
    }
  }

  /**
   * Constrói prompt enriquecido com instruções para Chain-of-Thought e citações
   * 
   * PROMPT ENGINEERING:
   * - Solicita explicitamente confidence_score e reasoning
   * - Instrui a incluir trechos do texto como evidence
   * - Encoraja Chain-of-Thought (pensar passo a passo)
   * - Fornece contexto sobre incerteza
   * 
   * @param entityType - Entity type sendo extraído
   * @param fields - Campos da seção
   * @returns Prompt formatado com instruções detalhadas
   */
  private buildEnrichedPrompt(
    entityType: DbExtractionEntityType,
    fields: DbExtractionField[],
  ): string {
    // Construir lista de campos formatada
    const fieldsList = fields
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((f) => {
        let line = `- **${f.label}**`;
        if (f.llm_description || f.description) {
          line += `: ${f.llm_description || f.description}`;
        }
        if (f.allowed_values && f.allowed_values.length > 0) {
          line += ` (allowed values: ${f.allowed_values.join(", ")})`;
        }
        if (f.unit) {
          line += ` (unit: ${f.unit})`;
        }
        if (!f.is_required) {
          line += " (optional)";
        }
        return line;
      })
      .join("\n");

    // Prompt principal com instruções detalhadas
    const cardinalityNote = entityType.cardinality === "many"
      ? "\n**CRITICAL:** This section has cardinality 'many', meaning it can contain MULTIPLE instances.\n" +
        "You MUST extract ALL instances you find in the document as an ARRAY.\n" +
        "Each element in the array should represent one complete instance with all its fields.\n" +
        "For example, if you find 3 authors, return an array with 3 objects, one for each author."
      : "";

    // Prompt customizado para prediction_models
    const isPredictionModels = entityType.name === "prediction_models";
    
    const predictionModelsWarning = isPredictionModels
      ? `\n**CRITICAL FOR PREDICTION MODELS:**\n` +
        `- Extract ONLY prediction models that were DEVELOPED, CREATED, or TESTED BY THE AUTHORS IN THIS SPECIFIC STUDY\n` +
        `- DO NOT extract models mentioned in:\n` +
        `  * Background/Literature Review sections (these are models from OTHER studies)\n` +
        `  * Related Work sections\n` +
        `  * Methods that describe existing/published models used as references\n` +
        `- A prediction model must be:\n` +
        `  * Explicitly stated as "we developed", "we created", "our model", "this study's model"\n` +
        `  * Or clearly described as a model created by the authors for this specific study\n` +
        `- If NO prediction models were developed by the authors in this study, return an EMPTY array []\n` +
        `- Be very conservative: when in doubt, do NOT extract it\n`
      : "";

    return `Extract the following information from the scientific article for the section "${entityType.label}".

## Section Context
${entityType.description || "No additional context provided."}${cardinalityNote}${predictionModelsWarning}

## Fields to Extract
${fieldsList}

## Extraction Requirements

For EACH field, provide:
1. **value**: The extracted data value
2. **confidence_score**: Your confidence level (0.0-1.0)
   - Use 0.3-0.6 when information is:
     * Ambiguous or partially mentioned
     * Inferred from context rather than explicitly stated
     * From a different but related section
   - Use 0.7-0.9 when information is:
     * Explicitly stated in the relevant section
     * Clear and unambiguous
   - Use 1.0 only when:
     * Information is directly quoted from the document
     * No interpretation is needed

3. **reasoning**: A brief explanation (2-3 sentences) of:
   - Why you extracted this specific value
   - What part of the document led to this extraction
   - Any assumptions or context you considered

4. **evidence** (optional but recommended): The exact text passage(s) that support this extraction
   - Include the verbatim text from the document
   - Add page_number if you can identify it
   - This helps reviewers verify your extraction

## Instructions

- **Think step by step**: Read the relevant sections, identify key information, then extract values
- **Be conservative with confidence**: When in doubt, use lower confidence scores
- **Provide citations**: Include evidence text passages whenever possible
- **Return null**: If a field truly cannot be found, return null (only for optional fields)
- **Follow field types**: Respect select/multiselect allowed values, date formats, etc.

Begin extraction now.`;
  }
}

