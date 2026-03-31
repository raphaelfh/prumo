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
