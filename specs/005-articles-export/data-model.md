# Data Model: Articles Export

**Feature**: 005-articles-export  
**Date**: 2026-03-15

This feature does not introduce new persistent database entities. It consumes existing **Article** and **ArticleFile**
models and produces export artifacts (files) and transient job state.

## Existing entities used

### Article (public.articles)

Used as the source of bibliographic metadata for export.

- **Relevant attributes**: id, project_id, title, abstract, publication_year, journal_title, authors (array), doi, pmid,
  keywords (array), and optionally volume, issue, pages for RIS.
- **Relationships**: files → ArticleFile (one-to-many).

### ArticleFile (public.article_files)

Used to decide which files to include and to fetch binary content from storage.

- **Relevant attributes**: article_id, storage_key, original_filename, file_role (MAIN, SUPPLEMENT, etc.).
- **Filtering**: "Main files only" → file_role = MAIN. "All files" → all roles.
- **Storage**: Binaries live in Supabase Storage (bucket "articles"); storage_key is the path.

## Transient / in-memory structures

### Export request (API input)

- **article_ids**: list of UUIDs (either the current visible list or the user’s selection).
- **project_id**: UUID (for authorization and storage path).
- **formats**: list of enum ["csv", "ris", "rdf"] (one or more).
- **file_scope**: enum "none" | "main_only" | "all".
- **scope**: enum "current_list" | "selected" (handled by frontend; backend receives resolved article_ids).

### Export job result (Celery task return / status API)

- **job_id**: string (Celery task id).
- **status**: "pending" | "running" | "completed" | "failed" | "cancelled".
- **progress**: optional { "current": int, "total": int, "stage": string }.
- **download_url**: optional string (signed URL when status = completed).
- **expires_at**: optional ISO datetime (signed URL expiry).
- **skipped_files**: optional list of { "article_id", "storage_key", "reason" } (for UI and manifest).
- **error**: optional string (when status = failed).

### Package layout (internal)

- **Metadata-only**: Single blob per format (e.g. one CSV, one RIS, one RDF) or multiple files; no ZIP if single file
  and no attachments.
- **Main files only**: One folder (or ZIP root) containing metadata file(s) plus one file per article (main file when
  present); file names derived from original_filename or article id to avoid collisions.
- **All files**: Root contains one subfolder per article; subfolder name = `{article_id}_{sanitized_title}`; each
  subfolder contains metadata file(s) for that article plus all of its files (same naming as in DB/storage).

### Manifest for skipped files (inside package)

- **File name**: e.g. `export_manifest.txt` or `README_export.txt`.
- **Content**: List of skipped files (article id, storage_key, reason) so the user has a record inside the package (
  FR-010).

## Validation rules (from spec)

- article_ids must belong to project_id and the user must be a project member (enforced by existing project membership
  checks).
- At least one format must be selected.
- If file_scope is main_only or all, the service must fetch files from storage and handle missing/inaccessible files by
  recording them in skipped_files and continuing.

## State transitions

- **Export job**: pending → running → completed | failed | cancelled. No persistent table; state is in Celery result
  backend (Redis) and optionally Redis keys for progress.
- **Download link**: Generated when job completes; valid until expires_at (e.g. 1 hour). No revocation after generation;
  cleanup of the stored ZIP is optional (e.g. TTL or periodic job).
