"""
Zotero Service.

Manages integracao with Zotero API:
- Secure credential storage
- Requisicoes a API Zotero
- Download de attachments
"""

import base64
from typing import Any

import httpx
from cryptography.fernet import Fernet
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import LoggerMixin
from app.core.security import derive_encryption_key
from app.repositories.integration_repository import ZoteroIntegrationRepository

ZOTERO_API_BASE = "https://api.zotero.org"
ZOTERO_API_VERSION = "3"


class ZoteroService(LoggerMixin):
    """
    Service for integracao with Zotero.

    Manages encrypted credentials and API communication.
    Migrado for usar SQLAlchemy via Repository Pattern.
    """

    def __init__(
        self,
        db: AsyncSession,
        user_id: str,
    ):
        """
        Inicializa o service.

        Args:
            db: Sessao async do SQLAlchemy.
            user_id: user autenticado.
        """
        self.db = db
        self.user_id = user_id
        self._fernet: Fernet | None = None
        self._repo = ZoteroIntegrationRepository(db)

    @property
    def fernet(self) -> Fernet:
        """Return instance Fernet for criptografia."""
        if self._fernet is None:
            key = derive_encryption_key(self.user_id)
            # Fernet requer key base64 de 32 bytes
            fernet_key = base64.urlsafe_b64encode(key)
            self._fernet = Fernet(fernet_key)
        return self._fernet

    def _encrypt(self, text: str) -> str:
        """Criptografa texto sensivel."""
        return self.fernet.encrypt(text.encode()).decode()

    def _decrypt(self, encrypted: str) -> str:
        """Descriptografa texto."""
        return self.fernet.decrypt(encrypted.encode()).decode()

    async def save_credentials(
        self,
        zotero_user_id: str,
        api_key: str,
        library_type: str,
    ) -> dict[str, Any]:
        """
        Save Zotero credentials.

        Args:
            zotero_user_id: user in the Zotero.
            api_key: API key do Zotero.
            library_type: Tipo de biblioteca (user or group).

        Returns:
            Dict with integracao criada.
        """
        if library_type not in ("user", "group"):
            raise ValueError("library_type must be 'user' or 'group'")

        encrypted_api_key = self._encrypt(api_key)

        # Upsert via repository
        integration = await self._repo.upsert(
            user_id=self.user_id,
            zotero_user_id=zotero_user_id,
            encrypted_api_key=encrypted_api_key,
            library_type=library_type,
        )

        self.logger.info(
            "zotero_credentials_saved",
            user_id=self.user_id,
            zotero_user_id=zotero_user_id,
        )

        return {"integration_id": str(integration.id)}

    async def _get_credentials(self) -> dict[str, Any]:
        """Fetch and decrypt user credentials."""
        integration = await self._repo.get_by_user(self.user_id, active_only=True)

        if not integration:
            raise ValueError("Credentials not found. Configure integration first.")

        api_key = self._decrypt(integration.encrypted_api_key)

        return {
            "zotero_user_id": integration.zotero_user_id,
            "api_key": api_key,
            "library_type": integration.library_type,
        }

    async def _make_zotero_request(
        self,
        endpoint: str,
        credentials: dict[str, Any],
        params: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        """
        Send request to Zotero API.

        Args:
            endpoint: API endpoint.
            credentials: User credentials.
            params: Query parameters.

        Returns:
            Dict with data, total_results and has_more.
        """
        url = f"{ZOTERO_API_BASE}{endpoint}"

        async with httpx.AsyncClient() as client:
            response = await client.get(
                url,
                params=params,
                headers={
                    "Zotero-API-Key": credentials["api_key"],
                    "Zotero-API-Version": ZOTERO_API_VERSION,
                    "User-Agent": "ReviewHub/1.0",
                },
                timeout=30.0,
            )

            if not response.is_success:
                self.logger.error(
                    "zotero_api_error",
                    status=response.status_code,
                    endpoint=endpoint,
                )
                raise ValueError(f"Zotero API error: {response.status_code}")

            data = response.json()
            total_results = response.headers.get("Total-Results")
            link_header = response.headers.get("Link", "")

            return {
                "data": data,
                "total_results": int(total_results) if total_results else None,
                "has_more": 'rel="next"' in link_header,
            }

    async def test_connection(self) -> dict[str, Any]:
        """
        Test Zotero connection.

        Returns:
            Dict with connection status and user info.
        """
        try:
            credentials = await self._get_credentials()

            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{ZOTERO_API_BASE}/keys/current",
                    headers={
                        "Zotero-API-Key": credentials["api_key"],
                        "Zotero-API-Version": ZOTERO_API_VERSION,
                    },
                    timeout=10.0,
                )

                if response.status_code == 403:
                    return {
                        "success": False,
                        "error": "Invalid API key or missing permissions.",
                    }

                if not response.is_success:
                    return {
                        "success": False,
                        "error": f"Zotero API error: {response.status_code}",
                    }

                key_info = response.json()

                # Update last_sync_at via repository
                await self._repo.update_last_sync(self.user_id)

                return {
                    "success": True,
                    "user_name": key_info.get("username"),
                    "user_id": str(key_info.get("userID")),
                    "access": key_info.get("access", {}),
                }

        except ValueError as e:
            return {"success": False, "error": str(e)}

    async def list_collections(self) -> dict[str, Any]:
        """
        List Zotero collections.

        Returns:
            Dict with collection list.
        """
        credentials = await self._get_credentials()

        library_prefix = (
            f"/users/{credentials['zotero_user_id']}"
            if credentials["library_type"] == "user"
            else f"/groups/{credentials['zotero_user_id']}"
        )

        result = await self._make_zotero_request(
            f"{library_prefix}/collections",
            credentials,
            {"format": "json"},
        )

        return {"collections": result["data"]}

    async def fetch_items(
        self,
        collection_key: str,
        limit: int = 100,
        start: int = 0,
    ) -> dict[str, Any]:
        """
        Fetch items from a collection.

        Args:
            collection_key: Key da collection.
            limit: Limite de items.
            start: Offset for paginacao.

        Returns:
            Dict with items and info de paginacao.
        """
        credentials = await self._get_credentials()

        library_prefix = (
            f"/users/{credentials['zotero_user_id']}"
            if credentials["library_type"] == "user"
            else f"/groups/{credentials['zotero_user_id']}"
        )

        result = await self._make_zotero_request(
            f"{library_prefix}/collections/{collection_key}/items",
            credentials,
            {
                "format": "json",
                "limit": str(limit),
                "start": str(start),
                "itemType": "-attachment",
            },
        )

        return {
            "items": result["data"],
            "total_results": result["total_results"],
            "has_more": result["has_more"],
        }

    async def fetch_attachments(self, item_key: str) -> dict[str, Any]:
        """
        Fetch attachments for an item.

        Args:
            item_key: Key do item.

        Returns:
            Dict with lista de attachments.
        """
        credentials = await self._get_credentials()

        library_prefix = (
            f"/users/{credentials['zotero_user_id']}"
            if credentials["library_type"] == "user"
            else f"/groups/{credentials['zotero_user_id']}"
        )

        result = await self._make_zotero_request(
            f"{library_prefix}/items/{item_key}/children",
            credentials,
            {"format": "json", "itemType": "attachment"},
        )

        return {"attachments": result["data"]}

    async def download_attachment(self, attachment_key: str) -> dict[str, Any]:
        """
        Download de um attachment.

        Args:
            attachment_key: Key do attachment.

        Returns:
            Dict with base64, filename, content_type and size.
        """
        credentials = await self._get_credentials()

        library_prefix = (
            f"/users/{credentials['zotero_user_id']}"
            if credentials["library_type"] == "user"
            else f"/groups/{credentials['zotero_user_id']}"
        )

        url = f"{ZOTERO_API_BASE}{library_prefix}/items/{attachment_key}/file"

        async with httpx.AsyncClient() as client:
            response = await client.get(
                url,
                headers={
                    "Zotero-API-Key": credentials["api_key"],
                    "Zotero-API-Version": ZOTERO_API_VERSION,
                },
                timeout=60.0,
                follow_redirects=True,
            )

            if not response.is_success:
                raise ValueError(f"Download failed: {response.status_code}")

            content = response.content
            size_mb = len(content) / (1024 * 1024)

            if size_mb > 50:
                raise ValueError(f"Arquivo muito grande: {size_mb:.1f}MB. Maximo: 50MB")

            # Extrair filename do header
            content_disposition = response.headers.get("Content-Disposition", "")
            filename = f"attachment_{attachment_key}.pdf"

            if "filename=" in content_disposition:
                import re

                match = re.search(r'filename[^;=\n]*=["\']?([^"\';\n]*)', content_disposition)
                if match:
                    filename = match.group(1)

            content_type = response.headers.get("Content-Type", "application/pdf")

            return {
                "base64": base64.b64encode(content).decode(),
                "filename": filename,
                "content_type": content_type,
                "size": len(content),
            }
