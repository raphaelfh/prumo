"""Fitness: ``projects.settings`` has one writer.

The column is one JSONB shared by several sub-key owners, and every save
rewrites all of it. ``ProjectRepository.update_settings_key`` is the one place
that reassigns it: it takes the row lock, applies one key's update, and leaves
the sibling keys as it found them. Any other ``<obj>.settings = ...`` in
``app/`` is a second read-modify-write that can drop a concurrent save's key,
so this test fails on it. ``self.settings`` is not a project row and is
ignored. Row locks are not policed here.
"""

from __future__ import annotations

import ast
from collections.abc import Iterator
from pathlib import Path

import pytest

_APP = Path(__file__).parent.parent.parent / "app"
_WRITER = ("repositories/project_repository.py", "ProjectRepository", "update_settings_key")


def _flatten(target: ast.expr) -> Iterator[ast.expr]:
    if isinstance(target, ast.Tuple | ast.List):
        for element in target.elts:
            yield from _flatten(element)
    elif isinstance(target, ast.Starred):
        yield from _flatten(target.value)
    else:
        yield target


class _SettingsAssignments(ast.NodeVisitor):
    """Collects ``(enclosing_scope, line)`` for each assignment to a
    non-``self`` attribute named ``settings``."""

    def __init__(self) -> None:
        self.scope: list[str] = []
        self.found: list[tuple[tuple[str, ...], int]] = []

    def _enter(self, node: ast.ClassDef | ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        self.scope.append(node.name)
        self.generic_visit(node)
        self.scope.pop()

    visit_ClassDef = _enter
    visit_FunctionDef = _enter
    visit_AsyncFunctionDef = _enter

    def _check(self, targets: list[ast.expr], line: int) -> None:
        for target in (t for raw in targets for t in _flatten(raw)):
            if (
                isinstance(target, ast.Attribute)
                and target.attr == "settings"
                and not (isinstance(target.value, ast.Name) and target.value.id == "self")
            ):
                self.found.append((tuple(self.scope), line))

    def visit_Assign(self, node: ast.Assign) -> None:
        self._check(node.targets, node.lineno)
        self.generic_visit(node)

    def visit_AugAssign(self, node: ast.AugAssign) -> None:
        self._check([node.target], node.lineno)
        self.generic_visit(node)

    def visit_AnnAssign(self, node: ast.AnnAssign) -> None:
        if node.value is not None:
            self._check([node.target], node.lineno)
        self.generic_visit(node)


def _assignments(source: str) -> list[tuple[tuple[str, ...], int]]:
    visitor = _SettingsAssignments()
    visitor.visit(ast.parse(source))
    return visitor.found


@pytest.mark.parametrize(
    ("source", "flagged"),
    [
        ("project.settings = {}", True),
        ("row, project.settings = 1, {}", True),
        ("project.settings |= {'parsing': {}}", True),
        ("self.settings = load()", False),
        ("settings = dict(project.settings)", False),
    ],
    ids=["assign", "unpacking", "augmented", "self", "local-name"],
)
def test_the_scan_flags_settings_reassignment(source: str, flagged: bool) -> None:
    assert bool(_assignments(source)) is flagged


def test_projects_settings_has_one_writer() -> None:
    writer_path, *writer_scope = _WRITER
    allowed: list[str] = []
    offenders: list[str] = []
    for py in sorted(_APP.rglob("*.py")):
        rel = py.relative_to(_APP).as_posix()
        for scope, line in _assignments(py.read_text(encoding="utf-8")):
            site = f"{rel}:{line}"
            if rel == writer_path and list(scope) == writer_scope:
                allowed.append(site)
            else:
                offenders.append(site)
    assert not offenders, (
        f"projects.settings reassigned outside ProjectRepository.update_settings_key: "
        f"{offenders}. Write one key through update_settings_key instead."
    )
    # Not vacuous: the scan reaches the one writer it allows.
    assert len(allowed) == 1, allowed
