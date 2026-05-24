"""Unit tests for app.services.articles_export_service.

Pure-mock — no database or network calls. Covers the public API of
ArticlesExportService plus the module-level pure helpers.
"""

import io
import uuid
import zipfile
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.articles_export_service import (
    ArticlesExportService,
    _authors_ris,
    _build_csv,
    _build_rdf,
    _build_ris,
    _sanitize_folder_name,
    _xml_esc,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def make_article(
    *,
    title: str = "Test Article",
    authors: list[str] | None = None,
    publication_year: int | None = 2024,
    journal_title: str | None = "Nature",
    doi: str | None = "10.1234/test",
    pmid: str | None = "12345678",
    keywords: list[str] | None = None,
    abstract: str | None = "Test abstract",
    files: list | None = None,
) -> MagicMock:
    art = MagicMock()
    art.id = uuid.uuid4()
    art.title = title
    art.authors = authors or ["Smith, J", "Doe, A"]
    art.publication_year = publication_year
    art.journal_title = journal_title
    art.doi = doi
    art.pmid = pmid
    art.keywords = keywords or ["ml", "nlp"]
    art.abstract = abstract
    art.files = files or []
    return art


def make_service(
    storage: MagicMock | None = None,
) -> ArticlesExportService:
    db = AsyncMock()
    if storage is None:
        storage = AsyncMock()
    return ArticlesExportService(db=db, user_id="user-abc", storage=storage, trace_id="t-1")


# ---------------------------------------------------------------------------
# _sanitize_folder_name
# ---------------------------------------------------------------------------


class TestSanitizeFolderName:
    def test_returns_id_prefix_and_sanitized_title(self) -> None:
        aid = uuid.UUID("12345678-0000-0000-0000-000000000000")
        result = _sanitize_folder_name("Hello World", aid)
        assert result == f"{aid}_Hello_World"

    def test_strips_invalid_chars(self) -> None:
        aid = uuid.UUID("12345678-0000-0000-0000-000000000000")
        result = _sanitize_folder_name('My<>:"/\\|?*Title', aid)
        assert "<" not in result and ">" not in result and ":" not in result

    def test_empty_title_falls_back_to_article(self) -> None:
        aid = uuid.UUID("12345678-0000-0000-0000-000000000000")
        result = _sanitize_folder_name("", aid)
        assert result == f"{aid}_article"

    def test_none_title_falls_back_to_article(self) -> None:
        aid = uuid.UUID("12345678-0000-0000-0000-000000000000")
        result = _sanitize_folder_name(None, aid)  # type: ignore[arg-type]
        assert result == f"{aid}_article"

    def test_collapses_whitespace_to_underscore(self) -> None:
        aid = uuid.UUID("12345678-0000-0000-0000-000000000000")
        result = _sanitize_folder_name("A  B   C", aid)
        assert "A_B_C" in result


# ---------------------------------------------------------------------------
# _authors_ris
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "authors, expected",
    [
        (None, []),
        ([], []),
        (["Smith, J", "  ", "Doe, A"], ["Smith, J", "Doe, A"]),
        ([""], []),
    ],
)
def test_authors_ris(authors, expected) -> None:
    assert _authors_ris(authors) == expected


# ---------------------------------------------------------------------------
# _xml_esc
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "s, expected_sub",
    [
        ("a & b", "a &amp; b"),
        ("<tag>", "&lt;tag&gt;"),
        ('"quoted"', "&quot;quoted&quot;"),
    ],
)
def test_xml_esc(s, expected_sub) -> None:
    assert _xml_esc(s) == expected_sub


# ---------------------------------------------------------------------------
# _build_csv
# ---------------------------------------------------------------------------


class TestBuildCsv:
    def test_header_row_present(self) -> None:
        content = _build_csv([])
        assert b"title" in content and b"authors" in content

    def test_article_row_included(self) -> None:
        art = make_article(title="My Title", authors=["Alice", "Bob"])
        content = _build_csv([art])
        assert b"My Title" in content
        assert b"Alice; Bob" in content

    def test_missing_optional_fields_are_empty(self) -> None:
        art = make_article(
            doi=None,
            pmid=None,
            journal_title=None,
            keywords=None,
            abstract=None,
        )
        content = _build_csv([art])
        # Should not raise and header still present
        assert b"title" in content

    def test_newlines_in_abstract_replaced(self) -> None:
        art = make_article(abstract="line1\nline2")
        content = _build_csv([art])
        assert b"line1 line2" in content

    def test_multiple_articles(self) -> None:
        arts = [make_article(title=f"Article {i}") for i in range(5)]
        content = _build_csv(arts)
        assert content.count(b"Article") == 5


# ---------------------------------------------------------------------------
# _build_ris
# ---------------------------------------------------------------------------


class TestBuildRis:
    def test_ty_and_er_markers(self) -> None:
        art = make_article()
        content = _build_ris([art])
        assert b"TY  - JOUR" in content
        assert b"ER  - " in content

    def test_title_and_doi(self) -> None:
        art = make_article(title="Foo", doi="10.999/foo")
        content = _build_ris([art])
        assert b"TI  - Foo" in content
        assert b"DO  - 10.999/foo" in content

    def test_missing_year_not_included(self) -> None:
        art = make_article(publication_year=None)
        content = _build_ris([art])
        assert b"PY  -" not in content

    def test_missing_doi_not_included(self) -> None:
        art = make_article(doi=None)
        content = _build_ris([art])
        assert b"DO  -" not in content

    def test_abstract_truncated_to_255(self) -> None:
        art = make_article(abstract="X" * 300)
        content = _build_ris([art])
        lines = content.decode().split("\r\n")
        ab_line = next((line for line in lines if line.startswith("AB")), None)
        assert ab_line is not None
        assert len(ab_line) <= 262  # "AB  - " (6 chars) prefix + 255 chars + \r separator

    def test_multiple_authors(self) -> None:
        art = make_article(authors=["Alpha, A", "Beta, B"])
        content = _build_ris([art])
        assert b"AU  - Alpha, A" in content
        assert b"AU  - Beta, B" in content


# ---------------------------------------------------------------------------
# _build_rdf
# ---------------------------------------------------------------------------


class TestBuildRdf:
    def test_valid_xml_structure(self) -> None:
        art = make_article()
        content = _build_rdf([art])
        assert b"<?xml version" in content
        assert b"rdf:RDF" in content
        assert b"</rdf:RDF>" in content

    def test_article_id_in_rdf(self) -> None:
        art = make_article()
        content = _build_rdf([art])
        assert art.id.hex.encode() in content

    def test_escapes_special_chars_in_title(self) -> None:
        art = make_article(title="A & B < C")
        content = _build_rdf([art])
        assert b"&amp;" in content
        assert b"&lt;" in content

    def test_no_creator_for_empty_author(self) -> None:
        art = make_article(authors=["  "])
        content = _build_rdf([art])
        assert b"dc:creator" not in content


# ---------------------------------------------------------------------------
# ArticlesExportService.get_articles_for_export
# ---------------------------------------------------------------------------


class TestGetArticlesForExport:
    @pytest.mark.asyncio
    async def test_delegates_to_article_repo(self) -> None:
        svc = make_service()
        project_id = uuid.uuid4()
        article_ids = [uuid.uuid4()]
        expected = [make_article()]

        with patch("app.services.articles_export_service.ArticleRepository") as MockRepo:
            MockRepo.return_value.get_by_ids = AsyncMock(return_value=expected)
            result = await svc.get_articles_for_export(project_id, article_ids, include_files=False)

        assert result == expected
        MockRepo.return_value.get_by_ids.assert_awaited_once_with(
            article_ids, project_id, include_files=False
        )


# ---------------------------------------------------------------------------
# ArticlesExportService.run_export — file_scope="none"
# ---------------------------------------------------------------------------


class TestRunExportFileScope:
    @pytest.mark.asyncio
    async def test_empty_articles_returns_empty_bytes(self) -> None:
        svc = make_service()
        with patch.object(svc, "get_articles_for_export", AsyncMock(return_value=[])):
            content, ct, fname, skipped = await svc.run_export(uuid.uuid4(), [], ["csv"], "none")
        assert content == b""
        assert ct == "application/octet-stream"

    @pytest.mark.asyncio
    async def test_single_csv_format_returns_csv(self) -> None:
        svc = make_service()
        arts = [make_article(title="T1")]
        with patch.object(svc, "get_articles_for_export", AsyncMock(return_value=arts)):
            content, ct, fname, skipped = await svc.run_export(
                uuid.uuid4(), [arts[0].id], ["csv"], "none"
            )
        assert ct == "text/csv"
        assert fname == "articles_export.csv"
        assert b"T1" in content

    @pytest.mark.asyncio
    async def test_single_ris_format_returns_ris(self) -> None:
        svc = make_service()
        arts = [make_article()]
        with patch.object(svc, "get_articles_for_export", AsyncMock(return_value=arts)):
            content, ct, fname, _ = await svc.run_export(
                uuid.uuid4(), [arts[0].id], ["ris"], "none"
            )
        assert ct == "application/x-research-info-systems"
        assert fname == "articles_export.ris"
        assert b"TY  - JOUR" in content

    @pytest.mark.asyncio
    async def test_single_rdf_format_returns_rdf(self) -> None:
        svc = make_service()
        arts = [make_article()]
        with patch.object(svc, "get_articles_for_export", AsyncMock(return_value=arts)):
            content, ct, fname, _ = await svc.run_export(
                uuid.uuid4(), [arts[0].id], ["rdf"], "none"
            )
        assert ct == "application/rdf+xml"
        assert fname == "articles_export.rdf"

    @pytest.mark.asyncio
    async def test_multiple_formats_returns_zip(self) -> None:
        svc = make_service()
        arts = [make_article()]
        with patch.object(svc, "get_articles_for_export", AsyncMock(return_value=arts)):
            content, ct, fname, _ = await svc.run_export(
                uuid.uuid4(), [arts[0].id], ["csv", "ris"], "none"
            )
        assert ct == "application/zip"
        zf = zipfile.ZipFile(io.BytesIO(content))
        names = zf.namelist()
        assert "articles_export.csv" in names
        assert "articles_export.ris" in names


# ---------------------------------------------------------------------------
# ArticlesExportService.run_export — file_scope="main_only"
# ---------------------------------------------------------------------------


class TestRunExportMainOnly:
    @pytest.mark.asyncio
    async def test_zip_contains_metadata_and_main_pdf(self) -> None:
        storage = AsyncMock()
        storage.download = AsyncMock(return_value=b"%PDF-fake")
        svc = make_service(storage)

        main_file = MagicMock()
        main_file.file_role = "MAIN"
        main_file.storage_key = "files/main.pdf"
        main_file.original_filename = "paper.pdf"

        arts = [make_article(files=[main_file])]

        with patch.object(svc, "get_articles_for_export", AsyncMock(return_value=arts)):
            content, ct, fname, skipped = await svc.run_export(
                uuid.uuid4(), [arts[0].id], ["csv"], "main_only"
            )

        assert ct == "application/zip"
        zf = zipfile.ZipFile(io.BytesIO(content))
        names = zf.namelist()
        assert "articles_export.csv" in names
        assert "paper.pdf" in names
        assert skipped == []

    @pytest.mark.asyncio
    async def test_storage_failure_adds_to_skipped_and_readme(self) -> None:
        storage = AsyncMock()
        storage.download = AsyncMock(side_effect=RuntimeError("storage unavailable"))
        svc = make_service(storage)

        main_file = MagicMock()
        main_file.file_role = "MAIN"
        main_file.storage_key = "files/main.pdf"
        main_file.original_filename = "bad.pdf"

        art = make_article(files=[main_file])
        with patch.object(svc, "get_articles_for_export", AsyncMock(return_value=[art])):
            content, ct, fname, skipped = await svc.run_export(
                uuid.uuid4(), [art.id], ["csv"], "main_only"
            )

        assert len(skipped) == 1
        assert skipped[0]["storage_key"] == "files/main.pdf"
        zf = zipfile.ZipFile(io.BytesIO(content))
        assert "README_export.txt" in zf.namelist()

    @pytest.mark.asyncio
    async def test_article_without_main_file_skipped_silently(self) -> None:
        storage = AsyncMock()
        svc = make_service(storage)
        # file_role != MAIN
        supp = MagicMock()
        supp.file_role = "SUPPLEMENT"
        art = make_article(files=[supp])

        with patch.object(svc, "get_articles_for_export", AsyncMock(return_value=[art])):
            _, _, _, skipped = await svc.run_export(uuid.uuid4(), [art.id], ["csv"], "main_only")
        assert skipped == []


# ---------------------------------------------------------------------------
# ArticlesExportService.run_export — file_scope="all"
# ---------------------------------------------------------------------------


class TestRunExportAll:
    @pytest.mark.asyncio
    async def test_each_article_gets_own_folder(self) -> None:
        storage = AsyncMock()
        storage.download = AsyncMock(return_value=b"%PDF")
        svc = make_service(storage)

        f = MagicMock()
        f.storage_key = "files/doc.pdf"
        f.original_filename = "doc.pdf"

        art = make_article(title="Art One", files=[f])

        with patch.object(svc, "get_articles_for_export", AsyncMock(return_value=[art])):
            content, ct, _, skipped = await svc.run_export(uuid.uuid4(), [art.id], ["csv"], "all")

        zf = zipfile.ZipFile(io.BytesIO(content))
        names = zf.namelist()
        # Should have folder/article.csv and folder/doc.pdf
        assert any("article.csv" in n for n in names)
        assert any("doc.pdf" in n for n in names)
        assert skipped == []

    @pytest.mark.asyncio
    async def test_storage_failure_in_all_scope_adds_skipped(self) -> None:
        storage = AsyncMock()
        storage.download = AsyncMock(side_effect=OSError("fail"))
        svc = make_service(storage)

        f = MagicMock()
        f.storage_key = "files/bad.pdf"
        f.original_filename = "bad.pdf"

        art = make_article(files=[f])
        with patch.object(svc, "get_articles_for_export", AsyncMock(return_value=[art])):
            content, _, _, skipped = await svc.run_export(uuid.uuid4(), [art.id], ["csv"], "all")

        assert len(skipped) == 1


# ---------------------------------------------------------------------------
# ArticlesExportService.run_export_async
# ---------------------------------------------------------------------------


class TestRunExportAsync:
    @pytest.mark.asyncio
    async def test_uploads_and_returns_download_url(self) -> None:
        storage = AsyncMock()
        storage.upload = AsyncMock()
        storage.get_signed_url = AsyncMock(return_value="https://example.com/export.zip")
        svc = make_service(storage)

        arts = [make_article()]
        with patch.object(svc, "get_articles_for_export", AsyncMock(return_value=arts)):
            result = await svc.run_export_async(
                project_id=uuid.uuid4(),
                article_ids=[arts[0].id],
                formats=["csv"],
                file_scope="none",
                job_id="job-123",
            )

        assert result["download_url"] == "https://example.com/export.zip"
        assert "expires_at" in result
        assert "skipped_files" in result
        storage.upload.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_path_uses_user_id_and_job_id(self) -> None:
        storage = AsyncMock()
        storage.upload = AsyncMock()
        storage.get_signed_url = AsyncMock(return_value="https://x.com/file.zip")
        svc = make_service(storage)

        arts = [make_article()]
        with patch.object(svc, "get_articles_for_export", AsyncMock(return_value=arts)):
            await svc.run_export_async(
                project_id=uuid.uuid4(),
                article_ids=[arts[0].id],
                formats=["csv"],
                file_scope="none",
                job_id="my-job",
            )

        call_args = storage.upload.call_args
        path_arg = call_args[0][1]
        assert "user-abc" in path_arg
        assert "my-job" in path_arg
