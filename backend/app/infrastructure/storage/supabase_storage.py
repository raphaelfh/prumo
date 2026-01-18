"""
Supabase Storage Adapter.

Implementação do StorageAdapter para Supabase Storage.
Gerencia PDFs e outros arquivos de artigos.
"""

from typing import Any

from supabase import Client

from app.core.logging import LoggerMixin
from app.infrastructure.storage.base import StorageAdapter, StorageError


class SupabaseStorageAdapter(StorageAdapter, LoggerMixin):
    """
    Adapter para Supabase Storage.
    
    Encapsula todas as operações de storage do Supabase.
    
    Usage:
        adapter = SupabaseStorageAdapter(supabase_client)
        pdf_bytes = await adapter.download("articles", "project-1/article.pdf")
    """
    
    def __init__(self, client: Client):
        """
        Inicializa adapter com cliente Supabase.
        
        Args:
            client: Cliente Supabase autenticado.
        """
        self.client = client
    
    async def download(self, bucket: str, path: str) -> bytes:
        """
        Faz download de um arquivo do Supabase Storage.
        
        Args:
            bucket: Nome do bucket (ex: "articles").
            path: Caminho do arquivo.
            
        Returns:
            Conteúdo em bytes.
            
        Raises:
            FileNotFoundError: Se arquivo não existir.
            StorageError: Se erro de conexão.
        """
        try:
            response = self.client.storage.from_(bucket).download(path)
            
            if not response:
                raise FileNotFoundError(f"File not found: {bucket}/{path}")
            
            # Supabase retorna bytes diretamente
            return bytes(response)
            
        except FileNotFoundError:
            raise
        except Exception as e:
            self.logger.error(
                "storage_download_error",
                bucket=bucket,
                path=path,
                error=str(e),
            )
            raise StorageError(f"Download failed: {e}", bucket, path)
    
    async def upload(
        self,
        bucket: str,
        path: str,
        data: bytes,
        content_type: str = "application/octet-stream",
    ) -> str:
        """
        Faz upload de um arquivo para Supabase Storage.
        
        Args:
            bucket: Nome do bucket.
            path: Caminho de destino.
            data: Conteúdo do arquivo.
            content_type: MIME type.
            
        Returns:
            Path do arquivo criado.
            
        Raises:
            StorageError: Se erro de upload.
        """
        try:
            response = self.client.storage.from_(bucket).upload(
                path,
                data,
                file_options={"content-type": content_type},
            )
            
            self.logger.info(
                "storage_upload_success",
                bucket=bucket,
                path=path,
                size=len(data),
            )
            
            return path
            
        except Exception as e:
            self.logger.error(
                "storage_upload_error",
                bucket=bucket,
                path=path,
                error=str(e),
            )
            raise StorageError(f"Upload failed: {e}", bucket, path)
    
    async def delete(self, bucket: str, path: str) -> bool:
        """
        Remove um arquivo do Supabase Storage.
        
        Args:
            bucket: Nome do bucket.
            path: Caminho do arquivo.
            
        Returns:
            True se removido.
        """
        try:
            self.client.storage.from_(bucket).remove([path])
            
            self.logger.info(
                "storage_delete_success",
                bucket=bucket,
                path=path,
            )
            
            return True
            
        except Exception as e:
            self.logger.warning(
                "storage_delete_error",
                bucket=bucket,
                path=path,
                error=str(e),
            )
            return False
    
    async def exists(self, bucket: str, path: str) -> bool:
        """
        Verifica se arquivo existe no Supabase Storage.
        
        Args:
            bucket: Nome do bucket.
            path: Caminho do arquivo.
            
        Returns:
            True se existe.
        """
        try:
            # Tenta listar o arquivo específico
            folder = "/".join(path.split("/")[:-1]) or ""
            filename = path.split("/")[-1]
            
            response = self.client.storage.from_(bucket).list(folder)
            
            if response:
                return any(f.get("name") == filename for f in response)
            
            return False
            
        except Exception:
            return False
    
    async def get_public_url(self, bucket: str, path: str) -> str:
        """
        Obtém URL pública de um arquivo.
        
        Args:
            bucket: Nome do bucket.
            path: Caminho do arquivo.
            
        Returns:
            URL pública.
        """
        try:
            response = self.client.storage.from_(bucket).get_public_url(path)
            return response
        except Exception as e:
            raise StorageError(f"Failed to get public URL: {e}", bucket, path)
    
    async def get_signed_url(
        self,
        bucket: str,
        path: str,
        expires_in: int = 3600,
    ) -> str:
        """
        Obtém URL assinada com expiração.
        
        Args:
            bucket: Nome do bucket.
            path: Caminho do arquivo.
            expires_in: Tempo de expiração em segundos.
            
        Returns:
            URL assinada.
        """
        try:
            response = self.client.storage.from_(bucket).create_signed_url(
                path, expires_in
            )
            return response.get("signedURL", "")
        except Exception as e:
            raise StorageError(f"Failed to get signed URL: {e}", bucket, path)
    
    async def list_files(
        self,
        bucket: str,
        prefix: str = "",
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """
        Lista arquivos em um bucket/path.
        
        Args:
            bucket: Nome do bucket.
            prefix: Prefixo/pasta para filtrar.
            limit: Máximo de resultados.
            
        Returns:
            Lista de metadados dos arquivos.
        """
        try:
            response = self.client.storage.from_(bucket).list(
                prefix,
                {"limit": limit},
            )
            
            return response or []
            
        except Exception as e:
            self.logger.error(
                "storage_list_error",
                bucket=bucket,
                prefix=prefix,
                error=str(e),
            )
            return []
    
    async def move(
        self,
        bucket: str,
        from_path: str,
        to_path: str,
    ) -> bool:
        """
        Move um arquivo dentro do bucket.
        
        Args:
            bucket: Nome do bucket.
            from_path: Caminho origem.
            to_path: Caminho destino.
            
        Returns:
            True se movido com sucesso.
        """
        try:
            self.client.storage.from_(bucket).move(from_path, to_path)
            
            self.logger.info(
                "storage_move_success",
                bucket=bucket,
                from_path=from_path,
                to_path=to_path,
            )
            
            return True
            
        except Exception as e:
            self.logger.error(
                "storage_move_error",
                bucket=bucket,
                from_path=from_path,
                to_path=to_path,
                error=str(e),
            )
            return False
    
    async def copy(
        self,
        bucket: str,
        from_path: str,
        to_path: str,
    ) -> bool:
        """
        Copia um arquivo dentro do bucket.
        
        Args:
            bucket: Nome do bucket.
            from_path: Caminho origem.
            to_path: Caminho destino.
            
        Returns:
            True se copiado com sucesso.
        """
        try:
            self.client.storage.from_(bucket).copy(from_path, to_path)
            
            self.logger.info(
                "storage_copy_success",
                bucket=bucket,
                from_path=from_path,
                to_path=to_path,
            )
            
            return True
            
        except Exception as e:
            self.logger.error(
                "storage_copy_error",
                bucket=bucket,
                from_path=from_path,
                to_path=to_path,
                error=str(e),
            )
            return False
