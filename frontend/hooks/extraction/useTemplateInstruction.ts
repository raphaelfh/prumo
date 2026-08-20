import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import {
  templateConfigStatusKeys,
  templateInstructionKeys,
} from '@/lib/query-keys/extraction';
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
      // B-4: the PUT stages a draft edit — nothing re-pins, so the runs
      // cache stays put; only our own read and the Draft chip refresh.
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: templateInstructionKeys.byTemplate(projectId, templateId),
        }),
        queryClient.invalidateQueries({
          queryKey: templateConfigStatusKeys.byTemplate(projectId, templateId),
        }),
      ]);
    },
  });
}
