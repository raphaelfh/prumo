"""Canary for scripts/fitness/check_layered_arch.py.

Plants synthetic Python files that import across forbidden layer
boundaries and asserts the check exits 1.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
CHECK = REPO_ROOT / "scripts" / "fitness" / "check_layered_arch.py"
APP = "backend/app"


def _run(tmp_root: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            sys.executable,
            str(CHECK),
            "--repo-root",
            str(tmp_root),
            "--baseline",
            "/dev/null",
        ],
        capture_output=True,
        text=True,
        timeout=15,
    )


def test_fires_on_api_importing_repository(tmp_path: Path) -> None:
    """An api/ file importing from app.repositories.* must fail."""
    f = tmp_path / APP / "api" / "v1" / "endpoints" / "bad.py"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(
        "from fastapi import APIRouter\n"
        "from app.repositories.foo_repo import FooRepo  # forbidden edge\n"
        "router = APIRouter()\n"
    )
    proc = _run(tmp_path)
    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert "app.repositories.foo_repo" in proc.stdout
    assert "api" in proc.stdout


def test_fires_on_api_importing_model(tmp_path: Path) -> None:
    f = tmp_path / APP / "api" / "v1" / "endpoints" / "bad.py"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text("from app.models.foo import FooModel  # forbidden\n")
    proc = _run(tmp_path)
    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert "app.models.foo" in proc.stdout


def test_fires_on_repository_importing_service(tmp_path: Path) -> None:
    f = tmp_path / APP / "repositories" / "bad_repo.py"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text("from app.services.foo_service import FooService  # forbidden\n")
    proc = _run(tmp_path)
    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert "app.services.foo_service" in proc.stdout


def test_clean_when_api_imports_only_services_and_support(tmp_path: Path) -> None:
    f = tmp_path / APP / "api" / "v1" / "endpoints" / "good.py"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(
        "from app.services.foo_service import FooService  # OK\n"
        "from app.core.deps import Db  # OK (support prefix)\n"
        "from app.utils.helpers import h  # OK (support prefix)\n"
        "from app.schemas.common import ApiResponse  # OK (support prefix)\n"
        "from app.domain.errors import FooError  # OK (support prefix)\n"
    )
    proc = _run(tmp_path)
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_clean_when_service_imports_repository_and_models(tmp_path: Path) -> None:
    f = tmp_path / APP / "services" / "good_service.py"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(
        "from app.repositories.foo_repo import FooRepo  # OK\n"
        "from app.models.foo import FooModel  # OK\n"
        "from app.services.other_service import OtherService  # OK (same layer)\n"
    )
    proc = _run(tmp_path)
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_baseline_grandfathers_edge(tmp_path: Path) -> None:
    f = tmp_path / APP / "api" / "v1" / "endpoints" / "legacy.py"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text("from app.models.foo import FooModel  # legacy forbidden\n")
    baseline = tmp_path / "bl"
    baseline.write_text(f"{APP}/api/v1/endpoints/legacy.py:app.models.foo  # why it is legacy\n")
    proc = subprocess.run(
        [
            sys.executable,
            str(CHECK),
            "--repo-root",
            str(tmp_path),
            "--baseline",
            str(baseline),
        ],
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr


# Import forms an earlier collector silently skipped. It reported "OK; 0 edges
# checked" on dev, where the count was really the count of violations.


def _plant(tmp_root: Path, rel: str, body: str) -> None:
    f = tmp_root / APP / rel
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(body)


def test_fires_on_from_app_import_layer(tmp_path: Path) -> None:
    _plant(tmp_path, "api/v1/endpoints/bad.py", "from app import repositories\n")
    proc = _run(tmp_path)
    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert "app.repositories [repositories]" in proc.stdout


def test_fires_on_relative_import_into_repository(tmp_path: Path) -> None:
    """Four dots from app.api.v1.endpoints climb to app."""
    _plant(tmp_path, "api/v1/endpoints/bad.py", "from ....repositories.foo_repo import FooRepo\n")
    proc = _run(tmp_path)
    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert "app.repositories.foo_repo" in proc.stdout


def test_fires_on_package_init(tmp_path: Path) -> None:
    _plant(tmp_path, "api/deps/__init__.py", "from app.repositories.foo_repo import FooRepo\n")
    proc = _run(tmp_path)
    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert f"{APP}/api/deps/__init__.py" in proc.stdout


def test_fires_on_support_module_importing_a_layer(tmp_path: Path) -> None:
    """api -> schemas is allowed, so schemas -> models would launder api -> models."""
    _plant(tmp_path, "schemas/foo.py", "from app.models.foo import FooModel\n")
    proc = _run(tmp_path)
    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert "[support] -> app.models.foo [models]" in proc.stdout


def test_clean_on_relative_import_within_a_layer(tmp_path: Path) -> None:
    _plant(tmp_path, "services/a_service.py", "from .b_service import B\n")
    proc = _run(tmp_path)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "1 edges checked" in proc.stdout


def test_errors_when_no_import_edges_are_collected(tmp_path: Path) -> None:
    """Inspecting nothing is not a pass."""
    _plant(tmp_path, "api/v1/endpoints/x.py", "import os\n")
    proc = _run(tmp_path)
    assert proc.returncode == 2, proc.stdout + proc.stderr
    assert "0 app.* import edges" in proc.stderr


def test_errors_on_a_missing_app_root(tmp_path: Path) -> None:
    proc = _run(tmp_path)
    assert proc.returncode == 2, proc.stdout + proc.stderr


def test_errors_on_an_unclassified_top_level_package(tmp_path: Path) -> None:
    _plant(tmp_path, "gateway/client.py", "from app.repositories.foo_repo import FooRepo\n")
    proc = _run(tmp_path)
    assert proc.returncode == 2, proc.stdout + proc.stderr
    assert "app.gateway" in proc.stderr


def test_errors_on_an_unparsable_file(tmp_path: Path) -> None:
    _plant(tmp_path, "services/ok_service.py", "from app.models.foo import FooModel\n")
    _plant(tmp_path, "api/v1/endpoints/broken.py", "def (:\n")
    proc = _run(tmp_path)
    assert proc.returncode == 2, proc.stdout + proc.stderr
    assert "broken.py" in proc.stderr
