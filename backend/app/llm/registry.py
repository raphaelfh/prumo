"""The provider registry (§1) — the ONLY file that names a provider.

Every layer derives from this tuple: ``build_model``, the catalogue's
provider ids, the key schema validator, the provider metadata the API
returns, the global-key lookup, and the DB CHECK literals on
``llm_connections.provider`` and the ``scopes`` CHECK (asserted equal by
``tests/unit/llm/test_llm_connection_model.py`` and
``test_migration_roundtrip.py``) — adding a provider is one entry here
plus one migration, and forgetting the migration fails both.

Rules encoded as data, not comments elsewhere:

* Every hosted provider names a global key setting; only a host-bearing
  provider has none (a host is a per-connection fact, there is no
  operator default host).
* Nothing about credentials is stored here: :func:`global_key_for` feeds
  the ``global`` tier of the engine read's ``availability``.
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
    key_optional: bool
    global_key_setting: str | None
    docs_url: str | None
    scopes: frozenset[str]


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
        scopes=frozenset({"user", "project"}),
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
        scopes=frozenset({"user", "project"}),
    ),
    ProviderSpec(
        id="google",
        label="Google",
        description="Gemini models",
        serves="llm",
        needs_host=False,
        key_optional=False,
        global_key_setting="GOOGLE_API_KEY",
        docs_url="https://aistudio.google.com/app/apikey",
        scopes=frozenset({"user", "project"}),
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
        scopes=frozenset({"user"}),
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
        scopes=frozenset({"user", "project"}),
    ),
)


def get_provider(provider_id: str) -> ProviderSpec | None:
    return next((spec for spec in REGISTRY if spec.id == provider_id), None)


# Consumed by app.models.llm_connection (the CHECK literals); that module is
# excluded from the vulture scan ([tool.vulture].exclude), so this call site is
# invisible to the ratchet even though it is real.
def provider_ids() -> tuple[str, ...]:
    return tuple(spec.id for spec in REGISTRY)


def llm_provider_ids() -> tuple[str, ...]:
    """Registry-order ids of providers that serve LLM completions.

    Excludes ``llama_cloud`` (a parsing-only provider): the catalogue and
    anything else picker-shaped iterates this, not ``provider_ids``.
    """
    return tuple(spec.id for spec in REGISTRY if spec.serves == "llm")


def global_key_for(provider_id: str) -> str | None:
    """The operator's key for ``provider_id`` in this deployment, or None."""
    spec = get_provider(provider_id)
    if spec is None or spec.global_key_setting is None:
        return None
    value = getattr(settings, spec.global_key_setting, None)
    return value or None
