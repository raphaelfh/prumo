/**
 * Project + template HITL config hooks (TanStack Query).
 *
 * The backend exposes a single resolved view per request — even with no
 * row, it returns the fallback chain plus an ``inherited`` flag — so
 * these hooks just thread that through.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  HitlConfigService,
  type HitlConfigPayload,
  type HitlConfigRead,
} from '@/services/hitlConfigService';

export const hitlConfigKeys = {
  all: ['hitl-config'] as const,
  project: (projectId: string) =>
    [...hitlConfigKeys.all, 'project', projectId] as const,
  template: (projectId: string, templateId: string) =>
    [...hitlConfigKeys.all, 'template', projectId, templateId] as const,
};

export function useProjectHitlConfig(projectId: string | null | undefined) {
  return useQuery<HitlConfigRead>({
    queryKey: projectId
      ? hitlConfigKeys.project(projectId)
      : ['hitl-config', 'disabled'],
    queryFn: () => HitlConfigService.getForProject(projectId!),
    enabled: Boolean(projectId),
    staleTime: 30_000,
  });
}

export function useTemplateHitlConfig(
  projectId: string | null | undefined,
  templateId: string | null | undefined,
) {
  return useQuery<HitlConfigRead>({
    queryKey:
      projectId && templateId
        ? hitlConfigKeys.template(projectId, templateId)
        : ['hitl-config', 'disabled'],
    queryFn: () =>
      HitlConfigService.getForTemplate(projectId!, templateId!),
    enabled: Boolean(projectId && templateId),
    staleTime: 30_000,
  });
}

export function useUpsertProjectHitlConfig(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation<HitlConfigRead, Error, HitlConfigPayload>({
    mutationFn: (payload) => HitlConfigService.upsertForProject(projectId, payload),
    onSuccess: () => {
      // The project default is also the fallback for any template scope,
      // so invalidate the whole namespace.
      queryClient.invalidateQueries({ queryKey: hitlConfigKeys.all });
    },
  });
}

export function useClearProjectHitlConfig(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation<HitlConfigRead, Error, void>({
    mutationFn: () => HitlConfigService.clearForProject(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hitlConfigKeys.all });
    },
  });
}

export function useUpsertTemplateHitlConfig(
  projectId: string,
  templateId: string,
) {
  const queryClient = useQueryClient();
  return useMutation<HitlConfigRead, Error, HitlConfigPayload>({
    mutationFn: (payload) =>
      HitlConfigService.upsertForTemplate(projectId, templateId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: hitlConfigKeys.template(projectId, templateId),
      });
    },
  });
}

export function useClearTemplateHitlConfig(
  projectId: string,
  templateId: string,
) {
  const queryClient = useQueryClient();
  return useMutation<HitlConfigRead, Error, void>({
    mutationFn: () => HitlConfigService.clearForTemplate(projectId, templateId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: hitlConfigKeys.template(projectId, templateId),
      });
    },
  });
}
