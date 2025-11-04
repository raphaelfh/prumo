/**
 * Pipeline de Extração de Seção Específica
 * 
 * Orquestra todo o processo de extração de uma seção (entity type) específica:
 * 1. Criar extraction_run
 * 2. Processar PDF (extrair texto)
 * 3. Construir schema Zod enriquecido
 * 4. Extrair dados com LLM
 * 5. Buscar instâncias existentes do entity_type
 * 6. Mapear campos para instâncias
 * 7. Salvar sugestões no banco
 * 8. Atualizar status do run
 * 
 * ARQUITETURA ISOLADA: Não reutiliza módulos de _shared para manter independência
 * e permitir evoluções específicas (ex: schema enriquecido com metadata).
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { Logger } from "../_shared/core/logger.ts";
import { AppError, ErrorCode } from "../_shared/core/error-handler.ts";
import { SectionPDFProcessor } from "./pdf-processor.ts";
import { SectionTemplateBuilder } from "./template-builder.ts";
import { SectionLLMExtractor } from "./llm-extractor.ts";
import { SectionDBWriter } from "./db-writer.ts";
import type { SupportedModel } from "../_shared/extraction/model-config.ts";

/**
 * Opções do pipeline
 */
export interface SectionPipelineOptions {
  projectId: string;
  articleId: string;
  templateId: string;
  entityTypeId: string; // Seção específica a extrair
  userId: string;
  model?: SupportedModel;
  parentInstanceId?: string; // Nova: ID da instância pai (para filtrar child entities por modelo)
}

/**
 * Resultado do pipeline
 */
export interface SectionPipelineResult {
  runId: string;
  status: "completed" | "partial" | "failed";
  suggestionsCreated: number;
  metadata: {
    pdfPages: number;
    tokensUsed: number;
    tokensPrompt: number;
    tokensCompletion: number;
    duration: number;
    // Campos adicionais para testes e debug
    fieldsExtracted?: number;
    instanceCount?: number;
    evidenceCoverage?: string;
    reasoningCoverage?: string;
    avgConfidence?: string;
    // Resposta completa da LLM (para testes)
    llmResponse?: Record<string, any>;
  };
}

/**
 * Classe principal do pipeline de extração
 * 
 * RESPONSABILIDADE: Coordenar todos os módulos para extrair uma seção específica
 * e salvar resultados no banco de dados.
 */
export class SectionExtractionPipeline {
  constructor(
    private supabase: SupabaseClient,
    private openaiKey: string,
    private logger: Logger,
  ) {}

  /**
   * Executa o pipeline completo de extração
   * 
   * FLUXO DETALHADO:
   * 1. Criar extraction_run (status: running)
   * 2. Processar PDF → extrair texto
   * 3. Construir schema Zod enriquecido para a seção
   * 4. Extrair dados com LLM usando LangChain
   * 5. Buscar instâncias existentes do entity_type
   * 6. Mapear campos extraídos para instâncias + field_ids
   * 7. Salvar sugestões em ai_suggestions
   * 8. Atualizar extraction_run (status: completed)
   * 
   * TRATAMENTO DE ERROS:
   * - Em caso de erro, atualiza extraction_run com status "failed"
   * - Logs estruturados em cada etapa para debugging
   * 
   * @param pdfBuffer - Buffer do PDF (Uint8Array)
   * @param options - Opções do pipeline (projectId, articleId, etc.)
   * @returns Resultado da extração (runId, sugestões criadas, metadata)
   */
  async run(
    pdfBuffer: Uint8Array,
    options: SectionPipelineOptions,
  ): Promise<SectionPipelineResult> {
    const start = performance.now();

    // CRÍTICO: Timeout global do pipeline para evitar que ultrapasse 150s do Supabase
    // Edge Functions do Supabase têm timeout de 150s (rigoroso)
    // Reservar 10s de margem para resposta e overhead
    const PIPELINE_MAX_TIME_MS = 140 * 1000; // 140s
    const pipelineTimeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`Pipeline timeout: exceeded ${PIPELINE_MAX_TIME_MS / 1000}s limit`)),
        PIPELINE_MAX_TIME_MS,
      );
    });

    try {
      // Race entre pipeline e timeout global
      return await Promise.race([
        this.executePipeline(pdfBuffer, options, start),
        pipelineTimeoutPromise,
      ]);
    } catch (error) {
      // Se timeout global foi atingido, logar mas não tentar atualizar run
      // (run pode não ter sido criado ainda ou pode estar em outro escopo)
      if (error instanceof Error && error.message.includes("Pipeline timeout")) {
        this.logger.error("Pipeline exceeded global timeout", error, {
          timeoutMs: PIPELINE_MAX_TIME_MS,
          suggestion: "LLM extraction is taking too long. Consider reducing PDF size or number of fields.",
        });
      }
      throw error;
    }
  }

  /**
   * Executa o pipeline de extração (método interno separado para permitir timeout)
   */
  private async executePipeline(
    pdfBuffer: Uint8Array,
    options: SectionPipelineOptions,
    start: number,
  ): Promise<SectionPipelineResult> {
    let runId: string | null = null;

    try {
      // ==================== 1. CRIAR EXTRACTION_RUN ====================
      // Criar registro de execução antes de iniciar para rastreabilidade
      const dbWriter = new SectionDBWriter(this.supabase, this.logger);
      
      runId = await dbWriter.createRun(
        options.projectId,
        options.articleId,
        options.templateId,
        options.entityTypeId,
        options.userId,
        {
          model: options.model || "gpt-4o", // Padrão: gpt-4o (mais econômico)
          entityTypeId: options.entityTypeId,
        },
      );

      const runLogger = this.logger.child({ runId });
      runLogger.info("Extraction run created, starting pipeline", {
        entityTypeId: options.entityTypeId,
        model: options.model || "gpt-4o", // Padrão: gpt-4o (mais econômico)
      });

      // ==================== 2. PROCESSAR PDF ====================
      const pdfStart = performance.now();
      runLogger.info("Processing PDF");
      const pdfProcessor = new SectionPDFProcessor(runLogger);
      const pdf = await pdfProcessor.process(pdfBuffer);
      const pdfDuration = performance.now() - pdfStart;

      // VALIDAÇÃO CRÍTICA: Verificar que pdf.text existe e é válido
      if (!pdf.text || typeof pdf.text !== 'string') {
        throw new AppError(
          ErrorCode.PDF_PROCESSING_ERROR,
          "PDF processing failed: extracted text is invalid or empty",
          500,
          {
            textType: typeof pdf.text,
            textIsNull: pdf.text === null,
            textIsUndefined: pdf.text === undefined,
            pageCount: pdf.pageCount,
          },
        );
      }

      runLogger.info("PDF processed", {
        textLength: pdf.text.length,
        pageCount: pdf.pageCount,
        duration: `${pdfDuration.toFixed(0)}ms`,
      });

      // ==================== 3. CONSTRUIR SCHEMA E PROMPT ====================
      runLogger.info("Building section schema");
      const templateBuilder = new SectionTemplateBuilder(this.supabase, runLogger);
      const { schema, prompt, entityType, fields } = await templateBuilder.buildSectionSchema(
        options.templateId,
        options.entityTypeId,
        options.projectId,
      );

      runLogger.info("Schema built", {
        entityTypeName: entityType.name,
        entityTypeLabel: entityType.label,
        fieldsCount: fields.length,
        cardinality: entityType.cardinality,
      });

      // ==================== 4. EXTRAIR COM LLM ====================
      const modelToUse = options.model || "gpt-4o"; // Padrão: gpt-4o (mais econômico)
      const llmStart = performance.now();
      runLogger.info("Extracting with LLM", {
        model: modelToUse,
        textLength: pdf.text.length,
        fieldsCount: fields.length,
      });

      const llmExtractor = new SectionLLMExtractor(this.openaiKey, runLogger);
      const extraction = await llmExtractor.extract(pdf.text, schema, prompt, {
        model: modelToUse,
      });
      const llmDuration = performance.now() - llmStart;

      // ==================== DETECTAR SE É ARRAY OU OBJETO ====================
      // CRÍTICO: extraction.data pode ser array (cardinality="many") ou objeto (cardinality="one")
      // Para obter os nomes dos campos corretamente, precisamos:
      // - Se for array: usar Object.keys do primeiro elemento
      // - Se for objeto: usar Object.keys diretamente
      const isExtractionArray = Array.isArray(extraction.data);
      const dataForFieldExtraction = isExtractionArray 
        ? (extraction.data.length > 0 ? extraction.data[0] : {})
        : extraction.data;

      runLogger.info("LLM extraction completed", {
        tokens: {
          prompt: extraction.metadata.tokens.prompt,
          completion: extraction.metadata.tokens.completion,
          total: extraction.metadata.tokens.total,
        },
        llmDuration: `${llmDuration.toFixed(0)}ms`,
        internalDuration: `${extraction.metadata.duration.toFixed(0)}ms`,
        fieldsExtracted: Object.keys(dataForFieldExtraction).length,
        extractedFieldNames: Object.keys(dataForFieldExtraction),
        isArray: isExtractionArray,
        arrayLength: isExtractionArray ? (extraction.data as any[]).length : 1,
      });

      // Calcular métricas de qualidade da extração
      // IMPORTANTE: Se for array, iterar sobre cada item e agregar métricas
      let fieldsWithEvidence = 0;
      let fieldsWithReasoning = 0;
      const confidenceScores: number[] = [];
      
      if (isExtractionArray) {
        // Array: iterar sobre cada item
        for (const item of extraction.data as Array<Record<string, any>>) {
          for (const fieldValue of Object.values(item)) {
            const field = fieldValue as any;
            if (field?.evidence?.text) {
              fieldsWithEvidence++;
            }
            if (field?.reasoning && typeof field.reasoning === "string") {
              fieldsWithReasoning++;
            }
            if (typeof field?.confidence_score === "number") {
              confidenceScores.push(field.confidence_score);
            }
          }
        }
      } else {
        // Objeto único: processar diretamente
        for (const field of Object.values(extraction.data as Record<string, any>)) {
          const fieldData = field as any;
          if (fieldData?.evidence?.text) {
            fieldsWithEvidence++;
          }
          if (fieldData?.reasoning && typeof fieldData.reasoning === "string") {
            fieldsWithReasoning++;
          }
          if (typeof fieldData?.confidence_score === "number") {
            confidenceScores.push(fieldData.confidence_score);
          }
        }
      }
      
      const avgConfidence = confidenceScores.length > 0
        ? confidenceScores.reduce((sum, score) => sum + score, 0) / confidenceScores.length
        : 0;

      const fieldsCount = Object.keys(dataForFieldExtraction).length;
      const totalFieldsCount = isExtractionArray 
        ? fieldsCount * (extraction.data as any[]).length 
        : fieldsCount;
      
      const evidenceCoverage = totalFieldsCount > 0 
        ? `${((fieldsWithEvidence / totalFieldsCount) * 100).toFixed(1)}%`
        : "0%";
      const reasoningCoverage = totalFieldsCount > 0
        ? `${((fieldsWithReasoning / totalFieldsCount) * 100).toFixed(1)}%`
        : "0%";

      runLogger.info("Extraction quality metrics", {
        fieldsCount,
        totalFieldsCount,
        fieldsWithEvidence,
        fieldsWithReasoning,
        evidenceCoverage,
        reasoningCoverage,
        avgConfidence: avgConfidence.toFixed(3),
        isArray: isExtractionArray,
      });

      // ==================== VALIDAÇÃO DE FIELD NAMES ====================
      // Validar que os campos retornados pelo LLM correspondem aos campos esperados do template
      const expectedFieldNames = fields.map(f => f.name);
      const extractedFieldNames = Object.keys(dataForFieldExtraction);
      const matchedFields = extractedFieldNames.filter(name => expectedFieldNames.includes(name));
      const unmatchedExtracted = extractedFieldNames.filter(name => !expectedFieldNames.includes(name));
      const unmatchedExpected = expectedFieldNames.filter(name => !extractedFieldNames.includes(name));

      runLogger.info("Field name validation", {
        expectedFieldNames,
        extractedFieldNames,
        matchedCount: matchedFields.length,
        matchedFields,
        unmatchedExtractedCount: unmatchedExtracted.length,
        unmatchedExtractedFields: unmatchedExtracted,
        unmatchedExpectedCount: unmatchedExpected.length,
        unmatchedExpectedFields: unmatchedExpected,
      });

      // Tentar matching case-insensitive para detectar problemas de case
      const caseInsensitiveMatches: Array<{ extracted: string; expected: string }> = [];
      for (const extractedName of unmatchedExtracted) {
        const expectedMatch = expectedFieldNames.find(
          expected => expected.toLowerCase() === extractedName.toLowerCase()
        );
        if (expectedMatch) {
          caseInsensitiveMatches.push({ extracted: extractedName, expected: expectedMatch });
        }
      }

      if (caseInsensitiveMatches.length > 0) {
        runLogger.warn("Case-insensitive field name matches found", {
          matches: caseInsensitiveMatches,
          suggestion: "Field names are case-sensitive. Check if LLM is returning different casing than defined in template.",
        });
      }

      // Avisar se há muitos campos não mapeados
      if (unmatchedExtracted.length > 0) {
        runLogger.warn("Some extracted fields have no mapping", {
          unmatchedCount: unmatchedExtracted.length,
          unmatchedFields: unmatchedExtracted,
          expectedFieldNames,
          suggestion: "These fields will be skipped. Verify field.name in extraction_fields table matches LLM output exactly.",
        });
      }

      // Log do retorno completo da LLM para debug (primeiros 1000 chars)
      // NOTA: Para resposta completa, usar JSON.stringify(extraction.data) sem truncamento
      // CRÍTICO: Validar que extraction.data existe antes de usar substring
      // IMPORTANTE: Usar dataForFieldExtraction (que já lida com arrays) para obter campos corretamente
      const hasData = extraction.data && typeof extraction.data === 'object';
      const dataString = hasData ? JSON.stringify(extraction.data) : '';
      const firstEntry = hasData && Object.keys(dataForFieldExtraction).length > 0 
        ? Object.entries(dataForFieldExtraction)[0] 
        : null;
      
      runLogger.debug("LLM extraction response sample", {
        fieldsCount: hasData ? Object.keys(dataForFieldExtraction).length : 0,
        firstFieldSample: firstEntry ? {
          fieldName: firstEntry[0],
          hasValue: !!firstEntry[1]?.value,
          hasConfidence: typeof firstEntry[1]?.confidence_score === "number",
          hasReasoning: typeof firstEntry[1]?.reasoning === "string",
          sampleValue: firstEntry[1]?.value !== undefined 
            ? (typeof firstEntry[1].value === 'string' 
              ? firstEntry[1].value.substring(0, 200)
              : JSON.stringify(firstEntry[1].value).substring(0, 200))
            : null,
        } : null,
        fullResponsePreview: dataString ? dataString.substring(0, 1000) : '(no data)',
        fullResponseComplete: dataString || '(no data)', // Resposta completa para acesso em testes
      });

      // ==================== 5. BUSCAR INSTÂNCIAS EXISTENTES ====================
      // CRÍTICO: Buscar instâncias existentes do entity_type
      // - Para cardinality="one": deve existir exatamente 1 instância
      // - Para cardinality="many": buscar todas as instâncias existentes
      // - Se não houver instâncias: erro amigável pedindo para criar
      runLogger.info("Fetching extraction instances", {
        entityTypeId: options.entityTypeId,
        cardinality: entityType.cardinality,
      });

      let instances = await this.getInstances(
        options.articleId,
        options.templateId,
        options.entityTypeId,
        entityType.cardinality,
        runLogger,
        options.parentInstanceId, // Nova: filtrar por parent_instance_id quando fornecido
      );

      // Se não houver instâncias, criar automaticamente quando cardinality="many"
      if (instances.length === 0) {
        if (entityType.cardinality === "many") {
          // Para cardinality="many", criar instâncias automaticamente baseadas nos dados extraídos
          // Normalizar os dados para saber quantas instâncias criar
          const isArray = Array.isArray(extraction.data);
          
          if (!isArray) {
            // Se LLM retornou objeto único mas esperávamos array, criar apenas 1 instância
            runLogger.warn("LLM returned object but cardinality='many' - creating single instance", {
              entityTypeId: options.entityTypeId,
              entityTypeName: entityType.name,
            });
            instances = await this.createInstances(
              options.projectId,
              options.articleId,
              options.templateId,
              options.entityTypeId,
              options.userId,
              1, // Criar apenas 1 instância
              entityType,
              fields,
              runLogger,
              undefined, // itemsData
              options.parentInstanceId, // Nova: passar parentInstanceId
            );
          } else {
            // LLM retornou array: criar instâncias para cada item
            const itemsCount = extraction.data.length;
            runLogger.info("No instances found - creating automatically for cardinality='many'", {
              entityTypeId: options.entityTypeId,
              entityTypeName: entityType.name,
              itemsExtracted: itemsCount,
              willCreateInstances: itemsCount,
            });
            
            instances = await this.createInstances(
              options.projectId,
              options.articleId,
              options.templateId,
              options.entityTypeId,
              options.userId,
              itemsCount,
              entityType,
              fields,
              runLogger,
              extraction.data as Array<Record<string, any>>, // Passar dados para gerar labels
              options.parentInstanceId, // Nova: passar parentInstanceId
            );
          }
        } else {
          // Para cardinality="one", ainda requer instância pré-existente
          const error = new Error(`No instances found for entity type ${entityType.name}`);
          runLogger.error("No instances found for entity type", error, {
            entityTypeId: options.entityTypeId,
            entityTypeName: entityType.name,
            cardinality: entityType.cardinality,
          });
        throw new AppError(
          ErrorCode.NOT_FOUND,
          `No instances found for this section. Please create at least one instance before extracting.`,
          400,
          {
            entityTypeId: options.entityTypeId,
            entityTypeName: entityType.name,
            cardinality: entityType.cardinality,
          },
        );
        }
      }

      runLogger.info("Instances found", {
        count: instances.length,
        instanceIds: instances.map((i) => i.id),
      });

      // ==================== 6. NORMALIZAR DADOS (ARRAY/OBJETO) ====================
      // extraction.data pode ser:
      // - Record<string, any> (objeto único) - quando cardinality="one" ou LLM retornou objeto
      // - Array<Record<string, any>> (array de objetos) - quando cardinality="many" e LLM retornou array
      // 
      // CRÍTICO: Normalizar para sempre trabalhar com array de objetos
      const isArray = Array.isArray(extraction.data);
      let normalizedData: Record<string, any>[];
      
      if (isArray) {
        // Já é array: validar que todos os elementos são objetos
        normalizedData = (extraction.data as Array<Record<string, any>>).filter(
          (item) => item && typeof item === 'object' && !Array.isArray(item)
        );
        
        if (normalizedData.length === 0) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            "LLM returned empty array or invalid array items",
            400,
            { arrayLength: (extraction.data as any[]).length },
          );
        }
      } else {
        // É objeto único: converter para array de um elemento
        if (!extraction.data || typeof extraction.data !== 'object' || Array.isArray(extraction.data)) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            "LLM returned invalid data structure",
            400,
            { dataType: typeof extraction.data },
          );
        }
        normalizedData = [extraction.data as Record<string, any>];
      }

      runLogger.debug("Data normalized", {
        isArray,
        normalizedItemsCount: normalizedData.length,
        firstItemFields: normalizedData[0] ? Object.keys(normalizedData[0]) : [],
      });

      // ==================== 7. PROCESSAR DADOS ARRAY/OBJETO ====================
      // Se temos array de dados e múltiplas instâncias, mapear por índice
      // Se temos objeto único e múltiplas instâncias, replicar para todas
      let dataToProcess: Record<string, any>[];

      if (isArray && entityType.cardinality === "many") {
        // Array + many: mapear cada item do array para uma instância (por índice)
        const arrayData = extraction.data as Record<string, any>[];
        const instanceCount = instances.length;
        const arrayLength = arrayData.length;

        if (arrayLength > instanceCount) {
          runLogger.warn("Array has more items than instances", {
            arrayLength,
            instanceCount,
            itemsDiscarded: arrayLength - instanceCount,
            suggestion: "Only first N items will be processed, rest will be ignored",
          });
          dataToProcess = arrayData.slice(0, instanceCount);
        } else if (arrayLength < instanceCount) {
          runLogger.warn("Array has fewer items than instances", {
            arrayLength,
            instanceCount,
            emptyInstances: instanceCount - arrayLength,
            suggestion: "Only first N instances will receive data",
          });
          dataToProcess = arrayData;
          // Criar entradas vazias para instâncias sem dados (opcional - vamos processar apenas as que têm dados)
        } else {
          runLogger.info("Perfect match: array length equals instance count", {
            arrayLength,
            instanceCount,
          });
          dataToProcess = arrayData;
        }

        // Processar cada item do array para sua instância correspondente
        // Construir um mapeamento dinâmico baseado no índice
        const saveStart = performance.now();
        let totalSuggestions = 0;
        for (let i = 0; i < Math.min(dataToProcess.length, instances.length); i++) {
          const itemData = dataToProcess[i];
          const instance = instances[i];

          // Construir mapeamento de campo para esta instância específica
          const instanceFieldMapping = this.buildFieldMapping(fields, [instance]);

          runLogger.debug("Processing array item for instance", {
            arrayIndex: i,
            instanceId: instance.id,
            instanceLabel: instance.label,
            itemFields: Object.keys(itemData),
          });

          // Salvar sugestões para esta instância
          const itemSuggestions = await dbWriter.saveSuggestions(
            options.articleId,
            runId,
            itemData,
            instanceFieldMapping,
          );
          totalSuggestions += itemSuggestions;
        }

        const saveDuration = performance.now() - saveStart;

        runLogger.info("Array extraction processed", {
          itemsProcessed: dataToProcess.length,
          instancesUsed: Math.min(dataToProcess.length, instances.length),
          totalSuggestionsCreated: totalSuggestions,
        });

        // Atualizar status do run
        await dbWriter.updateRunStatus(runId, "completed", {
          suggestions_created: totalSuggestions,
          pdf_pages: pdf.pageCount || 0,
          tokens_used: extraction.metadata.tokens.total || 0,
          tokens_prompt: extraction.metadata.tokens.prompt || 0,
          tokens_completion: extraction.metadata.tokens.completion || 0,
          entity_type_id: options.entityTypeId,
        });

        const duration = performance.now() - start;

        runLogger.info("Pipeline completed successfully (array extraction)", {
          totalDuration: `${duration.toFixed(0)}ms`,
          breakdown: {
            pdfProcessing: `${pdfDuration.toFixed(0)}ms`,
            llmExtraction: `${llmDuration.toFixed(0)}ms`,
            dbSaving: `${saveDuration.toFixed(0)}ms`,
          },
          suggestionsCreated: totalSuggestions,
          tokensUsed: extraction.metadata.tokens.total,
        });

        return {
          runId,
          status: "completed",
          suggestionsCreated: totalSuggestions,
          metadata: {
            pdfPages: pdf.pageCount || 0,
            tokensUsed: extraction.metadata.tokens.total,
            tokensPrompt: extraction.metadata.tokens.prompt,
            tokensCompletion: extraction.metadata.tokens.completion,
            duration,
            fieldsExtracted: normalizedData.length > 0 ? Object.keys(normalizedData[0]).length : 0,
            instanceCount: instances.length,
            evidenceCoverage,
            reasoningCoverage,
            avgConfidence: avgConfidence.toFixed(3),
            llmResponse: isArray ? extraction.data : [extraction.data],
          },
        };
      } else {
        // Objeto único ou cardinality="one": comportamento padrão (replicar se necessário)
        dataToProcess = [extraction.data as Record<string, any>];
      }

      // ==================== 8. MAPEAR CAMPOS PARA INSTÂNCIAS (comportamento padrão) ====================
      // Construir mapeamento: fieldName → [{ instanceId, fieldId }]
      // Um campo pode estar em múltiplas instâncias (cardinality="many")
      const fieldMapping = this.buildFieldMapping(fields, instances);

      runLogger.info("Field mapping built", {
        fieldMappingSize: fieldMapping.size,
        totalMappings: Array.from(fieldMapping.values()).reduce((sum, maps) => sum + maps.length, 0),
      });

      // ==================== 8. SALVAR SUGESTÕES (comportamento padrão) ====================
      const saveStart = performance.now();
      runLogger.info("Saving suggestions to database");
      const suggestionsCreated = await dbWriter.saveSuggestions(
        options.articleId,
        runId,
        dataToProcess[0], // Usar primeiro item (ou único objeto)
        fieldMapping,
      );
      const saveDuration = performance.now() - saveStart;

      runLogger.info("Suggestions saved", {
        count: suggestionsCreated,
        duration: `${saveDuration.toFixed(0)}ms`,
      });

      // ==================== 8. ATUALIZAR STATUS DO RUN ====================
      await dbWriter.updateRunStatus(runId, "completed", {
        suggestions_created: suggestionsCreated,
        pdf_pages: pdf.pageCount || 0,
        tokens_used: extraction.metadata.tokens.total || 0,
        tokens_prompt: extraction.metadata.tokens.prompt || 0,
        tokens_completion: extraction.metadata.tokens.completion || 0,
        entity_type_id: options.entityTypeId,
      });

      const duration = performance.now() - start;

      runLogger.info("Pipeline completed successfully", {
        totalDuration: `${duration.toFixed(0)}ms`,
        breakdown: {
          pdfProcessing: `${pdfDuration.toFixed(0)}ms`,
          llmExtraction: `${llmDuration.toFixed(0)}ms`,
          dbSaving: `${saveDuration.toFixed(0)}ms`,
        },
        suggestionsCreated,
        tokensUsed: extraction.metadata.tokens.total,
      });

      return {
        runId,
        status: "completed",
        suggestionsCreated,
        metadata: {
          pdfPages: pdf.pageCount || 0,
          tokensUsed: extraction.metadata.tokens.total,
          tokensPrompt: extraction.metadata.tokens.prompt,
          tokensCompletion: extraction.metadata.tokens.completion,
          duration,
          // Campos adicionais para testes e debug
            fieldsExtracted: normalizedData.length > 0 ? Object.keys(normalizedData[0]).length : 0,
            instanceCount: instances.length,
            evidenceCoverage,
            reasoningCoverage,
            avgConfidence: avgConfidence.toFixed(3),
            // Resposta completa da LLM (para testes) - sempre como array para consistência
            llmResponse: isArray ? extraction.data : [extraction.data],
        },
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : undefined;

      this.logger.error("Pipeline failed", err as Error, {
        runId,
        errorMessage,
        errorStack,
      });

      // Atualizar status do run para failed
      // IMPORTANTE: Não retentar update de status para evitar loops de erro
      // Apenas logar erro mas continuar propagando o erro original
      if (runId) {
        const dbWriter = new SectionDBWriter(this.supabase, this.logger);
        try {
          await dbWriter.updateRunStatus(runId, "failed", {
            error_message: errorMessage,
          }, errorMessage);
        } catch (updateError) {
          // Logar erro detalhado mas não propagar (para evitar mascarar erro original)
          const updateErrorDetails = updateError instanceof Error
            ? {
                message: updateError.message,
                stack: updateError.stack,
                name: updateError.name,
              }
            : String(updateError);

          this.logger.error("Failed to update run status to failed - logging only", updateError as Error, {
            runId,
            originalError: errorMessage,
            originalErrorStack: errorStack,
            updateErrorDetails,
            timestamp: new Date().toISOString(),
            action: "Status update failed but original error will be propagated",
          });
          
          // Métrica para rastrear frequência de falhas de update
          this.logger.metric("run_status_update_failure", 1, "count", {
            runId,
            status: "failed",
          });
        }
      }

      throw err;
    }
  }

  /**
   * Busca instâncias existentes do entity_type
   * 
   * LÓGICA:
   * - Para cardinality="one": busca 1 instância (deve existir)
   * - Para cardinality="many": busca todas as instâncias existentes
   * - Retorna erro se não encontrar (usuário deve criar instâncias primeiro)
   * 
   * @param articleId - ID do artigo
   * @param templateId - ID do template
   * @param entityTypeId - ID do entity_type
   * @param cardinality - Cardinalidade ("one" ou "many")
   * @param logger - Logger para logging
   * @returns Array de instâncias encontradas
   */
  private async getInstances(
    articleId: string,
    templateId: string,
    entityTypeId: string,
    cardinality: "one" | "many",
    logger: Logger,
    parentInstanceId?: string, // Nova: filtrar por parent_instance_id quando fornecido
  ): Promise<Array<{ id: string; label: string }>> {
    let query = this.supabase
      .from("extraction_instances")
      .select("id, label")
      .eq("article_id", articleId)
      .eq("template_id", templateId)
      .eq("entity_type_id", entityTypeId);

    // Se parentInstanceId fornecido, filtrar apenas instâncias daquele parent
    // Se não fornecido, buscar todas as instâncias (tanto com parent quanto sem)
    // Isso permite extração normal de study-level (sem parent) e child entities (com parent)
    if (parentInstanceId) {
      query = query.eq("parent_instance_id", parentInstanceId);
      logger.info("Filtering instances by parent_instance_id", {
        parentInstanceId,
        entityTypeId,
      });
    }

    query = query.order("sort_order", { ascending: true });

    const { data, error } = await query;

    if (error) {
      throw new AppError(ErrorCode.DB_ERROR, "Failed to query instances", 500, {
        error: error.message,
      });
    }

    const instances = (data || []) as Array<{ id: string; label: string }>;

    // Validação: para cardinality="one", deve existir exatamente 1 instância
    // Mas aceitamos o que foi encontrado (já foi validado antes que não pode ser 0)
    if (cardinality === "one" && instances.length !== 1) {
      logger.warn("Cardinality mismatch: expected 1 instance but found different count", {
        expected: 1,
        found: instances.length,
        entityTypeId,
        issue: instances.length === 0 
          ? "No instances found - user must create one first" 
          : `Multiple instances found (${instances.length}) - will extract to all instances`,
      });
      // Em caso de múltiplas instâncias, extrair para todas (pode ser comportamento desejado)
    }

    return instances;
  }

  /**
   * Cria instâncias automaticamente quando cardinality="many" e não há instâncias existentes
   * 
   * LÓGICA:
   * - Cria N instâncias (onde N = itemsCount)
   * - Gera labels usando dados extraídos quando disponíveis, senão usa padrão "{EntityType} {i+1}"
   * - Atribui sort_order sequencial (0, 1, 2, ...)
   * 
   * @param projectId - ID do projeto
   * @param articleId - ID do artigo
   * @param templateId - ID do template
   * @param entityTypeId - ID do entity_type
   * @param userId - ID do usuário criando as instâncias
   * @param itemsCount - Número de instâncias a criar
   * @param entityType - Entity type para usar no label padrão
   * @param fields - Campos do entity_type (para identificar campo de label)
   * @param logger - Logger para logging
   * @param itemsData - (Opcional) Array com dados extraídos para gerar labels mais descritivos
   * @returns Array de instâncias criadas { id, label }
   */
  private async createInstances(
    projectId: string,
    articleId: string,
    templateId: string,
    entityTypeId: string,
    userId: string,
    itemsCount: number,
    entityType: { name: string; label: string },
    fields: Array<{ name: string; label: string }>,
    logger: Logger,
    itemsData?: Array<Record<string, any>>,
    parentInstanceId?: string, // Nova: para criar child instances com parent correto
  ): Promise<Array<{ id: string; label: string }>> {
    const instancesToCreate: Array<{
      project_id: string;
      article_id: string;
      template_id: string;
      entity_type_id: string;
      parent_instance_id: string | null;
      label: string;
      sort_order: number;
      metadata: Record<string, any>;
      created_by: string;
    }> = [];

    // Tentar encontrar um campo que possa servir como label (ex: "author_name", "name", etc.)
    // Priorizar campos que parecem ser identificadores/nomes
    let labelField: string | null = null;
    if (itemsData && itemsData.length > 0 && fields.length > 0) {
      // Buscar campo que parece ser um identificador/nome
      const potentialLabelFields = fields
        .filter(f => 
          f.name.toLowerCase().includes('name') || 
          f.name.toLowerCase().includes('title') ||
          f.name.toLowerCase().includes('label')
        )
        .map(f => f.name);
      
      if (potentialLabelFields.length > 0) {
        // Verificar se algum item tem esse campo preenchido
        const firstItem = itemsData[0];
        for (const fieldName of potentialLabelFields) {
          const fieldData = firstItem[fieldName];
          if (fieldData && typeof fieldData === 'object' && fieldData.value) {
            labelField = fieldName;
            break;
          }
        }
      }
    }

    for (let i = 0; i < itemsCount; i++) {
      let label: string;

      // Tentar gerar label a partir dos dados extraídos
      if (labelField && itemsData && itemsData[i]) {
        const fieldData = itemsData[i][labelField];
        if (fieldData && typeof fieldData === 'object' && fieldData.value) {
          // Usar valor do campo como label (ex: "Xue Zou" para author_name)
          label = String(fieldData.value);
        } else {
          // Fallback: usar padrão com índice
          label = `${entityType.label || entityType.name} ${i + 1}`;
        }
      } else {
        // Padrão: usar label do entity type + índice
        label = `${entityType.label || entityType.name} ${i + 1}`;
      }

      instancesToCreate.push({
        project_id: projectId,
        article_id: articleId,
        template_id: templateId,
        entity_type_id: entityTypeId,
        parent_instance_id: parentInstanceId || null, // Nova: incluir parent_instance_id se fornecido
        label,
        sort_order: i,
        metadata: {},
        created_by: userId,
      });
    }

    logger.info("Creating instances automatically", {
      entityTypeId,
      entityTypeName: entityType.name,
      count: instancesToCreate.length,
      labelField: labelField || "none (using default)",
      sampleLabels: instancesToCreate.slice(0, 3).map(i => i.label),
    });

    const { data, error } = await this.supabase
      .from("extraction_instances")
      .insert(instancesToCreate)
      .select("id, label");

    if (error) {
      throw new AppError(ErrorCode.DB_ERROR, "Failed to create instances", 500, {
        error: error.message,
        attemptedCount: instancesToCreate.length,
      });
    }

    const createdInstances = (data || []) as Array<{ id: string; label: string }>;

    logger.info("Instances created successfully", {
      count: createdInstances.length,
      instanceIds: createdInstances.map(i => i.id),
      labels: createdInstances.map(i => i.label),
    });

    return createdInstances;
  }

  /**
   * Constrói mapeamento de fieldName → [{ instanceId, fieldId }]
   * 
   * IMPORTANTE: 
   * - A chave do Map é o field.name (nome do campo no template),
   *   que deve corresponder EXATAMENTE ao nome retornado pelo LLM no extraction.data.
   * - Um campo pode estar em múltiplas instâncias (quando cardinality="many")
   * 
   * @param fields - Campos do entity_type
   * @param instances - Instâncias existentes
   * @returns Mapeamento fieldName → array de { instanceId, fieldId }
   */
  private buildFieldMapping(
    fields: Array<{ id: string; name: string }>,
    instances: Array<{ id: string }>,
  ): Map<string, Array<{ instanceId: string; fieldId: string }>> {
    const mapping = new Map<string, Array<{ instanceId: string; fieldId: string }>>();

    // Para cada campo, criar mapeamento para cada instância
    // Isso permite extrair o mesmo campo para múltiplas instâncias
    for (const field of fields) {
      const mappings: Array<{ instanceId: string; fieldId: string }> = [];

      for (const instance of instances) {
        mappings.push({
          instanceId: instance.id,
          fieldId: field.id,
        });
      }

      // CRÍTICO: Usar field.name como chave (deve corresponder ao nome retornado pelo LLM)
      mapping.set(field.name, mappings);
    }

    this.logger.debug("Field mapping constructed", {
      fieldCount: fields.length,
      fieldNames: fields.map(f => f.name),
      instanceCount: instances.length,
      totalMappings: Array.from(mapping.values()).reduce((sum, maps) => sum + maps.length, 0),
    });

    return mapping;
  }
}

