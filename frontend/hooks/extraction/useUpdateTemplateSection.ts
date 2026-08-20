/**
 * Immediate-commit write path for the inspector's section pane (B-8 T6).
 *
 * Mirrors `useUpdateTemplateField`: one PATCH through the typed
 * endpoint, grid + Draft chip caches refreshed on success (a section
 * edit is a draft edit — Publish owns versioning). The D5 many→one
 * refusal arrives from the service as a PgError whose message IS the
 * friendly copy ('23503' mapped there, same contract as delete), so it
 * toasts verbatim — the raw backend text never reaches the user.
 */
import {useMutation} from '@tanstack/react-query';
import {toast} from 'sonner';

import {useTemplateConfigCaches} from '@/hooks/extraction/useTemplateRepublish';
import {t} from '@/lib/copy';
import {PgError} from '@/lib/error-utils';
import {updateSection, type UpdateSectionChanges} from '@/services/templateService';

interface UpdateArgs {
  sectionId: string;
  changes: UpdateSectionChanges;
}

export function useUpdateTemplateSection(
  projectId: string | undefined,
  templateId: string | undefined,
) {
  const {invalidateStructure} = useTemplateConfigCaches(projectId, templateId);

  return useMutation<unknown, Error, UpdateArgs>({
    mutationFn: async ({sectionId, changes}) => {
      if (!projectId || !templateId) {
        throw new Error('projectId and templateId are required');
      }
      const result = await updateSection(projectId, templateId, sectionId, changes);
      if (!result.ok) {
        // Rethrow the service error itself so a PgError keeps its type.
        throw result.error;
      }
      return result.data;
    },
    onSuccess: () => {
      toast.success(t('templateConfig', 'sectionUpdatedSuccess'));
      void invalidateStructure();
    },
    onError: (error) => {
      console.error('[useUpdateTemplateSection]', error);
      if (error instanceof PgError && error.code === '23503') {
        toast.error(error.message);
        return;
      }
      toast.error(`${t('templateConfig', 'errors_updateSection')}: ${error.message}`);
    },
  });
}
