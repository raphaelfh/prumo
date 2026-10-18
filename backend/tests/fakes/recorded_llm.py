"""The recorded fake adapter for ``app.llm.extractor.StructuredCall``.

Production passes ``extract_structured`` (pydantic-ai); a test passes a
:class:`RecordedLlm`. It answers every model call the AI-extraction pipeline
makes from scripted data, keyed by the prompt that asked:

- field extraction (``section_extraction`` / ``quality_assessment``) answers
  per field NAME from ``fields`` — a dict, or a callable of the :class:`Call`
  so the answer can depend on the prompt (e.g. which entry it is scoped to).
  Defaults follow the field's own result model: a field the script does not
  name answers ``not_found``, or, on an uncertainty scale (its ``status``
  Literal has no ``not_found``), ``ambiguous`` with the scale's own Unclear
  code as the value (the first, when two casings coexist); ``absent_reason``
  is filled with ``None`` wherever the model declares it and the script (or
  default) does not set it;
- entry identification answers ``entries``;
- the verify pass answers ``verdicts`` (field name -> verdict);
- the entailment judge answers ``entailment``.

The reply is validated into the caller's ``output_model``, so a script the
real schema would refuse fails here too. Every call is recorded; ``fail``
makes the calls of one prompt raise instead, and ``during`` runs while a call
is in flight (another session cancelling the run, revoking a membership...).
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal, get_args, get_origin

from pydantic import BaseModel

from app.llm import entailment, verify
from app.llm.extractor import LlmUsage
from app.llm.prompts import entry_identification

#: The field-level answer for a field the script does not name.
NOT_FOUND: dict[str, Any] = {
    "value": None,
    "confidence": 0.0,
    "reasoning": None,
    "evidence": [],
    "status": "not_found",
}

#: Defaults a scripted ``found`` answer is completed with.
_FOUND: dict[str, Any] = {"confidence": 0.9, "reasoning": None, "evidence": [], "status": "found"}


def _literal_codes(annotation: Any) -> list[Any]:
    """Every Literal arg reachable inside ``annotation`` (unions, lists)."""
    if get_origin(annotation) is Literal:
        return list(get_args(annotation))
    return [code for arg in get_args(annotation) for code in _literal_codes(arg)]


def _unclear_value(result_model: type[BaseModel]) -> Any:
    annotation = result_model.model_fields["value"].annotation
    # The first Unclear code in option order, like ``schema.uncertain_code``.
    code = next(
        c for c in _literal_codes(annotation) if isinstance(c, str) and c.casefold() == "unclear"
    )
    is_list = any(get_origin(arg) is list for arg in (annotation, *get_args(annotation)))
    return [code] if is_list else code


def _default_answer(result_model: type[BaseModel]) -> dict[str, Any]:
    """The answer for a field the script does not name, valid for its model."""
    if "not_found" in _literal_codes(result_model.model_fields["status"].annotation):
        return dict(NOT_FOUND)
    return {**NOT_FOUND, "value": _unclear_value(result_model), "status": "ambiguous"}


def _complete(result_model: type[BaseModel], answer: dict[str, Any]) -> dict[str, Any]:
    if "absent_reason" in result_model.model_fields:
        return {"absent_reason": None, **answer}
    return answer


@dataclass(frozen=True)
class Call:
    """One recorded model call."""

    prompt_name: str
    prompt_version: str
    system_prompt: str
    user_prompt: str
    output_model: type[BaseModel]
    model: Any

    @property
    def field_names(self) -> list[str]:
        """The field names (aliases) a field-extraction call asked for."""
        return [f.alias or name for name, f in self.output_model.model_fields.items()]


FieldScript = dict[str, dict[str, Any]] | Callable[[Call], dict[str, dict[str, Any]]]


@dataclass
class RecordedLlm:
    """Scripted, recording stand-in for ``extract_structured``."""

    fields: FieldScript = field(default_factory=dict)
    entries: list[str] = field(default_factory=list)
    verdicts: dict[str, str] = field(default_factory=dict)
    entailment: str = "entailed"
    usage: LlmUsage = field(default_factory=lambda: LlmUsage(prompt_tokens=10, completion_tokens=5))
    #: Per-prompt usage overriding ``usage`` (e.g. a cheaper verify pass).
    usages: dict[str, LlmUsage] = field(default_factory=dict)
    fail: dict[str, BaseException] = field(default_factory=dict)
    during: Callable[[Call], Awaitable[None]] | None = None
    calls: list[Call] = field(default_factory=list)

    async def __call__(
        self,
        *,
        output_model: type[Any],
        system_prompt: str,
        user_prompt: str,
        model: Any,
        prompt_name: str,
        prompt_version: str,
        validators: Sequence[Callable[..., Any]] = (),  # noqa: ARG002 - pydantic-ai only
        output_retries: int = 0,  # noqa: ARG002 - pydantic-ai only
        usage_limits: Any = None,  # noqa: ARG002 - pydantic-ai only
    ) -> tuple[Any, LlmUsage]:
        call = Call(prompt_name, prompt_version, system_prompt, user_prompt, output_model, model)
        self.calls.append(call)
        if self.during is not None:
            await self.during(call)
        if prompt_name in self.fail:
            raise self.fail[prompt_name]
        usage = self.usages.get(prompt_name, self.usage)
        return output_model.model_validate(self._reply(call)), usage

    def prompts(self, prompt_name: str) -> list[str]:
        """The user prompts sent under ``prompt_name``, in call order."""
        return [c.user_prompt for c in self.calls if c.prompt_name == prompt_name]

    def field_calls(self) -> list[Call]:
        """The field-extraction calls (extraction or quality-assessment prompt)."""
        own = {entry_identification.NAME, verify.NAME, entailment.NAME}
        return [c for c in self.calls if c.prompt_name not in own]

    def _reply(self, call: Call) -> dict[str, Any]:
        if call.prompt_name == entry_identification.NAME:
            return {"entries": [{"name": name} for name in self.entries]}
        if call.prompt_name == verify.NAME:
            return {
                "verdicts": [
                    {"field_key": key, "verdict": verdict}
                    for key, verdict in self.verdicts.items()
                    if f"- {key}:" in call.user_prompt
                ]
            }
        if call.prompt_name == entailment.NAME:
            return {"label": self.entailment, "rationale": None}
        script = self.fields(call) if callable(self.fields) else self.fields
        reply: dict[str, Any] = {}
        for attr, info in call.output_model.model_fields.items():
            name = info.alias or attr
            result_model = info.annotation
            answer = {**_FOUND, **script[name]} if name in script else _default_answer(result_model)
            reply[name] = _complete(result_model, answer)
        return reply
