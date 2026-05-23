/**
 * TanStack Query hook that polls the extraction-export job status.
 *
 * Mirrors the pattern of `useBackgroundJobPolling` for the articles
 * export: pulls every 2 s while the job is in a non-terminal state,
 * then stops. Consumers wire the returned status into the in-app
 * notification center.
 */

import {useQuery} from "@tanstack/react-query";
import {getExportStatus} from "@/services/extractionExportService";
import type {ExtractionExportStatus} from "@/types/extraction-export";

const TERMINAL_STATUSES: ExtractionExportStatus["status"][] = [
    "completed",
    "failed",
    "cancelled",
];

export function useExtractionExportJob(
    projectId: string | null,
    jobId: string | null,
    options: { enabled?: boolean } = {},
) {
    const {enabled = true} = options;
    return useQuery<ExtractionExportStatus>({
        queryKey: ["extraction-export-status", projectId, jobId],
        queryFn: async () => {
            if (!projectId || !jobId) {
                throw new Error("projectId and jobId are required");
            }
            return await getExportStatus(projectId, jobId);
        },
        enabled: enabled && Boolean(projectId) && Boolean(jobId),
        refetchInterval: (query) => {
            const data = query.state.data as ExtractionExportStatus | undefined;
            if (!data) return 2_000;
            return TERMINAL_STATUSES.includes(data.status) ? false : 2_000;
        },
        staleTime: 0,
    });
}
