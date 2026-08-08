/**
 * Cross-section move for one template field (B-6 T1). Same rationale as
 * `useUpdateTemplateField`: a small single-write mutation, no per-mount
 * permission/field fetches for state the panel already has. B-4: a move
 * is a draft edit — nothing republishes; on success the grid + Draft
 * chip caches refresh. Permission gating is the Configuration tab
 * (manager-only) plus RLS on the write.
 *
 * This hook is the chokepoint Undo re-enters through (panel decision 1):
 * the args carry everything an inverse needs ({fieldId, entityTypeId,
 * sortOrder} captured at gesture time), and success feedback is the
 * panel's single-slot Undo toast (T5) — no success toast here, or every
 * revert would toast again.
 */
import {useMutation} from '@tanstack/react-query';
import {toast} from 'sonner';

import {useTemplateConfigCaches} from '@/hooks/extraction/useTemplateRepublish';
import {t} from '@/lib/copy';
import {moveField} from '@/services/extractionFieldService';
import type {ExtractionField} from '@/types/extraction';

export interface MoveTemplateFieldArgs {
  fieldId: string;
  entityTypeId: string;
  sortOrder: number;
}

export function useMoveTemplateField(
  projectId: string | undefined,
  templateId: string | undefined,
) {
  const {invalidateStructure} = useTemplateConfigCaches(projectId, templateId);

  return useMutation<ExtractionField, Error, MoveTemplateFieldArgs>({
    mutationFn: async ({fieldId, entityTypeId, sortOrder}) => {
      const result = await moveField(fieldId, entityTypeId, sortOrder);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    onSuccess: () => {
      void invalidateStructure();
    },
    onError: (error) => {
      console.error('[useMoveTemplateField]', error);
      toast.error(`${t('templateConfig', 'errors_moveField')}: ${error.message}`);
    },
  });
}
