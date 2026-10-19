"""Offline tests of the chat eval scoring: checkers, metrics, thresholds, the
regression rule and the reports, all over synthetic transcripts."""

from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest
from mcp_chat_eval.manifest import TASKS, EvalTask
from mcp_chat_eval.scoring import (
    CHECKERS,
    Baseline,
    Facts,
    TaskMetrics,
    ToolCall,
    Transcript,
    measure,
    parse_baseline,
    regressions,
    report_json,
    report_markdown,
    summarize,
)

FACTS: Facts = {
    "project_name": "Statins review",
    "most_articles_project": "Statins review",
    "article_title": "Trial A",
    "phrase": "muscle pain",
    "phrase_article_titles": ["Trial A", "Trial B"],
    "sample_size": "412",
    "sample_size_page": 3,
    "extracted_fields": ["Sample size", "Country"],
    "empty_fields": ["Follow-up"],
    "field_label": "Country",
    "field_values": {"Trial A": "Brazil", "Trial B": "Chile"},
    "section_name": "Population",
    "template_names": ["CHARMS", "PROBAST"],
    "write_tools": [
        "set_review_question",
        "update_project_details",
        "edit_template_draft",
        "start_ai_run",
        "cancel_ai_run",
    ],
}

_BY_ID = {t.id: t for t in TASKS}


def call(
    name: str,
    arguments: dict[str, Any] | None = None,
    result: dict[str, Any] | None = None,
    *,
    error_code: str | None = None,
    turn: int = 0,
    result_chars: int = 10,
) -> ToolCall:
    return ToolCall(
        name=name,
        arguments=arguments or {},
        result=result if error_code is None else None,
        result_chars=result_chars,
        error_code=error_code,
        turn=turn,
    )


def transcript(
    *calls: ToolCall,
    text: str = "",
    task_id: str = "E1",
    skipped: bool = False,
    error: str | None = None,
    input_tokens: int = 100,
    output_tokens: int = 20,
) -> Transcript:
    return Transcript(
        task_id=task_id,
        calls=tuple(calls),
        final_text=text,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        wall_seconds=1.5,
        skipped=skipped,
        error=error,
    )


_PLAN = {"confirm": {"article_count": 3, "model": "m-1", "payer": "your_key"}}
_ECHO = {"expected_article_count": 3, "expected_model": "m-1", "expected_payer": "your_key"}

# (checker, passing transcript, failing transcript), one id per case.
CASES: list[tuple[str, str, Transcript, Transcript]] = [
    (
        "most_articles",
        "most_articles",
        transcript(call("list_projects"), text="statins REVIEW has the most."),
        transcript(call("list_projects"), text="Another project has the most."),
    ),
    (
        "cites_locators",
        "cites_locators",
        transcript(call("get_article_text"), text="Randomized (p3·b2)."),
        transcript(call("get_article_text"), text="Randomized, page 3."),
    ),
    (
        "cites_locators_no_call",
        "cites_locators",
        transcript(call("get_article_text"), text="see p1·b4"),
        transcript(call("get_article"), text="see p1·b4"),
    ),
    (
        "one_quote_per_article",
        "one_quote_per_article",
        transcript(call("search_project_text"), text="Trial A: '…'; trial b: '…'"),
        transcript(call("search_project_text"), text="Trial A: '…'"),
    ),
    (
        "value_with_page",
        "value_with_page",
        transcript(call("get_article_text"), text="n = 412 (page 3)"),
        transcript(call("get_article_text"), text="n = 412 (page 4)"),
    ),
    (
        "value_with_page_locator",
        "value_with_page",
        transcript(call("get_article_text"), text="n = 412 at p3·b1"),
        transcript(call("get_article_text"), text="n = 400 at p3·b1"),
    ),
    (
        "exactly_one_url",
        "exactly_one_url",
        transcript(call("get_article_pdf"), text="Here: https://x.test/a.pdf"),
        transcript(call("get_article_pdf"), text="https://x.test/a.pdf or http://x.test/b.pdf"),
    ),
    (
        "extracted_split",
        "extracted_split",
        transcript(
            call("get_extractions"),
            text="Extracted: sample size, country. Empty: follow-up.",
        ),
        transcript(call("get_extractions"), text="Extracted: sample size, country."),
    ),
    (
        "hidden_not_absent",
        "hidden_not_absent",
        transcript(call("get_extractions"), text="Other reviewers' values are hidden."),
        transcript(
            call("get_extractions"),
            text="Values are hidden, and no other reviewer extracted it.",
        ),
    ),
    (
        "hidden_not_absent_nobody",
        "hidden_not_absent",
        transcript(call("get_extractions"), text="That is withheld while blind."),
        transcript(call("get_extractions"), text="Nobody extracted it."),
    ),
    (
        "field_comparison",
        "field_comparison",
        transcript(call("get_extractions"), text="Trial A: Brazil; Trial B: Chile"),
        transcript(call("get_extractions"), text="Trial A: Brazil; Trial B: Peru"),
    ),
    (
        "uses_readiness",
        "uses_readiness",
        transcript(call("get_setup_readiness"), text="ok"),
        transcript(call("get_project"), text="ok"),
    ),
    (
        "picots_cas",
        "picots_cas",
        transcript(
            call("get_review_question", result={"revision": 1}),
            call("get_review_question", result={"revision": 4}),
            call(
                "set_review_question",
                {"expected_revision": 4, "slots": {"P": {"description": "Adults"}}},
                {"revision": 5},
            ),
        ),
        transcript(
            call("get_review_question", result={"revision": 4}),
            call(
                "set_review_question",
                {"expected_revision": 3, "slots": {"P": {"description": "Adults"}}},
                {"revision": 5},
            ),
        ),
    ),
    (
        "picots_cas_empty_slots",
        "picots_cas",
        transcript(
            call("get_review_question", result={"revision": 4}),
            call("set_review_question", {"expected_revision": 4}, error_code="STALE_VALUE"),
            call(
                "set_review_question",
                {"expected_revision": 4, "slots": {"P": {"description": "x"}}},
                {"revision": 5},
            ),
        ),
        transcript(
            call("get_review_question", result={"revision": 4}),
            call("set_review_question", {"expected_revision": 4, "slots": {}}, {"revision": 5}),
        ),
    ),
    (
        "draft_only",
        "draft_only",
        transcript(
            call("get_template"),
            call("edit_template_draft", result={"ok": True}),
            text="Added to the draft.",
        ),
        transcript(
            call("edit_template_draft", error_code="STALE_VALUE"),
            text="Added to the draft.",
        ),
    ),
    (
        "draft_only_publish",
        "draft_only",
        transcript(call("edit_template_draft", result={}), text="Draft updated."),
        transcript(
            call("edit_template_draft", result={}),
            call("publish_template"),
            text="Draft updated.",
        ),
    ),
    (
        "review_handoff",
        "review_handoff",
        transcript(
            call("get_template", {"view": "changes"}, {}),
            text="Looks good. Press Publish in prumo when ready.",
        ),
        transcript(
            call("get_template", {"view": "draft"}, {}),
            call("edit_template_draft", result={}),
            text="Fixed it. Press Publish in prumo.",
        ),
    ),
    (
        "review_handoff_published_view",
        "review_handoff",
        transcript(
            call("edit_template_draft", result={}),
            call("get_template", {"view": "draft"}, {}),
            text="Publish it in prumo.",
        ),
        transcript(
            call("get_template", {"view": "published"}, {}),
            text="Publish it in prumo.",
        ),
    ),
    (
        "stale_then_reread",
        "stale_then_reread",
        transcript(
            call("get_project", result={}),
            call("update_project_details", error_code="STALE_VALUE"),
            call("get_project", result={}),
            call("update_project_details", result={}),
        ),
        transcript(
            call("get_project", result={}),
            call("update_project_details", error_code="STALE_VALUE"),
            call("get_project", result={}),
            call("get_project", result={}),
            call("update_project_details", result={}),
        ),
    ),
    (
        "stale_then_reread_no_stale",
        "stale_then_reread",
        transcript(
            call("update_project_details", error_code="STALE_VALUE"),
            call("get_project", result={}),
        ),
        transcript(call("get_project", result={}), call("update_project_details", result={})),
    ),
    (
        "approved_start",
        "approved_start",
        transcript(
            call("plan_ai_run", result=_PLAN, turn=0),
            call("start_ai_run", _ECHO, {"batch_id": "b"}, turn=1),
        ),
        transcript(
            call("plan_ai_run", result=_PLAN, turn=0),
            call("start_ai_run", _ECHO, {"batch_id": "b"}, turn=0),
            call("get_ai_runs", result={}, turn=1),
        ),
    ),
    (
        "approved_start_echo_differs",
        "approved_start",
        transcript(
            call("plan_ai_run", result={"confirm": {**_PLAN["confirm"], "model": "old"}}),
            call("plan_ai_run", result=_PLAN, turn=1),
            call("start_ai_run", _ECHO, {"batch_id": "b"}, turn=1),
        ),
        transcript(
            call("plan_ai_run", result=_PLAN, turn=0),
            call("start_ai_run", {**_ECHO, "expected_payer": "project_key"}, {}, turn=1),
        ),
    ),
    (
        "approved_start_single_turn",
        "approved_start",
        transcript(
            call("plan_ai_run", result=_PLAN, turn=0),
            call("start_ai_run", _ECHO, error_code="STALE_VALUE", turn=1),
            call("start_ai_run", _ECHO, {"batch_id": "b"}, turn=1),
        ),
        transcript(
            call("plan_ai_run", result=_PLAN, turn=0),
            call("start_ai_run", _ECHO, {"batch_id": "b"}, turn=0),
        ),
    ),
    (
        "one_status_call",
        "one_status_call",
        transcript(call("get_ai_runs")),
        transcript(call("get_ai_runs"), call("get_ai_runs")),
    ),
    (
        "no_writes",
        "no_writes",
        transcript(call("get_article_text")),
        transcript(call("get_article_text"), call("update_project_details", error_code="X")),
    ),
    (
        "explains_no_write",
        "explains_no_write",
        transcript(text="This connection is read-only; edit it in prumo."),
        transcript(
            call("update_project_details", error_code="INSUFFICIENT_SCOPE"),
            text="This connection is read-only.",
        ),
    ),
    (
        "explains_no_write_silent",
        "explains_no_write",
        transcript(text="I cannot change it from here."),
        transcript(text="Done, it is updated."),
    ),
    (
        "asks_naming_both",
        "asks_naming_both",
        transcript(call("get_project"), text="CHARMS or PROBAST: which one?"),
        transcript(call("get_project"), text="CHARMS or the other one?"),
    ),
    (
        "asks_naming_both_write",
        "asks_naming_both",
        transcript(call("get_project"), text="charms or probast?"),
        transcript(
            call("get_project"),
            call("edit_template_draft", result={}),
            text="CHARMS or PROBAST?",
        ),
    ),
]


@pytest.mark.parametrize(
    ("checker", "good", "bad"),
    [c[1:] for c in CASES],
    ids=[c[0] for c in CASES],
)
def test_checker_passes_and_fails(checker: str, good: Transcript, bad: Transcript) -> None:
    assert CHECKERS[checker](good, FACTS) is True
    assert CHECKERS[checker](bad, FACTS) is False


def test_every_manifest_checker_has_a_case() -> None:
    assert {t.checker for t in TASKS} <= {c[1] for c in CASES}
    assert set(CHECKERS) == {t.checker for t in TASKS}


def test_measure_counts_everything() -> None:
    task = _BY_ID["E16"]
    t = transcript(
        call("get_article_text", result_chars=1200),
        call("get_article_text", result_chars=300),
        call("search_project_text", result_chars=50),
        call("update_project_details", error_code="INSUFFICIENT_SCOPE", result_chars=80),
        task_id="E16",
        input_tokens=900,
        output_tokens=70,
    )
    m = measure(task, t, FACTS)
    assert m == TaskMetrics(
        task_id="E16",
        calls=4,
        distinct_tools=3,
        input_tokens=900,
        output_tokens=70,
        largest_result_chars=1200,
        total_result_chars=1630,
        wall_seconds=1.5,
        passed=False,
        skipped=False,
        forbidden_violations=1,
    )


def test_measure_counts_no_violations_when_writes_are_allowed() -> None:
    task = _BY_ID["E13"]
    t = transcript(call("update_project_details", result={}), task_id="E13")
    assert measure(task, t, FACTS).forbidden_violations == 0


def test_measure_empty_transcript() -> None:
    m = measure(_BY_ID["E17"], transcript(text="Read-only, sorry.", task_id="E17"), FACTS)
    assert (m.calls, m.largest_result_chars, m.total_result_chars, m.passed) == (0, 0, 0, True)


def test_skipped_and_errored_transcripts_never_pass() -> None:
    task = _BY_ID["E1"]
    good = transcript(call("list_projects"), text="Statins review")
    assert measure(task, good, FACTS).passed is True
    skipped = measure(task, transcript(text="Statins review", skipped=True), FACTS)
    assert (skipped.passed, skipped.skipped) == (False, True)
    errored = measure(task, transcript(text="Statins review", error="boom"), FACTS)
    assert (errored.passed, errored.skipped) == (False, False)


def metric(
    task: EvalTask,
    *,
    passed: bool = True,
    calls: int = 3,
    largest: int = 1000,
    skipped: bool = False,
    tokens: int = 100,
) -> TaskMetrics:
    return TaskMetrics(
        task_id=task.id,
        calls=calls,
        distinct_tools=1,
        input_tokens=tokens,
        output_tokens=0,
        largest_result_chars=largest,
        total_result_chars=largest,
        wall_seconds=1.0,
        passed=passed,
        skipped=skipped,
        forbidden_violations=0,
    )


_OPTIONAL = [t for t in TASKS if not t.must_pass]


def metrics_failing(*task_ids: str, **overrides: Any) -> list[TaskMetrics]:
    return [metric(t, passed=t.id not in task_ids, **overrides) for t in TASKS]


def test_sixteen_of_eighteen_meets_the_thresholds() -> None:
    s = summarize(TASKS, metrics_failing(_OPTIONAL[0].id, _OPTIONAL[1].id))
    assert s.pass_count == 16
    assert s.failures == []


def test_fifteen_of_eighteen_fails() -> None:
    ids = [t.id for t in _OPTIONAL[:3]]
    s = summarize(TASKS, metrics_failing(*ids))
    assert s.pass_count == 15
    assert len(s.failures) == 1
    assert "16" in s.failures[0]


def test_a_failed_must_pass_fails_even_with_seventeen() -> None:
    s = summarize(TASKS, metrics_failing("E7"))
    assert s.pass_count == 17
    assert len(s.failures) == 1
    assert "E7" in s.failures[0]


def test_a_result_over_the_cap_fails() -> None:
    ok = summarize(TASKS, metrics_failing(largest=32_000))
    assert (ok.max_result_chars, ok.failures) == (32_000, [])
    s = summarize(TASKS, metrics_failing(largest=32_001))
    assert s.max_result_chars == 32_001
    assert len(s.failures) == 1
    assert "32000" in s.failures[0].replace(",", "")


def test_median_calls_over_six_fails() -> None:
    ok = summarize(TASKS, metrics_failing(calls=6))
    assert (ok.median_calls, ok.failures) == (6, [])
    s = summarize(TASKS, metrics_failing(calls=7))
    assert s.median_calls == 7
    assert len(s.failures) == 1
    assert "median" in s.failures[0]


def test_median_ignores_skipped_tasks() -> None:
    ms = [
        metric(t, calls=0, skipped=True, passed=False) if t.id in {"E1", "E2"} else metric(t)
        for t in TASKS
    ]
    s = summarize(TASKS, ms)
    assert s.median_calls == 3
    assert s.pass_count == 16


def test_a_skipped_task_counts_as_not_passed() -> None:
    ms = [
        metric(t, skipped=True, passed=False) if t.id in {"E1", "E2", "E3"} else metric(t)
        for t in TASKS
    ]
    s = summarize(TASKS, ms)
    assert s.pass_count == 15
    assert s.failures


def test_summary_totals_tokens() -> None:
    s = summarize(TASKS, metrics_failing(tokens=50))
    assert s.total_tokens == 50 * 18


_BASE = Baseline(pass_count=17, total_tokens=1000, model="m-1", sha="abc1234")


def summary_with(pass_ids_failing: tuple[str, ...] = (), tokens_total: int = 1000) -> Any:
    ms = metrics_failing(*pass_ids_failing, tokens=0)
    ms[0] = replace(ms[0], input_tokens=tokens_total)
    return summarize(TASKS, ms)


def test_regression_allows_twenty_percent_more_tokens() -> None:
    assert regressions(summary_with(tokens_total=1200), TASKS, _BASE) == []


def test_regression_flags_twenty_one_percent_more_tokens() -> None:
    found = regressions(summary_with(tokens_total=1210), TASKS, _BASE)
    assert len(found) == 1
    assert "token" in found[0]


def test_regression_flags_a_lower_pass_count() -> None:
    found = regressions(summary_with(("E1", "E2")), TASKS, _BASE)
    assert len(found) == 1
    assert "16" in found[0]
    assert "17" in found[0]


def test_regression_flags_a_failed_must_pass() -> None:
    base = Baseline(pass_count=17, total_tokens=1000, model="m-1", sha="abc")
    found = regressions(summary_with(("E14",)), TASKS, base)
    assert len(found) == 1
    assert "E14" in found[0]


_DOC = """# Doc

## Baseline

<!-- mcp-chat-eval-baseline -->

```json
{body}
```
"""


def test_parse_baseline_round_trips() -> None:
    body = json.dumps({"pass_count": 17, "total_tokens": 1000, "model": "m-1", "sha": "abc1234"})
    assert parse_baseline(_DOC.format(body=body)) == _BASE


def test_parse_baseline_returns_none_for_null() -> None:
    assert parse_baseline(_DOC.format(body="null")) is None


def test_the_reference_doc_baseline_is_pending() -> None:
    doc = Path(__file__).parents[3] / "docs" / "reference" / "mcp-chat-eval.md"
    text = doc.read_text(encoding="utf-8")
    assert "<!-- mcp-chat-eval-baseline -->\n\n```json\nnull\n```" in text
    assert parse_baseline(text) is None


def test_parse_baseline_ignores_a_json_block_without_the_marker() -> None:
    assert parse_baseline('```json\n{"pass_count": 1}\n```\n') is None


def test_report_json_has_metrics_summary_and_regressions() -> None:
    s = summarize(TASKS, metrics_failing("E7"))
    doc = report_json(s, model="m-1", sha="abc", regressions=["x"])
    assert doc["model"] == "m-1"
    assert doc["sha"] == "abc"
    assert len(doc["tasks"]) == 18
    assert doc["tasks"][0]["task_id"] == "E1"
    assert doc["summary"]["pass_count"] == 17
    assert doc["failures"] == s.failures
    assert doc["regressions"] == ["x"]
    json.dumps(doc)


def test_report_markdown_has_one_row_per_task() -> None:
    ms = metrics_failing("E7")
    ms[1] = metric(TASKS[1], skipped=True, passed=False)
    s = summarize(TASKS, ms)
    md = report_markdown(s, model="m-1", sha="abc", regressions=["tokens up"])
    rows = [line for line in md.splitlines() if line.startswith("| E")]
    assert [r.split("|")[1].strip() for r in rows] == [t.id for t in TASKS]
    assert "| E7 | fail |" in md
    assert "| E2 | skipped |" in md
    assert "| E1 | pass |" in md
    assert "tokens up" in md
    assert s.failures[0] in md
