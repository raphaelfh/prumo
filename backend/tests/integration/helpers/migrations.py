"""Alembic migration files, loaded by path.

``alembic/versions`` is not a package, so a migration's exact statements
reach a test only by loading the file itself. The data migrations are driven
that way inside the savepoint-isolated ``db_session`` — never through the
``alembic`` subprocess, which would rewrite every row in the local database
that every worktree and session share.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

_VERSIONS_DIR = Path(__file__).resolve().parents[3] / "alembic" / "versions"


def load_migration(name: str) -> ModuleType:
    """Import ``alembic/versions/<name>`` as a module, by file path."""
    path = _VERSIONS_DIR / name
    spec = importlib.util.spec_from_file_location(path.stem, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def migration_source(name: str) -> str:
    """The text of ``alembic/versions/<name>``, for asserting what its SQL names."""
    return (_VERSIONS_DIR / name).read_text()
