# Quickstart: Articles Export

**Feature**: 005-articles-export

## For developers

### Backend

1. **Dependencies**: Existing stack (FastAPI, SQLAlchemy, Celery, Supabase Storage). No new DB migrations for export;
   optional Redis key for progress.
2. **New modules**:
    - `app/api/v1/endpoints/articles_export.py`: POST start export, GET status, POST/DELETE cancel.
    - `app/services/articles_export_service.py`: Build CSV/RIS/RDF, assemble ZIP, upload to storage, return signed URL;
      used by endpoint (sync) and Celery task (async).
    - `app/schemas/articles_export.py`: Pydantic request/response (ExportRequest, ExportStatusResponse, etc.).
    - `app/worker/tasks/export_tasks.py`: Celery task
      `export_articles_task(project_id, article_ids, formats, file_scope, user_id)`; calls export service, uploads ZIP
      to `articles/exports/{user_id}/{job_id}.zip`, returns download_url and skipped_files.
3. **Storage**: Use existing StorageAdapter. Upload ZIP via
   `upload("articles", f"exports/{user_id}/{job_id}.zip", zip_bytes, "application/zip")`. Signed URL via
   `get_signed_url("articles", path, expires_in=3600)`.
4. **Authorization**: Resolve user from JWT; verify user is project member before starting export and before returning
   status/download (job must be owned by user).

### Frontend

1. **Export trigger**: From ArticlesList toolbar (e.g. "Export" button or dropdown), open ArticlesExportDialog.
2. **Dialog**: Form with format checkboxes (CSV, RIS, RDF), file scope (None / Main only / All), and article scope (
   Current list / Selected). Default scope = Current list when no selection. Submit calls export API.
3. **Sync response**: If API returns 200 with body, trigger browser download (blob + anchor or content-disposition).
4. **Async response**: If API returns 202 with jobId, show progress (poll GET status every 2–3s); when status = "
   completed", show notification with "Download" button using response.downloadUrl. On "failed", show error message.
5. **Cancel**: Button to call cancel endpoint; stop polling and update UI.

### Running locally

- Backend: `cd backend && uv run uvicorn app.main:app --reload`
- Worker: `cd backend && uv run celery -A app.worker.celery_app worker -l info`
- Frontend: `cd frontend && npm run dev`
- Ensure Redis is running (Celery broker and result backend).

### Tests

- **Unit**: `articles_export_service` — build CSV/RIS/RDF from a list of Article-like dicts; build ZIP layout (main_only
  vs all); no live DB/storage.
- **Integration**: Export endpoint — auth, 400/403, sync 200 with small payload, 202 with job_id; status endpoint
  returns 200 with status and, when completed, download_url.

## Acceptance checklist (from spec)

- [ ] Export current list or selection in CSV, RIS, or RDF; open in spreadsheet/reference manager.
- [ ] Main only: one package with metadata + at most one file per article.
- [ ] All files: one folder per article (id_sanitized_title), each with metadata + all files.
- [ ] Metadata-only 100 articles &lt; 30s.
- [ ] Skipped files: summary in UI + list in package (e.g. README/manifest).
- [ ] Async: progress and cancel; notification with one-time download link when ready.
