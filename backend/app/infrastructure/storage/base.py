"""
Base Storage Adapter.

Interface abstrata for adapters de storage.
Permite trocar implementacao (Supabase, S3, local) sem afetar services.
"""

from abc import ABC, abstractmethod
from typing import Any


class StorageAdapter(ABC):
    """
    Interface abstrata for storage de files.

    Implementacoes:
    - SupabaseStorageAdapter: Supabase Storage
    - S3StorageAdapter: AWS S3 (futuro)
    - LocalStorageAdapter: Sistema de files local (dev/testes)
    """

    @abstractmethod
    async def download(self, bucket: str, path: str) -> bytes:
        """
        Faz download de um file.

        Args:
            bucket: Nome do bucket.
            path: Caminho do file in the bucket.

        Returns:
            Conteudo do file em bytes.

        Raises:
            FileNotFoundError: If file does not exist.
            StorageError: On connection/permission error.
        """
        pass

    @abstractmethod
    async def upload(
        self,
        bucket: str,
        path: str,
        data: bytes,
        content_type: str = "application/octet-stream",
    ) -> str:
        """
        Faz upload de um file.

        Args:
            bucket: Nome do bucket.
            path: Caminho de destino in the bucket.
            data: Conteudo do file.
            content_type: MIME type do file.

        Returns:
            URL or path do file criado.

        Raises:
            StorageError: On upload error.
        """
        pass

    @abstractmethod
    async def delete(self, bucket: str, path: str) -> bool:
        """
        Remove um file.

        Args:
            bucket: Nome do bucket.
            path: Caminho do file.

        Returns:
            True if removed, False if it did not exist.
        """
        pass

    @abstractmethod
    async def exists(self, bucket: str, path: str) -> bool:
        """
        Check se file existe.

        Args:
            bucket: Nome do bucket.
            path: Caminho do file.

        Returns:
            True se existe.
        """
        pass

    @abstractmethod
    async def get_public_url(self, bucket: str, path: str) -> str:
        """
        Obtem URL publica do file.

        Args:
            bucket: Nome do bucket.
            path: Caminho do file.

        Returns:
            URL publica for acesso.
        """
        pass

    @abstractmethod
    async def list_files(
        self,
        bucket: str,
        prefix: str = "",
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """
        List files em um bucket/path.

        Args:
            bucket: Nome do bucket.
            prefix: Prefixo for filtrar.
            limit: Maximo de resultados.

        Returns:
            List de metadata of the files.
        """
        pass


class StorageError(Exception):
    """Erro generico de storage."""

    def __init__(self, message: str, bucket: str = "", path: str = ""):
        self.bucket = bucket
        self.path = path
        super().__init__(f"{message} (bucket={bucket}, path={path})")
