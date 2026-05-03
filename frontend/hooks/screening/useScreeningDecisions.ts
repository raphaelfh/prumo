/**
 * Hook for managing screening decisions.
 */
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {getDecisions, submitDecision} from '@/services/screeningService';

export function useScreeningDecisions(projectId: string, phase: string) {
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: ['screening-decisions', projectId, phase],
        queryFn: () => getDecisions(projectId, phase),
        enabled: !!projectId && !!phase,
    });

    const decideMutation = useMutation({
        mutationFn: (data: {
            articleId: string;
            decision: string;
            reason?: string;
            criteriaResponses?: Record<string, boolean>;
        }) => submitDecision({projectId, phase, ...data}),
        onSuccess: () => {
            queryClient.invalidateQueries({queryKey: ['screening-decisions', projectId, phase]});
            queryClient.invalidateQueries({queryKey: ['screening-progress', projectId, phase]});
        },
    });

    return {
        decisions: query.data ?? [],
        isLoading: query.isLoading,
        decide: decideMutation.mutateAsync,
        isDeciding: decideMutation.isPending,
    };
}
