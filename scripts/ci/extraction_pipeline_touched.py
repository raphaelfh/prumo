#!/usr/bin/env python3
"""Exit 0 if the git range touches the extraction/HITL pipeline.

CI runs the serial Playwright `local-hitl` project (and anything that
would dispatch a live extraction) only then. Viewer, copy, and docs
changes must not pay that time or LLM budget.

Usage (in Actions, after a full-history checkout):
  python3 scripts/ci/extraction_pipeline_touched.py && hitl=true || hitl=false
"""

from __future__ import annotations

import os
import subprocess
import sys

PREFIXES = (
    "backend/app/api/v1/endpoints/extraction",
    "backend/app/api/v1/endpoints/hitl",
    "backend/app/services/extraction",
    "backend/app/services/section_extraction",
    "backend/app/services/hitl",
    "backend/app/services/run_lifecycle",
    "backend/app/services/exports/extraction",
    "backend/app/repositories/extraction",
    "backend/app/repositories/hitl",
    "backend/app/models/extraction",
    "backend/app/schemas/extraction",
    "backend/app/schemas/hitl",
    "backend/app/worker/tasks/extraction",
    "frontend/hooks/extraction/",
    "frontend/hooks/hitl/",
    "frontend/components/hitl/",
    "frontend/components/runs/",
    "frontend/services/extraction",
    "frontend/services/hitl",
    "frontend/e2e/flows/extraction",
    "frontend/e2e/flows/hitl",
    "frontend/e2e/flows/qa-",
    "frontend/e2e/_fixtures/hitl",
)

EXACT = frozenset(
    {
        "playwright.config.ts",
        "scripts/ci/extraction_pipeline_touched.py",
    }
)


def is_extraction_pipeline(path: str) -> bool:
    path = path.replace("\\", "/")
    if path in EXACT:
        return True
    if path.startswith("backend/alembic/versions/") and "/archive/" not in path:
        name = path.rsplit("/", 1)[-1]
        if "extraction" in name or "hitl" in name:
            return True
    return path.startswith(PREFIXES)


def _git(*args: str) -> str:
    return subprocess.check_output(["git", *args], text=True)


def changed_files() -> list[str] | None:
    """None means the range is unknown — caller must run HITL."""
    event = os.environ.get("GITHUB_EVENT_NAME", "")
    if event == "pull_request":
        base = os.environ.get("GITHUB_BASE_REF") or ""
        if not base:
            return None
        _git("fetch", "--no-tags", "origin", base)
        return [p for p in _git("diff", "--name-only", f"origin/{base}...HEAD").splitlines() if p]
    if event == "push":
        before = os.environ.get("GITHUB_EVENT_BEFORE") or ""
        if not before.strip("0"):
            return None
        return [p for p in _git("diff", "--name-only", before, "HEAD").splitlines() if p]
    return None


def pipeline_touched(files: list[str] | None) -> bool:
    if files is None:
        return True
    return any(is_extraction_pipeline(p) for p in files)


def _self_test() -> None:
    assert is_extraction_pipeline("backend/app/api/v1/endpoints/extraction_runs.py")
    assert is_extraction_pipeline("frontend/e2e/flows/qa-flow.ui.e2e.ts")
    assert is_extraction_pipeline("frontend/components/runs/RunPdfContent.tsx")
    assert is_extraction_pipeline("playwright.config.ts")
    assert not is_extraction_pipeline("frontend/pdf-viewer/primitives/TextLayer.tsx")
    assert not is_extraction_pipeline("frontend/lib/copy/extraction.ts")
    assert not is_extraction_pipeline(".github/workflows/ci.yml")
    assert not pipeline_touched(["frontend/pdf-viewer/primitives/TextLayer.tsx", "CLAUDE.md"])
    assert pipeline_touched(["frontend/hooks/extraction/useFoo.ts"])
    assert pipeline_touched(None)


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        _self_test()
        sys.exit(0)
    sys.exit(0 if pipeline_touched(changed_files()) else 1)
