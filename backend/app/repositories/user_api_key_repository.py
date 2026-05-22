"""
User API Key repository.

Persistence for per-user API keys. Encryption/decryption stays in the service
layer (Fernet), same pattern as Zotero integration.
"""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user_api_key import UserAPIKey
from app.repositories.base import BaseRepository


class UserAPIKeyRepository(BaseRepository[UserAPIKey]):
    """CRUD for user API keys (encrypted values are handled by services)."""

    def __init__(self, db: AsyncSession):
        super().__init__(db, UserAPIKey)

    async def list_by_user(
        self,
        user_id: UUID | str,
        active_only: bool = True,
    ) -> list[UserAPIKey]:
        """
        List API keys for a user.

        Args:
            user_id: User ID.
            active_only: Whether to return only active keys.

        Returns:
            API key list.
        """
        if isinstance(user_id, str):
            user_id = UUID(user_id)

        query = select(UserAPIKey).where(UserAPIKey.user_id == user_id)

        if active_only:
            query = query.where(UserAPIKey.is_active.is_(True))

        query = query.order_by(UserAPIKey.created_at.desc())

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_default(
        self,
        user_id: UUID | str,
        provider: str,
    ) -> UserAPIKey | None:
        """
        Get the default key for a provider and user.

        Args:
            user_id: User ID.
            provider: Provider name (openai, anthropic, gemini, grok).

        Returns:
            Default API key or None.
        """
        if isinstance(user_id, str):
            user_id = UUID(user_id)

        query = select(UserAPIKey).where(
            UserAPIKey.user_id == user_id,
            UserAPIKey.provider == provider,
            UserAPIKey.is_active.is_(True),
            UserAPIKey.is_default.is_(True),
        )

        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def get_by_user_and_provider(
        self,
        user_id: UUID | str,
        provider: str,
        active_only: bool = True,
    ) -> list[UserAPIKey]:
        """
        List API keys for a user and provider.

        Args:
            user_id: User ID.
            provider: Provider name.
            active_only: Whether to return only active keys.

        Returns:
            API key list.
        """
        if isinstance(user_id, str):
            user_id = UUID(user_id)

        query = select(UserAPIKey).where(
            UserAPIKey.user_id == user_id,
            UserAPIKey.provider == provider,
        )

        if active_only:
            query = query.where(UserAPIKey.is_active.is_(True))

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_by_id_and_user(
        self,
        key_id: UUID | str,
        user_id: UUID | str,
    ) -> UserAPIKey | None:
        """
        Fetch a key by ID and validate ownership.

        Args:
            key_id: API key ID.
            user_id: User ID for ownership validation.

        Returns:
            API key or None.
        """
        if isinstance(key_id, str):
            key_id = UUID(key_id)
        if isinstance(user_id, str):
            user_id = UUID(user_id)

        query = select(UserAPIKey).where(
            UserAPIKey.id == key_id,
            UserAPIKey.user_id == user_id,
        )

        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def create_key(
        self,
        user_id: UUID | str,
        provider: str,
        encrypted_api_key: str,
        key_name: str | None = None,
        is_default: bool = False,
        metadata: dict[str, Any] | None = None,
    ) -> UserAPIKey:
        """
        Create a new API key.

        NOTE: The API key must already be encrypted in the service layer.

        Args:
            user_id: User ID.
            provider: Provider name.
            encrypted_api_key: Fernet-encrypted API key value.
            key_name: Optional display name.
            is_default: Whether this key should become default.
            metadata: Extra metadata.

        Returns:
            Created API key.
        """
        if isinstance(user_id, str):
            user_id = UUID(user_id)

        key = UserAPIKey(
            user_id=user_id,
            provider=provider,
            encrypted_api_key=encrypted_api_key,
            key_name=key_name,
            is_default=is_default,
            is_active=True,
            validation_status="pending",
            key_metadata=metadata or {},
        )

        return await self.create(key)

    async def unset_default(
        self,
        user_id: UUID | str,
        provider: str,
        exclude_id: UUID | str | None = None,
    ) -> int:
        """
        Unset default for all keys of a provider.

        Args:
            user_id: User ID.
            provider: Provider name.
            exclude_id: Optional key ID to exclude from update.

        Returns:
            Number of updated keys.
        """
        if isinstance(user_id, str):
            user_id = UUID(user_id)

        stmt = (
            update(UserAPIKey)
            .where(
                UserAPIKey.user_id == user_id,
                UserAPIKey.provider == provider,
                UserAPIKey.is_default.is_(True),
            )
            .values(is_default=False)
        )

        if exclude_id:
            if isinstance(exclude_id, str):
                exclude_id = UUID(exclude_id)
            stmt = stmt.where(UserAPIKey.id != exclude_id)

        result = await self.db.execute(stmt)
        await self.db.flush()
        return result.rowcount

    async def set_default(
        self,
        key_id: UUID | str,
        user_id: UUID | str,
    ) -> bool:
        """
        Set a key as provider default.

        Automatically unsets any other default key for the same provider.

        Args:
            key_id: Key ID.
            user_id: User ID.

        Returns:
            True if updated.
        """
        if isinstance(key_id, str):
            key_id = UUID(key_id)
        if isinstance(user_id, str):
            user_id = UUID(user_id)

        # Fetch key and provider.
        key = await self.get_by_id(key_id)
        if not key or key.user_id != user_id:
            return False

        # Unset other defaults for this provider.
        await self.unset_default(user_id, key.provider, exclude_id=key_id)

        # Mark this key as default.
        key.is_default = True
        await self.db.flush()
        await self.db.refresh(key)

        return True

    async def update_key_name(
        self,
        key_id: UUID | str,
        user_id: UUID | str,
        key_name: str | None,
    ) -> bool:
        """
        Update the display name of an API key.

        Args:
            key_id: Key ID.
            user_id: User ID for ownership validation.
            key_name: New display name (None clears it).

        Returns:
            True if a row was updated.
        """
        if isinstance(key_id, str):
            key_id = UUID(key_id)
        if isinstance(user_id, str):
            user_id = UUID(user_id)

        result = await self.db.execute(
            update(UserAPIKey)
            .where(
                UserAPIKey.id == key_id,
                UserAPIKey.user_id == user_id,
            )
            .values(key_name=key_name)
        )
        await self.db.flush()
        return result.rowcount > 0

    async def update_last_used(self, key_id: UUID | str) -> None:
        """
        Update last-used timestamp.

        Args:
            key_id: Key ID.
        """
        if isinstance(key_id, str):
            key_id = UUID(key_id)

        await self.db.execute(
            update(UserAPIKey).where(UserAPIKey.id == key_id).values(last_used_at=datetime.now(UTC))
        )
        await self.db.flush()

    async def set_validation_status(
        self,
        key_id: UUID | str,
        status: str,
    ) -> None:
        """
        Update validation status.

        Args:
            key_id: Key ID.
            status: Validation status (valid, invalid, pending).
        """
        if isinstance(key_id, str):
            key_id = UUID(key_id)

        await self.db.execute(
            update(UserAPIKey)
            .where(UserAPIKey.id == key_id)
            .values(
                validation_status=status,
                last_validated_at=datetime.now(UTC),
            )
        )
        await self.db.flush()

    async def deactivate(
        self,
        key_id: UUID | str,
        user_id: UUID | str,
    ) -> bool:
        """
        Deactivate an API key.

        Args:
            key_id: Key ID.
            user_id: User ID for ownership validation.

        Returns:
            True if deactivated.
        """
        if isinstance(key_id, str):
            key_id = UUID(key_id)
        if isinstance(user_id, str):
            user_id = UUID(user_id)

        result = await self.db.execute(
            update(UserAPIKey)
            .where(
                UserAPIKey.id == key_id,
                UserAPIKey.user_id == user_id,
            )
            .values(is_active=False)
        )
        await self.db.flush()
        return result.rowcount > 0

    async def hard_delete(
        self,
        key_id: UUID | str,
        user_id: UUID | str,
    ) -> bool:
        """
        Permanently delete an API key.

        Args:
            key_id: Key ID.
            user_id: User ID for ownership validation.

        Returns:
            True if deleted.
        """
        if isinstance(key_id, str):
            key_id = UUID(key_id)
        if isinstance(user_id, str):
            user_id = UUID(user_id)

        result = await self.db.execute(
            delete(UserAPIKey).where(
                UserAPIKey.id == key_id,
                UserAPIKey.user_id == user_id,
            )
        )
        await self.db.flush()
        return result.rowcount > 0
