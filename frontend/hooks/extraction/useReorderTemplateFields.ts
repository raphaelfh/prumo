/**
 * Batch renumber of a section's fields (B-6 T1). Same rationale as
 * `useUpdateTemplateField`: a small write-only mutation, no per-mount
 * permission/field fetches for state the panel already has. B-4: a
 * reorder is a draft edit — nothing republishes; on success the grid +
 * Draft chip caches refresh. Permission gating is the Configuration tab
 * (manager-only) plus RLS on the writes (the service inspects each
 * RESOLVED PostgREST result, so a partial RLS refusal arrives here as a
 * normal error — never silent success).
 *
 * This hook is the chokepoint Undo re-enters through (panel decision 1):
 * the args carry the full {id, sort_order}[] batch (an inverse is just
 * the prior batch, captured at gesture time), and success feedback is
 * the panel's single-slot Undo toast (T5) — no success toast here.
 */
import {useMutation} from '@tanstack/react-query';
import {toast} from 'sonner';

import {useTemplateConfigCaches} from '@/hooks/extraction/useTemplateRepublish';
import {t} from '@/lib/copy';
import {
  reorderFields,
  type FieldSortOrderUpdate,
} from '@/services/extractionFieldService';

export interface ReorderTemplateFieldsArgs {
  updates: FieldSortOrderUpdate[];
}

export function useReorderTemplateFields(
  projectId: string | undefined,
  templateId: string | undefined,
  opts?: {
    /** Default true. The serialized dispatcher (useMoveFieldTo) awaits
     * its OWN invalidateStructure per settled move and passes false so a
     * cross-section move never refetches three times; standalone users
     * keep the built-in refresh. */
    invalidateOnSuccess?: boolean;
  },
) {
  const {invalidateStructure} = useTemplateConfigCaches(projectId, templateId);
  const invalidateOnSuccess = opts?.invalidateOnSuccess ?? true;

  return useMutation<void, Error, ReorderTemplateFieldsArgs>({
    mutationFn: async ({updates}) => {
      const result = await reorderFields(updates);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
    },
    onSuccess: () => {
      if (invalidateOnSuccess) void invalidateStructure();
    },
    onError: (error) => {
      console.error('[useReorderTemplateFields]', error);
      toast.error(`${t('templateConfig', 'errors_reorderFields')}: ${error.message}`);
    },
  });
}
