/**
 * Dedicated delete path for the editor-hosted DeleteFieldConfirm (B-5
 * Task 7). Same rationale as `useUpdateTemplateField`: a small
 * single-write mutation, no per-mount permission/field fetches for state
 * the panel already has. B-4: a delete is a draft edit — nothing republishes; on
 * success the grid + Draft chip caches refresh. Permission gating is the
 * Configuration tab (manager-only) plus RLS on the write.
 *
 * A RESTRICT-FK refusal arrives from the service as a PgError whose
 * message IS the friendly copy (SQLSTATE 23503 mapped there), so it
 * toasts verbatim — the raw Postgres message never reaches the user.
 */
import {useMutation} from '@tanstack/react-query';
import {toast} from 'sonner';

import {useTemplateConfigCaches} from '@/hooks/extraction/useTemplateRepublish';
import {t} from '@/lib/copy';
import {PgError} from '@/lib/error-utils';
import {deleteField} from '@/services/extractionFieldService';

interface DeleteArgs {
  fieldId: string;
}

export function useDeleteTemplateField(
  projectId: string | undefined,
  templateId: string | undefined,
) {
  const {invalidateStructure} = useTemplateConfigCaches(projectId, templateId);

  return useMutation<void, Error, DeleteArgs>({
    mutationFn: async ({fieldId}) => {
      const result = await deleteField(fieldId);
      // Rethrow the service error itself so a PgError keeps its type.
      if (!result.ok) throw result.error;
    },
    onSuccess: () => {
      toast.success(t('extraction', 'fieldRemovedSuccess'));
      void invalidateStructure();
    },
    onError: (error) => {
      console.error('[useDeleteTemplateField]', error);
      if (error instanceof PgError && error.code === '23503') {
        toast.error(error.message);
        return;
      }
      toast.error(`${t('extraction', 'errors_removeField')}: ${error.message}`);
    },
  });
}
