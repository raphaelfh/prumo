"""Canary for scripts/fitness/check_api_response_envelope.py.

Plants a synthetic endpoint with `-> dict` (or no annotation) in a temp repo
root and asserts the check exits 1. Without this, a future change that breaks
the AST walker would lie green.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
CHECK = REPO_ROOT / "scripts" / "fitness" / "check_api_response_envelope.py"
ENDPOINTS_REL = "backend/app/api/v1/endpoints"

_GOOD = (
    "from fastapi import APIRouter\n"
    "from app.schemas.common import ApiResponse\n"
    "router = APIRouter()\n"
    "\n"
    "@router.get('/health')\n"
    "async def health() -> ApiResponse[HealthResp]:\n"
    "    return ApiResponse(data=HealthResp())\n"
)


def _run(tmp_root: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(CHECK), "--repo-root", str(tmp_root), "--baseline", "/dev/null"],
        capture_output=True,
        text=True,
        timeout=15,
    )


def test_fires_on_raw_dict_return(tmp_path: Path) -> None:
    """Endpoint returning `dict` must fail."""
    f = tmp_path / ENDPOINTS_REL / "bad.py"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(
        "from fastapi import APIRouter\n"
        "router = APIRouter()\n"
        "\n"
        "@router.get('/bad')\n"
        "async def bad() -> dict:\n"
        "    return {}\n"
    )
    proc = _run(tmp_path)
    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert "wrong_envelope" in proc.stdout
    assert "bad.py" in proc.stdout


def test_fires_on_missing_annotation(tmp_path: Path) -> None:
    """Endpoint without return annotation must fail."""
    f = tmp_path / ENDPOINTS_REL / "missing.py"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(
        "from fastapi import APIRouter\n"
        "router = APIRouter()\n"
        "\n"
        "@router.get('/missing')\n"
        "async def missing():\n"
        "    return {}\n"
    )
    proc = _run(tmp_path)
    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert "no_annotation" in proc.stdout


def test_clean_on_apiresponse_only(tmp_path: Path) -> None:
    """All endpoints returning ApiResponse[T] => exit 0."""
    f = tmp_path / ENDPOINTS_REL / "good.py"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(_GOOD)
    proc = _run(tmp_path)
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_non_router_decorator_ignored(tmp_path: Path) -> None:
    """A bare `def foo() -> dict` (no router decorator) is not an endpoint."""
    f = tmp_path / ENDPOINTS_REL / "helper.py"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(
        "def utility() -> dict:\n    return {}\n\n"
        "@some_other_decorator\n"
        "def also_not_an_endpoint() -> int:\n    return 1\n"
    )
    proc = _run(tmp_path)
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_baseline_grandfathers_violation(tmp_path: Path) -> None:
    """A violation listed in the baseline file does not fail the gate."""
    f = tmp_path / ENDPOINTS_REL / "legacy.py"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(
        "from fastapi import APIRouter\n"
        "router = APIRouter()\n"
        "\n"
        "@router.get('/legacy')\n"
        "async def old_endpoint() -> dict:\n"
        "    return {}\n"
    )
    baseline = tmp_path / "bl.baseline"
    baseline.write_text(f"{ENDPOINTS_REL}/legacy.py:old_endpoint\n")
    proc = subprocess.run(
        [sys.executable, str(CHECK), "--repo-root", str(tmp_path), "--baseline", str(baseline)],
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr


# ============================================================
# Union / Optional acceptance (extended matcher)
# ============================================================


def test_accepts_pep604_union_with_apiresponse_arm(tmp_path: Path) -> None:
    """`Response | ApiResponse[T]` (PEP 604 union) must be accepted —
    legitimate when an endpoint can return either a streaming binary
    Response or an envelope (e.g. articles_export.py:start_export).
    """
    f = tmp_path / ENDPOINTS_REL / "union_pep604.py"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(
        "from fastapi import APIRouter, Response\n"
        "from app.schemas.common import ApiResponse\n"
        "router = APIRouter()\n"
        "\n"
        "@router.post('/export')\n"
        "async def export() -> Response | ApiResponse[MyResp]:\n"
        "    return Response()\n"
    )
    proc = _run(tmp_path)
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_accepts_typing_union_with_apiresponse_arm(tmp_path: Path) -> None:
    """Legacy `Union[Response, ApiResponse[T]]` must also be accepted."""
    f = tmp_path / ENDPOINTS_REL / "union_typing.py"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(
        "from typing import Union\n"
        "from fastapi import APIRouter, Response\n"
        "from app.schemas.common import ApiResponse\n"
        "router = APIRouter()\n"
        "\n"
        "@router.post('/export')\n"
        "async def export() -> Union[Response, ApiResponse[MyResp]]:\n"
        "    return Response()\n"
    )
    proc = _run(tmp_path)
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_accepts_optional_apiresponse(tmp_path: Path) -> None:
    """`Optional[ApiResponse[T]]` (== ApiResponse[T] | None) is accepted."""
    f = tmp_path / ENDPOINTS_REL / "opt.py"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(
        "from typing import Optional\n"
        "from fastapi import APIRouter\n"
        "from app.schemas.common import ApiResponse\n"
        "router = APIRouter()\n"
        "\n"
        "@router.get('/maybe')\n"
        "async def maybe() -> Optional[ApiResponse[MyResp]]:\n"
        "    return None\n"
    )
    proc = _run(tmp_path)
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_rejects_union_without_apiresponse_arm(tmp_path: Path) -> None:
    """A union where NO arm is ApiResponse must still fail (the matcher
    isn't permissive — it only excuses unions when at least one arm is
    the envelope)."""
    f = tmp_path / ENDPOINTS_REL / "union_bad.py"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(
        "from fastapi import APIRouter, Response\n"
        "router = APIRouter()\n"
        "\n"
        "@router.post('/raw')\n"
        "async def raw() -> Response | dict:\n"
        "    return {}\n"
    )
    proc = _run(tmp_path)
    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert "wrong_envelope" in proc.stdout


# ============================================================
# Weak-payload rejection (the 2026-05-20-0200 tightening)
# ============================================================


def test_rejects_apiresponse_with_dict_payload(tmp_path: Path) -> None:
    """ApiResponse[dict] gives consumers no schema — must fail."""
    f = tmp_path / ENDPOINTS_REL / "weak1.py"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(
        "from fastapi import APIRouter\n"
        "from app.schemas.common import ApiResponse\n"
        "router = APIRouter()\n"
        "\n"
        "@router.get('/weak')\n"
        "async def weak() -> ApiResponse[dict]:\n"
        "    return ApiResponse(data={})\n"
    )
    proc = _run(tmp_path)
    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert "wrong_envelope" in proc.stdout
    assert "dict" in proc.stdout


def test_rejects_apiresponse_with_parametric_dict(tmp_path: Path) -> None:
    """ApiResponse[dict[str, Any]] is equally weak."""
    f = tmp_path / ENDPOINTS_REL / "weak2.py"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(
        "from typing import Any\n"
        "from fastapi import APIRouter\n"
        "from app.schemas.common import ApiResponse\n"
        "router = APIRouter()\n"
        "\n"
        "@router.get('/weak')\n"
        "async def weak() -> ApiResponse[dict[str, Any]]:\n"
        "    return ApiResponse(data={})\n"
    )
    proc = _run(tmp_path)
    assert proc.returncode == 1, proc.stdout + proc.stderr


def test_rejects_apiresponse_with_any_payload(tmp_path: Path) -> None:
    """ApiResponse[Any] — explicit Any is the strongest wildcard signal."""
    f = tmp_path / ENDPOINTS_REL / "weak3.py"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(
        "from typing import Any\n"
        "from fastapi import APIRouter\n"
        "from app.schemas.common import ApiResponse\n"
        "router = APIRouter()\n"
        "\n"
        "@router.get('/weak')\n"
        "async def weak() -> ApiResponse[Any]:\n"
        "    return ApiResponse(data=None)\n"
    )
    proc = _run(tmp_path)
    assert proc.returncode == 1, proc.stdout + proc.stderr


def test_accepts_apiresponse_with_concrete_model(tmp_path: Path) -> None:
    """The complement: a non-weak T must still be accepted."""
    f = tmp_path / ENDPOINTS_REL / "strong.py"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(
        "from fastapi import APIRouter\n"
        "from app.schemas.common import ApiResponse\n"
        "router = APIRouter()\n"
        "\n"
        "@router.get('/strong')\n"
        "async def strong() -> ApiResponse[MyConcreteResponse]:\n"
        "    return ApiResponse(data=MyConcreteResponse())\n"
    )
    proc = _run(tmp_path)
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_accepts_apiresponse_with_list_of_concrete_model(tmp_path: Path) -> None:
    """`list[Model]` is parametric but still strong — accepted."""
    f = tmp_path / ENDPOINTS_REL / "strong_list.py"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(
        "from fastapi import APIRouter\n"
        "from app.schemas.common import ApiResponse\n"
        "router = APIRouter()\n"
        "\n"
        "@router.get('/strong')\n"
        "async def strong() -> ApiResponse[list[ItemModel]]:\n"
        "    return ApiResponse(data=[])\n"
    )
    proc = _run(tmp_path)
    assert proc.returncode == 0, proc.stdout + proc.stderr
