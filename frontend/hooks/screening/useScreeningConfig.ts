/**
 * Hook for managing screening configuration.
 */
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {getScreeningConfig, upsertScreeningConfig} from '@/services/screeningService';
import type {ScreeningCriterion} from '@/types/screening';

export function useScreeningConfig(projectId: string, phase: string) {
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: ['screening-config', projectId, phase],
        queryFn: () => getScreeningConfig(projectId, phase),
        enabled: !!projectId && !!phase,
    });

    const mutation = useMutation({
        mutationFn: (data: {
            requireDualReview?: boolean;
            blindMode?: boolean;
            criteria?: ScreeningCriterion[];
            aiModelName?: string;
            aiSystemInstruction?: string;
        }) => upsertScreeningConfig({projectId, phase, ...data}),
        onSuccess: () => {
            queryClient.invalidateQueries({queryKey: ['screening-config', projectId, phase]});
        },
    });

    return {
        config: query.data,
        isLoading: query.isLoading,
        updateConfig: mutation.mutateAsync,
        isUpdating: mutation.isPending,
    };
}
