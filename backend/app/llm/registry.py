"""The provider registry (§1) — the ONLY file that names a provider.

Every layer derives from this tuple: ``build_model``, the catalogue's
provider ids, the key schema validator, the provider metadata the API
returns, the global-key lookup, and the DB CHECK literal on
``user_api_keys.provider``. The CHECK literal computed here is asserted
equal to the registry by a unit test (``tests/unit/llm/test_registry.py``)
AND to the live database constraint by the migration roundtrip suite
(``tests/integration/test_migration_roundtrip.py``) — adding a provider is
one entry here plus one migration, and forgetting the migration fails
both.

Rules encoded as data, not comments elsewhere:

* Every hosted provider names a global key setting; only a host-bearing
  provider has none (a host is a per-connection fact, there is no
  operator default host).
* ``byok_only`` is never stored: :func:`is_byok_only` computes it per
  deployment as "hosted provider whose global setting is empty".
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from app.core.config import settings


@dataclass(frozen=True)
class ProviderSpec:
    id: str
    label: str
    description: str
    serves: Literal["llm", "parsing"]
    needs_host: bool
    global_key_setting: str | None
    docs_url: str | None


REGISTRY: tuple[ProviderSpec, ...] = (
    ProviderSpec(
        id="openai",
        label="OpenAI",
        description="GPT models",
        serves="llm",
        needs_host=False,
        global_key_setting="OPENAI_API_KEY",
        docs_url="https://platform.openai.com/api-keys",
    ),
    ProviderSpec(
        id="anthropic",
        label="Anthropic",
        description="Claude models",
        serves="llm",
        needs_host=False,
        global_key_setting="ANTHROPIC_API_KEY",
        docs_url="https://console.anthropic.com/settings/keys",
    ),
    ProviderSpec(
        id="google",
        label="Google",
        description="Gemini models",
        serves="llm",
        needs_host=False,
        global_key_setting="GOOGLE_API_KEY",
        docs_url="https://aistudio.google.com/app/apikey",
    ),
    ProviderSpec(
        id="openai_compatible",
        label="Custom host",
        description="Any OpenAI-compatible server (Ollama, vLLM, LM Studio, OpenRouter)",
        serves="llm",
        needs_host=True,
        global_key_setting=None,
        docs_url=None,
    ),
    ProviderSpec(
        id="llama_cloud",
        label="LlamaCloud",
        description="High-quality cloud PDF parsing (LlamaParse), opt-in per project",
        serves="parsing",
        needs_host=False,
        global_key_setting="LLAMA_CLOUD_API_KEY",
        docs_url="https://cloud.llamaindex.ai",
    ),
)


def get_provider(provider_id: str) -> ProviderSpec | None:
    return next((spec for spec in REGISTRY if spec.id == provider_id), None)


def storable_providers() -> tuple[ProviderSpec, ...]:
    """Providers a user key can be stored for: the hosted ones.

    A host-bearing provider needs a connection to carry its host; that
    concept arrives with slice 2, so until then it is neither offered nor
    storable. The ONE place that rule lives — schema, service and tests
    all read it from here.
    """
    return tuple(spec for spec in REGISTRY if not spec.needs_host)


# Consumed by app.models.user_api_key (the DB CHECK literal + SUPPORTED_PROVIDERS);
# that module is excluded from the vulture scan ([tool.vulture].exclude), so this
# call site is invisible to the dead-code ratchet even though it is real.
def provider_ids() -> tuple[str, ...]:
    return tuple(spec.id for spec in REGISTRY)


def global_key_for(provider_id: str) -> str | None:
    """The operator's key for ``provider_id`` in this deployment, or None."""
    spec = get_provider(provider_id)
    if spec is None or spec.global_key_setting is None:
        return None
    value = getattr(settings, spec.global_key_setting, None)
    return value or None


def is_byok_only(provider_id: str) -> bool:
    """Hosted provider with no operator key in this deployment."""
    spec = get_provider(provider_id)
    if spec is None or spec.needs_host:
        return False
    return global_key_for(provider_id) is None
