/**
 * Hook para gerenciar instrumentos de avaliacao de projeto.
 *
 * Fornece funcionalidades para:
 * - Listar instrumentos globais disponiveis
 * - Listar instrumentos configurados no projeto
 * - Clonar instrumentos globais para o projeto
 * - Criar instrumentos customizados
 * - Atualizar e deletar instrumentos
 *
 * Usa apiClient centralizado (auth automatica via Supabase session).
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
 * Hook para listar instrumentos globais disponiveis.
 */
export function useGlobalInstruments() {
  const { session } = useAuth();

  return useQuery({
    queryKey: projectInstrumentKeys.global(),
    queryFn: async (): Promise<GlobalInstrumentSummary[]> => {
      return listGlobalInstruments();
    },
    enabled: !!session?.access_token,
    staleTime: 5 * 60 * 1000, // 5 minutos
    retry: 1,
  });
}

/**
 * Hook para listar instrumentos de um projeto.
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
    staleTime: 30 * 1000, // 30 segundos
    retry: 1,
  });
}

/**
 * Hook para buscar um instrumento especifico.
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
 * Hook para criar instrumento customizado.
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
 * Hook para atualizar instrumento.
 */
export function useUpdateInstrument() {
  const queryClient = useQueryClient();

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
 * Hook para deletar instrumento.
 */
export function useDeleteInstrument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      instrumentId,
      projectId,
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
