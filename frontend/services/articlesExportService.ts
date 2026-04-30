/**
 * Articles export API client.
 * Uses fetch for POST start-export (response can be 200 blob or 202 JSON)
 * and apiClient for GET status and cancel (JSON only). Constitution Principle VI.
 */

import {apiClient} from "@/integrations/api/client";
import {supabase} from "@/integrations/supabase/client";

const API_BASE_URL =
    import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
const EXPORT_BASE = "/api/v1/articles-export";

export type ExportFormat = "csv" | "ris" | "rdf";
export type FileScope = "none" | "main_only" | "all";

export interface StartExportSyncResult {
    kind: "sync";
    blob: Blob;
    filename: string;
}

export interface StartExportAsyncResult {
    kind: "async";
    job_id: string;
}

export type StartExportResult = StartExportSyncResult | StartExportAsyncResult;

export interface ExportStatusResponse {
    job_id: string;
    status: "pending" | "running" | "completed" | "failed" | "cancelled";
    progress?: { current: number; total: number; stage: string };
    download_url?: string;
    expires_at?: string;
    skipped_files?: Array<{ article_id: string; storage_key: string; reason: string }>;
    error?: string;
}

/**
 * Start export: POST /api/v1/articles-export.
 * Returns sync result (blob + filename) on 200, async result (job_id) on 202.
 */
export async function startExport(
    projectId: string,
    articleIds: string[],
    formats: ExportFormat[],
    fileScope: FileScope
): Promise<StartExportResult> {
    const {
        data: {session},
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
        throw new Error("Auth required");
    }

    const url = `${API_BASE_URL}${EXPORT_BASE}`;
    const res = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
            project_id: projectId,
            article_ids: articleIds,
            formats,
            file_scope: fileScope,
        }),
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
        let filename = "articles_export.zip";
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
        errBody?.error?.message ?? errBody?.message ?? `Export failed (${res.status})`;
    throw new Error(msg);
}

/**
 * Get export status: GET /api/v1/articles-export/status/{job_id}.
 */
export async function getExportStatus(
    jobId: string
): Promise<ExportStatusResponse> {
    const data = await apiClient<ExportStatusResponse>(
        `${EXPORT_BASE}/status/${encodeURIComponent(jobId)}`
    );
    return data;
}

/**
 * Cancel export: POST .../cancel or DELETE .../status/{job_id}.
 */
export async function cancelExport(jobId: string): Promise<{ cancelled: boolean }> {
    const data = await apiClient<{ cancelled: boolean }>(
        `${EXPORT_BASE}/status/${jobId}`,
        {method: "DELETE"}
    );
    return data;
}
