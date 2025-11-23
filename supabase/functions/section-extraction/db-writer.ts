/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * DB Writer para Section Extraction
 * 
 * Responsável por salvar resultados de extração em extraction_runs e ai_suggestions.
 * 
 * DIFERENCIAL CRÍTICO: Processa dados enriquecidos com metadata (confidence_score, reasoning, evidence)
 * e mapeia corretamente para o banco de dados.
 * 
 * ESTRUTURA DE DADOS ENTRADA:
 * {
 *   fieldName: {
 *     value: any,
 *     confidence_score: number,
 *     reasoning: string,
 *     evidence?: { text: string, page_number?: number }
 *   }
 * }
 * 
 * MAPEAMENTO PARA BANCO:
 * - value → suggested_value.value (JSONB)
 * - confidence_score → confidence_score (DECIMAL)
 * - reasoning → reasoning (TEXT)
 * - evidence → metadata.evidence (JSONB) [coluna metadata separada]
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { Logger } from "../_shared/core/logger.ts";
import { AppError, ErrorCode } from "../_shared/core/error-handler.ts";

/**
 * Interface para dados enriquecidos de um campo
 * 
 * Estrutura retornada pelo LLM quando extrai um campo
 */
interface EnrichedFieldData {
  value: any;
  confidence_score: number;
  reasoning: string;
  evidence?: {
    text: string;
    page_number?: number;
  };
}

/**
 * Interface para mapeamento campo → instância + field_id
 */
interface FieldMapping {
  instanceId: string;
  fieldId: string;
}

/**
 * Classe para escrita no banco de dados
 * 
 * RESPONSABILIDADES:
 * - Criar registro em extraction_runs
 * - Mapear dados enriquecidos para ai_suggestions
 * - Tratar múltiplas instâncias (cardinality="many")
 * - Validar e sanitizar dados antes de inserir
 */
export class SectionDBWriter {
  constructor(private supabase: SupabaseClient, private logger: Logger) {}

  /**
   * Salva sugestões de IA no banco
   * 
   * PROCESSAMENTO:
   * 1. Para cada campo extraído (fieldName → enrichedData)
   * 2. Para cada instância do entity_type
   * 3. Criar registro em ai_suggestions com:
   *    - run_id: ID do extraction_run
   *    - instance_id: ID da instância
   *    - field_id: ID do campo
   *    - suggested_value: { value } (apenas o valor extraído)
   *    - metadata: { evidence } (coluna JSONB separada)
   *    - confidence_score: do LLM (dinâmico)
   *    - reasoning: do LLM (justificativa)
   * 
   * @param articleId - ID do artigo
   * @param runId - ID do extraction_run
   * @param extractedData - Dados extraídos (estrutura enriquecida)
   * @param fieldMapping - Mapeamento fieldName → { instanceId, fieldId }
   * @returns Número de sugestões criadas
   */
  async saveSuggestions(
    articleId: string,
    runId: string,
    extractedData: Record<string, EnrichedFieldData | null>,
    fieldMapping: Map<string, FieldMapping[]>, // Um field pode ter múltiplas instâncias
  ): Promise<number> {
    const start = performance.now();
    const suggestions: any[] = [];

    try {
      this.logger.info("Building suggestions from enriched data", {
        extractedFieldsCount: Object.keys(extractedData).length,
        extractedFieldNames: Object.keys(extractedData),
        fieldMappingSize: fieldMapping.size,
        fieldMappingKeys: Array.from(fieldMapping.keys()),
      });

      let skippedCount = 0;
      let mappedCount = 0;
      let validationFailures = 0;
      let mappingFailures = 0;

      // Processar cada campo extraído
      for (const [fieldName, enrichedData] of Object.entries(extractedData)) {
        // Se campo é null (não encontrado e opcional), pular
        if (enrichedData === null) {
          skippedCount++;
          this.logger.debug("Skipping null field", { fieldName });
          continue;
        }

        // Validar estrutura enriquecida
        if (!this.isValidEnrichedData(enrichedData)) {
          validationFailures++;
          // Type assertion para acessar propriedades no log (mesmo que inválido)
          const data = enrichedData as any;
          this.logger.warn("Invalid enriched data structure - rejecting field", {
            fieldName,
            dataKeys: Object.keys(enrichedData),
            hasValue: 'value' in enrichedData,
            hasConfidence: 'confidence_score' in enrichedData,
            confidenceType: typeof data.confidence_score,
            confidenceValue: data.confidence_score,
            hasReasoning: 'reasoning' in enrichedData,
            reasoningType: typeof data.reasoning,
            reasoningLength: typeof data.reasoning === 'string' ? data.reasoning.length : 'N/A',
            sampleData: enrichedData !== undefined && enrichedData !== null 
              ? (JSON.stringify(enrichedData) || '').substring(0, 300)
              : '(enrichedData is null/undefined)',
          });
          skippedCount++;
          continue;
        }

        // Buscar mapeamento para este campo (exact match)
        const mappings = fieldMapping.get(fieldName);
        
        // Se não encontrou, tentar case-insensitive match (para ajudar com debugging)
        if (!mappings || mappings.length === 0) {
          const caseInsensitiveMatch = Array.from(fieldMapping.keys()).find(
            key => key.toLowerCase() === fieldName.toLowerCase()
          );
          
          if (caseInsensitiveMatch) {
            this.logger.warn("Field name case mismatch detected", {
              extractedFieldName: fieldName,
              expectedFieldName: caseInsensitiveMatch,
              suggestion: `Field names are case-sensitive. LLM returned "${fieldName}" but template has "${caseInsensitiveMatch}". This field will be skipped.`,
            });
          } else {
            // Tentar encontrar similaridade (para debugging)
            const similarFields = Array.from(fieldMapping.keys())
              .map(key => ({
                key,
                similarity: this.calculateSimilarity(fieldName.toLowerCase(), key.toLowerCase()),
              }))
              .filter(item => item.similarity > 0.7)
              .sort((a, b) => b.similarity - a.similarity)
              .slice(0, 3);
            
          this.logger.warn("No mapping found for field - field name mismatch", {
            fieldName,
            availableMappings: Array.from(fieldMapping.keys()),
            availableExtractedFields: Object.keys(extractedData),
              similarFields: similarFields.length > 0 
                ? similarFields.map(f => `${f.key} (similarity: ${(f.similarity * 100).toFixed(0)}%)`)
                : undefined,
              suggestion: similarFields.length > 0
                ? `Did you mean "${similarFields[0].key}"? Field names must match exactly.`
                : "Field name must match exactly with field.name in extraction_fields table.",
            });
          }
          
          mappingFailures++;
          skippedCount++;
          continue;
        }

        // Para cada instância mapeada, criar sugestão
        // Isso permite extração para múltiplas instâncias (cardinality="many")
        for (const mapping of mappings) {
          mappedCount++;

          // Validar estrutura antes de construir sugestão
          const validationResult = this.validateSuggestionData(
            enrichedData,
            fieldName,
            mapping.fieldId,
          );

          if (!validationResult.valid) {
            this.logger.warn("Validation failed for suggestion", {
              fieldName,
              fieldId: mapping.fieldId,
              instanceId: mapping.instanceId,
              errors: validationResult.errors,
            });
            validationFailures++;
            skippedCount++;
            continue;
          }

          // Construir suggested_value (apenas o valor extraído)
          // O valor é armazenado diretamente em suggested_value
          const suggestedValue: any = {
            value: enrichedData.value,
          };

          // Construir metadata separada (evidence e outras informações)
          // metadata é uma coluna JSONB separada para maior organização
          const metadata: any = {};
          // evidence é opcional - se presente, sempre tem text e pode ter page_number
          if (enrichedData.evidence !== null && enrichedData.evidence !== undefined && typeof enrichedData.evidence === 'object') {
            const evidence = enrichedData.evidence as { text?: string; page_number?: number | null };
            if (evidence.text) {
            metadata.evidence = {
                text: evidence.text,
              // page_number sempre incluído (pode ser null quando não identificado)
              // Usamos null em vez de omitir para manter estrutura consistente
                page_number: evidence.page_number ?? null,
            };
            }
          }

          // Criar sugestão com todos os campos
          suggestions.push({
            run_id: runId,
            instance_id: mapping.instanceId,
            field_id: mapping.fieldId,
            suggested_value: suggestedValue, // Apenas o valor
            metadata: metadata, // Metadados separados (evidence, etc.)
            confidence_score: enrichedData.confidence_score, // Dinâmico do LLM (não hardcoded!)
            reasoning: enrichedData.reasoning, // Justificativa do LLM
            status: "pending",
            created_at: new Date().toISOString(),
          });
        }
      }

      // Contar quantas sugestões têm evidence
      const suggestionsWithEvidence = suggestions.filter(s => 
        s.metadata?.evidence && s.metadata.evidence.text
      ).length;

      this.logger.info("Suggestions built", {
        total: suggestions.length,
        mapped: mappedCount,
        skipped: skippedCount,
        validationFailures,
        mappingFailures,
        suggestionsWithEvidence,
        evidenceCoverage: suggestions.length > 0 
          ? `${((suggestionsWithEvidence / suggestions.length) * 100).toFixed(1)}%`
          : "0%",
        breakdown: {
          nullFields: skippedCount - validationFailures - mappingFailures,
          invalidStructure: validationFailures,
          noMapping: mappingFailures,
        },
      });

      // Validação: verificar se há sugestões para salvar
      if (suggestions.length === 0) {
        // Análise detalhada do porquê não há sugestões
        const extractedFields = Object.keys(extractedData);
        const mappingKeys = Array.from(fieldMapping.keys());
        const unmatchedFields = extractedFields.filter(f => !mappingKeys.includes(f));
        const unmatchedMappings = mappingKeys.filter(k => !extractedFields.includes(k));

        this.logger.warn("No valid suggestions to save - all fields were skipped", {
          articleId,
          runId,
          extractedFieldsCount: extractedFields.length,
          extractedFieldNames: extractedFields,
          fieldMappingSize: fieldMapping.size,
          fieldMappingKeys: mappingKeys,
          validationFailures,
          mappingFailures,
          // Análise de incompatibilidade de nomes (possível causa principal)
          unmatchedExtractedFields: unmatchedFields,
          unmatchedMappingKeys: unmatchedMappings,
          suggestion: unmatchedFields.length > 0 || unmatchedMappings.length > 0
            ? "Field name mismatch between LLM output and template field names - check field.name in extraction_fields table"
            : "All fields were skipped due to validation failures or null values",
        });
        return 0;
      }

      // Inserir todas as sugestões em uma transação
      // Isso garante atomicidade: todas ou nenhuma
      // Log detalhado do mapeamento antes de inserir
      const fieldInstanceMapping = suggestions.reduce((acc, s) => {
        const key = `field_${s.field_id}_instance_${s.instance_id}`;
        if (!acc[key]) {
          acc[key] = {
            fieldId: s.field_id,
            instanceId: s.instance_id,
            count: 0,
            hasEvidence: false,
            avgConfidence: 0,
          };
        }
        acc[key].count++;
        if (s.metadata?.evidence?.text) {
          acc[key].hasEvidence = true;
        }
        return acc;
      }, {} as Record<string, { fieldId: string; instanceId: string; count: number; hasEvidence: boolean; avgConfidence: number }>);

      this.logger.info("Inserting suggestions into ai_suggestions", {
        count: suggestions.length,
        fieldInstanceMapping: Object.values(fieldInstanceMapping).map(m => ({
          fieldId: m.fieldId,
          instanceId: m.instanceId,
          suggestionsCount: m.count,
          hasEvidence: m.hasEvidence,
        })),
        sampleSuggestion: suggestions[0] ? {
          run_id: suggestions[0].run_id,
          instance_id: suggestions[0].instance_id,
          field_id: suggestions[0].field_id,
          hasSuggestedValue: !!suggestions[0].suggested_value,
          confidence_score: suggestions[0].confidence_score,
          hasReasoning: !!suggestions[0].reasoning,
          reasoningLength: suggestions[0].reasoning?.length || 0,
          hasEvidence: !!(suggestions[0].metadata?.evidence?.text),
          evidencePageNumber: suggestions[0].metadata?.evidence?.page_number ?? null,
          status: suggestions[0].status,
        } : null,
      });

      const { data, error } = await this.supabase
        .from("ai_suggestions")
        .insert(suggestions)
        .select();

      if (error) {
        this.logger.error("Failed to insert into ai_suggestions", new Error(error.message), {
          errorCode: error.code,
          errorMessage: error.message,
          errorDetails: error.details,
          errorHint: error.hint,
          suggestionsCount: suggestions.length,
          sampleSuggestion: suggestions[0] && suggestions[0] !== undefined && suggestions[0] !== null
            ? (JSON.stringify(suggestions[0]) || '').substring(0, 500)
            : null,
          allFieldIds: suggestions.map(s => s.field_id),
          allInstanceIds: suggestions.map(s => s.instance_id),
        });
        throw new AppError(ErrorCode.DB_ERROR, "Failed to save suggestions", 500, {
          error: error.message,
          errorCode: error.code,
          errorDetails: error.details,
          errorHint: error.hint,
          suggestionsCount: suggestions.length,
        });
      }

      const count = data?.length || 0;
      const duration = performance.now() - start;

      this.logger.info("Suggestions saved successfully", {
        count,
        duration: `${duration.toFixed(0)}ms`,
      });

      return count;
    } catch (err) {
      this.logger.error("Failed to save suggestions", err as Error, {
        articleId,
        runId,
      });
      throw err;
    }
  }

  /**
   * Valida estrutura de dados de uma sugestão antes de inserir no banco
   * 
   * @param data - Dados enriquecidos a validar
   * @param fieldName - Nome do campo (para logging)
   * @param fieldId - ID do campo (para logging)
   * @returns Resultado da validação com lista de erros
   */
  private validateSuggestionData(
    data: EnrichedFieldData,
    fieldName: string,
    fieldId: string,
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validar confidence_score está no range correto (0-1)
    if (
      typeof data.confidence_score !== "number" ||
      data.confidence_score < 0 ||
      data.confidence_score > 1
    ) {
      errors.push(
        `confidence_score must be a number between 0 and 1, got: ${data.confidence_score} (type: ${typeof data.confidence_score})`,
      );
    }

    // Validar reasoning é string (pode ser vazia)
    if (typeof data.reasoning !== "string") {
      errors.push(
        `reasoning must be a string, got: ${typeof data.reasoning}`,
      );
    }

    // Validar suggested_value estrutura
    if (data.value === undefined) {
      errors.push("suggested_value.value is required but is undefined");
    }

    // Validar evidence se presente
    if (data.evidence !== null && data.evidence !== undefined) {
      if (typeof data.evidence !== "object") {
        errors.push(`evidence must be an object or null, got: ${typeof data.evidence}`);
      } else {
        if (typeof data.evidence.text !== "string" || data.evidence.text.length === 0) {
          errors.push("evidence.text must be a non-empty string");
        }
        if (
          data.evidence.page_number !== null &&
          data.evidence.page_number !== undefined &&
          (typeof data.evidence.page_number !== "number" || data.evidence.page_number < 1)
        ) {
          errors.push(
            `evidence.page_number must be a positive integer or null, got: ${data.evidence.page_number}`,
          );
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Calcula similaridade entre duas strings (para sugerir field names similares)
   * Usa algoritmo simples de Levenshtein distance normalizado
   * 
   * @param str1 - Primeira string
   * @param str2 - Segunda string
   * @returns Similaridade entre 0 e 1 (1 = idêntico)
   */
  private calculateSimilarity(str1: string, str2: string): number {
    if (str1 === str2) return 1;
    if (str1.length === 0 || str2.length === 0) return 0;
    
    // Algoritmo simples de similaridade baseado em subsequências comuns
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    let commonChars = 0;
    for (let i = 0; i < shorter.length; i++) {
      if (longer.includes(shorter[i])) {
        commonChars++;
      }
    }
    
    return commonChars / longer.length;
  }

  /**
   * Valida se os dados enriquecidos têm estrutura correta
   * 
   * NOTA: reasoning pode ser string vazia (alguns LLMs podem retornar "")
   * mas ainda assim deve ser uma string válida (não undefined/null)
   * 
   * @param data - Dados a validar
   * @returns true se estrutura é válida
   */
  private isValidEnrichedData(data: any): data is EnrichedFieldData {
    if (data === null || typeof data !== "object") {
      return false;
    }

    // value é obrigatório
    if (!("value" in data)) {
      return false;
    }

    // confidence_score deve ser número entre 0 e 1
    if (
      typeof data.confidence_score !== "number" ||
      data.confidence_score < 0 ||
      data.confidence_score > 1
    ) {
      return false;
    }

    // reasoning deve ser string (pode ser vazia, mas deve existir)
    if (typeof data.reasoning !== "string") {
      return false;
    }

    return true;
  }

  /**
   * Cria registro em extraction_runs
   * 
   * @param projectId - ID do projeto
   * @param articleId - ID do artigo
   * @param templateId - ID do template
   * @param entityTypeId - ID do entity_type extraído
   * @param userId - ID do usuário que iniciou a extração
   * @param parameters - Parâmetros da extração (modelo, etc.)
   * @returns ID do extraction_run criado
   */
  async createRun(
    projectId: string,
    articleId: string,
    templateId: string,
    entityTypeId: string,
    userId: string,
    parameters: Record<string, any> = {},
  ): Promise<string> {
    try {
      const { data, error } = await this.supabase
        .from("extraction_runs")
        .insert({
          project_id: projectId,
          article_id: articleId,
          template_id: templateId,
          stage: "data_suggest", // Sempre data_suggest para extrações de seção
          status: "running",
          parameters: {
            ...parameters,
            entityTypeId, // Incluir entityTypeId nos parâmetros para rastreabilidade
          },
          results: {},
          started_at: new Date().toISOString(),
          created_by: userId,
        })
        .select("id")
        .single();

      if (error) {
        throw new AppError(ErrorCode.DB_ERROR, "Failed to create extraction run", 500, {
          error: error.message,
        });
      }

      this.logger.info("Extraction run created", {
        runId: data.id,
        entityTypeId,
      });

      return data.id;
    } catch (err) {
      this.logger.error("Failed to create extraction run", err as Error);
      throw err;
    }
  }

  /**
   * Atualiza status do extraction_run
   * 
   * @param runId - ID do extraction_run
   * @param status - Novo status (completed ou failed)
   * @param results - Resultados da extração (suggestionsCreated, tokensUsed, etc.)
   * @param errorMessage - Mensagem de erro (se status = failed)
   */
  async updateRunStatus(
    runId: string,
    status: "completed" | "failed",
    results: Record<string, any> = {},
    errorMessage?: string,
  ): Promise<void> {
    try {
      const updateData: any = {
        status,
        completed_at: new Date().toISOString(),
        results,
      };

      // Se falhou, adicionar mensagem de erro
      if (status === "failed" && errorMessage) {
        updateData.error_message = errorMessage;
      }

      const { error } = await this.supabase
        .from("extraction_runs")
        .update(updateData)
        .eq("id", runId);

      if (error) {
        throw new AppError(ErrorCode.DB_ERROR, "Failed to update run status", 500, {
          error: error.message,
        });
      }

      this.logger.info("Extraction run status updated", {
        runId,
        status,
      });
    } catch (err) {
      this.logger.error("Failed to update run status", err as Error, { runId });
      throw err;
    }
  }
}

