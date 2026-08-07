/**
 * Publish the live template structure as a new active version after a
 * configuration edit.
 *
 * Section/field edits are written through PostgREST, but the per-article
 * extraction/QA forms render from the run's frozen version snapshot
 * (`extraction_template_versions.schema_`). Without a republish the edit
 * never reaches any form — not even for brand-new runs. The backend also
 * re-pins runs still in an editable stage (pending/extract) to the new
 * version, so this hook invalidates the run-view cache afterwards.
 *
 * @module hooks/extraction/useTemplateRepublish
 */

import {useQueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';
import {t} from '@/lib/copy';
import {runsKeys} from '@/hooks/runs/types';
import {
  templateActiveStructureKeys,
  templateEntityTypesKeys,
} from '@/lib/query-keys/extraction';
import {republishTemplateVersion} from '@/services/templateService';

export function useTemplateRepublish(
  projectId: string | undefined,
  templateId: string | undefined,
) {
  const queryClient = useQueryClient();

  /**
   * Fire the republish + cache invalidation. Resolves quietly on success;
   * toasts on failure (the structural edit itself already succeeded — the
   * user must know the forms may lag behind).
   */
  const republish = async (): Promise<void> => {
    if (!projectId || !templateId) return;

    const result = await republishTemplateVersion(projectId, templateId);
    if (!result.ok) {
      console.error('[useTemplateRepublish] republish failed:', result.error);
      toast.error(t('extraction', 'errors_republishTemplate'));
      return;
    }

    await queryClient.invalidateQueries({queryKey: runsKeys.all});
    await queryClient.invalidateQueries({
      queryKey: templateEntityTypesKeys.byTemplate(templateId),
    });
    // The worklist reads the ACTIVE snapshot (B-3a) — republish just moved it.
    await queryClient.invalidateQueries({
      queryKey: templateActiveStructureKeys.byTemplate(projectId, templateId),
    });
  };

  return {republish};
}
