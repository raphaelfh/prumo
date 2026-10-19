"""The chat eval manifest stays valid against the live MCP registry: every
task names a real checker, real tools and (for E12) a real prompt, and every
turn placeholder is a fact the fixture provides."""

from __future__ import annotations

import importlib
import string

import pytest
from mcp_chat_eval.manifest import TASKS, EvalTask, Interleave
from mcp_chat_eval.scoring import CHECKERS, Facts

from app.api.mcp import server

_BY_ID = {t.id: t for t in TASKS}


def _task(task_id: str) -> EvalTask:
    return _BY_ID[task_id]


def test_manifest_has_eighteen_unique_ids_in_order() -> None:
    assert 15 <= len(TASKS) <= 20
    assert [t.id for t in TASKS] == [f"E{i}" for i in range(1, 19)]


@pytest.mark.parametrize("task", TASKS, ids=[t.id for t in TASKS])
def test_each_task_names_a_known_checker_and_tools(task: EvalTask) -> None:
    assert task.checker in CHECKERS
    assert task.required_tools
    assert task.turns


@pytest.mark.parametrize("task", TASKS, ids=[t.id for t in TASKS])
def test_required_tools_exist_on_the_server(task: EvalTask) -> None:
    importlib.import_module("app.api.mcp.tools")
    assert set(task.required_tools) <= set(server._RULES)


def test_must_pass_set() -> None:
    assert {t.id for t in TASKS if t.must_pass} == {"E7", "E14", "E16", "E17"}


def test_forbids_writes_set() -> None:
    assert {t.id for t in TASKS if t.forbids_writes} == {"E7", "E16", "E17", "E18"}


def test_token_kinds() -> None:
    write_ids = {"E10", "E11", "E12", "E13", "E18"}
    ai_ids = {"E14", "E15"}
    for task in TASKS:
        expected = (
            "read_write" if task.id in write_ids else "ai_run" if task.id in ai_ids else "read"
        )
        assert task.pat == expected, task.id


def test_e14_ends_with_the_scripted_yes() -> None:
    e14 = _task("E14")
    assert e14.pat == "ai_run"
    assert len(e14.turns) >= 2
    assert e14.turns[-1] == "yes"


def test_e17_is_a_read_connection() -> None:
    assert _task("E17").pat == "read"


def test_e12_uses_a_registered_prompt() -> None:
    importlib.import_module("app.api.mcp.prompts")
    e12 = _task("E12")
    assert e12.prompt == "review_draft_before_publishing"
    assert e12.prompt in server._PROMPT_SCOPES


def test_e13_interleaves_a_concurrent_change_after_get_project() -> None:
    interleave = _task("E13").interleave
    assert interleave == Interleave(
        after_tool="get_project", action="concurrent_description_change"
    )
    assert all(t.interleave is None for t in TASKS if t.id != "E13")


def test_only_e12_has_a_prompt() -> None:
    assert [t.id for t in TASKS if t.prompt is not None] == ["E12"]


@pytest.mark.parametrize("task", TASKS, ids=[t.id for t in TASKS])
def test_every_turn_placeholder_is_a_fact(task: EvalTask) -> None:
    facts = set(Facts.__annotations__)
    for turn in task.turns:
        names = {f for _, f, _, _ in string.Formatter().parse(turn) if f}
        assert names <= facts, (task.id, names - facts)
