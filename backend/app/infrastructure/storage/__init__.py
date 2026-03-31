"""
Storage Adapters.

Abstracoes for armazenamento de files.
"""

from app.infrastructure.storage.base import StorageAdapter
from app.infrastructure.storage.supabase_storage import SupabaseStorageAdapter

__all__ = [
    "StorageAdapter",
    "SupabaseStorageAdapter",
]
