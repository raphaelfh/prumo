"""Credentials → pydantic-ai model instances, driven by the registry.

``build_model`` does what every provider shares — the key ladder's last
rung (a caller's key, else the operator's global key), the host rule (a
host-bearing provider needs a ``base_url``; its key is optional and a
keyless host gets the literal placeholder ``"no-key-required"``) and the
output-mode choice — then hands the resolved credentials to the row's own
``build`` adapter. A parsing provider is not buildable.

``output_mode`` is the connection's probed ``capabilities.output_mode``
when the caller has one (a custom host); otherwise the row's default. It
lands in the model profile, which is where the extractor's Agent reads how
structured output travels — nothing downstream names a provider."""

from pydantic_ai.models import Model

from app.llm.adapters import OutputMode
from app.llm.registry import get_provider, global_key_for


class MissingLLMKeyError(ValueError):
    """No usable API key: neither the caller's nor the global fallback is set."""


def build_model(
    provider: str,
    model_name: str,
    *,
    api_key: str | None = None,
    base_url: str | None = None,
    output_mode: OutputMode | None = None,
) -> Model:
    if not model_name or not model_name.strip():
        raise ValueError("model_name must be a non-empty string.")
    provider = (provider or "openai").lower()
    spec = get_provider(provider)
    if spec is None or spec.build is None or spec.output_mode is None:
        raise ValueError(f"Unsupported LLM provider: {provider!r}")

    mode = output_mode or spec.output_mode
    if spec.needs_host:
        if not base_url:
            raise ValueError(f"{provider} requires a base_url.")
        return spec.build(model_name, api_key or "no-key-required", base_url, mode)

    key = api_key or global_key_for(provider)
    if not key:
        raise MissingLLMKeyError(
            f"No {spec.label} API key available: pass a key or set {spec.global_key_setting}."
        )
    return spec.build(model_name, key, None, mode)
