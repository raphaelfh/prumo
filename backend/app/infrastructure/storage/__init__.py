"""
Storage Adapters.

Abstrações para armazenamento de arquivos.
"""

from app.infrastructure.storage.base import StorageAdapter
from app.infrastructure.storage.supabase_storage import SupabaseStorageAdapter

__all__ = [
    "StorageAdapter",
    "SupabaseStorageAdapter",
]
