"""Prompt + schema for ``model_extraction_service._identify_models``.

The contract is intentionally narrow: the LLM returns a list of model
**names** identified in the article. Anything richer (modelling method,
target outcome, performance) is captured later by section extraction
against the container's children — not here. That separation keeps this
prompt independent of the template's field naming.
"""
from __future__ import annotations

import json
from typing import Any

# JSON-schema-shaped description of the expected response. Exported in
# case OpenAI's structured-output (json_schema) mode is enabled later;
# today the service uses ``response_format={"type": "json_object"}`` and
# relies on the prompt text + ``parse_models_from_response`` for shape.
MODEL_IDENTIFICATION_RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "models": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": (
                            "A clear, descriptive name for this prediction "
                            "model as it appears in the article (e.g. "
                            '"Multivariable Cox proportional hazards model").'
                        ),
                    },
                },
                "required": ["name"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["models"],
    "additionalProperties": False,
}


class ModelIdentificationPrompt:
    """Build the user-content string for the model-identification call.

    Pure (no I/O, no globals). Callers pass the container label so the
    LLM knows what kind of object to find — the label is sourced from
    the template metadata, not hardcoded here.
    """

    _MAX_PDF_CHARS = 15_000

    @staticmethod
    def build(*, container_label: str, pdf_text: str) -> str:
        return (
            f"Analyze the following scientific article and identify all "
            f"{container_label} described in it. For each one, return a "
            f"clear and descriptive name as it appears in the article.\n\n"
            f"Article text:\n"
            f"{pdf_text[: ModelIdentificationPrompt._MAX_PDF_CHARS]}\n\n"
            f'Respond with a JSON object matching: '
            f'{{"models": [{{"name": "..."}}]}}.\n'
            f'If no models are found, return: {{"models": []}}.'
        )


def parse_models_from_response(content: str) -> list[dict[str, Any]]:
    """Normalize the LLM JSON into ``[{name: str, ...}, ...]``.

    Tolerates the legacy ``model_name`` key for snapshots stored before
    the prompt-decoupling refactor. After all callers are on the new
    prompt, the legacy fallback can be dropped.
    """
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        return []
    raw = data.get("models") if isinstance(data, dict) else None
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for m in raw:
        if not isinstance(m, dict):
            continue
        name = m.get("name") or m.get("model_name")
        if not name:
            continue
        normalized = dict(m)
        normalized["name"] = name
        out.append(normalized)
    return out
