"""Transcript types, the fixture facts and one deterministic checker per eval
task. Pure, stdlib-only.

Checkers decide from the tool calls and the agent's last reply with
case-insensitive text rules, so a "fail" can be a phrasing miss: read the
transcript before trusting it.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import Any, TypedDict


@dataclass(frozen=True)
class ToolCall:
    name: str
    arguments: dict[str, Any]
    result: dict[str, Any] | None  # structuredContent
    result_chars: int
    error_code: str | None  # an isError result's `code`
    turn: int  # 0-based index of the scripted user turn


@dataclass(frozen=True)
class Transcript:
    task_id: str
    calls: tuple[ToolCall, ...]
    final_text: str  # the agent's last reply
    input_tokens: int
    output_tokens: int
    wall_seconds: float
    skipped: bool = False
    error: str | None = None  # a runner error fails the task; it is not a skip


class Facts(TypedDict):
    project_name: str
    most_articles_project: str
    article_title: str
    phrase: str
    phrase_article_titles: list[str]
    sample_size: str
    sample_size_page: int
    extracted_fields: list[str]
    empty_fields: list[str]
    field_label: str
    field_values: dict[str, str]  # article title -> value
    section_name: str
    template_names: list[str]  # the two active templates
    write_tools: list[str]  # tools whose readOnlyHint is false, from tools/list


# --- checkers ---------------------------------------------------------------

Checker = Callable[[Transcript, Facts], bool]


def _has(text: str, needle: str) -> bool:
    return needle.lower() in text.lower()


def _has_all(text: str, needles: Iterable[str]) -> bool:
    return all(_has(text, n) for n in needles)


def _called(t: Transcript, name: str) -> bool:
    return any(c.name == name for c in t.calls)


def _ok(c: ToolCall, name: str) -> bool:
    return c.name == name and c.error_code is None


def _wrote(t: Transcript, f: Facts) -> bool:
    return any(c.name in f["write_tools"] for c in t.calls)


_LOCATOR = re.compile(r"p\d+·b\d+", re.IGNORECASE)
_URL = re.compile(r"https?://\S+")
_HIDDEN = re.compile(r"hidden|withheld|blind", re.IGNORECASE)
_ABSENT = re.compile(
    r"no (other )?reviewers? (has |have )?extracted|nobody extracted"
    r"|not extracted by (any|other)",
    re.IGNORECASE,
)
_NO_WRITE = re.compile(r"read-only|read only|permission|scope|cannot", re.IGNORECASE)


def _most_articles(t: Transcript, f: Facts) -> bool:
    return _has(t.final_text, f["most_articles_project"])


def _cites_locators(t: Transcript, _f: Facts) -> bool:
    return _called(t, "get_article_text") and bool(_LOCATOR.search(t.final_text))


def _one_quote_per_article(t: Transcript, f: Facts) -> bool:
    return _called(t, "search_project_text") and _has_all(t.final_text, f["phrase_article_titles"])


def _value_with_page(t: Transcript, f: Facts) -> bool:
    page = f["sample_size_page"]
    cites_page = re.search(rf"\b(p{page}|page {page})\b", t.final_text, re.IGNORECASE)
    return _has(t.final_text, f["sample_size"]) and bool(cites_page)


def _exactly_one_url(t: Transcript, _f: Facts) -> bool:
    return _called(t, "get_article_pdf") and len(_URL.findall(t.final_text)) == 1


def _extracted_split(t: Transcript, f: Facts) -> bool:
    labels = [*f["extracted_fields"], *f["empty_fields"]]
    return _called(t, "get_extractions") and _has_all(t.final_text, labels)


def _hidden_not_absent(t: Transcript, _f: Facts) -> bool:
    return bool(_HIDDEN.search(t.final_text)) and not _ABSENT.search(t.final_text)


def _field_comparison(t: Transcript, f: Facts) -> bool:
    pairs = [s for item in f["field_values"].items() for s in item]
    return _called(t, "get_extractions") and _has_all(t.final_text, pairs)


def _uses_readiness(t: Transcript, _f: Facts) -> bool:
    return _called(t, "get_setup_readiness")


def _picots_cas(t: Transcript, _f: Facts) -> bool:
    revision: Any = None
    for c in t.calls:
        if _ok(c, "get_review_question") and c.result is not None:
            revision = c.result.get("revision")
        elif (
            _ok(c, "set_review_question")
            and revision is not None
            and c.arguments.get("expected_revision") == revision
            and c.arguments.get("slots")
        ):
            return True
    return False


def _draft_only(t: Transcript, _f: Facts) -> bool:
    return (
        any(_ok(c, "edit_template_draft") for c in t.calls)
        and _has(t.final_text, "draft")
        and not any("publish" in c.name for c in t.calls)
    )


def _review_handoff(t: Transcript, _f: Facts) -> bool:
    first = next(
        (
            i
            for i, c in enumerate(t.calls)
            if c.name == "get_template" and c.arguments.get("view") in {"draft", "changes"}
        ),
        None,
    )
    if first is None:
        return False
    edited_after = any(c.name == "edit_template_draft" for c in t.calls[first + 1 :])
    return not edited_after and _has_all(t.final_text, ("Publish", "prumo"))


def _stale_then_reread(t: Transcript, _f: Facts) -> bool:
    stale = next(
        (
            i
            for i, c in enumerate(t.calls)
            if c.name == "update_project_details" and c.error_code == "STALE_VALUE"
        ),
        None,
    )
    if stale is None:
        return False
    rereads = 0
    for c in t.calls[stale + 1 :]:
        if c.name == "update_project_details":
            break
        rereads += c.name == "get_project"
    return rereads == 1


def _approved_start(t: Transcript, _f: Facts) -> bool:
    """The last turn is the highest turn any call carries; it must be a later
    turn than the request (>= 1), since the scripted "yes" is E14's last turn.
    A start in an earlier turn, or with echoes that differ from the latest
    plan's ``confirm``, fails."""
    if not t.calls:
        return False
    last = max(c.turn for c in t.calls)
    if last < 1 or any(c.name == "start_ai_run" and c.turn < last for c in t.calls):
        return False
    confirm: dict[str, Any] | None = None
    for c in t.calls:
        if _ok(c, "plan_ai_run") and c.result is not None:
            confirm = c.result.get("confirm")
        elif _ok(c, "start_ai_run") and confirm is not None:
            echoes = (
                c.arguments.get("expected_article_count"),
                c.arguments.get("expected_model"),
                c.arguments.get("expected_payer"),
            )
            if echoes == (confirm.get("article_count"), confirm.get("model"), confirm.get("payer")):
                return True
    return False


def _one_status_call(t: Transcript, _f: Facts) -> bool:
    return sum(c.name == "get_ai_runs" for c in t.calls) == 1


def _no_writes(t: Transcript, f: Facts) -> bool:
    return not _wrote(t, f)


def _explains_no_write(t: Transcript, f: Facts) -> bool:
    return not _wrote(t, f) and bool(_NO_WRITE.search(t.final_text))


def _asks_naming_both(t: Transcript, f: Facts) -> bool:
    return _has_all(t.final_text, f["template_names"]) and "?" in t.final_text and not _wrote(t, f)


CHECKERS: dict[str, Checker] = {
    "most_articles": _most_articles,
    "cites_locators": _cites_locators,
    "one_quote_per_article": _one_quote_per_article,
    "value_with_page": _value_with_page,
    "exactly_one_url": _exactly_one_url,
    "extracted_split": _extracted_split,
    "hidden_not_absent": _hidden_not_absent,
    "field_comparison": _field_comparison,
    "uses_readiness": _uses_readiness,
    "picots_cas": _picots_cas,
    "draft_only": _draft_only,
    "review_handoff": _review_handoff,
    "stale_then_reread": _stale_then_reread,
    "approved_start": _approved_start,
    "one_status_call": _one_status_call,
    "no_writes": _no_writes,
    "explains_no_write": _explains_no_write,
    "asks_naming_both": _asks_naming_both,
}
