"""Per-task metrics, v1 thresholds, the regression rule against the committed
baseline and the reports of the chat eval. Pure: stdlib plus the server's own
result cap, so it unit-tests over synthetic transcripts with no model or
server. The checkers live in ``checks``; their types are re-exported here.
"""

from __future__ import annotations

import json
import re
import statistics
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from typing import Any

from app.utils.compact_json import RESULT_CAP
from mcp_chat_eval.checks import CHECKERS, Facts, ToolCall, Transcript
from mcp_chat_eval.manifest import EvalTask

__all__ = [
    "CHECKERS",
    "Baseline",
    "Facts",
    "Summary",
    "TaskMetrics",
    "ToolCall",
    "Transcript",
    "measure",
    "parse_baseline",
    "regressions",
    "report_json",
    "report_markdown",
    "summarize",
]


# --- metrics and thresholds ---------------------------------------------------


@dataclass(frozen=True)
class TaskMetrics:
    task_id: str
    calls: int
    distinct_tools: int
    input_tokens: int
    output_tokens: int
    largest_result_chars: int
    total_result_chars: int
    wall_seconds: float
    passed: bool
    skipped: bool
    forbidden_violations: int


def measure(task: EvalTask, transcript: Transcript, facts: Facts) -> TaskMetrics:
    calls = transcript.calls
    passed = (
        not transcript.skipped
        and transcript.error is None
        and CHECKERS[task.checker](transcript, facts)
    )
    violations = sum(c.name in facts["write_tools"] for c in calls) if task.forbids_writes else 0
    return TaskMetrics(
        task_id=task.id,
        calls=len(calls),
        distinct_tools=len({c.name for c in calls}),
        input_tokens=transcript.input_tokens,
        output_tokens=transcript.output_tokens,
        largest_result_chars=max((c.result_chars for c in calls), default=0),
        total_result_chars=sum(c.result_chars for c in calls),
        wall_seconds=transcript.wall_seconds,
        passed=passed,
        skipped=transcript.skipped,
        forbidden_violations=violations,
    )


MIN_PASS = 16
MAX_MEDIAN_CALLS = 6
TOKEN_GROWTH = 1.2


@dataclass
class Summary:
    metrics: list[TaskMetrics]
    pass_count: int
    total_tokens: int
    median_calls: float
    max_result_chars: int
    failures: list[str]


def _passed(m: TaskMetrics) -> bool:
    return m.passed and not m.skipped


def _failed_must_pass(tasks: Sequence[EvalTask], metrics: Sequence[TaskMetrics]) -> list[str]:
    by_id = {m.task_id: m for m in metrics}
    return [t.id for t in tasks if t.must_pass and not (t.id in by_id and _passed(by_id[t.id]))]


def summarize(tasks: Sequence[EvalTask], metrics: Sequence[TaskMetrics]) -> Summary:
    ran = [m.calls for m in metrics if not m.skipped]
    s = Summary(
        metrics=list(metrics),
        pass_count=sum(_passed(m) for m in metrics),
        total_tokens=sum(m.input_tokens + m.output_tokens for m in metrics),
        median_calls=statistics.median(ran) if ran else 0,
        max_result_chars=max((m.largest_result_chars for m in metrics), default=0),
        failures=[],
    )
    if s.pass_count < MIN_PASS:
        s.failures.append(f"{s.pass_count} of {len(tasks)} tasks passed (need >= {MIN_PASS})")
    missed = _failed_must_pass(tasks, metrics)
    if missed:
        s.failures.append(f"must-pass tasks failed: {', '.join(missed)}")
    if s.max_result_chars > RESULT_CAP:
        s.failures.append(f"largest result is {s.max_result_chars} chars (cap {RESULT_CAP})")
    if s.median_calls > MAX_MEDIAN_CALLS:
        s.failures.append(f"median calls is {s.median_calls} (need <= {MAX_MEDIAN_CALLS})")
    return s


# --- regression against the committed baseline -------------------------------


@dataclass(frozen=True)
class Baseline:
    pass_count: int
    total_tokens: int
    model: str
    sha: str


BASELINE_MARKER = "<!-- mcp-chat-eval-baseline -->"
_BASELINE_BLOCK = re.compile(re.escape(BASELINE_MARKER) + r"\s*```json\s*\n(.*?)\n```", re.DOTALL)


def parse_baseline(markdown: str) -> Baseline | None:
    """The fenced json block right after the marker line; None when it is null."""
    match = _BASELINE_BLOCK.search(markdown)
    if match is None:
        return None
    data = json.loads(match.group(1))
    if data is None:
        return None
    return Baseline(
        pass_count=int(data["pass_count"]),
        total_tokens=int(data["total_tokens"]),
        model=str(data["model"]),
        sha=str(data["sha"]),
    )


def regressions(summary: Summary, tasks: Sequence[EvalTask], baseline: Baseline) -> list[str]:
    found: list[str] = []
    if summary.pass_count < baseline.pass_count:
        found.append(
            f"pass count fell to {summary.pass_count} from the baseline's {baseline.pass_count}"
        )
    missed = _failed_must_pass(tasks, summary.metrics)
    if missed:
        found.append(f"must-pass tasks failed: {', '.join(missed)}")
    if summary.total_tokens > baseline.total_tokens * TOKEN_GROWTH:
        found.append(
            f"total tokens {summary.total_tokens} exceed the baseline's "
            f"{baseline.total_tokens} by more than 20%"
        )
    return found


# --- reports -------------------------------------------------------------------


def report_json(
    summary: Summary, *, model: str, sha: str, regressions: Sequence[str]
) -> dict[str, Any]:
    return {
        "model": model,
        "sha": sha,
        "tasks": [asdict(m) for m in summary.metrics],
        "summary": {
            "pass_count": summary.pass_count,
            "total_tokens": summary.total_tokens,
            "median_calls": summary.median_calls,
            "max_result_chars": summary.max_result_chars,
        },
        "failures": list(summary.failures),
        "regressions": list(regressions),
    }


def _status(m: TaskMetrics) -> str:
    return "skipped" if m.skipped else "pass" if m.passed else "fail"


def report_markdown(summary: Summary, *, model: str, sha: str, regressions: Sequence[str]) -> str:
    lines = [
        f"# MCP chat eval: {model} @ {sha}",
        "",
        "| Task | Result | Calls | Tools | Tokens in | Tokens out "
        "| Largest result | Total result | Seconds | Violations |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    lines += [
        f"| {m.task_id} | {_status(m)} | {m.calls} | {m.distinct_tools} | {m.input_tokens} "
        f"| {m.output_tokens} | {m.largest_result_chars} | {m.total_result_chars} "
        f"| {m.wall_seconds:.1f} | {m.forbidden_violations} |"
        for m in summary.metrics
    ]
    lines += [
        "",
        f"Passed {summary.pass_count} of {len(summary.metrics)}; total tokens "
        f"{summary.total_tokens}; median calls {summary.median_calls}; largest result "
        f"{summary.max_result_chars} chars.",
        "",
        "## Thresholds",
        "",
        *([f"- {f}" for f in summary.failures] or ["- all met"]),
        "",
        "## Regressions",
        "",
        *([f"- {r}" for r in regressions] or ["- none"]),
        "",
    ]
    return "\n".join(lines)
