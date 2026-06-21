"""Fitness: every ArticleFile-create site must route through the ingest hook.

Greps app/ for ArticleFile-construction / article_files.create call sites and
asserts none bypass ArticleFileIngestService.enqueue_parse_at_ingest. New ingest
routes added later are caught here.
"""

import re
from pathlib import Path

_APP = Path(__file__).parent.parent.parent / "app"

# Files allowed to create an ArticleFile. Each MUST also enqueue the parse hook
# (or BE the hook). unit_of_work.py only mentions it in a docstring example.
_ALLOWED = {
    "services/zotero_import_service.py",
    "services/article_file_ingest_service.py",
    "services/article_file_service.py",
    "repositories/unit_of_work.py",
}

# Negative lookbehind excludes the class *definition* (`class ArticleFile(`)
# while still matching real instantiations (`ArticleFile(article_id=...)`) and
# repository calls (`article_files.create(`).
_CREATE_PAT = re.compile(r"(?<!class )ArticleFile\(|article_files\.create\(")


def _rel(path: Path) -> str:
    return str(path.relative_to(_APP)).replace("\\", "/")


def test_no_articlefile_create_bypasses_the_ingest_hook() -> None:
    offenders: list[str] = []
    for py in _APP.rglob("*.py"):
        text = py.read_text(encoding="utf-8")
        if not _CREATE_PAT.search(text):
            continue
        rel = _rel(py)
        if rel in _ALLOWED:
            continue
        offenders.append(rel)
    assert not offenders, (
        "ArticleFile-create site(s) bypass the parse-at-ingest hook: "
        f"{offenders}. Route them through ArticleFileIngestService."
    )
