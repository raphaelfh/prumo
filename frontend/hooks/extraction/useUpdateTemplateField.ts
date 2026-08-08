/**
 * Composed write path for the inspector's field form (template-config B
 * track).
 *
 * Deliberately a single write: no per-mount permission probe or
 * whole-section field fetch (the panel already has that state), and
 * nothing runs per selection. B-4: Save is the PostgREST write
 * alone — an edit is a draft edit (the DB stamps the draft marker), so
 * nothing republishes; on success the grid + Draft chip caches refresh.
 * A failed write rejects the mutation, so the form keeps its dirty state
 * and Save stays available for retry. Permission gating is the
 * Configuration tab (manager-only) plus RLS on the write; a refused
 * write surfaces here as a normal error toast.
 */
import {useMutation} from '@tanstack/react-query';
import {toast} from 'sonner';

import {useTemplateConfigCaches} from '@/hooks/extraction/useTemplateRepublish';
import {t} from '@/lib/copy';
import {updateField} from '@/services/extractionFieldService';
import type {ExtractionField, ExtractionFieldUpdate} from '@/types/extraction';

interface UpdateArgs {
  fieldId: string;
  updates: ExtractionFieldUpdate;
}

export function useUpdateTemplateField(
  projectId: string | undefined,
  templateId: string | undefined,
) {
  const {invalidateStructure} = useTemplateConfigCaches(projectId, templateId);

  return useMutation<ExtractionField, Error, UpdateArgs>({
    mutationFn: async ({fieldId, updates}) => {
      const result = await updateField(fieldId, updates);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    onSuccess: () => {
      toast.success(t('extraction', 'fieldUpdatedSuccess'));
      void invalidateStructure();
    },
    onError: (error) => {
      console.error('[useUpdateTemplateField]', error);
      toast.error(
        `${t('extraction', 'errors_updateField')}: ${error.message}`,
      );
    },
  });
}
