/**
 * Model Builder
 * 
 * Responsável por criar instâncias de modelos e suas hierarquias completas
 * baseadas em dados extraídos pela IA.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { Logger } from "../_shared/core/logger.ts";
import { AppError, ErrorCode } from "../_shared/core/error-handler.ts";

/**
 * Interface para dados extraídos de um modelo
 */
interface ExtractedModelData {
  model_name?: { value: any; confidence_score?: number; reasoning?: string };
  modelling_method?: { value: any; confidence_score?: number; reasoning?: string };
  [key: string]: any;
}

/**
 * Interface para resultado de criação de modelo
 */
export interface CreatedModel {
  instanceId: string;
  modelName: string;
  modellingMethod?: string;
  childInstancesCount: number;
}

/**
 * Tipos mínimos do banco
 */
interface DbExtractionEntityType {
  id: string;
  name: string;
  label: string;
  cardinality: "one" | "many";
  parent_entity_type_id: string | null;
}

interface DbExtractionField {
  id: string;
  name: string;
  label: string;
}

/**
 * Classe para construir modelos e hierarquias
 */
export class ModelBuilder {
  constructor(
    private supabase: SupabaseClient,
    private logger: Logger,
  ) {}

  /**
   * Cria modelos a partir de dados extraídos
   * 
   * Para cada modelo extraído:
   * 1. Extrai model_name (ou gera label padrão)
   * 2. Verifica se modelo já existe (evitar duplicatas)
   * 3. Cria instância do modelo
   * 4. Busca child entity types
   * 5. Cria child instances automaticamente
   */
  async createModelsFromExtraction(
    projectId: string,
    articleId: string,
    templateId: string,
    entityTypeId: string,
    userId: string,
    modelsData: Array<Record<string, any>>,
    entityType: DbExtractionEntityType,
    fields: DbExtractionField[],
  ): Promise<CreatedModel[]> {
    const createdModels: CreatedModel[] = [];

    // Buscar child entity types (entities relacionadas a prediction_models)
    const { data: childEntityTypes, error: childError } = await this.supabase
      .from("extraction_entity_types")
      .select("*")
      .eq("project_template_id", templateId)
      .eq("parent_entity_type_id", entityTypeId)
      .order("sort_order");

    if (childError) {
      throw new AppError(ErrorCode.DB_ERROR, "Failed to query child entity types", 500, {
        error: childError.message,
      });
    }

    const childEntities = (childEntityTypes || []) as DbExtractionEntityType[];

    this.logger.info("Found child entity types for models", {
      childCount: childEntities.length,
      childNames: childEntities.map(e => e.name),
    });

    // Buscar modelos existentes para evitar duplicatas
    const { data: existingModels, error: existingError } = await this.supabase
      .from("extraction_instances")
      .select("id, label")
      .eq("article_id", articleId)
      .eq("entity_type_id", entityTypeId);

    if (existingError) {
      this.logger.warn("Failed to query existing models, continuing anyway", {
        error: existingError.message,
        articleId,
        entityTypeId,
      });
    }

    const existingLabels = new Set((existingModels || []).map(m => m.label.toLowerCase().trim()));
    
    this.logger.info("Existing models check", {
      existingModelsCount: existingModels?.length || 0,
      existingLabels: Array.from(existingLabels),
      articleId,
      entityTypeId,
    });

    // Processar cada modelo extraído
    for (let i = 0; i < modelsData.length; i++) {
      const modelData = modelsData[i];

      try {
        // Log detalhado do modelo sendo processado
        this.logger.info("Processing model data", {
          index: i,
          modelDataKeys: Object.keys(modelData),
          modelNameField: modelData.model_name,
          modelNameFieldType: typeof modelData.model_name,
          modelNameFieldValue: modelData.model_name && typeof modelData.model_name === 'object'
            ? modelData.model_name.value
            : modelData.model_name,
        });

        // Extrair model_name - suportar múltiplos formatos
        let modelName: string;
        const modelNameField = modelData.model_name;
        
        if (modelNameField && typeof modelNameField === 'object') {
          // Formato enriquecido: { value: "...", confidence_score: ..., reasoning: ... }
          if (modelNameField.value !== undefined && modelNameField.value !== null) {
            modelName = String(modelNameField.value).trim();
          } else {
            // Tentar outras propriedades comuns
            modelName = (modelNameField.text || modelNameField.name || String(modelNameField)).trim();
          }
        } else if (typeof modelData.model_name === 'string') {
          modelName = modelData.model_name.trim();
        } else if (modelData.modelName) {
          // Formato alternativo: modelName (camelCase)
          modelName = String(modelData.modelName).trim();
        } else {
          // Fallback: gerar nome baseado no índice
          modelName = `Model ${i + 1}`;
          this.logger.warn("Model name not found, using fallback", {
            index: i,
            availableKeys: Object.keys(modelData),
          });
        }

        // Validar que modelName não está vazio após trim
        if (!modelName || modelName.length === 0) {
          this.logger.warn("Model name is empty after extraction, using fallback", {
            index: i,
            originalField: modelData.model_name,
          });
          modelName = `Model ${i + 1}`;
        }

        this.logger.info("Extracted model name", {
          index: i,
          modelName,
          originalField: modelData.model_name,
        });

        // Verificar se modelo já existe (case-insensitive)
        if (existingLabels.has(modelName.toLowerCase())) {
          this.logger.warn("Model already exists, skipping", {
            modelName,
            index: i,
            existingLabels: Array.from(existingLabels),
          });
          continue;
        }

        // Extrair modelling_method
        let modellingMethod: string | undefined;
        const methodField = modelData.modelling_method;
        if (methodField && typeof methodField === 'object' && methodField.value) {
          modellingMethod = String(methodField.value).trim();
        } else if (typeof modelData.modelling_method === 'string') {
          modellingMethod = modelData.modelling_method.trim();
        }

        // Garantir nome único
        let uniqueLabel = modelName;
        let attempt = 1;
        while (existingLabels.has(uniqueLabel.toLowerCase())) {
          uniqueLabel = `${modelName} (${attempt})`;
          attempt++;
        }

        // Criar instância do modelo
        const { data: modelInstance, error: createError } = await this.supabase
          .from("extraction_instances")
          .insert({
            project_id: projectId,
            article_id: articleId,
            template_id: templateId,
            entity_type_id: entityTypeId,
            parent_instance_id: null,
            label: uniqueLabel,
            sort_order: i,
            metadata: {},
            created_by: userId,
          })
          .select("id, label")
          .single();

        if (createError || !modelInstance) {
          throw new AppError(
            ErrorCode.DB_ERROR,
            `Failed to create model instance: ${createError?.message || "No data returned"}`,
            500,
            { modelName: uniqueLabel, error: createError?.message },
          );
        }

        existingLabels.add(uniqueLabel.toLowerCase()); // Adicionar à lista para evitar duplicatas nesta execução

        this.logger.info("Model instance created", {
          instanceId: modelInstance.id,
          modelName: uniqueLabel,
        });

        // Criar child instances para este modelo
        const childInstances = await this.createChildInstances(
          projectId,
          articleId,
          templateId,
          modelInstance.id,
          modelInstance.label, // Passar label do modelo para incluir no label da child instance
          userId,
          childEntities,
        );

        createdModels.push({
          instanceId: modelInstance.id,
          modelName: uniqueLabel,
          modellingMethod,
          childInstancesCount: childInstances.length,
        });

        this.logger.info("Model hierarchy created", {
          modelId: modelInstance.id,
          modelName: uniqueLabel,
          childCount: childInstances.length,
        });
      } catch (error) {
        this.logger.error(`Failed to create model at index ${i}`, error as Error, {
          modelData: JSON.stringify(modelData).substring(0, 200),
        });
        // Continuar com próximo modelo mesmo se este falhar
      }
    }

    return createdModels;
  }

  /**
   * Cria child instances para um modelo
   * 
   * Cria apenas child entities com cardinality="one" automaticamente
   * (child entities com cardinality="many" são criadas manualmente ou durante extração)
   */
  private async createChildInstances(
    projectId: string,
    articleId: string,
    templateId: string,
    parentInstanceId: string,
    parentModelLabel: string, // Label do modelo pai para incluir no label da child
    userId: string,
    childEntityTypes: DbExtractionEntityType[],
  ): Promise<Array<{ id: string; label: string }>> {
    const created: Array<{ id: string; label: string }> = [];

    // Criar apenas child entities com cardinality="one"
    const childrenToCreate = childEntityTypes.filter(et => et.cardinality === "one");

    for (const childEntityType of childrenToCreate) {
      try {
        // Gerar label único incluindo referência ao modelo pai
        // Formato: "{Model Label} - {Child Entity Label} 1"
        // Isso evita conflitos de constraint quando múltiplos modelos têm child entities com mesmo nome
        const label = `${parentModelLabel} - ${childEntityType.label} 1`;

        const { data: childInstance, error: childError } = await this.supabase
          .from("extraction_instances")
          .insert({
            project_id: projectId,
            article_id: articleId,
            template_id: templateId,
            entity_type_id: childEntityType.id,
            parent_instance_id: parentInstanceId,
            label,
            sort_order: 0,
            metadata: {},
            created_by: userId,
          })
          .select("id, label")
          .single();

        if (childError || !childInstance) {
          this.logger.error("Failed to create child instance", childError as Error || new Error("No instance returned"), {
            childEntityType: childEntityType.name,
            childEntityLabel: childEntityType.label,
            parentInstanceId,
            parentModelLabel,
            attemptedLabel: label,
            errorCode: (childError as any)?.code,
            errorMessage: childError?.message,
            errorDetails: (childError as any)?.details,
          });
          continue;
        }

        created.push(childInstance);
      } catch (error) {
        this.logger.error("Error creating child instance", error as Error, {
          childEntityType: childEntityType.name,
          childEntityLabel: childEntityType.label,
          parentInstanceId,
          parentModelLabel,
          attemptedLabel: label,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        // Continuar com próximo child mesmo se este falhar
      }
    }

    return created;
  }
}

