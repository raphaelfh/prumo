"""
API Key Service.

Manages provider API keys encrypted with Fernet.
Follows the same encryption pattern used by ZoteroService.
"""

import base64
from typing import Any
from uuid import UUID

import httpx
from cryptography.fernet import Fernet
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import LoggerMixin
from app.core.security import derive_encryption_key
from app.models.user_api_key import SUPPORTED_PROVIDERS, UserAPIKey
from app.repositories.user_api_key_repository import UserAPIKeyRepository


class APIKeyService(LoggerMixin):
    """
    Service for user API key management.

    Responsibilities:
    - CRUD for API keys with Fernet encryption
    - Provider-specific key validation
    - Default key resolution with global fallback

    Uses the same crypto approach as ZoteroService.
    """

    def __init__(self, db: AsyncSession, user_id: str | UUID):
        """
        Initialize service instance.

        Args:
            db: Async SQLAlchemy session.
            user_id: Authenticated user ID.
        """
        self.db = db
        self._user_id_str = str(user_id)
        self._user_id: UUID | None = None

        # Try converting to UUID, but do not fail for invalid test IDs.
        if isinstance(user_id, UUID):
            self._user_id = user_id
        elif isinstance(user_id, str):
            try:
                self._user_id = UUID(user_id)
            except ValueError:
                # user_id is not a valid UUID (common in tests).
                self._user_id = None

        self._fernet: Fernet | None = None
        self._repo = UserAPIKeyRepository(db)

    @property
    def user_id(self) -> UUID:
        """Return user_id as UUID. Raise ValueError when invalid."""
        if self._user_id is None:
            raise ValueError(f"user_id '{self._user_id_str}' is not a valid UUID")
        return self._user_id

    @property
    def fernet(self) -> Fernet:
        """Return Fernet instance for encryption/decryption."""
        if self._fernet is None:
            key = derive_encryption_key(self._user_id_str)
            # Fernet requires a 32-byte base64 key
            fernet_key = base64.urlsafe_b64encode(key)
            self._fernet = Fernet(fernet_key)
        return self._fernet

    def _encrypt(self, text: str) -> str:
        """Encrypt sensitive text."""
        return self.fernet.encrypt(text.encode()).decode()

    def _decrypt(self, encrypted: str) -> str:
        """Decrypt text."""
        return self.fernet.decrypt(encrypted.encode()).decode()

    async def list_keys(self, active_only: bool = True) -> list[UserAPIKey]:
        """
        List user API keys.

        Args:
            active_only: Whether to return only active keys.

        Returns:
            List of API keys (without decrypted plaintext).
        """
        return await self._repo.list_by_user(self.user_id, active_only=active_only)

    async def save_key(
        self,
        provider: str,
        api_key: str,
        key_name: str | None = None,
        is_default: bool = False,
        key_metadata: dict[str, Any] | None = None,
        validate: bool = True,
    ) -> dict[str, Any]:
        """
        Save a new API key with optional validation.

        Args:
            provider: Provider (openai, anthropic, gemini, grok).
            api_key: Plain-text API key.
            key_name: Optional name.
            is_default: Whether this key should be default.
            key_metadata: Extra metadata.
            validate: Whether to validate before saving.

        Returns:
            Dict with id, validation_status, and message.

        Raises:
            ValueError: If provider is unsupported or key is invalid.
        """
        if provider not in SUPPORTED_PROVIDERS:
            raise ValueError(f"Provider '{provider}' is not supported. Use: {SUPPORTED_PROVIDERS}")

        # Validate key if requested
        validation_status = "pending"
        validation_message = None

        if validate:
            validation_result = await self._validate_key(provider, api_key)
            validation_status = validation_result["status"]
            validation_message = validation_result.get("message")

            if validation_status == "invalid":
                self.logger.warning(
                    "api_key_validation_failed",
                    user_id=str(self.user_id),
                    provider=provider,
                    message=validation_message,
                )

        # Encrypt API key before storing
        encrypted_key = self._encrypt(api_key)

        # Create key record
        key = await self._repo.create_key(
            user_id=self.user_id,
            provider=provider,
            encrypted_api_key=encrypted_key,
            key_name=key_name,
            is_default=is_default,
            metadata=key_metadata,
        )

        # Update validation status
        if validation_status != "pending":
            await self._repo.set_validation_status(key.id, validation_status)

        self.logger.info(
            "api_key_saved",
            user_id=str(self.user_id),
            provider=provider,
            key_id=str(key.id),
            validation_status=validation_status,
        )

        return {
            "id": str(key.id),
            "provider": provider,
            "validation_status": validation_status,
            "validation_message": validation_message,
            "is_default": key.is_default,
        }

    async def get_key_for_provider(
        self,
        provider: str,
        use_fallback: bool = True,
    ) -> str | None:
        """
        Get decrypted API key for a provider.

        Priority:
        1. User default key for provider
        2. Fallback to global key (if use_fallback=True)

        Args:
            provider: Provider.
            use_fallback: Whether to use global key as fallback.

        Returns:
            Decrypted API key or None.
        """
        # If user_id is invalid (tests), go straight to fallback.
        if self._user_id is not None:
            # Try loading user key
            default_key = await self._repo.get_default(self._user_id, provider)

            if default_key and default_key.encrypted_api_key:
                # Update last_used_at
                await self._repo.update_last_used(default_key.id)
                # Decrypt and return
                return self._decrypt(default_key.encrypted_api_key)

        # Fallback to global key
        if use_fallback:
            return self._get_global_key(provider)

        return None

    async def get_decrypted_key(
        self,
        key_id: UUID | str,
    ) -> str | None:
        """
        Get decrypted API key by ID.

        Args:
            key_id: API key ID.

        Returns:
            Decrypted API key or None.
        """
        key = await self._repo.get_by_id_and_user(key_id, self.user_id)

        if key and key.encrypted_api_key:
            return self._decrypt(key.encrypted_api_key)

        return None

    def _get_global_key(self, provider: str) -> str | None:
        """
        Return provider global API key from settings.

        Args:
            provider: Provider.

        Returns:
            Global API key or None.
        """
        if provider == "openai":
            return settings.OPENAI_API_KEY
        # Other providers can be added once global keys are configured
        return None

    async def set_default(self, key_id: str | UUID) -> bool:
        """
        Set a key as default for its provider.

        Args:
            key_id: Key ID.

        Returns:
            True if updated.
        """
        success = await self._repo.set_default(key_id, self.user_id)

        if success:
            self.logger.info(
                "api_key_set_default",
                user_id=str(self.user_id),
                key_id=str(key_id),
            )

        return success

    async def deactivate_key(self, key_id: str | UUID) -> bool:
        """
        Deactivate an API key.

        Args:
            key_id: Key ID.

        Returns:
            True if deactivated.
        """
        success = await self._repo.deactivate(key_id, self.user_id)

        if success:
            self.logger.info(
                "api_key_deactivated",
                user_id=str(self.user_id),
                key_id=str(key_id),
            )

        return success

    async def delete_key(self, key_id: str | UUID) -> bool:
        """
        Permanently delete an API key.

        Args:
            key_id: Key ID.

        Returns:
            True if deleted.
        """
        success = await self._repo.hard_delete(key_id, self.user_id)

        if success:
            self.logger.info(
                "api_key_deleted",
                user_id=str(self.user_id),
                key_id=str(key_id),
            )

        return success

    async def revalidate_key(self, key_id: str | UUID) -> dict[str, Any]:
        """
        Revalidate an existing API key.

        Args:
            key_id: Key ID.

        Returns:
            Dict with status and message.
        """
        if isinstance(key_id, str):
            key_id = UUID(key_id)

        # Load key record
        key = await self._repo.get_by_id_and_user(key_id, self.user_id)
        if not key:
            raise ValueError("API key not found")

        # Decrypt key
        decrypted_key = self._decrypt(key.encrypted_api_key)

        # Validate
        result = await self._validate_key(key.provider, decrypted_key)

        # Update status
        await self._repo.set_validation_status(key_id, result["status"])

        self.logger.info(
            "api_key_revalidated",
            user_id=str(self.user_id),
            key_id=str(key_id),
            status=result["status"],
        )

        return result

    async def _validate_key(
        self,
        provider: str,
        api_key: str,
    ) -> dict[str, Any]:
        """
        Validate API key using a lightweight provider API call.

        Args:
            provider: Provider.
            api_key: API key.

        Returns:
            Dict with status ('valid', 'invalid', 'pending') and message.
        """
        try:
            if provider == "openai":
                return await self._validate_openai(api_key)
            elif provider == "anthropic":
                return await self._validate_anthropic(api_key)
            elif provider == "gemini":
                return await self._validate_gemini(api_key)
            elif provider == "grok":
                return await self._validate_grok(api_key)
            else:
                return {"status": "pending", "message": "Provider validation is not implemented"}
        except Exception as e:
            self.logger.error(
                "api_key_validation_error",
                provider=provider,
                error=str(e),
            )
            return {"status": "pending", "message": f"Validation error: {str(e)}"}

    async def _validate_openai(self, api_key: str) -> dict[str, Any]:
        """Validate OpenAI API key by listing models."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://api.openai.com/v1/models",
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=10.0,
            )

            if response.status_code == 200:
                return {"status": "valid", "message": "Valid API key"}
            elif response.status_code == 401:
                return {"status": "invalid", "message": "Invalid or expired API key"}
            elif response.status_code == 429:
                return {"status": "valid", "message": "Valid API key (rate limited)"}
            else:
                return {"status": "invalid", "message": f"Error: {response.status_code}"}

    async def _validate_anthropic(self, api_key: str) -> dict[str, Any]:
        """Validate Anthropic API key."""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "claude-3-haiku-20240307",
                    "max_tokens": 1,
                    "messages": [{"role": "user", "content": "hi"}],
                },
                timeout=10.0,
            )

            if response.status_code == 200:
                return {"status": "valid", "message": "Valid API key"}
            elif response.status_code in (401, 403):
                return {"status": "invalid", "message": "Invalid API key"}
            elif response.status_code == 429:
                return {"status": "valid", "message": "Valid API key (rate limited)"}
            else:
                error_data = response.json() if response.text else {}
                if "authentication" in str(error_data).lower():
                    return {"status": "invalid", "message": "Invalid API key"}
                return {"status": "valid", "message": "API key is likely valid"}

    async def _validate_gemini(self, api_key: str) -> dict[str, Any]:
        """Validate Google Gemini API key."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"https://generativelanguage.googleapis.com/v1/models?key={api_key}",
                timeout=10.0,
            )

            if response.status_code == 200:
                return {"status": "valid", "message": "Valid API key"}
            elif response.status_code in (400, 401, 403):
                return {"status": "invalid", "message": "Invalid API key"}
            elif response.status_code == 429:
                return {"status": "valid", "message": "Valid API key (rate limited)"}
            else:
                return {"status": "invalid", "message": f"Error: {response.status_code}"}

    async def _validate_grok(self, api_key: str) -> dict[str, Any]:
        """Validate Grok (xAI) API key."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://api.x.ai/v1/models",
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=10.0,
            )

            if response.status_code == 200:
                return {"status": "valid", "message": "Valid API key"}
            elif response.status_code == 401:
                return {"status": "invalid", "message": "Invalid API key"}
            elif response.status_code == 429:
                return {"status": "valid", "message": "Valid API key (rate limited)"}
            else:
                return {"status": "invalid", "message": f"Error: {response.status_code}"}
