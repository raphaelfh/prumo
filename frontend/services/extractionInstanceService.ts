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
import type {ExtractionEntityType, ExtractionInstance, ProjectExtractionTemplate} from '@/types/extraction';

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
            p_parent_instance_id: parentInstanceId || null
          });

        if (cardinalityError) {
            extractionLogger.warn('createInstance', 'Cardinality validation error', cardinalityError, {
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
            error.code,
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
      uniqueLabel = attempt === 2 ? `${label} (2)` : label.replace(/\(\d+\)$/, `(${attempt})`);
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

  /**
   * Creates initial instances for an article (study-level only)
   */
  async initializeArticleInstances(
    articleId: string,
    projectId: string,
    template: ProjectExtractionTemplate,
    entityTypes: ExtractionEntityType[],
    userId: string
  ): Promise<ExtractionInstance[]> {
    try {
        // Fetch existing instances
      const existingInstances = await this.getInstances({
        articleId,
        templateId: template.id
      });

      const existingEntityTypeIds = new Set(
        existingInstances.map(i => i.entity_type_id)
      );

      const createdInstances: ExtractionInstance[] = [...existingInstances];

        // Create missing instances only for:
        // - Entity types with cardinality='one'
      // - Entity types sem parent (study-level)
      for (const entityType of entityTypes) {
        if (existingEntityTypeIds.has(entityType.id)) {
            continue; // Already exists
        }

          // Skip if has parent OR cardinality='many'
        if (entityType.parent_entity_type_id || entityType.cardinality === 'many') {
            console.log(`Skipping auto-creation: ${entityType.name}`);
          continue;
        }

        const result = await this.createInstance({
          projectId,
          articleId,
          templateId: template.id,
          entityTypeId: entityType.id,
          entityType,
          userId
        });

        if (result.wasCreated) {
          createdInstances.push(result.instance);
        }
      }

        console.log(`Initialization: ${createdInstances.length} instance(s) total`);
      return createdInstances;

    } catch (error: any) {
        console.error('Error initializing instances:', error);
        throw new Error(`Failed to initialize: ${error.message}`);
    }
  }
}

// =================== SINGLETON EXPORT ===================

/**
 * Service singleton instance
 */
export const extractionInstanceService = new ExtractionInstanceService();

