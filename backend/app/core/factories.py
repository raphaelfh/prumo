"""
Factory Functions.

Funcoes factory for criacao de dependencias de forma centralizada.
Elimina duplicacao and garante consistencia in the inicializacao de componentes.
"""

from supabase import Client

from app.infrastructure.storage import StorageAdapter, SupabaseStorageAdapter


def create_storage_adapter(supabase: Client) -> StorageAdapter:
    """
    Create StorageAdapter a partir de cliente Supabase.

    Factory centralizada que elimina duplicacao in the criacao
    do adapter de storage em multiplos endpoints.

    Args:
        supabase: Cliente Supabase autenticado.

    Returns:
        StorageAdapter configurado for Supabase.

    Exemplo:
        storage = create_storage_adapter(supabase)
        service = ModelExtractionService(db=db, storage=storage, ...)
    """
    return SupabaseStorageAdapter(supabase)


from app.core.logging import get_logger

_logger = get_logger(__name__)


def create_document_parser(
    settings,
    *,
    project_is_phi: bool,
    api_key_service=None,  # APIKeyService | None — reserved for BYOK resolution
    llama_cloud_key: str | None = None,
):
    """Build a DocumentParser per PARSER_BACKEND with a fail-closed PHI gate.

    Mirrors create_storage_adapter: a single choke point that owns parser
    selection. The PHI gate is the final authority — PHI / unknown projects
    can never receive a cloud backend.

    Args:
        settings: app settings (PARSER_BACKEND, LLAMA_CLOUD_API_KEY).
        project_is_phi: True when the project handles PHI (fail-closed input).
        api_key_service: optional, reserved for future per-user key resolution.
        llama_cloud_key: resolved LlamaCloud key (BYOK > global), or None.

    Returns:
        A DocumentParser instance. Falls back to the self-hosted DoclingParser
        whenever the cloud path is unavailable or forbidden.
    """
    # Lazy imports: the heavy docling/llama_cloud deps must not load at module
    # import time (app boot, tests that never parse).
    from app.infrastructure.parsing.docling_parser import DoclingParser
    from app.infrastructure.parsing.llamaparse_parser import LlamaParseParser

    backend = (getattr(settings, "PARSER_BACKEND", "docling") or "docling").lower()

    if backend == "llamaparse":
        if project_is_phi:
            _logger.info("parser_gate_phi_forced_self_hosted")
            return DoclingParser()
        key = llama_cloud_key or getattr(settings, "LLAMA_CLOUD_API_KEY", None)
        if not key:
            _logger.warning("parser_gate_llamaparse_no_key_fallback_docling")
            return DoclingParser()
        return LlamaParseParser(api_key=key)

    if backend != "docling":
        _logger.warning("parser_gate_unknown_backend_fallback_docling", backend=backend)

    return DoclingParser()
