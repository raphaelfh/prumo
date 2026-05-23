/**
 * Extraction export API client (009-extraction-excel-export).
 *
 * Mirrors `articlesExportService`: uses `fetch` for POST start-export
 * (response is 200 blob or 202 JSON), and `apiClient` for status/cancel.
 * Constitution Principle VI.
 */

import {apiClient} from "@/integrations/api/client";
import {supabase} from "@/integrations/supabase/client";
import type {
    ExtractionExportCancelResult,
    ExtractionExportRequest,
    ExtractionExportStatus,
    StartExtractionExportResult,
} from "@/types/extraction-export";

const API_BASE_URL =
    import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

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
 * On error, throws an `Error` carrying the `error.message` from the
 * API envelope (NEVER the HTTP `detail` field — see memory). Callers
 * are expected to surface this in an inline banner per FR-031.
 */
export async function startExport(
    projectId: string,
    request: ExtractionExportRequest,
    signal?: AbortSignal,
): Promise<StartExtractionExportResult> {
    const {
        data: {session},
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
        throw new Error("Auth required");
    }

    const url = `${API_BASE_URL}${endpointBase(projectId)}`;
    const res = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(request),
        signal,
    });

    if (res.status === 200) {
        const contentType = res.headers.get("Content-Type") || "";
        if (contentType.toLowerCase().includes("application/json")) {
            const errBody = await res.json().catch(() => ({}));
            const msg =
                errBody?.error?.message ??
                errBody?.message ??
                "Export failed: expected file response but received JSON error.";
            throw new Error(msg);
        }
        const blob = await res.blob();
        const disposition = res.headers.get("Content-Disposition");
        let filename = "extraction_export.xlsx";
        if (disposition) {
            const match = /filename="?([^";\n]+)"?/.exec(disposition);
            if (match) filename = match[1].trim();
        }
        return {kind: "sync", blob, filename};
    }

    if (res.status === 202) {
        const data = await res.json();
        const payload = data?.data ?? data;
        const jobId = payload?.job_id;
        if (typeof jobId !== "string") {
            throw new Error("Invalid 202 response: missing job_id");
        }
        return {kind: "async", job_id: jobId};
    }

    const errBody = await res.json().catch(() => ({}));
    const msg =
        errBody?.error?.message ??
        errBody?.message ??
        `Export failed (${res.status})`;
    throw new Error(msg);
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
