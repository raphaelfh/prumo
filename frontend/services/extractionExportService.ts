/**
 * Extraction export API client.
 *
 * All backend calls go through the typed client
 * (`frontend/integrations/api/client.ts`): `apiBlobClient` for the
 * binary POST start-export (200 blob | 202 job), and `apiClient` for
 * status/cancel. No raw `fetch`, `import.meta.env.VITE_API_URL`, or
 * `supabase.auth` in this service (frontend data-access rule).
 */

import {apiBlobClient, apiClient} from "@/integrations/api/client";
import type {
    ExtractionExportCancelResult,
    ExtractionExportRequest,
    ExtractionExportStatus,
    StartExtractionExportResult,
} from "@/types/extraction-export";

function endpointBase(projectId: string): string {
    return `/api/v1/projects/${encodeURIComponent(projectId)}/extraction-export`;
}

function statusEndpoint(projectId: string, jobId: string): string {
    return `${endpointBase(projectId)}/status/${encodeURIComponent(jobId)}`;
}

/**
 * Start an extraction export.
 *
 * Returns:
 *   - {kind:"sync", blob, filename} when the backend chose the sync
 *     path (≤ 50 articles, no AI metadata, mode ∈ {consensus, single_user}).
 *   - {kind:"async", job_id} when the backend queued the job; the caller
 *     should push a BackgroundJob and poll via `getExportStatus`.
 *
 * On error, throws `ApiError` carrying the `error.message` from the API
 * envelope (NEVER the FastAPI `detail` field). Callers surface this in
 * an inline banner.
 */
export async function startExport(
    projectId: string,
    request: ExtractionExportRequest,
    signal?: AbortSignal,
): Promise<StartExtractionExportResult> {
    const result = await apiBlobClient(
        endpointBase(projectId),
        {method: "POST", body: request, signal},
        "extraction_export.xlsx",
    );
    if (result.kind === "sync") {
        return {kind: "sync", blob: result.blob, filename: result.filename};
    }
    return {kind: "async", job_id: result.job_id};
}

/**
 * Poll an async extraction export's status.
 */
export async function getExportStatus(
    projectId: string,
    jobId: string,
): Promise<ExtractionExportStatus> {
    return apiClient<ExtractionExportStatus>(statusEndpoint(projectId, jobId));
}

/**
 * Cancel a queued or running extraction export.
 */
export async function cancelExport(
    projectId: string,
    jobId: string,
): Promise<ExtractionExportCancelResult> {
    return apiClient<ExtractionExportCancelResult>(
        statusEndpoint(projectId, jobId),
        {method: "DELETE"},
    );
}
