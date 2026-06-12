/**
 * Service layer for extraction instance management
 *
 * Centralizes create, update and delete logic for instances,
 * providing a unified interface and avoiding code duplication.
 *
 * Phase 3: Full observability (logging + metrics).
 *
 * @module services/extractionInstanceService
 */

import {supabase} from '@/integrations/supabase/client';
import {extractionLogger, performanceTracker} from '@/lib/extraction/observability';
import {
  deleteOne,
  handleSupabaseError,
  insertOne,
  queryBuilder,
  queryBuilderSingle,
  SupabaseRepositoryError
} from '@/lib/supabase/baseRepository';
import type {ExtractionEntityType, ExtractionInstance} from '@/types/extraction';

// =================== INTERFACES ===================

export interface CreateInstanceParams {
  projectId: string;
  articleId: string;
  templateId: string;
  entityTypeId: string;
  entityType: ExtractionEntityType;
  parentInstanceId?: string | null;
  label?: string;
  metadata?: any;
  userId: string;
}

export interface CreateInstanceResult {
  instance: ExtractionInstance;
  wasCreated: boolean;
}

export interface CreateHierarchyParams {
  projectId: string;
  articleId: string;
  templateId: string;
  parentEntityType: ExtractionEntityType;
  childEntityTypes: ExtractionEntityType[];
  label: string;
  metadata?: any;
  userId: string;
}

export interface CreateHierarchyResult {
  parent: ExtractionInstance;
  children: ExtractionInstance[];
}

export interface GetInstancesParams {
  articleId: string;
  templateId: string;
  options?: {
    entityTypeId?: string;
    parentInstanceId?: string | null;
    includeChildren?: boolean;
  };
}

// =================== SERVICE CLASS ===================

export class ExtractionInstanceService {
  /**
   * Creates a new extraction instance
   */
  async createInstance(params: CreateInstanceParams): Promise<CreateInstanceResult> {
    const {
      projectId,
      articleId,
      templateId,
      entityTypeId,
      entityType,
      parentInstanceId,
      label: customLabel,
      metadata = {},
      userId
    } = params;

      // Performance tracking
    const perfId = performanceTracker.start('createInstance', {
      entityType: entityType.name,
      cardinality: entityType.cardinality
    });

    try {
        extractionLogger.debug('createInstance', 'Starting instance creation', {
        entityType: entityType.name,
        cardinality: entityType.cardinality,
        hasParent: !!parentInstanceId
      });

        // Proactive cardinality validation via DB function
      if (entityType.cardinality === 'one') {
        const { data: canCreate, error: cardinalityError } = await supabase
          .rpc('check_cardinality_one', {
            p_article_id: articleId,
            p_entity_type_id: entityTypeId,
            p_parent_instance_id: parentInstanceId || undefined
          });

        if (cardinalityError) {
            extractionLogger.warn('createInstance', 'Cardinality validation error', {
            error: cardinalityError,
            entityType: entityType.name,
            articleId
          });
            // Continue with legacy validation as fallback
        } else if (canCreate === false) {
            // Instance already exists, fetch and return
          const { data: existing } = await queryBuilderSingle<ExtractionInstance>(
            'extraction_instances',
            {
              select: '*',
              filters: {
                article_id: articleId,
                entity_type_id: entityTypeId,
                parent_instance_id: parentInstanceId || null,
              },
            }
          );

          if (existing) {
              extractionLogger.info('createInstance', 'Instance with cardinality=one already exists', {
              instanceId: existing.id,
              label: existing.label
            });
            return {
              instance: existing,
              wasCreated: false
            };
          }
        }
      }

        // Fetch parent instance if needed
      let parentInstance: ExtractionInstance | undefined;
      if (parentInstanceId) {
        const { data } = await queryBuilderSingle<ExtractionInstance>(
          'extraction_instances',
          {
            select: '*',
            filters: { id: parentInstanceId },
          }
        );

        if (data) {
          parentInstance = data;
        }
      }

        // Generate label if not provided
      const generatedLabel = customLabel || await this.generateLabel(
        entityType,
        articleId,
        parentInstanceId,
        parentInstance
      );

        // Ensure unique label
      const uniqueLabel = await this.ensureUniqueName(
        generatedLabel,
        articleId,
        entityTypeId
      );

        // Compute sort_order
        const sortBaseQuery = supabase
        .from('extraction_instances')
        .select('*', { count: 'exact', head: true })
        .eq('article_id', articleId)
            .eq('entity_type_id', entityTypeId);
        const {count} = await (parentInstanceId
            ? sortBaseQuery.eq('parent_instance_id', parentInstanceId)
            : sortBaseQuery.is('parent_instance_id', null));

      const sortOrder = count || 0;

        // Create instance using baseRepository
      const newInstance = await insertOne<ExtractionInstance>(
        'extraction_instances',
        {
          project_id: projectId,
          article_id: articleId,
          template_id: templateId,
          entity_type_id: entityTypeId,
          parent_instance_id: parentInstanceId || null,
          label: uniqueLabel,
          sort_order: sortOrder,
          metadata,
          created_by: userId
        },
        'createInstance'
      );

      const duration = performanceTracker.end(perfId);

        extractionLogger.info('createInstance', 'Instance created successfully', {
        instanceId: newInstance.id,
        label: uniqueLabel,
        duration
      });

      return {
        instance: newInstance as ExtractionInstance,
        wasCreated: true
      };

    } catch (error: unknown) {
      performanceTracker.end(perfId);

        // Detect DB validation errors (trigger/constraint); support both EN and PT messages
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const isValidationError =
        errorMessage.includes('parent_entity_type_id') ||
        errorMessage.includes('template_id') ||
          errorMessage.includes('cycle detected') ||
        errorMessage.includes('cardinality') ||
          errorMessage.includes('is not a child of');

        extractionLogger.error('createInstance', 'Failed to create instance', error as Error, {
        entityType: entityType.name,
        label: customLabel,
        isValidationError
      });

        // If already SupabaseRepositoryError, re-throw with extra context
      if (error instanceof SupabaseRepositoryError) {
          // Improve message for validation errors
        if (isValidationError) {
          throw new SupabaseRepositoryError(
              `Validation error: ${errorMessage}. Check the template hierarchy and entity cardinality.`,
            error.originalError
          );
        }
        throw error;
      }

        // More specific message for validation errors
      if (isValidationError) {
          throw new Error(`Integrity validation failed: ${errorMessage}`);
      }

        throw new Error(`Failed to create instance: ${errorMessage}`);
    }
  }

  /**
   * Checks if unique name is required (prevent constraint violation)
   */
  private async ensureUniqueName(
    label: string,
    articleId: string,
    entityTypeId: string,
    maxAttempts: number = 10
  ): Promise<string> {
    let uniqueLabel = label;
    let attempt = 1;

    while (attempt <= maxAttempts) {
      const { data: existing, error } = await supabase
        .from('extraction_instances')
        .select('id')
        .eq('article_id', articleId)
        .eq('entity_type_id', entityTypeId)
        .eq('label', uniqueLabel)
        .limit(1);

      if (error) throw error;

      if (!existing || existing.length === 0) {
        return uniqueLabel;
      }

      attempt++;
      // Strip any trailing "(n)" from the original label, then append the new
      // attempt number unconditionally. This produces a clean sequence
      // ("Study (2)", "Study (3)", ...) regardless of whether the caller
      // supplied a label that already ends with a suffix.
      uniqueLabel = `${label.replace(/\s*\(\d+\)$/, '')} (${attempt})`;
    }

      // Fallback with timestamp
    return `${label} (${Date.now()})`;
  }

  /**
   * Generates next unique label for an entity type
   */
  private async generateLabel(
    entityType: ExtractionEntityType,
    articleId: string,
    parentInstanceId?: string | null,
    parentInstance?: ExtractionInstance
  ): Promise<string> {
      // Count existing instances of same type and parent
      const baseQuery = supabase
      .from('extraction_instances')
      .select('*', { count: 'exact', head: true })
      .eq('article_id', articleId)
          .eq('entity_type_id', entityType.id);
      const {count, error} = await (parentInstanceId
          ? baseQuery.eq('parent_instance_id', parentInstanceId)
          : baseQuery.is('parent_instance_id', null));

    if (error) {
        console.warn('Error counting instances, using fallback:', error);
    }

    const nextNumber = (count || 0) + 1;

      // If has parent, include parent name in label
    if (parentInstance) {
      return `${parentInstance.label} - ${entityType.label} ${nextNumber}`;
    }

    return `${entityType.label} ${nextNumber}`;
  }

  /**
   * Cria hierarquia completa (parent + children)
   * Used mainly for models
   */
  async createHierarchy(params: CreateHierarchyParams): Promise<CreateHierarchyResult> {
    const {
      projectId,
      articleId,
      templateId,
      parentEntityType,
      childEntityTypes,
      label,
      metadata = {},
      userId
    } = params;

    const perfId = performanceTracker.start('createHierarchy', {
      parentType: parentEntityType.name,
      childrenCount: childEntityTypes.length
    });

    try {
        extractionLogger.info('createHierarchy', 'Starting hierarchy creation', {
        parentType: parentEntityType.name,
        childrenCount: childEntityTypes.length,
        label
      });
      // 1. Criar parent instance
      const parentResult = await this.createInstance({
        projectId,
        articleId,
        templateId,
        entityTypeId: parentEntityType.id,
        entityType: parentEntityType,
        label,
        metadata,
        userId
      });

      const parentInstance = parentResult.instance;

        // 2. Create child instances automatically (only for cardinality='one')
      const childrenToCreate = childEntityTypes.filter(
          et => et.cardinality === 'one' // Only auto-create if 'one'
      );

      const childInstances: ExtractionInstance[] = [];

      for (const childEntityType of childrenToCreate) {
        const childResult = await this.createInstance({
          projectId,
          articleId,
          templateId,
          entityTypeId: childEntityType.id,
          entityType: childEntityType,
          parentInstanceId: parentInstance.id,
          userId
        });

        childInstances.push(childResult.instance);
      }

      const duration = performanceTracker.end(perfId);

        extractionLogger.info('createHierarchy', 'Hierarchy created successfully', {
        parentId: parentInstance.id,
        childrenCount: childInstances.length,
        duration
      });

      return {
        parent: parentInstance,
        children: childInstances
      };

    } catch (error: any) {
      performanceTracker.end(perfId);
        extractionLogger.error('createHierarchy', 'Failed to create hierarchy', error, {
        parentType: parentEntityType.name,
        label
      });
        throw new Error(`Failed to create hierarchy: ${error.message}`);
    }
  }

  /**
   * Removes an instance (CASCADE automatic via Postgres)
   */
  async removeInstance(instanceId: string): Promise<boolean> {
    const perfId = performanceTracker.start('removeInstance');

    try {
        extractionLogger.debug('removeInstance', 'Removing instance', {instanceId});

        // Use baseRepository for standardized delete
      await deleteOne('extraction_instances', instanceId, 'removeInstance');

      const duration = performanceTracker.end(perfId);

        extractionLogger.info('removeInstance', 'Instance removed (CASCADE)', {
        instanceId,
        duration
      });

      return true;

    } catch (error: unknown) {
      performanceTracker.end(perfId);
        const message = error instanceof Error ? error.message : 'Unknown error';
        extractionLogger.error('removeInstance', 'Failed to remove instance', error as Error, {
        instanceId
      });

        // If already SupabaseRepositoryError, re-throw
      if (error instanceof SupabaseRepositoryError) {
        throw error;
      }

        throw new Error(`Failed to remove instance: ${message}`);
    }
  }

  /**
   * Fetches instances with filter options
   */
  async getInstances(params: GetInstancesParams): Promise<ExtractionInstance[]> {
    const { articleId, templateId, options = {} } = params;

    try {
        // Build filters for queryBuilder
      const filters: Record<string, unknown> = {
        article_id: articleId,
        template_id: templateId,
      };

      if (options.entityTypeId) {
        filters.entity_type_id = options.entityTypeId;
      }

      if (options.parentInstanceId !== undefined) {
        filters.parent_instance_id = options.parentInstanceId;
      }

        // Use baseRepository queryBuilder
      const { data, error } = await queryBuilder<ExtractionInstance>(
        'extraction_instances',
        {
          select: '*',
          filters,
          orderBy: { column: 'sort_order', ascending: true },
        }
      );

      if (error) {
        handleSupabaseError(error, 'getInstances');
      }

      return data || [];

    } catch (error: unknown) {
      if (error instanceof SupabaseRepositoryError) {
        throw error;
      }
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error fetching instances:', error);
        throw new Error(`Failed to fetch instances: ${message}`);
    }
  }

  // NOTE: ``initializeArticleInstances`` was removed (2026-05-19). The
  // backend's ``hitl_session_service._ensure_instances`` is the sole
  // creator of study-level + per-model child singletons on session open.
  // The frontend now only reads via ``getInstances``; doubling the write
  // path raced with the backend and broke the cardinality CHECK
  // (``check_cardinality_one``) for projects where the backend won.
}

// =================== SINGLETON EXPORT ===================

/**
 * Service singleton instance
 */
export const extractionInstanceService = new ExtractionInstanceService();

// =================== MODULE-LEVEL HELPERS ===================

import type {ErrorResult} from '@/lib/error-utils';
import {toResult} from '@/lib/error-utils';

/**
 * Update the label of a single extraction instance.
 * NOTE: on success the caller should show a toast using the extraction
 * 'labelUpdatedSuccess' copy key; on failure the 'errors_updateLabel' key.
 */
export async function updateInstanceLabel(
  instanceId: string,
  label: string,
): Promise<ErrorResult<void>> {
  return toResult(async () => {
    const {error} = await supabase
      .from('extraction_instances')
      .update({label: label.trim()})
      .eq('id', instanceId);

    if (error) throw error;
  }, 'updateInstanceLabel');
}

// ---------------------------------------------------------------------------
// useAllUserInstances — all-user instances for an article (comparison UI)
// ---------------------------------------------------------------------------

export interface InstanceWithCreator {
  id: string;
  article_id: string;
  created_by: string;
  created_at: string;
  [key: string]: unknown;
}

/**
 * Fetch all extraction instances for an article, ordered by creation time.
 * Used by the multi-reviewer comparison panel.
 */
export function loadAllUserInstancesForArticle(
  articleId: string,
): Promise<ErrorResult<InstanceWithCreator[]>> {
  return toResult(async () => {
    const {data, error} = await supabase
      .from('extraction_instances')
      .select('*')
      .eq('article_id', articleId)
      .order('created_at', {ascending: true});

    if (error) throw error;
    return (data ?? []) as InstanceWithCreator[];
  }, 'loadAllUserInstancesForArticle');
}

// ---------------------------------------------------------------------------
// useModelManagement — model-container instance queries
// ---------------------------------------------------------------------------

export interface ModelInstanceRow {
  id: string;
  label: string | null;
  sort_order: number;
  created_at: string;
}

/**
 * Fetch the model-container instances for an article + entity type.
 * Ordered by sort_order ascending (matches useModelManagement).
 */
export function loadModelInstances(
  articleId: string,
  modelParentEntityTypeId: string,
): Promise<ErrorResult<ModelInstanceRow[]>> {
  return toResult(async () => {
    const {data, error} = await supabase
      .from('extraction_instances')
      .select('id, label, sort_order, created_at')
      .eq('article_id', articleId)
      .eq('entity_type_id', modelParentEntityTypeId)
      .order('sort_order', {ascending: true});

    if (error) throw error;
    return (data ?? []) as ModelInstanceRow[];
  }, 'loadModelInstances');
}

/**
 * Invoke the calculate_model_progress RPC for a single model instance.
 * Returns a zero-progress object on any error — callers treat missing
 * progress as 0 so the UI stays functional even if the RPC is unavailable.
 */
export async function fetchModelProgress(
  articleId: string,
  instanceId: string,
): Promise<{completed: number; total: number; percentage: number}> {
  const {data, error} = await supabase.rpc('calculate_model_progress', {
    p_article_id: articleId,
    p_model_id: instanceId,
  });

  if (error) {
    console.warn('Error calculating progress (fallback to 0):', error);
    return {completed: 0, total: 0, percentage: 0};
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return {completed: 0, total: 0, percentage: 0};

  return {
    completed: row.completed_fields ?? 0,
    total: row.total_fields ?? 0,
    percentage: Number(row.percentage ?? 0),
  };
}

// ---------------------------------------------------------------------------
// useFullAIExtraction — fetch extracted model instances by entity type role
// ---------------------------------------------------------------------------

export interface ExtractedModelRef {
  instanceId: string;
  modelName: string;
}

/**
 * Fetch all extraction_instances for a given entity type, ordered by
 * sort_order. Used by useFullAIExtraction to discover which models to
 * process after Phase 1 model extraction.
 */
export function loadExtractedModels(
  articleId: string,
  modelParentEntityTypeId: string,
): Promise<ErrorResult<ExtractedModelRef[]>> {
  return toResult(async () => {
    const {data, error} = await supabase
      .from('extraction_instances')
      .select('id, label')
      .eq('article_id', articleId)
      .eq('entity_type_id', modelParentEntityTypeId)
      .order('sort_order', {ascending: true});

    if (error) throw error;
    return (data ?? []).map((i) => ({
      instanceId: i.id,
      modelName: i.label ?? 'Unnamed model',
    }));
  }, 'loadExtractedModels');
}

