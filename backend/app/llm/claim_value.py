"""Human-readable value rendering for the entailment CLAIM.

A select/multiselect field stores the option CODE (e.g. "Y"), because the
extraction output schema constrains the LLM to ``opt["value"]`` (see
``app.llm.schema._enum_values`` / ``_value_type``). Handing that bare code to
the entailment judge as ``CLAIM: "<field> = Y"`` is near-uninterpretable
against prose, biasing coded select/boolean fields toward ``weak`` /
``unsupported`` regardless of the citation quality. Resolve the code to its
human label ("Yes") before building the claim so the judge can actually assess
entailment.

Numeric / date / text values pass through unchanged so the deterministic
numeric check (``app.llm.value_support.numeric_value_supported``) still sees the
raw number. Pure, no IO.
"""

from __future__ import annotations

from typing import Any


def normalize_options(allowed_values: Any) -> list[Any]:
    """Return the raw option list from an ``allowed_values`` payload.

    Tolerates both shapes the template builder emits: ``{"options": [...]}`` or a
    bare ``[...]``; anything else yields ``[]``. Single source of the shape
    tolerance, shared by ``option_label_map`` here and
    ``app.llm.schema._enum_values`` so a new option encoding is handled once.
    """
    if isinstance(allowed_values, dict) and "options" in allowed_values:
        options = allowed_values["options"]
    elif isinstance(allowed_values, list):
        options = allowed_values
    else:
        return []
    return list(options or [])


def option_label_map(allowed_values: Any) -> dict[str, str]:
    """Map each select option's stored value (code) to its human label.

    Options are ``{"value","label"}`` dicts or plain strings. Plain strings (and
    options without a distinct label) map to themselves, so resolution is a safe
    no-op for label-less templates.
    """
    out: dict[str, str] = {}
    for opt in normalize_options(allowed_values):
        if isinstance(opt, dict) and "value" in opt:
            label = opt.get("label")
            out[str(opt["value"])] = str(label) if label else str(opt["value"])
        elif isinstance(opt, str):
            out[opt] = opt
    return out


def value_str_for_claim(*, field_type: str | None, allowed_values: Any, value: Any) -> str:
    """Render *value* as a human-readable string for the entailment CLAIM.

    - ``bool``            -> "Yes" / "No"
    - ``select``          -> the option's label for the code (fallback: the code)
    - ``multiselect``     -> comma-joined option labels (fallback: each code)
    - everything else     -> ``str(value)`` unchanged (numeric / date / text keep
                             their raw form so the deterministic numeric check
                             still works; ``allow_other`` free text falls through
                             the option map to its raw string).

    Never raises: an unknown shape or a code missing from the option map falls
    back to the raw ``str(value)`` — today's behaviour.
    """
    # bool is a subclass of int, so check it before any numeric handling.
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if field_type in ("select", "multiselect"):
        label_map = option_label_map(allowed_values)
        if isinstance(value, list):
            return ", ".join(label_map.get(str(v), str(v)) for v in value)
        return label_map.get(str(value), str(value))
    return str(value)
