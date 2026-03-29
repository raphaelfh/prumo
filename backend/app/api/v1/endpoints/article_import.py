"""
Article Import Endpoints.

Endpoints for importing articles via PDF metadata extraction and CSV (Scopus) files.
"""

import csv
import io
import uuid

from fastapi import APIRouter, HTTPException, Request, UploadFile, File, Form, status

from app.core.deps import CurrentUser, DbSession, SupabaseClient
from app.core.factories import create_storage_adapter
from app.core.logging import get_logger
from app.schemas.article_import import (
    CSVImportResult,
    ExtractedArticleMetadata,
    PDFMetadataExtractionResponse,
)
from app.schemas.common import ApiResponse
from app.services.api_key_service import APIKeyService
from app.services.pdf_metadata_extraction_service import PDFMetadataExtractionService
from app.utils.rate_limiter import limiter

router = APIRouter()
logger = get_logger(__name__)


# =================== SCOPUS CSV COLUMN MAPPING ===================

SCOPUS_COLUMN_MAP = {
    "Title": "title",
    "Abstract": "abstract",
    "Authors": "authors",
    "Year": "publication_year",
    "Source title": "journal_title",
    "Volume": "volume",
    "Issue": "issue",
    "Page start": "page_start",
    "Page end": "page_end",
    "DOI": "doi",
    "Author Keywords": "author_keywords",
    "Index Keywords": "index_keywords",
    "Document Type": "article_type",
    "Open Access": "open_access",
    "Link": "url_landing",
    "Art. No.": "art_no",
    "Cited by": "cited_by",
    "EID": "eid",
    "Source": "source_db",
    "Author full names": "author_full_names",
    "Author(s) ID": "author_ids",
    "Publication Stage": "publication_status",
}


def _parse_scopus_row(row: dict[str, str], project_id: str) -> dict:
    """Parse a single Scopus CSV row into article insert data."""
    title = (row.get("Title") or "").strip()
    if not title:
        return {}

    # Parse authors from "LastName, First; LastName2, First2" format
    authors_raw = (row.get("Authors") or "").strip()
    authors = [a.strip() for a in authors_raw.split(";") if a.strip()] if authors_raw else None

    # Parse year
    year_raw = (row.get("Year") or "").strip()
    publication_year = None
    if year_raw:
        try:
            publication_year = int(year_raw)
        except ValueError:
            pass

    # Parse pages from start/end
    page_start = (row.get("Page start") or "").strip()
    page_end = (row.get("Page end") or "").strip()
    pages = None
    if page_start and page_end:
        pages = f"{page_start}-{page_end}"
    elif page_start:
        pages = page_start

    # Parse keywords (semicolon-separated)
    author_kw = (row.get("Author Keywords") or "").strip()
    index_kw = (row.get("Index Keywords") or "").strip()
    keywords = []
    if author_kw:
        keywords.extend(k.strip() for k in author_kw.split(";") if k.strip())
    if index_kw:
        keywords.extend(k.strip() for k in index_kw.split(";") if k.strip() and k.strip() not in keywords)

    # Parse open access
    oa_raw = (row.get("Open Access") or "").strip()
    open_access = None
    if oa_raw:
        open_access = oa_raw.lower() not in ("", "no", "false", "0")

    # DOI normalization
    doi = (row.get("DOI") or "").strip() or None

    return {
        "project_id": project_id,
        "title": title,
        "abstract": (row.get("Abstract") or "").strip() or None,
        "authors": authors,
        "publication_year": publication_year,
        "journal_title": (row.get("Source title") or "").strip() or None,
        "volume": (row.get("Volume") or "").strip() or None,
        "issue": (row.get("Issue") or "").strip() or None,
        "pages": pages,
        "doi": doi,
        "keywords": keywords or None,
        "article_type": (row.get("Document Type") or "").strip() or None,
        "open_access": open_access,
        "url_landing": (row.get("Link") or "").strip() or None,
        "publication_status": (row.get("Publication Stage") or "").strip() or None,
        "ingestion_source": "CSV_SCOPUS",
        "source_payload": {
            "eid": (row.get("EID") or "").strip() or None,
            "cited_by": (row.get("Cited by") or "").strip() or None,
            "source_db": (row.get("Source") or "").strip() or None,
            "author_full_names": (row.get("Author full names") or "").strip() or None,
            "author_ids": (row.get("Author(s) ID") or "").strip() or None,
            "art_no": (row.get("Art. No.") or "").strip() or None,
        },
    }


@router.post(
    "/pdf-extract-metadata",
    response_model=ApiResponse,
    summary="Extract metadata from uploaded PDF via AI",
    description="Uploads a PDF and uses AI to extract bibliographic metadata.",
)
@limiter.limit("10/minute")
async def extract_pdf_metadata(
    request: Request,
    project_id: str = Form(...),
    storage_key: str = Form(...),
    original_filename: str = Form(...),
    db: DbSession = None,
    user: CurrentUser = None,
    supabase: SupabaseClient = None,
) -> ApiResponse:
    """
    Extract article metadata from an already-uploaded PDF.

    The PDF must already be in Supabase Storage. This endpoint downloads it,
    sends it to OpenAI for metadata extraction, and returns the extracted fields.
    """
    trace_id = str(uuid.uuid4())

    logger.info(
        "pdf_metadata_extraction_request",
        trace_id=trace_id,
        user_id=user.sub,
        project_id=project_id,
        storage_key=storage_key,
    )

    try:
        # Resolve BYOK
        api_key_service = APIKeyService(db=db, user_id=user.sub)
        user_openai_key = await api_key_service.get_key_for_provider("openai")

        # Download PDF from storage
        storage = create_storage_adapter(supabase)
        pdf_bytes = await storage.download("articles", storage_key)

        # Extract metadata via AI
        service = PDFMetadataExtractionService(
            trace_id=trace_id,
            openai_api_key=user_openai_key,
        )

        try:
            result = await service.extract_metadata(
                pdf_bytes=pdf_bytes,
                filename=original_filename,
                model="gpt-4o-mini",
            )
        finally:
            await service.close()

        logger.info(
            "pdf_metadata_extraction_success",
            trace_id=trace_id,
            title=result.metadata.title[:80] if result.metadata.title else None,
        )

        return ApiResponse.success(
            data=result.model_dump(by_alias=True),
            trace_id=trace_id,
        )

    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="PDF file not found in storage",
        )
    except Exception as e:
        logger.error(
            "pdf_metadata_extraction_error",
            trace_id=trace_id,
            error=str(e),
        )
        return ApiResponse.failure(
            code="PDF_EXTRACTION_ERROR",
            message=str(e),
            trace_id=trace_id,
        )


@router.post(
    "/csv-import",
    response_model=ApiResponse,
    summary="Import articles from Scopus CSV file",
    description="Parses a Scopus-format CSV and bulk-inserts articles into the project.",
)
@limiter.limit("10/minute")
async def csv_import(
    request: Request,
    project_id: str = Form(...),
    file: UploadFile = File(...),
    db: DbSession = None,
    user: CurrentUser = None,
    supabase: SupabaseClient = None,
) -> ApiResponse:
    """
    Import articles from a Scopus-format CSV file.

    Parses the CSV, maps columns to article fields, and inserts articles.
    Duplicates are detected by DOI.
    """
    trace_id = str(uuid.uuid4())

    logger.info(
        "csv_import_request",
        trace_id=trace_id,
        user_id=user.sub,
        project_id=project_id,
        filename=file.filename,
    )

    try:
        # Read and decode CSV
        content = await file.read()

        # Try UTF-8 first, fallback to latin-1
        try:
            text = content.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = content.decode("latin-1")

        reader = csv.DictReader(io.StringIO(text))

        # Validate that it looks like a Scopus CSV
        fieldnames = reader.fieldnames or []
        if "Title" not in fieldnames:
            return ApiResponse.failure(
                code="INVALID_CSV_FORMAT",
                message="CSV must have a 'Title' column. Expected Scopus export format.",
                trace_id=trace_id,
            )

        # Fetch existing DOIs for deduplication
        from sqlalchemy import select, func
        from app.models.article import Article

        existing_dois_result = await db.execute(
            select(func.lower(Article.doi))
            .where(Article.project_id == project_id)
            .where(Article.doi.isnot(None))
        )
        existing_dois = {row[0] for row in existing_dois_result.all()}

        success_count = 0
        fail_count = 0
        duplicate_count = 0
        errors: list[str] = []

        rows = list(reader)

        logger.info(
            "csv_import_parsing",
            trace_id=trace_id,
            total_rows=len(rows),
            columns=fieldnames[:10],
        )

        for i, row in enumerate(rows):
            try:
                article_data = _parse_scopus_row(row, project_id)
                if not article_data:
                    fail_count += 1
                    errors.append(f"Row {i + 2}: Missing title")
                    continue

                # Check for DOI duplicates
                doi = article_data.get("doi")
                if doi and doi.lower() in existing_dois:
                    duplicate_count += 1
                    continue

                # Insert via Supabase (respects RLS)
                result = supabase.table("articles").insert(article_data).execute()

                if result.data:
                    success_count += 1
                    if doi:
                        existing_dois.add(doi.lower())
                else:
                    fail_count += 1
                    errors.append(f"Row {i + 2}: Insert returned no data")

            except Exception as e:
                fail_count += 1
                title = (row.get("Title") or "?")[:50]
                errors.append(f"Row {i + 2} ({title}): {str(e)[:100]}")

        import_result = CSVImportResult(
            success_count=success_count,
            fail_count=fail_count,
            duplicate_count=duplicate_count,
            errors=errors[:20],  # Limit to first 20 errors
        )

        logger.info(
            "csv_import_complete",
            trace_id=trace_id,
            success=success_count,
            failed=fail_count,
            duplicates=duplicate_count,
        )

        return ApiResponse.success(
            data=import_result.model_dump(by_alias=True),
            trace_id=trace_id,
        )

    except Exception as e:
        logger.error(
            "csv_import_error",
            trace_id=trace_id,
            error=str(e),
        )
        return ApiResponse.failure(
            code="CSV_IMPORT_ERROR",
            message=str(e),
            trace_id=trace_id,
        )
