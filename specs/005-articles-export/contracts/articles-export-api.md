# Articles Export API Contract

**Feature**: 005-articles-export  
**Base path**: `/api/v1/articles-export` (or under `/api/v1/projects/{project_id}/articles/export`)  
**Auth**: Required; JWT (Supabase). user_id from token; project membership enforced.

## Start export (sync or async)

**Endpoint**: `POST /api/v1/articles-export` (or `POST /api/v1/projects/{project_id}/articles/export`)

**Request body** (camelCase in JSON, snake_case in Python):

| Field      | Type     | Required | Description                                    |
|------------|----------|----------|------------------------------------------------|
| projectId  | UUID     | Yes      | Project id (must match user’s membership).     |
| articleIds | UUID[]   | Yes      | Articles to export (current list or selected). |
| formats    | string[] | Yes      | One or more of: "csv", "ris", "rdf".           |
| fileScope  | string   | Yes      | "none" \| "main_only" \| "all".                |

**Response (sync, small export)**  
When the server decides the export is quick (e.g. metadata-only and few articles), it may return 200 with the file
directly:

- **Content-Type**: `text/csv`, `application/x-research-info-systems`, or `application/rdf+xml` (single format), or
  `application/zip` (multiple formats or with files).
- **Content-Disposition**: `attachment; filename="articles_export.csv"` (or .ris, .rdf, .zip).
- **Body**: Binary content of the export file.

**Response (async, long export)**  
When the server enqueues a background job (e.g. file-inclusive or many articles), it returns 202 Accepted:

| Field   | Type   | Description                                                     |
|---------|--------|-----------------------------------------------------------------|
| jobId   | string | Celery task id; used for status polling.                        |
| message | string | Optional; e.g. "Export started. Poll status for download link." |

**Errors**:

- 400: Invalid request (e.g. empty articleIds, invalid formats or fileScope).
- 403: User is not a member of the project.
- 404: Project or any article not found (or not in project).
- 429: Rate limit exceeded (e.g. per-user export limit).

---

## Export status (polling)

**Endpoint**: `GET /api/v1/articles-export/status/{job_id}`

**Path**: `job_id` — string (Celery task id returned from start export).

**Response 200** (JSON):

| Field        | Type   | Description                                                       |
|--------------|--------|-------------------------------------------------------------------|
| jobId        | string | Same as path.                                                     |
| status       | string | "pending" \| "running" \| "completed" \| "failed" \| "cancelled". |
| progress     | object | Optional. { current: number, total: number, stage: string }.      |
| downloadUrl  | string | Present when status = "completed"; one-time signed URL.           |
| expiresAt    | string | ISO 8601; when downloadUrl expires.                               |
| skippedFiles | array  | Optional. [{ articleId, storageKey, reason }].                    |
| error        | string | Present when status = "failed"; message.                          |

**Errors**:

- 403: Job does not belong to current user (or job not found).
- 404: job_id unknown or expired.

---

## Cancel export

**Endpoint**: `POST /api/v1/articles-export/status/{job_id}/cancel` or `DELETE /api/v1/articles-export/status/{job_id}`

**Response 200**: { "cancelled": true } or status updated to "cancelled".  
**Response 404/403**: Job not found or not owned by user. If job already completed, cancel is no-op; 200 with cancelled:
false or current status.
