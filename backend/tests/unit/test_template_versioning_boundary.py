"""The ``template_versioning`` package boundary, enforced structurally.

Two facts the package docstring promises, checked against the import graph
of ``app/`` and ``tests/`` rather than remembered:

* its underscore modules are implementation — no module outside the package
  imports them, except the implementation tests named in
  ``IMPLEMENTATION_TESTS``;
* ``template_clone_service`` materializes structure and the package
  publishes it, so the dependency points one way: the clone service never
  imports the package, not even lazily inside a function (the lazy import
  this replaced was the tell for the cycle).
"""

from __future__ import annotations

import ast
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]
APP = BACKEND / "app"
TESTS = BACKEND / "tests"
PACKAGE = "app.services.template_versioning"
PACKAGE_DIR = APP / "services" / "template_versioning"
CLONE_SERVICE = APP / "services" / "template_clone_service.py"

#: Private modules a test may reach, and why. Everything else goes through
#: the package's public API like any other caller.
#:
#: * ``_diff`` / ``_diff_read`` are pure functions: unit-tested directly, and
#:   ``diff_snapshots`` is the equality oracle the round-trip tests assert with.
#: * ``_restore``'s writer edge cases (skip sets, name swaps, era drift) are
#:   reachable through ``discard_draft`` only one composed path at a time.
#: * ``_discard._reraise_if_raced`` classifies a SQLSTATE no live race can
#:   produce on demand.
#: * ``_read`` is monkeypatched to prove the clean-template fast paths never
#:   build a snapshot or run the diff — a cost no public result reveals.
IMPLEMENTATION_TESTS: dict[str, frozenset[str]] = {
    f"{PACKAGE}._diff": frozenset(
        {
            "tests/unit/test_template_diff.py",
            "tests/unit/test_template_diff_read.py",
            "tests/integration/test_template_discard_draft.py",
            "tests/integration/test_template_restore_service.py",
        }
    ),
    f"{PACKAGE}._diff_read": frozenset(
        {
            "tests/unit/test_template_diff_read.py",
            "tests/unit/test_template_diff_fingerprint.py",
        }
    ),
    f"{PACKAGE}._restore": frozenset({"tests/integration/test_template_restore_service.py"}),
    f"{PACKAGE}._discard": frozenset({"tests/unit/test_restrict_violation_sqlstate.py"}),
    f"{PACKAGE}._read": frozenset(
        {
            "tests/integration/test_template_config_diff.py",
            "tests/integration/test_template_config_status.py",
        }
    ),
}


def _imports(path: Path) -> list[tuple[int, str]]:
    """Every (line, module) an import statement in ``path`` reaches, nested ones included."""
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    found: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            found.extend((node.lineno, alias.name) for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            found.append((node.lineno, node.module))
            # ``from app.services.template_versioning import _diff`` reaches the private module too.
            found.extend((node.lineno, f"{node.module}.{alias.name}") for alias in node.names)
    return found


def _private_module(module: str) -> str | None:
    """``module``'s private package module (``PACKAGE._x``), or None."""
    if not module.startswith(f"{PACKAGE}._"):
        return None
    return ".".join(module.split(".")[:4])


def test_private_modules_are_imported_only_inside_the_package() -> None:
    offenders = [
        f"{rel}:{line} imports {module}"
        for path in sorted([*APP.rglob("*.py"), *TESTS.rglob("*.py")])
        if PACKAGE_DIR not in path.parents
        for rel in [path.relative_to(BACKEND).as_posix()]
        for line, module in _imports(path)
        if (private := _private_module(module)) is not None
        and rel not in IMPLEMENTATION_TESTS.get(private, frozenset())
    ]
    assert not offenders, "\n".join(offenders)


def test_every_implementation_test_exception_is_still_used() -> None:
    """A stale allowance would silently re-open the boundary for that file."""
    unused = [
        f"{rel} no longer imports {private}"
        for private, files in IMPLEMENTATION_TESTS.items()
        for rel in sorted(files)
        if not any(_private_module(module) == private for _, module in _imports(BACKEND / rel))
    ]
    assert not unused, "\n".join(unused)


def test_the_package_has_private_modules_to_protect() -> None:
    """Guards the test above against renaming the modules out from under it."""
    private = sorted(p.name for p in PACKAGE_DIR.glob("_*.py"))
    assert private, "template_versioning has no underscore modules left"


def test_clone_service_never_imports_the_versioning_package() -> None:
    offenders = [
        f"template_clone_service.py:{line} imports {module}"
        for line, module in _imports(CLONE_SERVICE)
        if module == PACKAGE or module.startswith(f"{PACKAGE}.")
    ]
    assert not offenders, "\n".join(offenders)
