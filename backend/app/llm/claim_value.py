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


def _option_item(item: Any) -> dict[str, str] | None:
    if isinstance(item, str):
        text = item.strip()
        return {"value": item, "label": item} if text else None
    if isinstance(item, dict):
        value, label = item.get("value"), item.get("label")
    elif hasattr(item, "value") or hasattr(item, "label"):
        value, label = getattr(item, "value", None), getattr(item, "label", None)
    else:
        return None
    if value:
        return {"value": str(value), "label": str(label) if label else str(value)}
    if label:
        return {"value": str(label), "label": str(label)}
    return None


def normalize_options(allowed_values: Any) -> list[dict[str, str]]:
    """The one reader of a field's options: any stored shape (bare strings,
    ``{"options": [...]}``, ``{value[, label]}`` dicts, or ``OptionItem``s) →
    canonical ``[{"value", "label"}]``. Frozen snapshots keep their legacy
    shapes; read them through here.

    A label-less option reads its value as its label; a value-less one reads
    its label as its value. Anything else (``None``, numbers, empty strings or
    dicts) is skipped; order is preserved.
    """
    if isinstance(allowed_values, dict) and "options" in allowed_values:
        options = allowed_values["options"]
    elif isinstance(allowed_values, list):
        options = allowed_values
    else:
        return []
    if not isinstance(options, list):
        return []
    return [opt for opt in map(_option_item, options) if opt is not None]


def option_label_map(allowed_values: Any) -> dict[str, str]:
    """Map each select option's stored value (code) to its human label."""
    return {o["value"]: o["label"] for o in normalize_options(allowed_values)}


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
