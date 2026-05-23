/**
 * Types for the extraction Excel export feature.
 *
 * Feature: 009-extraction-excel-export
 * Contract: specs/009-extraction-excel-export/contracts/extraction-export.openapi.yaml
 */

export type ExtractionExportMode = "consensus" | "single_user" | "all_users";

export type ExtractionArticleScope = "current_list" | "selected_only";

export interface ExtractionExportRequest {
    template_id: string;
    mode: ExtractionExportMode;
    reviewer_id?: string | null;
    article_scope: ExtractionArticleScope;
    article_ids: string[];
    include_ai_metadata?: boolean;
    anonymize_reviewer_names?: boolean;
}

export interface StartExtractionExportSyncResult {
    kind: "sync";
    blob: Blob;
    filename: string;
}

export interface StartExtractionExportAsyncResult {
    kind: "async";
    job_id: string;
}

export type StartExtractionExportResult =
    | StartExtractionExportSyncResult
    | StartExtractionExportAsyncResult;

export interface ExtractionExportStatus {
    job_id: string;
    status: "pending" | "running" | "completed" | "failed" | "cancelled";
    download_url?: string;
    expires_at?: string;
    error?: string;
}

export interface ExtractionExportCancelResult {
    cancelled: boolean;
}
