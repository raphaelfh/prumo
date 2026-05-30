"""Pure mapping from a feedback report to Linear issue fields."""

from typing import Any

# Linear native priority: 0 none, 1 urgent, 2 high, 3 medium, 4 low.
_PRIORITY_BY_SEVERITY = {"critical": 1, "high": 2, "medium": 3, "low": 4}

# Feedback type -> Linear label name. 'other' intentionally has no type label.
_TYPE_LABEL = {"bug": "Bug", "suggestion": "Feature", "question": "Question"}

SOURCE_LABEL = "source:in-app"

# Ordered route-substring -> area label. First match wins.
_AREA_RULES: list[tuple[str, str]] = [
    ("/pdf", "area:pdf"),
    ("/extraction", "area:extraction"),
    ("/quality", "area:extraction"),
    ("/settings", "area:ui-ux"),
    ("/members", "area:multi-user"),
    ("/team", "area:multi-user"),
]


def priority_for(severity: str | None) -> int:
    return _PRIORITY_BY_SEVERITY.get(severity or "", 0)


def area_label_for(route: str | None) -> str | None:
    if not route:
        return None
    for needle, label in _AREA_RULES:
        if needle in route:
            return label
    return None


def label_names_for(report: Any) -> list[str]:
    names = [SOURCE_LABEL]
    type_label = _TYPE_LABEL.get(report.type)
    if type_label:
        names.append(type_label)
    area = area_label_for(report.route)
    if area:
        names.append(area)
    return names


def issue_title(report: Any) -> str:
    if report.summary:
        return report.summary
    snippet = " ".join(report.description.split())[:80]
    return f"[{report.type.capitalize()}] {snippet}"


def issue_body(report: Any) -> str:
    vp = report.viewport_size or {}
    vp_str = f"{vp.get('width', '?')}×{vp.get('height', '?')}" if vp else "—"
    lines = [
        report.description.strip(),
        "",
        "---",
        "**Context**",
        f"- Report id: `{report.id}`",
        f"- Type / severity: {report.type} / {report.severity or '—'}",
        f"- URL: {report.url or '—'}",
        f"- Route: {report.route or '—'}",
        f"- Project: {report.project_id or '—'}",
        f"- Article: {report.article_id or '—'}",
        f"- App version: {report.app_version or '—'}",
        f"- Viewport: {vp_str}",
        f"- User agent: {report.user_agent or '—'}",
    ]
    return "\n".join(lines)


def attachments_markdown(attachments: list[Any]) -> str:
    parts: list[str] = []
    for att in attachments:
        if not att.linear_asset_url:
            continue
        if att.kind == "image":
            parts.append(f"![]({att.linear_asset_url})")
        else:
            parts.append(f"[Screen recording]({att.linear_asset_url})")
    if not parts:
        return ""
    return "\n\n---\n**Attachments**\n\n" + "\n\n".join(parts)
