"""extraction_fields rows → runtime Pydantic output models.

Builds one Pydantic model per chunk of fields. OpenAI strict-mode schemas
allow ~100 properties and each extraction field expands to ~7 (value,
confidence, reasoning, evidence{text, page_number} + the container), so
large UI-built templates are split into multiple calls and merged by the
caller. DB field names are mapped through aliases so any template name —
spaces, parentheses, leading digits — round-trips safely.
"""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, create_model

OPENAI_STRICT_PROPERTY_BUDGET = 100
_PROPERTIES_PER_FIELD = 8  # value, confidence, reasoning, evidence{text,page}, status


class SchemaBuildError(ValueError):
    """A template cannot be turned into an output schema (e.g. duplicate
    field names within one entity type — which would silently drop data)."""


class Evidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(description="Short verbatim quote from the article supporting the value.")
    page_number: int | None = Field(
        description="1-based page number of the quote, null if unknown."
    )


_SCALAR_TYPES: dict[str, type] = {
    "text": str,
    "string": str,
    "date": str,
    "number": float,
    "integer": float,
    "float": float,
    "boolean": bool,
}

_LIST_TYPES = ("array", "list", "multiselect")


def _enum_values(field: Any) -> list[Any]:
    """allowed_values can be {"options": [...]} or [...]; options are
    dicts with a "value" key or plain strings (same tolerance as the
    legacy schema builder)."""
    allowed = getattr(field, "allowed_values", None)
    if isinstance(allowed, dict) and "options" in allowed:
        options = allowed["options"]
    elif isinstance(allowed, list):
        options = allowed
    else:
        return []
    values: list[Any] = []
    for opt in options or []:
        if isinstance(opt, dict) and "value" in opt:
            values.append(opt["value"])
        elif isinstance(opt, str):
            values.append(opt)
    return values


def _description(field: Any) -> str:
    raw = getattr(field, "llm_description", None) or getattr(field, "description", None) or ""
    description = str(raw)
    if getattr(field, "is_required", False):
        hint = "Required field — search the full text before returning null."
        description = f"{description} {hint}".strip() if description else hint
    return description


def _value_type(field: Any) -> Any:
    field_type = getattr(field, "field_type", None) or "text"
    enum_values = _enum_values(field)
    if enum_values:
        literal = Literal[tuple(enum_values)]
        if field_type in _LIST_TYPES:
            return list[literal]
        return literal
    if field_type in _LIST_TYPES:
        return list[str]
    return _SCALAR_TYPES.get(field_type, str)


def _field_result_model(field: Any, index: int) -> type[BaseModel]:
    # Every property is required (nullable where optional) so the schema
    # stays inside the OpenAI strict-mode subset.
    return create_model(
        f"Field{index}Result",
        __config__=ConfigDict(extra="forbid"),
        value=(
            _value_type(field) | None,
            Field(description="The extracted value; null when the article does not contain it."),
        ),
        confidence=(
            float,
            Field(ge=0.0, le=1.0, description="1 = very confident, 0 = not found/uncertain."),
        ),
        reasoning=(
            str | None,
            Field(description="1-2 sentence justification for the value, null if none."),
        ),
        evidence=(
            Evidence | None,
            Field(description="Supporting quote from the article, null if none."),
        ),
        status=(
            Literal["found", "not_found", "ambiguous"],
            Field(
                description=(
                    "found = the value is present and supported by the article; "
                    "not_found = the article does not contain it; "
                    "ambiguous = present but unclear/conflicting."
                ),
            ),
        ),
    )


def build_output_models(entity_type: Any) -> list[type[BaseModel]]:
    """One Pydantic model per chunk of the entity type's fields.

    Returns an empty list when the template has no fields — callers skip
    the LLM call entirely.
    """
    fields = list(getattr(entity_type, "fields", None) or [])
    # Fail closed on duplicate names: extraction_fields has no
    # (entity_type, name) unique constraint, and a silent last-win merge would
    # drop the earlier field's data and could mismap its evidence.
    seen: set[str] = set()
    for field in fields:
        name = str(field.name)
        if name in seen:
            raise SchemaBuildError(
                f"Duplicate field name {name!r} in entity type "
                f"{getattr(entity_type, 'id', '?')}: extraction_fields has no "
                "(entity_type, name) unique constraint; fix the template."
            )
        seen.add(name)
    if not fields:
        return []
    max_fields = max(1, OPENAI_STRICT_PROPERTY_BUDGET // _PROPERTIES_PER_FIELD)
    chunks = [fields[i : i + max_fields] for i in range(0, len(fields), max_fields)]
    models: list[type[BaseModel]] = []
    for chunk_index, chunk in enumerate(chunks):
        definitions: dict[str, Any] = {
            f"field_{index}": (
                _field_result_model(field, index=index),
                Field(alias=str(field.name), description=_description(field)),
            )
            for index, field in enumerate(chunk)
        }
        models.append(
            create_model(
                f"ExtractionChunk{chunk_index}",
                __config__=ConfigDict(extra="forbid"),
                **definitions,
            )
        )
    return models


def dump_extraction(output: BaseModel) -> dict[str, Any]:
    """Typed output → the dict shape ``_create_suggestions`` consumes:
    ``{field_name: {value, confidence, reasoning, evidence}}``."""
    return output.model_dump(by_alias=True)
