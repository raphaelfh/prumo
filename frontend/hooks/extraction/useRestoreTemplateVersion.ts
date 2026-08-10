/**
 * Restore-vN (B-9e): stage an older version's shape as the current draft.
 *
 * Invalidates the SAME families a config edit does, plus the History
 * timeline itself — a restore writes live rows and stamps the draft
 * marker, so the grid, the Draft chip and the diff all moved. It does NOT
 * invalidate the run-scoped caches: nothing is published until the manager
 * goes through the Publish sheet, which is the whole point of staging.
 *
 * @module hooks/extraction/useRestoreTemplateVersion
 */
import {useQueryClient} from '@tanstack/react-query';
import {useState} from 'react';
import {toast} from 'sonner';

import {useTemplateConfigCaches} from '@/hooks/extraction/useTemplateRepublish';
import {t} from '@/lib/copy';
import {
  templateDiffKeys,
  templateVersionHistoryKeys,
} from '@/lib/query-keys/extraction';
import {
  restoreTemplateVersion,
  type RestoreVersionResponse,
} from '@/services/templateService';

export function useRestoreTemplateVersion(projectId: string, templateId: string) {
  const queryClient = useQueryClient();
  const {invalidateStructure} = useTemplateConfigCaches(projectId, templateId);
  const [restoring, setRestoring] = useState(false);

  const restore = async (versionId: string): Promise<RestoreVersionResponse | null> => {
    setRestoring(true);
    const result = await restoreTemplateVersion(projectId, templateId, versionId);
    setRestoring(false);
    if (!result.ok) {
      console.error('[useRestoreTemplateVersion]', result.error);
      toast.error(
        `${t('templateConfig', 'errors_restoreVersion')}: ${result.error.message}`,
      );
      return null;
    }
    await invalidateStructure();
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: templateDiffKeys.byTemplate(projectId, templateId),
      }),
      queryClient.invalidateQueries({
        queryKey: templateVersionHistoryKeys.byTemplate(projectId, templateId),
      }),
    ]);
    return result.data;
  };

  return {restore, restoring};
}
