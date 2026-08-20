/**
 * TanStack hooks for the project's custom LLM endpoints (§5.2, C2 PR-C).
 *
 * `useLlmEndpoints` reads the manager-only endpoint list the management
 * dialog renders and the engine picker derives its endpoint groups from
 * (locked decision 12 — the engine read carries only the scalar
 * `endpoint_label`, never a matrix). An ErrorResult becomes the query's
 * error state — which the PICKER maps to "no groups" (the deploy-race
 * window where a new frontend hits an old backend without the routes: the
 * chip is optional chrome, never a blocker), while the management dialog
 * names it, because there a failed read and an empty project are
 * different facts and the manager asked for exactly this list.
 *
 * EVERY mutation invalidates BOTH key families. The engine read derives
 * `endpoint_label` — and whether the stored engine is still runnable —
 * from these rows, so a rename, a failed re-probe or a delete leaves the
 * engine cache describing an endpoint that no longer exists in that form.
 */
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import {projectKeys} from '@/lib/query-keys';
import {
  createLlmEndpoint,
  deleteLlmEndpoint,
  fetchLlmEndpoints,
  updateLlmEndpoint,
  verifyLlmEndpoint,
  type LlmEndpointCreateRequest,
  type LlmEndpointDeleteResult,
  type LlmEndpointProbeResult,
  type LlmEndpointRead,
  type LlmEndpointUpdateRequest,
} from '@/services/llmEndpointService';

const STALE_MS = 5 * 60_000;

export function useLlmEndpoints(projectId: string | null | undefined) {
  return useQuery({
    queryKey: projectKeys.llmEndpoints(projectId ?? ''),
    enabled: Boolean(projectId),
    staleTime: STALE_MS,
    queryFn: async (): Promise<LlmEndpointRead[]> => {
      const result = await fetchLlmEndpoints(projectId!);
      if (!result.ok) throw result.error;
      return result.data;
    },
  });
}

/** The shared post-mutation reconciliation — see the module docstring. */
function useInvalidateEndpointFamilies(projectId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({
      queryKey: projectKeys.llmEndpoints(projectId),
    });
    void queryClient.invalidateQueries({
      queryKey: projectKeys.llmEngine(projectId),
    });
  };
}

export function useCreateLlmEndpoint(projectId: string) {
  const invalidate = useInvalidateEndpointFamilies(projectId);

  return useMutation<LlmEndpointRead, Error, LlmEndpointCreateRequest>({
    mutationFn: async (body) => {
      const result = await createLlmEndpoint(projectId, body);
      if (!result.ok) throw result.error;
      return result.data;
    },
    onSuccess: invalidate,
  });
}

export interface UpdateLlmEndpointVars {
  endpointId: string;
  body: LlmEndpointUpdateRequest;
}

export function useUpdateLlmEndpoint(projectId: string) {
  const invalidate = useInvalidateEndpointFamilies(projectId);

  return useMutation<LlmEndpointRead, Error, UpdateLlmEndpointVars>({
    mutationFn: async ({endpointId, body}) => {
      const result = await updateLlmEndpoint(projectId, endpointId, body);
      if (!result.ok) throw result.error;
      return result.data;
    },
    onSuccess: invalidate,
  });
}

export function useDeleteLlmEndpoint(projectId: string) {
  const invalidate = useInvalidateEndpointFamilies(projectId);

  return useMutation<LlmEndpointDeleteResult, Error, string>({
    mutationFn: async (endpointId) => {
      const result = await deleteLlmEndpoint(projectId, endpointId);
      if (!result.ok) throw result.error;
      return result.data;
    },
    onSuccess: invalidate,
  });
}

export function useVerifyLlmEndpoint(projectId: string) {
  const invalidate = useInvalidateEndpointFamilies(projectId);

  return useMutation<LlmEndpointProbeResult, Error, string>({
    mutationFn: async (endpointId) => {
      const result = await verifyLlmEndpoint(projectId, endpointId);
      if (!result.ok) throw result.error;
      return result.data;
    },
    // The probe PERSISTS validation_status on the row: the list read is
    // stale the moment it returns, engine runnability with it.
    onSuccess: invalidate,
  });
}
