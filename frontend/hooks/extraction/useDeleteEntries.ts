/**
 * Deleting entries of a repeating section from the run form — one, or several.
 *
 * Sibling of `useAddEntry`, and lifted out of `ExtractionFullScreen` for the
 * same reason: that page sits at its file-size ceiling, and a page reaching
 * the API client directly skips the hook layer the data path asks for.
 *
 * BOTH deletes live here because they share their failure vocabulary. A
 * deferred FK from `extraction_published_states` (migration 0040) pins an
 * entry a prior finalized revision published, and "this entry is pinned" is a
 * real answer rather than a generic failure — a mapping that was written once
 * for the single delete and would have been copied for the bulk one.
 *
 * The bulk path is NOT a loop of the single one. Deleting an entry cascades
 * to its child instances, its values and its reviewer decisions, so a loop
 * that removes six of eight leaves audit-bearing tables in a state no
 * reviewer asked for and no undo restores. `DELETE /api/v1/extraction/
 * instances` validates the whole set before it touches a row, so a refusal
 * leaves the reviewer looking at the tree they already had.
 *
 * Confirmation is asymmetric on purpose. The single delete confirms only when
 * the entry HOLDS answers, because it is one row the reviewer just pointed
 * at. The bulk delete always confirms, in `EntrySelector` — which knows how
 * many are ticked and what they are called — because a batch is easy to
 * mis-tick and impossible to undo.
 */
import {toast} from 'sonner';

import {deleteEntries} from '@/integrations/api/client';
import {t} from '@/lib/copy';
import {extractionInstanceService} from '@/services/extractionInstanceService';

export interface UseDeleteEntriesArgs {
  projectId: string | undefined;
  articleId: string | undefined;
  templateId: string | undefined;
  /** Re-derives the instances after a delete (the run view refetch). */
  onDeleted: () => Promise<unknown>;
  /** Reviewer values, keyed `${instanceId}_${fieldId}` — the single delete
   * asks for confirmation only when the entry actually holds some. */
  values: Record<string, unknown>;
  /**
   * Whether this caller may delete at all — manager, and nothing wider.
   *
   * `extraction_instances_delete` is `USING is_project_manager(...)`, and the
   * bulk endpoint calls `ensure_project_manager` to match it. The single
   * delete has no endpoint to gate: it is a browser PostgREST call through
   * `baseRepository.deleteOne`, which is `.delete().eq('id', id)` with NO
   * `.select()`. A reviewer's DELETE matches zero rows, PostgREST returns no
   * error, and this hook would announce success over an untouched entry.
   *
   * So the authority lives HERE rather than at each call site: three
   * affordances hang off these two functions (the selector's trash icon, the
   * card list's inline remove, the bulk Select mode), and gating them one by
   * one is how the first two came to disagree.
   */
  canDelete: boolean;
}

/** The one place a delete failure becomes a sentence. */
function reportFailure(error: unknown, where: string): null {
  console.error(`[useDeleteEntries] ${where} failed:`, error);
  const message = error instanceof Error ? error.message : String(error);
  toast.error(
    message.includes('extraction_published_states')
      ? t('pages', 'extractionScreenInstancePinned')
      : t('pages', 'extractionScreenErrorRemoveInstance'),
  );
  return null;
}

export interface DeleteEntriesActions {
  /** Absent when the caller may not delete — the control is not offered. */
  deleteOne?: (instanceId: string) => Promise<void>;
  /** Absent when the caller may not delete. */
  deleteSelected?: (instanceIds: string[]) => Promise<void>;
}

export function useDeleteEntries(args: UseDeleteEntriesArgs): DeleteEntriesActions {
  const {projectId, articleId, templateId, onDeleted, values, canDelete} = args;

  const succeed = async (): Promise<void> => {
    await onDeleted();
    toast.success(t('pages', 'extractionScreenInstanceRemoved'));
  };

  const deleteOne = async (instanceId: string): Promise<void> => {
    const holdsAnswers = Object.keys(values).some((key) => key.startsWith(`${instanceId}_`));
    if (holdsAnswers && !window.confirm(t('pages', 'extractionScreenConfirmRemoveInstance'))) {
      return;
    }
    // IO in a `.catch()` callback rather than try/catch: the React Compiler
    // refuses a `try` in a hook body.
    const removed = await extractionInstanceService
      .removeInstance(instanceId)
      .catch((error: unknown) => reportFailure(error, 'removeInstance'));
    if (removed === null) return;
    await succeed();
  };

  const deleteSelected = async (instanceIds: string[]): Promise<void> => {
    if (!projectId || !articleId || !templateId || instanceIds.length === 0) return;
    const result = await deleteEntries({projectId, articleId, templateId, instanceIds}).catch(
      (error: unknown) => reportFailure(error, 'deleteEntries'),
    );
    if (result === null) return;
    await succeed();
  };

  return canDelete ? {deleteOne, deleteSelected} : {};
}
