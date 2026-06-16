"""Guard: the export service carries no stale US1/US2/US3 / NotImplementedError scaffolding."""

from __future__ import annotations

import inspect

from app.services import extraction_export_service as svc


def test_no_stale_scaffolding_text() -> None:
    source = inspect.getsource(svc)
    banned = [
        "NotImplementedError",
        "until US2/US3",
        "US1 = consensus",
        "US1 covers the Consensus branch",
        "used in US2",
        # Stale user-story section banners left over from the staged build.
        "US2 — Single user mode",
        "US3 — All users mode",
    ]
    for needle in banned:
        assert needle not in source, f"stale scaffolding text present: {needle!r}"


def test_exhaustive_mode_guard_present() -> None:
    source = inspect.getsource(svc)
    assert "unhandled export mode" in source
