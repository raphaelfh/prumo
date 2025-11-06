/**
 * Pipeline de Extração de Modelos de Predição
 * 
 * Orquestra o processo de extração de modelos:
 * 1. Processar PDF
 * 2. Buscar entity_type "prediction_models" no template
 * 3. Construir schema Zod para extrair modelos (model_name, modelling_method)
 * 4. Extrair modelos com LLM
 * 5. Criar instâncias de modelos automaticamente
 * 6. Criar child instances para cada modelo (hierarquia completa)
 * 7. Salvar sugestões de IA para campos dos modelos
 * 8. Retornar lista de modelos criados
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { Logger } from "../_shared/core/logger.ts";
import { AppError, ErrorCode } from "../_shared/core/error-handler.ts";
import { SectionPDFProcessor } from "../section-extraction/pdf-processor.ts";
import { ExtractorFactory } from "../_shared/extraction/extractor-factory.ts";
import { SectionTemplateBuilder } from "../section-extraction/template-builder.ts";
import { SectionDBWriter } from "../section-extraction/db-writer.ts";
import { ModelBuilder } from "./model-builder.ts";
import type { SupportedModel } from "../_shared/extraction/model-config.ts";
import { CONFIG } from "../section-extraction/config.ts";

/**
 * Opções do pipeline de modelos
 */
export interface ModelPipelineOptions {
  projectId: string;
  articleId: string;
  templateId: string;
  userId: string;
  model?: SupportedModel;
}

/**
 * Resultado do pipeline
 */
export interface ModelPipelineResult {
  runId: string;
  modelsCreated: Array<{
    instanceId: string;
    modelName: string;
    modellingMethod?: string;
  }>;
  childInstancesCreated: number;
  metadata: {
    tokensPrompt: number;
    tokensCompletion: number;
    tokensUsed: number;
    duration: number;
    modelsFound: number;
  };
}

/**
 * Pipeline de extração de modelos
 */
export class ModelExtractionPipeline {
  constructor(
    private supabase: SupabaseClient,
    private openaiKey: string,
    private logger: Logger,
  ) {}

  /**
   * Executa o pipeline de extração de modelos
   */
  async run(
    pdfBuffer: Uint8Array,
    options: ModelPipelineOptions,
  ): Promise<ModelPipelineResult> {
    const start = performance.now();
    let runId: string | null = null;

    try {
      // ==================== 1. BUSCAR ENTITY_TYPE PREDICTION_MODELS ====================
      this.logger.info("Searching for prediction_models entity type");
      
      const { data: entityTypes, error: etError } = await this.supabase
        .from("extraction_entity_types")
        .select("id, name, label, description, cardinality, project_template_id")
        .eq("project_template_id", options.templateId)
        .eq("name", "prediction_models")
        .maybeSingle();

      if (etError) {
        throw new AppError(ErrorCode.DB_ERROR, "Failed to query entity types", 500, {
          error: etError.message,
        });
      }

      if (!entityTypes) {
        throw new AppError(
          ErrorCode.NOT_FOUND,
          "Entity type 'prediction_models' not found in template",
          404,
          {
            templateId: options.templateId,
          },
        );
      }

      this.logger.info("Found prediction_models entity type", {
        entityTypeId: entityTypes.id,
        entityTypeName: entityTypes.name,
      });

      // ==================== 2. CRIAR EXTRACTION_RUN ====================
      const dbWriter = new SectionDBWriter(this.supabase, this.logger);
      
      runId = await dbWriter.createRun(
        options.projectId,
        options.articleId,
        options.templateId,
        entityTypes.id,
        options.userId,
        {
          model: options.model || "gpt-4o-mini",
          entityTypeId: entityTypes.id,
        },
      );

      const runLogger = this.logger.child({ runId });
      runLogger.info("Extraction run created for model extraction", {
        entityTypeId: entityTypes.id,
        model: options.model || "gpt-4o",
      });

      // ==================== 3. PROCESSAR PDF ====================
      const pdfStart = performance.now();
      runLogger.info("Processing PDF");
      const pdfProcessor = new SectionPDFProcessor(runLogger);
      const pdf = await pdfProcessor.process(pdfBuffer);
      const pdfDuration = performance.now() - pdfStart;

      if (!pdf.text || typeof pdf.text !== 'string') {
        throw new AppError(
          ErrorCode.PDF_PROCESSING_ERROR,
          "PDF processing failed: extracted text is invalid or empty",
          500,
        );
      }

      runLogger.info("PDF processed", {
        textLength: pdf.text.length,
        pageCount: pdf.pageCount,
        duration: `${pdfDuration.toFixed(0)}ms`,
      });

      // ==================== 4. CONSTRUIR SCHEMA E PROMPT ====================
      runLogger.info("Building schema for model extraction");
      const templateBuilder = new SectionTemplateBuilder(this.supabase, runLogger);
      const { schema, prompt, entityType, fields } = await templateBuilder.buildSectionSchema(
        options.templateId,
        entityTypes.id,
        options.projectId,
      );

      runLogger.info("Schema built", {
        entityTypeName: entityType.name,
        fieldsCount: fields.length,
        cardinality: entityType.cardinality,
      });

      // ==================== 5. EXTRAIR MODELOS COM LLM ====================
      const modelToUse = options.model || "gpt-4o-mini";
      const llmStart = performance.now();
      runLogger.info("Extracting models with LLM", {
        model: modelToUse,
        textLength: pdf.text.length,
      });

      // Criar extractor via factory (modular: LangChain ou Instructor)
      const extractionConfig = {
        retry: {
          maxAttempts: CONFIG.retry.maxAttempts,
          initialDelayMs: CONFIG.retry.initialDelayMs,
        },
        llm: {
          timeout: {
            base: CONFIG.llm.timeout.base,
            gpt5: CONFIG.llm.timeout.gpt5,
            warningThreshold: CONFIG.llm.timeout.warningThreshold,
          },
          maxTextLength: {
            base: CONFIG.llm.maxTextLength.base,
            gpt5: CONFIG.llm.maxTextLength.gpt5,
          },
        },
      };
      const llmExtractor = ExtractorFactory.createExtractor(this.openaiKey, runLogger, extractionConfig);
      const extraction = await llmExtractor.extract(pdf.text, schema, prompt, {
        model: modelToUse,
      });
      const llmDuration = performance.now() - llmStart;

      // Normalizar dados para array
      const isArray = Array.isArray(extraction.data);
      let modelsData: Array<Record<string, any>>;

      if (isArray) {
        modelsData = (extraction.data as Array<Record<string, any>>).filter(
          (item) => item && typeof item === 'object' && !Array.isArray(item)
        );
      } else {
        // Se retornou objeto único, converter para array
        modelsData = extraction.data && typeof extraction.data === 'object'
          ? [extraction.data as Record<string, any>]
          : [];
      }

      runLogger.info("LLM extraction completed", {
        tokens: {
          prompt: extraction.metadata.tokens.prompt,
          completion: extraction.metadata.tokens.completion,
          total: extraction.metadata.tokens.total,
        },
        modelsFound: modelsData.length,
        llmDuration: `${llmDuration.toFixed(0)}ms`,
      });

      // Se nenhum modelo foi encontrado, retornar resultado vazio (não é erro)
      if (modelsData.length === 0) {
        runLogger.info("No models found in article");
        return {
          runId,
          modelsCreated: [],
          childInstancesCreated: 0,
          metadata: {
            tokensPrompt: extraction.metadata.tokens.prompt,
            tokensCompletion: extraction.metadata.tokens.completion,
            tokensUsed: extraction.metadata.tokens.total,
            duration: performance.now() - start,
            modelsFound: 0,
          },
        };
      }

      // ==================== 6. CRIAR MODELOS E HIERARQUIAS ====================
      runLogger.info("Creating model instances and hierarchies", {
        modelsToCreate: modelsData.length,
      });

      const modelBuilder = new ModelBuilder(this.supabase, runLogger);
      const createdModels = await modelBuilder.createModelsFromExtraction(
        options.projectId,
        options.articleId,
        options.templateId,
        entityTypes.id,
        options.userId,
        modelsData,
        entityType,
        fields,
      );

      runLogger.info("Models created successfully", {
        modelsCreated: createdModels.length,
        totalChildInstances: createdModels.reduce((sum, m) => sum + m.childInstancesCount, 0),
      });

      // ==================== 7. SALVAR SUGESTÕES DE IA ====================
      // Para cada modelo criado, salvar sugestões de IA para os campos extraídos
      let totalSuggestions = 0;

      for (let i = 0; i < createdModels.length && i < modelsData.length; i++) {
        const modelInstance = createdModels[i];
        const modelExtractedData = modelsData[i];

        // Mapear campos para a instância do modelo
        const fieldMapping = new Map<string, Array<{ instanceId: string; fieldId: string }>>();
        
        for (const field of fields) {
          const fieldData = modelExtractedData[field.name];
          if (fieldData && typeof fieldData === 'object' && fieldData.value !== undefined) {
            fieldMapping.set(field.name, [{
              instanceId: modelInstance.instanceId,
              fieldId: field.id,
            }]);
          }
        }

        // Criar sugestões apenas se houver dados mapeados
        if (fieldMapping.size > 0) {
          // Normalizar dados enriquecidos
          const enrichedData: Record<string, any> = {};
          for (const [fieldName, mappings] of fieldMapping.entries()) {
            const fieldData = modelExtractedData[fieldName];
            if (fieldData && typeof fieldData === 'object') {
              enrichedData[fieldName] = {
                value: fieldData.value,
                confidence_score: typeof fieldData.confidence_score === 'number' 
                  ? fieldData.confidence_score 
                  : 0.8,
                reasoning: fieldData.reasoning || '',
                evidence: fieldData.evidence || undefined,
              };
            }
          }

          const suggestionsCreated = await dbWriter.saveSuggestions(
            options.articleId,
            runId,
            enrichedData,
            fieldMapping,
          );
          totalSuggestions += suggestionsCreated;
        }
      }

      runLogger.info("AI suggestions saved", {
        totalSuggestions,
      });

      // ==================== 8. ATUALIZAR STATUS DO RUN ====================
      await dbWriter.updateRunStatus(runId, "completed", {
        models_created: createdModels.length,
        child_instances_created: createdModels.reduce((sum, m) => sum + m.childInstancesCount, 0),
        suggestions_created: totalSuggestions,
        tokens_prompt: extraction.metadata.tokens.prompt,
        tokens_completion: extraction.metadata.tokens.completion,
      });

      const duration = performance.now() - start;

      return {
        runId,
        modelsCreated: createdModels.map(m => ({
          instanceId: m.instanceId,
          modelName: m.modelName,
          modellingMethod: m.modellingMethod,
        })),
        childInstancesCreated: createdModels.reduce((sum, m) => sum + m.childInstancesCount, 0),
        metadata: {
          tokensPrompt: extraction.metadata.tokens.prompt,
          tokensCompletion: extraction.metadata.tokens.completion,
          tokensUsed: extraction.metadata.tokens.total,
          duration,
          modelsFound: modelsData.length,
        },
      };
    } catch (error) {
      // Se runId foi criado, atualizar status para failed
      if (runId) {
        try {
          const dbWriter = new SectionDBWriter(this.supabase, this.logger);
          await dbWriter.updateRunStatus(runId, "failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        } catch (updateError) {
          this.logger.error("Failed to update run status", updateError as Error);
        }
      }
      throw error;
    }
  }
}

