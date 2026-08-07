import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import {runsKeys} from '@/hooks/runs/types';
import {templateInstructionKeys} from '@/lib/query-keys/extraction';
import {
  getTemplateInstruction,
  updateTemplateInstruction,
  type TemplateInstructionRead,
  type UpdateTemplateInstructionResponse,
} from '@/services/templateInstructionService';

export function useTemplateInstruction(projectId: string, templateId: string) {
  return useQuery<TemplateInstructionRead, Error>({
    queryKey: templateInstructionKeys.byTemplate(projectId, templateId),
    queryFn: () => getTemplateInstruction(projectId, templateId),
    enabled: Boolean(projectId && templateId),
  });
}

export function useUpdateTemplateInstruction(projectId: string, templateId: string) {
  const queryClient = useQueryClient();
  return useMutation<UpdateTemplateInstructionResponse, Error, string | null>({
    mutationFn: (value) => updateTemplateInstruction(projectId, templateId, value),
    onSuccess: async () => {
      // The PUT republished server-side: editable-stage runs were
      // re-pinned, so run-scoped reads are stale alongside our own key.
      // Parallel: the two refetch rounds are independent, and awaiting
      // them serially would extend the disabled-Save window.
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: templateInstructionKeys.byTemplate(projectId, templateId),
        }),
        queryClient.invalidateQueries({queryKey: runsKeys.all}),
      ]);
    },
  });
}
