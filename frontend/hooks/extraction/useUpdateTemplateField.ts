/**
 * Composed write path for the inspector's field form (template-config B
 * track, editable-inspector slice).
 *
 * Deliberately NOT `useFieldManagement`: that hook costs two requests per
 * mount (permission probe + a whole-section field fetch the panel already
 * has) and would run per selection. The inspector needs exactly one write:
 * PostgREST field update, then a republish so the run forms re-pin. The
 * republish outcome is part of the mutation's outcome: the mutation only
 * SUCCEEDS when the new version is live and the caches are invalidated —
 * a republish failure rejects it, so the form keeps its dirty state and
 * Save stays available for retry (a retry re-writes the same values,
 * idempotent, and re-attempts the republish). The dialog's fire-and-forget
 * `void republish()` reports success either way; this hook does not.
 * Permission gating is the Configuration tab (manager-only) plus RLS on
 * the write; a refused write surfaces here as a normal error toast.
 */
import {useMutation} from '@tanstack/react-query';
import {toast} from 'sonner';

import {useTemplateRepublish} from '@/hooks/extraction/useTemplateRepublish';
import {t} from '@/lib/copy';
import {updateField} from '@/services/extractionFieldService';
import type {ExtractionField, ExtractionFieldUpdate} from '@/types/extraction';

interface UpdateArgs {
  fieldId: string;
  updates: ExtractionFieldUpdate;
}

/** The row was written but the republish failed — republish already
 * toasted its own error, so the mutation's onError must stay quiet. */
export class RepublishFailedError extends Error {
  constructor() {
    super('republish failed after field update');
    this.name = 'RepublishFailedError';
  }
}

export function useUpdateTemplateField(
  projectId: string | undefined,
  templateId: string | undefined,
) {
  const {republish} = useTemplateRepublish(projectId, templateId);

  return useMutation<ExtractionField, Error, UpdateArgs>({
    mutationFn: async ({fieldId, updates}) => {
      const result = await updateField(fieldId, updates);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      const live = await republish();
      if (!live) {
        throw new RepublishFailedError();
      }
      return result.data;
    },
    onSuccess: () => {
      toast.success(t('extraction', 'fieldUpdatedSuccess'));
    },
    onError: (error) => {
      console.error('[useUpdateTemplateField]', error);
      if (!(error instanceof RepublishFailedError)) {
        toast.error(
          `${t('extraction', 'errors_updateField')}: ${error.message}`,
        );
      }
    },
  });
}
