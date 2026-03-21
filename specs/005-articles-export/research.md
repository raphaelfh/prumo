# Research: Articles List Export

**Feature**: 005-articles-export  
**Date**: 2026-03-15

## 1. RIS export format

**Decision**: Generate RIS using the standard tag-based format: each record starts with `TY  - ` (type, e.g. JOUR for
journal) and ends with `ER  - `. Use two-letter tag, two spaces, hyphen, space, value. Multiple records in one file with
no blank line between `ER` and next `TY`.

**Rationale**: RIS is widely supported by reference managers (EndNote, Zotero, Mendeley). Spec requires
interoperability.

**Tags to emit** (map from Article model): `TY` (JOUR), `TI` (title), `AU` (authors, one per line, "LastName, FirstName"
when possible), `PY` (publication_year), `JO` or `T2` (journal_title), `AB` (abstract), `DO` (DOI), `AN` (PMID where
applicable). Optional: `VL`, `IS`, `SP`, `EP` (volume, issue, pages) if present. Line ending: CRLF or LF both accepted
by major tools.

**Alternatives considered**: Emit only minimal tags (TY, TI, AU, PY, ER) for simplicity; rejected because spec
requires "all data" and abstract/DOI/PMID are expected by users.

---

## 2. CSV export format

**Decision**: One row per article. Columns: title, authors (joined with "; " or similar), publication_year,
journal_title, doi, pmid, keywords (joined), abstract. Header row with snake_case or human-readable names. UTF-8
encoding; escape quotes per RFC 4180.

**Rationale**: Spec says "standard bibliographic columns"; CSV is for spreadsheets and portability. No single universal
standard—align with common reference-manager CSV exports (e.g. one column per field, authors as single cell).

**Alternatives considered**: Multiple author columns (Author1, Author2, …); rejected in favor of single authors column
with delimiter for simplicity and compatibility.

---

## 3. Zotero RDF export format

**Decision**: Generate RDF that Zotero can import by following the structure produced by Zotero's own export (
Bibliontology-style or Zotero RDF). Prefer generating a minimal valid RDF with dc:title, dc:creator, bibo:Journal, bibo:
abstract, bibo:doi, etc., or use a small template derived from Zotero export samples. If full Zotero RDF is complex,
document "best-effort compatibility" and validate by importing a sample into Zotero.

**Rationale**: Spec requires "Zotero RDF"; Zotero documentation for programmatic RDF is limited, but import is tolerant.
Implementation can start with a minimal RDF structure and iterate based on import tests.

**Alternatives considered**: Export as CSL JSON instead of RDF; rejected because spec explicitly requires Zotero RDF.
Using a third-party library that emits Zotero-compatible RDF if available; accept if found, otherwise handcraft from
Zotero export examples.

---

## 4. Async export and one-time download link

**Decision**: For exports that include files or exceed a size/duration threshold (e.g. > N articles or estimated time >
few seconds), enqueue a Celery task. The endpoint returns immediately with a job_id. Frontend polls a status endpoint (
GET /api/v1/articles-export/status/{job_id}) until status is "completed" or "failed". On "completed", response includes
a signed URL (short-lived, e.g. 1 hour) for the ZIP; frontend shows a "Download ready" notification with a button that
opens this URL. Celery result backend stores task return value (status, download_url, expires_at, skipped_files). The
task builds the export (metadata + files), uploads the ZIP to storage, creates a signed URL, and returns it.

**Rationale**: Constitution requires long-running work offloaded to Celery; spec requires progress/cancel and
notification with one-time download link. Polling is simpler than WebSocket/SSE for this use case and fits existing API
client.

**Alternatives considered**: Synchronous only with streaming response; rejected for large exports to avoid timeouts.
WebSocket/SSE for push notification; deferred to keep first version simple (polling + download link).

---

## 5. Temporary storage for export ZIP

**Decision**: Use Supabase Storage in the existing "articles" bucket under a dedicated prefix, e.g.
`exports/{user_id}/{job_id}.zip`. After upload, create a signed URL (e.g. 1h expiry). Optionally run a periodic
cleanup (Celery beat or cron) to delete exports older than 24h. Do not add a new bucket if the existing bucket supports
private paths and signed URLs (current Supabase setup does).

**Rationale**: Avoids new infrastructure; reuse StorageAdapter.upload and get_signed_url. Path is scoped by user and job
to avoid collisions.

**Alternatives considered**: New "exports" bucket; acceptable if product prefers strict separation. Ephemeral local disk
then stream to response; only works for sync, not async. Redis/blob for ZIP; rejected to avoid storing large blobs in
Redis.

---

## 6. Progress and cancellation

**Decision**: Progress: Celery task can update progress in a shared store (e.g. Redis key `export:{job_id}:progress`
with value like `{"current": 10, "total": 50, "stage": "files"}`). Status endpoint returns this when available.
Cancellation: frontend calls DELETE or POST cancel with job_id; backend revokes the task (Celery revoke) and optionally
marks result as cancelled. If task already finished, cancel is no-op; download link can still be returned until expiry.

**Rationale**: Spec requires "progress feedback and allows cancellation". Redis is already used as Celery broker; using
it for progress keeps dependencies unchanged.

**Alternatives considered**: Progress only in Celery result (no intermediate updates); possible but gives coarse
granularity. Cancellation without revoke (just "don't use the link"); acceptable as minimal implementation; revoke is
better UX.
