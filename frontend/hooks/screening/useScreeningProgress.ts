/**
 * Hook for fetching screening progress stats.
 */
import {useQuery} from '@tanstack/react-query';
import {getProgress, getDashboard} from '@/services/screeningService';

export function useScreeningProgress(projectId: string, phase: string) {
    const query = useQuery({
        queryKey: ['screening-progress', projectId, phase],
        queryFn: () => getProgress(projectId, phase),
        enabled: !!projectId && !!phase,
        refetchInterval: 10000,
    });

    return {
        progress: query.data,
        isLoading: query.isLoading,
        refetch: query.refetch,
    };
}

export function useScreeningDashboard(projectId: string, phase: string) {
    const query = useQuery({
        queryKey: ['screening-dashboard', projectId, phase],
        queryFn: () => getDashboard(projectId, phase),
        enabled: !!projectId && !!phase,
        refetchInterval: 15000,
    });

    return {
        dashboard: query.data,
        isLoading: query.isLoading,
        refetch: query.refetch,
    };
}
