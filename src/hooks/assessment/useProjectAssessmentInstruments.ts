/**
 * Hook para gerenciar instrumentos de avaliacao de projeto.
 *
 * Fornece funcionalidades para:
 * - Listar instrumentos globais disponiveis
 * - Listar instrumentos configurados no projeto
 * - Clonar instrumentos globais para o projeto
 * - Criar instrumentos customizados
 * - Atualizar e deletar instrumentos
 */

import { useCallback, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { projectAssessmentInstrumentService } from '@/services/projectAssessmentInstrumentService';
import type {
  CloneInstrumentRequest,
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
 * Hook para listar instrumentos globais disponiveis.
 */
export function useGlobalInstruments() {
  const { session } = useAuth();
  const token = session?.access_token;

  return useQuery({
    queryKey: projectInstrumentKeys.global(),
    queryFn: async (): Promise<GlobalInstrumentSummary[]> => {
      if (!token) {
        console.warn('[useGlobalInstruments] No authentication token available');
        throw new Error('No authentication token');
      }
      console.log('[useGlobalInstruments] Fetching global instruments...');
      const result = await projectAssessmentInstrumentService.listGlobalInstruments(token);
      console.log('[useGlobalInstruments] Fetched', result.length, 'instruments');
      return result;
    },
    enabled: !!token,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: false, // Don't retry auth failures
  });
}

/**
 * Hook para listar instrumentos de um projeto.
 */
export function useProjectInstruments(projectId: string | null) {
  const { session } = useAuth();
  const token = session?.access_token;

  return useQuery({
    queryKey: projectId ? projectInstrumentKeys.byProject(projectId) : [],
    queryFn: async (): Promise<ProjectAssessmentInstrument[]> => {
      if (!token || !projectId) {
        throw new Error('Missing authentication or project ID');
      }
      return projectAssessmentInstrumentService.listProjectInstruments(
        token,
        projectId
      );
    },
    enabled: !!token && !!projectId,
    staleTime: 30 * 1000, // 30 seconds
    retry: false, // Don't retry auth failures
  });
}

/**
 * Hook para buscar um instrumento especifico.
 */
export function useProjectInstrument(instrumentId: string | null) {
  const { session } = useAuth();
  const token = session?.access_token;

  return useQuery({
    queryKey: instrumentId ? projectInstrumentKeys.byId(instrumentId) : [],
    queryFn: async (): Promise<ProjectAssessmentInstrument> => {
      if (!token || !instrumentId) {
        throw new Error('Missing authentication or instrument ID');
      }
      return projectAssessmentInstrumentService.getInstrument(
        token,
        instrumentId
      );
    },
    enabled: !!token && !!instrumentId,
    staleTime: 30 * 1000,
    retry: false, // Don't retry auth failures
  });
}

/**
 * Hook para verificar se projeto tem instrumento configurado.
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
 * Hook para clonar instrumento global.
 */
export function useCloneInstrument() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const token = session?.access_token;

  return useMutation({
    mutationFn: async (request: CloneInstrumentRequest) => {
      if (!token) {
        throw new Error('No authentication token');
      }
      return projectAssessmentInstrumentService.cloneGlobalInstrument(
        token,
        request
      );
    },
    onSuccess: (_, variables) => {
      // Invalidate project instruments
      queryClient.invalidateQueries({
        queryKey: projectInstrumentKeys.byProject(variables.projectId),
      });
    },
  });
}

/**
 * Hook para criar instrumento customizado.
 */
export function useCreateInstrument() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const token = session?.access_token;

  return useMutation({
    mutationFn: async (request: CreateProjectInstrumentRequest) => {
      if (!token) {
        throw new Error('No authentication token');
      }
      return projectAssessmentInstrumentService.createInstrument(
        token,
        request
      );
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: projectInstrumentKeys.byProject(variables.projectId),
      });
    },
  });
}

/**
 * Hook para atualizar instrumento.
 */
export function useUpdateInstrument() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const token = session?.access_token;

  return useMutation({
    mutationFn: async ({
      instrumentId,
      projectId,
      data,
    }: {
      instrumentId: string;
      projectId: string;
      data: UpdateProjectInstrumentRequest;
    }) => {
      if (!token) {
        throw new Error('No authentication token');
      }
      return projectAssessmentInstrumentService.updateInstrument(
        token,
        instrumentId,
        data
      );
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
 * Hook para deletar instrumento.
 */
export function useDeleteInstrument() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const token = session?.access_token;

  return useMutation({
    mutationFn: async ({
      instrumentId,
      projectId,
    }: {
      instrumentId: string;
      projectId: string;
    }) => {
      if (!token) {
        throw new Error('No authentication token');
      }
      return projectAssessmentInstrumentService.deleteInstrument(
        token,
        instrumentId
      );
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: projectInstrumentKeys.byProject(variables.projectId),
      });
    },
  });
}

/**
 * Hook combinado para gerenciamento completo de instrumentos.
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
    [projectId, cloneMutation]
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
    [projectId, createMutation]
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
    [projectId, updateMutation]
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
    [projectId, deleteMutation]
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
