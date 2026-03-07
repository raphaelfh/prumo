/**
 * Hook to manage project assessment instruments.
 *
 * Provides:
 * - List available global instruments
 * - List instruments configured in the project
 * - Clone global instruments into the project
 * - Create custom instruments
 * - Update and delete instruments
 *
 * Uses centralized apiClient (auth via Supabase session).
 */

import {useCallback, useState} from 'react';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {useAuth} from '@/contexts/AuthContext';
import {
    cloneGlobalInstrument as cloneGlobalInstrumentApi,
    createInstrument as createInstrumentApi,
    deleteInstrument as deleteInstrumentApi,
    getInstrument,
    listGlobalInstruments,
    listProjectInstruments,
    updateInstrument as updateInstrumentApi,
} from '@/services/projectAssessmentInstrumentService';
import type {
    CreateProjectInstrumentRequest,
    GlobalInstrumentSummary,
    ProjectAssessmentInstrument,
    UpdateProjectInstrumentRequest,
} from '@/types/assessment';

// Query keys
export const projectInstrumentKeys = {
  all: ['projectAssessmentInstruments'] as const,
  global: () => [...projectInstrumentKeys.all, 'global'] as const,
  byProject: (projectId: string) =>
    [...projectInstrumentKeys.all, 'project', projectId] as const,
  byId: (instrumentId: string) =>
    [...projectInstrumentKeys.all, 'detail', instrumentId] as const,
};

/**
 * Hook to list available global instruments.
 */
export function useGlobalInstruments() {
  const { session } = useAuth();

  return useQuery({
    queryKey: projectInstrumentKeys.global(),
    queryFn: async (): Promise<GlobalInstrumentSummary[]> => {
      return listGlobalInstruments();
    },
    enabled: !!session?.access_token,
      staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 1,
  });
}

/**
 * Hook to list instruments of a project.
 */
export function useProjectInstruments(projectId: string | null) {
  const { session } = useAuth();

  return useQuery({
    queryKey: projectId ? projectInstrumentKeys.byProject(projectId) : [],
    queryFn: async (): Promise<ProjectAssessmentInstrument[]> => {
      if (!projectId) {
        throw new Error('Missing project ID');
      }
      return listProjectInstruments(projectId);
    },
    enabled: !!session?.access_token && !!projectId,
      staleTime: 30 * 1000, // 30 seconds
    retry: 1,
  });
}

/**
 * Hook to fetch a specific instrument.
 */
export function useProjectInstrument(instrumentId: string | null) {
  const { session } = useAuth();

  return useQuery({
    queryKey: instrumentId ? projectInstrumentKeys.byId(instrumentId) : [],
    queryFn: async (): Promise<ProjectAssessmentInstrument> => {
      if (!instrumentId) {
        throw new Error('Missing instrument ID');
      }
      return getInstrument(instrumentId);
    },
    enabled: !!session?.access_token && !!instrumentId,
    staleTime: 30 * 1000,
    retry: 1,
  });
}

/**
 * Hook to check if project has an instrument configured.
 */
export function useHasConfiguredInstrument(projectId: string | null) {
  const { data: instruments, isLoading } = useProjectInstruments(projectId);

  return {
    hasInstrument: (instruments?.length ?? 0) > 0,
    isLoading,
    instruments,
  };
}

/**
 * Hook to clone a global instrument.
 */
export function useCloneInstrument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: { projectId: string; globalInstrumentId: string; customName?: string }) => {
      return cloneGlobalInstrumentApi(request);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: projectInstrumentKeys.byProject(variables.projectId),
      });
    },
  });
}

/**
 * Hook to create a custom instrument.
 */
export function useCreateInstrument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: CreateProjectInstrumentRequest) => {
      return createInstrumentApi(request);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: projectInstrumentKeys.byProject(variables.projectId),
      });
    },
  });
}

/**
 * Hook to update an instrument.
 */
export function useUpdateInstrument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      instrumentId,
                           projectId: _projectId,
      data,
    }: {
      instrumentId: string;
      projectId: string;
      data: UpdateProjectInstrumentRequest;
    }) => {
      return updateInstrumentApi(instrumentId, data);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: projectInstrumentKeys.byProject(variables.projectId),
      });
      queryClient.invalidateQueries({
        queryKey: projectInstrumentKeys.byId(variables.instrumentId),
      });
    },
  });
}

/**
 * Hook to delete an instrument.
 */
export function useDeleteInstrument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      instrumentId,
                           projectId: _projectId,
    }: {
      instrumentId: string;
      projectId: string;
    }) => {
      return deleteInstrumentApi(instrumentId);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: projectInstrumentKeys.byProject(variables.projectId),
      });
    },
  });
}

/**
 * Combined hook for full instrument management.
 */
export function useProjectAssessmentInstrumentManager(projectId: string | null) {
  const [selectedInstrumentId, setSelectedInstrumentId] = useState<
    string | null
  >(null);

  const globalInstrumentsQuery = useGlobalInstruments();
  const projectInstrumentsQuery = useProjectInstruments(projectId);
  const selectedInstrumentQuery = useProjectInstrument(selectedInstrumentId);

  const cloneMutation = useCloneInstrument();
  const createMutation = useCreateInstrument();
  const updateMutation = useUpdateInstrument();
  const deleteMutation = useDeleteInstrument();

  const hasConfiguredInstrument =
    (projectInstrumentsQuery.data?.length ?? 0) > 0;

  const cloneGlobalInstrument = useCallback(
    async (globalInstrumentId: string, customName?: string) => {
      if (!projectId) {
        throw new Error('No project selected');
      }
      return cloneMutation.mutateAsync({
        projectId,
        globalInstrumentId,
        customName,
      });
    },
    [projectId, cloneMutation],
  );

  const createCustomInstrument = useCallback(
    async (data: Omit<CreateProjectInstrumentRequest, 'projectId'>) => {
      if (!projectId) {
        throw new Error('No project selected');
      }
      return createMutation.mutateAsync({
        ...data,
        projectId,
      });
    },
    [projectId, createMutation],
  );

  const updateInstrument = useCallback(
    async (instrumentId: string, data: UpdateProjectInstrumentRequest) => {
      if (!projectId) {
        throw new Error('No project selected');
      }
      return updateMutation.mutateAsync({
        instrumentId,
        projectId,
        data,
      });
    },
    [projectId, updateMutation],
  );

  const deleteInstrument = useCallback(
    async (instrumentId: string) => {
      if (!projectId) {
        throw new Error('No project selected');
      }
      return deleteMutation.mutateAsync({
        instrumentId,
        projectId,
      });
    },
    [projectId, deleteMutation],
  );

  return {
    // State
    selectedInstrumentId,
    setSelectedInstrumentId,

    // Data
    globalInstruments: globalInstrumentsQuery.data ?? [],
    projectInstruments: projectInstrumentsQuery.data ?? [],
    selectedInstrument: selectedInstrumentQuery.data,
    hasConfiguredInstrument,

    // Loading states
    isLoadingGlobal: globalInstrumentsQuery.isLoading,
    isLoadingProject: projectInstrumentsQuery.isLoading,
    isLoadingSelected: selectedInstrumentQuery.isLoading,

    // Errors
    errorGlobal: globalInstrumentsQuery.error,
    errorProject: projectInstrumentsQuery.error,
    errorSelected: selectedInstrumentQuery.error,

    // Mutations
    cloneGlobalInstrument,
    createCustomInstrument,
    updateInstrument,
    deleteInstrument,

    // Mutation states
    isCloning: cloneMutation.isPending,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,

    // Refetch
    refetchProjectInstruments: projectInstrumentsQuery.refetch,
  };
}

export default useProjectAssessmentInstrumentManager;
