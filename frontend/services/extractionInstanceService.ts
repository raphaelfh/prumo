/**
 * Reads and deletes for extraction instances.
 *
 * Creation is NOT here: it lives behind
 * `POST /api/v1/extraction/instances` (trees B2), because the key value is
 * recorded as a ReviewerDecision and only the server may author an audit
 * row. Session-open singletons come from `hitl_session_service`. What
 * remains is the PostgREST cascade delete plus a few model-container reads.
 *
 * @module services/extractionInstanceService
 */

import {supabase} from '@/integrations/supabase/client';
import {extractionLogger, performanceTracker} from '@/lib/extraction/observability';
import {deleteOne, SupabaseRepositoryError} from '@/lib/supabase/baseRepository';

// =================== INTERFACES ===================

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
// useFullAIExtraction — fetch extracted model instances by entity type role
// ---------------------------------------------------------------------------

export interface ExtractedModelRef {
  instanceId: string;
  entryName: string;
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
      entryName: i.label ?? 'Unnamed model',
    }));
  }, 'loadExtractedModels');
}

