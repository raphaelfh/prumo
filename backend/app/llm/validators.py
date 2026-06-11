"""Semantic output validators.

Raising ModelRetry feeds the message back to the model for another
attempt — the structured replacement for the legacy silent-empty-dict
fallback. Pydantic itself already enforces types, enums, and the 0-1
confidence range; these validators cover what a type system cannot."""

from typing import Any

from pydantic_ai import ModelRetry


def evidence_is_plausible(output: Any) -> Any:
    """Reject impossible evidence so it never reaches the database.

    Assumes every field in ``type(output).model_fields`` carries a
    ``field_info.alias`` matching the schema property name the model was
    shown (the ``build_output_models`` convention) — the retry message
    must reference names the model can map back to its schema.
    """
    for field_name, field_info in type(output).model_fields.items():
        label = field_info.alias or field_name
        field_result = getattr(output, field_name)
        evidence = getattr(field_result, "evidence", None)
        if evidence is None:
            continue
        if not evidence.text.strip():
            raise ModelRetry(
                f"Field '{label}': evidence.text must be a non-empty quote from the "
                "article; return null evidence when there is no quote."
            )
        if evidence.page_number is not None and evidence.page_number < 1:
            raise ModelRetry(
                f"Field '{label}': evidence.page_number must be a 1-based page number or null."
            )
    return output
