"""The provider registry (§1) — the ONLY file that names a provider.

Every layer derives from this tuple: ``build_model``, the catalogue's
provider ids, the key schema validator, the provider metadata the API
returns, the global-key lookup, and the DB CHECK literal on
``user_api_keys.provider`` (asserted equal by a test — adding a provider
is one entry here plus one migration, and forgetting the migration fails
the test).

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

Scope = Literal["user", "project"]


@dataclass(frozen=True)
class ProviderSpec:
    id: str
    label: str
    description: str
    serves: Literal["llm", "parsing"]
    needs_host: bool
    key_optional: bool
    global_key_setting: str | None
    docs_url: str | None
    scopes: frozenset[Scope]


_BOTH: frozenset[Scope] = frozenset({"user", "project"})

REGISTRY: tuple[ProviderSpec, ...] = (
    ProviderSpec(
        id="openai",
        label="OpenAI",
        description="GPT models",
        serves="llm",
        needs_host=False,
        key_optional=False,
        global_key_setting="OPENAI_API_KEY",
        docs_url="https://platform.openai.com/api-keys",
        scopes=_BOTH,
    ),
    ProviderSpec(
        id="anthropic",
        label="Anthropic",
        description="Claude models",
        serves="llm",
        needs_host=False,
        key_optional=False,
        global_key_setting="ANTHROPIC_API_KEY",
        docs_url="https://console.anthropic.com/settings/keys",
        scopes=_BOTH,
    ),
    ProviderSpec(
        id="openai_compatible",
        label="Custom host",
        description="Any OpenAI-compatible server (Ollama, vLLM, LM Studio, OpenRouter)",
        serves="llm",
        needs_host=True,
        key_optional=True,
        global_key_setting=None,
        docs_url=None,
        scopes=_BOTH,
    ),
    ProviderSpec(
        id="llama_cloud",
        label="LlamaCloud",
        description="High-quality cloud PDF parsing (LlamaParse), opt-in per project",
        serves="parsing",
        needs_host=False,
        key_optional=False,
        global_key_setting="LLAMA_CLOUD_API_KEY",
        docs_url="https://cloud.llamaindex.ai",
        scopes=_BOTH,
    ),
)


def get_provider(provider_id: str) -> ProviderSpec | None:
    for spec in REGISTRY:
        if spec.id == provider_id:
            return spec
    return None


def provider_ids() -> tuple[str, ...]:
    return tuple(spec.id for spec in REGISTRY)


def llm_provider_ids() -> tuple[str, ...]:
    return tuple(spec.id for spec in REGISTRY if spec.serves == "llm")


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
