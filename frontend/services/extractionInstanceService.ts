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
  queryBuilder,
  SupabaseRepositoryError
} from '@/lib/supabase/baseRepository';
import type {ExtractionInstance} from '@/types/extraction';

// =================== INTERFACES ===================

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

        throw new Error(`Failed to remove instance: ${message}`, { cause: error });
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
        throw new Error(`Failed to fetch instances: ${message}`, { cause: error });
    }
  }

  // NOTE: this service no longer writes instances at all. Creation lives
  // behind ``POST /api/v1/extraction/instances`` (Trees B2) and session-open
  // singletons behind ``hitl_session_service._ensure_instances``; the browser
  // insert that used to sit here raced the backend and broke the cardinality
  // CHECK for whichever side lost. Delete stays a PostgREST cascade.
}

// =================== SINGLETON EXPORT ===================

/**
 * Service singleton instance
 */
export const extractionInstanceService = new ExtractionInstanceService();

// =================== MODULE-LEVEL HELPERS ===================

import type {ErrorResult} from '@/lib/error-utils';
import {toResult} from '@/lib/error-utils';

// Renaming an instance goes through the typed endpoint now
// (`useUpdateInstanceIdentity` → PATCH /extraction/instances/{id}): the
// rename dialog also re-keys, and the identity history has to be written
// by the server with the caller's identity.

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
 *
 * NOTE: deliberately departs from the ErrorResult contract (returns a
 * zero-progress fallback on RPC errors rather than {ok: false}) so the UI
 * degrades gracefully without the caller needing a result branch for progress.
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

