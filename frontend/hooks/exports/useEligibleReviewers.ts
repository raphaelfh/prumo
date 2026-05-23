/**
 * TanStack Query hook backing the reviewer picker in the export dialog (US2).
 *
 * Backed by GET /api/v1/projects/:projectId/extraction-export/reviewers
 * which already filters to the caller's permissions (non-managers see
 * only themselves).
 */

import {useQuery} from "@tanstack/react-query";
import {apiClient} from "@/integrations/api/client";

export interface EligibleReviewer {
    id: string;
    name: string;
}

export function useEligibleReviewers(
    projectId: string | null,
    templateId: string | null,
    options: {enabled?: boolean} = {},
) {
    const {enabled = true} = options;
    return useQuery<EligibleReviewer[]>({
        queryKey: ["extraction-export-reviewers", projectId, templateId],
        queryFn: async () => {
            if (!projectId || !templateId) return [];
            const url = `/api/v1/projects/${encodeURIComponent(
                projectId,
            )}/extraction-export/reviewers?template_id=${encodeURIComponent(
                templateId,
            )}`;
            return await apiClient<EligibleReviewer[]>(url);
        },
        enabled: enabled && Boolean(projectId) && Boolean(templateId),
        staleTime: 30_000,
    });
}
