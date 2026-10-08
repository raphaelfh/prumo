"""The provider registry (§1) — the ONLY file that names a provider.

Every layer derives from this tuple: ``build_model``, the hosted-key probe,
the catalogue's provider ids, the key schema validator, the provider
metadata the API returns, the global-key lookup, and the DB CHECK literals
on ``llm_connections.provider`` and the ``scopes`` CHECK (asserted equal by
``tests/unit/llm/test_llm_connection_model.py`` and
``test_migration_roundtrip.py``) — adding a provider is one entry here, its
adapters in ``app.llm.adapters``, plus one migration, and forgetting
the migration fails both.

Behaviour sits on the row, not in satellite tables keyed by provider id:

* ``llm`` — an :class:`LlmAdapter` for a provider that serves completions,
  ``None`` for one that does not (parsing): its ``build`` turns credentials
  into a pydantic-ai model, and its ``output_mode`` says how structured
  output travels by default — ``native`` (json_schema ``response_format``),
  ``tool`` (tool-calling) or ``prompted``. A custom host's probed
  ``capabilities.output_mode`` overrides it at run time (``build_model``).
* ``probe`` — the cheap authenticated key check (``None`` for a host-bearing
  provider, whose connections run the endpoint ladder instead).

Rules encoded as data, not comments elsewhere:

* Every hosted provider names a global key setting; only a host-bearing
  provider has none (a host is a per-connection fact, there is no
  operator default host).
* Nothing about credentials is stored here: :func:`global_key_for` feeds
  the ``global`` tier of the engine read's ``availability``.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING

from app.core.config import settings
from app.llm import adapters
from app.llm.adapters import Outcome, OutputMode

if TYPE_CHECKING:
    import httpx
    from pydantic_ai.models import Model

ModelBuilder = Callable[[str, str, "str | None", OutputMode], "Model"]
KeyProbe = Callable[["httpx.AsyncClient", str], Awaitable[Outcome]]


@dataclass(frozen=True)
class LlmAdapter:
    """How a completions provider runs: its model builder and its default
    structured-output mode — one record, so a row has both or neither."""

    build: ModelBuilder
    output_mode: OutputMode


@dataclass(frozen=True)
class ProviderSpec:
    id: str
    label: str
    description: str
    needs_host: bool
    key_optional: bool
    global_key_setting: str | None
    docs_url: str | None
    scopes: frozenset[str]
    llm: LlmAdapter | None
    probe: KeyProbe | None


REGISTRY: tuple[ProviderSpec, ...] = (
    ProviderSpec(
        id="openai",
        label="OpenAI",
        description="GPT models",
        needs_host=False,
        key_optional=False,
        global_key_setting="OPENAI_API_KEY",
        docs_url="https://platform.openai.com/api-keys",
        scopes=frozenset({"user", "project"}),
        llm=LlmAdapter(adapters.build_openai, "native"),
        probe=adapters.probe_openai,
    ),
    ProviderSpec(
        id="anthropic",
        label="Anthropic",
        description="Claude models",
        needs_host=False,
        key_optional=False,
        global_key_setting="ANTHROPIC_API_KEY",
        docs_url="https://console.anthropic.com/settings/keys",
        scopes=frozenset({"user", "project"}),
        # no response_format on the Messages API
        llm=LlmAdapter(adapters.build_anthropic, "tool"),
        probe=adapters.probe_anthropic,
    ),
    ProviderSpec(
        id="google",
        label="Google",
        description="Gemini models",
        needs_host=False,
        key_optional=False,
        global_key_setting="GOOGLE_API_KEY",
        docs_url="https://aistudio.google.com/app/apikey",
        scopes=frozenset({"user", "project"}),
        llm=LlmAdapter(adapters.build_google, "native"),
        probe=adapters.probe_google,
    ),
    ProviderSpec(
        id="ollama",
        label="Ollama Cloud",
        description="Open-weight models hosted on ollama.com",
        needs_host=False,
        key_optional=False,
        global_key_setting="OLLAMA_API_KEY",
        docs_url="https://ollama.com/settings/keys",
        scopes=frozenset({"user", "project"}),
        # accepts json_schema, never enforces it
        llm=LlmAdapter(adapters.build_ollama, "tool"),
        probe=adapters.probe_ollama,
    ),
    ProviderSpec(
        id="openai_compatible",
        label="Custom host",
        description="Any OpenAI-compatible server (self-hosted Ollama, vLLM, LM Studio, OpenRouter)",
        needs_host=True,
        key_optional=True,
        global_key_setting=None,
        docs_url=None,
        scopes=frozenset({"user"}),
        # the connection's probed mode overrides this
        llm=LlmAdapter(adapters.build_openai, "native"),
        probe=None,
    ),
    ProviderSpec(
        id="llama_cloud",
        label="LlamaCloud",
        description="High-quality cloud PDF parsing (LlamaParse), opt-in per project",
        needs_host=False,
        key_optional=False,
        global_key_setting="LLAMA_CLOUD_API_KEY",
        docs_url="https://cloud.llamaindex.ai",
        scopes=frozenset({"user", "project"}),
        llm=None,
        probe=adapters.probe_llama_cloud,
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
    return tuple(spec.id for spec in REGISTRY if spec.llm is not None)


def needs_host(provider_id: str) -> bool:
    """Whether ``provider_id`` is host-bearing; an unknown id is not."""
    spec = get_provider(provider_id)
    return spec is not None and spec.needs_host


def global_key_for(provider_id: str) -> str | None:
    """The operator's key for ``provider_id`` in this deployment, or None."""
    spec = get_provider(provider_id)
    if spec is None or spec.global_key_setting is None:
        return None
    value = getattr(settings, spec.global_key_setting, None)
    return value or None
